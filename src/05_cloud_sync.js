    /* =====================================================================
     * 13. BIBLIOTECA NA NUVEM, LOGIN SUPABASE AUTH & SINCRONIZAÇÃO
     * ===================================================================== */
    // Configuração padrão já pronta para uso imediato entre PC e Celular (pode ser sobrescrita em Env Vars ou Avançado)
    const DEFAULT_CLOUD_CONFIG = {
      provider: 'supabase',
      url: 'https://qzkiawbaykyxukrvayzp.supabase.co',
      apiKey: 'sb_publishable_-HyieDEf0jVdNqJ7wBFB9w_D3CbIwId',
      bucket: 'books',
      syncKey: 'minha-estante'
    };

    function healLegacySupabaseUrl(u) {
      const s = (u || '').replace(/\/+$/, '');
      return s.includes('qzkiawbaykxukrvayzp.supabase.co')
        ? s.replace('qzkiawbaykxukrvayzp.supabase.co', 'qzkiawbaykyxukrvayzp.supabase.co')
        : s;
    }

    function isOAuthCloudProvider(provider) {
      return provider === 'gdrive' || provider === 'onedrive';
    }

    function getCloudProviderLabel(provider) {
      if (provider === 'gdrive') return 'Google Drive';
      if (provider === 'onedrive') return 'OneDrive';
      if (provider === 'firebase') return 'Firebase';
      return 'Supabase';
    }

    function formatQuotaCapacityMb(maxMb) {
      const m = Number(maxMb) || 1024;
      if (m >= 10240) return `${(m / 1024).toFixed(0)} GB`;
      if (m >= 2048) return `${(m / 1024).toFixed(1).replace('.0', '')} GB`;
      return `${Math.round(m).toLocaleString('pt-BR')} MB`;
    }

    function isCloudProfileConfigured(cfg) {
      if (!cfg) return false;
      if (cfg.provider === 'firebase') return Boolean(cfg.url);
      if (isOAuthCloudProvider(cfg.provider)) {
        return Boolean(cfg.accessToken || cfg.refreshToken || cfg.clientId);
      }
      return Boolean(cfg.url && cfg.apiKey);
    }

    function isCloudProfileAuthenticated(cfg) {
      if (!cfg) return false;
      if (cfg.provider === 'firebase') return Boolean(cfg.url);
      if (isOAuthCloudProvider(cfg.provider)) return Boolean(cfg.accessToken || cfg.refreshToken);
      return Boolean(cfg.url && cfg.apiKey);
    }

    function getOAuthRedirectUri() {
      try {
        if (typeof window !== 'undefined' && window.location && window.location.origin && window.location.origin !== 'null') {
          return window.location.origin + window.location.pathname;
        }
      } catch {}
      return 'http://localhost:3000/';
    }

    function buildGoogleDriveAuthUrl({ clientId, redirectUri, state }) {
      const params = new URLSearchParams({
        client_id: (clientId || '').trim(),
        redirect_uri: redirectUri || getOAuthRedirectUri(),
        response_type: 'token',
        scope: 'https://www.googleapis.com/auth/drive.readonly https://www.googleapis.com/auth/drive.file https://www.googleapis.com/auth/userinfo.email',
        include_granted_scopes: 'true',
        prompt: 'consent select_account',
        state: state || ('oauth_gdrive_' + Date.now())
      });
      return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
    }

    function buildOneDriveAuthUrl({ clientId, redirectUri, state, codeChallenge }) {
      const params = new URLSearchParams({
        client_id: (clientId || '').trim(),
        redirect_uri: redirectUri || getOAuthRedirectUri(),
        response_type: 'code',
        response_mode: 'query',
        scope: 'Files.ReadWrite Files.ReadWrite.AppFolder User.Read offline_access',
        code_challenge: codeChallenge || '',
        code_challenge_method: 'S256',
        prompt: 'select_account',
        state: state || ('oauth_onedrive_' + Date.now())
      });
      return `https://login.microsoftonline.com/common/oauth2/v2/authorize?${params.toString()}`;
    }

    function parseOAuthFragmentOrQuery(hashStr, searchStr) {
      const cleanHash = (hashStr || '').replace(/^#/, '');
      const cleanSearch = (searchStr || '').replace(/^\?/, '');
      const hp = new URLSearchParams(cleanHash);
      const sp = new URLSearchParams(cleanSearch);
      return {
        accessToken: hp.get('access_token') || sp.get('access_token') || '',
        expiresIn: parseInt(hp.get('expires_in') || sp.get('expires_in') || '0', 10) || 0,
        code: sp.get('code') || hp.get('code') || '',
        state: hp.get('state') || sp.get('state') || '',
        error: hp.get('error') || sp.get('error') || '',
        errorDescription: hp.get('error_description') || sp.get('error_description') || ''
      };
    }

    async function generatePkcePair() {
      const arr = new Uint8Array(48);
      crypto.getRandomValues(arr);
      const verifier = btoa(String.fromCharCode(...arr)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
      const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
      const challenge = btoa(String.fromCharCode(...new Uint8Array(digest))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
      return { verifier, challenge };
    }

    function getDefaultClientIdForProvider(provider) {
      const srv = window.__serverOAuthDefaults || {};
      if (provider === 'gdrive') return srv.gdriveClientId || '';
      if (provider === 'onedrive') return srv.onedriveClientId || '';
      return '';
    }

    function syncProfileToLocalStorage(updatedProf) {
      if (!updatedProf) return updatedProf;
      const cur = getCloudConfig();
      const targetId = updatedProf.profileId || updatedProf.id || cur.profileId || 'default_db';
      const profiles = getCloudProfilesList();
      const idx = profiles.findIndex(p => p.id === targetId);
      if (idx >= 0) {
        profiles[idx] = { ...profiles[idx], ...updatedProf, id: targetId };
        saveCloudProfilesList(profiles);
      }
      if (!cur.profileId || cur.profileId === targetId) {
        localStorage.setItem('reader_cloud_config', JSON.stringify({ ...cur, ...updatedProf, profileId: targetId }));
      }
      return updatedProf;
    }

    function getCloudConfig() {
      try {
        const stored = JSON.parse(localStorage.getItem('reader_cloud_config') || '{}');
        const prov = stored.provider || DEFAULT_CLOUD_CONFIG.provider;
        const isOAuth = isOAuthCloudProvider(prov);
        const fixedUrl = isOAuth ? (stored.url || '') : healLegacySupabaseUrl(stored.url || DEFAULT_CLOUD_CONFIG.url || '');
        if (!isOAuth && stored.url && stored.url !== fixedUrl) {
          stored.url = fixedUrl;
          localStorage.setItem('reader_cloud_config', JSON.stringify(stored));
        }
        return {
          profileId: stored.profileId || 'default_db',
          name: stored.name || '',
          provider: prov,
          url: fixedUrl,
          apiKey: isOAuth ? (stored.apiKey || '') : (stored.apiKey || DEFAULT_CLOUD_CONFIG.apiKey),
          bucket: stored.bucket || DEFAULT_CLOUD_CONFIG.bucket,
          syncKey: stored.syncKey || DEFAULT_CLOUD_CONFIG.syncKey,
          clientId: stored.clientId || getDefaultClientIdForProvider(prov),
          driveFolderId: stored.driveFolderId || '',
          driveFolderSyncKey: stored.driveFolderSyncKey || '',
          tokenExpiresAt: stored.tokenExpiresAt || 0,
          userEmail: stored.userEmail || '',
          accessToken: stored.accessToken || '',
          refreshToken: stored.refreshToken || '',
          perUserProgress: stored.perUserProgress !== false,
          customSyncKey: Boolean(stored.customSyncKey)
        };
      } catch {
        return { ...DEFAULT_CLOUD_CONFIG };
      }
    }

    function updateAuthBadgeUi() {
      const cfg = getCloudConfig();
      const badge = document.getElementById('cloudUserAuthBadge');
      const shelfBtn = document.getElementById('btnShelfCloud');
      const perUserChk = document.getElementById('chkCloudPerUserProgress');
      const supaRow = document.getElementById('supabaseAuthRow');
      if (perUserChk) perUserChk.checked = cfg.perUserProgress !== false;
      if (supaRow) supaRow.classList.toggle('hidden', isOAuthCloudProvider(cfg.provider));
      const provLabel = getCloudProviderLabel(cfg.provider);
      if (isOAuthCloudProvider(cfg.provider)) {
        if (cfg.accessToken || cfg.refreshToken) {
          if (badge) {
            badge.textContent = `${provLabel} conectado (${cfg.userEmail || cfg.syncKey || 'minha-estante'})`;
            badge.style.color = 'var(--accent)';
          }
          if (shelfBtn) shelfBtn.textContent = `${provLabel}: ${(cfg.userEmail || 'Conectado').split('@')[0]}`;
        } else {
          if (badge) {
            badge.textContent = `${provLabel} selecionado — conecte sua conta no painel acima`;
            badge.style.color = 'var(--text-muted)';
          }
          if (shelfBtn) shelfBtn.textContent = `Conectar ${provLabel}`;
        }
      } else if (cfg.userEmail) {
        if (badge) {
          badge.textContent = `Conectado como ${cfg.userEmail} · Estante: ${cfg.syncKey || 'minha-estante'}`;
          badge.style.color = 'var(--accent)';
        }
        if (shelfBtn) shelfBtn.textContent = `Nuvem: ${cfg.userEmail.split('@')[0]}`;
      } else {
        if (badge) {
          badge.textContent = `Modo Estante (${cfg.syncKey || 'minha-estante'}) — entre com e-mail p/ perfil próprio`;
          badge.style.color = 'var(--text-muted)';
        }
        if (shelfBtn) shelfBtn.textContent = 'Entrar / Sincronizar Nuvem';
      }
      if (typeof refreshToolbarUserMenu === 'function') refreshToolbarUserMenu();
    }

    function getCloudProfilesList() {
      try {
        const list = JSON.parse(localStorage.getItem('reader_cloud_profiles') || '[]');
        if (Array.isArray(list) && list.length) {
          let changed = false;
          const healed = list.map((p, idx) => {
            if (!p || typeof p !== 'object') return p;
            let next = { ...p };
            if (!next.name || !String(next.name).trim()) {
              next.name = isOAuthCloudProvider(next.provider)
                ? `Meu ${getCloudProviderLabel(next.provider)}`
                : (idx === 0 ? 'Banco Principal (Supabase)' : `Banco ${idx + 1}`);
              changed = true;
            }
            if (!isOAuthCloudProvider(next.provider) && next.provider !== 'firebase') {
              const fixedU = healLegacySupabaseUrl(next.url || DEFAULT_CLOUD_CONFIG.url || '');
              const fixedK = next.apiKey || DEFAULT_CLOUD_CONFIG.apiKey || '';
              if (fixedU !== next.url || fixedK !== next.apiKey) {
                next.url = fixedU;
                next.apiKey = fixedK;
                changed = true;
              }
            }
            return next;
          });
          if (changed) localStorage.setItem('reader_cloud_profiles', JSON.stringify(healed));
          return healed;
        }
      } catch {}
      const def = { id: 'default_db', name: 'Banco Principal (Supabase)', ...DEFAULT_CLOUD_CONFIG };
      localStorage.setItem('reader_cloud_profiles', JSON.stringify([def]));
      return [def];
    }

    function saveCloudProfilesList(list) {
      localStorage.setItem('reader_cloud_profiles', JSON.stringify(list));
    }

    function renderCloudProfilesSelect() {
      const sel = document.getElementById('selectCloudProfile');
      const countLbl = document.getElementById('lblCloudProfilesCount');
      if (!sel) return;
      const list = getCloudProfilesList();
      const cur = getCloudConfig();
      const activeId = cur.profileId || list[0].id;
      sel.innerHTML = '';
      list.forEach(p => {
        const opt = document.createElement('option');
        opt.value = p.id;
        opt.textContent = `${p.name} (${getCloudProviderLabel(p.provider)} · ${p.syncKey || 'estante'})`;
        sel.appendChild(opt);
      });
      if (list.some(p => p.id === activeId)) sel.value = activeId;
      if (countLbl) countLbl.textContent = `${list.length} banco(s) conectado(s)`;
    }

    let __oauthGuideManualToggle = null;
    function renderOAuthProviderSetupUi(forceProvider = null) {
      const box = document.getElementById('oauthProviderSetupBox');
      if (!box) return;
      const cfg = getCloudConfig();
      const prov = forceProvider || cfg.provider || 'supabase';
      if (!isOAuthCloudProvider(prov)) {
        box.classList.add('hidden');
        return;
      }
      box.classList.remove('hidden');
      const titleEl = document.getElementById('lblOAuthSetupTitle');
      const badgeEl = document.getElementById('lblOAuthAuthBadge');
      const clientInput = document.getElementById('inputOAuthClientId');
      const redirectInput = document.getElementById('inputOAuthRedirectUri');
      const guideEl = document.getElementById('oauthGuideSteps');
      const btnDisc = document.getElementById('btnDisconnectOAuth');
      const btnBrowse = document.getElementById('btnBrowsePersonalDriveFolders');

      const redirectUri = getOAuthRedirectUri();
      if (redirectInput) redirectInput.value = redirectUri;
      const effectiveClientId = cfg.provider === prov ? (cfg.clientId || getDefaultClientIdForProvider(prov)) : getDefaultClientIdForProvider(prov);
      if (clientInput) {
        clientInput.value = effectiveClientId;
        clientInput.placeholder = prov === 'gdrive'
          ? 'Ex: 1234567890-abc....apps.googleusercontent.com'
          : 'Ex: a1b2c3d4-e5f6-7890-abcd-1234567890ef';
      }

      const isAuthed = cfg.provider === prov && Boolean(cfg.accessToken || cfg.refreshToken);
      if (titleEl) {
        titleEl.textContent = prov === 'gdrive'
          ? 'Google Drive Pessoal (15 GB grátis — seus livros ficam só no seu Drive)'
          : 'Microsoft OneDrive Pessoal (5 GB grátis — pasta dedicada do leitor)';
      }
      if (badgeEl) {
        if (isAuthed) {
          badgeEl.textContent = `Conectado: ${cfg.userEmail || 'Conta autorizada'}`;
          badgeEl.style.color = 'var(--accent)';
        } else {
          badgeEl.textContent = 'Aguardando conexão da sua conta';
          badgeEl.style.color = 'var(--text-muted)';
        }
      }
      if (btnDisc) btnDisc.classList.toggle('hidden', !isAuthed);
      if (btnBrowse) btnBrowse.classList.toggle('hidden', !isAuthed);

      if (guideEl) {
        const showGuide = __oauthGuideManualToggle !== null ? __oauthGuideManualToggle : !isAuthed;
        guideEl.classList.toggle('hidden', !showGuide);
        if (prov === 'gdrive') {
          guideEl.innerHTML = `
            <div style="font-weight:700; color:var(--text-primary); margin-bottom:4px;">Passo a passo rápido para pegar seu Client ID grátis no Google (~2 min, faz só 1 vez):</div>
            <div style="margin-bottom:6px; color:var(--text-muted);">Como este leitor roda direto no seu navegador (sem servidor intermediário com sua senha), o Google pede um código gratuito chamado <strong>Client ID</strong> para liberar a pasta <code>LeitorPortatil_${escapeHtml(cfg.syncKey || 'minha-estante')}</code> no seu Drive.</div>
            <ol style="margin:0; padding-left:18px; display:flex; flex-direction:column; gap:4px;">
              <li>Ative a API gratuita clicando aqui: <a href="https://console.cloud.google.com/apis/library/drive.googleapis.com" target="_blank" rel="noopener" style="color:var(--accent); font-weight:600; text-decoration:underline;">Abrir Google Drive API no Google Cloud</a> → clique em <strong>Ativar / Enable</strong> (se pedir, crie um projeto novo com qualquer nome).</li>
              <li>Configure quem pode usar em <a href="https://console.cloud.google.com/auth/audience" target="_blank" rel="noopener" style="color:var(--accent); font-weight:600; text-decoration:underline;">Tela de Permissão OAuth (Audience)</a> → selecione <strong>Externo</strong>, dê um nome (ex: <code>Meu Leitor</code>) e adicione <strong>o seu próprio e-mail do Gmail</strong> em <em>Test users / Usuários de teste</em>.</li>
              <li>Agora abra <a href="https://console.cloud.google.com/apis/credentials" target="_blank" rel="noopener" style="color:var(--accent); font-weight:600; text-decoration:underline;">Credenciais (Credentials)</a> → <strong>+ Criar credenciais</strong> → <strong>ID do cliente OAuth</strong> → Tipo: <strong>Aplicativo da Web (Web application)</strong>.</li>
              <li>Em <strong>Origens JavaScript autorizadas</strong> e em <strong>URIs de redirecionamento autorizados</strong>, cole exatamente esta URL: <code>${escapeHtml(redirectUri)}</code> (use o botão <em>Copiar URL</em> acima!).</li>
              <li>Clique em <strong>Criar</strong>, copie o <strong>ID do cliente</strong> (termina com <code>.apps.googleusercontent.com</code>), cole no campo acima e clique em <strong>Conectar Conta Agora</strong>!</li>
            </ol>
          `;
        } else {
          guideEl.innerHTML = `
            <div style="font-weight:700; color:var(--text-primary); margin-bottom:4px;">Passo a passo rápido para pegar seu Application (Client) ID grátis na Microsoft (~2 min):</div>
            <div style="margin-bottom:6px; color:var(--text-muted);">Para salvar livros direto na pasta do leitor no seu OneDrive pessoal (Outlook/Hotmail/Live), a Microsoft pede um código gratuito chamado <strong>Application (client) ID</strong>.</div>
            <ol style="margin:0; padding-left:18px; display:flex; flex-direction:column; gap:4px;">
              <li>Acesse direto o formulário: <a href="https://portal.azure.com/#view/Microsoft_AAD_RegisteredApps/CreateApplicationBlade" target="_blank" rel="noopener" style="color:var(--accent); font-weight:600; text-decoration:underline;">Registrar Aplicativo no Portal Azure / Microsoft</a> (entre com sua conta Microsoft pessoal gratuita).</li>
              <li>Em <strong>Nome</strong>, digite <code>Meu Leitor</code>. Em <strong>Tipos de conta com suporte</strong>, escolha a opção que inclui <strong>Contas pessoais da Microsoft</strong> (ex: <em>Qualquer diretório organizacional e contas pessoais da Microsoft</em>).</li>
              <li>Em <strong>URI de Redirecionamento</strong>, selecione a plataforma <strong>Aplicativo de página única (SPA)</strong> e cole exatamente esta URL: <code>${escapeHtml(redirectUri)}</code> (use o botão <em>Copiar URL</em> acima!). Clique em <strong>Registrar</strong>.</li>
              <li>Na tela seguinte (Visão Geral), copie o campo <strong>ID do aplicativo (cliente)</strong>, cole no campo acima e clique em <strong>Conectar Conta Agora</strong>! (O leitor cria a pasta automaticamente dentro de <code>Aplicativos</code> no seu OneDrive e renova seu login sozinho).</li>
            </ol>
          `;
        }
      }
    }

    function loadCloudConfigIntoUi() {
      renderCloudProfilesSelect();
      const cfg = getCloudConfig();
      document.getElementById('selectCloudProvider').value = cfg.provider || 'supabase';
      document.getElementById('inputCloudSyncKey').value = cfg.syncKey || 'minha-estante';
      document.getElementById('inputCloudUrl').value = cfg.url || '';
      document.getElementById('inputCloudKey').value = cfg.apiKey || '';
      document.getElementById('inputCloudBucket').value = cfg.bucket || 'books';
      document.getElementById('inputAuthEmail').value = cfg.userEmail || '';
      renderOAuthProviderSetupUi(cfg.provider);
      updateAuthBadgeUi();
    }

    const openCloudModalFn = () => {
      const dd = document.getElementById('userProfileDropdown');
      if (dd) dd.classList.remove('open');
      loadCloudConfigIntoUi();
      document.getElementById('cloudModal').classList.add('open');
      listCloudBooks().catch(() => {});
    };
    document.getElementById('btnCloudSync').addEventListener('click', openCloudModalFn);
    const btnShelfCloudEl = document.getElementById('btnShelfCloud');
    if (btnShelfCloudEl) btnShelfCloudEl.addEventListener('click', openCloudModalFn);
    document.getElementById('btnCloseCloudModal').addEventListener('click', () => {
      document.getElementById('cloudModal').classList.remove('open');
    });
    document.getElementById('btnCloseCloudFooter').addEventListener('click', () => {
      document.getElementById('cloudModal').classList.remove('open');
    });

    document.getElementById('btnSaveCloudConfig').addEventListener('click', () => {
      const prev = getCloudConfig();
      const activeId = document.getElementById('selectCloudProfile') ? document.getElementById('selectCloudProfile').value : (prev.profileId || 'default_db');
      const nextProv = document.getElementById('selectCloudProvider').value;
      const nextKey = (document.getElementById('inputCloudSyncKey').value.trim() || 'minha-estante').replace(/[^a-zA-Z0-9_-]/g, '_');
      const oauthClientInput = document.getElementById('inputOAuthClientId');
      const nextClientId = (oauthClientInput && isOAuthCloudProvider(nextProv)) ? oauthClientInput.value.trim() : (prev.clientId || '');
      const cfg = {
        ...prev,
        profileId: activeId,
        provider: nextProv,
        syncKey: nextKey,
        clientId: nextClientId,
        url: isOAuthCloudProvider(nextProv) ? '' : document.getElementById('inputCloudUrl').value.trim().replace(/\/+$/, ''),
        apiKey: isOAuthCloudProvider(nextProv) ? '' : document.getElementById('inputCloudKey').value.trim(),
        bucket: document.getElementById('inputCloudBucket').value.trim() || 'books',
        perUserProgress: document.getElementById('chkCloudPerUserProgress') ? document.getElementById('chkCloudPerUserProgress').checked : true,
        customSyncKey: prev.customSyncKey || (nextKey !== 'minha-estante' && nextKey !== (prev.userEmail ? prev.userEmail.split('@')[0].replace(/[^a-zA-Z0-9_-]/g, '_') : ''))
      };
      localStorage.setItem('reader_cloud_config', JSON.stringify(cfg));
      const profiles = getCloudProfilesList();
      const idx = profiles.findIndex(p => p.id === activeId);
      if (idx >= 0) {
        profiles[idx] = { ...profiles[idx], ...cfg };
        saveCloudProfilesList(profiles);
        renderCloudProfilesSelect();
      }
      renderOAuthProviderSetupUi(nextProv);
      updateAuthBadgeUi();
      document.getElementById('cloudStatusMsg').textContent = 'Configuração salva no banco ativo!';
      showToast('Configuração de Nuvem salva!');
    });

    async function activateOrAddPersonalCloudProvider(provider) {
      __oauthGuideManualToggle = null;
      const profiles = getCloudProfilesList();
      let target = profiles.find(p => p.provider === provider);
      if (!target) {
        const defaultName = provider === 'gdrive' ? 'Meu Google Drive' : 'Meu Microsoft OneDrive';
        target = {
          id: `${provider}_${Date.now()}`,
          name: defaultName,
          provider,
          url: '',
          apiKey: '',
          bucket: 'books',
          syncKey: (getCloudConfig().syncKey || 'minha-estante').replace(/[^a-zA-Z0-9_-]/g, '_'),
          clientId: getDefaultClientIdForProvider(provider),
          userEmail: '',
          accessToken: '',
          refreshToken: '',
          tokenExpiresAt: 0
        };
        profiles.push(target);
        saveCloudProfilesList(profiles);
      }
      localStorage.setItem('reader_cloud_config', JSON.stringify({ ...target, profileId: target.id }));
      loadCloudConfigIntoUi();
      const setupBox = document.getElementById('oauthProviderSetupBox');
      if (setupBox) setupBox.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      const statusEl = document.getElementById('cloudStatusMsg');
      if (statusEl) {
        statusEl.textContent = (target.accessToken || target.refreshToken)
          ? `${getCloudProviderLabel(provider)} selecionado!`
          : `Siga o guia acima (ou cole seu Client ID) e clique em Conectar Conta Agora.`;
      }
      if (target.accessToken || target.refreshToken) {
        listCloudBooks().catch(() => {});
      }
    }

    const btnQuickGDriveEl = document.getElementById('btnQuickConnectGDrive');
    if (btnQuickGDriveEl) btnQuickGDriveEl.addEventListener('click', () => activateOrAddPersonalCloudProvider('gdrive'));
    const btnQuickOneDriveEl = document.getElementById('btnQuickConnectOneDrive');
    if (btnQuickOneDriveEl) btnQuickOneDriveEl.addEventListener('click', () => activateOrAddPersonalCloudProvider('onedrive'));

    const selectCloudProvEl = document.getElementById('selectCloudProvider');
    if (selectCloudProvEl) {
      selectCloudProvEl.addEventListener('change', () => {
        __oauthGuideManualToggle = null;
        renderOAuthProviderSetupUi(selectCloudProvEl.value);
      });
    }

    const btnToggleGuideEl = document.getElementById('btnToggleOAuthGuide');
    if (btnToggleGuideEl) {
      btnToggleGuideEl.addEventListener('click', () => {
        const guideEl = document.getElementById('oauthGuideSteps');
        if (!guideEl) return;
        __oauthGuideManualToggle = guideEl.classList.contains('hidden');
        guideEl.classList.toggle('hidden', !__oauthGuideManualToggle);
      });
    }

    const btnCopyRedirectEl = document.getElementById('btnCopyOAuthRedirect');
    if (btnCopyRedirectEl) {
      btnCopyRedirectEl.addEventListener('click', () => {
        const u = getOAuthRedirectUri();
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(u).then(() => showToast('URL de redirecionamento copiada!')).catch(() => prompt('Copie a URL:', u));
        } else {
          prompt('Copie a URL:', u);
        }
      });
    }

    const btnDisconnectOAuthEl = document.getElementById('btnDisconnectOAuth');
    if (btnDisconnectOAuthEl) {
      btnDisconnectOAuthEl.addEventListener('click', () => {
        const cfg = getCloudConfig();
        const cleared = { ...cfg, accessToken: '', refreshToken: '', tokenExpiresAt: 0, userEmail: '', driveFolderId: '' };
        syncProfileToLocalStorage(cleared);
        loadCloudConfigIntoUi();
        renderBookshelf();
        document.getElementById('cloudStatusMsg').textContent = `${getCloudProviderLabel(cfg.provider)} desconectado.`;
        showToast('Conta desconectada.');
      });
    }

    let __driveBrowserStack = [];
    let __driveBrowserItems = [];
    const SUPPORTED_DRIVE_BOOK_RE = /\.(epub|mobi|azw|azw3|prc|pdf|cbz|zip|fb2|md|txt|html)$/i;

    function renderDriveBrowserList(filterText = '') {
      const listEl = document.getElementById('driveBrowserList');
      const bcEl = document.getElementById('driveBrowserBreadcrumb');
      const backBtn = document.getElementById('btnDriveBrowserBack');
      if (!listEl) return;
      if (bcEl) bcEl.textContent = __driveBrowserStack.map(s => s.name).join(' › ');
      if (backBtn) backBtn.disabled = __driveBrowserStack.length <= 1;

      const q = (filterText || '').trim().toLowerCase();
      const visible = __driveBrowserItems.filter(it => !q || (it.name || '').toLowerCase().includes(q));
      if (!visible.length) {
        listEl.innerHTML = '<div style="padding:14px; text-align:center; color:var(--text-muted);">Nenhuma pasta ou livro compatível (.epub, .pdf, .cbz, .mobi, .azw3...) encontrado aqui.</div>';
        return;
      }

      listEl.innerHTML = '';
      visible.forEach(item => {
        const row = document.createElement('div');
        row.className = 'card-item';
        row.style.cssText = 'display:flex; align-items:center; justify-content:space-between; gap:10px;';
        if (item.isFolder) {
          row.innerHTML = `
            <div style="font-weight:600; color:var(--text-primary); overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">📁 ${escapeHtml(item.name)}</div>
            <button class="tb-btn tb-btn-solid btn-open-drive-folder" style="height:26px; font-size:11px; flex-shrink:0;">Abrir Pasta</button>
          `;
          row.querySelector('.btn-open-drive-folder').addEventListener('click', () => {
            __driveBrowserStack.push({ id: item.id, name: item.name });
            loadDriveFolderItems(item.id);
          });
        } else {
          const ext = (item.name.split('.').pop() || 'LIVRO').toUpperCase();
          const sz = item.size ? (item.size > 1048576 ? (item.size / 1048576).toFixed(2) + ' MB' : Math.round(item.size / 1024) + ' KB') : '';
          row.innerHTML = `
            <div style="min-width:0; flex:1;">
              <div style="font-weight:500; color:var(--text-primary); overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${escapeHtml(item.name)}</div>
              <div style="font-size:10.5px; color:var(--text-muted);">${escapeHtml(ext)}${sz ? ' · ' + sz : ''}</div>
            </div>
            <button class="btn primary btn-read-drive-file" style="flex-shrink:0;">Baixar e Ler</button>
          `;
          row.querySelector('.btn-read-drive-file').addEventListener('click', async () => {
            const stEl = document.getElementById('lblDriveBrowserStatus');
            if (stEl) stEl.textContent = `Baixando "${item.name}" para abrir no leitor...`;
            try {
              const cfg = await ensureFreshOAuthToken(getCloudConfig());
              if (!cfg.accessToken || cfg._tokenExpired) throw new Error('Sessão expirada. Reconecte sua conta.');
              const dlUrl = cfg.provider === 'gdrive'
                ? `https://www.googleapis.com/drive/v3/files/${item.id}?alt=media`
                : `https://graph.microsoft.com/v1.0/me/drive/items/${item.id}/content`;
              const r = await fetch(dlUrl, { headers: { Authorization: `Bearer ${cfg.accessToken}` } });
              if (!r.ok) throw new Error(`HTTP ${r.status}`);
              const buf = await r.arrayBuffer();
              document.getElementById('cloudDriveBrowserModal').classList.remove('open');
              document.getElementById('cloudModal').classList.remove('open');
              await loadFile({ name: item.name, size: buf.byteLength, buffer: buf });
              showToast(`"${item.name}" aberto e salvo offline na Estante!`);
            } catch (err) {
              if (stEl) stEl.textContent = 'Erro ao baixar: ' + err.message;
              alert('Erro ao abrir arquivo do Drive: ' + err.message);
            }
          });
        }
        listEl.appendChild(row);
      });
    }

    async function loadDriveFolderItems(folderId) {
      const listEl = document.getElementById('driveBrowserList');
      const stEl = document.getElementById('lblDriveBrowserStatus');
      const filterEl = document.getElementById('inputFilterDriveBrowser');
      if (filterEl) filterEl.value = '';
      if (listEl) listEl.innerHTML = '<div style="padding:14px; text-align:center; color:var(--text-muted);">Consultando pastas e arquivos...</div>';

      const cfg = await ensureFreshOAuthToken(getCloudConfig());
      if (!cfg.accessToken || cfg._tokenExpired) {
        if (stEl) stEl.textContent = 'Sessão expirada — clique em Conectar Conta Agora.';
        return;
      }
      if (stEl) stEl.textContent = 'Carregando...';
      try {
        let rawItems = [];
        if (cfg.provider === 'gdrive') {
          const parent = folderId || 'root';
          const q = `'${parent.replace(/'/g, "\\'")}' in parents and trashed=false`;
          const u = `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(q)}&orderBy=folder,name&fields=files(id,name,mimeType,size)&pageSize=200`;
          const r = await fetch(u, { cache: 'no-store', headers: { Authorization: `Bearer ${cfg.accessToken}` } });
          if (r.status === 403) throw new Error('Permissão para ler outras pastas ainda não liberada nesta conexão — clique em "Conectar Conta Agora" para atualizar.');
          if (!r.ok) throw new Error(`Google Drive HTTP ${r.status}`);
          const j = await r.json();
          rawItems = (j.files || []).map(f => ({
            id: f.id,
            name: f.name,
            size: Number(f.size || 0),
            isFolder: f.mimeType === 'application/vnd.google-apps.folder'
          }));
        } else if (cfg.provider === 'onedrive') {
          const u = folderId
            ? `https://graph.microsoft.com/v1.0/me/drive/items/${folderId}/children?$top=200&$select=id,name,size,folder,file`
            : `https://graph.microsoft.com/v1.0/me/drive/root/children?$top=200&$select=id,name,size,folder,file`;
          const r = await fetch(u, { cache: 'no-store', headers: { Authorization: `Bearer ${cfg.accessToken}` } });
          if (r.status === 403) throw new Error('Permissão de leitura de pastas não liberada — reconecte o OneDrive.');
          if (!r.ok) throw new Error(`OneDrive HTTP ${r.status}`);
          const j = await r.json();
          rawItems = (j.value || []).map(it => ({
            id: it.id,
            name: it.name,
            size: Number(it.size || 0),
            isFolder: Boolean(it.folder)
          }));
        }
        __driveBrowserItems = rawItems
          .filter(it => it.isFolder || SUPPORTED_DRIVE_BOOK_RE.test(it.name || ''))
          .sort((a, b) => (a.isFolder === b.isFolder ? naturalCompareTitles(a.name, b.name) : (a.isFolder ? -1 : 1)));
        renderDriveBrowserList('');
        if (stEl) stEl.textContent = `${__driveBrowserItems.filter(x => x.isFolder).length} pasta(s) · ${__driveBrowserItems.filter(x => !x.isFolder).length} livro(s)/HQ(s)`;
      } catch (err) {
        if (listEl) listEl.innerHTML = `<div style="padding:12px; color:#ef4444;">${escapeHtml(err.message)}</div>`;
        if (stEl) stEl.textContent = 'Falha ao carregar pasta.';
      }
    }

    function openDriveFolderBrowserModal() {
      const cfg = getCloudConfig();
      if (!isOAuthCloudProvider(cfg.provider) || (!cfg.accessToken && !cfg.refreshToken)) {
        alert('Conecte sua conta Google Drive ou OneDrive primeiro.');
        return;
      }
      const rootName = cfg.provider === 'gdrive' ? 'Meu Google Drive' : 'Meu OneDrive';
      const titleEl = document.getElementById('lblDriveBrowserTitle');
      if (titleEl) titleEl.textContent = `Explorar Pastas (${rootName})`;
      __driveBrowserStack = [{ id: cfg.provider === 'gdrive' ? 'root' : '', name: rootName }];
      document.getElementById('cloudDriveBrowserModal').classList.add('open');
      loadDriveFolderItems(__driveBrowserStack[0].id);
    }

    const btnBrowseDriveEl = document.getElementById('btnBrowsePersonalDriveFolders');
    if (btnBrowseDriveEl) btnBrowseDriveEl.addEventListener('click', openDriveFolderBrowserModal);
    const btnCloseDb1 = document.getElementById('btnCloseDriveBrowserModal');
    if (btnCloseDb1) btnCloseDb1.addEventListener('click', () => document.getElementById('cloudDriveBrowserModal').classList.remove('open'));
    const btnCloseDb2 = document.getElementById('btnCloseDriveBrowserFooter');
    if (btnCloseDb2) btnCloseDb2.addEventListener('click', () => document.getElementById('cloudDriveBrowserModal').classList.remove('open'));
    const btnBackDb = document.getElementById('btnDriveBrowserBack');
    if (btnBackDb) {
      btnBackDb.addEventListener('click', () => {
        if (__driveBrowserStack.length > 1) {
          __driveBrowserStack.pop();
          loadDriveFolderItems(__driveBrowserStack[__driveBrowserStack.length - 1].id);
        }
      });
    }
    const btnRefreshDb = document.getElementById('btnDriveBrowserRefresh');
    if (btnRefreshDb) {
      btnRefreshDb.addEventListener('click', () => {
        const cur = __driveBrowserStack[__driveBrowserStack.length - 1];
        if (cur) loadDriveFolderItems(cur.id);
      });
    }
    const inpFilterDb = document.getElementById('inputFilterDriveBrowser');
    if (inpFilterDb) inpFilterDb.addEventListener('input', () => renderDriveBrowserList(inpFilterDb.value));

    const btnImportFolderDb = document.getElementById('btnDriveBrowserImportFolder');
    if (btnImportFolderDb) {
      btnImportFolderDb.addEventListener('click', async () => {
        const bookExts = /\.(epub|pdf|cbz|cbr|zip|txt|fb2|mobi|azw3|docx|doc|odt|rtf|md|html?)$/i;
        const files = (__driveBrowserItems || []).filter(it => !it.isFolder && bookExts.test(it.name || ''));
        if (!files.length) {
          showToast('Nenhum arquivo de livro/mangá encontrado nesta pasta.', true);
          return;
        }
        if (!confirm(`Importar ${files.length} arquivo(s) desta pasta para a Estante local?`)) return;
        const statusEl = document.getElementById('lblDriveBrowserStatus');
        btnImportFolderDb.disabled = true;
        let okCount = 0;
        try {
          const profiles = getCloudProfilesList();
          const prof = profiles.find(p => p.id === __driveBrowserProfileId);
          if (!prof) throw new Error('Perfil não encontrado.');
          const token = await ensureFreshOAuthToken(prof);
          for (let i = 0; i < files.length; i++) {
            const f = files[i];
            if (statusEl) statusEl.textContent = `Importando ${i + 1}/${files.length}: ${f.name}`;
            const url = prof.provider === 'gdrive'
              ? `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(f.id)}?alt=media`
              : `https://graph.microsoft.com/v1.0/me/drive/items/${encodeURIComponent(f.id)}/content`;
            const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
            if (!res.ok) continue;
            const buf = await res.arrayBuffer();
            const safeName = f.name;
            const title = safeName.replace(/\.[^.]+$/, '');
            const ext = (safeName.split('.').pop() || 'BIN').toUpperCase();
            const bookKey = 'drive_' + safeName.toLowerCase().replace(/[^a-z0-9]/g, '_');
            await idbSaveBook({
              bookKey,
              title,
              author: 'Importado da Nuvem',
              format: ext,
              fileName: safeName,
              safeName,
              size: buf.byteLength,
              buffer: buf,
              savedAt: Date.now()
            });
            okCount++;
          }
          if (statusEl) statusEl.textContent = `${okCount} livro(s) importado(s) com sucesso!`;
          if (typeof renderBookshelf === 'function') renderBookshelf();
          showToast(`${okCount} arquivo(s) importado(s) para sua Estante!`);
        } catch (err) {
          if (statusEl) statusEl.textContent = 'Erro na importação em lote: ' + err.message;
          showToast('Erro ao importar pasta: ' + err.message, true);
        } finally {
          btnImportFolderDb.disabled = false;
        }
      });
    }

    async function completeOAuthTokenResult(provider, profileId, parsed, codeVerifier = '', redirectUri = '') {
      let accessToken = parsed.accessToken || '';
      let refreshToken = '';
      let expiresIn = parsed.expiresIn || 3600;
      if (provider === 'onedrive' && parsed.code) {
        const profiles = getCloudProfilesList();
        const prof = profiles.find(p => p.id === profileId) || getCloudConfig();
        const clientId = prof.clientId || getDefaultClientIdForProvider('onedrive');
        const body = new URLSearchParams({
          client_id: clientId,
          grant_type: 'authorization_code',
          code: parsed.code,
          redirect_uri: redirectUri || getOAuthRedirectUri(),
          code_verifier: codeVerifier || ''
        });
        const tokRes = await fetch('https://login.microsoftonline.com/common/oauth2/v2.0/token', {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: body.toString()
        });
        const tokJson = await tokRes.json().catch(() => ({}));
        if (!tokRes.ok || !tokJson.access_token) {
          throw new Error(tokJson.error_description || tokJson.error || `Erro HTTP ${tokRes.status} ao trocar código OAuth`);
        }
        accessToken = tokJson.access_token;
        refreshToken = tokJson.refresh_token || '';
        expiresIn = tokJson.expires_in || 3600;
      }
      if (!accessToken) throw new Error(parsed.errorDescription || parsed.error || 'Token não retornado pelo provedor.');

      let userEmail = '';
      try {
        if (provider === 'gdrive') {
          const uRes = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', { headers: { Authorization: `Bearer ${accessToken}` } });
          if (uRes.ok) { const uj = await uRes.json(); userEmail = uj.email || ''; }
        } else if (provider === 'onedrive') {
          const uRes = await fetch('https://graph.microsoft.com/v1.0/me?$select=userPrincipalName,mail,displayName', { headers: { Authorization: `Bearer ${accessToken}` } });
          if (uRes.ok) { const uj = await uRes.json(); userEmail = uj.mail || uj.userPrincipalName || uj.displayName || ''; }
        }
      } catch {}

      const profiles = getCloudProfilesList();
      const targetProf = profiles.find(p => p.id === profileId) || getCloudConfig();
      const updated = {
        ...targetProf,
        profileId: targetProf.id || profileId,
        provider,
        accessToken,
        refreshToken: refreshToken || targetProf.refreshToken || '',
        tokenExpiresAt: Date.now() + (expiresIn * 1000),
        userEmail: userEmail || targetProf.userEmail || '',
        driveFolderId: ''
      };
      syncProfileToLocalStorage(updated);
      return updated;
    }

    const btnConnectOAuthNowEl = document.getElementById('btnConnectOAuthNow');
    if (btnConnectOAuthNowEl) {
      btnConnectOAuthNowEl.addEventListener('click', async () => {
        const clientId = (document.getElementById('inputOAuthClientId').value || '').trim();
        const cfg = getCloudConfig();
        const prov = isOAuthCloudProvider(document.getElementById('selectCloudProvider').value)
          ? document.getElementById('selectCloudProvider').value
          : cfg.provider;
        const statusEl = document.getElementById('cloudStatusMsg');
        if (!clientId) {
          __oauthGuideManualToggle = true;
          renderOAuthProviderSetupUi(prov);
          if (statusEl) statusEl.textContent = 'Cole o Client ID primeiro — o passo a passo com o link direto está aberto acima.';
          showToast('Siga os 4 passos acima para obter seu Client ID!');
          return;
        }
        // Salva clientId + syncKey no perfil ativo
        const nextKey = (document.getElementById('inputCloudSyncKey').value.trim() || cfg.syncKey || 'minha-estante').replace(/[^a-zA-Z0-9_-]/g, '_');
        const updatedCfg = syncProfileToLocalStorage({ ...cfg, provider: prov, clientId, syncKey: nextKey });

        const redirectUri = getOAuthRedirectUri();
        const stateId = `oauth_${prov}_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
        let codeVerifier = '';
        let authUrl = '';
        if (prov === 'gdrive') {
          authUrl = buildGoogleDriveAuthUrl({ clientId, redirectUri, state: stateId });
        } else {
          const pkce = await generatePkcePair();
          codeVerifier = pkce.verifier;
          authUrl = buildOneDriveAuthUrl({ clientId, redirectUri, state: stateId, codeChallenge: pkce.challenge });
        }

        localStorage.setItem('reader_oauth_pending', JSON.stringify({
          state: stateId,
          provider: prov,
          profileId: updatedCfg.profileId || updatedCfg.id,
          codeVerifier,
          redirectUri,
          ts: Date.now()
        }));

        const w = 520, h = 650;
        const left = Math.max(0, (screen.width - w) / 2);
        const top = Math.max(0, (screen.height - h) / 2);
        const popup = window.open(authUrl, 'reader_oauth_popup', `width=${w},height=${h},left=${left},top=${top}`);
        if (!popup) {
          if (statusEl) statusEl.textContent = 'Redirecionando para autorizar sua conta...';
          window.location.href = authUrl;
          return;
        }
        if (statusEl) statusEl.textContent = `Aguardando autorização na janela do ${getCloudProviderLabel(prov)}...`;

        const onOAuthMsg = async (ev) => {
          if (ev.origin !== window.location.origin || !ev.data || ev.data.type !== 'reader-oauth-callback') return;
          if (ev.data.parsed && ev.data.parsed.state && ev.data.parsed.state !== stateId) return;
          window.removeEventListener('message', onOAuthMsg);
          try {
            if (ev.data.parsed && ev.data.parsed.error) {
              throw new Error(ev.data.parsed.errorDescription || ev.data.parsed.error);
            }
            const authed = await completeOAuthTokenResult(prov, updatedCfg.profileId || updatedCfg.id, ev.data.parsed, codeVerifier, redirectUri);
            localStorage.removeItem('reader_oauth_pending');
            __oauthGuideManualToggle = false;
            loadCloudConfigIntoUi();
            if (statusEl) statusEl.textContent = `${getCloudProviderLabel(prov)} conectado (${authed.userEmail || 'pronto'})! Sincronizando estante...`;
            showToast(`${getCloudProviderLabel(prov)} conectado com sucesso!`);
            await syncCloudStateSilentPull();
            await listCloudBooks();
          } catch (err) {
            if (statusEl) statusEl.textContent = 'Erro ao conectar: ' + err.message;
            alert('Falha na autorização: ' + err.message);
          }
        };
        window.addEventListener('message', onOAuthMsg);
      });
    }

    const chkCombineBanksEl = document.getElementById('chkCombineAllCloudBanks');
    if (chkCombineBanksEl) {
      chkCombineBanksEl.checked = localStorage.getItem('reader_combine_cloud_banks') !== 'false';
      chkCombineBanksEl.addEventListener('change', () => {
        localStorage.setItem('reader_combine_cloud_banks', chkCombineBanksEl.checked ? 'true' : 'false');
        listCloudBooks().catch(() => {});
      });
    }

    document.getElementById('selectCloudProfile').addEventListener('change', async (e) => {
      const id = e.target.value;
      const profiles = getCloudProfilesList();
      const chosen = profiles.find(p => p.id === id);
      if (!chosen) return;
      localStorage.setItem('reader_cloud_config', JSON.stringify({ ...chosen, profileId: chosen.id }));
      cachedCloudFilesList = [];
      loadCloudConfigIntoUi();
      document.getElementById('cloudStatusMsg').textContent = `Alternado para "${chosen.name}". Carregando livros...`;
      await syncCloudStateSilentPull();
      await listCloudBooks();
      showToast(`Banco alterado: ${chosen.name}`);
    });

    document.getElementById('btnAddCloudProfile').addEventListener('click', () => {
      const provRaw = prompt('Provedor: digite "gdrive", "onedrive", "supabase" ou "firebase":', 'supabase');
      if (provRaw === null) return;
      const lp = provRaw.trim().toLowerCase();
      if (lp.includes('drive') && !lp.includes('one')) { activateOrAddPersonalCloudProvider('gdrive'); return; }
      if (lp.includes('one')) { activateOrAddPersonalCloudProvider('onedrive'); return; }
      const isFb = lp.includes('fire');
      const name = prompt('Nome para este novo banco de dados (ex: Supabase Secundário, Firebase Celular):', isFb ? 'Firebase Extra' : 'Banco Extra');
      if (!name || !name.trim()) return;
      const url = prompt('Cole a URL do Projeto (Supabase URL ou Firebase DB URL):', '');
      if (url === null) return;
      const apiKey = prompt('Cole a Chave Pública (sb_publishable_... / Anon Key / opcional no Firebase):', '');
      const bucket = isFb ? 'books' : (prompt('Nome do Bucket Storage:', 'books') || 'books');
      const syncKey = prompt('Pasta / Chave da Estante neste banco:', getCloudConfig().syncKey || 'minha-estante') || 'minha-estante';
      const newProf = {
        id: 'db_' + Date.now(),
        name: name.trim(),
        provider: isFb ? 'firebase' : 'supabase',
        url: url.trim().replace(/\/+$/, ''),
        apiKey: (apiKey || '').trim(),
        bucket: bucket.trim(),
        syncKey: syncKey.trim().replace(/[^a-zA-Z0-9_-]/g, '_'),
        userEmail: '',
        accessToken: ''
      };
      const profiles = getCloudProfilesList();
      profiles.push(newProf);
      saveCloudProfilesList(profiles);
      localStorage.setItem('reader_cloud_config', JSON.stringify({ ...newProf, profileId: newProf.id }));
      cachedCloudFilesList = [];
      loadCloudConfigIntoUi();
      document.getElementById('cloudStatusMsg').textContent = `Novo banco "${newProf.name}" adicionado e ativado! Consultando bancos...`;
      showToast(`Banco "${newProf.name}" conectado!`);
      listCloudBooks().catch(() => {});
    });

    document.getElementById('btnDeleteCloudProfile').addEventListener('click', () => {
      const profiles = getCloudProfilesList();
      if (profiles.length <= 1) {
        alert('Mantenha pelo menos 1 banco conectado na lista.');
        return;
      }
      const curId = document.getElementById('selectCloudProfile').value;
      const remaining = profiles.filter(p => p.id !== curId);
      saveCloudProfilesList(remaining);
      localStorage.setItem('reader_cloud_config', JSON.stringify({ ...remaining[0], profileId: remaining[0].id }));
      cachedCloudFilesList = [];
      loadCloudConfigIntoUi();
      listCloudBooks();
      showToast('Banco removido da lista local');
    });

    /* =====================================================================
     * 13B. CAPAS DOS LIVROS (EXTRAIR DO ARQUIVO, BUSCAR ONLINE E BAIXAR)
     * ===================================================================== */
    function getBookCoversMap() {
      try { return JSON.parse(localStorage.getItem('reader_book_covers') || '{}'); }
      catch { return {}; }
    }

    function getBookCoverDataUrl(bookKey, safeName) {
      const covers = getBookCoversMap();
      if (bookKey && covers[bookKey]) return covers[bookKey];
      if (safeName && covers['safe_' + safeName]) return covers['safe_' + safeName];
      const cat = getCloudCatalogMap();
      if (safeName && cat[safeName] && cat[safeName].coverThumb) return cat[safeName].coverThumb;
      return '';
    }

    function saveBookCoverDataUrl(bookKey, safeName, dataUrl) {
      const covers = getBookCoversMap();
      if (dataUrl) {
        if (bookKey) covers[bookKey] = dataUrl;
        if (safeName) covers['safe_' + safeName] = dataUrl;
      } else {
        if (bookKey) delete covers[bookKey];
        if (safeName) delete covers['safe_' + safeName];
      }
      try {
        localStorage.setItem('reader_book_covers', JSON.stringify(covers));
      } catch {
        // Caso o armazenamento local esteja cheio, manter os últimos 15 livros
        const keys = Object.keys(covers);
        while (keys.length > 15) {
          delete covers[keys.shift()];
        }
        try { localStorage.setItem('reader_book_covers', JSON.stringify(covers)); } catch {}
      }
      if (safeName && dataUrl) {
        saveCloudCatalogEntry(safeName, { coverThumb: dataUrl });
      }
      renderBookshelf(document.getElementById('inputFilterShelf') ? document.getElementById('inputFilterShelf').value : '');
    }

    function resizeImageSrcToCoverThumb(srcUrl, maxW = 240, maxH = 360) {
      return new Promise((resolve) => {
        if (!srcUrl) { resolve(null); return; }
        const img = new Image();
        img.crossOrigin = 'anonymous';
        img.onload = () => {
          try {
            const ratio = Math.min(maxW / Math.max(1, img.width), maxH / Math.max(1, img.height), 1);
            const w = Math.max(40, Math.round(img.width * ratio));
            const h = Math.max(60, Math.round(img.height * ratio));
            const c = document.createElement('canvas');
            c.width = w;
            c.height = h;
            c.getContext('2d').drawImage(img, 0, 0, w, h);
            resolve(c.toDataURL('image/jpeg', 0.82));
          } catch {
            resolve(srcUrl.startsWith('data:') ? srcUrl : null);
          }
        };
        img.onerror = () => resolve(null);
        img.src = srcUrl;
      });
    }

    async function extractCoverThumbFromBuffer(fileName, buffer, existingParsed = null) {
      const ext = (fileName || '').split('.').pop().toLowerCase();
      const parsed = existingParsed || await parseAnyBookBuffer(buffer, fileName);
      if (parsed && parsed.coverUrl) {
        const thumb = await resizeImageSrcToCoverThumb(parsed.coverUrl, 260, 390);
        if (thumb) return { thumb, fullSrc: parsed.coverUrl };
      }
      if (ext === 'pdf' && window.pdfjsLib) {
        const doc = existingParsed ? state.pdfDoc : await window.pdfjsLib.getDocument({ data: new Uint8Array(buffer.slice(0)) }).promise;
        if (doc) {
          const page = await doc.getPage(1);
          const baseVp = page.getViewport({ scale: 1 });
          const sc = Math.min(1.6, 360 / Math.max(1, baseVp.height));
          const vp = page.getViewport({ scale: sc });
          const c = document.createElement('canvas');
          c.width = Math.floor(vp.width);
          c.height = Math.floor(vp.height);
          await page.render({ canvasContext: c.getContext('2d'), viewport: vp }).promise;
          const thumb = c.toDataURL('image/jpeg', 0.85);
          return { thumb, fullSrc: thumb };
        }
      }
      return null;
    }

    async function autoCaptureBookCover(bookKey, parsedObj) {
      if (!bookKey || getBookCoverDataUrl(bookKey)) return;
      const safeName = state.currentFileName ? safeCloudFileName(state.currentFileName) : '';
      const res = await extractCoverThumbFromBuffer(state.currentFileName || 'book', state.currentFileBuffer, parsedObj);
      if (res && res.thumb) {
        saveBookCoverDataUrl(bookKey, safeName, res.thumb);
      }
    }

    let activeCoverModalBook = null;
    function refreshCoverPreviewBox() {
      if (!activeCoverModalBook) return;
      const url = getBookCoverDataUrl(activeCoverModalBook.bookKey, activeCoverModalBook.safeName);
      const box = document.getElementById('coverPreviewBox');
      if (url) {
        box.innerHTML = `<img src="${url}" alt="Capa" style="width:100%; height:100%; object-fit:cover;" />`;
      } else {
        box.textContent = 'Sem capa salva';
      }
    }

    function openCoverModalForBook(bookObj) {
      activeCoverModalBook = bookObj;
      document.getElementById('coverModalTitle').textContent = `Capa — ${bookObj.title || 'Livro'}`;
      document.getElementById('inputCoverSearchQuery').value = `${bookObj.title || ''} ${bookObj.author && bookObj.author !== 'Salvo na Nuvem' ? bookObj.author : ''}`.trim();
      document.getElementById('coverSearchResults').classList.add('hidden');
      document.getElementById('coverSearchResults').innerHTML = '';
      document.getElementById('lblCoverModalStatus').textContent = 'Pronto.';
      refreshCoverPreviewBox();
      document.getElementById('coverModal').classList.add('open');
    }

    const btnApplyCoverUrlEl = document.getElementById('btnApplyCoverUrl');
    const inpCoverUrlEl = document.getElementById('inputCoverImageUrl');
    if (btnApplyCoverUrlEl && inpCoverUrlEl) {
      btnApplyCoverUrlEl.addEventListener('click', async () => {
        if (!activeCoverModalBook) return;
        const rawUrl = (inpCoverUrlEl.value || '').trim();
        if (!rawUrl || !/^https?:\/\//i.test(rawUrl)) {
          showToast('Informe um link de imagem válido (http:// ou https://).', true);
          return;
        }
        const status = document.getElementById('lblCoverModalStatus');
        if (status) status.textContent = 'Baixando e aplicando capa da internet...';
        btnApplyCoverUrlEl.disabled = true;
        try {
          const proxySrc = proxiedImgSrc(rawUrl);
          const dataUrl = await fetchImageAsDataUrl(proxySrc).catch(() => rawUrl);
          saveBookCoverDataUrl(activeCoverModalBook.bookKey, activeCoverModalBook.safeName, dataUrl);
          refreshCoverPreviewBox();
          if (typeof renderBookshelf === 'function') renderBookshelf();
          if (status) status.textContent = 'Capa da web aplicada com sucesso!';
          showToast('Capa da internet aplicada!');
          inpCoverUrlEl.value = '';
        } catch (err) {
          if (status) status.textContent = 'Erro ao carregar imagem: ' + err.message;
          showToast('Erro ao aplicar imagem: ' + err.message, true);
        } finally {
          btnApplyCoverUrlEl.disabled = false;
        }
      });
    }

    const btnProfExpBackupEl = document.getElementById('btnProfileExportBackup');
    if (btnProfExpBackupEl) {
      btnProfExpBackupEl.addEventListener('click', () => {
        const btnExp = document.getElementById('btnExportFullBackup');
        if (btnExp) btnExp.click();
      });
    }
    const profImpBackupInp = document.getElementById('profileImportBackupInput');
    if (profImpBackupInp) {
      profImpBackupInp.addEventListener('change', (e) => {
        const origInp = document.getElementById('importBackupInput');
        if (origInp && e.target.files && e.target.files[0]) {
          const dt = new DataTransfer();
          dt.items.add(e.target.files[0]);
          origInp.files = dt.files;
          origInp.dispatchEvent(new Event('change'));
        }
      });
    }

        document.getElementById('btnCloseCoverModal').addEventListener('click', () => document.getElementById('coverModal').classList.remove('open'));
    document.getElementById('btnCloseCoverFooter').addEventListener('click', () => document.getElementById('coverModal').classList.remove('open'));

    document.getElementById('btnExtractBuiltinCover').addEventListener('click', async () => {
      if (!activeCoverModalBook) return;
      const status = document.getElementById('lblCoverModalStatus');
      if (!activeCoverModalBook.buffer) {
        status.textContent = 'Abra ou baixe o livro para este dispositivo primeiro para extrair a capa embutida.';
        return;
      }
      status.textContent = 'Extraindo capa original de dentro do arquivo...';
      try {
        const res = await extractCoverThumbFromBuffer(activeCoverModalBook.fileName, activeCoverModalBook.buffer, null);
        if (!res || !res.thumb) {
          status.textContent = 'Este arquivo não possui imagem de capa embutida. Tente "Buscar Capa Online" abaixo!';
          return;
        }
        saveBookCoverDataUrl(activeCoverModalBook.bookKey, activeCoverModalBook.safeName, res.thumb);
        refreshCoverPreviewBox();
        status.textContent = 'Capa original extraída e aplicada com sucesso!';
        showToast('Capa original aplicada!');
      } catch (err) {
        status.textContent = 'Erro ao extrair capa: ' + err.message;
      }
    });

    document.getElementById('btnDownloadBookCover').addEventListener('click', () => {
      if (!activeCoverModalBook) return;
      const url = getBookCoverDataUrl(activeCoverModalBook.bookKey, activeCoverModalBook.safeName);
      if (!url) {
        document.getElementById('lblCoverModalStatus').textContent = 'Este livro ainda não tem uma capa salva para baixar.';
        return;
      }
      const a = document.createElement('a');
      a.href = url;
      a.download = `${(activeCoverModalBook.title || 'capa').replace(/[<>:"/\\|?*]+/g, '_')}_capa.jpg`;
      a.click();
      showToast('Imagem da capa baixada!');
    });

    document.getElementById('inputCustomCoverFile').addEventListener('change', async (e) => {
      const f = e.target.files && e.target.files[0];
      if (!f || !activeCoverModalBook) return;
      const reader = new FileReader();
      reader.onload = async () => {
        const thumb = await resizeImageSrcToCoverThumb(reader.result, 260, 390) || reader.result;
        saveBookCoverDataUrl(activeCoverModalBook.bookKey, activeCoverModalBook.safeName, thumb);
        refreshCoverPreviewBox();
        document.getElementById('lblCoverModalStatus').textContent = 'Capa personalizada salva!';
        showToast('Capa personalizada aplicada!');
      };
      reader.readAsDataURL(f);
    });

    document.getElementById('btnRemoveBookCover').addEventListener('click', () => {
      if (!activeCoverModalBook) return;
      saveBookCoverDataUrl(activeCoverModalBook.bookKey, activeCoverModalBook.safeName, '');
      refreshCoverPreviewBox();
      document.getElementById('lblCoverModalStatus').textContent = 'Capa removida.';
    });

    document.getElementById('btnSearchCoversOnline').addEventListener('click', async () => {
      const q = document.getElementById('inputCoverSearchQuery').value.trim();
      const status = document.getElementById('lblCoverModalStatus');
      const grid = document.getElementById('coverSearchResults');
      if (!q) return;
      status.textContent = 'Buscando capas online (Google Books & Open Library)...';
      grid.classList.remove('hidden');
      grid.innerHTML = '<div style="grid-column:1/-1; padding:12px; font-size:12px; color:var(--text-muted);">Pesquisando capas...</div>';

      const candidates = [];
      try {
        const gbRes = await fetch(`https://www.googleapis.com/books/v1/volumes?q=${encodeURIComponent(q)}&maxResults=8`).catch(() => null);
        if (gbRes && gbRes.ok) {
          const gbJson = await gbRes.json();
          (gbJson.items || []).forEach(it => {
            const links = it.volumeInfo && it.volumeInfo.imageLinks;
            const thumb = links && (links.thumbnail || links.smallThumbnail);
            if (thumb) {
              candidates.push({
                title: it.volumeInfo.title || 'Google Books',
                url: thumb.replace(/^http:/, 'https:').replace('&edge=curl', '')
              });
            }
          });
        }
      } catch {}
      try {
        const olRes = await fetch(`https://openlibrary.org/search.json?q=${encodeURIComponent(q)}&limit=6`).catch(() => null);
        if (olRes && olRes.ok) {
          const olJson = await olRes.json();
          (olJson.docs || []).forEach(doc => {
            if (doc.cover_i) {
              candidates.push({
                title: doc.title || 'Open Library',
                url: `https://covers.openlibrary.org/b/id/${doc.cover_i}-L.jpg`
              });
            }
          });
        }
      } catch {}

      grid.innerHTML = '';
      if (!candidates.length) {
        grid.innerHTML = '<div style="grid-column:1/-1; padding:12px; font-size:12px; color:var(--text-muted);">Nenhuma capa encontrada para essa busca. Tente só o título do livro.</div>';
        status.textContent = 'Nenhuma capa encontrada.';
        return;
      }

      candidates.forEach(c => {
        const card = document.createElement('div');
        card.className = 'cover-candidate';
        card.innerHTML = `<img src="${escapeHtml(c.url)}" alt="" /><span>${escapeHtml(c.title.slice(0, 28))}</span>`;
        card.addEventListener('click', async () => {
          if (!activeCoverModalBook) return;
          status.textContent = 'Baixando e aplicando capa selecionada...';
          const thumb = await resizeImageSrcToCoverThumb(c.url, 260, 390);
          saveBookCoverDataUrl(activeCoverModalBook.bookKey, activeCoverModalBook.safeName, thumb || c.url);
          refreshCoverPreviewBox();
          status.textContent = 'Capa aplicada ao livro!';
          showToast('Capa online aplicada com sucesso!');
        });
        grid.appendChild(card);
      });
      status.textContent = `${candidates.length} opções de capa encontradas — clique em qualquer uma para aplicar!`;
    });

    document.getElementById('btnExtractAllShelfCovers').addEventListener('click', async () => {
      const books = await idbGetAllBooks();
      if (!books.length) {
        showToast('Adicione livros primeiro para extrair capas.');
        return;
      }
      let extracted = 0;
      for (const b of books) {
        const safeName = safeCloudFileName(b.fileName || `${b.title}.epub`);
        if (getBookCoverDataUrl(b.bookKey, safeName)) continue;
        try {
          const parsed = await parseAnyBookBuffer(b.buffer, b.fileName);
          if (parsed && parsed.metadata) saveBookMetadata(b.bookKey, safeName, parsed.metadata);
          const res = await extractCoverThumbFromBuffer(b.fileName, b.buffer, parsed);
          if (res && res.thumb) {
            saveBookCoverDataUrl(b.bookKey, safeName, res.thumb);
            extracted++;
          }
        } catch {}
      }
      showToast(extracted > 0 ? `${extracted} capa(s) extraída(s) dos arquivos!` : 'Todas as capas disponíveis já estão salvas!');
    });

    // Cabeçalhos compatíveis com chaves novas (sb_publishable_...) e chaves JWT legadas (eyJ...)
    function getSupabaseHeaders(cfg, extra = {}) {
      const headers = { apikey: cfg.apiKey, ...extra };
      const authJwt = (cfg.accessToken && /^eyJ/.test(cfg.accessToken))
        ? cfg.accessToken
        : (/^eyJ/.test(cfg.apiKey) ? cfg.apiKey : null);
      if (authJwt) headers.Authorization = `Bearer ${authJwt}`;
      return headers;
    }

    async function ensureFreshOAuthToken(cfg) {
      if (!cfg || !isOAuthCloudProvider(cfg.provider)) return cfg;
      const expired = cfg.tokenExpiresAt && Date.now() > (cfg.tokenExpiresAt - 60000);
      if (cfg.accessToken && !expired) return cfg;
      if (cfg.provider === 'onedrive' && cfg.refreshToken && (cfg.clientId || getDefaultClientIdForProvider('onedrive'))) {
        try {
          const clientId = cfg.clientId || getDefaultClientIdForProvider('onedrive');
          const body = new URLSearchParams({
            client_id: clientId,
            grant_type: 'refresh_token',
            refresh_token: cfg.refreshToken,
            scope: 'Files.ReadWrite Files.ReadWrite.AppFolder User.Read offline_access'
          });
          const res = await fetch('https://login.microsoftonline.com/common/oauth2/v2.0/token', {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: body.toString()
          });
          if (res.ok) {
            const j = await res.json();
            if (j && j.access_token) {
              const next = {
                ...cfg,
                accessToken: j.access_token,
                refreshToken: j.refresh_token || cfg.refreshToken,
                tokenExpiresAt: Date.now() + ((j.expires_in || 3600) * 1000)
              };
              syncProfileToLocalStorage(next);
              return next;
            }
          }
        } catch {}
      }
      return expired ? { ...cfg, _tokenExpired: true } : cfg;
    }

    async function findOrCreateGDriveFolder(cfg, createIfMissing = true) {
      const syncKey = cfg.syncKey || 'minha-estante';
      const folderName = `LeitorPortatil_${syncKey}`;
      if (cfg.driveFolderId && cfg.driveFolderSyncKey === syncKey) {
        return cfg.driveFolderId;
      }
      const q = `name='${folderName.replace(/'/g, "\\'")}' and mimeType='application/vnd.google-apps.folder' and trashed=false`;
      const searchUrl = `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(q)}&fields=files(id,name)&pageSize=5`;
      const sRes = await fetch(searchUrl, { headers: { Authorization: `Bearer ${cfg.accessToken}` } });
      if (!sRes.ok) throw new Error(`Google Drive HTTP ${sRes.status}`);
      const sJson = await sRes.json();
      if (sJson.files && sJson.files[0]) {
        const fid = sJson.files[0].id;
        syncProfileToLocalStorage({ ...cfg, driveFolderId: fid, driveFolderSyncKey: syncKey });
        return fid;
      }
      if (!createIfMissing) return '';
      const cRes = await fetch('https://www.googleapis.com/drive/v3/files?fields=id', {
        method: 'POST',
        headers: { Authorization: `Bearer ${cfg.accessToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: folderName, mimeType: 'application/vnd.google-apps.folder' })
      });
      if (!cRes.ok) throw new Error(`Erro ao criar pasta no Google Drive (HTTP ${cRes.status})`);
      const cj = await cRes.json();
      syncProfileToLocalStorage({ ...cfg, driveFolderId: cj.id, driveFolderSyncKey: syncKey });
      return cj.id;
    }

    function normalizeRelFileNameForDrive(relPath) {
      return String(relPath || '').replace(/^\/+/, '').replace(/\//g, '__');
    }

    async function findGDriveFileInFolder(cfg, folderId, fileName) {
      const q = `name='${String(fileName).replace(/'/g, "\\'")}' and '${folderId}' in parents and trashed=false`;
      const url = `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(q)}&fields=files(id,name,size)&pageSize=3`;
      const res = await fetch(url, { headers: { Authorization: `Bearer ${cfg.accessToken}` } });
      if (!res.ok) return null;
      const j = await res.json().catch(() => null);
      return (j && j.files && j.files[0]) || null;
    }

    async function cloudReadJsonByPath(cfg, relPath) {
      const cleanName = normalizeRelFileNameForDrive(relPath);
      if (cfg.provider === 'gdrive') {
        const fCfg = await ensureFreshOAuthToken(cfg);
        if (!fCfg.accessToken || fCfg._tokenExpired) return null;
        const folderId = await findOrCreateGDriveFolder(fCfg, false).catch(() => '');
        if (!folderId) return null;
        const fileMeta = await findGDriveFileInFolder(fCfg, folderId, cleanName);
        if (!fileMeta) return null;
        const r = await fetch(`https://www.googleapis.com/drive/v3/files/${fileMeta.id}?alt=media`, {
          cache: 'no-store',
          headers: { Authorization: `Bearer ${fCfg.accessToken}` }
        }).catch(() => null);
        return (r && r.ok) ? await r.json().catch(() => null) : null;
      }
      if (cfg.provider === 'onedrive') {
        const fCfg = await ensureFreshOAuthToken(cfg);
        if (!fCfg.accessToken || fCfg._tokenExpired) return null;
        const syncKey = encodeURIComponent(fCfg.syncKey || 'minha-estante');
        const r = await fetch(`https://graph.microsoft.com/v1.0/me/drive/special/approot:/${syncKey}/${encodeURIComponent(cleanName)}:/content`, {
          cache: 'no-store',
          headers: { Authorization: `Bearer ${fCfg.accessToken}` }
        }).catch(() => null);
        return (r && r.ok) ? await r.json().catch(() => null) : null;
      }
      return null;
    }

    async function cloudWriteJsonByPath(cfg, relPath, obj) {
      const cleanName = normalizeRelFileNameForDrive(relPath);
      const jsonStr = JSON.stringify(obj);
      if (cfg.provider === 'gdrive') {
        const fCfg = await ensureFreshOAuthToken(cfg);
        if (!fCfg.accessToken || fCfg._tokenExpired) throw new Error('Reconecte sua conta Google Drive.');
        const folderId = await findOrCreateGDriveFolder(fCfg, true);
        const existing = await findGDriveFileInFolder(fCfg, folderId, cleanName);
        const boundary = '-------LeitorPortatilJson' + Date.now();
        const metaPart = JSON.stringify(existing ? { name: cleanName, mimeType: 'application/json' } : { name: cleanName, parents: [folderId], mimeType: 'application/json' });
        const body = `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${metaPart}\r\n--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${jsonStr}\r\n--${boundary}--`;
        const upUrl = existing
          ? `https://www.googleapis.com/upload/drive/v3/files/${existing.id}?uploadType=multipart`
          : `https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart`;
        const r = await fetch(upUrl, {
          method: existing ? 'PATCH' : 'POST',
          headers: { Authorization: `Bearer ${fCfg.accessToken}`, 'Content-Type': `multipart/related; boundary=${boundary}` },
          body
        });
        if (!r.ok) throw new Error(`Google Drive HTTP ${r.status}`);
        return true;
      }
      if (cfg.provider === 'onedrive') {
        const fCfg = await ensureFreshOAuthToken(cfg);
        if (!fCfg.accessToken || fCfg._tokenExpired) throw new Error('Reconecte sua conta Microsoft OneDrive.');
        const syncKey = encodeURIComponent(fCfg.syncKey || 'minha-estante');
        const r = await fetch(`https://graph.microsoft.com/v1.0/me/drive/special/approot:/${syncKey}/${encodeURIComponent(cleanName)}:/content`, {
          method: 'PUT',
          headers: { Authorization: `Bearer ${fCfg.accessToken}`, 'Content-Type': 'application/json' },
          body: jsonStr
        });
        if (!r.ok) throw new Error(`OneDrive HTTP ${r.status}`);
        return true;
      }
      return false;
    }

    async function cloudUploadBinaryFile(cfg, fileName, buffer) {
      if (cfg.provider === 'gdrive') {
        const fCfg = await ensureFreshOAuthToken(cfg);
        if (!fCfg.accessToken || fCfg._tokenExpired) throw new Error('Sessão do Google Drive expirada. Clique em Conectar Google Drive para renovar.');
        const folderId = await findOrCreateGDriveFolder(fCfg, true);
        const existing = await findGDriveFileInFolder(fCfg, folderId, fileName);
        const initUrl = existing
          ? `https://www.googleapis.com/upload/drive/v3/files/${existing.id}?uploadType=resumable`
          : `https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable`;
        const initRes = await fetch(initUrl, {
          method: existing ? 'PATCH' : 'POST',
          headers: {
            Authorization: `Bearer ${fCfg.accessToken}`,
            'Content-Type': 'application/json; charset=UTF-8',
            'X-Upload-Content-Length': String(buffer.byteLength)
          },
          body: JSON.stringify(existing ? { name: fileName } : { name: fileName, parents: [folderId] })
        });
        if (!initRes.ok) throw new Error(`Google Drive HTTP ${initRes.status}`);
        const uploadSessionUrl = initRes.headers.get('Location');
        if (!uploadSessionUrl) throw new Error('Google Drive não retornou URL de upload resumable.');
        const putRes = await fetch(uploadSessionUrl, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/octet-stream' },
          body: buffer
        });
        if (!putRes.ok) throw new Error(`Google Drive upload falhou (HTTP ${putRes.status})`);
        return true;
      }
      if (cfg.provider === 'onedrive') {
        const fCfg = await ensureFreshOAuthToken(cfg);
        if (!fCfg.accessToken || fCfg._tokenExpired) throw new Error('Sessão do OneDrive expirada. Clique em Conectar OneDrive.');
        const syncKey = encodeURIComponent(fCfg.syncKey || 'minha-estante');
        const encName = encodeURIComponent(fileName);
        if (buffer.byteLength <= 4 * 1024 * 1024) {
          const r = await fetch(`https://graph.microsoft.com/v1.0/me/drive/special/approot:/${syncKey}/${encName}:/content`, {
            method: 'PUT',
            headers: { Authorization: `Bearer ${fCfg.accessToken}`, 'Content-Type': 'application/octet-stream' },
            body: buffer
          });
          if (!r.ok) throw new Error(`OneDrive HTTP ${r.status}`);
          return true;
        }
        const sessRes = await fetch(`https://graph.microsoft.com/v1.0/me/drive/special/approot:/${syncKey}/${encName}:/createUploadSession`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${fCfg.accessToken}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ item: { '@microsoft.graph.conflictBehavior': 'replace' } })
        });
        if (!sessRes.ok) throw new Error(`OneDrive createUploadSession HTTP ${sessRes.status}`);
        const sess = await sessRes.json();
        const chunkSize = 327680 * 10; // Múltiplo exato de 320 KiB (~3.27 MB) exigido pelo Graph
        const total = buffer.byteLength;
        for (let start = 0; start < total; start += chunkSize) {
          const end = Math.min(start + chunkSize, total);
          const slice = buffer.slice(start, end);
          const cr = await fetch(sess.uploadUrl, {
            method: 'PUT',
            headers: {
              'Content-Range': `bytes ${start}-${end - 1}/${total}`
            },
            body: slice
          });
          if (!cr.ok && cr.status !== 202 && cr.status !== 200 && cr.status !== 201) {
            throw new Error(`OneDrive chunk upload HTTP ${cr.status}`);
          }
        }
        return true;
      }
      return false;
    }

    async function ensureFreshSupabaseToken(cfg) {
      if (!cfg || cfg.provider === 'firebase' || isOAuthCloudProvider(cfg.provider) || !cfg.url || !cfg.apiKey || !cfg.accessToken || !/^eyJ/.test(cfg.accessToken)) {
        return cfg;
      }
      try {
        const parts = cfg.accessToken.split('.');
        if (parts.length === 3) {
          const b64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
          const payload = JSON.parse(atob(b64));
          if (payload && payload.exp && (payload.exp * 1000) > (Date.now() + 60000)) {
            return cfg;
          }
        }
      } catch {
        return cfg;
      }
      if (!cfg.refreshToken) {
        const cleaned = { ...cfg, accessToken: '' };
        syncProfileToLocalStorage(cleaned);
        return cleaned;
      }
      try {
        const r = await fetch(`${cfg.url}/auth/v1/token?grant_type=refresh_token`, {
          method: 'POST',
          headers: { apikey: cfg.apiKey, 'Content-Type': 'application/json' },
          body: JSON.stringify({ refresh_token: cfg.refreshToken })
        });
        if (r.ok) {
          const data = await r.json();
          if (data && data.access_token) {
            const next = { ...cfg, accessToken: data.access_token, refreshToken: data.refresh_token || cfg.refreshToken };
            syncProfileToLocalStorage(next);
            return next;
          }
        }
      } catch {}
      const cleared = { ...cfg, accessToken: '', refreshToken: '' };
      syncProfileToLocalStorage(cleared);
      return cleared;
    }

    async function readSupabaseErrorText(res) {
      try {
        const raw = await res.text();
        if (!raw) return `HTTP ${res.status}`;
        try {
          const j = JSON.parse(raw);
          return j.message || j.error_description || j.msg || j.error || `HTTP ${res.status}`;
        } catch {
          return raw.slice(0, 180);
        }
      } catch {
        return `HTTP ${res.status}`;
      }
    }

    // Diagnóstico rápido da conexão com Supabase (Banco REST + Bucket Storage)
    document.getElementById('btnTestCloudConn').addEventListener('click', async () => {
      document.getElementById('btnSaveCloudConfig').click();
      const cfg = getCloudConfig();
      const statusEl = document.getElementById('cloudStatusMsg');
      if (isOAuthCloudProvider(cfg.provider)) {
        const fCfg = await ensureFreshOAuthToken(cfg);
        if (!fCfg.accessToken || fCfg._tokenExpired) {
          statusEl.textContent = `Conta ${getCloudProviderLabel(cfg.provider)} não conectada ou expirada. Clique em "Conectar Conta Agora" acima.`;
          return;
        }
        statusEl.textContent = `Testando acesso ao ${getCloudProviderLabel(cfg.provider)}...`;
        try {
          if (cfg.provider === 'gdrive') {
            const r = await fetch('https://www.googleapis.com/drive/v3/about?fields=storageQuota,user', { headers: { Authorization: `Bearer ${fCfg.accessToken}` } });
            if (!r.ok) throw new Error(`HTTP ${r.status}`);
            const j = await r.json();
            const gbLim = j.storageQuota && j.storageQuota.limit ? (Number(j.storageQuota.limit) / 1073741824).toFixed(1) : '15';
            statusEl.textContent = `Google Drive conectado como ${j.user && j.user.emailAddress ? j.user.emailAddress : 'sua conta'} (${gbLim} GB)!`;
          } else {
            const r = await fetch('https://graph.microsoft.com/v1.0/me/drive?$select=quota', { headers: { Authorization: `Bearer ${fCfg.accessToken}` } });
            if (!r.ok) throw new Error(`HTTP ${r.status}`);
            const j = await r.json();
            const gbLim = j.quota && j.quota.total ? (Number(j.quota.total) / 1073741824).toFixed(1) : '5';
            statusEl.textContent = `Microsoft OneDrive conectado (${gbLim} GB disponíveis)!`;
          }
          showToast(`${getCloudProviderLabel(cfg.provider)} OK!`);
        } catch (err) {
          statusEl.textContent = `Erro ao testar ${getCloudProviderLabel(cfg.provider)}: ${err.message}`;
        }
        return;
      }
      if (!cfg.url || (cfg.provider !== 'firebase' && !cfg.apiKey)) {
        statusEl.textContent = cfg.provider === 'firebase'
          ? 'Preencha a URL do Firebase Realtime Database primeiro (ex: https://seu-app.firebaseio.com).'
          : 'Preencha a URL do projeto e a Chave Pública (sb_publishable_... ou anon key) primeiro.';
        return;
      }
      if (cfg.provider === 'firebase') {
        try {
          const r = await fetch(`${cfg.url}/reader_sync.json${cfg.apiKey ? `?auth=${encodeURIComponent(cfg.apiKey)}` : ''}`);
          statusEl.textContent = r.ok ? 'Firebase conectado com sucesso!' : `Firebase retornou HTTP ${r.status}.`;
        } catch (e) {
          statusEl.textContent = 'Falha ao conectar no Firebase: ' + e.message;
        }
        return;
      }
      statusEl.textContent = 'Testando Storage e Banco Postgres no Supabase...';
      try {
        const headers = getSupabaseHeaders(cfg);
        const stRes = await fetch(`${cfg.url}/storage/v1/object/list/${cfg.bucket}`, {
          method: 'POST',
          headers: { ...headers, 'Content-Type': 'application/json' },
          body: JSON.stringify({ prefix: '', limit: 1, offset: 0 })
        });
        const dbRes = await fetch(`${cfg.url}/rest/v1/reader_profiles?select=sync_key&limit=1`, { headers }).catch(() => null);
        const stOk = stRes.ok;
        const dbOk = dbRes && dbRes.ok;
        if (stOk && dbOk) {
          statusEl.textContent = `Conexão perfeita! Bucket "${cfg.bucket}" + Banco Postgres prontos (sem precisar de login ou com login).`;
          showToast('Supabase conectado: Bucket + Banco OK!');
        } else if (stOk) {
          statusEl.textContent = `Bucket "${cfg.bucket}" conectado! Já pode sincronizar livros e progresso. (Tabela reader_profiles opcional ainda não criada).`;
          showToast('Bucket do Supabase conectado!');
        } else {
          const errTxt = await stRes.text().catch(() => '');
          statusEl.textContent = `Erro no Storage (HTTP ${stRes.status}): ${errTxt || 'Verifique o nome do bucket e as políticas do SUPABASE_SETUP.sql'}`;
        }
      } catch (err) {
        statusEl.textContent = 'Erro de rede ao testar Supabase: ' + err.message;
      }
    });

    // Login / Cadastro com E-mail e Senha via Supabase Auth REST API
    async function handleSupabaseAuth(mode) {
      document.getElementById('btnSaveCloudConfig').click();
      const cfg = getCloudConfig();
      const email = document.getElementById('inputAuthEmail').value.trim();
      const password = document.getElementById('inputAuthPass').value;
      const statusEl = document.getElementById('cloudStatusMsg');
      if (!cfg.url || !cfg.apiKey) {
        statusEl.textContent = 'Informe a URL e a Chave Pública do Supabase acima antes de entrar.';
        return;
      }
      if (!email || !password) {
        statusEl.textContent = 'Informe seu e-mail e senha.';
        return;
      }
      statusEl.textContent = mode === 'signup' ? 'Criando conta no Supabase Auth...' : 'Autenticando no Supabase...';
      try {
        const endpoint = mode === 'signup'
          ? `${cfg.url}/auth/v1/signup`
          : `${cfg.url}/auth/v1/token?grant_type=password`;
        const res = await fetch(endpoint, {
          method: 'POST',
          headers: {
            apikey: cfg.apiKey,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({ email, password })
        });
        const data = await res.json();
        if (!res.ok) {
          const rawMsg = data.error_description || data.msg || data.message || `HTTP ${res.status}`;
          if (/Invalid login credentials/i.test(rawMsg)) {
            throw new Error('Conta ainda não criada neste Supabase ou senha incorreta. Clique em "Criar Conta" primeiro (ou use direto sem login via Chave da Estante!).');
          }
          if (/Email not confirmed/i.test(rawMsg)) {
            throw new Error('E-mail ainda não confirmado. Confirme no link recebido por e-mail ou desative "Confirm email" no painel do Supabase (Authentication -> Providers -> Email).');
          }
          throw new Error(rawMsg);
        }

        const sessionToken = data.access_token || (data.session && data.session.access_token) || '';
        const sessionRefresh = data.refresh_token || (data.session && data.session.refresh_token) || '';
        if (mode === 'signup' && !sessionToken) {
          statusEl.textContent = `Cadastro enviado para ${email}! Confirme o e-mail recebido (ou desative "Confirm email" em Auth -> Email no Supabase) e clique em Entrar.`;
          showToast('Conta criada! Confirme seu e-mail para entrar.');
          return;
        }

        const activeInv = getActiveInviteState();
        const emailPrefix = email.split('@')[0].replace(/[^a-zA-Z0-9_-]/g, '_');
        if (mode === 'signup') {
          try { localStorage.setItem('reader_skip_legacy_fallback', email.toLowerCase()); } catch {}
        }
        cfg.accessToken = sessionToken;
        cfg.refreshToken = sessionRefresh;
        cfg.userEmail = email;
        if (activeInv && activeInv.syncKey) {
          cfg.syncKey = activeInv.syncKey;
          cfg.perUserProgress = true;
        } else if (cfg.perUserProgress === false) {
          cfg.syncKey = emailPrefix;
        } else if (!cfg.syncKey || (!cfg.customSyncKey && cfg.syncKey === emailPrefix)) {
          // Migra sessões antigas que apontavam para o prefixo do e-mail de volta para a estante compartilhada padrão
          cfg.syncKey = 'minha-estante';
        }
        document.getElementById('inputCloudSyncKey').value = cfg.syncKey;
        localStorage.setItem('reader_cloud_config', JSON.stringify(cfg));
        syncProfileToLocalStorage(cfg);
        updateAuthBadgeUi();
        syncInviteBannerUi();
        statusEl.textContent = `Autenticado como ${email} na estante "${cfg.syncKey}". Sincronizando...`;
        showToast(`Bem-vindo, ${email}!`);
        await document.getElementById('btnSyncProgressCloud').click();
        listCloudBooks();
        refreshGuestInboxPanel();
      } catch (err) {
        statusEl.textContent = 'Erro de autenticação: ' + err.message;
      }
    }

    document.getElementById('btnCloudSignIn').addEventListener('click', () => handleSupabaseAuth('signin'));
    document.getElementById('btnCloudSignUp').addEventListener('click', () => handleSupabaseAuth('signup'));
    const btnForgotEl = document.getElementById('btnCloudForgotPass');
    if (btnForgotEl) {
      btnForgotEl.addEventListener('click', async () => {
        document.getElementById('btnSaveCloudConfig').click();
        const cfg = getCloudConfig();
        const email = document.getElementById('inputAuthEmail').value.trim();
        const statusEl = document.getElementById('cloudStatusMsg');
        if (!cfg.url || !cfg.apiKey) {
          if (statusEl) statusEl.textContent = 'Conexão Supabase não configurada.';
          return;
        }
        if (!email) {
          if (statusEl) statusEl.textContent = 'Digite seu e-mail acima e clique em Esqueci senha para receber o link.';
          return;
        }
        if (statusEl) statusEl.textContent = 'Enviando e-mail de redefinição de senha...';
        try {
          const r = await fetch(`${cfg.url}/auth/v1/recover`, {
            method: 'POST',
            headers: { apikey: cfg.apiKey, 'Content-Type': 'application/json' },
            body: JSON.stringify({ email })
          });
          if (!r.ok) {
            const msg = await readSupabaseErrorText(r);
            throw new Error(msg);
          }
          if (statusEl) statusEl.textContent = `E-mail de redefinição enviado para ${email}! Verifique sua caixa de entrada/spam.`;
          showToast('Link de redefinição de senha enviado!');
        } catch (err) {
          if (statusEl) statusEl.textContent = 'Erro ao enviar recuperação: ' + err.message;
        }
      });
    }
    document.getElementById('btnCloudSignOut').addEventListener('click', () => {
      const cfg = getCloudConfig();
      delete cfg.accessToken;
      delete cfg.refreshToken;
      delete cfg.userEmail;
      localStorage.setItem('reader_cloud_config', JSON.stringify(cfg));
      syncProfileToLocalStorage({ ...cfg, accessToken: '', refreshToken: '', userEmail: '' });
      updateAuthBadgeUi();
      syncInviteBannerUi();
      refreshGuestInboxPanel();
      document.getElementById('cloudStatusMsg').textContent = 'Sessão encerrada.';
      showToast('Você saiu da conta na nuvem');
    });

    function getUserProfile() {
      const cfg = getCloudConfig();
      const emailName = cfg.userEmail ? cfg.userEmail.split('@')[0] : '';
      let stored = {};
      try { stored = JSON.parse(localStorage.getItem('reader_user_profile') || '{}'); } catch {}
      return {
        displayName: stored.displayName || emailName || 'Leitor',
        username: stored.username || emailName || '',
        bio: stored.bio || '',
        avatarDataUrl: stored.avatarDataUrl || '',
        annualGoalBooks: parseInt(stored.annualGoalBooks || '12', 10) || 12,
        updatedAt: stored.updatedAt || 0
      };
    }

    function saveUserProfile(profile) {
      const next = { ...getUserProfile(), ...profile, updatedAt: Date.now() };
      localStorage.setItem('reader_user_profile', JSON.stringify(next));
      refreshToolbarUserMenu();
      return next;
    }

    function getEffectiveUserSlug(cfg) {
      if (cfg && cfg.userEmail) return cfg.userEmail.toLowerCase().replace(/[^a-z0-9._-]/g, '_');
      return '';
    }

    function getSyncStateStoragePaths(cfg) {
      const base = (cfg && cfg.syncKey) || 'minha-estante';
      const userSlug = getEffectiveUserSlug(cfg);
      if (userSlug && cfg.perUserProgress !== false) {
        return {
          primaryStoragePath: `${base}/_users/${userSlug}_sync_state.json`,
          fallbackStoragePath: `${base}/_reader_sync_state.json`,
          postgresKey: `${base}__u__${userSlug}`,
          fallbackPostgresKey: base
        };
      }
      return {
        primaryStoragePath: `${base}/_reader_sync_state.json`,
        fallbackStoragePath: '',
        postgresKey: base,
        fallbackPostgresKey: ''
      };
    }

    function buildSyncPayload() {
      return {
        updatedAt: Date.now(),
        userProfile: getUserProfile(),
        history: JSON.parse(localStorage.getItem('reader_history') || '{}'),
        bookmarks: JSON.parse(localStorage.getItem('reader_bookmarks') || '{}'),
        highlights: JSON.parse(localStorage.getItem('reader_highlights') || '{}'),
        entityNotes: JSON.parse(localStorage.getItem('reader_entity_notes') || '{}'),
        vocabAnki: JSON.parse(localStorage.getItem('reader_vocab_anki') || '[]'),
        insights: JSON.parse(localStorage.getItem('reader_insights') || '{}'),
        bookReviews: JSON.parse(localStorage.getItem('reader_book_reviews') || '{}'),
        bookMetadata: JSON.parse(localStorage.getItem('reader_book_metadata') || '{}'),
        bookFavorites: JSON.parse(localStorage.getItem('reader_book_favorites') || '{}'),
        kindleConfig: JSON.parse(localStorage.getItem('reader_kindle_config') || '{}'),
        cloudCatalog: getCloudCatalogMap(),
        bookCovers: Object.fromEntries(Object.entries(getBookCoversMap()).slice(0, 24))
      };
    }

    function mergeSyncPayload(remote) {
      if (!remote || typeof remote !== 'object') return;
      const localHist = JSON.parse(localStorage.getItem('reader_history') || '{}');
      const remHist = remote.history || {};
      for (const [k, v] of Object.entries(remHist)) {
        if (!localHist[k] || (v.updatedAt || 0) > (localHist[k].updatedAt || 0)) {
          localHist[k] = v;
        }
      }
      localStorage.setItem('reader_history', JSON.stringify(localHist));

      if (remote.bookmarks) {
        const lb = JSON.parse(localStorage.getItem('reader_bookmarks') || '{}');
        localStorage.setItem('reader_bookmarks', JSON.stringify({ ...remote.bookmarks, ...lb }));
      }
      if (remote.highlights) {
        const lh = JSON.parse(localStorage.getItem('reader_highlights') || '{}');
        localStorage.setItem('reader_highlights', JSON.stringify({ ...remote.highlights, ...lh }));
      }
      if (remote.entityNotes) {
        const le = JSON.parse(localStorage.getItem('reader_entity_notes') || '{}');
        localStorage.setItem('reader_entity_notes', JSON.stringify({ ...remote.entityNotes, ...le }));
      }
      if (Array.isArray(remote.vocabAnki)) {
        const lv = getVocabList();
        const ids = new Set(lv.map(x => x.id));
        remote.vocabAnki.forEach(c => { if (!ids.has(c.id)) lv.push(c); });
        saveVocabList(lv);
      }
      if (remote.bookReviews) {
        const lr = JSON.parse(localStorage.getItem('reader_book_reviews') || '{}');
        for (const [k, rv] of Object.entries(remote.bookReviews)) {
          if (!lr[k] || (rv && (rv.updatedAt || 0) >= (lr[k].updatedAt || 0))) {
            lr[k] = rv;
          }
        }
        localStorage.setItem('reader_book_reviews', JSON.stringify(lr));
      }
      if (remote.bookMetadata) {
        const lm = JSON.parse(localStorage.getItem('reader_book_metadata') || '{}');
        localStorage.setItem('reader_book_metadata', JSON.stringify({ ...lm, ...remote.bookMetadata }));
      }
      if (remote.bookFavorites) {
        const lf = JSON.parse(localStorage.getItem('reader_book_favorites') || '{}');
        localStorage.setItem('reader_book_favorites', JSON.stringify({ ...remote.bookFavorites, ...lf }));
      }
      if (remote.cloudCatalog) {
        const lc = getCloudCatalogMap();
        localStorage.setItem('reader_cloud_catalog', JSON.stringify({ ...remote.cloudCatalog, ...lc }));
      }
      if (remote.bookCovers && typeof remote.bookCovers === 'object') {
        const lcov = getBookCoversMap();
        try { localStorage.setItem('reader_book_covers', JSON.stringify({ ...remote.bookCovers, ...lcov })); } catch {}
      }
      if (remote.userProfile && typeof remote.userProfile === 'object') {
        const curP = getUserProfile();
        if ((remote.userProfile.updatedAt || 0) >= (curP.updatedAt || 0)) {
          localStorage.setItem('reader_user_profile', JSON.stringify({ ...curP, ...remote.userProfile }));
          refreshToolbarUserMenu();
        }
      }
      if (remote.insights && remote.insights.minutesByDate) {
        const li = getReadingInsights();
        const mergedMins = { ...(li.minutesByDate || {}) };
        for (const [dKey, mins] of Object.entries(remote.insights.minutesByDate)) {
          mergedMins[dKey] = Math.max(mergedMins[dKey] || 0, mins || 0);
        }
        li.minutesByDate = mergedMins;
        saveReadingInsights(li);
      }

      renderRecentHistory();
      renderBookshelf();
      if (document.getElementById('profileModal') && document.getElementById('profileModal').classList.contains('open')) {
        renderProfileModal();
      }
      if (state.bookKey && localHist[state.bookKey]) {
        const target = localHist[state.bookKey];
        if (target.currentIndex !== state.currentIndex) {
          state.currentIndex = target.currentIndex;
          renderSection({ restoreSubPage: target.subPageIndex || 0, restoreScrollRatio: target.scrollRatio || 0 });
        }
      }
    }

    async function pushCloudSyncSilent() {
      const cfg = getCloudConfig();
      const inv = getActiveInviteState();
      // Visitante anônimo sem login nunca sobrescreve o progresso raiz; usuário autenticado salva na própria pasta _users/
      if (inv && !cfg.userEmail) return;
      if (!isCloudProfileAuthenticated(cfg)) return;
      const paths = getSyncStateStoragePaths(cfg);
      const payload = buildSyncPayload();
      try {
        if (typeof pushPublicClubProfile === 'function') pushPublicClubProfile(cfg).catch(() => {});
        if (isOAuthCloudProvider(cfg.provider)) {
          await cloudWriteJsonByPath(cfg, '_reader_sync_state.json', payload);
        } else if (cfg.provider === 'firebase') {
          const fbUrl = `${cfg.url}/reader_sync/${encodeURIComponent(paths.postgresKey)}.json${cfg.apiKey ? `?auth=${encodeURIComponent(cfg.apiKey)}` : ''}`;
          await fetch(fbUrl, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
          });
        } else if (cfg.apiKey) {
          const objUrl = `${cfg.url}/storage/v1/object/${cfg.bucket}/${paths.primaryStoragePath}`;
          await fetch(objUrl, {
            method: 'POST',
            headers: getSupabaseHeaders(cfg, { 'Content-Type': 'application/json', 'x-upsert': 'true' }),
            body: JSON.stringify(payload)
          });
          fetch(`${cfg.url}/rest/v1/reader_profiles`, {
            method: 'POST',
            headers: getSupabaseHeaders(cfg, { 'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates' }),
            body: JSON.stringify({ sync_key: paths.postgresKey, payload, updated_at: new Date().toISOString() })
          }).catch(() => {});
        }
      } catch {}
    }

    // Sincronizar Progresso, Perfil, Marcadores, Resenhas e Anki (por usuário quando logado no Banco Compartilhado)
    document.getElementById('btnSyncProgressCloud').addEventListener('click', async () => {
      document.getElementById('btnSaveCloudConfig').click();
      const cfg = getCloudConfig();
      const statusEl = document.getElementById('cloudStatusMsg');
      if (!isOAuthCloudProvider(cfg.provider) && !cfg.url) {
        statusEl.textContent = 'Preencha e salve a URL do Supabase ou Firebase primeiro.';
        return;
      }
      if (isOAuthCloudProvider(cfg.provider) && !isCloudProfileAuthenticated(cfg)) {
        statusEl.textContent = `Conecte sua conta ${getCloudProviderLabel(cfg.provider)} primeiro antes de sincronizar.`;
        return;
      }
      const inv = getActiveInviteState();
      const paths = getSyncStateStoragePaths(cfg);
      if (inv && !cfg.userEmail) {
        statusEl.textContent = 'Entre com seu e-mail e senha acima para salvar seu próprio progresso e perfil neste banco compartilhado.';
        return;
      }

      statusEl.textContent = 'Sincronizando perfil, progresso, marcadores, resenhas e Anki...';
      try {
        if (isOAuthCloudProvider(cfg.provider)) {
          const remoteData = await cloudReadJsonByPath(cfg, '_reader_sync_state.json').catch(() => null);
          if (remoteData) mergeSyncPayload(remoteData);
          await cloudWriteJsonByPath(cfg, '_reader_sync_state.json', buildSyncPayload());
          statusEl.textContent = `Perfil, progresso, marcadores e Anki sincronizados com sucesso no ${getCloudProviderLabel(cfg.provider)}!`;
          showToast(`Sincronizado com o ${getCloudProviderLabel(cfg.provider)}!`);
        } else if (cfg.provider === 'firebase') {
          const fbUrl = `${cfg.url}/reader_sync/${encodeURIComponent(paths.postgresKey)}.json${cfg.apiKey ? `?auth=${encodeURIComponent(cfg.apiKey)}` : ''}`;
          const getRes = await fetch(fbUrl);
          if (getRes.ok) {
            const remoteData = await getRes.json();
            if (remoteData) mergeSyncPayload(remoteData);
          }
          const putRes = await fetch(fbUrl, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(buildSyncPayload())
          });
          if (!putRes.ok) throw new Error(`HTTP ${putRes.status}`);
          statusEl.textContent = 'Sincronizado com sucesso via Firebase Realtime Database!';
          showToast('Progresso sincronizado com a nuvem!');
        } else {
          const headers = getSupabaseHeaders(cfg);
          const bust = Date.now();
          const objUrl = `${cfg.url}/storage/v1/object/${cfg.bucket}/${paths.primaryStoragePath}`;

          const dbGet = await fetch(`${cfg.url}/rest/v1/reader_profiles?sync_key=eq.${encodeURIComponent(paths.postgresKey)}&select=payload`, { cache: 'no-store', headers }).catch(() => null);
          if (dbGet && dbGet.ok) {
            const rows = await dbGet.json().catch(() => []);
            if (rows && rows[0] && rows[0].payload) { mergeSyncPayload(rows[0].payload); }
          }
          const getRes = await fetch(`${objUrl}?t=${bust}`, { cache: 'no-store', headers }).catch(() => null);
          if (getRes && getRes.ok) {
            const remoteData = await getRes.json().catch(() => null);
            if (remoteData) { mergeSyncPayload(remoteData); }
          }
          // Verificar também a pasta raiz da estante apenas se não for convidado nem conta recém-criada via Cadastro
          const skipLegacyFb = localStorage.getItem('reader_skip_legacy_fallback') === (cfg.userEmail || '').toLowerCase();
          if (!inv && !skipLegacyFb && paths.fallbackStoragePath) {
            if (paths.fallbackPostgresKey) {
              const fbDb = await fetch(`${cfg.url}/rest/v1/reader_profiles?sync_key=eq.${encodeURIComponent(paths.fallbackPostgresKey)}&select=payload`, { cache: 'no-store', headers }).catch(() => null);
              if (fbDb && fbDb.ok) {
                const fbRows = await fbDb.json().catch(() => []);
                if (fbRows && fbRows[0] && fbRows[0].payload) mergeSyncPayload(fbRows[0].payload);
              }
            }
            const fbRes = await fetch(`${cfg.url}/storage/v1/object/${cfg.bucket}/${paths.fallbackStoragePath}?t=${bust}`, { cache: 'no-store', headers }).catch(() => null);
            if (fbRes && fbRes.ok) {
              const fbData = await fbRes.json().catch(() => null);
              if (fbData) mergeSyncPayload(fbData);
            }
          }

          const payload = buildSyncPayload();
          const putRes = await fetch(objUrl, {
            method: 'POST',
            headers: getSupabaseHeaders(cfg, { 'Content-Type': 'application/json', 'x-upsert': 'true' }),
            body: JSON.stringify(payload)
          });
          const dbPost = await fetch(`${cfg.url}/rest/v1/reader_profiles`, {
            method: 'POST',
            headers: getSupabaseHeaders(cfg, { 'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates' }),
            body: JSON.stringify({ sync_key: paths.postgresKey, payload, updated_at: new Date().toISOString() })
          }).catch(() => null);

          if (!putRes.ok && !(dbPost && dbPost.ok)) {
            const errMsg = await putRes.text().catch(() => '');
            throw new Error(`Supabase HTTP ${putRes.status} (${errMsg || 'verifique bucket e policies'})`);
          }
          statusEl.textContent = 'Perfil, progresso, marcadores e Anki sincronizados com sucesso no Supabase!';
          showToast('Sincronizado com o Supabase!');
        }
      } catch (err) {
        statusEl.textContent = 'Erro na sincronização: ' + err.message;
      }
    });

    // Enviar livro aberto atualmente para 1 ou mais bancos conectados
    document.getElementById('btnUploadCurrentBookCloud').addEventListener('click', async () => {
      document.getElementById('btnSaveCloudConfig').click();
      if (!state.currentFileBuffer || !state.currentFileName) {
        alert('Abra um livro primeiro para enviá-lo à nuvem.');
        return;
      }
      await uploadBookRecordToCloud({
        bookKey: state.bookKey,
        fileName: state.currentFileName,
        title: state.title || state.currentFileName,
        author: state.author,
        format: state.format,
        size: state.currentFileBuffer.byteLength || 0,
        totalSections: state.sections.length,
        buffer: state.currentFileBuffer
      });
    });

    async function fetchBankFilesAndQuota(bankProf) {
      const syncKey = bankProf.syncKey || 'minha-estante';
      if (bankProf.provider === 'gdrive') {
        const fProf = await ensureFreshOAuthToken(bankProf);
        if (!fProf.accessToken || fProf._tokenExpired) {
          return { prof: bankProf, files: [], rawList: [], usedBytes: 0, maxMb: 15360, ok: false, error: fProf._tokenExpired ? 'Sessão expirou — reconecte' : 'Não conectado' };
        }
        try {
          let maxMb = 15360;
          const aboutRes = await fetch('https://www.googleapis.com/drive/v3/about?fields=storageQuota', {
            headers: { Authorization: `Bearer ${fProf.accessToken}` }
          }).catch(() => null);
          if (aboutRes && aboutRes.ok) {
            const aj = await aboutRes.json().catch(() => null);
            if (aj && aj.storageQuota && aj.storageQuota.limit) {
              maxMb = Math.max(1024, Math.round(Number(aj.storageQuota.limit) / 1048576));
            }
          }
          const folderId = await findOrCreateGDriveFolder(fProf, false);
          if (!folderId) {
            return { prof: fProf, files: [], rawList: [], usedBytes: 0, maxMb, ok: true };
          }
          const listUrl = `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(`'${folderId}' in parents and trashed=false and mimeType!='application/vnd.google-apps.folder'`)}&fields=files(id,name,size,modifiedTime)&pageSize=200`;
          const lRes = await fetch(listUrl, { cache: 'no-store', headers: { Authorization: `Bearer ${fProf.accessToken}` } });
          if (!lRes.ok) return { prof: fProf, files: [], rawList: [], usedBytes: 0, maxMb, ok: false, error: `HTTP ${lRes.status}` };
          const lj = await lRes.json();
          const rawList = (lj.files || []).map(f => ({ name: f.name, size: Number(f.size || 0), _remoteFileId: f.id, updated_at: f.modifiedTime }));
          const usedBytes = rawList.reduce((s, f) => s + (f.size || 0), 0);
          const files = rawList
            .filter(f => f.name && !f.name.startsWith('_reader_sync') && !f.name.startsWith('_shared_') && !f.name.startsWith('_users'))
            .map(f => ({ ...f, _bankId: fProf.id || '', _bankName: fProf.name || 'Google Drive', _bankProfile: { ...fProf, syncKey, driveFolderId: folderId } }));
          return { prof: fProf, files, rawList, usedBytes, maxMb, ok: true };
        } catch (err) {
          return { prof: bankProf, files: [], rawList: [], usedBytes: 0, maxMb: 15360, ok: false, error: err.message };
        }
      }
      if (bankProf.provider === 'onedrive') {
        const fProf = await ensureFreshOAuthToken(bankProf);
        if (!fProf.accessToken || fProf._tokenExpired) {
          return { prof: bankProf, files: [], rawList: [], usedBytes: 0, maxMb: 5120, ok: false, error: fProf._tokenExpired ? 'Sessão expirou — reconecte' : 'Não conectado' };
        }
        try {
          let maxMb = 5120;
          const qRes = await fetch('https://graph.microsoft.com/v1.0/me/drive?$select=quota', {
            headers: { Authorization: `Bearer ${fProf.accessToken}` }
          }).catch(() => null);
          if (qRes && qRes.ok) {
            const qj = await qRes.json().catch(() => null);
            if (qj && qj.quota && qj.quota.total) {
              maxMb = Math.max(1024, Math.round(Number(qj.quota.total) / 1048576));
            }
          }
          const encKey = encodeURIComponent(syncKey);
          const lRes = await fetch(`https://graph.microsoft.com/v1.0/me/drive/special/approot:/${encKey}:/children?$top=200&$select=id,name,size,lastModifiedDateTime,file`, {
            cache: 'no-store',
            headers: { Authorization: `Bearer ${fProf.accessToken}` }
          });
          if (lRes.status === 404) {
            return { prof: fProf, files: [], rawList: [], usedBytes: 0, maxMb, ok: true };
          }
          if (!lRes.ok) return { prof: fProf, files: [], rawList: [], usedBytes: 0, maxMb, ok: false, error: `HTTP ${lRes.status}` };
          const lj = await lRes.json();
          const rawList = (lj.value || []).filter(it => it.file).map(it => ({ name: it.name, size: Number(it.size || 0), _remoteFileId: it.id, updated_at: it.lastModifiedDateTime }));
          const usedBytes = rawList.reduce((s, f) => s + (f.size || 0), 0);
          const files = rawList
            .filter(f => f.name && !f.name.startsWith('_reader_sync') && !f.name.startsWith('_shared_') && !f.name.startsWith('_users'))
            .map(f => ({ ...f, _bankId: fProf.id || '', _bankName: fProf.name || 'OneDrive', _bankProfile: { ...fProf, syncKey } }));
          return { prof: fProf, files, rawList, usedBytes, maxMb, ok: true };
        } catch (err) {
          return { prof: bankProf, files: [], rawList: [], usedBytes: 0, maxMb: 5120, ok: false, error: err.message };
        }
      }
      const url = (bankProf.url || '').replace(/\/+$/, '');
      if (!url) return { prof: bankProf, files: [], rawList: [], usedBytes: 0, maxMb: 1024, ok: false, error: 'URL vazia' };
      if (bankProf.provider === 'firebase') {
        try {
          const fbUrl = `${url}/reader_sync/${encodeURIComponent(syncKey)}.json${bankProf.apiKey ? `?auth=${encodeURIComponent(bankProf.apiKey)}` : ''}`;
          const r = await fetch(fbUrl, { cache: 'no-store' });
          if (!r.ok) return { prof: bankProf, files: [], rawList: [], usedBytes: 0, maxMb: 1024, ok: false, error: `HTTP ${r.status}` };
          const txt = await r.text();
          const bytes = new TextEncoder().encode(txt === 'null' ? '' : txt).length;
          return { prof: bankProf, files: [], rawList: [], usedBytes: bytes, maxMb: 1024, ok: true, isFirebase: true };
        } catch (err) {
          return { prof: bankProf, files: [], rawList: [], usedBytes: 0, maxMb: 1024, ok: false, isFirebase: true, error: err.message };
        }
      }
      if (!bankProf.apiKey) return { prof: bankProf, files: [], rawList: [], usedBytes: 0, maxMb: 1024, ok: false, error: 'Sem API Key' };
      const bucket = bankProf.bucket || 'books';
      try {
        let fProf = await ensureFreshSupabaseToken(bankProf);
        let res = await fetch(`${url}/storage/v1/object/list/${bucket}`, {
          method: 'POST',
          headers: getSupabaseHeaders(fProf, { 'Content-Type': 'application/json' }),
          body: JSON.stringify({ prefix: `${syncKey}/`, limit: 100, offset: 0 })
        });
        // Se o token JWT salvou/expirou e foi rejeitado, tenta novamente com a chave pública para não zerar a estante
        if (!res.ok && (res.status === 400 || res.status === 401 || res.status === 403) && fProf.accessToken) {
          const anonProf = { ...fProf, accessToken: '' };
          const retryRes = await fetch(`${url}/storage/v1/object/list/${bucket}`, {
            method: 'POST',
            headers: getSupabaseHeaders(anonProf, { 'Content-Type': 'application/json' }),
            body: JSON.stringify({ prefix: `${syncKey}/`, limit: 100, offset: 0 })
          });
          if (retryRes.ok) res = retryRes;
        }
        if (!res.ok) return { prof: fProf, files: [], rawList: [], usedBytes: 0, maxMb: 1024, ok: false, error: `HTTP ${res.status}` };
        const rawList = await res.json() || [];
        const usedBytes = rawList.reduce((s, f) => s + ((f && f.metadata && f.metadata.size) || f.size || 0), 0);
        const files = rawList
          .filter(f => f.name && !f.name.startsWith('_reader_sync') && !f.name.startsWith('_shared_') && f.name !== '_inbox' && f.name !== '_users')
          .map(f => ({ ...f, _bankId: fProf.id || '', _bankName: fProf.name || fProf.syncKey, _bankProfile: { ...fProf, url, bucket, syncKey } }));
        return { prof: fProf, files, rawList, usedBytes, maxMb: 1024, ok: true };
      } catch (err) {
        return { prof: bankProf, files: [], rawList: [], usedBytes: 0, maxMb: 1024, ok: false, error: err.message };
      }
    }

    // Listar e abrir livros de um ou vários bancos conectados ao mesmo tempo
    async function listCloudBooks() {
      const cfg = getCloudConfig();
      const statusEl = document.getElementById('cloudStatusMsg');
      const listEl = document.getElementById('cloudBooksList');
      const inv = getActiveInviteState();
      const combineAll = !inv && localStorage.getItem('reader_combine_cloud_banks') !== 'false';
      const profiles = getCloudProfilesList();
      const targets = inv
        ? [{
            ...cfg,
            id: cfg.profileId || 'invite_db',
            name: `Compartilhado (${inv.syncKey || 'estante'})`,
            provider: 'supabase',
            url: healLegacySupabaseUrl(inv.url || cfg.url),
            apiKey: inv.apiKey || cfg.apiKey,
            bucket: inv.bucket || cfg.bucket || 'books',
            syncKey: inv.syncKey || cfg.syncKey || 'minha-estante'
          }]
        : (combineAll
            ? profiles
            : [profiles.find(p => p.id === cfg.profileId) || { id: cfg.profileId || 'active', name: 'Banco Ativo', ...cfg }]);

      if (!targets.some(t => isCloudProfileAuthenticated(t))) {
        if (statusEl) statusEl.textContent = 'Configure o Supabase/Firebase ou conecte sua conta Google Drive / OneDrive acima.';
        return;
      }

      if (statusEl) statusEl.textContent = targets.length > 1 ? `Consultando ${targets.length} bancos conectados ao mesmo tempo...` : 'Buscando livros na sua Estante na Nuvem...';
      try {
        const results = await Promise.all(targets.map(t => fetchBankFilesAndQuota(t)));
        const bankQuotas = results.map(r => ({
          id: r.prof.id || '',
          name: r.prof.name || r.prof.syncKey || 'Banco',
          provider: r.prof.provider || 'supabase',
          syncKey: r.prof.syncKey || 'minha-estante',
          usedBytes: r.usedBytes,
          maxMb: r.maxMb,
          fileCount: r.files.length,
          ok: r.ok,
          error: r.error || '',
          isActive: (r.prof.id && r.prof.id === cfg.profileId) || (r.prof.url === cfg.url && r.prof.syncKey === cfg.syncKey)
        }));
        const allFiles = results.flatMap(r => r.files);
        updateCloudQuotaUi(allFiles, bankQuotas);
        await pullSharedCatalogFromCloud();

        const anyOk = results.some(r => r.ok);
        if (anyOk || !cachedCloudFilesList.length) {
          cachedCloudFilesList = allFiles;
          renderBookshelf(document.getElementById('inputFilterShelf') ? document.getElementById('inputFilterShelf').value : '');
        }

        if (!listEl) return;
        if (!allFiles.length) {
          const errBank = bankQuotas.find(b => !b.ok);
          const hasFirebaseOnly = bankQuotas.some(b => b.provider === 'firebase' && b.ok) && !bankQuotas.some(b => b.provider !== 'firebase' && b.fileCount > 0);
          listEl.innerHTML = (!anyOk && errBank)
            ? `<div style="padding:10px; font-size:12px; color:#ef4444;">Não foi possível consultar o banco (${escapeHtml(errBank.error || 'erro de conexão')}). Clique em "Atualizar Estante da Nuvem" ou entre novamente na sua conta.</div>`
            : (hasFirebaseOnly
                ? '<div style="padding:10px; font-size:12px; color:var(--text-muted);">Firebase conectado (sincroniza progresso, perfil e Anki). Para arquivos .epub/.pdf/.cbz, use um banco Supabase acima.</div>'
                : '<div style="padding:10px; font-size:12px; color:var(--text-muted);">Nenhum livro encontrado nos bancos conectados ainda. Abra um livro e clique em "Subir Livro Atual p/ Nuvem".</div>');
          if (statusEl) {
            statusEl.textContent = (!anyOk && errBank)
              ? `Falha ao consultar banco (${errBank.error || 'erro'}).`
              : `${bankQuotas.filter(b => b.ok).length} banco(s) consultado(s) (0 livros).`;
          }
          return;
        }

        listEl.innerHTML = '';
        allFiles.forEach(f => {
          const bankTag = targets.length > 1 && f._bankName ? ` <span style="font-size:10px; color:var(--accent);">[${escapeHtml(f._bankName)}]</span>` : '';
          const row = document.createElement('div');
          row.className = 'card-item';
          row.style.cssText = 'display:flex; align-items:center; justify-content:space-between; gap:10px; margin-bottom:6px;';
          row.innerHTML = `
            <div style="font-weight:500; color:var(--text-primary); overflow:hidden; text-overflow:ellipsis;">${escapeHtml(f.name)}${bankTag}</div>
            <button class="btn primary">Baixar e Ler</button>
          `;
          row.querySelector('button').addEventListener('click', async () => {
            await downloadAndOpenCloudBook(f.name, f.name, f);
          });
          listEl.appendChild(row);
        });
        if (statusEl) statusEl.textContent = `${allFiles.length} livro(s) em ${bankQuotas.filter(b => b.ok).length} banco(s) conectado(s).`;
      } catch (err) {
        if (statusEl) statusEl.textContent = 'Erro ao listar livros da nuvem: ' + err.message;
      }
    }

    async function downloadAndOpenCloudBook(safeName, originalName, bookObj = null) {
      const matchedCloud = cachedCloudFilesList.find(cf => cf.name === safeName && (!bookObj || !bookObj._bankId || cf._bankId === bookObj._bankId));
      const cfg = (bookObj && bookObj._bankProfile) || (matchedCloud && matchedCloud._bankProfile) || getCloudConfig();
      const statusEl = document.getElementById('cloudStatusMsg');
      // 1. Verificar cache offline em IndexedDB primeiro (instantâneo e funciona sem internet!)
      try {
        const localBooks = await idbGetAllBooks();
        const cat = getCloudCatalogMap();
        const meta = cat[safeName] || {};
        const match = localBooks.find(b =>
          (meta.bookKey && b.bookKey === meta.bookKey) ||
          safeCloudFileName(b.fileName) === safeName ||
          (originalName && b.fileName === originalName)
        );
        if (match && match.buffer) {
          if (navigator.onLine) syncCloudStateSilentPull().catch(() => {});
          showToast(`Abrindo "${match.title || originalName || safeName}" do cache offline!`);
          document.getElementById('cloudModal').classList.remove('open');
          await loadFile({ name: match.fileName, size: match.size, buffer: match.buffer }, { skipIdbSave: true });
          return;
        }
        if (!navigator.onLine) {
          throw new Error('Você está sem internet e este livro ainda não foi aberto/salvo offline neste aparelho.');
        }
      } catch (offErr) {
        if (!navigator.onLine) {
          alert(offErr.message);
          return;
        }
      }
      showToast(`Baixando "${originalName || safeName}" da nuvem (ficará salvo offline)...`);
      try {
        await syncCloudStateSilentPull();
        let buf = null;
        if (cfg.provider === 'gdrive') {
          const fCfg = await ensureFreshOAuthToken(cfg);
          if (!fCfg.accessToken || fCfg._tokenExpired) throw new Error('Sessão do Google Drive expirou. Clique em Conectar Google Drive.');
          let fileId = (bookObj && bookObj._remoteFileId) || (matchedCloud && matchedCloud._remoteFileId) || '';
          if (!fileId) {
            const folderId = await findOrCreateGDriveFolder(fCfg, false);
            const found = folderId ? await findGDriveFileInFolder(fCfg, folderId, safeName) : null;
            fileId = found ? found.id : '';
          }
          if (!fileId) throw new Error('Arquivo não encontrado no Google Drive.');
          const dlRes = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`, { headers: { Authorization: `Bearer ${fCfg.accessToken}` } });
          if (!dlRes.ok) throw new Error(`Google Drive HTTP ${dlRes.status}`);
          buf = await dlRes.arrayBuffer();
        } else if (cfg.provider === 'onedrive') {
          const fCfg = await ensureFreshOAuthToken(cfg);
          if (!fCfg.accessToken || fCfg._tokenExpired) throw new Error('Sessão do OneDrive expirou. Clique em Conectar OneDrive.');
          const fileId = (bookObj && bookObj._remoteFileId) || (matchedCloud && matchedCloud._remoteFileId) || '';
          const dlUrl = fileId
            ? `https://graph.microsoft.com/v1.0/me/drive/items/${fileId}/content`
            : `https://graph.microsoft.com/v1.0/me/drive/special/approot:/${encodeURIComponent(fCfg.syncKey || 'minha-estante')}/${encodeURIComponent(safeName)}:/content`;
          const dlRes = await fetch(dlUrl, { headers: { Authorization: `Bearer ${fCfg.accessToken}` } });
          if (!dlRes.ok) throw new Error(`OneDrive HTTP ${dlRes.status}`);
          buf = await dlRes.arrayBuffer();
        } else {
          const dlUrl = `${cfg.url}/storage/v1/object/${cfg.bucket || 'books'}/${cfg.syncKey || 'minha-estante'}/${encodeURIComponent(safeName)}`;
          const dlRes = await fetch(dlUrl, { headers: getSupabaseHeaders(cfg) });
          if (!dlRes.ok) throw new Error(`HTTP ${dlRes.status}`);
          buf = await dlRes.arrayBuffer();
        }
        const cat = getCloudCatalogMap();
        const meta = cat[safeName] || {};
        const fileToLoadName = (meta.originalFileName) || originalName || safeName;
        document.getElementById('cloudModal').classList.remove('open');
        await loadFile({ name: fileToLoadName, size: buf.byteLength, buffer: buf });
      } catch (err) {
        if (statusEl) statusEl.textContent = 'Erro ao baixar livro: ' + err.message;
        alert('Erro ao baixar livro da nuvem: ' + err.message);
      }
    }

    async function deleteCloudBook(safeName, bookObj = null) {
      const matchedCloud = cachedCloudFilesList.find(cf => cf.name === safeName && (!bookObj || !bookObj._bankId || cf._bankId === bookObj._bankId));
      const cfg = (bookObj && bookObj._bankProfile) || (matchedCloud && matchedCloud._bankProfile) || getCloudConfig();
      const targetBankId = (bookObj && bookObj._bankId) || (matchedCloud && matchedCloud._bankId) || '';
      try {
        if (cfg.provider === 'gdrive') {
          const fCfg = await ensureFreshOAuthToken(cfg);
          if (!fCfg.accessToken || fCfg._tokenExpired) throw new Error('Reconecte o Google Drive para remover arquivos.');
          let fileId = (bookObj && bookObj._remoteFileId) || (matchedCloud && matchedCloud._remoteFileId) || '';
          if (!fileId) {
            const folderId = await findOrCreateGDriveFolder(fCfg, false);
            const found = folderId ? await findGDriveFileInFolder(fCfg, folderId, safeName) : null;
            fileId = found ? found.id : '';
          }
          if (fileId) {
            const r = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}`, { method: 'DELETE', headers: { Authorization: `Bearer ${fCfg.accessToken}` } });
            if (!r.ok && r.status !== 404) throw new Error(`Google Drive HTTP ${r.status}`);
          }
        } else if (cfg.provider === 'onedrive') {
          const fCfg = await ensureFreshOAuthToken(cfg);
          if (!fCfg.accessToken || fCfg._tokenExpired) throw new Error('Reconecte o OneDrive para remover arquivos.');
          const fileId = (bookObj && bookObj._remoteFileId) || (matchedCloud && matchedCloud._remoteFileId) || '';
          const delUrl = fileId
            ? `https://graph.microsoft.com/v1.0/me/drive/items/${fileId}`
            : `https://graph.microsoft.com/v1.0/me/drive/special/approot:/${encodeURIComponent(fCfg.syncKey || 'minha-estante')}/${encodeURIComponent(safeName)}`;
          const r = await fetch(delUrl, { method: 'DELETE', headers: { Authorization: `Bearer ${fCfg.accessToken}` } });
          if (!r.ok && r.status !== 404) throw new Error(`OneDrive HTTP ${r.status}`);
        } else {
          const freshCfg = await ensureFreshSupabaseToken(cfg);
          const res = await fetch(`${freshCfg.url}/storage/v1/object/${freshCfg.bucket || 'books'}/${freshCfg.syncKey || 'minha-estante'}/${encodeURIComponent(safeName)}`, {
            method: 'DELETE',
            headers: getSupabaseHeaders(freshCfg)
          });
          if (!res.ok) {
            const detail = await readSupabaseErrorText(res);
            if (/row-level security|unauthorized/i.test(detail)) {
              throw new Error('Sem permissão para excluir livros da estante principal (apenas o dono pode remover).');
            }
            throw new Error(`${detail} (HTTP ${res.status})`);
          }
        }
        cachedCloudFilesList = cachedCloudFilesList.filter(f => !(f.name === safeName && (!targetBankId || f._bankId === targetBankId)));
        renderBookshelf(document.getElementById('inputFilterShelf') ? document.getElementById('inputFilterShelf').value : '');
        listCloudBooks().catch(() => {});
        showToast('Livro removido da Nuvem');
      } catch (err) {
        alert('Erro ao remover da Nuvem: ' + err.message);
      }
    }

    function getWritableCloudBankTargets() {
      const cfg = getCloudConfig();
      const inv = getActiveInviteState();
      if (inv) {
        return [{
          ...cfg,
          id: cfg.profileId || 'invite_db',
          name: `Compartilhado (${inv.syncKey || 'estante'})`,
          provider: 'supabase',
          url: healLegacySupabaseUrl(inv.url || cfg.url),
          apiKey: inv.apiKey || cfg.apiKey,
          bucket: inv.bucket || cfg.bucket || 'books',
          syncKey: inv.syncKey || cfg.syncKey || 'minha-estante'
        }];
      }
      const profiles = getCloudProfilesList();
      const writable = profiles.filter(p => p && p.provider !== 'firebase' && isCloudProfileAuthenticated(p));
      if (!writable.length && cfg && cfg.provider !== 'firebase' && isCloudProfileAuthenticated(cfg)) {
        return [{ ...cfg, id: cfg.profileId || 'active_db', name: cfg.name || getCloudProviderLabel(cfg.provider) }];
      }
      return writable;
    }

    function promptUploadBankDestinations(bookRec, writableBanks) {
      if (!Array.isArray(writableBanks) || writableBanks.length <= 1) {
        return Promise.resolve(writableBanks || []);
      }
      const modal = document.getElementById('cloudUploadDestModal');
      const infoEl = document.getElementById('lblUploadDestBookInfo');
      const listEl = document.getElementById('cloudUploadDestList');
      if (!modal || !listEl) return Promise.resolve([writableBanks[0]]);

      const cfg = getCloudConfig();
      const sizeBytes = (bookRec && bookRec.buffer && bookRec.buffer.byteLength) || (bookRec && bookRec.size) || 0;
      const sizeMb = (sizeBytes / 1048576).toFixed(2);
      if (infoEl) infoEl.textContent = `Livro: "${(bookRec && (bookRec.title || bookRec.fileName)) || 'Livro'}" (${sizeMb} MB)`;

      let savedIds = [];
      try { savedIds = JSON.parse(localStorage.getItem('reader_last_upload_banks') || '[]'); } catch {}
      const activeId = cfg.profileId || writableBanks[0].id;
      const SUPABASE_FREE_FILE_LIMIT = 50 * 1024 * 1024;

      listEl.innerHTML = '';
      writableBanks.forEach((b, idx) => {
        const isSupaTooBig = !isOAuthCloudProvider(b.provider) && sizeBytes > SUPABASE_FREE_FILE_LIMIT;
        const isActive = (b.id && b.id === activeId) || (b.provider === cfg.provider && b.syncKey === cfg.syncKey && b.url === cfg.url);
        const defaultChecked = !isSupaTooBig && (savedIds.length ? savedIds.includes(b.id) : (isActive || idx === 0));
        const capNote = isOAuthCloudProvider(b.provider)
          ? (b.provider === 'gdrive' ? 'Google Drive · 15 GB' : 'OneDrive · 5 GB')
          : (isSupaTooBig ? 'Supabase · Excede 50 MB!' : 'Supabase · até 50 MB/arq');

        const row = document.createElement('label');
        row.style.cssText = 'display:flex; align-items:center; justify-content:space-between; gap:8px; padding:8px 10px; border:1px solid var(--border-color); border-radius:4px; background:var(--bg-toolbar); cursor:pointer; font-size:12px;';
        row.innerHTML = `
          <span style="display:flex; align-items:center; gap:8px; min-width:0;">
            <input type="checkbox" class="chk-upload-dest-bank" value="${escapeHtml(b.id)}" ${defaultChecked ? 'checked' : ''} ${isSupaTooBig ? 'disabled' : ''} />
            <span style="font-weight:600; color:var(--text-primary); overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${escapeHtml(b.name || getCloudProviderLabel(b.provider))}${isActive ? ' ★' : ''}</span>
          </span>
          <span style="font-size:10.5px; color:${isSupaTooBig ? '#ef4444' : 'var(--text-muted)'}; flex-shrink:0;">${escapeHtml(capNote)} · ${escapeHtml(b.syncKey || 'minha-estante')}</span>
        `;
        listEl.appendChild(row);
      });

      return new Promise((resolve) => {
        const finish = (selected) => {
          modal.classList.remove('open');
          resolve(selected);
        };
        document.getElementById('btnCloseUploadDestModal').onclick = () => finish(null);
        document.getElementById('btnCancelUploadDest').onclick = () => finish(null);
        document.getElementById('btnUploadDestSelectAll').onclick = () => {
          listEl.querySelectorAll('.chk-upload-dest-bank:not(:disabled)').forEach(c => { c.checked = true; });
        };
        document.getElementById('btnUploadDestSelectActive').onclick = () => {
          listEl.querySelectorAll('.chk-upload-dest-bank:not(:disabled)').forEach(c => { c.checked = (c.value === activeId); });
        };
        document.getElementById('btnConfirmUploadDest').onclick = () => {
          const pickedIds = Array.from(listEl.querySelectorAll('.chk-upload-dest-bank:checked')).map(c => c.value);
          if (!pickedIds.length) {
            alert('Marque pelo menos 1 banco de destino para enviar.');
            return;
          }
          try { localStorage.setItem('reader_last_upload_banks', JSON.stringify(pickedIds)); } catch {}
          finish(writableBanks.filter(b => pickedIds.includes(b.id)));
        };
        modal.classList.add('open');
      });
    }

    async function uploadBookRecordToSingleBank(bookRec, targetBank, inv) {
      const isOAuth = isOAuthCloudProvider(targetBank.provider);
      if (!isOAuth) {
        const SUPABASE_FREE_FILE_LIMIT = 50 * 1024 * 1024;
        if (bookRec.buffer.byteLength > SUPABASE_FREE_FILE_LIMIT) {
          const mb = (bookRec.buffer.byteLength / 1048576).toFixed(1);
          throw new Error(`Excede o limite de 50 MB do Supabase Storage (${mb} MB).`);
        }
      }
      const freshCfg = isOAuth ? await ensureFreshOAuthToken(targetBank) : await ensureFreshSupabaseToken(targetBank);
      const safeFile = safeCloudFileName(bookRec.fileName || `${bookRec.title}.epub`);
      if (inv && inv.role === 'viewer') {
        throw new Error('Você está em modo Somente Leitura nesta estante compartilhada. Não é permitido enviar novos livros.');
      }
      let isSuggestOnly = Boolean(inv && inv.role === 'contributor' && !isOAuth);

      if (isOAuth) {
        await cloudUploadBinaryFile(freshCfg, safeFile, bookRec.buffer);
      } else {
        const tryUploadPath = async (pathSuffix) => {
          const uploadUrl = `${freshCfg.url}/storage/v1/object/${freshCfg.bucket || 'books'}/${pathSuffix}`;
          return await fetch(uploadUrl, {
            method: 'POST',
            headers: getSupabaseHeaders(freshCfg, { 'Content-Type': 'application/octet-stream', 'x-upsert': 'true' }),
            body: bookRec.buffer
          });
        };
        const targetPath = isSuggestOnly ? `${freshCfg.syncKey}/_inbox/${safeFile}` : `${freshCfg.syncKey}/${safeFile}`;
        let res = await tryUploadPath(targetPath);
        if (!res.ok) {
          if (res.status === 413) throw new Error('Arquivo excede o limite de 50 MB do Supabase (HTTP 413).');
          const detail = await readSupabaseErrorText(res);
          if (!isSuggestOnly && /row-level security|unauthorized|permission/i.test(detail)) {
            if (confirm(`A estante "${freshCfg.syncKey}" em "${targetBank.name || 'Supabase'}" está protegida pelo dono.\n\nDeseja enviar "${bookRec.title}" para a fila de aprovação (_inbox)?`)) {
              isSuggestOnly = true;
              res = await tryUploadPath(`${freshCfg.syncKey}/_inbox/${safeFile}`);
              if (!res.ok) {
                const detailInbox = await readSupabaseErrorText(res);
                throw new Error(`${detailInbox} (HTTP ${res.status})`);
              }
            } else {
              return { cancelled: true, isSuggestOnly: false };
            }
          } else {
            throw new Error(`${detail} (HTTP ${res.status})`);
          }
        }
      }

      if (!isSuggestOnly) {
        const catMeta = {
          bookKey: bookRec.bookKey,
          originalFileName: bookRec.fileName,
          title: bookRec.title,
          author: bookRec.author,
          format: bookRec.format,
          size: bookRec.size,
          total: bookRec.totalSections,
          coverThumb: getBookCoverDataUrl(bookRec.bookKey, safeFile) || ''
        };
        saveCloudCatalogEntry(safeFile, catMeta);
        await pushSharedCatalogMeta(safeFile, catMeta, freshCfg);
      }
      return { cancelled: false, isSuggestOnly, safeFile };
    }

    async function uploadBookRecordToCloud(bookRec) {
      const cfg = getCloudConfig();
      const inv = getActiveInviteState();
      if (inv && inv.role === 'viewer') {
        alert('Você entrou com link Somente Leitura. Peça ao dono um convite de Colaborador ou Membro.');
        return;
      }
      if (!bookRec || !bookRec.buffer) {
        alert('Abra ou selecione um livro primeiro para enviar.');
        return;
      }
      const writable = getWritableCloudBankTargets();
      if (!writable.length) {
        alert(isOAuthCloudProvider(cfg.provider)
          ? `Conecte sua conta ${getCloudProviderLabel(cfg.provider)} primeiro (na barra da Nuvem).`
          : 'Conecte o Supabase, Google Drive ou OneDrive primeiro para enviar livros.');
        return;
      }

      const chosenBanks = await promptUploadBankDestinations(bookRec, writable);
      if (!chosenBanks || !chosenBanks.length) return;

      const statusEl = document.getElementById('cloudStatusMsg');
      const bankNamesLabel = chosenBanks.map(b => b.name || getCloudProviderLabel(b.provider)).join(' + ');
      showToast(`Enviando "${bookRec.title}" para ${bankNamesLabel}...`);
      if (statusEl) statusEl.textContent = `Enviando "${bookRec.title}" para ${bankNamesLabel}...`;

      const succeeded = [];
      const errors = [];
      let anySuggest = false;

      for (const bank of chosenBanks) {
        try {
          const r = await uploadBookRecordToSingleBank(bookRec, bank, inv);
          if (r && !r.cancelled) {
            succeeded.push(bank.name || getCloudProviderLabel(bank.provider));
            if (r.isSuggestOnly) anySuggest = true;
          }
        } catch (err) {
          errors.push(`${bank.name || getCloudProviderLabel(bank.provider)}: ${err.message}`);
        }
      }

      if (succeeded.length) {
        const safeFile = safeCloudFileName(bookRec.fileName || `${bookRec.title}.epub`);
        if (anySuggest) {
          fetch('/api/send-kindle', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              notifyOwnerSuggestion: true,
              bookTitle: bookRec.title || safeFile,
              senderEmail: cfg.userEmail || 'leitor',
              syncKey: cfg.syncKey || 'minha-estante'
            })
          }).catch(() => {});
        }
        await recordSharedActivity({
          type: anySuggest ? 'suggest' : 'upload',
          bookTitle: bookRec.title || safeFile,
          fileName: bookRec.fileName || safeFile,
          fileSize: bookRec.size || 0
        });
        await pushCloudSyncSilent();
        await listCloudBooks();
        const okMsg = anySuggest
          ? `"${bookRec.title}" enviado para aprovação em: ${succeeded.join(', ')}!`
          : `"${bookRec.title}" salvo em: ${succeeded.join(', ')}!`;
        if (statusEl) statusEl.textContent = okMsg;
        showToast(okMsg);
      }
      if (errors.length) {
        const errMsg = `Falha em ${errors.join(' | ')}`;
        if (statusEl && !succeeded.length) statusEl.textContent = errMsg;
        alert(errMsg);
      }
    }

    async function syncCloudStateSilentPull() {
      const cfg = getCloudConfig();
      if (isOAuthCloudProvider(cfg.provider)) {
        try {
          const remoteData = await cloudReadJsonByPath(cfg, '_reader_sync_state.json').catch(() => null);
          if (remoteData) mergeSyncPayload(remoteData);
        } catch {}
        return;
      }
      if (!cfg.url) return;
      if (cfg.provider === 'firebase') {
        try {
          const paths = getSyncStateStoragePaths(cfg);
          const fbUrl = `${cfg.url}/reader_sync/${encodeURIComponent(paths.postgresKey)}.json${cfg.apiKey ? `?auth=${encodeURIComponent(cfg.apiKey)}` : ''}`;
          const r = await fetch(fbUrl, { cache: 'no-store' }).catch(() => null);
          if (r && r.ok) {
            const remoteData = await r.json().catch(() => null);
            if (remoteData) mergeSyncPayload(remoteData);
          }
        } catch {}
        return;
      }
      if (!cfg.apiKey) return;
      const inv = getActiveInviteState();
      if (inv && !cfg.userEmail) return; // Convidado anônimo só baixa os livros, sem puxar progresso privado do dono
      const paths = getSyncStateStoragePaths(cfg);
      try {
        const headers = getSupabaseHeaders(cfg);
        const bust = Date.now();
        const objUrl = `${cfg.url}/storage/v1/object/${cfg.bucket}/${paths.primaryStoragePath}?t=${bust}`;
        const getRes = await fetch(objUrl, { cache: 'no-store', headers }).catch(() => null);
        if (getRes && getRes.ok) {
          const remoteData = await getRes.json().catch(() => null);
          if (remoteData) mergeSyncPayload(remoteData);
        }
        const skipLegacyFb = localStorage.getItem('reader_skip_legacy_fallback') === (cfg.userEmail || '').toLowerCase();
        if (!inv && !skipLegacyFb && paths.fallbackStoragePath) {
          const fbRes = await fetch(`${cfg.url}/storage/v1/object/${cfg.bucket}/${paths.fallbackStoragePath}?t=${bust}`, { cache: 'no-store', headers }).catch(() => null);
          if (fbRes && fbRes.ok) {
            const fbData = await fbRes.json().catch(() => null);
            if (fbData) mergeSyncPayload(fbData);
          }
        }
      } catch {}
    }

    function getActiveInviteState() {
      try {
        return JSON.parse(sessionStorage.getItem('reader_active_invite') || localStorage.getItem('reader_active_invite_persist') || 'null');
      } catch { return null; }
    }

    function syncInviteBannerUi() {
      const inv = getActiveInviteState();
      const cfg = getCloudConfig();
      const banner = document.getElementById('inviteActiveBanner');
      const txt = document.getElementById('lblInviteBannerText');
      const btnSuggest = document.getElementById('btnGuestSuggestBook');
      const btnGuestLogin = document.getElementById('btnGuestSignIn');
      if (!banner || !txt) return;
      if (!inv) {
        banner.classList.add('hidden');
        return;
      }
      banner.classList.remove('hidden');
      const roleDesc = inv.role === 'member'
        ? '<strong>Membro</strong> (pode ler, entrar c/ sua conta e subir livros)'
        : (inv.role === 'contributor'
          ? '<strong>Colaborador</strong> (pode ler e sugerir livros p/ aprovação)'
          : '<strong>Somente Leitura</strong>');
      const authNote = cfg.userEmail
        ? ` Logado como <strong>${escapeHtml(cfg.userEmail)}</strong> (seu progresso e perfil são salvos separados).`
        : ' Clique em <strong>Entrar / Criar Minha Conta</strong> para salvar suas próprias páginas, foto e histórico.';
      txt.innerHTML = `Banco compartilhado <strong>${escapeHtml(inv.syncKey)}</strong> (${roleDesc}).${authNote}`;
      if (btnSuggest) {
        btnSuggest.classList.toggle('hidden', inv.role === 'viewer');
        btnSuggest.textContent = inv.role === 'member' ? '+ Subir Livro p/ Estante' : '+ Sugerir Livro p/ Aprovação';
      }
      if (btnGuestLogin) {
        btnGuestLogin.textContent = cfg.userEmail ? `Conta: ${cfg.userEmail.split('@')[0]}` : 'Entrar / Criar Minha Conta';
      }
    }

    async function refreshGuestInboxPanel() {
      const panel = document.getElementById('inboxPendingPanel');
      const listEl = document.getElementById('inboxPendingList');
      const activeInv = getActiveInviteState();
      if (!panel || !listEl || (activeInv && activeInv.role !== 'member')) return;
      const cfg = getCloudConfig();
      if (!cfg.url || !cfg.apiKey || cfg.provider === 'firebase' || isOAuthCloudProvider(cfg.provider)) return;
      try {
        const freshCfg = await ensureFreshSupabaseToken(cfg);
        const memRes = await fetch(`${freshCfg.url}/rest/v1/library_members?select=email,role&limit=50`, {
          cache: 'no-store',
          headers: getSupabaseHeaders(freshCfg)
        }).catch(() => null);
        if (memRes && memRes.ok) {
          const rows = await memRes.json().catch(() => []);
          const me = (freshCfg.userEmail || '').trim().toLowerCase();
          const hasFullAccess = Boolean(me && Array.isArray(rows) && rows.some(r => (r.email || '').toLowerCase() === me && (r.role === 'owner' || r.role === 'member')));
          if (!hasFullAccess) {
            panel.classList.add('hidden');
            return;
          }
        }
        const res = await fetch(`${freshCfg.url}/storage/v1/object/list/${freshCfg.bucket}`, {
          method: 'POST',
          headers: getSupabaseHeaders(freshCfg, { 'Content-Type': 'application/json' }),
          body: JSON.stringify({ prefix: `${freshCfg.syncKey}/_inbox/`, limit: 50, offset: 0 })
        });
        if (!res.ok) return;
        const inboxFiles = (await res.json() || []).filter(f => f.name && !f.name.startsWith('.'));
        if (!inboxFiles.length) {
          panel.classList.add('hidden');
          return;
        }
        panel.classList.remove('hidden');
        listEl.innerHTML = '';
        inboxFiles.forEach(f => {
          const row = document.createElement('div');
          row.style.cssText = 'display:flex; justify-content:space-between; align-items:center; gap:8px; flex-wrap:wrap; padding:6px 8px; background:var(--bg-page); border:1px solid var(--border-color); border-radius:4px; font-size:12px;';
          row.innerHTML = `
            <span style="font-weight:500;">${escapeHtml(f.name)}</span>
            <div style="display:flex; gap:6px;">
              <button class="btn primary btn-approve-inbox">Aprovar p/ Estante</button>
              <button class="btn btn-reject-inbox">Recusar</button>
            </div>
          `;
          row.querySelector('.btn-approve-inbox').addEventListener('click', async () => {
            showToast(`Aprovando "${f.name}"...`);
            const dlRes = await fetch(`${cfg.url}/storage/v1/object/${cfg.bucket}/${cfg.syncKey}/_inbox/${encodeURIComponent(f.name)}`, {
              headers: getSupabaseHeaders(cfg)
            });
            if (!dlRes.ok) return;
            const buf = await dlRes.arrayBuffer();
            const upRes = await fetch(`${cfg.url}/storage/v1/object/${cfg.bucket}/${cfg.syncKey}/${encodeURIComponent(f.name)}`, {
              method: 'POST',
              headers: getSupabaseHeaders(cfg, { 'Content-Type': 'application/octet-stream', 'x-upsert': 'true' }),
              body: buf
            });
            if (upRes.ok) {
              await fetch(`${cfg.url}/storage/v1/object/${cfg.bucket}/${cfg.syncKey}/_inbox/${encodeURIComponent(f.name)}`, {
                method: 'DELETE',
                headers: getSupabaseHeaders(cfg)
              });
              await pushSharedCatalogMeta(f.name, {
                originalFileName: f.name,
                title: f.name.replace(/\.[^.]+$/, ''),
                format: (f.name.split('.').pop() || 'LIVRO').toUpperCase(),
                size: buf.byteLength || 0
              });
              await recordSharedActivity({ type: 'approve', bookTitle: f.name, fileName: f.name, fileSize: buf.byteLength || 0 });
              showToast(`"${f.name}" aprovado e movido para sua Estante!`);
              await refreshGuestInboxPanel();
              await listCloudBooks();
            }
          });
          row.querySelector('.btn-reject-inbox').addEventListener('click', async () => {
            await fetch(`${cfg.url}/storage/v1/object/${cfg.bucket}/${cfg.syncKey}/_inbox/${encodeURIComponent(f.name)}`, {
              method: 'DELETE',
              headers: getSupabaseHeaders(cfg)
            });
            showToast(`Sugestão "${f.name}" recusada e removida.`);
            refreshGuestInboxPanel();
          });
          listEl.appendChild(row);
        });
      } catch {}
    }

    document.getElementById('btnRefreshInbox').addEventListener('click', refreshGuestInboxPanel);
    document.getElementById('btnLeaveInviteMode').addEventListener('click', () => {
      sessionStorage.removeItem('reader_active_invite');
      localStorage.removeItem('reader_active_invite_persist');
      location.reload();
    });
    const btnGuestSignInEl = document.getElementById('btnGuestSignIn');
    if (btnGuestSignInEl) {
      btnGuestSignInEl.addEventListener('click', () => {
        openCloudModalFn();
        const em = document.getElementById('inputAuthEmail');
        if (em) setTimeout(() => em.focus(), 120);
      });
    }
    document.getElementById('btnGuestSuggestBook').addEventListener('click', () => {
      document.getElementById('inputGuestUploadFile').click();
    });
    document.getElementById('inputGuestUploadFile').addEventListener('change', async (e) => {
      const f = e.target.files && e.target.files[0];
      e.target.value = '';
      const inv = getActiveInviteState();
      if (!f || !inv) return;
      const SUPABASE_FREE_FILE_LIMIT = 50 * 1024 * 1024;
      if (f.size > SUPABASE_FREE_FILE_LIMIT) {
        const mb = (f.size / 1048576).toFixed(1);
        alert(`O arquivo "${f.name}" tem ${mb} MB e excede o limite de 50 MB do plano grátis do Supabase Storage.`);
        return;
      }
      const safeName = safeCloudFileName(f.name);
      let isDirectMember = inv.role === 'member';
      showToast(isDirectMember ? `Enviando "${f.name}" para o banco compartilhado...` : `Enviando "${f.name}" para fila de aprovação do dono...`);
      try {
        const rawCfg = getCloudConfig();
        const cfg = await ensureFreshSupabaseToken({ ...rawCfg, url: healLegacySupabaseUrl(inv.url || rawCfg.url), apiKey: inv.apiKey || rawCfg.apiKey });
        const invUrl = healLegacySupabaseUrl(inv.url || cfg.url);
        const headers = getSupabaseHeaders({ apiKey: inv.apiKey || cfg.apiKey, accessToken: cfg.accessToken }, { 'Content-Type': 'application/octet-stream', 'x-upsert': 'true' });
        const tryGuestUpload = async (subPath, bufData) => fetch(`${invUrl}/storage/v1/object/${inv.bucket}/${inv.syncKey}/${subPath}`, {
          method: 'POST',
          headers,
          body: bufData
        });

        const buf = await f.arrayBuffer();
        let targetSub = isDirectMember ? safeName : `_inbox/${safeName}`;
        let res = await tryGuestUpload(targetSub, buf);

        if (!res.ok) {
          const detail = await readSupabaseErrorText(res);
          const isRlsDenied = /row-level security|unauthorized|permission/i.test(detail) || res.status === 401 || res.status === 403;
          if (isDirectMember && isRlsDenied) {
            const acctHint = cfg.userEmail ? `A conta "${cfg.userEmail}" ainda não está na lista de membros com escrita direta no Supabase.` : 'Você ainda não está autenticado como membro autorizado no banco.';
            if (confirm(`${acctHint}\n\nDeseja enviar "${f.name}" para a fila de aprovação (_inbox) do dono da estante?`)) {
              isDirectMember = false;
              res = await tryGuestUpload(`_inbox/${safeName}`, buf);
              if (!res.ok) {
                const detailInbox = await readSupabaseErrorText(res);
                if (!cfg.userEmail && /row-level security|unauthorized/i.test(detailInbox)) {
                  throw new Error('Entre com sua conta primeiro ("Entrar / Criar Minha Conta") para poder enviar livros para aprovação.');
                }
                throw new Error(`${detailInbox} (HTTP ${res.status})`);
              }
            } else {
              return;
            }
          } else if (isRlsDenied && !cfg.userEmail) {
            throw new Error('Este banco exige login para enviar sugestões. Clique em "Entrar / Criar Minha Conta" e tente novamente.');
          } else if (res.status === 413) {
            throw new Error('Arquivo excede o limite de 50 MB por arquivo do Supabase.');
          } else {
            throw new Error(`${detail} (HTTP ${res.status})`);
          }
        }
        await recordSharedActivity({
          type: isDirectMember ? 'upload' : 'suggest',
          bookTitle: f.name,
          fileName: f.name,
          fileSize: buf.byteLength || 0
        });
        if (isDirectMember) {
          const memberMeta = {
            originalFileName: f.name,
            title: f.name.replace(/\.[^.]+$/, ''),
            author: getUserProfile().displayName || 'Membro',
            format: (f.name.split('.').pop() || 'LIVRO').toUpperCase(),
            size: buf.byteLength || 0
          };
          saveCloudCatalogEntry(safeName, memberMeta);
          await pushSharedCatalogMeta(safeName, memberMeta);
          await listCloudBooks();
        }
        // Notifica o dono no e-mail configurado no servidor (OWNER_NOTIFY_EMAIL) ou via convite quando houver sugestão
        if (!isDirectMember || inv.notifyEmail) {
          const kCfg = getKindleConfig();
          fetch('/api/send-kindle', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              notifyOwnerSuggestion: true,
              provider: (kCfg && kCfg.provider) || undefined,
              apiKey: (kCfg && kCfg.apiKey) || '',
              fromEmail: (kCfg && kCfg.senderEmail) || '',
              kindleEmail: inv.notifyEmail || '',
              senderEmail: (getCloudConfig().userEmail) || 'convidado',
              syncKey: inv.syncKey || 'minha-estante',
              bookTitle: f.name
            })
          }).catch(() => {});
        }
        showToast(isDirectMember ? `"${f.name}" publicado na Estante Compartilhada!` : `"${f.name}" enviado para aprovação! Aparecerá na Estante quando o dono aprovar.`);
      } catch (err) {
        alert('Não foi possível enviar o livro: ' + err.message);
      }
    });

    document.getElementById('btnGenerateInviteLink').addEventListener('click', () => {
      const activeInv = getActiveInviteState();
      if (activeInv && activeInv.role !== 'owner' && activeInv.role !== 'member') {
        alert('Apenas o Dono ou Membros completos da estante podem gerar novos links de convite.');
        return;
      }
      document.getElementById('btnSaveCloudConfig').click();
      const cfg = getCloudConfig();
      const role = document.getElementById('selectInviteRole').value || 'viewer';
      const notifyEmail = document.getElementById('inputInviteNotifyEmail').value.trim();
      const inviteObj = {
        url: cfg.url,
        apiKey: cfg.apiKey,
        bucket: cfg.bucket,
        syncKey: cfg.syncKey,
        role,
        notifyEmail
      };
      const encoded = btoa(unescape(encodeURIComponent(JSON.stringify(inviteObj))));
      const link = `${location.origin}${location.pathname}#invite=${encodeURIComponent(encoded)}`;
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(link).then(() => {
          document.getElementById('cloudStatusMsg').textContent = `Link de convite (${role === 'contributor' ? 'Colaborador c/ Aprovação' : 'Somente Leitura'}) copiado!`;
          showToast('Link de convite copiado!');
        }).catch(() => prompt('Copie o link de convite:', link));
      } else {
        prompt('Copie o link de convite:', link);
      }
    });

    async function handleOAuthRedirectCallbackIfPresent() {
      const hasOAuthParams = (location.hash && location.hash.includes('access_token='))
        || (location.search && location.search.includes('code=') && location.search.includes('state=oauth_'))
        || ((location.hash + location.search).includes('error=') && (location.hash + location.search).includes('state=oauth_'));
      if (!hasOAuthParams) return false;
      const parsed = parseOAuthFragmentOrQuery(location.hash, location.search);
      if (window.opener && window.opener !== window) {
        try {
          window.opener.postMessage({ type: 'reader-oauth-callback', parsed }, window.location.origin);
        } catch {}
        try { window.close(); } catch {}
        document.body.innerHTML = '<div style="font-family:sans-serif;padding:28px;text-align:center;"><h3>Conta conectada!</h3><p>Pode fechar esta janela e voltar ao leitor.</p></div>';
        return true;
      }
      // Fallback caso o navegador móvel tenha redirecionado na mesma aba
      try {
        const pending = JSON.parse(localStorage.getItem('reader_oauth_pending') || 'null');
        if (pending && (!parsed.state || parsed.state === pending.state)) {
          await completeOAuthTokenResult(pending.provider, pending.profileId, parsed, pending.codeVerifier, pending.redirectUri);
          localStorage.removeItem('reader_oauth_pending');
          showToast(`${getCloudProviderLabel(pending.provider)} conectado com sucesso!`);
        }
      } catch (err) {
        alert('Erro ao concluir login OAuth: ' + err.message);
      }
      history.replaceState(null, '', location.pathname);
      return false;
    }

    async function initCloudAutoConnect() {
      if (await handleOAuthRedirectCallbackIfPresent()) return;
      // 0. Verificar se abriu via Link de Convite (#invite=...)
      try {
        if (location.hash && location.hash.startsWith('#invite=')) {
          const rawB64 = decodeURIComponent(location.hash.slice(8));
          const inv = JSON.parse(decodeURIComponent(escape(atob(rawB64))));
          if (inv && inv.url && inv.syncKey) {
            sessionStorage.setItem('reader_active_invite', JSON.stringify(inv));
            localStorage.setItem('reader_active_invite_persist', JSON.stringify(inv));
            history.replaceState(null, '', location.pathname + location.search);
          }
        }
      } catch {}

      const activeInvite = getActiveInviteState();
      syncInviteBannerUi();
      if (activeInvite) {
        try {
          const invHeaders = { apikey: activeInvite.apiKey, 'Content-Type': 'application/json' };
          if (/^eyJ/.test(activeInvite.apiKey)) invHeaders.Authorization = `Bearer ${activeInvite.apiKey}`;
          const res = await fetch(`${activeInvite.url}/storage/v1/object/list/${activeInvite.bucket}`, {
            method: 'POST',
            headers: invHeaders,
            body: JSON.stringify({ prefix: `${activeInvite.syncKey}/`, limit: 100, offset: 0 })
          });
          if (res.ok) {
            const rawFilesInv = await res.json() || [];
            updateCloudQuotaUi(rawFilesInv);
            cachedCloudFilesList = rawFilesInv.filter(f => f.name && !f.name.startsWith('_reader_sync') && !f.name.startsWith('_shared_') && f.name !== '_inbox' && f.name !== '_users');
            localStorage.setItem('reader_cloud_config', JSON.stringify({ ...getCloudConfig(), url: activeInvite.url, apiKey: activeInvite.apiKey, bucket: activeInvite.bucket, syncKey: activeInvite.syncKey, perUserProgress: true }));
            await pullSharedCatalogFromCloud();
            await syncCloudStateSilentPull();
            await pullSharedActivityFromCloud();
            renderBookshelf();
          }
        } catch {}
        return;
      }

      // 1. Ler configuração embutida na URL (#cloud=...) caso o usuário tenha aberto pelo link direto no celular
      try {
        if (location.hash && location.hash.startsWith('#cloud=')) {
          const rawB64 = decodeURIComponent(location.hash.slice(7));
          const parsed = JSON.parse(decodeURIComponent(escape(atob(rawB64))));
          if (parsed && parsed.syncKey) {
            const cur = getCloudConfig();
            localStorage.setItem('reader_cloud_config', JSON.stringify({ ...cur, ...parsed }));
            history.replaceState(null, '', location.pathname + location.search);
            showToast(`Estante "${parsed.syncKey}" conectada automaticamente!`);
          }
        }
      } catch {}

      // 2. Verificar se o servidor Vercel/Netlify expõe Env Vars (/api/cloud-config)
      try {
        const res = await fetch('/api/cloud-config').catch(() => null);
        if (res && res.ok) {
          const srvCfg = await res.json().catch(() => null);
          if (srvCfg) {
            window.__serverOAuthDefaults = {
              gdriveClientId: srvCfg.gdriveClientId || '',
              onedriveClientId: srvCfg.onedriveClientId || ''
            };
          }
          if (srvCfg && srvCfg.url && srvCfg.apiKey) {
            const stored = JSON.parse(localStorage.getItem('reader_cloud_config') || '{}');
            if (!stored.url && !isOAuthCloudProvider(stored.provider)) {
              localStorage.setItem('reader_cloud_config', JSON.stringify({ ...getCloudConfig(), ...srvCfg }));
            }
          }
        }
      } catch {}

      // 3. Puxar estado e listar livros da Estante na Nuvem automaticamente ao abrir o site!
      const cfg = getCloudConfig();
      const allProfs = getCloudProfilesList();
      if (isCloudProfileAuthenticated(cfg) || allProfs.some(p => isCloudProfileAuthenticated(p))) {
        updateAuthBadgeUi();
        await syncCloudStateSilentPull();
        await listCloudBooks().catch(() => {});
        pullSharedActivityFromCloud();
        refreshGuestInboxPanel();
      }
    }

    const btnUseDefaultSharedKeyEl = document.getElementById('btnUseDefaultSharedKey');
    if (btnUseDefaultSharedKeyEl) {
      btnUseDefaultSharedKeyEl.addEventListener('click', async () => {
        document.getElementById('inputCloudSyncKey').value = 'minha-estante';
        const prev = getCloudConfig();
        localStorage.setItem('reader_cloud_config', JSON.stringify({ ...prev, syncKey: 'minha-estante', customSyncKey: false }));
        document.getElementById('btnSaveCloudConfig').click();
        updateAuthBadgeUi();
        await syncCloudStateSilentPull();
        await listCloudBooks();
        refreshToolbarUserMenu();
        showToast('Conectado à pasta compartilhada padrão (minha-estante)!');
      });
    }

    document.getElementById('btnCopyMobileCloudLink').addEventListener('click', () => {
      document.getElementById('btnSaveCloudConfig').click();
      const cfg = getCloudConfig();
      const mini = {
        provider: cfg.provider,
        url: cfg.url,
        apiKey: cfg.apiKey,
        bucket: cfg.bucket,
        syncKey: cfg.syncKey,
        clientId: cfg.clientId || '',
        perUserProgress: cfg.perUserProgress !== false,
        customSyncKey: Boolean(cfg.customSyncKey)
      };
      const encoded = btoa(unescape(encodeURIComponent(JSON.stringify(mini))));
      const shareUrl = `${location.origin}${location.pathname}#cloud=${encodeURIComponent(encoded)}`;
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(shareUrl).then(() => {
          document.getElementById('cloudStatusMsg').textContent = 'Link direto copiado! Envie para seu WhatsApp/Telegram e abra no celular para conectar em 1 toque.';
          showToast('Link de acesso rápido copiado!');
        }).catch(() => prompt('Copie o link abaixo e abra no celular:', shareUrl));
      } else {
        prompt('Copie o link abaixo e abra no celular:', shareUrl);
      }
    });

    document.getElementById('btnListCloudBooks').addEventListener('click', listCloudBooks);

    // Exportar e Importar Backup Completo (.JSON)
    document.getElementById('btnExportFullBackup').addEventListener('click', () => {
      const payload = buildSyncPayload();
      const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `backup_leitor_${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 2000);
      showToast('Backup completo (.JSON) exportado!');
    });

    document.getElementById('importBackupInput').addEventListener('change', async (e) => {
      const f = e.target.files && e.target.files[0];
      if (!f) return;
      try {
        const txt = await f.text();
        const data = JSON.parse(txt);
        mergeSyncPayload(data);
        showToast('Backup restaurado com sucesso!');
        document.getElementById('cloudStatusMsg').textContent = 'Backup .JSON importado e mesclado com sucesso!';
      } catch (err) {
        alert('Arquivo de backup inválido: ' + err.message);
      }
    });

    /* =====================================================================
     * 14. RECURSOS AVANÇADOS ESTILO KINDLE:
     * - Auto X-Ray (Detector Automático de Personagens + Gráfico por Capítulo)
     * - Word Wise (Dicas Entrelinhas Acima de Palavras)
     * - Page Flip com Pino de Retorno
     * - Luz Âmbar Noturna Ajustável (Warmth Light)
     * - Hábito & Metas de Leitura (Reading Insights)
     * ===================================================================== */

    // 14A. Word Wise e Luz Âmbar Noturna
    document.getElementById('btnWordWiseToggle').addEventListener('click', () => {
      state.wordWise = !state.wordWise;
      applySettings();
      if (state.sections.length) renderSection({ restoreSubPage: state.subPageIndex });
      showToast(state.wordWise ? 'Word Wise ativado (dicas entrelinhas sobre palavras complexas)' : 'Word Wise desativado');
    });

    document.getElementById('inputWarmthLevel').addEventListener('input', (e) => {
      state.warmthLevel = parseInt(e.target.value || '0', 10);
      applySettings();
    });

    // 14B. Page Flip com Pino de Retorno
    const pageFlipReturnPill = document.getElementById('pageFlipReturnPill');
    const pageFlipModal = document.getElementById('pageFlipModal');

    function pinCurrentReadingLocation() {
      if (!state.sections.length) return;
      if (!state.pinnedLocation) {
        const sec = state.sections[state.currentIndex];
        state.pinnedLocation = {
          sectionIndex: state.currentIndex,
          subPageIndex: state.subPageIndex || 0,
          title: sec ? sec.title : `Seção ${state.currentIndex + 1}`
        };
      }
      updatePageFlipPillUi();
    }

    function updatePageFlipPillUi() {
      if (!state.pinnedLocation || !state.sections.length) {
        pageFlipReturnPill.classList.remove('open');
        return;
      }
      if (state.pinnedLocation.sectionIndex === state.currentIndex && state.pinnedLocation.subPageIndex === (state.subPageIndex || 0)) {
        pageFlipReturnPill.classList.remove('open');
        return;
      }
      const p = state.pinnedLocation;
      const subTxt = p.subPageIndex > 0 ? `, Pág. ${p.subPageIndex + 1}` : '';
      document.getElementById('lblPageFlipOrigin').textContent = `Pino na Seção ${p.sectionIndex + 1}${subTxt} (${(p.title || '').slice(0, 26)})`;
      pageFlipReturnPill.classList.add('open');
    }

    document.getElementById('btnReturnPinnedPage').addEventListener('click', async () => {
      if (!state.pinnedLocation) return;
      const target = state.pinnedLocation;
      state.pinnedLocation = null;
      pageFlipReturnPill.classList.remove('open');
      state.currentIndex = target.sectionIndex;
      await renderSection({ restoreSubPage: target.subPageIndex || 0 });
      showToast('De volta à página onde você estava lendo');
    });

    document.getElementById('btnDismissPinnedPage').addEventListener('click', () => {
      state.pinnedLocation = null;
      pageFlipReturnPill.classList.remove('open');
    });

    function openPageFlipModal() {
      if (!state.sections.length) {
        alert('Abra um livro primeiro para usar o Page Flip.');
        return;
      }
      pinCurrentReadingLocation();
      const grid = document.getElementById('pageFlipGrid');
      const scrubber = document.getElementById('inputPageFlipScrubber');
      scrubber.max = String(state.sections.length);
      scrubber.value = String(state.currentIndex + 1);
      grid.innerHTML = '';

      state.sections.forEach((sec, idx) => {
        const card = document.createElement('div');
        card.className = 'pageflip-card' + (idx === state.currentIndex ? ' active' : '');
        card.dataset.secIdx = String(idx);
        const snippet = (sec.text || '').replace(/\s+/g, ' ').trim().slice(0, 160) || '(Página visual / clique para abrir)';
        card.innerHTML = `
          <div>
            <div style="font-size:10.5px; color:var(--accent); font-weight:600; margin-bottom:2px;">Seção ${idx + 1} de ${state.sections.length}</div>
            <div style="font-size:12px; font-weight:600; color:var(--text-primary); white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${escapeHtml(sec.title || ('Página ' + (idx + 1)))}</div>
            <div style="font-size:11px; color:var(--text-secondary); line-height:1.4; margin-top:5px; display:-webkit-box; -webkit-line-clamp:4; -webkit-box-orient:vertical; overflow:hidden;">${escapeHtml(snippet)}</div>
          </div>
          <div style="font-size:10px; color:var(--text-muted); text-align:right;">Espiar página →</div>
        `;
        card.addEventListener('click', async () => {
          pageFlipModal.classList.remove('open');
          state.currentIndex = idx;
          await renderSection();
          updatePageFlipPillUi();
        });
        grid.appendChild(card);
      });

      pageFlipModal.classList.add('open');
      setTimeout(() => {
        const activeCard = grid.querySelector('.pageflip-card.active');
        if (activeCard) activeCard.scrollIntoView({ block: 'center' });
      }, 40);
    }

    document.getElementById('btnPageFlipOpen').addEventListener('click', openPageFlipModal);
    document.getElementById('btnClosePageFlipModal').addEventListener('click', () => pageFlipModal.classList.remove('open'));
    document.getElementById('btnClosePageFlipFooter').addEventListener('click', () => pageFlipModal.classList.remove('open'));
    document.getElementById('inputPageFlipScrubber').addEventListener('input', (e) => {
      const idx = Math.max(0, parseInt(e.target.value || '1', 10) - 1);
      const grid = document.getElementById('pageFlipGrid');
      const card = grid.querySelector(`.pageflip-card[data-sec-idx="${idx}"]`);
      if (card) {
        grid.querySelectorAll('.pageflip-card').forEach(c => c.classList.toggle('active', c === card));
        card.scrollIntoView({ block: 'nearest' });
      }
    });

    // 14C. Auto X-Ray (Detector Automático de Personagens & Termos + Frequência por Capítulo)
    let lastAutoXRayCandidates = [];

    function computeEntityChapterFrequencies(termList) {
      const counts = state.sections.map(() => 0);
      if (!state.sections.length || !termList.length) return { counts, total: 0 };
      const patterns = termList
        .map(t => (t || '').trim())
        .filter(t => t.length >= 2)
        .map(t => new RegExp(`(^|[^a-zA-ZÀ-ÿ0-9_])(${t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})(?=$|[^a-zA-ZÀ-ÿ0-9_])`, 'gi'));
      let total = 0;
      state.sections.forEach((sec, idx) => {
        const txt = sec.text || '';
        if (!txt) return;
        let c = 0;
        for (const rx of patterns) {
          const m = txt.match(rx);
          if (m) c += m.length;
        }
        counts[idx] = c;
        total += c;
      });
      return { counts, total };
    }

    function buildFreqBarsHtml(counts) {
      if (!counts || !counts.length) return '';
      const maxC = Math.max(1, ...counts);
      // Agrupar em até 28 barras caso o livro tenha muitas seções
      const bucketCount = Math.min(28, counts.length);
      const step = counts.length / bucketCount;
      const bars = [];
      for (let b = 0; b < bucketCount; b++) {
        const startIdx = Math.floor(b * step);
        const endIdx = Math.max(startIdx + 1, Math.floor((b + 1) * step));
        let sum = 0;
        for (let i = startIdx; i < endIdx && i < counts.length; i++) sum += counts[i];
        const hPct = sum > 0 ? Math.max(18, Math.round((sum / maxC) * 100)) : 4;
        const opacity = sum > 0 ? '0.85' : '0.18';
        bars.push(`<div class="xray-freq-bar" data-jump-sec="${startIdx}" style="height:${hPct}%; opacity:${opacity};" title="Seção ${startIdx + 1}: ${sum} menção(ões)"></div>`);
      }
      return `<div class="xray-freq-bars">${bars.join('')}</div>`;
    }

    function renderXRayStudioPane() {
      const savedBox = document.getElementById('xraySavedContainer');
      const detectedBox = document.getElementById('xrayDetectedContainer');
      if (!savedBox || !detectedBox) return;

      const savedList = state.bookKey ? (getEntityNotesMap()[state.bookKey] || []) : [];
      savedBox.innerHTML = '';

      if (savedList.length) {
        const hdr = document.createElement('div');
        hdr.style.cssText = 'font-size:12px; font-weight:700; color:var(--text-secondary); text-transform:uppercase;';
        hdr.textContent = `Fichas Salvas Neste Livro (${savedList.length})`;
        savedBox.appendChild(hdr);

        savedList.forEach(ent => {
          const catInfo = categoryMeta[ent.category] || categoryMeta.character;
          const freq = computeEntityChapterFrequencies([ent.name, ...(ent.aliases || [])]);
          const card = document.createElement('div');
          card.className = 'card-item';
          card.innerHTML = `
            <div style="display:flex; justify-content:space-between; align-items:center; gap:8px;">
              <div>
                <span style="font-weight:700; font-size:13.5px; color:var(--text-primary);">${escapeHtml(ent.name)}</span>
                <span class="entity-badge" style="margin-left:6px;">${escapeHtml(catInfo.badge)}</span>
                <span style="font-size:11px; color:var(--text-muted); margin-left:6px;">${freq.total} aparições no livro</span>
              </div>
              <div style="display:flex; gap:6px;">
                <button class="tb-btn tb-btn-solid btn-xr-search" style="height:24px; font-size:11px;">Ver Aparições</button>
                <button class="tb-btn tb-btn-solid btn-xr-edit" style="height:24px; font-size:11px;">Editar</button>
              </div>
            </div>
            <div style="font-size:12px; color:var(--text-secondary); margin-top:4px;">${escapeHtml(ent.note || '(Sem descrição)')}</div>
            ${buildFreqBarsHtml(freq.counts)}
          `;
          card.querySelector('.btn-xr-edit').addEventListener('click', () => {
            openEntityNoteModal('', ent.id);
          });
          card.querySelector('.btn-xr-search').addEventListener('click', () => {
            document.getElementById('toolsModal').classList.remove('open');
            openSidebarTab('paneSearch');
            document.getElementById('selectSearchScope').value = 'book';
            dom.inputSearch.value = ent.name;
            runBookSearch();
          });
          card.querySelectorAll('.xray-freq-bar').forEach(bar => {
            bar.addEventListener('click', () => {
              const secIdx = parseInt(bar.dataset.jumpSec || '0', 10);
              document.getElementById('toolsModal').classList.remove('open');
              pinCurrentReadingLocation();
              state.currentIndex = secIdx;
              renderSection({ highlight: ent.name });
            });
          });
          savedBox.appendChild(card);
        });
      }
    }

    async function runAutoXRayScan() {
      if (!state.sections.length || !state.bookKey) {
        alert('Abra um livro primeiro para rodar o detector automático de personagens (Auto X-Ray).');
        return;
      }
      const detectedBox = document.getElementById('xrayDetectedContainer');
      detectedBox.innerHTML = '<div style="padding:12px; color:var(--text-secondary);">Analisando capítulos e identificando nomes próprios recorrentes...</div>';

      // Garantir texto das primeiras 30 páginas caso seja PDF
      if (state.format === 'PDF') {
        for (const sec of state.sections.slice(0, 30)) {
          if (sec.text === null) await ensurePdfSectionText(sec);
        }
      }

      const stopCap = new Set([
        'Capítulo', 'Chapter', 'Parte', 'Part', 'Seção', 'Section', 'Livro', 'Book', 'Prólogo', 'Epílogo',
        'Mas', 'Para', 'Como', 'Quando', 'Onde', 'Porque', 'Por', 'Uma', 'Um', 'Os', 'As', 'Dos', 'Das',
        'Ele', 'Ela', 'Eles', 'Elas', 'Você', 'Vocês', 'Nós', 'Meu', 'Minha', 'Meus', 'Minhas', 'Seu', 'Sua',
        'Isso', 'Isto', 'Aquilo', 'Este', 'Esta', 'Esse', 'Essa', 'Aquele', 'Aquela', 'Tudo', 'Nada', 'Todos',
        'Toda', 'Todas', 'Algo', 'Alguém', 'Ninguém', 'Cada', 'Outro', 'Outra', 'Outros', 'Outras', 'Mesmo',
        'Mesma', 'Muito', 'Muita', 'Muitos', 'Muitas', 'Pouco', 'Pouca', 'Mais', 'Menos', ' Já', 'Ainda',
        'Então', 'Depois', 'Antes', 'Agora', 'Aqui', 'Ali', 'Lá', 'Sim', 'Não', 'Talvez', 'Sempre', 'Nunca',
        'Embora', 'Enquanto', 'Contudo', 'Todavia', 'Portanto', 'Assim', 'Sobre', 'Entre', 'Contra', 'Desde',
        'Durante', 'Até', 'Sem', 'Com', 'Sob', 'Após', 'Pelo', 'Pela', 'Pelos', 'Pelas', 'Num', 'Numa',
        'Naquele', 'Naquela', 'Neste', 'Nesta', 'Nesse', 'Nessa', 'Daquela', 'Daquele', 'Deste', 'Desta',
        'Havia', 'Tinha', 'Era', 'Foi', 'Foram', 'Está', 'Estava', 'Estavam', 'Ser', 'Ter', 'Fazer', 'Disse',
        'The', 'And', 'But', 'For', 'Nor', 'Yet', 'With', 'From', 'Into', 'Unto', 'Upon', 'Over', 'Under',
        'When', 'Where', 'While', 'What', 'Which', 'Who', 'Whom', 'Whose', 'Why', 'How', 'This', 'That',
        'These', 'Those', 'There', 'Here', 'They', 'Them', 'Their', 'His', 'Her', 'Hers', 'Its', 'Our',
        'Your', 'Some', 'Many', 'Much', 'Most', 'Other', 'Another', 'Such', 'Even', 'Still', 'Just', 'Only',
        'Then', 'Than', 'After', 'Before', 'Since', 'Until', 'Because', 'Although', 'Though', 'Every', 'Each'
      ]);

      const candidateMap = new Map();
      const rxProper = /\b([A-ZÀ-Ý][a-zà-ÿ]{2,20}(?:\s+(?:de|da|do|dos|das|van|von|del)?\s*[A-ZÀ-Ý][a-zà-ÿ]{2,20}){0,2})\b/g;

      state.sections.forEach((sec, secIdx) => {
        const txt = sec.text || '';
        if (!txt) return;
        let match;
        while ((match = rxProper.exec(txt)) !== null) {
          const rawName = match[1].replace(/\s+/g, ' ').trim();
          const firstWord = rawName.split(' ')[0];
          if (stopCap.has(rawName) || stopCap.has(firstWord)) continue;
          if (rawName.length < 3) continue;

          // Verificar se aparece fora do início de frase (precedido por espaço comum e não pontuação final)
          const charBefore = match.index > 1 ? txt.slice(Math.max(0, match.index - 2), match.index) : '. ';
          const midSentence = !/[.!?\n\r"“«]\s*$/.test(charBefore);

          let entry = candidateMap.get(rawName);
          if (!entry) {
            entry = {
              name: rawName,
              count: 0,
              midSentenceCount: 0,
              firstSectionIndex: secIdx,
              firstSnippet: '',
              countsBySec: new Array(state.sections.length).fill(0)
            };
            candidateMap.set(rawName, entry);
          }
          entry.count++;
          if (midSentence) entry.midSentenceCount++;
          entry.countsBySec[secIdx]++;
          if (!entry.firstSnippet) {
            const st = Math.max(0, match.index - 45);
            entry.firstSnippet = txt.slice(st, match.index + rawName.length + 75).replace(/\s+/g, ' ').trim();
          }
        }
      });

      const savedNames = new Set(
        (getEntityNotesMap()[state.bookKey] || []).flatMap(e => [e.name.toLowerCase(), ...(e.aliases || []).map(a => a.toLowerCase())])
      );

      lastAutoXRayCandidates = Array.from(candidateMap.values())
        .filter(c => c.count >= 3 && (c.midSentenceCount >= 2 || c.name.includes(' ')) && !savedNames.has(c.name.toLowerCase()))
        .sort((a, b) => b.count - a.count)
        .slice(0, 24);

      renderXRayStudioPane();

      if (!lastAutoXRayCandidates.length) {
        detectedBox.innerHTML = '<div style="padding:12px; color:var(--text-muted); background:var(--bg-toolbar); border:1px solid var(--border-color); border-radius:6px;">Nenhum novo personagem recorrente não cadastrado foi encontrado neste livro.</div>';
        return;
      }

      detectedBox.innerHTML = `<div style="font-size:12px; font-weight:700; color:var(--text-secondary); text-transform:uppercase;">Personagens & Nomes Detectados no Livro (${lastAutoXRayCandidates.length})</div>`;
      lastAutoXRayCandidates.forEach(cand => {
        const firstSecTitle = state.sections[cand.firstSectionIndex] ? state.sections[cand.firstSectionIndex].title : `Seção ${cand.firstSectionIndex + 1}`;
        const card = document.createElement('div');
        card.className = 'card-item';
        card.innerHTML = `
          <div style="display:flex; justify-content:space-between; align-items:center; gap:8px; flex-wrap:wrap;">
            <div>
              <span style="font-weight:700; font-size:13.5px; color:var(--text-primary);">${escapeHtml(cand.name)}</span>
              <span style="font-size:11px; color:var(--accent); font-weight:600; margin-left:8px;">${cand.count} menções</span>
              <span style="font-size:11px; color:var(--text-muted); margin-left:6px;">1ª aparição: ${escapeHtml(firstSecTitle)}</span>
            </div>
            <div style="display:flex; gap:6px;">
              <button class="tb-btn tb-btn-solid btn-cand-search" style="height:24px; font-size:11px;">Ver Trechos</button>
              <button class="studio-btn-primary btn-cand-save" style="height:24px; font-size:11px; padding:0 10px;">+ Salvar Ficha X-Ray</button>
            </div>
          </div>
          <div style="font-size:11.5px; color:var(--text-secondary); margin-top:4px; font-style:italic;">"…${escapeHtml(cand.firstSnippet)}…"</div>
          ${buildFreqBarsHtml(cand.countsBySec)}
        `;

        card.querySelector('.btn-cand-search').addEventListener('click', () => {
          document.getElementById('toolsModal').classList.remove('open');
          openSidebarTab('paneSearch');
          document.getElementById('selectSearchScope').value = 'book';
          dom.inputSearch.value = cand.name;
          runBookSearch();
        });

        card.querySelector('.btn-cand-save').addEventListener('click', async () => {
          const map = getEntityNotesMap();
          const list = map[state.bookKey] || [];
          list.push({
            id: 'en_xr_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
            name: cand.name,
            aliases: [],
            category: 'character',
            note: `Primeira aparição em ${firstSecTitle} (${cand.count} menções no livro). Contexto inicial: "${cand.firstSnippet}"`,
            firstSectionIndex: cand.firstSectionIndex,
            firstChapterTitle: firstSecTitle,
            updatedAt: new Date().toLocaleDateString('pt-BR')
          });
          map[state.bookKey] = list;
          localStorage.setItem('reader_entity_notes', JSON.stringify(map));
          await renderSection({ restoreSubPage: state.subPageIndex });
          runAutoXRayScan();
          showToast(`Ficha X-Ray de "${cand.name}" ativada em todo o livro!`);
        });

        card.querySelectorAll('.xray-freq-bar').forEach(bar => {
          bar.addEventListener('click', () => {
            const secIdx = parseInt(bar.dataset.jumpSec || '0', 10);
            document.getElementById('toolsModal').classList.remove('open');
            pinCurrentReadingLocation();
            state.currentIndex = secIdx;
            renderSection({ highlight: cand.name });
          });
        });

        detectedBox.appendChild(card);
      });
    }

    document.getElementById('btnRunAutoXray').addEventListener('click', runAutoXRayScan);
    document.getElementById('btnAddManualXray').addEventListener('click', () => {
      document.getElementById('toolsModal').classList.remove('open');
      openEntityNoteModal('');
    });
    const btnAutoXraySidebarEl = document.getElementById('btnAutoXraySidebar');
    if (btnAutoXraySidebarEl) {
      btnAutoXraySidebarEl.addEventListener('click', () => {
        openToolsModalFn('paneStudioXray');
        runAutoXRayScan();
      });
    }

    // 14D. Hábito & Metas de Leitura (Kindle Reading Insights)
    function getTodayIsoDate() {
      const d = new Date();
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    }

    function getReadingInsights() {
      try {
        const raw = JSON.parse(localStorage.getItem('reader_insights') || '{}');
        return {
          dailyGoal: raw.dailyGoal || 20,
          minutesByDate: raw.minutesByDate || {},
          finishedBooks: Array.isArray(raw.finishedBooks) ? raw.finishedBooks : []
        };
      } catch {
        return { dailyGoal: 20, minutesByDate: {}, finishedBooks: [] };
      }
    }

    function saveReadingInsights(data) {
      localStorage.setItem('reader_insights', JSON.stringify(data));
    }

    function computeCurrentStreakDays(minutesByDate) {
      let streak = 0;
      const d = new Date();
      for (let i = 0; i < 365; i++) {
        const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
        if ((minutesByDate[iso] || 0) >= 1) {
          streak++;
        } else if (i > 0) {
          break;
        }
        d.setDate(d.getDate() - 1);
      }
      return streak;
    }

    // Contabilizar automaticamente 1 minuto de leitura a cada 60s com livro aberto
    setInterval(() => {
      if (!state.sections.length || document.hidden || !dom.emptyState.classList.contains('hidden')) return;
      const data = getReadingInsights();
      const today = getTodayIsoDate();
      data.minutesByDate[today] = (data.minutesByDate[today] || 0) + 1;
      saveReadingInsights(data);
    }, 60000);

    function renderReadingInsightsPane() {
      const data = getReadingInsights();
      const today = getTodayIsoDate();
      const todayMin = data.minutesByDate[today] || 0;
      const goal = Math.max(5, data.dailyGoal || 20);
      const streak = computeCurrentStreakDays(data.minutesByDate);
      const totalMin = Object.values(data.minutesByDate).reduce((a, b) => a + b, 0);

      document.getElementById('inputDailyGoalMin').value = String(goal);
      document.getElementById('lblInsightsGoalStatus').textContent = `${todayMin} / ${goal} min (${Math.min(100, Math.round((todayMin / goal) * 100))}%)`;
      document.getElementById('insightsGoalFill').style.width = `${Math.min(100, Math.round((todayMin / goal) * 100))}%`;

      const revAll = Object.values(getBookReviewsMap());
      const ratedCount = revAll.filter(r => (r.rating || 0) > 0).length;
      const finishedFromReviews = revAll.filter(r => r.status === 'finished').length;
      const booksFinishedTotal = Math.max((data.finishedBooks || []).length, finishedFromReviews);
      const readingDaysCount = Object.values(data.minutesByDate || {}).filter(m => m > 0).length;

      const grid = document.getElementById('insightsCardsGrid');
      grid.innerHTML = `
        <div style="padding:12px; background:var(--bg-toolbar); border:1px solid var(--border-color); border-radius:6px;">
          <div style="font-size:10.5px; color:var(--text-muted); text-transform:uppercase;">Livros Lidos</div>
          <div style="font-size:20px; font-weight:700; color:var(--accent); margin-top:2px;">${booksFinishedTotal} livro(s)</div>
          <div style="font-size:10.5px; color:var(--text-muted); margin-top:2px;">Marcados como lidos</div>
        </div>
        <div style="padding:12px; background:var(--bg-toolbar); border:1px solid var(--border-color); border-radius:6px;">
          <div style="font-size:10.5px; color:var(--text-muted); text-transform:uppercase;">Dias de Leitura</div>
          <div style="font-size:20px; font-weight:700; color:var(--text-primary); margin-top:2px;">${readingDaysCount} dia(s)</div>
          <div style="font-size:10.5px; color:var(--text-muted); margin-top:2px;">Ofensiva atual: ${streak} dia(s)</div>
        </div>
        <div style="padding:12px; background:var(--bg-toolbar); border:1px solid var(--border-color); border-radius:6px;">
          <div style="font-size:10.5px; color:var(--text-muted); text-transform:uppercase;">Tempo &amp; Ritmo</div>
          <div style="font-size:20px; font-weight:700; color:var(--text-primary); margin-top:2px;">${totalMin} min</div>
          <div style="font-size:10.5px; color:var(--text-muted); margin-top:2px;">Hoje: ${todayMin}m · ${state.readingWpm || 215} PPM</div>
        </div>
        <div style="padding:12px; background:var(--bg-toolbar); border:1px solid var(--border-color); border-radius:6px;">
          <div style="font-size:10.5px; color:var(--text-muted); text-transform:uppercase;">Avaliações</div>
          <div style="font-size:20px; font-weight:700; color:var(--text-primary); margin-top:2px;">${ratedCount} nota(s)</div>
          <div style="font-size:10.5px; color:var(--text-muted); margin-top:2px;">Estrelas &amp; resenhas</div>
        </div>
      `;

      // Gráfico dos últimos 7 dias
      const weekChart = document.getElementById('insightsWeekChart');
      weekChart.innerHTML = '';
      const daysPt = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
      const last7 = [];
      for (let i = 6; i >= 0; i--) {
        const d = new Date();
        d.setDate(d.getDate() - i);
        const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
        last7.push({ label: daysPt[d.getDay()], min: data.minutesByDate[iso] || 0 });
      }
      const maxDay = Math.max(goal, ...last7.map(x => x.min), 10);
      last7.forEach(item => {
        const hPct = Math.max(6, Math.round((item.min / maxDay) * 100));
        const col = document.createElement('div');
        col.style.cssText = 'display:flex; flex-direction:column; align-items:center; justify-content:flex-end; height:100%; gap:4px;';
        col.innerHTML = `
          <div style="font-size:10px; color:var(--text-muted);">${item.min}m</div>
          <div style="width:100%; max-width:34px; height:${hPct}%; background:${item.min >= goal ? 'var(--accent)' : 'var(--border-strong)'}; border-radius:3px 3px 0 0;"></div>
          <div style="font-size:11px; color:var(--text-secondary); font-weight:600;">${item.label}</div>
        `;
        weekChart.appendChild(col);
      });

      // Heatmap Anual Estilo GitHub (53 semanas x 7 dias)
      renderGitHubStyleReadingHeatmap(data.minutesByDate || {}, goal);

      const finBox = document.getElementById('insightsFinishedList');
      const revMap = getBookReviewsMap();
      if (!data.finishedBooks.length) {
        finBox.innerHTML = 'Nenhum livro marcado como concluído ainda.';
      } else {
        finBox.innerHTML = data.finishedBooks.map(b => {
          const matchingRev = Object.values(revMap).find(r => r.title === b.title);
          const stars = matchingRev && matchingRev.rating ? `<span style="color:#eab308; margin-left:6px;">${'★'.repeat(matchingRev.rating)}</span>` : '';
          return `
          <div style="display:flex; justify-content:space-between; padding:6px 0; border-bottom:1px solid var(--border-color); color:var(--text-primary);">
            <span><strong>${escapeHtml(b.title)}</strong> — ${escapeHtml(b.author || '')}${stars}</span>
            <span style="color:var(--text-muted); font-size:11px;">Concluído em ${escapeHtml(b.date)}</span>
          </div>`;
        }).join('');
      }
    }

    function renderGitHubStyleReadingHeatmap(minutesByDate, goal) {
      const gridEl = document.getElementById('ghHeatmapGrid');
      const monthsEl = document.getElementById('ghHeatmapMonths');
      const headlineEl = document.getElementById('lblHeatmapHeadline');
      const hoverEl = document.getElementById('lblHeatmapHoverInfo');
      if (!gridEl || !monthsEl) return;

      gridEl.innerHTML = '';
      monthsEl.innerHTML = '';

      const today = new Date();
      today.setHours(0, 0, 0, 0);
      // Alinhar início para o domingo de 52 semanas atrás (total 53 colunas x 7 dias)
      const endSundayOffset = today.getDay();
      const totalDays = 52 * 7 + endSundayOffset + 1;
      const startDate = new Date(today);
      startDate.setDate(today.getDate() - (totalDays - 1));

      const monthsPt = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];
      let totalYearMin = 0;
      let activeDays = 0;
      let lastShownMonth = -1;

      const totalCols = Math.ceil(totalDays / 7);
      for (let col = 0; col < totalCols; col++) {
        const colFirstDate = new Date(startDate);
        colFirstDate.setDate(startDate.getDate() + col * 7);
        const mLabel = document.createElement('span');
        const m = colFirstDate.getMonth();
        if (m !== lastShownMonth && colFirstDate <= today) {
          mLabel.textContent = monthsPt[m];
          lastShownMonth = m;
        }
        monthsEl.appendChild(mLabel);
      }

      for (let i = 0; i < totalCols * 7; i++) {
        const cur = new Date(startDate);
        cur.setDate(startDate.getDate() + i);
        const cell = document.createElement('div');
        cell.className = 'gh-heatmap-cell';

        if (cur > today) {
          cell.style.visibility = 'hidden';
          gridEl.appendChild(cell);
          continue;
        }

        const iso = `${cur.getFullYear()}-${String(cur.getMonth() + 1).padStart(2, '0')}-${String(cur.getDate()).padStart(2, '0')}`;
        const min = minutesByDate[iso] || 0;
        if (min > 0) {
          totalYearMin += min;
          activeDays++;
        }

        let level = 0;
        if (min > 0) {
          const ratio = min / Math.max(5, goal);
          if (ratio >= 1.8) level = 4;
          else if (ratio >= 1.0) level = 3;
          else if (ratio >= 0.45) level = 2;
          else level = 1;
        }
        cell.dataset.level = String(level);
        const dateBr = `${String(cur.getDate()).padStart(2, '0')}/${String(cur.getMonth() + 1).padStart(2, '0')}/${cur.getFullYear()}`;
        const desc = min > 0
          ? `${dateBr}: ${min} min de leitura${min >= goal ? ' (Meta diária atingida)' : ''}`
          : `${dateBr}: Nenhum registro de leitura`;
        cell.title = desc;
        cell.addEventListener('mouseenter', () => { if (hoverEl) hoverEl.textContent = desc; });
        cell.addEventListener('click', () => { if (hoverEl) hoverEl.textContent = desc; });
        gridEl.appendChild(cell);
      }

      if (headlineEl) {
        headlineEl.textContent = `${totalYearMin} minuto(s) em ${activeDays} dia(s) de leitura no último ano`;
      }
    }

    /* =====================================================================
     * 14B. NOTAS POR ESTRELAS & RESENHAS + CONTA KINDLE (@kindle.com)
     * ===================================================================== */
    function getBookReviewsMap() {
      try { return JSON.parse(localStorage.getItem('reader_book_reviews') || '{}'); }
      catch { return {}; }
    }

    function saveBookReviewsMap(map) {
      localStorage.setItem('reader_book_reviews', JSON.stringify(map));
      if (typeof pushCloudSyncSilent === 'function') pushCloudSyncSilent();
    }

    let currentDraftStarRating = 0;
    function renderStarSelectorUi(val) {
      currentDraftStarRating = val;
      const lbl = document.getElementById('lblStarRatingValue');
      if (lbl) lbl.textContent = String(val);
      const row = document.getElementById('reviewStarRow');
      if (!row) return;
      row.innerHTML = '';
      for (let s = 1; s <= 5; s++) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'star-btn' + (s <= val ? ' filled' : '');
        btn.title = `${s} estrela(s)`;
        btn.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="1.5"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>';
        btn.addEventListener('click', () => renderStarSelectorUi(s));
        row.appendChild(btn);
      }
    }

    async function renderReviewsStudioPane() {
      const sel = document.getElementById('selectReviewBook');
      if (!sel) return;
      const revMap = getBookReviewsMap();
      const shelfBooks = await idbGetAllBooks().catch(() => []);

      const optionsMap = new Map();
      if (state.bookKey && state.title) {
        optionsMap.set(state.bookKey, { key: state.bookKey, title: state.title, author: state.author || '' });
      }
      shelfBooks.forEach(b => {
        if (!optionsMap.has(b.bookKey)) optionsMap.set(b.bookKey, { key: b.bookKey, title: b.title, author: b.author || '' });
      });
      Object.entries(revMap).forEach(([k, r]) => {
        if (!optionsMap.has(k)) optionsMap.set(k, { key: k, title: r.title || k, author: r.author || '' });
      });

      const prevSelected = sel.value || state.bookKey || '';
      sel.innerHTML = '';
      if (!optionsMap.size) {
        sel.innerHTML = '<option value="">Abra ou adicione um livro primeiro</option>';
      } else {
        for (const item of optionsMap.values()) {
          const opt = document.createElement('option');
          opt.value = item.key;
          opt.textContent = `${item.title}${item.author ? ' — ' + item.author : ''}`;
          sel.appendChild(opt);
        }
        if (prevSelected && optionsMap.has(prevSelected)) sel.value = prevSelected;
      }

      const loadSelectedIntoForm = () => {
        const key = sel.value;
        const r = revMap[key];
        renderStarSelectorUi(r ? (r.rating || 0) : 0);
        document.getElementById('selectReviewStatus').value = (r && r.status) || 'reading';
        document.getElementById('inputReviewText').value = (r && r.reviewText) || '';
        document.getElementById('lblReviewSavedInfo').textContent = r && r.date
          ? `Última edição em ${r.date}`
          : 'Ainda sem avaliação salva para este livro.';
      };
      sel.onchange = loadSelectedIntoForm;
      loadSelectedIntoForm();

      const listEl = document.getElementById('reviewsSavedList');
      const items = Object.entries(revMap).sort((a, b) => (b[1].updatedAt || 0) - (a[1].updatedAt || 0));
      if (!items.length) {
        listEl.innerHTML = '<div style="font-size:12px; color:var(--text-muted); padding:10px; border:1px dashed var(--border-color); border-radius:6px;">Nenhuma avaliação ou resenha salva ainda.</div>';
        return;
      }
      listEl.innerHTML = '';
      const statusLabels = { reading: 'Lendo', finished: 'Concluído', paused: 'Pausado', reread: 'Quero reler' };
      items.forEach(([key, r]) => {
        const card = document.createElement('div');
        card.className = 'review-card';
        const starsStr = '★'.repeat(r.rating || 0) + '☆'.repeat(5 - (r.rating || 0));
        card.innerHTML = `
          <div style="display:flex; justify-content:space-between; align-items:center; gap:8px; flex-wrap:wrap;">
            <div>
              <strong style="font-size:13px;">${escapeHtml(r.title || 'Livro')}</strong>
              <span style="font-size:11.5px; color:var(--text-muted); margin-left:6px;">${escapeHtml(r.author || '')}</span>
            </div>
            <div style="display:flex; align-items:center; gap:8px;">
              <span style="font-size:11px; padding:2px 6px; border:1px solid var(--border-color); border-radius:3px;">${statusLabels[r.status] || 'Lendo'}</span>
              <span style="color:#eab308; font-size:13px; letter-spacing:1px;">${starsStr}</span>
              <button class="tb-btn" style="height:24px; font-size:11px;">Editar</button>
            </div>
          </div>
          ${r.reviewText ? `<div style="font-size:12.5px; color:var(--text-secondary); white-space:pre-wrap; line-height:1.5;">${escapeHtml(r.reviewText)}</div>` : ''}
          <div style="font-size:10.5px; color:var(--text-muted);">Atualizado em ${escapeHtml(r.date || '')}</div>
        `;
        card.querySelector('button').addEventListener('click', () => {
          sel.value = key;
          loadSelectedIntoForm();
        });
        listEl.appendChild(card);
      });
    }

    document.getElementById('btnSaveBookReview').addEventListener('click', () => {
      const sel = document.getElementById('selectReviewBook');
      const key = sel.value;
      if (!key) {
        alert('Abra ou selecione um livro para avaliar.');
        return;
      }
      const labelTxt = sel.options[sel.selectedIndex] ? sel.options[sel.selectedIndex].textContent : state.title;
      const [tPart, aPart] = labelTxt.split(' — ');
      const revMap = getBookReviewsMap();
      revMap[key] = {
        title: tPart || state.title || key,
        author: aPart || state.author || '',
        rating: currentDraftStarRating,
        status: document.getElementById('selectReviewStatus').value,
        reviewText: document.getElementById('inputReviewText').value.trim(),
        date: new Date().toLocaleDateString('pt-BR'),
        updatedAt: Date.now()
      };
      saveBookReviewsMap(revMap);
      renderReviewsStudioPane();
      renderBookshelf();
      showToast('Nota e resenha salvas!');
    });

    document.getElementById('btnDeleteReview').addEventListener('click', () => {
      const key = document.getElementById('selectReviewBook').value;
      if (!key) return;
      const revMap = getBookReviewsMap();
      delete revMap[key];
      saveBookReviewsMap(revMap);
      renderReviewsStudioPane();
      renderBookshelf();
      showToast('Avaliação removida');
    });

    document.getElementById('btnExportReviewsMd').addEventListener('click', () => {
      const items = Object.values(getBookReviewsMap());
      if (!items.length) {
        alert('Nenhuma resenha salva para exportar.');
        return;
      }
      const md = '# Minhas Avaliações & Resenhas de Livros\n\n' + items.map(r =>
        `## ${r.title} (${'★'.repeat(r.rating || 0)})
- Autor: ${r.author || 'N/A'}
- Data: ${r.date || ''}

${r.reviewText || '_Sem resenha escrita._'}
`
      ).join('\n---\n\n');
      const blob = new Blob([md], { type: 'text/markdown;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `resenhas_livros_${new Date().toISOString().slice(0, 10)}.md`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 2000);
      showToast('Resenhas exportadas em Markdown (.MD)!');
    });

    // Conta Kindle & Send to Kindle
    function getKindleConfig() {
      try { return JSON.parse(localStorage.getItem('reader_kindle_config') || '{}'); }
      catch { return {}; }
    }

    function loadKindleConfigIntoUi() {
      const cfg = getKindleConfig();
      document.getElementById('inputKindleDestEmail').value = cfg.kindleEmail || '';
      document.getElementById('inputKindleDeviceName').value = cfg.deviceName || '';
      document.getElementById('selectKindleEmailProvider').value = cfg.provider || 'gmail';
      updateKindleProviderGuideUi();
      document.getElementById('inputKindleSenderEmail').value = cfg.senderEmail || '';
      document.getElementById('inputKindleApiKey').value = cfg.apiKey || '';
      const hist = cfg.history || [];
      const hEl = document.getElementById('kindleHistoryList');
      if (!hist.length) {
        hEl.textContent = 'Nenhum livro enviado para o Kindle ainda.';
      } else {
        hEl.innerHTML = hist.map(h => `
          <div style="display:flex; justify-content:space-between; padding:5px 0; border-bottom:1px solid var(--border-color);">
            <span><strong>${escapeHtml(h.title)}</strong> → ${escapeHtml(h.to)} (${escapeHtml(h.method)})</span>
            <span style="font-size:11px;">${escapeHtml(h.date)}</span>
          </div>
        `).join('');
      }
    }

    function saveKindleConfigFromUi() {
      const prev = getKindleConfig();
      const cfg = {
        ...prev,
        kindleEmail: document.getElementById('inputKindleDestEmail').value.trim(),
        deviceName: document.getElementById('inputKindleDeviceName').value.trim(),
        provider: document.getElementById('selectKindleEmailProvider').value,
        senderEmail: document.getElementById('inputKindleSenderEmail').value.trim(),
        apiKey: document.getElementById('inputKindleApiKey').value.trim()
      };
      localStorage.setItem('reader_kindle_config', JSON.stringify(cfg));
      return cfg;
    }

    function recordKindleSendHistory(title, to, method) {
      const cfg = getKindleConfig();
      cfg.history = cfg.history || [];
      cfg.history.unshift({ title, to, method, date: new Date().toLocaleDateString('pt-BR') });
      cfg.history = cfg.history.slice(0, 20);
      localStorage.setItem('reader_kindle_config', JSON.stringify(cfg));
      loadKindleConfigIntoUi();
      if (typeof pushCloudSyncSilent === 'function') pushCloudSyncSilent();
    }

    async function buildCurrentBookEpubFileForKindle() {
      if (!state.sections.length) throw new Error('Abra um livro primeiro para enviar para o Kindle.');
      const safeTitle = (state.title || 'livro').replace(/[<>:"/\|?*]+/g, '_');
      if (state.format === 'EPUB' && state.currentFileBuffer) {
        return { filename: `${safeTitle}.epub`, mime: 'application/epub+zip', buffer: state.currentFileBuffer };
      }
      if (state.format === 'PDF' && state.currentFileBuffer && state.currentFileBuffer.byteLength < 18 * 1024 * 1024) {
        return { filename: `${safeTitle}.pdf`, mime: 'application/pdf', buffer: state.currentFileBuffer };
      }
      // Converter livro atual (MOBI, AZW3, FB2, DOCX, MD, TXT) em .EPUB oficial para o Kindle
      for (const sec of state.sections) {
        if (state.format === 'PDF' && sec.text === null) await ensurePdfSectionText(sec);
        else if (sec.html === null && sec.buildHtml) sec.html = sec.buildHtml(sec.rawSlice);
      }
      const zipFiles = [
        { path: 'mimetype', content: 'application/epub+zip' },
        { path: 'META-INF/container.xml', content: '<?xml version="1.0" encoding="UTF-8"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>' }
      ];
      const manifestItems = [], spineItems = [], navPoints = [];
      state.sections.forEach((sec, idx) => {
        const id = `ch_${idx + 1}`;
        const fname = `${id}.xhtml`;
        const paras = (sec.text || '').split(/\r?\n+/).filter(Boolean).map(p => `<p>${escapeHtml(p.trim())}</p>`).join('\n');
        zipFiles.push({ path: `OEBPS/${fname}`, content: `<?xml version="1.0" encoding="utf-8"?><html xmlns="http://www.w3.org/1999/xhtml"><head><title>${escapeHtml(sec.title)}</title></head><body><h2>${escapeHtml(sec.title)}</h2>${paras}</body></html>` });
        manifestItems.push(`<item id="${id}" href="${fname}" media-type="application/xhtml+xml"/>`);
        spineItems.push(`<itemref idref="${id}"/>`);
        navPoints.push(`<navPoint id="nav_${idx + 1}" playOrder="${idx + 1}"><navLabel><text>${escapeHtml(sec.title)}</text></navLabel><content src="${fname}"/></navPoint>`);
      });
      zipFiles.push({ path: 'OEBPS/content.opf', content: `<?xml version="1.0" encoding="utf-8"?><package xmlns="http://www.idpf.org/2007/opf" unique-identifier="BookId" version="2.0"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>${escapeHtml(state.title)}</dc:title><dc:creator>${escapeHtml(state.author || 'Autor')}</dc:creator><dc:language>pt</dc:language><dc:identifier id="BookId">urn:uuid:${Date.now()}</dc:identifier></metadata><manifest><item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>${manifestItems.join('')}</manifest><spine toc="ncx">${spineItems.join('')}</spine></package>` });
      zipFiles.push({ path: 'OEBPS/toc.ncx', content: `<?xml version="1.0" encoding="utf-8"?><ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1"><head><meta name="dtb:uid" content="urn:uuid:${Date.now()}"/></head><docTitle><text>${escapeHtml(state.title)}</text></docTitle><navMap>${navPoints.join('')}</navMap></ncx>` });
      const epubBlob = createZipBlob(zipFiles);
      return { filename: `${safeTitle}.epub`, mime: 'application/epub+zip', buffer: await epubBlob.arrayBuffer() };
    }

    document.getElementById('btnSaveKindleConfig').addEventListener('click', () => {
      saveKindleConfigFromUi();
      document.getElementById('lblKindleStatus').textContent = 'Conta Kindle salva com sucesso!';
      showToast('Conta Kindle salva!');
    });

    function updateKindleProviderGuideUi() {
      const prov = document.getElementById('selectKindleEmailProvider').value;
      const lbl = document.getElementById('lblKindleSecretField');
      const guide = document.getElementById('lblKindleProviderGuide');
      const keyIn = document.getElementById('inputKindleApiKey');
      if (!guide || !lbl || !keyIn) return;
      if (prov === 'gmail') {
        lbl.textContent = 'Senha de App Google (16 letras)';
        keyIn.placeholder = 'abcd efgh ijkl mnop';
        guide.innerHTML = '<strong>Como conseguir a Senha de App do Google (1 minuto, grátis):</strong><br/>1. Acesse <a href="https://myaccount.google.com/apppasswords" target="_blank" rel="noopener" style="color:var(--accent); text-decoration:underline;">myaccount.google.com/apppasswords</a> (exige verificação em 2 etapas no Google).<br/>2. Crie um nome (ex: <code>Kindle</code>), copie a senha de 16 letras gerada e cole acima.<br/>3. Na Amazon (<a href="https://www.amazon.com.br/hz/mycd/myx#/home/settings/payment" target="_blank" rel="noopener" style="color:var(--accent); text-decoration:underline;">Preferências → Documentos Pessoais</a>), adicione seu Gmail como remetente aprovado.';
      } else if (prov === 'brevo') {
        lbl.textContent = 'API Key da Brevo (xkeysib-...)';
        keyIn.placeholder = 'xkeysib-...';
        guide.innerHTML = '<strong>Como pegar a chave grátis na Brevo (300 e-mails/dia sem domínio):</strong><br/>1. Crie conta grátis em <a href="https://app.brevo.com" target="_blank" rel="noopener" style="color:var(--accent); text-decoration:underline;">app.brevo.com</a> usando seu e-mail normal.<br/>2. Vá em menu superior direito → <strong>SMTP &amp; API → API Keys → Generate a new API key</strong> (começa com <code>xkeysib-...</code>) e cole acima.';
      } else {
        lbl.textContent = 'API Key do Resend (re_...)';
        keyIn.placeholder = 're_...';
        guide.innerHTML = '<strong>Aviso sobre Resend:</strong> O Resend só permite enviar para <code>@kindle.com</code> se você tiver um domínio próprio verificado no painel da Resend. Caso contrário, mude acima para <strong>Gmail Direto</strong> ou <strong>Brevo API</strong>, ou use a <strong>Opção 1</strong> acima sem chave nenhuma!';
      }
    }
    document.getElementById('selectKindleEmailProvider').addEventListener('change', updateKindleProviderGuideUi);

    document.getElementById('btnSendDirectToKindle').addEventListener('click', async () => {
      const cfg = saveKindleConfigFromUi();
      const statusEl = document.getElementById('lblKindleStatus');
      if (!cfg.kindleEmail || !cfg.kindleEmail.includes('@')) {
        statusEl.textContent = 'Informe seu e-mail @kindle.com acima (ex: nome@kindle.com).';
        return;
      }
      if (!cfg.apiKey) {
        statusEl.textContent = 'Preencha a Senha de App do Google (ou chave Brevo) — ou clique na "Opção 1: Baixar .EPUB + Abrir Amazon Send to Kindle" acima que não precisa de senha nenhuma!';
        return;
      }
      try {
        statusEl.textContent = 'Preparando e convertendo livro para formato oficial Kindle...';
        const fileObj = await buildCurrentBookEpubFileForKindle();
        if (fileObj.buffer.byteLength > 3.2 * 1024 * 1024) {
          statusEl.textContent = `Este livro tem ${(fileObj.buffer.byteLength / 1048576).toFixed(1)} MB e passa do limite de envio direto por servidor (3,2 MB). Use o botão "1. Baixar .EPUB + Abrir Amazon Send to Kindle" acima — ele aceita até 200 MB!`;
          return;
        }
        const bytes = new Uint8Array(fileObj.buffer);
        let bin = '';
        for (let i = 0; i < bytes.length; i += 8192) {
          bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 8192));
        }
        const b64 = btoa(bin);
        statusEl.textContent = `Enviando "${fileObj.filename}" para ${cfg.kindleEmail}...`;
        const res = await fetch('/api/send-kindle', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            provider: cfg.provider || 'gmail',
            apiKey: cfg.apiKey,
            fromEmail: cfg.senderEmail,
            kindleEmail: cfg.kindleEmail,
            bookTitle: state.title,
            filename: fileObj.filename,
            contentBase64: b64
          })
        });
        const rawResTxt = await res.text();
        let data = {};
        try { data = JSON.parse(rawResTxt); } catch {}
        if (!res.ok || !data.ok) {
          if (location.protocol === 'file:') {
            throw new Error('Você abriu o arquivo local (file://). Para envio direto em 1 clique, abra pela URL da sua Vercel/Netlify ou use a Opção 1 acima!');
          }
          if (res.status === 404) {
            throw new Error('Função /api/send-kindle não encontrada neste servidor (404). Suba a pasta "api/" na Vercel ou "netlify/" no Netlify, ou use a Opção 1 acima!');
          }
          if (res.status === 413) {
            throw new Error('Livro muito grande para o limite do servidor. Use a Opção 1 (Amazon Send to Kindle) acima que aceita até 200 MB!');
          }
          throw new Error(data.error || `HTTP ${res.status}: ${rawResTxt.slice(0, 120)}`);
        }
        recordKindleSendHistory(state.title, cfg.kindleEmail, cfg.provider === 'gmail' ? 'Gmail Direto' : 'E-mail Direto');
        recordSharedActivity({ type: 'kindle', bookTitle: state.title || state.currentFileName, targetEmail: cfg.kindleEmail, channel: cfg.provider === 'gmail' ? 'Gmail Direto' : 'E-mail Direto' });
        statusEl.textContent = `Enviado com sucesso para ${cfg.kindleEmail}! Em alguns minutos aparecerá no seu Kindle.`;
        showToast('Livro enviado para o seu Kindle!');
      } catch (err) {
        statusEl.textContent = 'Erro ao enviar: ' + err.message;
      }
    });

    async function sendViaAmazonWebPortal(portalUrl) {
      const cfg = saveKindleConfigFromUi();
      const statusEl = document.getElementById('lblKindleStatus');
      try {
        const fileObj = await buildCurrentBookEpubFileForKindle();
        const url = URL.createObjectURL(new Blob([fileObj.buffer], { type: fileObj.mime }));
        const a = document.createElement('a');
        a.href = url;
        a.download = fileObj.filename;
        a.click();
        setTimeout(() => URL.revokeObjectURL(url), 2500);
        recordKindleSendHistory(state.title, cfg.kindleEmail || 'Amazon Web', 'Amazon Send to Kindle');
        recordSharedActivity({ type: 'kindle', bookTitle: state.title || state.currentFileName, targetEmail: cfg.kindleEmail || 'Amazon Web', channel: 'Amazon Web' });
        window.open(portalUrl, '_blank', 'noopener');
        statusEl.textContent = `"${fileObj.filename}" baixado! Na aba da Amazon que abriu, clique em "Selecionar arquivos" e escolha esse arquivo que acabou de baixar.`;
        showToast('EPUB baixado e Amazon Send to Kindle aberto!');
      } catch (err) {
        statusEl.textContent = err.message;
      }
    }

    document.getElementById('btnSendKindleAmazonWeb').addEventListener('click', () => sendViaAmazonWebPortal('https://www.amazon.com.br/sendtokindle'));
    document.getElementById('btnSendKindleAmazonGlobal').addEventListener('click', () => sendViaAmazonWebPortal('https://www.amazon.com/sendtokindle'));

    document.getElementById('btnShareKindleNative').addEventListener('click', async () => {
      const cfg = saveKindleConfigFromUi();
      const statusEl = document.getElementById('lblKindleStatus');
      try {
        const fileObj = await buildCurrentBookEpubFileForKindle();
        const f = new File([fileObj.buffer], fileObj.filename, { type: fileObj.mime });
        if (navigator.canShare && navigator.canShare({ files: [f] })) {
          await navigator.share({ files: [f], title: state.title, text: `Enviar ${state.title} para o Kindle` });
          recordKindleSendHistory(state.title, cfg.kindleEmail || 'App Kindle', 'Compartilhado');
          recordSharedActivity({ type: 'kindle', bookTitle: state.title || state.currentFileName, targetEmail: cfg.kindleEmail || 'App Kindle', channel: 'Compartilhado' });
          statusEl.textContent = 'Arquivo enviado para o aplicativo escolhido!';
        } else {
          // No PC: baixar .epub e já abrir o Gmail no navegador com Destinatário e Assunto preenchidos!
          const url = URL.createObjectURL(new Blob([fileObj.buffer], { type: fileObj.mime }));
          const a = document.createElement('a');
          a.href = url;
          a.download = fileObj.filename;
          a.click();
          setTimeout(() => URL.revokeObjectURL(url), 2500);
          const to = encodeURIComponent(cfg.kindleEmail || '');
          const su = encodeURIComponent('Convert: ' + (state.title || 'Livro'));
          const bodyTxt = encodeURIComponent(`Anexe o arquivo "${fileObj.filename}" que acabou de ser baixado e clique em Enviar.`);
          window.open(`https://mail.google.com/mail/?view=cm&fs=1&to=${to}&su=${su}&body=${bodyTxt}`, '_blank', 'noopener');
          statusEl.textContent = `"${fileObj.filename}" baixado e Gmail aberto! Só arrastar o arquivo baixado para o e-mail e clicar em Enviar.`;
          showToast('EPUB baixado e Gmail aberto!');
        }
      } catch (err) {
        statusEl.textContent = 'Envio cancelado ou indisponível: ' + err.message;
      }
    });

    document.getElementById('btnSaveDailyGoal').addEventListener('click', () => {
      const val = Math.max(5, Math.min(300, parseInt(document.getElementById('inputDailyGoalMin').value || '20', 10)));
      const data = getReadingInsights();
      data.dailyGoal = val;
      saveReadingInsights(data);
      renderReadingInsightsPane();
      showToast(`Meta diária atualizada para ${val} minutos!`);
    });

    document.getElementById('btnMarkBookFinished').addEventListener('click', () => {
      if (!state.title) {
        alert('Abra um livro primeiro para marcá-lo como concluído.');
        return;
      }
      const data = getReadingInsights();
      if (!data.finishedBooks.some(b => b.title === state.title)) {
        data.finishedBooks.unshift({
          title: state.title,
          author: state.author || '',
          date: new Date().toLocaleDateString('pt-BR')
        });
        saveReadingInsights(data);
      }
      renderReadingInsightsPane();
      showToast(`Livro "${state.title}" adicionado aos Livros Concluídos!`);
    });

    /* =====================================================================
     * 15. NAVEGAÇÃO POR GESTOS NO CELULAR (SWIPE, TOQUE NAS BORDAS E GAVETA)
     * ===================================================================== */
    const sidebarBackdrop = document.getElementById('sidebarBackdrop');

    function syncSidebarBackdrop() {
      if (!sidebarBackdrop) return;
      const isOpen = !dom.sidebar.classList.contains('hidden-sidebar');
      sidebarBackdrop.classList.toggle('open', isOpen && window.innerWidth <= 768);
    }

    function closeSidebarOnMobile() {
      if (window.innerWidth <= 768 && !dom.sidebar.classList.contains('hidden-sidebar')) {
        dom.sidebar.classList.add('hidden-sidebar');
        syncSidebarBackdrop();
      }
    }

    document.getElementById('btnSidebar').addEventListener('click', syncSidebarBackdrop);
    if (sidebarBackdrop) {
      sidebarBackdrop.addEventListener('click', () => {
        dom.sidebar.classList.add('hidden-sidebar');
        syncSidebarBackdrop();
      });
    }

    // Fechar a barra lateral automaticamente no celular ao tocar em um capítulo, marcador ou resultado de busca
    dom.tocContainer.addEventListener('click', (e) => {
      if (e.target.closest('.toc-entry')) closeSidebarOnMobile();
    });
    dom.bookmarksContainer.addEventListener('click', (e) => {
      if (e.target.closest('.card-item') && !e.target.closest('.card-del-btn')) closeSidebarOnMobile();
    });
    dom.searchContainer.addEventListener('click', (e) => {
      if (e.target.closest('.search-item')) closeSidebarOnMobile();
    });

    // Gestos de Deslizar (Swipe Esquerda / Direita) para virar páginas no celular
    let touchStartX = 0;
    let touchStartY = 0;
    let touchStartTime = 0;

    dom.viewport.addEventListener('touchstart', (e) => {
      if (!e.touches || e.touches.length !== 1) return;
      touchStartX = e.touches[0].clientX;
      touchStartY = e.touches[0].clientY;
      touchStartTime = Date.now();
    }, { passive: true });

    dom.viewport.addEventListener('touchend', (e) => {
      if (!state.sections.length || !dom.emptyState.classList.contains('hidden')) return;
      if (!e.changedTouches || e.changedTouches.length !== 1) return;

      // Não virar página se o usuário acabou de selecionar texto
      const sel = window.getSelection();
      if (sel && sel.toString().trim().length > 0) return;

      const dx = e.changedTouches[0].clientX - touchStartX;
      const dy = e.changedTouches[0].clientY - touchStartY;
      const dt = Date.now() - touchStartTime;

      const isPaginatedOrManga = dom.viewport.classList.contains('paginated-mode') || state.format === 'CBZ' || (state.format === 'PDF' && state.pdfViewMode === 'canvas');

      // 1. Gesto de Swipe Horizontal (Deslizar o dedo para a esquerda ou direita)
      if (dt < 650 && Math.abs(dx) >= 48 && Math.abs(dx) > Math.abs(dy) * 1.35) {
        if (isPaginatedOrManga || Math.abs(dx) >= 85) {
          if (dx < 0) {
            if (state.mangaRtl) stepBackward(); else stepForward();
          } else {
            if (state.mangaRtl) stepForward(); else stepBackward();
          }
          return;
        }
      }

      // 2. Toque rápido nas bordas laterais da folha no Modo Paginado (Estilo Kindle Touch)
      if (dom.viewport.classList.contains('paginated-mode') && dt < 280 && Math.abs(dx) < 12 && Math.abs(dy) < 12) {
        const target = e.target;
        if (target && target.closest('a, button, input, select, textarea, .entity-note-ref, mark.user-hl, img')) return;
        const w = window.innerWidth;
        if (touchStartX <= w * 0.18) {
          if (state.mangaRtl) stepForward(); else stepBackward();
        } else if (touchStartX >= w * 0.82) {
          if (state.mangaRtl) stepBackward(); else stepForward();
        }
      }
    }, { passive: true });



    // =========================================================
    // PAINEL DE MEMBROS (OWNER) & CLUBE DE LEITURA (PERFIS / RESENHAS / CHAT)
    // =========================================================
    async function refreshOwnerMembersPanel() {
      const box = document.getElementById('ownerMembersManageBox');
      const listEl = document.getElementById('ownerMembersList');
      const cfg = getCloudConfig();
      if (!box || !listEl) return;
      const isSupabaseOwner = cfg.provider === 'supabase' && cfg.url && cfg.apiKey && (cfg.userRole === 'owner' || !cfg.userRole);
      box.classList.toggle('hidden', !isSupabaseOwner);
      if (!isSupabaseOwner) return;
      listEl.innerHTML = '<div style="font-size:11.5px; color:var(--text-muted);">Carregando membros...</div>';
      try {
        const res = await fetch(`${cfg.url}/rest/v1/library_members?select=*&order=created_at.desc`, {
          headers: getSupabaseHeaders(cfg)
        });
        if (!res.ok) throw new Error('Tabela library_members indisponível ou sem permissão owner.');
        const rows = await res.json();
        if (!Array.isArray(rows) || !rows.length) {
          listEl.innerHTML = '<div style="font-size:11.5px; color:var(--text-muted);">Nenhum membro cadastrado ainda.</div>';
          return;
        }
        listEl.innerHTML = '';
        rows.forEach(r => {
          const rowDiv = document.createElement('div');
          rowDiv.className = 'card-item';
          rowDiv.style.cssText = 'display:flex; justify-content:space-between; align-items:center; gap:8px; padding:6px 8px;';
          rowDiv.innerHTML = `
            <div style="min-width:0; flex:1;">
              <div style="font-size:12px; font-weight:600; overflow:hidden; text-overflow:ellipsis;">${escapeHtml(r.email || '')}</div>
              <div style="font-size:10.5px; color:var(--text-muted);">Papel: ${escapeHtml(r.role || 'member')} · Status: ${escapeHtml(r.status || 'active')}</div>
            </div>
            <div style="display:flex; gap:4px;">
              <button class="tb-btn btn-toggle-member-role" style="height:22px; font-size:10.5px; padding:0 6px;">${r.role === 'owner' ? 'Tornar Membro' : 'Tornar Owner'}</button>
              <button class="tb-btn btn-remove-member" style="height:22px; font-size:10.5px; padding:0 6px; color:#f87171;">Remover</button>
            </div>
          `;
          rowDiv.querySelector('.btn-toggle-member-role').addEventListener('click', async () => {
            const nextRole = r.role === 'owner' ? 'member' : 'owner';
            await fetch(`${cfg.url}/rest/v1/library_members?email=eq.${encodeURIComponent(r.email)}`, {
              method: 'PATCH',
              headers: getSupabaseHeaders(cfg, { 'Content-Type': 'application/json' }),
              body: JSON.stringify({ role: nextRole })
            });
            refreshOwnerMembersPanel();
          });
          rowDiv.querySelector('.btn-remove-member').addEventListener('click', async () => {
            if (!confirm(`Remover acesso de ${r.email}?`)) return;
            await fetch(`${cfg.url}/rest/v1/library_members?email=eq.${encodeURIComponent(r.email)}`, {
              method: 'DELETE',
              headers: getSupabaseHeaders(cfg)
            });
            refreshOwnerMembersPanel();
          });
          listEl.appendChild(rowDiv);
        });
      } catch (err) {
        listEl.innerHTML = `<div style="font-size:11.5px; color:var(--text-muted);">${escapeHtml(err.message)}</div>`;
      }
    }

    const btnRefOwnerEl = document.getElementById('btnRefreshOwnerMembers');
    if (btnRefOwnerEl) btnRefOwnerEl.addEventListener('click', refreshOwnerMembersPanel);
    const btnAddOwnerEl = document.getElementById('btnOwnerAddMember');
    if (btnAddOwnerEl) {
      btnAddOwnerEl.addEventListener('click', async () => {
        const inp = document.getElementById('inputOwnerAddMemberEmail');
        const email = (inp && inp.value || '').trim().toLowerCase();
        if (!email || !email.includes('@')) { showToast('Informe um e-mail válido.', true); return; }
        const cfg = getCloudConfig();
        try {
          const res = await fetch(`${cfg.url}/rest/v1/library_members`, {
            method: 'POST',
            headers: getSupabaseHeaders(cfg, { 'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates' }),
            body: JSON.stringify({ email, role: 'member', status: 'active' })
          });
          if (!res.ok) throw new Error('Falha ao adicionar membro (verifique RLS owner).');
          if (inp) inp.value = '';
          showToast(`Membro ${email} adicionado!`);
          refreshOwnerMembersPanel();
        } catch (err) {
          showToast(err.message, true);
        }
      });
    }

    // --- Perfis Públicos do Clube (_shared_profiles.json) ---
    function getLocalClubProfiles() {
      try { return JSON.parse(localStorage.getItem('reader_club_profiles') || '{}'); } catch { return {}; }
    }
    function saveLocalClubProfiles(map) {
      try { localStorage.setItem('reader_club_profiles', JSON.stringify(map || {})); } catch {}
    }
    function getClubMemberSlug(cfg, prof) {
      const base = (cfg && cfg.userEmail) || (prof && prof.username) || (prof && prof.displayName) || 'leitor';
      return base.toLowerCase().replace(/[^a-z0-9_-]/g, '_');
    }
    async function pullPublicClubProfiles() {
      const cfg = getCloudConfig();
      let map = getLocalClubProfiles();
      if (isCloudProfileAuthenticated(cfg) && cfg.provider !== 'firebase') {
        try {
          let remote = null;
          if (isOAuthCloudProvider(cfg.provider)) {
            remote = await cloudReadJsonByPath(cfg, '_shared_profiles.json').catch(() => null);
          } else {
            const res = await fetch(`${cfg.url}/storage/v1/object/${cfg.bucket}/${cfg.syncKey}/_shared_profiles.json?t=${Date.now()}`, {
              cache: 'no-store',
              headers: getSupabaseHeaders(cfg)
            }).catch(() => null);
            if (res && res.ok) remote = await res.json().catch(() => null);
          }
          if (remote && typeof remote === 'object') {
            map = { ...map, ...remote };
            saveLocalClubProfiles(map);
          }
        } catch {}
      }
      renderClubProfilesList(map);
      return map;
    }
    async function pushPublicClubProfile(cfgOverride) {
      const cfg = cfgOverride || getCloudConfig();
      const prof = typeof getUserProfile === 'function' ? getUserProfile() : { displayName: 'Leitor' };
      const slug = getClubMemberSlug(cfg, prof);
      const hist = JSON.parse(localStorage.getItem('reader_history') || '{}');
      const revMap = typeof getBookReviewsMap === 'function' ? getBookReviewsMap() : {};
      const recentBooks = Object.values(hist)
        .filter(h => h && h.title)
        .sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0))
        .slice(0, 3)
        .map(h => ({ title: h.title, progress: h.percent || 0 }));
      const publicReviews = {};
      Object.entries(revMap).forEach(([k, v]) => {
        if (v && (v.rating || v.text)) {
          publicReviews[k] = { title: (hist[k] && hist[k].title) || k, rating: v.rating || 0, text: (v.text || '').slice(0, 400), updatedAt: v.updatedAt || Date.now() };
        }
      });
      const myPublic = {
        slug,
        displayName: prof.displayName || 'Leitor',
        username: prof.username || '',
        bio: (prof.bio || '').slice(0, 180),
        avatarDataUrl: prof.avatarDataUrl || '',
        currentlyReading: recentBooks,
        reviews: publicReviews,
        updatedAt: Date.now()
      };
      const map = getLocalClubProfiles();
      map[slug] = myPublic;
      saveLocalClubProfiles(map);
      if (isCloudProfileAuthenticated(cfg) && cfg.provider !== 'firebase') {
        try {
          if (isOAuthCloudProvider(cfg.provider)) {
            await cloudWriteJsonByPath(cfg, '_shared_profiles.json', map).catch(() => {});
          } else {
            await fetch(`${cfg.url}/storage/v1/object/${cfg.bucket}/${cfg.syncKey}/_shared_profiles.json`, {
              method: 'POST',
              headers: getSupabaseHeaders(cfg, { 'Content-Type': 'application/json', 'x-upsert': 'true' }),
              body: JSON.stringify(map)
            }).catch(() => {});
          }
        } catch {}
      }
      renderClubProfilesList(map);
      return map;
    }
    function renderClubProfilesList(map) {
      const box = document.getElementById('clubProfilesList');
      if (!box) return;
      const entries = Object.values(map || {}).sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
      if (!entries.length) {
        box.innerHTML = '<div style="font-size:11.5px; color:var(--text-muted);">Nenhum perfil do clube sincronizado ainda.</div>';
        return;
      }
      box.innerHTML = '';
      entries.forEach(p => {
        const card = document.createElement('div');
        card.className = 'card-item';
        card.style.padding = '8px 10px';
        const readingHtml = (p.currentlyReading || []).length
          ? p.currentlyReading.map(r => `<span class="book-badge">${escapeHtml(r.title)} (${r.progress || 0}%)</span>`).join(' ')
          : '<span style="color:var(--text-muted);">Sem leitura recente</span>';
        const revCount = Object.keys(p.reviews || {}).length;
        card.innerHTML = `
          <div style="display:flex; gap:8px; align-items:center;">
            <div style="width:32px; height:32px; border-radius:50%; background:var(--accent); color:#fff; display:flex; align-items:center; justify-content:center; font-weight:700; overflow:hidden; flex-shrink:0;">
              ${p.avatarDataUrl ? `<img src="${p.avatarDataUrl}" style="width:100%;height:100%;object-fit:cover;" />` : escapeHtml((p.displayName || 'L').charAt(0).toUpperCase())}
            </div>
            <div style="min-width:0; flex:1;">
              <div style="font-size:12.5px; font-weight:700;">${escapeHtml(p.displayName || 'Leitor')} ${p.username ? `<span style="font-weight:400; color:var(--text-muted);">@${escapeHtml(p.username)}</span>` : ''}</div>
              ${p.bio ? `<div style="font-size:11px; color:var(--text-muted);">${escapeHtml(p.bio)}</div>` : ''}
            </div>
            <span style="font-size:10.5px; color:var(--accent); font-weight:600;">${revCount} resenha(s)</span>
          </div>
          <div style="margin-top:6px; font-size:11px; display:flex; flex-wrap:wrap; gap:4px; align-items:center;">
            <strong style="color:var(--text-muted);">Lendo:</strong> ${readingHtml}
          </div>
        `;
        card.style.cursor = 'pointer';
        card.title = 'Clique para ver o perfil completo e resenhas de ' + (p.displayName || 'Leitor');
        card.addEventListener('click', () => openFriendProfileModal(p));
        box.appendChild(card);
      });
    }

    function openFriendProfileModal(p) {
      const mod = document.getElementById('friendProfileModal');
      const titleEl = document.getElementById('friendProfileModalTitle');
      const bodyEl = document.getElementById('friendProfileModalBody');
      if (!mod || !bodyEl || !p) return;
      if (titleEl) titleEl.textContent = p.username ? `${p.displayName || 'Leitor'} (@${p.username})` : (p.displayName || 'Leitor');
      const readingList = (p.currentlyReading || []).map(r =>
        `<div class="card-item" style="padding:6px 8px; display:flex; justify-content:space-between;"><span>${escapeHtml(r.title)}</span><strong style="color:var(--accent);">${r.progress || 0}%</strong></div>`
      ).join('') || '<div style="font-size:12px; color:var(--text-muted);">Nenhuma leitura recente registrada.</div>';
      const reviews = Object.values(p.reviews || {});
      const revList = reviews.map(r => `
        <div class="card-item" style="padding:8px 10px;">
          <div style="display:flex; justify-content:space-between; font-size:12px; font-weight:700;">
            <span>${escapeHtml(r.title || 'Livro')}</span>
            <span style="color:#f59e0b;">${'★'.repeat(r.rating || 0)}${'☆'.repeat(5 - (r.rating || 0))}</span>
          </div>
          ${r.text ? `<div style="font-size:12px; margin-top:4px; color:var(--text-primary);">${escapeHtml(r.text)}</div>` : ''}
        </div>
      `).join('') || '<div style="font-size:12px; color:var(--text-muted);">Nenhuma resenha publicada ainda.</div>';
      bodyEl.innerHTML = `
        <div style="display:flex; gap:12px; align-items:center;">
          <div style="width:52px; height:52px; border-radius:50%; background:var(--accent); color:#fff; display:flex; align-items:center; justify-content:center; font-size:20px; font-weight:700; overflow:hidden; flex-shrink:0;">
            ${p.avatarDataUrl ? `<img src="${p.avatarDataUrl}" style="width:100%;height:100%;object-fit:cover;" />` : escapeHtml((p.displayName || 'L').charAt(0).toUpperCase())}
          </div>
          <div>
            <div style="font-size:15px; font-weight:700;">${escapeHtml(p.displayName || 'Leitor')}</div>
            ${p.bio ? `<div style="font-size:12px; color:var(--text-muted); margin-top:2px;">${escapeHtml(p.bio)}</div>` : ''}
          </div>
        </div>
        <div><strong style="font-size:12px; text-transform:uppercase; color:var(--text-muted);">Lendo Recentemente</strong><div style="display:flex; flex-direction:column; gap:4px; margin-top:6px;">${readingList}</div></div>
        <div><strong style="font-size:12px; text-transform:uppercase; color:var(--text-muted);">Resenhas (${reviews.length})</strong><div style="display:flex; flex-direction:column; gap:6px; margin-top:6px;">${revList}</div></div>
      `;
      mod.classList.add('open');
    }
    const btnCloseFriendEl = document.getElementById('btnCloseFriendProfileModal');
    if (btnCloseFriendEl) btnCloseFriendEl.addEventListener('click', () => document.getElementById('friendProfileModal').classList.remove('open'));

    // --- Leitura Conjunta do Clube ---
    function getJointReadState() {
      try { return JSON.parse(localStorage.getItem('reader_v2_joint_read') || '{"bookTitle":"","members":{}}'); } catch { return { bookTitle: '', members: {} }; }
    }
    function saveJointReadState(obj) {
      try { localStorage.setItem('reader_v2_joint_read', JSON.stringify(obj)); } catch {}
    }
    function renderJointReadBox() {
      const titleEl = document.getElementById('jointReadCurrentTitle');
      const listEl = document.getElementById('jointReadMembersList');
      if (!titleEl || !listEl) return;
      const jr = getJointReadState();
      if (!jr.bookTitle) {
        titleEl.textContent = 'Nenhum livro conjunto definido ainda.';
        listEl.innerHTML = '';
        return;
      }
      titleEl.textContent = `Livro Conjunto Atual: ${jr.bookTitle}`;
      const clubMap = getLocalClubProfiles();
      const rows = [];
      const target = jr.bookTitle.toLowerCase();
      Object.values(clubMap).forEach(p => {
        const hit = (p.currentlyReading || []).find(b => b.title && b.title.toLowerCase().includes(target));
        rows.push({ name: p.displayName || 'Leitor', pct: hit ? (hit.progress || 0) : (jr.members[p.slug] || 0) });
      });
      if (!rows.length) {
        const myPct = (state && state.title && state.title.toLowerCase().includes(target))
          ? parseInt(document.getElementById('statusPercent')?.textContent || '0', 10) || 0
          : 0;
        rows.push({ name: 'Você', pct: myPct });
      }
      listEl.innerHTML = rows.map(r => `
        <div class="joint-read-row">
          <span style="min-width:90px; font-weight:600; overflow:hidden; text-overflow:ellipsis;">${escapeHtml(r.name)}</span>
          <div class="joint-read-bar-bg"><div class="joint-read-bar-fill" style="width:${Math.min(100, Math.max(0, r.pct))}%;"></div></div>
          <span style="min-width:34px; text-align:right; font-weight:700; color:var(--accent);">${r.pct}%</span>
        </div>
      `).join('');
    }
    const btnSetJointEl = document.getElementById('btnSetJointBook');
    const inpJointEl = document.getElementById('inputJointBookTitle');
    if (btnSetJointEl && inpJointEl) {
      btnSetJointEl.addEventListener('click', async () => {
        const t = (inpJointEl.value || (state && state.title) || '').trim();
        if (!t) return;
        const jr = getJointReadState();
        jr.bookTitle = t;
        saveJointReadState(jr);
        renderJointReadBox();
        const cfg = getCloudConfig();
        if (isCloudProfileAuthenticated(cfg)) {
          if (isOAuthCloudProvider(cfg.provider)) {
            await cloudWriteJsonByPath(cfg, '_shared_joint_read.json', jr).catch(() => {});
          } else if (cfg.provider === 'supabase') {
            await fetch(`${cfg.url}/storage/v1/object/${cfg.bucket}/${cfg.syncKey}/_shared_joint_read.json`, {
              method: 'POST',
              headers: getSupabaseHeaders(cfg, { 'Content-Type': 'application/json', 'x-upsert': 'true' }),
              body: JSON.stringify(jr)
            }).catch(() => {});
          }
        }
        showToast(`Livro conjunto definido: ${t}`);
      });
    }
    renderJointReadBox();
    function renderBookClubReviewsBox(bookObj) {
      const box = document.getElementById('infoClubReviewsBox');
      if (!box || !bookObj) return;
      const map = getLocalClubProfiles();
      const targetTitle = (bookObj.title || '').toLowerCase();
      const matches = [];
      Object.values(map).forEach(p => {
        Object.entries(p.reviews || {}).forEach(([k, r]) => {
          if (k === bookObj.bookKey || (r.title && targetTitle && r.title.toLowerCase() === targetTitle)) {
            matches.push({ member: p.displayName || 'Leitor', rating: r.rating || 0, text: r.text || '' });
          }
        });
      });
      if (!matches.length) {
        box.innerHTML = '<div style="font-size:11.5px; color:var(--text-muted);">Nenhuma resenha de amigos para este livro ainda.</div>';
        return;
      }
      box.innerHTML = matches.map(m => `
        <div class="card-item" style="padding:6px 8px; margin-bottom:4px;">
          <div style="display:flex; justify-content:space-between; font-size:11.5px; font-weight:700;">
            <span>${escapeHtml(m.member)}</span>
            <span style="color:#f59e0b;">${'★'.repeat(m.rating)}${'☆'.repeat(5 - m.rating)}</span>
          </div>
          ${m.text ? `<div style="font-size:11.5px; color:var(--text-primary); margin-top:3px;">${escapeHtml(m.text)}</div>` : ''}
        </div>
      `).join('');
    }

    // --- Chat do Clube (_shared_chat.json) ---
    function getLocalClubChat() {
      try { return JSON.parse(localStorage.getItem('reader_club_chat') || '[]'); } catch { return []; }
    }
    function saveLocalClubChat(arr) {
      try { localStorage.setItem('reader_club_chat', JSON.stringify((arr || []).slice(-120))); } catch {}
    }
    function renderClubChatList(list) {
      const box = document.getElementById('clubChatList');
      if (!box) return;
      const msgs = Array.isArray(list) ? list : getLocalClubChat();
      if (!msgs.length) {
        box.innerHTML = '<div style="font-size:11.5px; color:var(--text-muted);">Nenhuma mensagem no chat ainda. Diga olá ao clube!</div>';
        return;
      }
      box.innerHTML = '';
      msgs.slice(-60).forEach(m => {
        const div = document.createElement('div');
        div.style.cssText = 'padding:5px 8px; border-radius:6px; background:var(--bg-elevated); font-size:12px;';
        const dt = new Date(m.timestamp || Date.now()).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
        div.innerHTML = `<strong style="color:var(--accent);">${escapeHtml(m.author || 'Leitor')}</strong> <span style="font-size:10px; color:var(--text-muted);">${dt}</span>: <span>${escapeHtml(m.text || '')}</span>`;
        box.appendChild(div);
      });
      box.scrollTop = box.scrollHeight;
    }
    async function pullClubChatMessages() {
      const cfg = getCloudConfig();
      let list = getLocalClubChat();
      if (isCloudProfileAuthenticated(cfg) && cfg.provider !== 'firebase') {
        try {
          let remote = null;
          if (isOAuthCloudProvider(cfg.provider)) {
            remote = await cloudReadJsonByPath(cfg, '_shared_chat.json').catch(() => null);
          } else {
            const res = await fetch(`${cfg.url}/storage/v1/object/${cfg.bucket}/${cfg.syncKey}/_shared_chat.json?t=${Date.now()}`, {
              cache: 'no-store',
              headers: getSupabaseHeaders(cfg)
            }).catch(() => null);
            if (res && res.ok) remote = await res.json().catch(() => null);
          }
          if (Array.isArray(remote)) {
            const seen = new Set();
            list = [...list, ...remote].filter(x => x && x.id && !seen.has(x.id) && seen.add(x.id))
              .sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0))
              .slice(-120);
            saveLocalClubChat(list);
          }
        } catch {}
      }
      renderClubChatList(list);
      return list;
    }
    async function sendClubChatMessage(rawText) {
      const text = (rawText || '').trim();
      if (!text) return;
      const cfg = getCloudConfig();
      const prof = typeof getUserProfile === 'function' ? getUserProfile() : { displayName: 'Leitor' };
      const msg = {
        id: `${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        timestamp: Date.now(),
        author: prof.displayName || (cfg.userEmail ? cfg.userEmail.split('@')[0] : 'Leitor'),
        text: text.slice(0, 500)
      };
      let list = [...getLocalClubChat(), msg].slice(-120);
      saveLocalClubChat(list);
      renderClubChatList(list);
      if (isCloudProfileAuthenticated(cfg) && cfg.provider !== 'firebase') {
        try {
          const remote = await pullClubChatMessages();
          const seen = new Set();
          list = [...remote, msg].filter(x => x && x.id && !seen.has(x.id) && seen.add(x.id)).slice(-120);
          saveLocalClubChat(list);
          renderClubChatList(list);
          if (isOAuthCloudProvider(cfg.provider)) {
            await cloudWriteJsonByPath(cfg, '_shared_chat.json', list).catch(() => {});
          } else {
            await fetch(`${cfg.url}/storage/v1/object/${cfg.bucket}/${cfg.syncKey}/_shared_chat.json`, {
              method: 'POST',
              headers: getSupabaseHeaders(cfg, { 'Content-Type': 'application/json', 'x-upsert': 'true' }),
              body: JSON.stringify(list)
            }).catch(() => {});
          }
        } catch {}
      }
    }

    const btnRefClubProfEl = document.getElementById('btnRefreshClubProfiles');
    if (btnRefClubProfEl) btnRefClubProfEl.addEventListener('click', pullPublicClubProfiles);
    const btnRefClubChatEl = document.getElementById('btnRefreshClubChat');
    if (btnRefClubChatEl) btnRefClubChatEl.addEventListener('click', pullClubChatMessages);
    const btnSendClubChatEl = document.getElementById('btnSendClubChat');
    const inpClubChatEl = document.getElementById('inputClubChatMsg');
    if (btnSendClubChatEl && inpClubChatEl) {
      const submitChat = async () => {
        const val = inpClubChatEl.value;
        if (!val.trim()) return;
        inpClubChatEl.value = '';
        await sendClubChatMessage(val);
      };
      btnSendClubChatEl.addEventListener('click', submitChat);
      inpClubChatEl.addEventListener('keydown', (e) => { if (e.key === 'Enter') submitChat(); });
    }
