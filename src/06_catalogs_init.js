    /* =====================================================================
     * 16. QUOTA DE 1 GB, HISTÓRICO COMPARTILHADO E PERFIL DE USUÁRIO (ESTILO SKOOB)
     * ===================================================================== */
    function computeCombinedBankQuota(bankQuotas, fallbackFiles = []) {
      const list = Array.isArray(bankQuotas) ? bankQuotas : [];
      const supaBanks = list.filter(b => b && b.provider !== 'firebase' && b.ok !== false);
      if (supaBanks.length > 0) {
        const usedBytes = supaBanks.reduce((s, b) => s + (b.usedBytes || 0), 0);
        const maxMb = supaBanks.reduce((s, b) => s + (b.maxMb || 1024), 0);
        const mbUsed = usedBytes / (1024 * 1024);
        const pct = Math.min(100, Math.round((mbUsed / Math.max(1, maxMb)) * 1000) / 10);
        return { bankCount: supaBanks.length, mbUsed, maxMb, pct };
      }
      const totalBytes = (fallbackFiles || []).reduce((sum, f) => sum + ((f && f.metadata && f.metadata.size) || f.size || 0), 0);
      const mbUsed = totalBytes / (1024 * 1024);
      const maxMb = 1024;
      const pct = Math.min(100, Math.round((mbUsed / maxMb) * 1000) / 10);
      return { bankCount: 1, mbUsed, maxMb, pct };
    }

    function updateCloudQuotaUi(files, bankQuotas = null) {
      const lbl = document.getElementById('lblCloudStorageQuota');
      const fill = document.getElementById('cloudStorageQuotaFill');
      const multiEl = document.getElementById('cloudMultiQuotaList');
      const titleEl = document.getElementById('lblCloudQuotaTitle');
      const agg = computeCombinedBankQuota(bankQuotas, files);
      const maxFmt = agg.maxMb.toLocaleString('pt-BR');
      if (titleEl) {
        const hasOAuth = Array.isArray(bankQuotas) && bankQuotas.some(b => isOAuthCloudProvider(b.provider) && b.ok);
        titleEl.textContent = agg.bankCount > 1
          ? `Espaço Combinado (${agg.bankCount} bancos conectados · ${formatQuotaCapacityMb(agg.maxMb)})`
          : (hasOAuth ? `Espaço Usado na Nuvem Pessoal (${formatQuotaCapacityMb(agg.maxMb)})` : 'Espaço Usado na Nuvem (1 GB = 1.024 MB no Supabase)');
      }
      if (lbl) lbl.textContent = `${agg.mbUsed.toFixed(1)} MB / ${maxFmt} MB (${agg.pct}%)`;
      if (fill) {
        fill.style.width = `${Math.max(agg.pct, agg.mbUsed > 0 ? 1 : 0)}%`;
        fill.style.background = agg.pct >= 90 ? '#ef4444' : 'var(--accent)';
      }
      window.__cloudStorageMbUsed = agg.mbUsed;

      if (multiEl && Array.isArray(bankQuotas)) {
        multiEl.innerHTML = '';
        if (bankQuotas.length > 1 || bankQuotas.some(b => b.provider === 'firebase' || isOAuthCloudProvider(b.provider))) {
          bankQuotas.forEach(b => {
            const mb = (b.usedBytes || 0) / (1024 * 1024);
            const capMb = b.maxMb || 1024;
            const pct = Math.min(100, Math.round((mb / capMb) * 1000) / 10);
            const capTxt = formatQuotaCapacityMb(capMb);
            const usageTxt = !b.ok
              ? `Erro (${b.error || 'offline'})`
              : (b.provider === 'firebase'
                ? `${((b.usedBytes || 0) / 1024).toFixed(1)} KB / ${capTxt} (JSON progresso)`
                : `${mb.toFixed(1)} MB / ${capTxt} · ${b.fileCount || 0} liv.`);
            const row = document.createElement('div');
            row.style.cssText = 'display:flex; flex-direction:column; gap:3px; padding-top:4px; border-top:1px dashed var(--border-color);';
            row.innerHTML = `
              <div style="display:flex; justify-content:space-between; align-items:center; font-size:11px; gap:6px;">
                <span style="color:var(--text-secondary); overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">
                  <strong style="color:var(--text-primary);">${escapeHtml(b.name)}</strong> (${escapeHtml(getCloudProviderLabel(b.provider))} · ${escapeHtml(b.syncKey)})${b.isActive ? ' ★ ativo' : ''}
                </span>
                <span style="color:${!b.ok ? '#ef4444' : 'var(--accent)'}; font-weight:600; flex-shrink:0;">${escapeHtml(usageTxt)}</span>
              </div>
              <div class="profile-progress-track" style="height:5px;">
                <div class="profile-progress-fill" style="width:${b.ok ? Math.max(pct, b.usedBytes > 0 ? 2 : 0) : 0}%; background:${pct >= 90 ? '#ef4444' : 'var(--accent)'};"></div>
              </div>
            `;
            multiEl.appendChild(row);
          });
        }
      }
    }

    function getSharedActivityLog() {
      try {
        const arr = JSON.parse(localStorage.getItem('reader_shared_activity') || '[]');
        return Array.isArray(arr) ? arr : [];
      } catch { return []; }
    }

    function saveSharedActivityLog(list) {
      const trimmed = (Array.isArray(list) ? list : []).slice(0, 100);
      localStorage.setItem('reader_shared_activity', JSON.stringify(trimmed));
      return trimmed;
    }

    function mergeSharedActivityLists(localArr, remoteArr) {
      const map = new Map();
      [...(remoteArr || []), ...(localArr || [])].forEach(ev => {
        if (!ev) return;
        const key = ev.id || `${ev.timestamp || 0}_${ev.type || ''}_${ev.bookTitle || ''}_${ev.actorEmail || ''}`;
        if (!map.has(key)) map.set(key, ev);
      });
      return Array.from(map.values()).sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0)).slice(0, 100);
    }

    async function pullSharedCatalogFromCloud(overrideCfg = null) {
      const cfg = overrideCfg || getCloudConfig();
      if (!isCloudProfileAuthenticated(cfg) || cfg.provider === 'firebase') return;
      try {
        let remoteCat = null;
        if (isOAuthCloudProvider(cfg.provider)) {
          remoteCat = await cloudReadJsonByPath(cfg, '_shared_catalog.json').catch(() => null);
        } else {
          const res = await fetch(`${cfg.url}/storage/v1/object/${cfg.bucket}/${cfg.syncKey}/_shared_catalog.json?t=${Date.now()}`, {
            cache: 'no-store',
            headers: getSupabaseHeaders(cfg)
          }).catch(() => null);
          if (res && res.ok) remoteCat = await res.json().catch(() => null);
        }
        if (remoteCat && typeof remoteCat === 'object') {
          const localCat = getCloudCatalogMap();
          const merged = { ...localCat };
          for (const [k, v] of Object.entries(remoteCat)) {
            merged[k] = { ...(localCat[k] || {}), ...v };
          }
          localStorage.setItem('reader_cloud_catalog', JSON.stringify(merged));
        }
      } catch {}
    }

    async function pushSharedCatalogMeta(safeFile, entry, overrideCfg = null) {
      const cfg = overrideCfg || getCloudConfig();
      if (!isCloudProfileAuthenticated(cfg) || cfg.provider === 'firebase' || !safeFile) return;
      try {
        await pullSharedCatalogFromCloud(cfg);
        const cat = getCloudCatalogMap();
        cat[safeFile] = { ...(cat[safeFile] || {}), ...entry, updatedAt: Date.now() };
        localStorage.setItem('reader_cloud_catalog', JSON.stringify(cat));
        if (isOAuthCloudProvider(cfg.provider)) {
          await cloudWriteJsonByPath(cfg, '_shared_catalog.json', cat).catch(() => {});
        } else {
          await fetch(`${cfg.url}/storage/v1/object/${cfg.bucket}/${cfg.syncKey}/_shared_catalog.json`, {
            method: 'POST',
            headers: getSupabaseHeaders(cfg, { 'Content-Type': 'application/json', 'x-upsert': 'true' }),
            body: JSON.stringify(cat)
          }).catch(() => {});
        }
      } catch {}
    }

    async function pullSharedActivityFromCloud() {
      const cfg = getCloudConfig();
      if (!isCloudProfileAuthenticated(cfg) || cfg.provider === 'firebase') return getSharedActivityLog();
      try {
        let remote = null;
        if (isOAuthCloudProvider(cfg.provider)) {
          remote = await cloudReadJsonByPath(cfg, '_shared_activity.json').catch(() => null);
        } else {
          const res = await fetch(`${cfg.url}/storage/v1/object/${cfg.bucket}/${cfg.syncKey}/_shared_activity.json?t=${Date.now()}`, {
            cache: 'no-store',
            headers: getSupabaseHeaders(cfg)
          }).catch(() => null);
          if (res && res.ok) remote = await res.json().catch(() => null);
        }
        if (Array.isArray(remote)) {
          const merged = mergeSharedActivityLists(getSharedActivityLog(), remote);
          saveSharedActivityLog(merged);
          return merged;
        }
      } catch {}
      return getSharedActivityLog();
    }

    async function recordSharedActivity(entry) {
      const cfg = getCloudConfig();
      const prof = getUserProfile();
      const fullEntry = {
        id: `${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
        timestamp: Date.now(),
        actorName: prof.displayName || (cfg.userEmail ? cfg.userEmail.split('@')[0] : 'Leitor'),
        actorUsername: prof.username || '',
        actorEmail: cfg.userEmail || '',
        type: entry.type || 'upload',
        bookTitle: entry.bookTitle || 'Livro',
        fileName: entry.fileName || '',
        fileSize: entry.fileSize || 0,
        targetEmail: entry.targetEmail || '',
        channel: entry.channel || ''
      };
      let list = mergeSharedActivityLists([fullEntry], getSharedActivityLog());
      saveSharedActivityLog(list);

      if (isCloudProfileAuthenticated(cfg) && cfg.provider !== 'firebase') {
        try {
          const existing = await pullSharedActivityFromCloud();
          list = mergeSharedActivityLists([fullEntry], existing);
          saveSharedActivityLog(list);
          if (isOAuthCloudProvider(cfg.provider)) {
            await cloudWriteJsonByPath(cfg, '_shared_activity.json', list).catch(() => {});
          } else {
            await fetch(`${cfg.url}/storage/v1/object/${cfg.bucket}/${cfg.syncKey}/_shared_activity.json`, {
              method: 'POST',
              headers: getSupabaseHeaders(cfg, { 'Content-Type': 'application/json', 'x-upsert': 'true' }),
              body: JSON.stringify(list)
            }).catch(() => {});
          }
        } catch {}
      }
      if (document.getElementById('profileModal') && document.getElementById('profileModal').classList.contains('open')) {
        renderProfileActivityFeed();
      }
    }

    function refreshToolbarUserMenu() {
      const cfg = getCloudConfig();
      const prof = getUserProfile();
      const display = (prof.displayName || (cfg.userEmail ? cfg.userEmail.split('@')[0] : '') || 'Conta').trim();
      const initial = (display.charAt(0) || 'L').toUpperCase();
      const greetingEl = document.getElementById('toolbarUserGreeting');
      const avEl = document.getElementById('toolbarUserAvatar');
      const ddTitle = document.getElementById('dropdownUserTitle');
      const ddMeta = document.getElementById('dropdownAccountMeta');

      if (greetingEl) greetingEl.textContent = cfg.userEmail || prof.username || prof.displayName !== 'Leitor' ? `Olá, ${display.split(' ')[0]}!` : 'Conta';
      if (avEl) {
        avEl.innerHTML = prof.avatarDataUrl
          ? `<img src="${prof.avatarDataUrl}" alt="" />`
          : escapeHtml(initial);
      }
      if (ddTitle) ddTitle.textContent = prof.username ? `${display} (@${prof.username})` : display;
      if (ddMeta) {
        const inv = getActiveInviteState();
        if (cfg.userEmail) ddMeta.textContent = `${cfg.userEmail} · Estante: ${cfg.syncKey || 'minha-estante'}`;
        else if (inv) ddMeta.textContent = `Banco compartilhado: ${inv.syncKey}`;
        else ddMeta.textContent = `Estante: ${cfg.syncKey || 'local'} (clique em Nuvem p/ entrar)`;
      }
    }

    const userDropdown = document.getElementById('userProfileDropdown');
    const btnUserMenu = document.getElementById('btnUserMenu');
    if (btnUserMenu && userDropdown) {
      btnUserMenu.addEventListener('click', (e) => {
        e.stopPropagation();
        refreshToolbarUserMenu();
        const isOpen = userDropdown.classList.toggle('open');
        const toolsDd = document.getElementById('toolsDropdown');
        if (toolsDd) toolsDd.classList.remove('open');
        const typoPop = document.getElementById('typoPopover');
        if (typoPop) typoPop.classList.remove('open');
      });
      document.addEventListener('click', (e) => {
        if (!userDropdown.contains(e.target) && !btnUserMenu.contains(e.target)) {
          userDropdown.classList.remove('open');
        }
      });
    }

    let activeProfileActivityTab = 'all';
    document.querySelectorAll('[data-profile-act]').forEach(btn => {
      btn.addEventListener('click', () => {
        activeProfileActivityTab = btn.dataset.profileAct || 'all';
        document.querySelectorAll('[data-profile-act]').forEach(b => b.classList.toggle('active', b === btn));
        renderProfileActivityFeed();
      });
    });

    function renderProfileActivityFeed() {
      const box = document.getElementById('profileActivityList');
      if (!box) return;
      const list = getSharedActivityLog().filter(ev => {
        if (activeProfileActivityTab === 'kindle') return ev.type === 'kindle';
        if (activeProfileActivityTab === 'uploads') return ev.type === 'upload' || ev.type === 'suggest' || ev.type === 'approve';
        return true;
      });
      if (!list.length) {
        box.innerHTML = '<div style="padding:10px; font-size:12px; color:var(--text-muted);">Nenhuma atividade registrada ainda (uploads na nuvem, aprovações ou envios p/ Kindle aparecerão aqui com data e destinatário).</div>';
        return;
      }
      box.innerHTML = '';
      list.slice(0, 40).forEach(ev => {
        const dt = ev.timestamp ? new Date(ev.timestamp).toLocaleString('pt-BR') : '';
        const who = ev.actorName || (ev.actorEmail ? ev.actorEmail.split('@')[0] : 'Leitor');
        let actionTxt = '';
        if (ev.type === 'kindle') {
          actionTxt = `enviou <strong>${escapeHtml(ev.bookTitle)}</strong> para o Kindle <code>${escapeHtml(ev.targetEmail || 'Kindle')}</code> (${escapeHtml(ev.channel || 'Direto')})`;
        } else if (ev.type === 'suggest') {
          actionTxt = `sugeriu o livro <strong>${escapeHtml(ev.bookTitle)}</strong> para aprovação`;
        } else if (ev.type === 'approve') {
          actionTxt = `aprovou <strong>${escapeHtml(ev.bookTitle)}</strong> na estante compartilhada`;
        } else {
          const sz = ev.fileSize ? ` (${(ev.fileSize / 1048576).toFixed(1)} MB)` : '';
          actionTxt = `adicionou <strong>${escapeHtml(ev.bookTitle)}</strong> ao banco compartilhado${sz}`;
        }
        const row = document.createElement('div');
        row.className = 'profile-activity-item';
        row.innerHTML = `
          <span class="user-avatar-sm">${escapeHtml((who.charAt(0) || 'L').toUpperCase())}</span>
          <div style="flex:1; min-width:0;">
            <div><strong>${escapeHtml(who)}</strong> ${ev.actorEmail ? `<span style="color:var(--text-muted); font-size:11px;">(${escapeHtml(ev.actorEmail)})</span>` : ''} ${actionTxt}</div>
            <div style="font-size:10.5px; color:var(--text-muted); margin-top:2px;">${escapeHtml(dt)}</div>
          </div>
        `;
        box.appendChild(row);
      });
    }

    async function renderProfileModal() {
      const cfg = getCloudConfig();
      const prof = getUserProfile();
      const hist = JSON.parse(localStorage.getItem('reader_history') || '{}');
      const revMap = getBookReviewsMap();
      const favs = getBookFavoritesMap();
      const insights = getReadingInsights();
      const kindleHist = JSON.parse(localStorage.getItem('reader_kindle_history') || '[]');
      const bms = JSON.parse(localStorage.getItem('reader_bookmarks') || '{}');

      // Avatar e campos editáveis
      const avBox = document.getElementById('profileAvatarPreview');
      const initial = ((prof.displayName || 'L').charAt(0) || 'L').toUpperCase();
      if (avBox) {
        avBox.innerHTML = prof.avatarDataUrl ? `<img src="${prof.avatarDataUrl}" alt="Avatar" />` : escapeHtml(initial);
      }
      document.getElementById('inputProfileDisplayName').value = prof.displayName || '';
      document.getElementById('inputProfileUsername').value = prof.username || '';
      document.getElementById('inputProfileBio').value = prof.bio || '';
      document.getElementById('inputProfileAnnualGoal').value = String(prof.annualGoalBooks || 12);

      // % Perfil Completo
      let compPct = 0;
      const missingParts = [];
      if (prof.avatarDataUrl) compPct += 25; else missingParts.push('Foto (+25%)');
      if (prof.displayName && prof.displayName !== 'Leitor') compPct += 20; else missingParts.push('Nome (+20%)');
      if (prof.username) compPct += 15; else missingParts.push('@Usuário (+15%)');
      if (prof.bio && prof.bio.trim().length >= 3) compPct += 20; else missingParts.push('Bio (+20%)');
      if (cfg.userEmail) compPct += 20; else missingParts.push('Entrar c/ e-mail na Nuvem (+20%)');
      document.getElementById('lblProfileCompletePct').textContent = `${compPct}%`;
      document.getElementById('profileCompleteFill').style.width = `${compPct}%`;
      const hintEl = document.getElementById('lblProfileCompleteHint');
      if (hintEl) {
        hintEl.textContent = missingParts.length ? `Falta: ${missingParts.join(' · ')}` : 'Perfil 100% completo!';
      }

      document.getElementById('lblProfileDisplayHeading').textContent = prof.username
        ? `${prof.displayName} (@${prof.username})`
        : prof.displayName;
      document.getElementById('lblProfileSubMeta').textContent = cfg.userEmail
        ? `Conta: ${cfg.userEmail} · Banco: ${cfg.syncKey || 'minha-estante'}`
        : `Estante local/compartilhada: ${cfg.syncKey || 'minha-estante'}`;

      // Estatísticas alinhadas 1-para-1 com a Estante real (local + nuvem deduplicados, sem fantasmas apagados)
      const unified = await getUnifiedShelfBooks();
      const stats = computeShelfProfileStats({
        unified,
        hist,
        revMap,
        favs,
        insights,
        bms,
        kindleHist,
        activeState: state
      });
      const readCount = stats.readCount;
      const pagesMeter = stats.pagesMeter;

      const pagesEl = document.getElementById('statProfilePages');
      pagesEl.textContent = String(pagesMeter);
      if (pagesEl.parentElement) {
        pagesEl.parentElement.title = stats.pagesBreakdown.length
          ? `Avanço atual por livro na estante:\n${stats.pagesBreakdown.join('\n')}`
          : 'Nenhum livro avançado além da página inicial ainda.';
      }
      document.getElementById('statProfileRead').textContent = String(readCount);
      document.getElementById('statProfileReading').textContent = String(stats.readingCount);
      document.getElementById('statProfileWishlist').textContent = String(stats.wishlistCount);
      document.getElementById('statProfileRereading').textContent = String(stats.rereadingCount);
      document.getElementById('statProfileAbandoned').textContent = String(stats.abandonedCount);
      document.getElementById('statProfileReviews').textContent = String(stats.reviewsCount);

      document.getElementById('lblProfileRibbonFavs').textContent = `Favoritos: ${stats.favCount}`;
      document.getElementById('lblProfileRibbonCloud').textContent = `Na Nuvem: ${cachedCloudFilesList.length}`;
      document.getElementById('lblProfileRibbonMarks').textContent = `Marcadores: ${stats.totalBookmarks}`;
      document.getElementById('lblProfileRibbonKindle').textContent = `Envios Kindle: ${stats.kindleCount}`;
      document.getElementById('lblProfileRibbonGoal').textContent = `Meta: ${prof.annualGoalBooks}`;

      const curYear = new Date().getFullYear();
      document.getElementById('lblProfileGoalYear').textContent = `Meta de leitura ${curYear}`;
      const goalTarget = Math.max(1, prof.annualGoalBooks || 12);
      const goalPct = Math.min(100, Math.round((readCount / goalTarget) * 100));
      document.getElementById('lblProfileGoalStats').innerHTML =
        `<strong>${goalTarget} Livros</strong><br/>Lidos: <strong>${readCount} de ${goalTarget}</strong> (${goalPct}%)<br/>Paginômetro: <strong>${pagesMeter}</strong>`;

      // Capas da meta anual (clicar abre a estante/livro)
      const coversStrip = document.getElementById('profileGoalCovers');
      coversStrip.innerHTML = '';
      const stripBooks = unified.map(b => ({ bookKey: b.bookKey, safeName: b.safeName, title: b.title }));
      if (!stripBooks.length) {
        coversStrip.innerHTML = '<div style="font-size:12px; color:var(--text-muted); padding:10px 0;">Adicione livros à sua Estante para ver as capas da sua meta aqui.</div>';
      } else {
        const shown = new Set();
        stripBooks.slice(0, 14).forEach(sb => {
          if (shown.has(sb.title)) return;
          shown.add(sb.title);
          const item = document.createElement('div');
          item.className = 'profile-goal-cover-item';
          item.title = sb.title;
          const covUrl = getBookCoverDataUrl(sb.bookKey, sb.safeName);
          item.innerHTML = covUrl ? `<img src="${covUrl}" alt="" />` : `<span>${escapeHtml(sb.title.slice(0, 26))}</span>`;
          item.addEventListener('click', () => {
            document.getElementById('profileModal').classList.remove('open');
            dom.emptyState.classList.remove('hidden');
            renderBookshelf();
          });
          coversStrip.appendChild(item);
        });
      }

      renderProfileActivityFeed();
    }

    let clubChatPollInterval = null;
    function startClubChatPolling() {
      if (clubChatPollInterval) clearInterval(clubChatPollInterval);
      clubChatPollInterval = setInterval(() => {
        const modal = document.getElementById('profileModal');
        if (modal && modal.classList.contains('open')) {
          if (typeof pullClubChatMessages === 'function') pullClubChatMessages().catch(() => {});
        } else {
          stopClubChatPolling();
        }
      }, 7000);
    }
    function stopClubChatPolling() {
      if (clubChatPollInterval) {
        clearInterval(clubChatPollInterval);
        clubChatPollInterval = null;
      }
    }

    async function openProfileModal() {
      const dd = document.getElementById('userProfileDropdown');
      if (dd) dd.classList.remove('open');
      document.getElementById('profileModal').classList.add('open');
      await renderProfileModal();
      pullSharedActivityFromCloud().then(() => renderProfileActivityFeed()).catch(() => {});
      if (typeof refreshOwnerMembersPanel === 'function') refreshOwnerMembersPanel().catch(() => {});
      if (typeof pullPublicClubProfiles === 'function') pullPublicClubProfiles().catch(() => {});
      if (typeof pullClubChatMessages === 'function') pullClubChatMessages().catch(() => {});
      startClubChatPolling();
    }

    async function resizeAvatarFileToDataUrl(file) {
      return new Promise((resolve) => {
        const reader = new FileReader();
        reader.onload = () => {
          const img = new Image();
          img.onload = () => {
            const size = 180;
            const cvs = document.createElement('canvas');
            cvs.width = size;
            cvs.height = size;
            const ctx = cvs.getContext('2d');
            const minSide = Math.min(img.width, img.height);
            const sx = (img.width - minSide) / 2;
            const sy = (img.height - minSide) / 2;
            ctx.drawImage(img, sx, sy, minSide, minSide, 0, 0, size, size);
            resolve(cvs.toDataURL('image/jpeg', 0.82));
          };
          img.onerror = () => resolve('');
          img.src = String(reader.result || '');
        };
        reader.readAsDataURL(file);
      });
    }

    document.getElementById('btnMenuOpenProfile').addEventListener('click', openProfileModal);
    document.getElementById('btnMenuOpenShelf').addEventListener('click', () => {
      if (userDropdown) userDropdown.classList.remove('open');
      dom.emptyState.classList.remove('hidden');
      renderBookshelf();
    });
    const btnOpenIns = document.getElementById('btnMenuOpenInsights');
    if (btnOpenIns) {
      btnOpenIns.addEventListener('click', () => {
        if (userDropdown) userDropdown.classList.remove('open');
        openToolsModalFn('paneStudioConvert');
      });
    }

    document.getElementById('btnMenuSignOut').addEventListener('click', () => {
      if (userDropdown) userDropdown.classList.remove('open');
      document.getElementById('btnCloudSignOut').click();
    });

    document.getElementById('btnCloseProfileModal').addEventListener('click', () => {
      stopClubChatPolling();
      document.getElementById('profileModal').classList.remove('open');
    });
    document.getElementById('btnCloseProfileFooter').addEventListener('click', () => {
      stopClubChatPolling();
      document.getElementById('profileModal').classList.remove('open');
    });
    document.getElementById('btnProfileOpenCloud').addEventListener('click', () => {
      document.getElementById('profileModal').classList.remove('open');
      openCloudModalFn();
    });
    document.getElementById('btnProfileOpenInsights').addEventListener('click', () => {
      document.getElementById('profileModal').classList.remove('open');
      openToolsModalFn('paneStudioInsights');
    });
    document.getElementById('btnProfileGoShelf').addEventListener('click', () => {
      document.getElementById('profileModal').classList.remove('open');
      dom.emptyState.classList.remove('hidden');
      renderBookshelf();
    });
    document.getElementById('btnRefreshProfileActivity').addEventListener('click', async () => {
      document.getElementById('lblProfileStatus').textContent = 'Atualizando atividades da nuvem...';
      await pullSharedActivityFromCloud();
      renderProfileActivityFeed();
      document.getElementById('lblProfileStatus').textContent = 'Atividades atualizadas.';
    });
    document.getElementById('btnProfileAvatarUpload').addEventListener('click', () => {
      document.getElementById('inputProfileAvatarFile').click();
    });
    document.getElementById('inputProfileAvatarFile').addEventListener('change', async (e) => {
      const f = e.target.files && e.target.files[0];
      e.target.value = '';
      if (!f) return;
      const dataUrl = await resizeAvatarFileToDataUrl(f);
      if (dataUrl) {
        saveUserProfile({ avatarDataUrl: dataUrl });
        await renderProfileModal();
        pushCloudSyncSilent();
        showToast('Foto de perfil atualizada!');
      }
    });
    document.getElementById('btnProfileAvatarRemove').addEventListener('click', async () => {
      saveUserProfile({ avatarDataUrl: '' });
      await renderProfileModal();
      pushCloudSyncSilent();
      showToast('Foto removida.');
    });
    document.getElementById('btnSaveUserProfile').addEventListener('click', async () => {
      saveUserProfile({
        displayName: document.getElementById('inputProfileDisplayName').value.trim() || 'Leitor',
        username: document.getElementById('inputProfileUsername').value.trim().replace(/^@+/, ''),
        bio: document.getElementById('inputProfileBio').value.trim(),
        annualGoalBooks: parseInt(document.getElementById('inputProfileAnnualGoal').value || '12', 10) || 12
      });
      await renderProfileModal();
      await pushCloudSyncSilent();
      document.getElementById('lblProfileStatus').textContent = 'Perfil salvo e sincronizado!';
      showToast('Perfil salvo com sucesso!');
    });
    document.getElementById('btnSaveProfileGoal').addEventListener('click', async () => {
      const g = Math.max(1, parseInt(document.getElementById('inputProfileAnnualGoal').value || '12', 10) || 12);
      saveUserProfile({ annualGoalBooks: g });
      await renderProfileModal();
      await pushCloudSyncSilent();
      showToast(`Meta anual definida: ${g} livros!`);
    });

    /* =====================================================================
     * 17. CATÁLOGO OPDS ABERTO & ACERVOS PÚBLICOS + CACHE OFFLINE (PWA)
     * ===================================================================== */
    async function fetchExternalTextOrXml(url) {
      try {
        const direct = await fetch(url);
        if (direct.ok) return await direct.text();
      } catch {}
      if (location.protocol.startsWith('http')) {
        const proxied = await fetch(`/api/opds-proxy?url=${encodeURIComponent(url)}`);
        if (!proxied.ok) {
          const msg = await proxied.text().catch(() => '');
          throw new Error(msg || `HTTP ${proxied.status}`);
        }
        return await proxied.text();
      }
      throw new Error('Servidor bloqueou acesso direto (CORS). Abra pela versão hospedada (Vercel/Netlify) para usar o proxy OPDS.');
    }

    let activeDownloadAbortCtrl = null;
    function showFloatingDownloadProgress(title, subText, pct) {
      const bar = document.getElementById('floatingDownloadBar');
      if (!bar) return;
      const tEl = document.getElementById('lblFloatingDlTitle');
      const fillEl = document.getElementById('floatingDlFill');
      const metaEl = document.getElementById('lblFloatingDlMeta');
      const pctEl = document.getElementById('lblFloatingDlPct');
      if (tEl && title) tEl.textContent = title;
      const cleanPct = Math.max(0, Math.min(100, Math.round(pct || 0)));
      if (fillEl) fillEl.style.width = `${Math.max(4, cleanPct)}%`;
      if (metaEl && metaEl.firstElementChild) metaEl.firstElementChild.textContent = subText || 'Baixando...';
      if (pctEl) pctEl.textContent = `${cleanPct}%`;
      bar.classList.add('open');
    }

    function hideFloatingDownloadProgress() {
      const bar = document.getElementById('floatingDownloadBar');
      if (bar) bar.classList.remove('open');
      activeDownloadAbortCtrl = null;
    }

    const btnCancelFloatingEl = document.getElementById('btnCancelFloatingDl');
    if (btnCancelFloatingEl) {
      btnCancelFloatingEl.addEventListener('click', () => {
        if (activeDownloadAbortCtrl) {
          activeDownloadAbortCtrl.abort();
          activeDownloadAbortCtrl = null;
        }
        hideFloatingDownloadProgress();
        showToast('Download cancelado.');
      });
    }

    async function fetchExternalBinary(url, onProgress = null, trackLabel = '') {
      const showUi = Boolean(trackLabel || onProgress);
      const label = trackLabel || decodeURIComponent((url.split('/').pop() || 'arquivo').split('?')[0]);
      const ctrl = new AbortController();
      if (showUi) {
        activeDownloadAbortCtrl = ctrl;
        showFloatingDownloadProgress(`Baixando: ${label}`, 'Conectando...', 2);
      }

      const fetchProxyWithRetry = async (targetUrl, rangeSpec) => {
        let lastErr = null;
        for (let attempt = 0; attempt < 3; attempt++) {
          if (ctrl.signal.aborted) throw new DOMException('Aborted', 'AbortError');
          try {
            const pUrl = rangeSpec
              ? `/api/opds-proxy?url=${encodeURIComponent(targetUrl)}&range=${encodeURIComponent(rangeSpec)}`
              : `/api/opds-proxy?url=${encodeURIComponent(targetUrl)}`;
            const res = await fetch(pUrl, { signal: ctrl.signal });
            if (res.status === 200 || res.status === 206) return res;
            const errTxt = await res.text().catch(() => '');
            if (res.status === 413 || res.status === 416) {
              const e = new Error(errTxt || `HTTP ${res.status}`);
              e.statusCode = res.status;
              throw e;
            }
            lastErr = new Error(errTxt || `HTTP ${res.status}`);
          } catch (err) {
            if (err && (err.name === 'AbortError' || err.statusCode === 413 || err.statusCode === 416)) throw err;
            lastErr = err;
          }
          if (attempt < 2) {
            if (showUi) showFloatingDownloadProgress(`Baixando: ${label}`, `Reconectando (tentativa ${attempt + 2}/3)...`, 5);
            await new Promise(r => setTimeout(r, 450 * (attempt + 1)));
          }
        }
        throw lastErr || new Error('Falha ao baixar bloco pelo proxy OPDS.');
      };

      try {
        try {
          const direct = await fetch(url, { signal: ctrl.signal });
          if (direct.ok) {
            const ab = await direct.arrayBuffer();
            if (showUi) hideFloatingDownloadProgress();
            return ab;
          }
        } catch (dirErr) {
          if (dirErr && dirErr.name === 'AbortError') throw dirErr;
        }

        if (!location.protocol.startsWith('http')) {
          throw new Error('Download bloqueado por CORS em arquivo local (file://).');
        }

        // Blocos de 1.5 MB: evita timeout de 10s na Vercel Hobby e limites de payload (4.5 MB Vercel / 6 MB Netlify)
        const CHUNK_BYTES = 1536 * 1024;
        const MAX_BROWSER_BYTES = 250 * 1024 * 1024;
        let firstRes;
        try {
          firstRes = await fetchProxyWithRetry(url, `bytes=0-${CHUNK_BYTES - 1}`);
        } catch (rangeErr) {
          if (rangeErr && rangeErr.name === 'AbortError') throw rangeErr;
          if (rangeErr && rangeErr.statusCode === 416) {
            firstRes = await fetchProxyWithRetry(url, '');
          } else {
            throw rangeErr;
          }
        }

        if (firstRes.status === 206) {
          const cr = firstRes.headers.get('content-range') || '';
          const m = cr.match(/bytes\s+(\d+)-(\d+)\/(\d+)/i);
          const firstBuf = new Uint8Array(await firstRes.arrayBuffer());
          const pinnedUrl = firstRes.headers.get('x-final-url') || url;
          if (!m) return firstBuf.buffer;
          const total = parseInt(m[3], 10);
          if (!total || firstBuf.length >= total) return firstBuf.buffer;
          if (total > MAX_BROWSER_BYTES) {
            throw new Error(`Arquivo muito grande (${(total / 1048576).toFixed(0)} MB) para abrir na memória do navegador. Use o botão "Baixar" direto.`);
          }
          const out = new Uint8Array(total);
          out.set(firstBuf, 0);
          let offset = firstBuf.length;
          let activeChunkUrl = pinnedUrl;

          const reportChunkProgress = (curBytes) => {
            const pct = (curBytes / Math.max(1, total)) * 100;
            const mbTxt = `${(curBytes / 1048576).toFixed(1)} / ${(total / 1048576).toFixed(1)} MB`;
            if (showUi) showFloatingDownloadProgress(`Baixando: ${label}`, mbTxt, pct);
            if (typeof onProgress === 'function') onProgress(curBytes, total);
          };
          reportChunkProgress(offset);

          while (offset < total) {
            const end = Math.min(total - 1, offset + CHUNK_BYTES - 1);
            let rRes;
            try {
              rRes = await fetchProxyWithRetry(activeChunkUrl, `bytes=${offset}-${end}`);
            } catch (chunkErr) {
              if (chunkErr && chunkErr.name === 'AbortError') throw chunkErr;
              if (activeChunkUrl !== url) {
                activeChunkUrl = url;
                rRes = await fetchProxyWithRetry(url, `bytes=${offset}-${end}`);
              } else {
                throw chunkErr;
              }
            }
            const chunk = new Uint8Array(await rRes.arrayBuffer());
            if (!chunk.length) break;
            const copyLen = Math.min(chunk.length, total - offset);
            out.set(chunk.subarray(0, copyLen), offset);
            offset += copyLen;
            reportChunkProgress(offset);
          }
          return out.buffer;
        }
        return await firstRes.arrayBuffer();
      } finally {
        if (showUi) hideFloatingDownloadProgress();
      }
    }

    function parseOpdsAtomXml(xmlText, baseUrl) {
      const parser = new DOMParser();
      const doc = parser.parseFromString(xmlText, 'application/xml');
      const entries = Array.from(doc.querySelectorAll('entry'));
      const items = [];
      entries.forEach(entry => {
        const title = (entry.querySelector('title') && entry.querySelector('title').textContent || 'Sem título').trim();
        const contentTxt = (entry.querySelector('content') && entry.querySelector('content').textContent || '').trim();
        const authors = Array.from(entry.querySelectorAll('author name')).map(n => n.textContent.trim()).filter(Boolean).join(', ') || (contentTxt && contentTxt.length < 80 ? contentTxt : '') || 'Domínio Público';
        const idTxt = (entry.querySelector('id') && entry.querySelector('id').textContent || '').trim();
        const links = Array.from(entry.querySelectorAll('link'));
        let epubUrl = '';
        let fallbackEpubUrl = '';
        let pdfUrl = '';
        let mobiUrl = '';
        let coverUrl = '';
        let gutenbergBookId = '';
        const idMatch = idTxt.match(/gutenberg\.org\/ebooks\/(\d+)\.opds/i);
        if (idMatch) gutenbergBookId = idMatch[1];

        links.forEach(lk => {
          const href = lk.getAttribute('href') || '';
          const type = (lk.getAttribute('type') || '').toLowerCase();
          const rel = (lk.getAttribute('rel') || '').toLowerCase();
          if (!href) return;
          let absHref = href;
          try { absHref = new URL(href, baseUrl).toString(); } catch {}
          const gbMatch = absHref.match(/gutenberg\.org\/ebooks\/(\d+)\.opds/i);
          if (gbMatch && !gutenbergBookId) gutenbergBookId = gbMatch[1];
          if (rel.includes('image') || rel.includes('thumbnail')) {
            if (!coverUrl || rel.includes('thumbnail')) coverUrl = absHref;
          } else if (rel.includes('acquisition') || type.includes('epub') || type.includes('pdf') || type.includes('mobipocket')) {
            if (type.includes('epub') || /\.epub(\?|$)/i.test(absHref)) {
              if (!epubUrl) epubUrl = absHref;
            } else if (type.includes('pdf') || /\.pdf(\?|$)/i.test(absHref)) {
              if (!pdfUrl) pdfUrl = absHref;
            } else if (type.includes('mobipocket') || /\.mobi(\?|$)/i.test(absHref)) {
              if (!mobiUrl) mobiUrl = absHref;
            }
          }
        });
        // Suporte nativo ao catálogo OPDS de busca do Project Gutenberg (/ebooks/<id>.opds)
        if (!epubUrl && !pdfUrl && !mobiUrl && gutenbergBookId) {
          epubUrl = `https://www.gutenberg.org/ebooks/${gutenbergBookId}.epub.images`;
          fallbackEpubUrl = `https://www.gutenberg.org/ebooks/${gutenbergBookId}.epub.noimages`;
          if (!coverUrl || coverUrl.startsWith('data:image/png')) {
            coverUrl = `https://www.gutenberg.org/cache/epub/${gutenbergBookId}/pg${gutenbergBookId}.cover.medium.jpg`;
          }
        }
        const bestUrl = epubUrl || pdfUrl || mobiUrl;
        if (bestUrl) {
          const fmt = epubUrl ? 'EPUB' : (pdfUrl ? 'PDF' : 'MOBI');
          items.push({ title, author: authors, coverUrl, downloadUrl: bestUrl, fallbackPdfUrl: fallbackEpubUrl || '', format: fmt, source: 'OPDS' });
        }
      });
      return items;
    }

    function parseOpdsFeedAuto(rawText, baseUrl) {
      const trimmed = (rawText || '').trim();
      if (trimmed.startsWith('{')) {
        const json = JSON.parse(trimmed);
        const groupPubs = Array.isArray(json.groups) ? json.groups.flatMap(g => (g && Array.isArray(g.publications)) ? g.publications : []) : [];
        const pubs = [
          ...(Array.isArray(json.publications) ? json.publications : []),
          ...groupPubs
        ];
        const out = [];
        pubs.forEach(p => {
          const md = p.metadata || {};
          const title = (typeof md.title === 'object' ? pickLocalizedText(md.title) : md.title) || 'Sem título';
          const authorRaw = Array.isArray(md.author) ? md.author : (md.author ? [md.author] : []);
          const author = authorRaw.map(a => typeof a === 'string' ? a : (a.name || '')).filter(Boolean).join(', ') || 'OPDS 2.0';
          const links = Array.isArray(p.links) ? p.links : [];
          const imgs = Array.isArray(p.images) ? p.images : [];
          let epubUrl = '', pdfUrl = '', cbzUrl = '', fallbackUrl = '', coverUrl = '';
          imgs.forEach(im => { if (im && im.href && !coverUrl) { try { coverUrl = new URL(im.href, baseUrl).toString(); } catch { coverUrl = im.href; } } });
          links.forEach(lk => {
            if (!lk || !lk.href) return;
            const tp = (lk.type || '').toLowerCase();
            let abs = lk.href;
            try { abs = new URL(lk.href, baseUrl).toString(); } catch {}
            if (tp.includes('epub') || /\.epub(\?|$)/i.test(abs)) { if (!epubUrl) epubUrl = abs; }
            else if (tp.includes('cbz') || tp.includes('comicbook') || /\.cbz(\?|$)/i.test(abs)) { if (!cbzUrl) cbzUrl = abs; }
            else if (tp.includes('pdf') || /\.pdf(\?|$)/i.test(abs)) { if (!pdfUrl) pdfUrl = abs; }
            else if (lk.properties && lk.properties.edition && lk.properties.edition.offer) {
              const offerRel = String(lk.properties.edition.offer.rel || '').toLowerCase();
              if (offerRel.includes('open-access')) {
                const iaMatch = abs.match(/[?&]identifier=([^&]+)/i);
                if (iaMatch && !epubUrl) {
                  const iaId = decodeURIComponent(iaMatch[1]);
                  epubUrl = `https://archive.org/download/${encodeURIComponent(iaId)}/${encodeURIComponent(iaId)}.epub`;
                  fallbackUrl = `https://archive.org/download/${encodeURIComponent(iaId)}/${encodeURIComponent(iaId)}.pdf`;
                }
              }
            }
          });
          const best = epubUrl || cbzUrl || pdfUrl;
          if (best) {
            out.push({ title, author, coverUrl, downloadUrl: best, fallbackPdfUrl: fallbackUrl, format: epubUrl ? 'EPUB' : (cbzUrl ? 'CBZ' : 'PDF'), source: 'OPDS 2.0' });
          }
        });
        return out;
      }
      return parseOpdsAtomXml(rawText, baseUrl);
    }

    function getSelectedOpdsLangs() {
      const val = (document.getElementById('selectOpdsLang') && document.getElementById('selectOpdsLang').value) || 'pt-br,en';
      return val.split(',').filter(Boolean);
    }

    function pickLocalizedText(obj, langs = ['pt-br', 'pt', 'en']) {
      if (!obj || typeof obj !== 'object') return '';
      for (const l of langs) {
        if (obj[l]) return String(obj[l]);
      }
      const firstKey = Object.keys(obj)[0];
      return firstKey ? String(obj[firstKey]) : '';
    }

    function parseMangaDexMangaList(json) {
      const rows = (json && Array.isArray(json.data)) ? json.data : [];
      return rows.map(m => {
        const attr = m.attributes || {};
        const rels = Array.isArray(m.relationships) ? m.relationships : [];
        const covRel = rels.find(r => r.type === 'cover_art' && r.attributes && r.attributes.fileName);
        const covRaw = covRel ? `https://uploads.mangadex.org/covers/${m.id}/${covRel.attributes.fileName}.256.jpg` : '';
        const langsAvail = Array.isArray(attr.availableTranslatedLanguages) ? attr.availableTranslatedLanguages : [];
        const authorRel = rels.find(r => (r.type === 'author' || r.type === 'artist') && r.attributes && r.attributes.name);
        return {
          id: m.id,
          title: pickLocalizedText(attr.title, ['pt-br', 'pt', 'en', 'ja-ro']) || 'Mangá sem título',
          author: (authorRel && authorRel.attributes && authorRel.attributes.name) || 'MangaDex',
          coverUrl: covRaw,
          status: attr.status || '',
          langs: langsAvail.filter(x => x === 'pt-br' || x === 'pt' || x === 'en'),
          source: 'mangadex'
        };
      });
    }

    function parseMangaDexChaptersList(json) {
      const rows = (json && Array.isArray(json.data)) ? json.data : [];
      return rows
        .filter(c => c && c.attributes && ((c.attributes.pages || 0) > 0 || c.attributes.externalUrl))
        .map(c => {
          const attr = c.attributes;
          const rels = Array.isArray(c.relationships) ? c.relationships : [];
          const grp = rels.find(r => r.type === 'scanlation_group' && r.attributes && r.attributes.name);
          const chNum = attr.chapter ? `Cap. ${attr.chapter}` : 'One-shot';
          const volNum = attr.volume ? `Vol. ${attr.volume} · ` : '';
          const titlePart = attr.title ? ` — ${attr.title}` : '';
          return {
            id: c.id,
            label: `${volNum}${chNum}${titlePart}`,
            chapter: attr.chapter || '0',
            lang: (attr.translatedLanguage || 'en').toUpperCase(),
            pages: attr.pages || 0,
            externalUrl: attr.externalUrl || '',
            group: (grp && grp.attributes && grp.attributes.name) || ''
          };
        });
    }

    async function fetchValidImagePageBytes(imgUrl) {
      let lastErr = null;
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          const target = attempt === 0 ? imgUrl : `${imgUrl}${imgUrl.includes('?') ? '&' : '?'}r=${Date.now()}`;
          const buf = await fetchExternalBinary(target);
          const view = new Uint8Array(buf);
          if (view.length < 100) throw new Error('Imagem vazia ou incompleta');
          // Rejeitar se o servidor retornou JSON ({) ou HTML (<) de erro em vez de imagem
          if (view[0] === 0x7b || view[0] === 0x3c) throw new Error('Resposta inválida do servidor de imagens');
          return view;
        } catch (err) {
          lastErr = err;
        }
      }
      throw lastErr || new Error('Falha ao baixar imagem da página');
    }

    async function downloadMangaDexChapterAsCbz(chapterObj, { dataSaver = false, onProgress = null } = {}) {
      if (chapterObj.externalUrl) {
        throw new Error('Este capítulo está hospedado no site oficial da editora (link externo), não nos servidores do MangaDex.');
      }
      const srvRaw = await fetchExternalTextOrXml(`https://api.mangadex.org/at-home/server/${encodeURIComponent(chapterObj.id)}`);
      const srv = JSON.parse(srvRaw);
      if (!srv || !srv.baseUrl || !srv.chapter || !srv.chapter.hash) {
        throw new Error('Servidor de páginas do MangaDex não respondeu.');
      }
      const files = dataSaver && Array.isArray(srv.chapter.dataSaver) && srv.chapter.dataSaver.length
        ? srv.chapter.dataSaver
        : (srv.chapter.data || []);
      if (!files.length) throw new Error('Capítulo sem páginas disponíveis.');
      const qualityPath = (dataSaver && srv.chapter.dataSaver && srv.chapter.dataSaver.length) ? 'data-saver' : 'data';

      const zipFiles = new Array(files.length);
      const BATCH = 4;
      let done = 0;
      for (let i = 0; i < files.length; i += BATCH) {
        const chunk = files.slice(i, i + BATCH);
        await Promise.all(chunk.map(async (fname, offsetIdx) => {
          const idx = i + offsetIdx;
          const imgUrl = `${srv.baseUrl}/${qualityPath}/${srv.chapter.hash}/${fname}`;
          const view = await fetchValidImagePageBytes(imgUrl);
          const ext = (fname.split('.').pop() || 'jpg').toLowerCase().replace(/[^a-z0-9]/g, '') || 'jpg';
          const padded = String(idx + 1).padStart(4, '0');
          zipFiles[idx] = { path: `${padded}.${ext}`, content: view };
          done++;
          if (typeof onProgress === 'function') onProgress(done, files.length);
        }));
      }
      const cbzBlob = createZipBlob(zipFiles.filter(Boolean), 'application/vnd.comicbook+zip');
      return await cbzBlob.arrayBuffer();
    }

    // --- Web-Scrapers HTML (Standard Ebooks, WEBTOON, Generic HTML Extractor) + Modal Expandido ---
    function decodeHtmlEntities(str) {
      return String(str || '')
        .replace(/&amp;/gi, '&')
        .replace(/&lt;/gi, '<')
        .replace(/&gt;/gi, '>')
        .replace(/&quot;/gi, '"')
        .replace(/&#39;|&apos;/gi, "'")
        .replace(/&nbsp;/gi, ' ')
        .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(parseInt(n, 10)))
        .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCharCode(parseInt(h, 16)));
    }

    function stripHtmlTags(str) {
      return decodeHtmlEntities(String(str || '').replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
    }

    function parseStandardEbooksSearchHtml(html, baseUrl = 'https://standardebooks.org') {
      const out = [];
      const liRegex = /<li[^>]*typeof="schema:Book"[^>]*about="([^"]+)"[^>]*>([\s\S]*?)<\/li>/gi;
      let m;
      while ((m = liRegex.exec(html || '')) !== null) {
        const relPath = m[1];
        const block = m[2];
        const detailUrl = new URL(relPath, baseUrl).toString();
        const imgM = block.match(/<img[^>]+src="([^"]+)"/i);
        const coverUrl = imgM ? new URL(decodeHtmlEntities(imgM[1]), baseUrl).toString() : '';
        const nameMatches = [...block.matchAll(/<span[^>]*property="schema:name"[^>]*>([\s\S]*?)<\/span>/gi)];
        const title = nameMatches[0] ? stripHtmlTags(nameMatches[0][1]) : relPath.split('/').pop();
        const author = nameMatches.slice(1).map(x => stripHtmlTags(x[1])).filter(Boolean).join(', ') || 'Standard Ebooks';
        if (title) {
          out.push({ title, author, coverUrl, detailUrl, format: 'EPUB', lang: 'EN', source: 'Standard Ebooks (Scrape)' });
        }
      }
      return out;
    }

    function parseStandardEbooksDetailHtml(html, baseUrl = 'https://standardebooks.org') {
      const descSec = (html.match(/id="description"[\s\S]*?<\/section>/i) || [])[0] || '';
      const description = stripHtmlTags(descSec).replace(/^Description\s*/i, '');
      const epubMatch = html.match(/href="([^"]+\.epub[^"]*)"/i);
      let epubUrl = '';
      if (epubMatch) {
        epubUrl = new URL(decodeHtmlEntities(epubMatch[1]), baseUrl).toString();
        if (!/source=download/i.test(epubUrl)) epubUrl += (epubUrl.includes('?') ? '&' : '?') + 'source=download';
      }
      const tags = [...html.matchAll(/href="\/subjects\/[^"]+"[^>]*>([\s\S]*?)<\/a>/gi)].map(x => stripHtmlTags(x[1])).filter(Boolean).slice(0, 12);
      const ogImg = (html.match(/property="og:image"[^>]+content="([^"]+)"/i) || [])[1] || '';
      const wcMatch = html.match(/([\d,]+)\s+words/i);
      return {
        description: description || 'Edição pública gratuita e diagramada manualmente pelo Standard Ebooks.',
        epubUrl,
        tags,
        coverUrl: ogImg ? new URL(decodeHtmlEntities(ogImg), baseUrl).toString() : '',
        wordCount: wcMatch ? `${wcMatch[1]} palavras` : ''
      };
    }

    function parseWebtoonSearchHtml(html, baseUrl = 'https://www.webtoons.com') {
      const out = [];
      const seen = new Set();
      const itemRegex = /<a[^>]+href="([^"]*\/list\?title_no=(\d+)[^"]*)"[^>]*>([\s\S]*?)<\/a>/gi;
      let m;
      while ((m = itemRegex.exec(html || '')) !== null) {
        const detailUrl = new URL(decodeHtmlEntities(m[1]), baseUrl).toString();
        const titleNo = m[2];
        if (seen.has(titleNo)) continue;
        seen.add(titleNo);
        const inner = m[3];
        const imgM = inner.match(/<img[^>]+src="([^"]+)"/i);
        const titleM = inner.match(/class="(?:title|subj)[^"]*"[^>]*>([\s\S]*?)<\/(?:strong|p|div|span)>/i);
        const authorM = inner.match(/class="author[^"]*"[^>]*>([\s\S]*?)<\/div>/i);
        const viewsM = inner.match(/class="(?:view_count|grade_num)[^"]*"[^>]*>([\s\S]*?)<\/(?:div|em|span)>/i);
        const title = titleM ? stripHtmlTags(titleM[1]) : `WEBTOON #${titleNo}`;
        const author = authorM ? stripHtmlTags(authorM[1]) : 'WEBTOON';
        const coverRaw = imgM ? decodeHtmlEntities(imgM[1]) : '';
        out.push({
          titleNo,
          title,
          author,
          views: viewsM ? stripHtmlTags(viewsM[1]) : '',
          coverUrl: coverRaw,
          detailUrl,
          lang: /canvas/i.test(detailUrl) ? 'GLOBAL' : 'EN',
          source: 'WEBTOON (Scrape)'
        });
      }
      return out;
    }

    function parseWebtoonSeriesHtml(html, baseUrl = 'https://www.webtoons.com') {
      const summary = stripHtmlTags((html.match(/class="summary"[^>]*>([\s\S]*?)<\/p>/i) || [])[1] || '');
      const author = stripHtmlTags((html.match(/class="author_area"[^>]*>([\s\S]*?)<\/div>/i) || [])[1] || '').replace(/author info$/i, '').trim();
      const genre = stripHtmlTags((html.match(/class="genre[^"]*"[^>]*>([\s\S]*?)<\//i) || [])[1] || '');
      const ogImg = (html.match(/property="og:image"[^>]+content="([^"]+)"/i) || [])[1] || '';
      const episodes = [];
      const epRegex = /id="episode_(\d+)"[\s\S]{0,1200}?href="([^"]+episode_no=\d+[^"]*)"[\s\S]{0,700}?class="subj"[^>]*><span>([\s\S]*?)<\/span>/gi;
      let m;
      while ((m = epRegex.exec(html || '')) !== null) {
        episodes.push({
          epNo: m[1],
          url: new URL(decodeHtmlEntities(m[2]), baseUrl).toString(),
          label: stripHtmlTags(m[3]) || `Episódio ${m[1]}`
        });
      }
      const nextM = html.match(/class="pg_next"[^>]*href="([^"]+)"/i) || html.match(/href="([^"]*&amp;page=\d+[^"]*)"[^>]*>\s*<span class="blind">Next/i);
      const nextPageUrl = nextM && nextM[1] !== '#' ? new URL(decodeHtmlEntities(nextM[1]), baseUrl).toString() : '';
      return { summary, author, genre, coverUrl: ogImg ? decodeHtmlEntities(ogImg) : '', episodes, nextPageUrl };
    }

    function parseWebtoonViewerImagesHtml(html) {
      const block = (html.match(/id="_imageList"([\s\S]*?)<\/div>/i) || [])[1] || html || '';
      return [...block.matchAll(/data-url="(https?:\/\/[^"]+)"/gi)].map(m => decodeHtmlEntities(m[1]));
    }

    async function downloadWebtoonEpisodeAsCbz(epUrl, { onProgress = null } = {}) {
      const html = await fetchExternalTextOrXml(epUrl);
      const imgUrls = parseWebtoonViewerImagesHtml(html);
      if (!imgUrls.length) throw new Error('Nenhuma imagem de página encontrada neste episódio do WEBTOON.');
      const zipFiles = new Array(imgUrls.length);
      const BATCH = 4;
      let done = 0;
      for (let i = 0; i < imgUrls.length; i += BATCH) {
        const chunk = imgUrls.slice(i, i + BATCH);
        await Promise.all(chunk.map(async (u, off) => {
          const idx = i + off;
          const bytes = await fetchValidImagePageBytes(u);
          const extMatch = u.split('?')[0].match(/\.(jpg|jpeg|png|webp)$/i);
          const ext = extMatch ? extMatch[1].toLowerCase() : 'jpg';
          zipFiles[idx] = { path: `${String(idx + 1).padStart(4, '0')}.${ext}`, content: bytes };
          done++;
          if (typeof onProgress === 'function') onProgress(done, imgUrls.length);
        }));
      }
      const cbzBlob = createZipBlob(zipFiles.filter(Boolean), 'application/vnd.comicbook+zip');
      return await cbzBlob.arrayBuffer();
    }

    function parseGenericScrapePageHtml(html, pageUrl) {
      const titleM = html.match(/<meta[^>]+property="og:title"[^>]+content="([^"]+)"/i) || html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
      const descM = html.match(/<meta[^>]+(?:name="description"|property="og:description")[^>]+content="([^"]+)"/i);
      const imgM = html.match(/<meta[^>]+property="og:image"[^>]+content="([^"]+)"/i);
      const pageTitle = titleM ? stripHtmlTags(titleM[1]) : pageUrl;
      const description = descM ? stripHtmlTags(descM[1]) : '';
      let coverUrl = '';
      if (imgM) { try { coverUrl = new URL(decodeHtmlEntities(imgM[1]), pageUrl).toString(); } catch {} }

      const ebookLinks = [];
      const seenLinks = new Set();
      const linkRx = /<a[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
      let lm;
      while ((lm = linkRx.exec(html || '')) !== null) {
        let abs = '';
        try { abs = new URL(decodeHtmlEntities(lm[1]), pageUrl).toString(); } catch { continue; }
        if (!/^https?:/i.test(abs) || seenLinks.has(abs)) continue;
        if (/\.(epub|pdf|cbz|mobi|azw3|fb2)(\?|$)/i.test(abs)) {
          seenLinks.add(abs);
          const ext = abs.split('?')[0].split('.').pop().toUpperCase();
          ebookLinks.push({ label: stripHtmlTags(lm[2]) || abs.split('/').pop(), url: abs, format: ext });
        }
      }

      const imageLinks = [];
      const seenImgs = new Set();
      const imgRx = /<img[^>]+(?:data-src|data-url|src)="([^"]+)"/gi;
      let im;
      while ((im = imgRx.exec(html || '')) !== null) {
        let abs = '';
        try { abs = new URL(decodeHtmlEntities(im[1]), pageUrl).toString(); } catch { continue; }
        if (!/^https?:/i.test(abs) || seenImgs.has(abs)) continue;
        if (/(?:avatar|logo|icon|favicon|emoji|spinner|badge|pixel|1x1)/i.test(abs)) continue;
        if (/\.(jpe?g|png|webp)(\?|$)/i.test(abs) || /pstatic\.net|mangadex|uploads/i.test(abs)) {
          seenImgs.add(abs);
          imageLinks.push(abs);
        }
      }

      const mainBlock = (html.match(/<(?:article|main)\b[^>]*>([\s\S]*?)<\/(?:article|main)>/i) || html.match(/<body\b[^>]*>([\s\S]*?)<\/body>/i) || [html, html])[1];
      const cleanedBody = mainBlock
        .replace(/<(script|style|nav|header|footer|aside|noscript)\b[\s\S]*?<\/\1>/gi, '')
        .trim();
      const articleTextLen = stripHtmlTags(cleanedBody).length;

      return { pageTitle, description, coverUrl, ebookLinks, imageLinks, cleanedBody, articleTextLen };
    }

    function parseTapasSearchHtml(html, baseUrl = 'https://tapas.io') {
      const out = [];
      const seen = new Set();
      const blocks = String(html || '').split(/class="[^"]*search-item-wrap[^"]*"/i).slice(1);
      blocks.forEach(blk => {
        const hrefM = blk.match(/href="(\/series\/[^"/?]+)"/i);
        if (!hrefM) return;
        const seriesPath = hrefM[1];
        if (seen.has(seriesPath)) return;
        seen.add(seriesPath);
        const sidM = blk.match(/data-series-id="(\d+)"/i);
        const imgM = blk.match(/<img[^>]+src="([^"]+)"/i);
        const altM = blk.match(/<img[^>]+alt="([^"]*)"/i);
        const titleLinkM = blk.match(/class="[^"]*\btitle\b[^"]*"[^>]*>([\s\S]*?)<\/a>/i) || blk.match(/class="title-section"[\s\S]{0,400}?<a[^>]*>([\s\S]*?)<\/a>/i);
        const authorM = blk.match(/class="[^"]*\bauthor\b[^"]*"[^>]*>([\s\S]*?)<\/(?:a|span|p|div)>/i);
        const rawTitle = (titleLinkM && titleLinkM[1]) || (altM && altM[1]) || seriesPath.replace(/^\/series\//, '').replace(/-/g, ' ');
        const cleanTitle = stripHtmlTags(rawTitle).replace(/#_?highlight#|#\/_?highlight#|#_h_i_g_h_L_i_g_h_t_#|#\/_h_i_g_h_L_i_g_h_t_#/gi, '').replace(/\s+/g, ' ').trim();
        out.push({
          seriesId: sidM ? sidM[1] : '',
          seriesPath,
          title: cleanTitle || seriesPath.replace(/^\/series\//, ''),
          author: authorM ? stripHtmlTags(authorM[1]) : 'Tapas',
          coverUrl: imgM ? decodeHtmlEntities(imgM[1]) : '',
          detailUrl: new URL(seriesPath + '/info', baseUrl).toString(),
          source: 'Tapas (Scrape)'
        });
      });
      return out;
    }

    function parseTapasInfoHtml(html) {
      const sidM = String(html || '').match(/seriesId\s*[:=]\s*(\d+)|data-series-id="(\d+)"|tapastic:\/\/series\/(\d+)/i);
      const seriesId = sidM ? (sidM[1] || sidM[2] || sidM[3]) : '';
      const descM = String(html || '').match(/class="[^"]*description__body[^"]*"[^>]*>([\s\S]*?)<\/(?:span|p|div)>/i);
      const genreUlM = String(html || '').match(/detail-row__body--genre[\s\S]*?<\/ul>/i);
      const genres = genreUlM
        ? [...genreUlM[0].matchAll(/<li[^>]*>([\s\S]*?)<\/li>/gi)].map(x => stripHtmlTags(x[1])).filter(Boolean)
        : [];
      const creatorM = String(html || '').match(/class="[^"]*creator-section__name[^"]*"[^>]*>([\s\S]*?)<\//i) || String(html || '').match(/name="author"[^>]+content="([^"]+)"/i);
      const ogImgM = String(html || '').match(/property="og:image"[^>]+content="([^"]+)"/i);
      return {
        seriesId,
        description: descM ? stripHtmlTags(descM[1]) : '',
        genres,
        author: creatorM ? stripHtmlTags(creatorM[1]) : '',
        coverUrl: ogImgM ? decodeHtmlEntities(ogImgM[1]) : ''
      };
    }

    function parseTapasEpisodesBodyHtml(bodyHtml, baseUrl = 'https://tapas.io') {
      const out = [];
      const chunks = String(bodyHtml || '').split(/<li\b/i).slice(1);
      chunks.forEach(ch => {
        const hrefM = ch.match(/data-href="(\/episode\/\d+)"/i) || ch.match(/href="(\/episode\/\d+)"/i);
        if (!hrefM) return;
        const locked = /locked|free-to-read--false|sp-ico-lock|coin/i.test(ch);
        const titleM = ch.match(/class="[^"]*title__link[^"]*"[^>]*>([\s\S]*?)<\/(?:a|span|p)>/i) || ch.match(/class="[^"]*\btitle\b[^"]*"[^>]*>([\s\S]*?)<\/(?:p|span|a)>/i);
        const epNumM = ch.match(/class="[^"]*scene[^"]*"[^>]*>([\s\S]*?)<\/span>/i);
        const label = stripHtmlTags((titleM && titleM[1]) || '') || hrefM[1].replace('/episode/', 'Ep. ');
        const prefix = epNumM ? `${stripHtmlTags(epNumM[1])} · ` : '';
        out.push({
          url: new URL(hrefM[1], baseUrl).toString(),
          label: `${prefix}${label}`,
          locked
        });
      });
      return out;
    }

    function parseTapasViewerImagesHtml(html) {
      const urls = [];
      const seen = new Set();
      const rx = /<img[^>]+class="[^"]*content__img[^"]*"[^>]+(?:data-src|src)="([^"]+)"|<img[^>]+data-src="(https:\/\/[^"]*tapas\.io\/[^"]+)"/gi;
      let m;
      while ((m = rx.exec(String(html || ''))) !== null) {
        const u = decodeHtmlEntities(m[1] || m[2] || '');
        if (!u || seen.has(u) || /\/sa\/|_m\.(jpg|png)/i.test(u)) continue;
        seen.add(u);
        urls.push(u);
      }
      return urls;
    }

    async function downloadTapasEpisodeAsCbz(epUrl, { onProgress = null } = {}) {
      const html = await fetchExternalTextOrXml(epUrl);
      const imgUrls = parseTapasViewerImagesHtml(html);
      if (!imgUrls.length) throw new Error('Nenhuma página de imagem aberta encontrada neste episódio do Tapas.');
      const zipFiles = new Array(imgUrls.length);
      const BATCH = 4;
      let done = 0;
      for (let i = 0; i < imgUrls.length; i += BATCH) {
        const chunk = imgUrls.slice(i, i + BATCH);
        await Promise.all(chunk.map(async (u, off) => {
          const idx = i + off;
          const bytes = await fetchValidImagePageBytes(u);
          const extMatch = u.split('?')[0].match(/\.(jpg|jpeg|png|webp)$/i);
          const ext = extMatch ? extMatch[1].toLowerCase() : 'jpg';
          zipFiles[idx] = { path: `${String(idx + 1).padStart(4, '0')}.${ext}`, content: bytes };
          done++;
          if (typeof onProgress === 'function') onProgress(done, imgUrls.length);
        }));
      }
      const cbzBlob = createZipBlob(zipFiles.filter(Boolean), 'application/vnd.comicbook+zip');
      return await cbzBlob.arrayBuffer();
    }

    function proxiedImgSrc(url) {
      if (!url) return '';
      if (url.startsWith('data:') || url.startsWith('blob:')) return url;
      if (location.protocol.startsWith('http') && /(?:mangadex|pstatic\.net|webtoons\.com|tapas\.io|dynasty-scans)/i.test(url)) {
        return `/api/opds-proxy?url=${encodeURIComponent(url)}`;
      }
      return url;
    }

    function attachCatalogBatchControls({ chCtrls, chList, getSelectedItems, onBatchDownload }) {
      if (!chCtrls || !chList) return;
      const selAllBtn = document.createElement('button');
      selAllBtn.className = 'btn';
      selAllBtn.style.height = '24px';
      selAllBtn.textContent = 'Selecionar Todos';
      let allChecked = false;
      selAllBtn.addEventListener('click', () => {
        allChecked = !allChecked;
        chList.querySelectorAll('.batch-ch-chk').forEach(chk => { chk.checked = allChecked; });
        selAllBtn.textContent = allChecked ? 'Desmarcar Todos' : 'Selecionar Todos';
      });
      const batchBtn = document.createElement('button');
      batchBtn.className = 'btn primary';
      batchBtn.style.height = '24px';
      batchBtn.textContent = 'Baixar Selecionados (.CBZ)';
      batchBtn.addEventListener('click', async () => {
        const picked = getSelectedItems();
        if (!picked.length) {
          alert('Marque pelo menos um capítulo disponível com a caixinha à esquerda.');
          return;
        }
        await onBatchDownload(picked);
      });
      chCtrls.appendChild(selAllBtn);
      chCtrls.appendChild(batchBtn);
    }

    function openCatalogDetailModal(spec) {
      const modal = document.getElementById('catalogDetailModal');
      if (!modal) return;
      const covEl = document.getElementById('catalogDetailCover');
      const badgesEl = document.getElementById('catalogDetailBadges');
      const titleEl = document.getElementById('catalogDetailTitle');
      const authorEl = document.getElementById('catalogDetailAuthor');
      const tagsEl = document.getElementById('catalogDetailTags');
      const actEl = document.getElementById('catalogDetailPrimaryActions');
      const descEl = document.getElementById('catalogDetailDesc');
      const chWrap = document.getElementById('catalogDetailChaptersWrap');
      const chLabel = document.getElementById('catalogDetailChaptersLabel');
      const chCtrls = document.getElementById('catalogDetailChaptersControls');
      const chList = document.getElementById('catalogDetailChapters');
      const statusEl = document.getElementById('catalogDetailStatus');

      const covProxy = proxiedImgSrc(spec.coverUrl || '');
      if (covEl) {
        covEl.innerHTML = covProxy
          ? `<img src="${escapeHtml(covProxy)}" alt="" />`
          : `<span>${escapeHtml(spec.format || spec.source || 'OBRA')}</span>`;
      }
      if (titleEl) titleEl.textContent = spec.title || 'Sem título';
      if (authorEl) authorEl.textContent = spec.author || '';
      if (badgesEl) {
        badgesEl.innerHTML = [spec.source, spec.format, spec.lang, spec.status, spec.year]
          .filter(Boolean)
          .map(b => `<span class="book-badge">${escapeHtml(String(b))}</span>`)
          .join('');
      }
      if (tagsEl) {
        tagsEl.innerHTML = (spec.tags || [])
          .map(t => `<span class="catalog-tag-pill">${escapeHtml(t)}</span>`)
          .join('');
      }
      if (descEl) descEl.textContent = spec.description || 'Carregando sinopse e detalhes completos...';
      if (actEl) actEl.innerHTML = '';
      if (chCtrls) chCtrls.innerHTML = '';
      if (chList) chList.innerHTML = '';
      if (chWrap) chWrap.classList.toggle('hidden', spec.hideChaptersSection === true);
      if (chLabel) chLabel.textContent = spec.chaptersHeading || 'Capítulos / Arquivos Disponíveis';
      if (statusEl) statusEl.textContent = spec.source || 'Pronto';

      if (typeof spec.onRender === 'function') {
        spec.onRender({ covEl, badgesEl, authorEl, tagsEl, actEl, descEl, chWrap, chLabel, chCtrls, chList, statusEl });
      }
      const btnFollowEl = document.getElementById('btnFollowCatalogSeries');
      if (btnFollowEl) {
        const seriesKey = spec.seriesId || spec.id || spec.title || '';
        const isFollowable = Boolean(seriesKey && /mangadex|webtoon|tapas/i.test(String(spec.source || '')));
        btnFollowEl.classList.toggle('hidden', !isFollowable);
        if (isFollowable) {
          const updateFollowBtn = () => {
            const list = getFollowedSeriesList();
            const exists = list.some(s => s.key === seriesKey);
            btnFollowEl.textContent = exists ? '✓ Seguindo Série' : '★ Seguir Série';
            btnFollowEl.classList.toggle('tb-btn-solid', exists);
          };
          updateFollowBtn();
          btnFollowEl.onclick = () => {
            let list = getFollowedSeriesList();
            if (list.some(s => s.key === seriesKey)) {
              list = list.filter(s => s.key !== seriesKey);
              showToast('Série removida do Radar.');
            } else {
              list.push({ key: seriesKey, title: spec.title || 'Série', source: spec.source || '', url: spec.url || '', lastKnownCount: 0, checkedAt: Date.now() });
              showToast('Série adicionada ao Radar de Atualizações!');
            }
            saveFollowedSeriesList(list);
            updateFollowBtn();
          };
        }
      }
      modal.classList.add('open');
    }

    const catDetailMod = document.getElementById('catalogDetailModal');
    const closeCatDetail = () => { if (catDetailMod) catDetailMod.classList.remove('open'); };
    const btnCloseCatEl = document.getElementById('btnCloseCatalogDetail');
    const btnBackCatEl = document.getElementById('btnBackCatalogDetail');
    const btnFootBackCatEl = document.getElementById('btnFooterBackCatalogDetail');
    if (btnCloseCatEl) btnCloseCatEl.addEventListener('click', closeCatDetail);
    if (btnBackCatEl) btnBackCatEl.addEventListener('click', closeCatDetail);
    if (btnFootBackCatEl) btnFootBackCatEl.addEventListener('click', closeCatDetail);
    if (catDetailMod) {
      catDetailMod.addEventListener('click', (e) => {
        if (e.target === catDetailMod) closeCatDetail();
      });
    }

    const opdsSourceSel = document.getElementById('selectOpdsSource');
    const opdsCustomIn = document.getElementById('inputOpdsCustomUrl');
    const opdsLangSel = document.getElementById('selectOpdsLang');
    const opdsDataWrap = document.getElementById('lblOpdsDataSaverWrap');
    const opdsQueryIn = document.getElementById('inputOpdsQuery');
    function syncOpdsFilterControls() {
      if (!opdsSourceSel) return;
      const v = opdsSourceSel.value;
      const showUrlBox = (v === 'custom' || v === 'web-scrape-url');
      if (opdsCustomIn) {
        opdsCustomIn.classList.toggle('hidden', !showUrlBox);
        opdsCustomIn.placeholder = v === 'web-scrape-url'
          ? 'Cole a URL da página HTML para extrair livros/imagens (https://...)'
          : 'URL do feed OPDS (https://.../opds)';
      }
      if (opdsQueryIn) {
        opdsQueryIn.classList.toggle('hidden', v === 'web-scrape-url');
      }
      if (opdsLangSel) opdsLangSel.classList.toggle('hidden', v === 'gutenberg-opds' || v === 'custom' || v === 'standardebooks-scrape' || v === 'web-scrape-url');
      if (opdsDataWrap) opdsDataWrap.classList.toggle('hidden', v !== 'mangadex');
    }
    if (opdsSourceSel) {
      opdsSourceSel.addEventListener('change', syncOpdsFilterControls);
      syncOpdsFilterControls();
    }

    async function searchPublicOpdsCatalog() {
      const srcType = (document.getElementById('selectOpdsSource') && document.getElementById('selectOpdsSource').value) || 'mangadex';
      const query = (document.getElementById('inputOpdsQuery') && document.getElementById('inputOpdsQuery').value.trim()) || '';
      const customUrl = (document.getElementById('inputOpdsCustomUrl') && document.getElementById('inputOpdsCustomUrl').value.trim()) || '';
      const langs = getSelectedOpdsLangs();
      const dataSaver = Boolean(document.getElementById('chkOpdsDataSaver') && document.getElementById('chkOpdsDataSaver').checked);
      const statusEl = document.getElementById('lblOpdsStatus');
      const gridEl = document.getElementById('opdsResultsGrid');
      if (!gridEl || !statusEl) return;

      statusEl.textContent = srcType === 'mangadex' || srcType === 'archive-manga'
        ? 'Pesquisando catálogo de mangás...'
        : 'Pesquisando acervo público...';
      gridEl.innerHTML = '';

      try {
        if (srcType === 'mangadex') {
          if (!location.protocol.startsWith('http')) {
            throw new Error('O catálogo MangaDex exige rodar pela URL hospedada (Vercel/Netlify) por causa do proxy CORS.');
          }
          const langParams = langs.map(l => `availableTranslatedLanguage[]=${encodeURIComponent(l)}`).join('&');
          const titleParam = query ? `&title=${encodeURIComponent(query)}` : '&order[followedCount]=desc';
          let mdOffset = 0;
          const MD_PAGE_LIMIT = 24;

          const renderMangaDexBatch = async (append) => {
            const mdUrl = `https://api.mangadex.org/manga?limit=${MD_PAGE_LIMIT}&offset=${mdOffset}${titleParam}&${langParams}&includes[]=cover_art&includes[]=author&contentRating[]=safe&contentRating[]=suggestive`;
            const raw = await fetchExternalTextOrXml(mdUrl);
            const parsedJson = JSON.parse(raw);
            const totalMangas = parsedJson.total || 0;
            const mangas = parseMangaDexMangaList(parsedJson);
            if (!append) gridEl.innerHTML = '';
            const oldMore = gridEl.querySelector('.btn-load-more-md');
            if (oldMore) oldMore.remove();

            if (!mangas.length && !append) {
              statusEl.textContent = 'Nenhum mangá encontrado no MangaDex para esse termo/idioma (tente buscar pelo título sem erros de grafia, ex: "jujutsu kaisen").';
              return;
            }
            const shownNow = Math.min(totalMangas || (mdOffset + mangas.length), mdOffset + mangas.length);
            statusEl.textContent = `Mostrando ${shownNow} de ${totalMangas || shownNow} mangá(s) encontrado(s). Clique em "Ver Capítulos" para listar todos:`;

            mangas.forEach(m => {
              const card = document.createElement('div');
              card.className = 'opds-card';
              card.style.flexDirection = 'column';
              const covSrc = m.coverUrl ? `/api/opds-proxy?url=${encodeURIComponent(m.coverUrl)}` : '';
              card.innerHTML = `
                <div style="display:flex; gap:10px; width:100%; align-items:flex-start;">
                  <div class="opds-cover">
                    ${covSrc ? `<img src="${escapeHtml(covSrc)}" alt="" loading="lazy" />` : '<span>MANGÁ</span>'}
                  </div>
                  <div style="flex:1; min-width:0; display:flex; flex-direction:column; gap:4px;">
                    <div style="font-size:12px; font-weight:600; color:var(--text-primary); display:-webkit-box; -webkit-line-clamp:2; -webkit-box-orient:vertical; overflow:hidden;">${escapeHtml(m.title)}</div>
                    <div style="font-size:11px; color:var(--text-secondary); white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${escapeHtml(m.author)}${m.langs.length ? ' · ' + escapeHtml(m.langs.join('/').toUpperCase()) : ''}</div>
                    <div style="margin-top:4px; display:flex; gap:4px; flex-wrap:wrap;">
                      <button class="btn primary btn-md-chapters" style="height:24px; font-size:11px; padding:0 8px;">Capítulos</button>
                      <button class="btn btn-md-expand" style="height:24px; font-size:11px; padding:0 8px;" title="Abrir ficha completa, sinopse, tags e lista ampla de capítulos">Expandir ⤢</button>
                    </div>
                  </div>
                </div>
                <div class="md-chapters-box hidden" style="width:100%; margin-top:8px; padding-top:8px; border-top:1px solid var(--border-color); display:flex; flex-direction:column; gap:5px; max-height:240px; overflow-y:auto;"></div>
              `;

              const chBox = card.querySelector('.md-chapters-box');
              const chBtn = card.querySelector('.btn-md-chapters');
              let chOffset = 0;
              let chOrder = 'asc';
              let chTotal = 0;

              const loadMangaChaptersBatch = async (resetList) => {
                if (resetList) {
                  chOffset = 0;
                  chBox.innerHTML = '<div style="font-size:11px; color:var(--text-muted);">Buscando todos os capítulos...</div>';
                }
                const feedLangs = langs.map(l => `translatedLanguage[]=${encodeURIComponent(l)}`).join('&');
                const feedUrl = `https://api.mangadex.org/manga/${encodeURIComponent(m.id)}/feed?limit=100&offset=${chOffset}&${feedLangs}&contentRating[]=safe&contentRating[]=suggestive&order[volume]=${chOrder}&order[chapter]=${chOrder}&includes[]=scanlation_group`;
                const feedRaw = await fetchExternalTextOrXml(feedUrl);
                const feedJson = JSON.parse(feedRaw);
                chTotal = feedJson.total || 0;
                const chapters = parseMangaDexChaptersList(feedJson);

                if (resetList) {
                  chBox.innerHTML = '';
                  const hdrBar = document.createElement('div');
                  hdrBar.className = 'md-ch-header';
                  hdrBar.style.cssText = 'display:flex; justify-content:space-between; align-items:center; gap:6px; font-size:10.5px; color:var(--text-secondary); padding-bottom:4px;';
                  hdrBar.innerHTML = `
                    <span class="md-ch-counter">Carregando...</span>
                    <button class="btn btn-ch-sort" style="height:20px; font-size:10px; padding:0 6px;">Ordem: ${chOrder === 'asc' ? 'Cap. 1 → Fim' : 'Recentes → 1'}</button>
                  `;
                  hdrBar.querySelector('.btn-ch-sort').addEventListener('click', () => {
                    chOrder = chOrder === 'asc' ? 'desc' : 'asc';
                    loadMangaChaptersBatch(true).catch(() => {});
                  });
                  chBox.appendChild(hdrBar);
                }

                const oldBtnMore = chBox.querySelector('.btn-ch-load-more');
                if (oldBtnMore) oldBtnMore.remove();

                if (!chapters.length && chOffset === 0) {
                  const emptyDiv = document.createElement('div');
                  emptyDiv.style.cssText = 'font-size:11px; color:var(--text-muted);';
                  emptyDiv.textContent = 'Nenhum capítulo encontrado em PT-BR/EN para este título.';
                  chBox.appendChild(emptyDiv);
                  chBox.dataset.loaded = '1';
                  return;
                }

                chapters.forEach(ch => {
                  const row = document.createElement('div');
                  row.style.cssText = 'display:flex; justify-content:space-between; align-items:center; gap:6px; padding:4px 6px; border:1px solid var(--border-color); border-radius:4px; background:var(--bg-toolbar); font-size:11px;';
                  if (ch.externalUrl && /^https?:\/\//i.test(ch.externalUrl)) {
                    row.innerHTML = `
                      <div style="flex:1; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;" title="Capítulo licenciado no site oficial externo (${escapeHtml(ch.externalUrl)})">
                        <strong style="color:var(--accent);">[${escapeHtml(ch.lang)}]</strong> ${escapeHtml(ch.label)} <span style="color:var(--text-muted);">(Oficial)</span>
                      </div>
                      <a class="btn" href="${escapeHtml(ch.externalUrl)}" target="_blank" rel="noopener noreferrer" style="height:22px; font-size:10.5px; padding:0 8px; display:inline-flex; align-items:center; text-decoration:none;">Site Oficial ↗</a>
                    `;
                    chBox.appendChild(row);
                    return;
                  }
                  row.innerHTML = `
                    <div style="flex:1; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;" title="${escapeHtml(ch.label)}${ch.group ? ' · ' + escapeHtml(ch.group) : ''}">
                      <strong style="color:var(--accent);">[${escapeHtml(ch.lang)}]</strong> ${escapeHtml(ch.label)} <span style="color:var(--text-muted);">(${ch.pages} pág)</span>
                    </div>
                    <div style="display:flex; gap:4px; flex-shrink:0;">
                      <button class="btn primary btn-ch-read" style="height:22px; font-size:10.5px; padding:0 6px;">Ler</button>
                      <button class="btn btn-ch-dl" style="height:22px; font-size:10.5px; padding:0 6px;">.CBZ</button>
                      <button class="btn btn-ch-cloud" style="height:22px; font-size:10.5px; padding:0 6px;">+Nuvem</button>
                    </div>
                  `;
                  const runChapterAction = async (mode) => {
                    const baseSlug = `${m.title}_Cap_${ch.chapter}_${ch.lang}`.replace(/[^a-zA-Z0-9._-]+/g, '_').slice(0, 64);
                    const fileName = `${baseSlug}.cbz`;
                    showToast(`Baixando ${m.title} (${ch.label})...`);
                    try {
                      const cbzBuf = await downloadMangaDexChapterAsCbz(ch, {
                        dataSaver,
                        onProgress: (cur, tot) => {
                          const msg = `Páginas: ${cur}/${tot}`;
                          if (dom.statusLeft) dom.statusLeft.textContent = `Baixando mangá: ${msg}...`;
                          showFloatingDownloadProgress(`${m.title} — ${ch.label}`, msg, (cur / Math.max(1, tot)) * 100);
                        }
                      });
                      hideFloatingDownloadProgress();
                      if (mode === 'download') {
                        const url = URL.createObjectURL(new Blob([cbzBuf], { type: 'application/vnd.comicbook+zip' }));
                        const a = document.createElement('a');
                        a.href = url;
                        a.download = fileName;
                        a.click();
                        setTimeout(() => URL.revokeObjectURL(url), 2500);
                        showToast(`.CBZ "${fileName}" baixado!`);
                        return;
                      }
                      await loadFile({ name: fileName, size: cbzBuf.byteLength, buffer: cbzBuf });
                      if (covSrc) {
                        resizeImageSrcToCoverThumb(covSrc, 260, 390).then(thumb => {
                          if (thumb && state.bookKey) saveBookCoverDataUrl(state.bookKey, safeCloudFileName(fileName), thumb);
                        }).catch(() => {});
                      }
                      if (mode === 'cloud') {
                        await uploadBookRecordToCloud({
                          bookKey: state.bookKey,
                          fileName,
                          title: `${m.title} — ${ch.label}`,
                          author: m.author,
                          format: 'CBZ',
                          size: cbzBuf.byteLength,
                          totalSections: state.sections.length,
                          buffer: cbzBuf
                        });
                      }
                    } catch (err) {
                      hideFloatingDownloadProgress();
                      if (err && err.name !== 'AbortError') alert(`Erro ao baixar capítulo: ${err.message}`);
                    }
                  };
                  row.querySelector('.btn-ch-read').addEventListener('click', () => runChapterAction('read'));
                  row.querySelector('.btn-ch-dl').addEventListener('click', () => runChapterAction('download'));
                  row.querySelector('.btn-ch-cloud').addEventListener('click', () => runChapterAction('cloud'));
                  chBox.appendChild(row);
                });

                const loadedSoFar = chOffset + (feedJson.data ? feedJson.data.length : chapters.length);
                const cntEl = chBox.querySelector('.md-ch-counter');
                if (cntEl) cntEl.textContent = `Exibindo ${Math.min(chTotal || loadedSoFar, loadedSoFar)} de ${chTotal || loadedSoFar} capítulo(s)`;
                if (chTotal > loadedSoFar) {
                  const moreBtn = document.createElement('button');
                  moreBtn.className = 'btn btn-ch-load-more';
                  moreBtn.style.cssText = 'width:100%; height:24px; font-size:11px; margin-top:2px;';
                  moreBtn.textContent = `Carregar mais capítulos (${chTotal - loadedSoFar} restantes)`;
                  moreBtn.addEventListener('click', () => {
                    chOffset += 100;
                    loadMangaChaptersBatch(false).catch(() => {});
                  });
                  chBox.appendChild(moreBtn);
                }
                chBox.dataset.loaded = '1';
              };

              chBtn.addEventListener('click', async () => {
                if (!chBox.classList.contains('hidden')) {
                  chBox.classList.add('hidden');
                  chBtn.textContent = 'Capítulos';
                  return;
                }
                chBox.classList.remove('hidden');
                chBtn.textContent = 'Ocultar Capítulos';
                if (chBox.dataset.loaded === '1') return;
                try {
                  await loadMangaChaptersBatch(true);
                } catch (err) {
                  chBox.innerHTML = `<div style="font-size:11px; color:#ef4444;">Erro ao listar capítulos: ${escapeHtml(err.message)}</div>`;
                }
              });
              card.querySelector('.btn-md-expand').addEventListener('click', () => {
                openCatalogDetailModal({
                  title: m.title,
                  author: m.author,
                  coverUrl: m.coverUrl ? m.coverUrl.replace('.256.jpg', '.512.jpg') : '',
                  source: 'MangaDex',
                  status: m.status,
                  lang: m.langs.join('/').toUpperCase(),
                  chaptersHeading: 'Lista Completa de Capítulos (PT-BR / EN)',
                  onRender: async ({ badgesEl, tagsEl, descEl, chCtrls, chList, statusEl, actEl }) => {
                    const extLink = document.createElement('a');
                    extLink.className = 'btn';
                    extLink.href = `https://mangadex.org/title/${encodeURIComponent(m.id)}`;
                    extLink.target = '_blank';
                    extLink.rel = 'noopener noreferrer';
                    extLink.textContent = 'Abrir no MangaDex ↗';
                    extLink.style.textDecoration = 'none';
                    actEl.appendChild(extLink);

                    try {
                      const infoRaw = await fetchExternalTextOrXml(`https://api.mangadex.org/manga/${encodeURIComponent(m.id)}?includes[]=tag&includes[]=author&includes[]=artist`);
                      const infoJson = JSON.parse(infoRaw);
                      const d = (infoJson && infoJson.data && infoJson.data.attributes) || {};
                      const syn = pickLocalizedText(d.description, ['pt-br', 'pt', 'en']) || 'Sem sinopse cadastrada.';
                      descEl.textContent = syn;
                      const tags = (d.tags || []).map(t => pickLocalizedText(t.attributes && t.attributes.name, ['pt-br', 'en'])).filter(Boolean);
                      if (tagsEl) tagsEl.innerHTML = tags.map(t => `<span class="catalog-tag-pill">${escapeHtml(t)}</span>`).join('');
                      if (d.year && badgesEl) {
                        const yb = document.createElement('span');
                        yb.className = 'book-badge';
                        yb.textContent = String(d.year);
                        badgesEl.appendChild(yb);
                      }
                    } catch {
                      descEl.textContent = 'Não foi possível carregar a sinopse agora.';
                    }

                    let dOff = 0, dOrd = 'asc', dTot = 0;
                    const loadExpandedMdChapters = async (reset) => {
                      if (reset) {
                        dOff = 0;
                        chList.innerHTML = '<div style="font-size:12px; color:var(--text-muted);">Carregando capítulos...</div>';
                      }
                      const feedLangs = langs.map(l => `translatedLanguage[]=${encodeURIComponent(l)}`).join('&');
                      const feedUrl = `https://api.mangadex.org/manga/${encodeURIComponent(m.id)}/feed?limit=100&offset=${dOff}&${feedLangs}&contentRating[]=safe&contentRating[]=suggestive&order[volume]=${dOrd}&order[chapter]=${dOrd}&includes[]=scanlation_group`;
                      const fRaw = await fetchExternalTextOrXml(feedUrl);
                      const fJson = JSON.parse(fRaw);
                      dTot = fJson.total || 0;
                      const chs = parseMangaDexChaptersList(fJson);
                      if (reset) { chList.innerHTML = ''; loadedMdQueue.length = 0; }
                      const oldMore = chList.querySelector('.btn-exp-more');
                      if (oldMore) oldMore.remove();
                      if (!chs.length && dOff === 0) {
                        chList.innerHTML = '<div style="font-size:12px; color:var(--text-muted);">Nenhum capítulo em PT-BR/EN encontrado.</div>';
                        return;
                      }
                      chs.forEach(ch => {
                        const row = document.createElement('div');
                        row.className = 'catalog-detail-ch-row';
                        if (ch.externalUrl && /^https?:\/\//i.test(ch.externalUrl)) {
                          row.innerHTML = `
                            <div style="flex:1; min-width:0; word-break:break-word;">
                              <strong style="color:var(--accent);">[${escapeHtml(ch.lang)}]</strong> ${escapeHtml(ch.label)} <span style="color:var(--text-muted);">(${escapeHtml(ch.group || 'Site Oficial')})</span>
                            </div>
                            <a class="btn" href="${escapeHtml(ch.externalUrl)}" target="_blank" rel="noopener noreferrer" style="height:24px; font-size:11px; padding:0 10px; text-decoration:none; display:inline-flex; align-items:center; flex-shrink:0;">Site Oficial ↗</a>
                          `;
                        } else {
                          const qIdx = loadedMdQueue.push(ch) - 1;
                          row.innerHTML = `
                            <input type="checkbox" class="batch-ch-chk" style="flex-shrink:0; cursor:pointer;" title="Marcar para download em lote" />
                            <div style="flex:1; min-width:0; word-break:break-word;">
                              <strong style="color:var(--accent);">[${escapeHtml(ch.lang)}]</strong> ${escapeHtml(ch.label)} <span style="color:var(--text-muted);">(${ch.pages} pág${ch.group ? ' · ' + escapeHtml(ch.group) : ''})</span>
                            </div>
                            <div style="display:flex; gap:5px; flex-shrink:0;">
                              <button class="btn primary btn-x-read" style="height:24px; font-size:11px; padding:0 9px;">Ler</button>
                              <button class="btn btn-x-dl" style="height:24px; font-size:11px; padding:0 9px;">.CBZ</button>
                              <button class="btn btn-x-cloud" style="height:24px; font-size:11px; padding:0 9px;">+Nuvem</button>
                            </div>
                          `;
                          const chk = row.querySelector('.batch-ch-chk');
                          if (chk) chk._chapterItem = ch;
                          const runCh = async (mode, chTarget = ch, idxInQ = qIdx) => {
                            const fileName = `${m.title}_Cap_${chTarget.chapter}_${chTarget.lang}`.replace(/[^a-zA-Z0-9._-]+/g, '_').slice(0, 64) + '.cbz';
                            showToast(`Baixando ${m.title} (${chTarget.label})...`);
                            try {
                              const cbzBuf = await downloadMangaDexChapterAsCbz(chTarget, {
                                dataSaver,
                                onProgress: (cur, tot) => showFloatingDownloadProgress(`${m.title} — ${chTarget.label}`, `Páginas: ${cur}/${tot}`, (cur / Math.max(1, tot)) * 100)
                              });
                              hideFloatingDownloadProgress();
                              if (mode === 'dl') {
                                const u = URL.createObjectURL(new Blob([cbzBuf], { type: 'application/vnd.comicbook+zip' }));
                                const a = document.createElement('a'); a.href = u; a.download = fileName; a.click();
                                setTimeout(() => URL.revokeObjectURL(u), 2500);
                                return;
                              }
                              closeCatDetail();
                              state.seriesQueue = {
                                seriesTitle: m.title,
                                items: loadedMdQueue.slice(),
                                index: idxInQ,
                                openItem: (nextCh, nextIdx) => runCh('read', nextCh, nextIdx)
                              };
                              await loadFile({ name: fileName, size: cbzBuf.byteLength, buffer: cbzBuf });
                              if (mode === 'cloud') {
                                await uploadBookRecordToCloud({ bookKey: state.bookKey, fileName, title: `${m.title} — ${chTarget.label}`, author: m.author, format: 'CBZ', size: cbzBuf.byteLength, totalSections: state.sections.length, buffer: cbzBuf });
                              }
                            } catch (e) { hideFloatingDownloadProgress(); alert('Erro ao baixar capítulo: ' + e.message); }
                          };
                          row.querySelector('.btn-x-read').addEventListener('click', () => runCh('read'));
                          row.querySelector('.btn-x-dl').addEventListener('click', () => runCh('dl'));
                          row.querySelector('.btn-x-cloud').addEventListener('click', () => runCh('cloud'));
                        }
                        chList.appendChild(row);
                      });
                      const loaded = dOff + (fJson.data ? fJson.data.length : chs.length);
                      if (statusEl) statusEl.textContent = `Exibindo ${Math.min(dTot || loaded, loaded)} de ${dTot || loaded} capítulo(s)`;
                      if (dTot > loaded) {
                        const mb = document.createElement('button');
                        mb.className = 'btn btn-exp-more';
                        mb.style.cssText = 'width:100%; height:28px;';
                        mb.textContent = `Carregar mais capítulos (${dTot - loaded} restantes)`;
                        mb.addEventListener('click', () => { dOff += 100; loadExpandedMdChapters(false).catch(() => {}); });
                        chList.appendChild(mb);
                      }
                    };
                    const loadedMdQueue = [];
                    if (chCtrls) {
                      const sb = document.createElement('button');
                      sb.className = 'btn';
                      sb.style.height = '24px';
                      sb.textContent = 'Ordem: Cap. 1 → Fim';
                      sb.addEventListener('click', () => {
                        dOrd = dOrd === 'asc' ? 'desc' : 'asc';
                        sb.textContent = dOrd === 'asc' ? 'Ordem: Cap. 1 → Fim' : 'Ordem: Recentes → 1';
                        loadExpandedMdChapters(true).catch(() => {});
                      });
                      chCtrls.appendChild(sb);
                      attachCatalogBatchControls({
                        chCtrls,
                        chList,
                        getSelectedItems: () => Array.from(chList.querySelectorAll('.batch-ch-chk:checked')).map(c => c._chapterItem).filter(Boolean),
                        onBatchDownload: async (picked) => {
                          const abortCtrl = new AbortController();
                          activeDownloadAbortCtrl = abortCtrl;
                          try {
                            for (let i = 0; i < picked.length; i++) {
                              if (abortCtrl.signal.aborted) break;
                              const chItem = picked[i];
                              showFloatingDownloadProgress(`Lote (${i + 1}/${picked.length}): ${m.title}`, chItem.label, ((i + 1) / picked.length) * 100);
                              const fn = `${m.title}_Cap_${chItem.chapter}_${chItem.lang}`.replace(/[^a-zA-Z0-9._-]+/g, '_').slice(0, 64) + '.cbz';
                              const buf = await downloadMangaDexChapterAsCbz(chItem, { dataSaver });
                              const u = URL.createObjectURL(new Blob([buf], { type: 'application/vnd.comicbook+zip' }));
                              const a = document.createElement('a'); a.href = u; a.download = fn; a.click();
                              setTimeout(() => URL.revokeObjectURL(u), 2500);
                            }
                            showToast(`Lote concluído: ${picked.length} capítulo(s) .CBZ baixado(s)!`);
                          } catch (e) {
                            if (e && e.name !== 'AbortError') alert('Erro no download em lote: ' + e.message);
                          } finally {
                            hideFloatingDownloadProgress();
                          }
                        }
                      });
                    }
                    await loadExpandedMdChapters(true);
                  }
                });
              });
              gridEl.appendChild(card);
            });

            if (totalMangas > mdOffset + mangas.length) {
              const loadMoreMangas = document.createElement('button');
              loadMoreMangas.className = 'btn primary btn-load-more-md';
              loadMoreMangas.style.cssText = 'grid-column:1 / -1; height:30px; font-size:12px;';
              loadMoreMangas.textContent = `Carregar mais mangás (${totalMangas - (mdOffset + mangas.length)} restantes)`;
              loadMoreMangas.addEventListener('click', () => {
                mdOffset += MD_PAGE_LIMIT;
                renderMangaDexBatch(true).catch(() => {});
              });
              gridEl.appendChild(loadMoreMangas);
            }
          };

          await renderMangaDexBatch(false);
          return;
        }

        if (srcType === 'webtoon-scrape') {
          if (!location.protocol.startsWith('http')) {
            throw new Error('O web-scraper WEBTOON precisa rodar pela URL hospedada (Vercel/Netlify) por causa do proxy CORS/Referer.');
          }
          const wtSearchUrl = query
            ? `https://www.webtoons.com/en/search?keyword=${encodeURIComponent(query)}`
            : 'https://www.webtoons.com/en/ranking/trending';
          statusEl.textContent = 'Fazendo web-scraping no WEBTOON...';
          const html = await fetchExternalTextOrXml(wtSearchUrl);
          const seriesList = parseWebtoonSearchHtml(html, 'https://www.webtoons.com').slice(0, 24);
          if (!seriesList.length) {
            statusEl.textContent = 'Nenhuma série encontrada no WEBTOON para esse termo.';
            return;
          }
          statusEl.textContent = `${seriesList.length} série(s) extraída(s) via Web-Scraping (WEBTOON). Clique em "Expandir ⤢" para ver sinopse e todos os episódios (.CBZ):`;
          seriesList.forEach(wt => {
            const card = document.createElement('div');
            card.className = 'opds-card';
            const covSrc = proxiedImgSrc(wt.coverUrl);
            card.innerHTML = `
              <div class="opds-cover">
                ${covSrc ? `<img src="${escapeHtml(covSrc)}" alt="" loading="lazy" />` : '<span>WEBTOON</span>'}
              </div>
              <div style="flex:1; min-width:0; display:flex; flex-direction:column; gap:4px;">
                <div style="font-size:12px; font-weight:600; color:var(--text-primary); display:-webkit-box; -webkit-line-clamp:2; -webkit-box-orient:vertical; overflow:hidden;">${escapeHtml(wt.title)}</div>
                <div style="font-size:11px; color:var(--text-secondary); white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${escapeHtml(wt.author)}${wt.views ? ' · ' + escapeHtml(wt.views) : ''}</div>
                <div style="display:flex; gap:5px; margin-top:4px; flex-wrap:wrap;">
                  <button class="btn primary btn-wt-expand" style="height:24px; font-size:11px; padding:0 8px;">Expandir &amp; Episódios ⤢</button>
                </div>
              </div>
            `;
            card.querySelector('.btn-wt-expand').addEventListener('click', () => {
              openCatalogDetailModal({
                title: wt.title,
                author: wt.author,
                coverUrl: wt.coverUrl,
                source: 'WEBTOON Scrape',
                lang: wt.lang,
                chaptersHeading: 'Episódios Extraídos (.CBZ direto)',
                onRender: async ({ badgesEl, descEl, chList, chCtrls, statusEl, actEl }) => {
                  const loadedWtEps = [];
                  if (chCtrls) {
                    attachCatalogBatchControls({
                      chCtrls, chList,
                      getSelectedItems: () => Array.from(chList.querySelectorAll('.batch-ch-chk:checked')).map(c => c._wtEp).filter(Boolean),
                      onBatchDownload: async (picked) => {
                        try {
                          for (let i = 0; i < picked.length; i++) {
                            const epItem = picked[i];
                            showFloatingDownloadProgress(`Lote (${i + 1}/${picked.length}): ${wt.title}`, epItem.label, ((i + 1) / picked.length) * 100);
                            const buf = await downloadWebtoonEpisodeAsCbz(epItem.url);
                            const fn = `${wt.title}_Ep_${epItem.epNo}`.replace(/[^a-zA-Z0-9._-]+/g, '_').slice(0, 64) + '.cbz';
                            const u = URL.createObjectURL(new Blob([buf], { type: 'application/vnd.comicbook+zip' }));
                            const a = document.createElement('a'); a.href = u; a.download = fn; a.click();
                            setTimeout(() => URL.revokeObjectURL(u), 2500);
                          }
                          showToast(`Lote WEBTOON concluído: ${picked.length} episódio(s)!`);
                        } catch (e) { alert('Erro no lote WEBTOON: ' + e.message); }
                        finally { hideFloatingDownloadProgress(); }
                      }
                    });
                  }
                  const extA = document.createElement('a');
                  extA.className = 'btn'; extA.href = wt.detailUrl; extA.target = '_blank'; extA.rel = 'noopener noreferrer';
                  extA.textContent = 'Site Oficial ↗'; extA.style.textDecoration = 'none';
                  actEl.appendChild(extA);

                  const loadWtSeriesPage = async (pageUrl, append) => {
                    if (!append) chList.innerHTML = '<div style="font-size:12px; color:var(--text-muted);">Fazendo web-scraping da página de episódios...</div>';
                    const sHtml = await fetchExternalTextOrXml(pageUrl);
                    const info = parseWebtoonSeriesHtml(sHtml, 'https://www.webtoons.com');
                    if (!append) {
                      descEl.textContent = info.summary || 'Série disponível no WEBTOON.';
                      if (info.genre && badgesEl) {
                        const gb = document.createElement('span'); gb.className = 'book-badge'; gb.textContent = info.genre;
                        badgesEl.appendChild(gb);
                      }
                      chList.innerHTML = '';
                    }
                    const oldM = chList.querySelector('.btn-wt-more');
                    if (oldM) oldM.remove();
                    if (!info.episodes.length && !append) {
                      chList.innerHTML = '<div style="font-size:12px; color:var(--text-muted);">Nenhum episódio extraído desta página.</div>';
                      return;
                    }
                    info.episodes.forEach(ep => {
                      const wtIdx = loadedWtEps.push(ep) - 1;
                      const row = document.createElement('div');
                      row.className = 'catalog-detail-ch-row';
                      row.innerHTML = `
                        <input type="checkbox" class="batch-ch-chk" style="flex-shrink:0; cursor:pointer;" title="Marcar para download em lote" />
                        <div style="flex:1; min-width:0; word-break:break-word;"><strong>#${escapeHtml(ep.epNo)}</strong> — ${escapeHtml(ep.label)}</div>
                        <div style="display:flex; gap:5px; flex-shrink:0;">
                          <button class="btn primary btn-wt-read" style="height:24px; font-size:11px; padding:0 9px;">Ler</button>
                          <button class="btn btn-wt-dl" style="height:24px; font-size:11px; padding:0 9px;">.CBZ</button>
                          <button class="btn btn-wt-cloud" style="height:24px; font-size:11px; padding:0 9px;">+Nuvem</button>
                        </div>
                      `;
                      const wtChk = row.querySelector('.batch-ch-chk');
                      if (wtChk) wtChk._wtEp = ep;
                      const runEp = async (mode, epTarget = ep, idxQ = wtIdx) => {
                        const fn = `${wt.title}_Ep_${epTarget.epNo}`.replace(/[^a-zA-Z0-9._-]+/g, '_').slice(0, 64) + '.cbz';
                        showToast(`Extraindo imagens de "${epTarget.label}"...`);
                        try {
                          const buf = await downloadWebtoonEpisodeAsCbz(epTarget.url, {
                            onProgress: (c, t) => { const msg = `Quadros: ${c}/${t}`; if (dom.statusLeft) dom.statusLeft.textContent = `WEBTOON: ${msg}`; showFloatingDownloadProgress(`${wt.title} — ${epTarget.label}`, msg, (c / Math.max(1, t)) * 100); }
                          });
                          if (mode === 'dl') {
                            const u = URL.createObjectURL(new Blob([buf], { type: 'application/vnd.comicbook+zip' }));
                            const a = document.createElement('a'); a.href = u; a.download = fn; a.click();
                            setTimeout(() => URL.revokeObjectURL(u), 2500);
                            return;
                          }
                          closeCatDetail();
                          state.webtoonStrip = true;
                          state.flowMode = 'scroll-all';
                          state.mangaRtl = false;
                          state.seriesQueue = {
                            seriesTitle: wt.title,
                            items: loadedWtEps.slice().sort((a, b) => Number(a.epNo) - Number(b.epNo)),
                            index: -1,
                            openItem: (nextEp, nIdx) => runEp('read', nextEp, nIdx)
                          };
                          state.seriesQueue.index = state.seriesQueue.items.findIndex(x => x.url === epTarget.url);
                          await loadFile({ name: fn, size: buf.byteLength, buffer: buf });
                          if (mode === 'cloud') {
                            await uploadBookRecordToCloud({ bookKey: state.bookKey, fileName: fn, title: `${wt.title} — ${epTarget.label}`, author: wt.author, format: 'CBZ', size: buf.byteLength, totalSections: state.sections.length, buffer: buf });
                          }
                        } catch (e) { hideFloatingDownloadProgress(); if (e && e.name !== 'AbortError') alert('Erro ao extrair episódio WEBTOON: ' + e.message); } finally { hideFloatingDownloadProgress(); }
                      };
                      row.querySelector('.btn-wt-read').addEventListener('click', () => runEp('read'));
                      row.querySelector('.btn-wt-dl').addEventListener('click', () => runEp('dl'));
                      row.querySelector('.btn-wt-cloud').addEventListener('click', () => runEp('cloud'));
                      chList.appendChild(row);
                    });
                    if (info.nextPageUrl) {
                      const nb = document.createElement('button');
                      nb.className = 'btn btn-wt-more';
                      nb.style.cssText = 'width:100%; height:28px;';
                      nb.textContent = 'Carregar mais episódios (página anterior)';
                      nb.addEventListener('click', () => loadWtSeriesPage(info.nextPageUrl, true).catch(() => {}));
                      chList.appendChild(nb);
                    }
                    if (statusEl) statusEl.textContent = `${chList.querySelectorAll('.catalog-detail-ch-row').length} episódio(s) carregado(s)`;
                  };
                  await loadWtSeriesPage(wt.detailUrl, false);
                }
              });
            });
            gridEl.appendChild(card);
          });
          return;
        }

        if (srcType === 'web-scrape-url') {
          if (!customUrl) throw new Error('Cole uma URL pública (https://...) no campo acima para extrair livros, capítulos ou imagens.');
          statusEl.textContent = 'Fazendo web-scraping da página HTML informada...';
          const rawHtml = await fetchExternalTextOrXml(customUrl);
          const scraped = parseGenericScrapePageHtml(rawHtml, customUrl);
          statusEl.textContent = `Extraído de ${customUrl}: ${scraped.ebookLinks.length} arquivo(s) direto(s), ${scraped.imageLinks.length} imagem(ns), ${scraped.articleTextLen} caracteres de texto.`;
          const card = document.createElement('div');
          card.className = 'opds-card';
          card.style.gridColumn = '1 / -1';
          const covSrc = proxiedImgSrc(scraped.coverUrl);
          card.innerHTML = `
            <div class="opds-cover">${covSrc ? `<img src="${escapeHtml(covSrc)}" alt="" />` : '<span>HTML</span>'}</div>
            <div style="flex:1; min-width:0; display:flex; flex-direction:column; gap:5px;">
              <div style="font-size:13px; font-weight:700; color:var(--text-primary);">${escapeHtml(scraped.pageTitle)}</div>
              <div style="font-size:11.5px; color:var(--text-secondary);">${escapeHtml(scraped.description || 'Página HTML analisada com sucesso.')}</div>
              <div style="display:flex; gap:6px; flex-wrap:wrap; margin-top:4px;">
                <button class="btn primary btn-gs-expand" style="height:26px; font-size:11px; padding:0 10px;">Expandir Recursos Extraídos (${scraped.ebookLinks.length} arquivos · ${scraped.imageLinks.length} imgs) ⤢</button>
                ${scraped.imageLinks.length >= 2 ? '<button class="btn btn-gs-cbz" style="height:26px; font-size:11px; padding:0 10px;">Ler Imagens como Mangá (.CBZ)</button>' : ''}
                ${scraped.articleTextLen > 200 ? '<button class="btn btn-gs-txt" style="height:26px; font-size:11px; padding:0 10px;">Ler Texto Extraído</button>' : ''}
              </div>
            </div>
          `;
          const openScrapedAsManga = async (dlOnly) => {
            showToast(`Empacotando ${scraped.imageLinks.length} imagens em .CBZ...`);
            try {
              const zipFiles = [];
              for (let i = 0; i < scraped.imageLinks.length; i++) {
                try {
                  const bytes = await fetchValidImagePageBytes(scraped.imageLinks[i]);
                  const extM = scraped.imageLinks[i].split('?')[0].match(/\.(jpg|jpeg|png|webp)$/i);
                  zipFiles.push({ path: `${String(zipFiles.length + 1).padStart(4, '0')}.${extM ? extM[1] : 'jpg'}`, content: bytes });
                } catch {}
              }
              if (!zipFiles.length) throw new Error('Não foi possível baixar as imagens dessa página.');
              const blob = createZipBlob(zipFiles, 'application/vnd.comicbook+zip');
              const buf = await blob.arrayBuffer();
              const fn = `${scraped.pageTitle}`.replace(/[^a-zA-Z0-9._-]+/g, '_').slice(0, 50) + '.cbz';
              if (dlOnly) {
                const u = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = u; a.download = fn; a.click();
                setTimeout(() => URL.revokeObjectURL(u), 2500); return;
              }
              closeCatDetail();
              await loadFile({ name: fn, size: buf.byteLength, buffer: buf });
            } catch (e) { alert('Erro ao empacotar imagens: ' + e.message); }
          };
          const openScrapedText = async () => {
            const fullHtml = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${escapeHtml(scraped.pageTitle)}</title></head><body><h1>${escapeHtml(scraped.pageTitle)}</h1>${scraped.cleanedBody}</body></html>`;
            const buf = new TextEncoder().encode(fullHtml).buffer;
            const fn = `${scraped.pageTitle}`.replace(/[^a-zA-Z0-9._-]+/g, '_').slice(0, 50) + '.html';
            closeCatDetail();
            await loadFile({ name: fn, size: buf.byteLength, buffer: buf });
          };
          const bCbz = card.querySelector('.btn-gs-cbz');
          if (bCbz) bCbz.addEventListener('click', () => openScrapedAsManga(false));
          const bTxt = card.querySelector('.btn-gs-txt');
          if (bTxt) bTxt.addEventListener('click', openScrapedText);
          card.querySelector('.btn-gs-expand').addEventListener('click', () => {
            openCatalogDetailModal({
              title: scraped.pageTitle,
              author: new URL(customUrl).hostname,
              coverUrl: scraped.coverUrl,
              source: 'Web-Scraper HTML',
              description: scraped.description || 'Conteúdo extraído diretamente do HTML da página informada.',
              chaptersHeading: `Links & Imagens Extraídos (${scraped.ebookLinks.length} arquivos · ${scraped.imageLinks.length} imagens)`,
              onRender: ({ actEl, chList }) => {
                if (scraped.imageLinks.length >= 2) {
                  const b1 = document.createElement('button'); b1.className = 'btn primary'; b1.textContent = `Ler ${scraped.imageLinks.length} Imagens como .CBZ`;
                  b1.addEventListener('click', () => openScrapedAsManga(false)); actEl.appendChild(b1);
                  const b2 = document.createElement('button'); b2.className = 'btn'; b2.textContent = 'Baixar .CBZ';
                  b2.addEventListener('click', () => openScrapedAsManga(true)); actEl.appendChild(b2);
                }
                if (scraped.articleTextLen > 200) {
                  const b3 = document.createElement('button'); b3.className = 'btn'; b3.textContent = 'Ler Texto da Página no Leitor';
                  b3.addEventListener('click', openScrapedText); actEl.appendChild(b3);
                }
                if (!scraped.ebookLinks.length) {
                  chList.innerHTML = '<div style="font-size:12px; color:var(--text-muted);">Nenhum link direto para .epub/.pdf/.cbz nesta URL (use os botões acima para ler imagens ou texto extraído).</div>';
                  return;
                }
                scraped.ebookLinks.forEach(lk => {
                  const row = document.createElement('div');
                  row.className = 'catalog-detail-ch-row';
                  row.innerHTML = `
                    <div style="flex:1; min-width:0; word-break:break-word;"><strong style="color:var(--accent);">[${escapeHtml(lk.format)}]</strong> ${escapeHtml(lk.label)}</div>
                    <button class="btn primary" style="height:24px; font-size:11px; padding:0 10px;">Baixar &amp; Ler</button>
                  `;
                  row.querySelector('button').addEventListener('click', async () => {
                    try {
                      showToast(`Baixando ${lk.label}...`);
                      const buf = await fetchExternalBinary(lk.url);
                      closeCatDetail();
                      await loadFile({ name: `${lk.label}.${lk.format.toLowerCase()}`, size: buf.byteLength, buffer: buf });
                    } catch (e) { alert('Erro ao baixar link extraído: ' + e.message); }
                  });
                  chList.appendChild(row);
                });
              }
            });
          });
          gridEl.appendChild(card);
          return;
        }

        if (srcType === 'tapas-comics') {
          if (!location.protocol.startsWith('http')) {
            throw new Error('O web-scraper Tapas precisa rodar pela URL hospedada (Vercel/Netlify) por causa do proxy CORS.');
          }
          const onlyPt = langs.length === 1 && langs[0].startsWith('pt');
          const searchTerm = query || (onlyPt ? 'quadrinhos' : 'comic');
          statusEl.textContent = 'Fazendo web-scraping de Cartoons & Quadrinhos no Tapas...';
          const tpUrl = `https://tapas.io/search?q=${encodeURIComponent(searchTerm)}&t=COMICS`;
          const tpHtml = await fetchExternalTextOrXml(tpUrl);
          const list = parseTapasSearchHtml(tpHtml, 'https://tapas.io').slice(0, 24);
          if (!list.length) {
            statusEl.textContent = 'Nenhum cartoon/quadrinho encontrado no Tapas para essa busca.';
            return;
          }
          statusEl.textContent = `${list.length} série(s) de Quadrinhos/Cartoons encontrada(s) no Tapas. Clique em "Expandir & Episódios ⤢" para ler ou baixar .CBZ:`;
          list.forEach(tp => {
            const card = document.createElement('div');
            card.className = 'opds-card';
            const covSrc = proxiedImgSrc(tp.coverUrl);
            card.innerHTML = `
              <div class="opds-cover">${covSrc ? `<img src="${escapeHtml(covSrc)}" alt="" loading="lazy" />` : '<span>HQ</span>'}</div>
              <div style="flex:1; min-width:0; display:flex; flex-direction:column; gap:4px;">
                <div style="font-size:12px; font-weight:600; color:var(--text-primary); display:-webkit-box; -webkit-line-clamp:2; -webkit-box-orient:vertical; overflow:hidden;">${escapeHtml(tp.title)}</div>
                <div style="font-size:11px; color:var(--text-secondary); white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${escapeHtml(tp.author)} · Tapas</div>
                <div style="display:flex; gap:5px; margin-top:4px; flex-wrap:wrap;">
                  <button class="btn primary btn-tp-expand" style="height:24px; font-size:11px; padding:0 8px;">Expandir &amp; Episódios ⤢</button>
                </div>
              </div>
            `;
            card.querySelector('.btn-tp-expand').addEventListener('click', () => {
              openCatalogDetailModal({
                title: tp.title,
                author: tp.author,
                coverUrl: tp.coverUrl,
                source: 'Tapas Cartoons/HQs',
                lang: onlyPt ? 'PT-BR' : 'PT/EN',
                chaptersHeading: 'Episódios & Tiras (.CBZ direto)',
                onRender: async ({ authorEl, tagsEl, descEl, chList, chCtrls, statusEl, actEl, covEl }) => {
                  const loadedTpEps = [];
                  if (chCtrls) {
                    attachCatalogBatchControls({
                      chCtrls, chList,
                      getSelectedItems: () => Array.from(chList.querySelectorAll('.batch-ch-chk:checked')).map(c => c._tpEp).filter(Boolean),
                      onBatchDownload: async (picked) => {
                        try {
                          for (let i = 0; i < picked.length; i++) {
                            const epItem = picked[i];
                            showFloatingDownloadProgress(`Lote (${i + 1}/${picked.length}): ${tp.title}`, epItem.label, ((i + 1) / picked.length) * 100);
                            const buf = await downloadTapasEpisodeAsCbz(epItem.url);
                            const fn = `${tp.title}_${epItem.label}`.replace(/[^a-zA-Z0-9._-]+/g, '_').slice(0, 64) + '.cbz';
                            const u = URL.createObjectURL(new Blob([buf], { type: 'application/vnd.comicbook+zip' }));
                            const a = document.createElement('a'); a.href = u; a.download = fn; a.click();
                            setTimeout(() => URL.revokeObjectURL(u), 2500);
                          }
                          showToast(`Lote Tapas concluído: ${picked.length} episódio(s)!`);
                        } catch (e) { alert('Erro no lote Tapas: ' + e.message); }
                        finally { hideFloatingDownloadProgress(); }
                      }
                    });
                  }
                  const extA = document.createElement('a');
                  extA.className = 'btn'; extA.href = tp.detailUrl; extA.target = '_blank'; extA.rel = 'noopener noreferrer';
                  extA.textContent = 'Abrir no Tapas ↗'; extA.style.textDecoration = 'none';
                  actEl.appendChild(extA);

                  chList.innerHTML = '<div style="font-size:12px; color:var(--text-muted);">Carregando ficha e episódios do Tapas...</div>';
                  try {
                    const infoHtml = await fetchExternalTextOrXml(tp.detailUrl);
                    const info = parseTapasInfoHtml(infoHtml);
                    const sid = tp.seriesId || info.seriesId;
                    if (info.description) descEl.textContent = info.description;
                    else descEl.textContent = 'Quadrinho / cartoon publicado no Tapas.';
                    if (info.author && authorEl) authorEl.textContent = info.author;
                    if (info.genres.length && tagsEl) tagsEl.innerHTML = info.genres.map(g => `<span class="catalog-tag-pill">${escapeHtml(g)}</span>`).join('');
                    if (info.coverUrl && covEl) covEl.innerHTML = `<img src="${escapeHtml(proxiedImgSrc(info.coverUrl))}" alt="" />`;
                    if (!sid) {
                      chList.innerHTML = '<div style="font-size:12px; color:var(--text-muted);">Não foi possível localizar o ID dos episódios dessa série.</div>';
                      return;
                    }
                    let tpPage = 1;
                    chList.innerHTML = '';
                    const loadTpPage = async () => {
                      const oldMore = chList.querySelector('.btn-tp-more');
                      if (oldMore) oldMore.remove();
                      const epRaw = await fetchExternalTextOrXml(`https://tapas.io/series/${encodeURIComponent(sid)}/episodes?page=${tpPage}&sort=OLDEST&max_limit=20`);
                      const epJson = JSON.parse(epRaw);
                      const bodyHtml = (epJson && epJson.data && epJson.data.body) || '';
                      const eps = parseTapasEpisodesBodyHtml(bodyHtml, 'https://tapas.io');
                      if (!eps.length && tpPage === 1) {
                        chList.innerHTML = '<div style="font-size:12px; color:var(--text-muted);">Nenhum episódio gratuito encontrado.</div>';
                        return;
                      }
                      eps.forEach(ep => {
                        const row = document.createElement('div');
                        row.className = 'catalog-detail-ch-row';
                        if (ep.locked) {
                          row.innerHTML = `
                            <div style="flex:1; min-width:0; word-break:break-word;">${escapeHtml(ep.label)} <span style="color:var(--text-muted);">(Episódio pago no Tapas)</span></div>
                            <a class="btn" href="${escapeHtml(ep.url)}" target="_blank" rel="noopener noreferrer" style="height:24px; font-size:11px; padding:0 10px; text-decoration:none; display:inline-flex; align-items:center;">Site Oficial ↗</a>
                          `;
                        } else {
                          const tpIdx = loadedTpEps.push(ep) - 1;
                          row.innerHTML = `
                            <input type="checkbox" class="batch-ch-chk" style="flex-shrink:0; cursor:pointer;" title="Marcar para download em lote" />
                            <div style="flex:1; min-width:0; word-break:break-word;">${escapeHtml(ep.label)}</div>
                            <div style="display:flex; gap:5px; flex-shrink:0;">
                              <button class="btn primary btn-tp-read" style="height:24px; font-size:11px; padding:0 9px;">Ler</button>
                              <button class="btn btn-tp-dl" style="height:24px; font-size:11px; padding:0 9px;">.CBZ</button>
                              <button class="btn btn-tp-cloud" style="height:24px; font-size:11px; padding:0 9px;">+Nuvem</button>
                            </div>
                          `;
                          const tpChk = row.querySelector('.batch-ch-chk');
                          if (tpChk) tpChk._tpEp = ep;
                          const runTpEp = async (mode, epTarget = ep, idxQ = tpIdx) => {
                            const fn = `${tp.title}_${epTarget.label}`.replace(/[^a-zA-Z0-9._-]+/g, '_').slice(0, 64) + '.cbz';
                            showToast(`Extraindo imagens de "${epTarget.label}"...`);
                            try {
                              const buf = await downloadTapasEpisodeAsCbz(epTarget.url, {
                                onProgress: (c, t) => { const msg = `Quadros: ${c}/${t}`; if (dom.statusLeft) dom.statusLeft.textContent = `Tapas: ${msg}`; showFloatingDownloadProgress(`${tp.title} — ${epTarget.label}`, msg, (c / Math.max(1, t)) * 100); }
                              });
                              if (mode === 'dl') {
                                const u = URL.createObjectURL(new Blob([buf], { type: 'application/vnd.comicbook+zip' }));
                                const a = document.createElement('a'); a.href = u; a.download = fn; a.click();
                                setTimeout(() => URL.revokeObjectURL(u), 2500);
                                return;
                              }
                              closeCatDetail();
                              state.webtoonStrip = true;
                              state.flowMode = 'scroll-all';
                              state.mangaRtl = false;
                              state.seriesQueue = {
                                seriesTitle: tp.title,
                                items: loadedTpEps.slice(),
                                index: idxQ,
                                openItem: (nextEp, nIdx) => runTpEp('read', nextEp, nIdx)
                              };
                              await loadFile({ name: fn, size: buf.byteLength, buffer: buf });
                              if (mode === 'cloud') {
                                await uploadBookRecordToCloud({ bookKey: state.bookKey, fileName: fn, title: `${tp.title} — ${epTarget.label}`, author: info.author || tp.author, format: 'CBZ', size: buf.byteLength, totalSections: state.sections.length, buffer: buf });
                              }
                            } catch (e) { hideFloatingDownloadProgress(); if (e && e.name !== 'AbortError') alert('Erro ao extrair episódio do Tapas: ' + e.message); } finally { hideFloatingDownloadProgress(); }
                          };
                          row.querySelector('.btn-tp-read').addEventListener('click', () => runTpEp('read'));
                          row.querySelector('.btn-tp-dl').addEventListener('click', () => runTpEp('dl'));
                          row.querySelector('.btn-tp-cloud').addEventListener('click', () => runTpEp('cloud'));
                        }
                        chList.appendChild(row);
                      });
                      const hasNext = Boolean(epJson && epJson.data && epJson.data.pagination && epJson.data.pagination.has_next);
                      if (statusEl) statusEl.textContent = `${chList.querySelectorAll('.catalog-detail-ch-row').length} episódio(s) carregado(s)`;
                      if (hasNext) {
                        const mb = document.createElement('button');
                        mb.className = 'btn btn-tp-more';
                        mb.style.cssText = 'width:100%; height:28px;';
                        mb.textContent = 'Carregar mais episódios';
                        mb.addEventListener('click', () => { tpPage++; loadTpPage().catch(() => {}); });
                        chList.appendChild(mb);
                      }
                    };
                    await loadTpPage();
                  } catch (e) {
                    chList.innerHTML = `<div style="font-size:12px; color:#ef4444;">Erro ao carregar episódios: ${escapeHtml(e.message)}</div>`;
                  }
                }
              });
            });
            gridEl.appendChild(card);
          });
          return;
        }

        if (srcType === 'archive-manga' || srcType === 'archive-comics' || srcType === 'archive-books') {
          const isBooks = srcType === 'archive-books';
          const isComics = srcType === 'archive-comics';
          const langFilter = langs.length === 1
            ? (langs[0].startsWith('pt') ? ' AND (language:por OR language:portuguese)' : ' AND (language:eng OR language:english)')
            : '';
          let qTerm = '';
          if (isBooks) {
            qTerm = query ? `(${query}) AND mediatype:texts AND (format:EPUB OR format:PDF)${langFilter}` : `mediatype:texts AND (format:EPUB OR format:PDF)${langFilter}`;
          } else if (isComics) {
            const cSubject = langs.length === 1 && langs[0].startsWith('pt')
              ? '(subject:quadrinhos OR subject:gibis OR subject:hq OR subject:comics OR subject:cartoons OR title:quadrinhos OR title:gibi OR title:turma)'
              : '(collection:comics OR subject:comics OR subject:"comic books" OR subject:cartoons OR subject:"comic strips" OR subject:"graphic novels" OR subject:quadrinhos)';
            qTerm = query
              ? `(${query}) AND ${cSubject} AND mediatype:texts AND (format:CBZ OR format:PDF) AND -subject:erotica${langFilter}`
              : `${cSubject} AND mediatype:texts AND (format:CBZ OR format:PDF) AND -subject:erotica${langFilter}`;
          } else {
            qTerm = query ? `(${query}) AND (subject:manga OR subject:comics OR subject:"graphic novels" OR title:manga) AND (format:CBZ OR format:PDF) AND -subject:erotica${langFilter}` : `(subject:manga OR collection:manga) AND (format:CBZ OR format:PDF) AND -subject:erotica${langFilter}`;
          }
          const iaUrl = `https://archive.org/advancedsearch.php?q=${encodeURIComponent(qTerm)}&fl[]=identifier,title,creator,language&sort[]=downloads+desc&rows=24&output=json`;
          const raw = await fetchExternalTextOrXml(iaUrl);
          const data = JSON.parse(raw);
          const docs = (data && data.response && data.response.docs) || [];
          const totalFound = (data && data.response && data.response.numFound) || docs.length;
          if (!docs.length) {
            statusEl.textContent = isBooks
              ? 'Nenhum livro público aberto (.epub/.pdf) encontrado no Internet Archive para essa busca (livros comerciais protegidos não ficam disponíveis aqui).'
              : 'Nenhum mangá/HQ público encontrado no Internet Archive para essa busca.';
            return;
          }
          statusEl.textContent = `Exibindo ${docs.length} de ${totalFound} item(ns) no Internet Archive. Clique em "Ver Arquivos" para abrir/baixar todos os volumes:`;
          docs.forEach(doc => {
            const card = document.createElement('div');
            card.className = 'opds-card';
            card.style.flexDirection = 'column';
            const covUrl = `https://archive.org/services/img/${encodeURIComponent(doc.identifier)}`;
            const creator = Array.isArray(doc.creator) ? doc.creator.join(', ') : (doc.creator || 'Internet Archive');
            card.innerHTML = `
              <div style="display:flex; gap:10px; width:100%; align-items:flex-start;">
                <div class="opds-cover"><img src="${escapeHtml(covUrl)}" alt="" loading="lazy" /></div>
                <div style="flex:1; min-width:0; display:flex; flex-direction:column; gap:4px;">
                  <div style="font-size:12px; font-weight:600; color:var(--text-primary); display:-webkit-box; -webkit-line-clamp:2; -webkit-box-orient:vertical; overflow:hidden;">${escapeHtml(doc.title || doc.identifier)}</div>
                  <div style="font-size:11px; color:var(--text-secondary); white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${escapeHtml(creator)}</div>
                  <div style="margin-top:4px; display:flex; gap:4px; flex-wrap:wrap;">
                    <button class="btn primary btn-ia-files" style="height:24px; font-size:11px; padding:0 8px;">${isBooks ? 'Arquivos' : 'Arquivos'}</button>
                    <button class="btn btn-ia-expand" style="height:24px; font-size:11px; padding:0 8px;">Expandir ⤢</button>
                  </div>
                </div>
              </div>
              <div class="ia-files-box hidden" style="width:100%; margin-top:8px; padding-top:8px; border-top:1px solid var(--border-color); display:flex; flex-direction:column; gap:5px; max-height:220px; overflow-y:auto;"></div>
            `;
            const fBox = card.querySelector('.ia-files-box');
            const fBtn = card.querySelector('.btn-ia-files');
            fBtn.addEventListener('click', async () => {
              if (!fBox.classList.contains('hidden')) { fBox.classList.add('hidden'); return; }
              fBox.classList.remove('hidden');
              if (fBox.dataset.loaded === '1') return;
              fBox.innerHTML = '<div style="font-size:11px; color:var(--text-muted);">Listando todos os arquivos...</div>';
              try {
                const metaRaw = await fetchExternalTextOrXml(`https://archive.org/metadata/${encodeURIComponent(doc.identifier)}`);
                const metaJson = JSON.parse(metaRaw);
                const files = (metaJson.files || []).filter(f => /\.(cbz|pdf|epub)$/i.test(f.name || '') && !/_encrypted\./i.test(f.name || ''));
                if (!files.length) {
                  fBox.innerHTML = '<div style="font-size:11px; color:var(--text-muted);">Nenhum arquivo aberto (.cbz/.epub/.pdf sem DRM) disponível neste item.</div>';
                  fBox.dataset.loaded = '1';
                  return;
                }
                fBox.innerHTML = `<div style="font-size:10.5px; color:var(--text-secondary);">${files.length} arquivo(s) encontrado(s):</div>`;
                files.forEach(f => {
                  const dlUrl = `https://archive.org/download/${encodeURIComponent(doc.identifier)}/${encodeURIComponent(f.name)}`;
                  const mbStr = f.size ? ` (${(Number(f.size) / 1048576).toFixed(1)} MB)` : '';
                  const row = document.createElement('div');
                  row.style.cssText = 'display:flex; justify-content:space-between; align-items:center; gap:6px; padding:4px 6px; border:1px solid var(--border-color); border-radius:4px; background:var(--bg-toolbar); font-size:11px;';
                  row.innerHTML = `
                    <span style="flex:1; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;" title="${escapeHtml(f.name)}">${escapeHtml(f.name)}${mbStr}</span>
                    <div style="display:flex; gap:4px; flex-shrink:0;">
                      <button class="btn primary btn-ia-read" style="height:22px; font-size:10.5px; padding:0 6px;">Ler</button>
                      <button class="btn btn-ia-dl" style="height:22px; font-size:10.5px; padding:0 6px;">Baixar</button>
                      <button class="btn btn-ia-cloud" style="height:22px; font-size:10.5px; padding:0 6px;">+Nuvem</button>
                    </div>
                  `;
                  const openIaFile = async (mode) => {
                    showToast(`Baixando "${f.name}"...`);
                    try {
                      const buf = await fetchExternalBinary(dlUrl, (loaded, total) => {
                        const txt = `Baixando "${f.name}": ${(loaded / 1048576).toFixed(1)} / ${(total / 1048576).toFixed(1)} MB`;
                        if (dom.statusLeft) dom.statusLeft.textContent = txt;
                        if (statusEl) statusEl.textContent = txt;
                      });
                      if (mode === 'dl') {
                        const url = URL.createObjectURL(new Blob([buf]));
                        const a = document.createElement('a');
                        a.href = url;
                        a.download = f.name;
                        a.click();
                        setTimeout(() => URL.revokeObjectURL(url), 2500);
                        showToast(`"${f.name}" baixado!`);
                        return;
                      }
                      await loadFile({ name: f.name, size: buf.byteLength, buffer: buf });
                      if (mode === 'cloud') {
                        await uploadBookRecordToCloud({
                          bookKey: state.bookKey,
                          fileName: f.name,
                          title: doc.title || f.name,
                          author: creator,
                          format: f.name.split('.').pop().toUpperCase(),
                          size: buf.byteLength,
                          totalSections: state.sections.length,
                          buffer: buf
                        });
                      }
                    } catch (err) {
                      if (err && err.name === 'AbortError') return;
                      if (mode === 'dl') {
                        window.open(dlUrl, '_blank', 'noopener');
                        showToast('Download direto aberto no navegador.');
                        return;
                      }
                      alert('Erro ao baixar arquivo: ' + err.message);
                    }
                  };
                  row.querySelector('.btn-ia-read').addEventListener('click', () => openIaFile('read'));
                  row.querySelector('.btn-ia-dl').addEventListener('click', () => openIaFile('dl'));
                  row.querySelector('.btn-ia-cloud').addEventListener('click', () => openIaFile('cloud'));
                  fBox.appendChild(row);
                });
                fBox.dataset.loaded = '1';
              } catch (err) {
                fBox.innerHTML = `<div style="font-size:11px; color:#ef4444;">Erro: ${escapeHtml(err.message)}</div>`;
              }
            });
            card.querySelector('.btn-ia-expand').addEventListener('click', () => {
              openCatalogDetailModal({
                title: doc.title || doc.identifier,
                author: creator,
                coverUrl: covUrl,
                source: isBooks ? 'Internet Archive (Livros)' : (isComics ? 'Internet Archive (Quadrinhos & Cartoons)' : 'Internet Archive (Mangás/HQs)'),
                chaptersHeading: 'Arquivos .EPUB / .CBZ / .PDF Disponíveis',
                onRender: async ({ badgesEl, tagsEl, descEl, chList, statusEl, actEl }) => {
                  const extA = document.createElement('a');
                  extA.className = 'btn'; extA.href = `https://archive.org/details/${encodeURIComponent(doc.identifier)}`;
                  extA.target = '_blank'; extA.rel = 'noopener noreferrer'; extA.textContent = 'Ver no Internet Archive ↗';
                  extA.style.textDecoration = 'none'; actEl.appendChild(extA);
                  chList.innerHTML = '<div style="font-size:12px; color:var(--text-muted);">Carregando metadados e arquivos...</div>';
                  try {
                    const metaRaw = await fetchExternalTextOrXml(`https://archive.org/metadata/${encodeURIComponent(doc.identifier)}`);
                    const metaJson = JSON.parse(metaRaw);
                    const md = metaJson.metadata || {};
                    const descRaw = Array.isArray(md.description) ? md.description.join('\n') : (md.description || '');
                    descEl.textContent = stripHtmlTags(descRaw) || 'Obra do acervo aberto do Internet Archive.';
                    if (md.date && badgesEl) { const b = document.createElement('span'); b.className = 'book-badge'; b.textContent = String(md.date).slice(0, 10); badgesEl.appendChild(b); }
                    const subj = Array.isArray(md.subject) ? md.subject : (md.subject ? String(md.subject).split(/[,;]/) : []);
                    if (tagsEl) tagsEl.innerHTML = subj.slice(0, 10).map(s => `<span class="catalog-tag-pill">${escapeHtml(s.trim())}</span>`).join('');
                    const files = (metaJson.files || []).filter(f => /\.(cbz|pdf|epub)$/i.test(f.name || '') && !/_encrypted\./i.test(f.name || ''));
                    chList.innerHTML = '';
                    if (!files.length) {
                      chList.innerHTML = '<div style="font-size:12px; color:var(--text-muted);">Nenhum arquivo aberto (.cbz/.epub/.pdf sem DRM) neste item.</div>';
                      return;
                    }
                    if (statusEl) statusEl.textContent = `${files.length} arquivo(s) encontrado(s)`;
                    files.forEach(f => {
                      const dlUrl = `https://archive.org/download/${encodeURIComponent(doc.identifier)}/${encodeURIComponent(f.name)}`;
                      const mbStr = f.size ? ` (${(Number(f.size) / 1048576).toFixed(1)} MB)` : '';
                      const row = document.createElement('div');
                      row.className = 'catalog-detail-ch-row';
                      row.innerHTML = `
                        <div style="flex:1; min-width:0; word-break:break-word;">${escapeHtml(f.name)}<span style="color:var(--text-muted);">${mbStr}</span></div>
                        <div style="display:flex; gap:5px; flex-shrink:0;">
                          <button class="btn primary btn-x-r" style="height:24px; font-size:11px; padding:0 9px;">Ler</button>
                          <button class="btn btn-x-d" style="height:24px; font-size:11px; padding:0 9px;">Baixar</button>
                          <button class="btn btn-x-c" style="height:24px; font-size:11px; padding:0 9px;">+Nuvem</button>
                        </div>
                      `;
                      const runIa = async (mode) => {
                        showToast(`Baixando "${f.name}"...`);
                        try {
                          const buf = await fetchExternalBinary(dlUrl, (loaded, total) => {
                            const txt = `Baixando "${f.name}": ${(loaded / 1048576).toFixed(1)} / ${(total / 1048576).toFixed(1)} MB`;
                            if (statusEl) statusEl.textContent = txt;
                            if (dom.statusLeft) dom.statusLeft.textContent = txt;
                          });
                          if (mode === 'dl') {
                            const u = URL.createObjectURL(new Blob([buf])); const a = document.createElement('a'); a.href = u; a.download = f.name; a.click();
                            setTimeout(() => URL.revokeObjectURL(u), 2500);
                            showToast(`"${f.name}" baixado!`);
                            return;
                          }
                          closeCatDetail();
                          await loadFile({ name: f.name, size: buf.byteLength, buffer: buf });
                          if (mode === 'cloud') {
                            await uploadBookRecordToCloud({ bookKey: state.bookKey, fileName: f.name, title: doc.title || f.name, author: creator, format: f.name.split('.').pop().toUpperCase(), size: buf.byteLength, totalSections: state.sections.length, buffer: buf });
                          }
                        } catch (e) {
                          if (e && e.name === 'AbortError') return;
                          if (mode === 'dl') {
                            window.open(dlUrl, '_blank', 'noopener');
                            showToast('Download direto aberto no navegador.');
                            return;
                          }
                          alert('Erro ao baixar arquivo: ' + e.message);
                        }
                      };
                      row.querySelector('.btn-x-r').addEventListener('click', () => runIa('read'));
                      row.querySelector('.btn-x-d').addEventListener('click', () => runIa('dl'));
                      row.querySelector('.btn-x-c').addEventListener('click', () => runIa('cloud'));
                      chList.appendChild(row);
                    });
                  } catch (e) {
                    chList.innerHTML = `<div style="font-size:12px; color:#ef4444;">Erro ao carregar detalhes: ${escapeHtml(e.message)}</div>`;
                  }
                }
              });
            });
            gridEl.appendChild(card);
          });
          return;
        }

        let books = [];
        if (srcType === 'standardebooks-scrape') {
          statusEl.textContent = 'Fazendo web-scraping no Standard Ebooks...';
          const seUrl = query
            ? `https://standardebooks.org/ebooks?query=${encodeURIComponent(query)}`
            : 'https://standardebooks.org/ebooks';
          const rawSe = await fetchExternalTextOrXml(seUrl);
          books = parseStandardEbooksSearchHtml(rawSe, 'https://standardebooks.org').slice(0, 24);
        } else if (srcType === 'gutendex') {
          const gutLangs = langs.map(l => l.startsWith('pt') ? 'pt' : 'en').join(',');
          const apiUrl = query
            ? `https://gutendex.com/books?search=${encodeURIComponent(query)}&languages=${encodeURIComponent(gutLangs)}`
            : `https://gutendex.com/books?languages=${encodeURIComponent(gutLangs)}`;
          const raw = await fetchExternalTextOrXml(apiUrl);
          const data = JSON.parse(raw);
          (data.results || []).slice(0, 24).forEach(b => {
            const fmts = b.formats || {};
            const epubUrl = fmts['application/epub+zip'] || '';
            if (!epubUrl) return;
            books.push({
              title: b.title || 'Sem título',
              author: (b.authors || []).map(a => a.name).join(', ') || 'Domínio Público',
              coverUrl: fmts['image/jpeg'] || '',
              downloadUrl: epubUrl,
              format: 'EPUB',
              lang: (b.languages || []).join(', ').toUpperCase(),
              source: 'Project Gutenberg',
              tags: Array.isArray(b.subjects) ? b.subjects.slice(0, 8) : [],
              description: (Array.isArray(b.summaries) && b.summaries[0]) ? b.summaries[0] : (b.download_count ? `Obra em domínio público com ${b.download_count.toLocaleString('pt-BR')} downloads no Project Gutenberg.` : '')
            });
          });
        } else if (srcType === 'gutenberg-opds') {
          const feedUrl = query
            ? `https://www.gutenberg.org/ebooks/search.opds/?query=${encodeURIComponent(query)}`
            : 'https://www.gutenberg.org/ebooks/search.opds/';
          const rawFeed = await fetchExternalTextOrXml(feedUrl);
          books = parseOpdsFeedAuto(rawFeed, 'https://www.gutenberg.org').slice(0, 24);
        } else if (srcType === 'wikisource') {
          const wsLangs = langs.map(l => l.startsWith('pt') ? 'pt' : 'en');
          const uniqueWs = [...new Set(wsLangs)];
          const term = query || (uniqueWs.includes('pt') ? 'Machado de Assis' : 'Sherlock Holmes');
          for (const wl of uniqueWs) {
            const apiUrl = `https://${wl}.wikisource.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(term)}&srnamespace=0&srlimit=18&format=json&origin=*`;
            const rawWs = await fetchExternalTextOrXml(apiUrl);
            const wsJson = JSON.parse(rawWs);
            const hits = ((wsJson && wsJson.query && wsJson.query.search) || []).slice().sort((a, b) => {
              const aSub = (a.title || '').includes('/') ? 1 : 0;
              const bSub = (b.title || '').includes('/') ? 1 : 0;
              return aSub - bSub;
            });
            hits.forEach(hit => {
              const t = (hit && hit.title) || '';
              if (!t || books.length >= 24) return;
              const pageSlug = t.replace(/ /g, '_');
              books.push({
                title: t,
                author: wl === 'pt' ? 'Wikisource (PT)' : 'Wikisource (EN)',
                coverUrl: '',
                downloadUrl: `https://ws-export.wmcloud.org/?lang=${wl}&page=${encodeURIComponent(pageSlug)}&format=epub`,
                format: 'EPUB',
                lang: wl.toUpperCase()
              });
            });
          }
        } else if (srcType === 'openlibrary') {
          if (!query) {
            const rawOpds2 = await fetchExternalTextOrXml('https://openlibrary.org/opds/');
            books = parseOpdsFeedAuto(rawOpds2, 'https://openlibrary.org').slice(0, 24);
          } else {
            const olUrl = `https://openlibrary.org/search.json?q=${encodeURIComponent(query)}&has_fulltext=true&limit=24`;
            const raw = await fetchExternalTextOrXml(olUrl);
            const data = JSON.parse(raw);
            (data.docs || []).forEach(doc => {
              const ia = Array.isArray(doc.ia) && doc.ia[0] ? doc.ia[0] : '';
              if (!ia || doc.public_scan_b === false) return;
              books.push({
                title: doc.title || 'Sem título',
                author: Array.isArray(doc.author_name) ? doc.author_name.join(', ') : 'Open Library',
                coverUrl: doc.cover_i ? `https://covers.openlibrary.org/b/id/${doc.cover_i}-M.jpg` : '',
                downloadUrl: `https://archive.org/download/${encodeURIComponent(ia)}/${encodeURIComponent(ia)}.epub`,
                fallbackPdfUrl: `https://archive.org/download/${encodeURIComponent(ia)}/${encodeURIComponent(ia)}.pdf`,
                format: 'EPUB',
                lang: Array.isArray(doc.language) ? doc.language[0].toUpperCase() : '',
                year: doc.first_publish_year ? String(doc.first_publish_year) : '',
                olWorkKey: doc.key || '',
                iaId: ia,
                source: 'Open Library'
              });
            });
          }
        } else if (srcType === 'custom') {
          if (!customUrl) throw new Error('Cole a URL de um catálogo OPDS XML ou JSON primeiro.');
          const targetUrl = query && !customUrl.includes('{searchTerms}')
            ? `${customUrl}${customUrl.includes('?') ? '&' : '?'}q=${encodeURIComponent(query)}`
            : customUrl.replace('{searchTerms}', encodeURIComponent(query));
          const rawFeed = await fetchExternalTextOrXml(targetUrl);
          books = parseOpdsFeedAuto(rawFeed, customUrl).slice(0, 30);
        }

        if (!books.length) {
          statusEl.textContent = 'Nenhum livro com arquivo direto (.epub/.pdf) encontrado para essa busca.';
          return;
        }

        statusEl.textContent = `${books.length} livro(s) público(s) encontrado(s). Clique para ler ou salvar direto na sua Estante & Nuvem:`;
        books.forEach(item => {
          const card = document.createElement('div');
          card.className = 'opds-card';
          const extLow = (item.format || 'EPUB').toLowerCase();
          card.innerHTML = `
            <div class="opds-cover">
              ${item.coverUrl ? `<img src="${escapeHtml(item.coverUrl)}" alt="" loading="lazy" />` : `<span>${escapeHtml(item.format)}</span>`}
            </div>
            <div style="flex:1; min-width:0; display:flex; flex-direction:column; gap:4px;">
              <div style="font-size:12px; font-weight:600; color:var(--text-primary); display:-webkit-box; -webkit-line-clamp:2; -webkit-box-orient:vertical; overflow:hidden;">${escapeHtml(item.title)}</div>
              <div style="font-size:11px; color:var(--text-secondary); white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${escapeHtml(item.author)}${item.lang ? ' · ' + escapeHtml(item.lang) : ''}</div>
              <div style="display:flex; gap:5px; margin-top:4px; flex-wrap:wrap;">
                <button class="btn primary btn-opds-read" style="height:24px; font-size:11px; padding:0 8px;">Baixar &amp; Ler</button>
                <button class="btn btn-opds-cloud" style="height:24px; font-size:11px; padding:0 8px;">+ Nuvem</button>
                <button class="btn btn-opds-expand" style="height:24px; font-size:11px; padding:0 8px;">Expandir ⤢</button>
              </div>
            </div>
          `;

          const resolveDownloadUrl = async () => {
            if (!item.downloadUrl && item.detailUrl && srcType === 'standardebooks-scrape') {
              const detHtml = await fetchExternalTextOrXml(item.detailUrl);
              const parsedDet = parseStandardEbooksDetailHtml(detHtml, 'https://standardebooks.org');
              item.downloadUrl = parsedDet.epubUrl;
              item.description = parsedDet.description;
              item.tags = parsedDet.tags;
            }
            if (!item.downloadUrl) throw new Error('Link de download direto não encontrado.');
            return item.downloadUrl;
          };

          const runOpdsDownload = async (uploadToCloud) => {
            const baseSlug = (item.title || 'livro_opds').replace(/[^a-zA-Z0-9._-]+/g, '_').slice(0, 48);
            const fileName = `${baseSlug}.${extLow}`;
            showToast(`Baixando "${item.title}"...`);
            try {
              const targetDl = await resolveDownloadUrl();
              let buf;
              try {
                buf = await fetchExternalBinary(targetDl);
              } catch (firstErr) {
                if (item.fallbackPdfUrl) {
                  buf = await fetchExternalBinary(item.fallbackPdfUrl);
                } else {
                  throw firstErr;
                }
              }
              await loadFile({ name: fileName, size: buf.byteLength, buffer: buf });
              if (item.coverUrl) {
                resizeImageSrcToCoverThumb(item.coverUrl, 260, 390).then(thumb => {
                  if (thumb && state.bookKey) saveBookCoverDataUrl(state.bookKey, safeCloudFileName(fileName), thumb);
                }).catch(() => {});
              }
              if (uploadToCloud) {
                await uploadBookRecordToCloud({
                  bookKey: state.bookKey,
                  fileName,
                  title: item.title,
                  author: item.author,
                  format: item.format,
                  size: buf.byteLength,
                  totalSections: state.sections.length,
                  buffer: buf
                });
              }
            } catch (dlErr) {
              alert(`Não foi possível baixar "${item.title}": ${dlErr.message}`);
            }
          };

          card.querySelector('.btn-opds-read').addEventListener('click', () => runOpdsDownload(false));
          card.querySelector('.btn-opds-cloud').addEventListener('click', () => runOpdsDownload(true));
          card.querySelector('.btn-opds-expand').addEventListener('click', () => {
            openCatalogDetailModal({
              title: item.title,
              author: item.author,
              coverUrl: item.coverUrl ? item.coverUrl.replace('-M.jpg', '-L.jpg') : '',
              source: item.source || srcType,
              format: item.format || 'EPUB',
              lang: item.lang || '',
              year: item.year || '',
              tags: item.tags || [],
              description: item.description || '',
              hideChaptersSection: true,
              onRender: async ({ badgesEl, tagsEl, descEl, actEl, covEl }) => {
                const bRead = document.createElement('button'); bRead.className = 'btn primary'; bRead.textContent = 'Baixar & Ler Agora';
                bRead.addEventListener('click', () => { closeCatDetail(); runOpdsDownload(false); });
                const bCloud = document.createElement('button'); bCloud.className = 'btn'; bCloud.textContent = '+ Salvar na Nuvem';
                bCloud.addEventListener('click', () => { closeCatDetail(); runOpdsDownload(true); });
                actEl.appendChild(bRead);
                actEl.appendChild(bCloud);
                if (item.detailUrl) {
                  const extA = document.createElement('a'); extA.className = 'btn'; extA.href = item.detailUrl;
                  extA.target = '_blank'; extA.rel = 'noopener noreferrer'; extA.textContent = 'Página Original ↗'; extA.style.textDecoration = 'none';
                  actEl.appendChild(extA);
                }
                if (srcType === 'standardebooks-scrape' && item.detailUrl && !item.description) {
                  try {
                    const detHtml = await fetchExternalTextOrXml(item.detailUrl);
                    const det = parseStandardEbooksDetailHtml(detHtml, 'https://standardebooks.org');
                    item.downloadUrl = det.epubUrl;
                    item.description = det.description;
                    item.tags = det.tags;
                    descEl.textContent = det.description;
                    if (tagsEl) tagsEl.innerHTML = (det.tags || []).map(t => `<span class="catalog-tag-pill">${escapeHtml(t)}</span>`).join('');
                    if (det.wordCount && badgesEl) { const b = document.createElement('span'); b.className = 'book-badge'; b.textContent = det.wordCount; badgesEl.appendChild(b); }
                    if (det.coverUrl && covEl) covEl.innerHTML = `<img src="${escapeHtml(det.coverUrl)}" alt="" />`;
                  } catch { descEl.textContent = 'Edição EPUB gratuita do Standard Ebooks.'; }
                } else if (item.olWorkKey && !item.description) {
                  try {
                    const wRaw = await fetchExternalTextOrXml(`https://openlibrary.org${item.olWorkKey}.json`);
                    const wJson = JSON.parse(wRaw);
                    const dText = typeof wJson.description === 'string' ? wJson.description : (wJson.description && wJson.description.value) || '';
                    descEl.textContent = dText || 'Obra em acesso aberto pela Open Library / Internet Archive.';
                    if (Array.isArray(wJson.subjects) && tagsEl) {
                      tagsEl.innerHTML = wJson.subjects.slice(0, 10).map(s => `<span class="catalog-tag-pill">${escapeHtml(s)}</span>`).join('');
                    }
                  } catch { descEl.textContent = 'Obra em acesso aberto na Open Library.'; }
                } else if (srcType === 'wikisource' && !item.description) {
                  try {
                    const wl = (item.lang || 'PT').toLowerCase().startsWith('pt') ? 'pt' : 'en';
                    const exRaw = await fetchExternalTextOrXml(`https://${wl}.wikisource.org/w/api.php?action=query&prop=extracts|pageimages&exintro=1&explaintext=1&pithumbsize=400&titles=${encodeURIComponent(item.title)}&format=json&origin=*`);
                    const exJson = JSON.parse(exRaw);
                    const pages = (exJson && exJson.query && exJson.query.pages) || {};
                    const pg = Object.values(pages)[0];
                    descEl.textContent = (pg && pg.extract) ? pg.extract.slice(0, 900) : 'Obra em domínio público no Wikisource.';
                    if (pg && pg.thumbnail && pg.thumbnail.source && covEl) {
                      covEl.innerHTML = `<img src="${escapeHtml(pg.thumbnail.source)}" alt="" />`;
                    }
                  } catch { descEl.textContent = 'Obra completa em domínio público no Wikisource.'; }
                } else if (!item.description) {
                  descEl.textContent = `${item.title} — ${item.author}. Clique em "Baixar & Ler Agora" para abrir direto no leitor ou "+ Salvar na Nuvem".`;
                }
              }
            });
          });
          gridEl.appendChild(card);
        });
      } catch (err) {
        statusEl.textContent = 'Erro ao consultar catálogo OPDS: ' + err.message;
      }
    }

    // --- Radar de Séries Seguidas (Mangás / Webtoons) ---
    function getFollowedSeriesList() {
      try { return JSON.parse(localStorage.getItem('reader_followed_series') || '[]'); } catch { return []; }
    }
    function saveFollowedSeriesList(list) {
      try { localStorage.setItem('reader_followed_series', JSON.stringify(list || [])); } catch {}
      const lbl = document.getElementById('lblFollowedSeriesCount');
      if (lbl) lbl.textContent = `${(list || []).length} série(s) seguida(s)`;
    }
    saveFollowedSeriesList(getFollowedSeriesList());
    const btnCheckRadarEl = document.getElementById('btnCheckSeriesUpdates');
    if (btnCheckRadarEl) {
      btnCheckRadarEl.addEventListener('click', async () => {
        const list = getFollowedSeriesList();
        const lbl = document.getElementById('lblFollowedSeriesCount');
        if (!list.length) {
          if (lbl) lbl.textContent = '0 série(s) seguida(s)';
          showToast('Siga um mangá ou webtoon nos catálogos primeiro!', true);
          return;
        }
        btnCheckRadarEl.disabled = true;
        if (lbl) lbl.textContent = `Verificando ${list.length} série(s)...`;
        let updatedCount = 0;
        for (const s of list) {
          if (/mangadex/i.test(s.source || '') && s.key) {
            try {
              const r = await fetch(`https://api.mangadex.org/manga/${encodeURIComponent(s.key)}/aggregate`).then(x => x.json()).catch(() => null);
              if (r && r.volumes) {
                const total = Object.values(r.volumes).reduce((acc, v) => acc + Object.keys(v.chapters || {}).length, 0);
                if (s.lastKnownCount && total > s.lastKnownCount) updatedCount++;
                s.lastKnownCount = total;
                s.checkedAt = Date.now();
              }
            } catch {}
          }
        }
        saveFollowedSeriesList(list);
        btnCheckRadarEl.disabled = false;
        if (lbl) lbl.textContent = updatedCount > 0 ? `${updatedCount} série(s) com novos capítulos!` : `${list.length} série(s) verificada(s) (em dia)`;
        showToast(updatedCount > 0 ? `${updatedCount} série(s) atualizada(s)!` : 'Radar verificado!');
      });
    }

    const btnSearchOpdsEl = document.getElementById('btnSearchOpds');
    const inputOpdsQueryEl = document.getElementById('inputOpdsQuery');
    if (btnSearchOpdsEl) btnSearchOpdsEl.addEventListener('click', searchPublicOpdsCatalog);
    if (inputOpdsQueryEl) {
      inputOpdsQueryEl.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') searchPublicOpdsCatalog();
      });
    }

    // Registro do Service Worker PWA + Indicador Offline + Botão Instalar App
    let deferredPwaPrompt = null;
    const btnInstallPwaEl = document.getElementById('btnInstallPwa');
    window.addEventListener('beforeinstallprompt', (e) => {
      e.preventDefault();
      deferredPwaPrompt = e;
      if (btnInstallPwaEl) btnInstallPwaEl.classList.remove('hidden');
    });
    if (btnInstallPwaEl) {
      btnInstallPwaEl.addEventListener('click', async () => {
        if (!deferredPwaPrompt) return;
        deferredPwaPrompt.prompt();
        const choice = await deferredPwaPrompt.userChoice.catch(() => null);
        deferredPwaPrompt = null;
        if (choice && choice.outcome === 'accepted') {
          btnInstallPwaEl.classList.add('hidden');
          showToast('Aplicativo instalado para leitura offline!');
        }
      });
    }

    function updateOfflineBadgeUi() {
      const el = document.getElementById('lblOfflineStatusBadge');
      if (!el) return;
      if (navigator.onLine) {
        el.textContent = 'Online · Cache Offline Ativo';
        el.classList.remove('is-offline');
      } else {
        el.textContent = 'Modo Offline · Lendo Cache Local';
        el.classList.add('is-offline');
      }
    }
    window.addEventListener('online', () => {
      updateOfflineBadgeUi();
      showToast('Conexão restabelecida — sincronização pronta.');
    });
    window.addEventListener('offline', () => {
      updateOfflineBadgeUi();
      showToast('Sem internet: seus livros locais/abertos seguem disponíveis offline!');
    });
    updateOfflineBadgeUi();

    if (location.protocol.startsWith('http') && 'serviceWorker' in navigator) {
      window.addEventListener('load', () => {
        navigator.serviceWorker.register('./sw.js').catch(() => {});
      });
    }

    applySettings();
    loadAnkiConfigIntoUi();
    updateAuthBadgeUi();
    refreshToolbarUserMenu();
    renderRecentHistory();
    renderBookshelf();
    initCloudAutoConnect();
    renderVocabList();
    testAnkiConnectDecks(true);
  