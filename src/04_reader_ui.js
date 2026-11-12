    /* =====================================================================
     * 8. PARSERS ADICIONAIS (FB2 E MARKDOWN) + CARREGAMENTO DE ARQUIVOS
     * ===================================================================== */
    async function parseFb2(arrayBuffer, fileName) {
      const rawXml = new TextDecoder('utf-8').decode(arrayBuffer);
      const doc = new DOMParser().parseFromString(rawXml, 'text/xml');
      const titleEl = doc.querySelector('title-info > book-title');
      const authorEl = doc.querySelector('title-info > author');
      const title = titleEl ? titleEl.textContent.trim() : fileName.replace(/\.[^.]+$/, '');
      const author = authorEl ? authorEl.textContent.replace(/\s+/g, ' ').trim() : 'FictionBook';

      const binMap = new Map();
      doc.querySelectorAll('binary').forEach(b => {
        const id = b.getAttribute('id');
        const ctype = b.getAttribute('content-type') || 'image/jpeg';
        const b64 = b.textContent.replace(/\s+/g, '');
        if (id && b64) binMap.set(id, `data:${ctype};base64,${b64}`);
      });

      const sections = [];
      const toc = [];
      const bodySections = Array.from(doc.querySelectorAll('body > section'));
      const targets = bodySections.length ? bodySections : Array.from(doc.querySelectorAll('body'));

      targets.forEach((secNode, idx) => {
        const tNode = secNode.querySelector(':scope > title');
        const secTitle = tNode ? tNode.textContent.replace(/\s+/g, ' ').trim() : `Seção ${idx + 1}`;
        let html = `<div class="book-chapter"><h2>${escapeHtml(secTitle)}</h2>`;
        secNode.querySelectorAll('p, subtitle, epigraph, poem, v, image').forEach(el => {
          const tag = el.tagName.toLowerCase();
          if (tag === 'image') {
            const href = el.getAttribute('l:href') || el.getAttribute('xlink:href') || el.getAttribute('href') || '';
            const cleanId = href.replace(/^#/, '');
            if (binMap.has(cleanId)) {
              html += `<div style="text-align:center;margin:1em 0;"><img src="${binMap.get(cleanId)}" style="max-width:100%;" /></div>`;
            }
          } else if (tag === 'subtitle') {
            html += `<h3>${escapeHtml(el.textContent.trim())}</h3>`;
          } else if (tag === 'p' || tag === 'v') {
            html += `<p>${escapeHtml(el.textContent.trim())}</p>`;
          }
        });
        html += '</div>';
        const text = secNode.textContent.replace(/\s+/g, ' ').trim();
        if (text.length > 0) {
          sections.push({ title: secTitle, html, text });
          toc.push({ label: secTitle, sectionIndex: sections.length - 1, depth: 0 });
        }
      });

      if (!sections.length) {
        const fallbackTxt = doc.documentElement ? doc.documentElement.textContent : rawXml;
        sections.push({ title: 'Documento', html: `<p>${escapeHtml(fallbackTxt)}</p>`, text: fallbackTxt });
      }
      return { title, author, format: 'FB2', sections, toc };
    }

    function parseMarkdown(arrayBuffer, fileName) {
      const rawMd = new TextDecoder('utf-8').decode(arrayBuffer);
      const title = fileName.replace(/\.[^.]+$/, '');
      const chunks = rawMd.split(/(?=^#{1,2}\s+)/m).filter(c => c.trim().length > 0);
      const sections = [];
      const toc = [];

      const mdToHtml = (md) => {
        let h = escapeHtml(md);
        h = h.replace(/```([\s\S]*?)```/g, '<pre><code>$1</code></pre>');
        h = h.replace(/^###\s+(.+)$/gm, '<h3>$1</h3>');
        h = h.replace(/^##\s+(.+)$/gm, '<h2>$1</h2>');
        h = h.replace(/^#\s+(.+)$/gm, '<h1>$1</h1>');
        h = h.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
        h = h.replace(/\*(.+?)\*/g, '<em>$1</em>');
        h = h.replace(/`([^`]+)`/g, '<code>$1</code>');
        h = h.replace(/^>\s+(.+)$/gm, '<blockquote>$1</blockquote>');
        return h.split(/\r?\n\r?\n+/).map(block => {
          const b = block.trim();
          if (!b) return '';
          if (/^<(h[1-3]|pre|blockquote)/i.test(b)) return b;
          return `<p>${b.replace(/\r?\n/g, '<br>')}</p>`;
        }).join('\n');
      };

      (chunks.length ? chunks : [rawMd]).forEach((chunk, idx) => {
        const m = chunk.match(/^#{1,2}\s+(.+)$/m);
        const secTitle = m ? m[1].trim() : `Seção ${idx + 1}`;
        const html = mdToHtml(chunk);
        const text = chunk.replace(/[#*`>_~-]/g, ' ').replace(/\s+/g, ' ').trim();
        sections.push({ title: secTitle, html, text });
        toc.push({ label: secTitle, sectionIndex: idx, depth: chunk.startsWith('##') ? 1 : 0 });
      });

      return { title, author: 'Markdown', format: 'MD', sections, toc };
    }

    // Parser nativo para arquivos Word (.DOCX) e OpenDocument (.ODT) via ZIP XML + Rich Text (.RTF)
    async function parseDocx(arrayBuffer, fileName) {
      const title = fileName.replace(/\.[^.]+$/, '');
      try {
        const zip = await openZipBuffer(arrayBuffer);
        const xmlText = await zip.readText('word/document.xml');
        if (!xmlText) throw new Error('word/document.xml não encontrado');
        const doc = new DOMParser().parseFromString(xmlText, 'text/xml');
        const paragraphs = Array.from(doc.getElementsByTagNameNS('*', 'p'));
        const sections = [];
        const toc = [];
        let curTitle = title;
        let curHtml = `<div class="book-chapter"><h2>${escapeHtml(curTitle)}</h2>`;
        let curText = [];

        const flushSection = () => {
          const joined = curText.join('\n').trim();
          if (joined.length > 0) {
            sections.push({ title: curTitle, html: curHtml + '</div>', text: joined });
            toc.push({ label: curTitle, sectionIndex: sections.length - 1, depth: 0 });
          }
        };

        paragraphs.forEach(p => {
          const texts = Array.from(p.getElementsByTagNameNS('*', 't')).map(t => t.textContent || '').join('');
          const clean = texts.replace(/\s+/g, ' ').trim();
          if (!clean) return;
          const pStyle = p.getElementsByTagNameNS('*', 'pStyle')[0];
          const styleVal = pStyle ? (pStyle.getAttribute('w:val') || pStyle.getAttribute('val') || '') : '';
          if (/^(Heading1|Heading2|Titulo1|Título1|Title)$/i.test(styleVal) && curText.length > 8) {
            flushSection();
            curTitle = clean.slice(0, 90);
            curHtml = `<div class="book-chapter"><h2>${escapeHtml(curTitle)}</h2>`;
            curText = [clean];
          } else {
            curHtml += `<p>${escapeHtml(clean)}</p>`;
            curText.push(clean);
          }
        });
        flushSection();
        if (!sections.length) {
          const raw = doc.documentElement ? doc.documentElement.textContent : '';
          sections.push({ title, html: `<p>${escapeHtml(raw)}</p>`, text: raw });
          toc.push({ label: title, sectionIndex: 0, depth: 0 });
        }
        return { title, author: 'Documento Word', format: 'DOCX', sections, toc };
      } catch {
        // Fallback para arquivos .doc baseados em HTML ou texto
        const raw = new TextDecoder('utf-8', { fatal: false }).decode(arrayBuffer);
        const clean = raw.replace(/<[^>]+>/g, ' ').replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, ' ').replace(/\s+/g, ' ').trim();
        return {
          title,
          author: 'Documento Word',
          format: 'DOC',
          sections: [{ title, html: `<div class="book-chapter"><h2>${escapeHtml(title)}</h2><p>${escapeHtml(clean)}</p></div>`, text: clean }],
          toc: [{ label: title, sectionIndex: 0, depth: 0 }]
        };
      }
    }

    async function parseOdt(arrayBuffer, fileName) {
      const title = fileName.replace(/\.[^.]+$/, '');
      const zip = await openZipBuffer(arrayBuffer);
      const xmlText = await zip.readText('content.xml');
      if (!xmlText) throw new Error('Arquivo ODT inválido (content.xml ausente).');
      const doc = new DOMParser().parseFromString(xmlText, 'text/xml');
      const nodes = Array.from(doc.querySelectorAll('h, p, text\\:h, text\\:p'));
      const paras = (nodes.length ? nodes : Array.from(doc.getElementsByTagNameNS('*', 'p')))
        .map(n => n.textContent.replace(/\s+/g, ' ').trim())
        .filter(Boolean);
      const html = `<div class="book-chapter"><h2>${escapeHtml(title)}</h2>` + paras.map(p => `<p>${escapeHtml(p)}</p>`).join('') + `</div>`;
      return {
        title,
        author: 'OpenDocument',
        format: 'ODT',
        sections: [{ title, html, text: paras.join('\n\n') }],
        toc: [{ label: title, sectionIndex: 0, depth: 0 }]
      };
    }

    function parseRtf(arrayBuffer, fileName) {
      const title = fileName.replace(/\.[^.]+$/, '');
      const raw = new TextDecoder('windows-1252').decode(arrayBuffer);
      let txt = raw
        .replace(/\\par[d]?\b/g, '\n\n')
        .replace(/\\line\b/g, '\n')
        .replace(/\\'([0-9a-fA-F]{2})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
        .replace(/\\u(-?\d+)\??/g, (_, code) => String.fromCharCode(parseInt(code, 10) & 0xFFFF))
        .replace(/\{\\(?:fonttbl|colortbl|stylesheet|info|pict)[\s\S]*?\}/g, '')
        .replace(/\\[a-zA-Z]+-?\d*\s?/g, '')
        .replace(/[{}]/g, '');
      const paras = txt.split(/\n\s*\n+/).map(p => p.replace(/\s+/g, ' ').trim()).filter(Boolean);
      const html = `<div class="book-chapter"><h2>${escapeHtml(title)}</h2>` + paras.map(p => `<p>${escapeHtml(p)}</p>`).join('') + `</div>`;
      return {
        title,
        author: 'Rich Text',
        format: 'RTF',
        sections: [{ title, html, text: paras.join('\n\n') }],
        toc: [{ label: title, sectionIndex: 0, depth: 0 }]
      };
    }

    async function parseAnyBookBuffer(buffer, fileName) {
      const ext = (fileName || '').split('.').pop().toLowerCase();
      if (ext === 'epub') return await parseEpub(buffer, fileName);
      if (['mobi', 'azw', 'azw3', 'prc'].includes(ext)) return await parseMobi(buffer, fileName);
      if (ext === 'pdf') return await parsePdf(buffer, fileName);
      if (ext === 'cbz' || ext === 'zip') return await parseCbz(buffer, fileName);
      if (ext === 'fb2') return await parseFb2(buffer, fileName);
      if (ext === 'docx' || ext === 'doc') return await parseDocx(buffer, fileName);
      if (ext === 'odt') return await parseOdt(buffer, fileName);
      if (ext === 'rtf') return parseRtf(buffer, fileName);
      if (ext === 'md' || ext === 'markdown') return parseMarkdown(buffer, fileName);
      if (ext === 'srt' || ext === 'vtt') return parseSubtitleText(buffer, fileName);
      const rawTxt = new TextDecoder('utf-8').decode(buffer);
      const html = ext.startsWith('htm')
        ? rawTxt
        : rawTxt.split(/\r?\n\r?\n+/).map(p => `<p>${escapeHtml(p.trim())}</p>`).join('');
      return {
        title: fileName.replace(/\.[^.]+$/, ''),
        author: 'Texto',
        format: ext.startsWith('htm') ? 'HTML' : 'TXT',
        sections: [{ title: 'Documento', html, text: rawTxt }],
        toc: [{ label: 'Início', sectionIndex: 0, depth: 0 }]
      };
    }

    async function loadFile(file, options = {}) {
      if (!file) return;
      state.objectUrls.forEach(u => URL.revokeObjectURL(u));
      state.objectUrls = [];
      state.pdfDoc = null;
      state.currentFileBuffer = null;
      state.currentFileName = file.name;

      dom.statusLeft.textContent = `Carregando ${file.name}...`;
      // Permite a tela atualizar o aviso de carregamento antes de processar arquivos grandes no celular
      await new Promise(r => requestAnimationFrame(() => setTimeout(r, 0)));
      const ext = file.name.split('.').pop().toLowerCase();
      const buffer = file.arrayBuffer ? await file.arrayBuffer() : file.buffer;
      state.currentFileBuffer = buffer;

      try {
        const parsed = await parseAnyBookBuffer(buffer, file.name);
        if (ext === 'cbz' || ext === 'zip') {
          state.readingType = 'manga';
          state.mangaRtl = true;
        }

        if (ext !== 'cbz' && ext !== 'zip' && !state.readingType) {
          state.readingType = 'book';
          state.mangaRtl = false;
        }

        const byteSize = buffer.byteLength || file.size || 0;
        state.bookKey = `${file.name}_${byteSize}`;
        state.title = parsed.title;
        state.author = parsed.author;
        state.format = parsed.format;
        state.sections = parsed.sections;
        state.toc = parsed.toc;

        document.body.classList.remove('is-shelf-home');
        applySettings();
        const btnCloseShelfEl = document.getElementById('btnCloseShelf');
        if (btnCloseShelfEl) btnCloseShelfEl.classList.remove('hidden');
        const btnCloseBookShelfEl = document.getElementById('btnCloseBookShelf');
        if (btnCloseBookShelfEl) btnCloseBookShelfEl.classList.remove('hidden');

        const hist = JSON.parse(localStorage.getItem('reader_history') || '{}');
        const saved = hist[state.bookKey];
        let restoreOpts = {};
        if (saved && saved.currentIndex < parsed.sections.length) {
          state.currentIndex = saved.currentIndex;
          restoreOpts = {
            restoreSubPage: saved.subPageIndex || 0,
            restoreScrollRatio: saved.scrollRatio || 0
          };
          if (saved.currentIndex > 0 || saved.subPageIndex > 0 || saved.scrollRatio > 0.05) {
            showToast(`Retomando leitura de onde você parou (Seção ${saved.currentIndex + 1})`);
          }
        } else {
          state.currentIndex = 0;
        }

        dom.headerTitle.textContent = state.title;
        dom.headerMeta.textContent = `${state.author} · ${state.format}`;
        dom.statusLeft.textContent = `${state.format} · ${state.sections.length} seções`;

        dom.emptyState.classList.add('hidden');
        const subMediaBarEl = document.getElementById('subtitleMediaBar');
        if (subMediaBarEl) subMediaBarEl.classList.toggle('open', state.format === 'SRT' || state.format === 'VTT');
        const btnCoverPageEl = document.getElementById('btnSetPageAsCover');
        if (btnCoverPageEl) btnCoverPageEl.classList.toggle('hidden', state.format !== 'PDF' && state.format !== 'CBZ');
        renderToc();
        populateParallelSectionSelect();
        await renderSection(restoreOpts);
        if (typeof updateNextSeriesButtonUi === 'function') updateNextSeriesButtonUi();

        // Deferir gravação em IndexedDB e captura de capa para não competir com a 1ª página
        setTimeout(() => {
          if (parsed.metadata) {
            saveBookMetadata(state.bookKey, safeCloudFileName(file.name), parsed.metadata);
          }
          autoCaptureBookCover(state.bookKey, parsed).catch(() => {});
          if (!options.skipIdbSave) {
            idbSaveBook({
              bookKey: state.bookKey,
              fileName: file.name,
              title: state.title,
              author: state.author,
              format: state.format,
              size: byteSize,
              totalSections: state.sections.length,
              savedAt: Date.now(),
              buffer
            }).then(() => renderBookshelf()).catch(() => {});
          }
        }, 120);
      } catch (err) {
        alert('Erro ao abrir o livro: ' + err.message);
        dom.statusLeft.textContent = 'Falha ao abrir arquivo';
        console.error(err);
      }
    }

    // Eventos da Barra Superior, Seleção, Dicionário/Tradutor e Anki
    dom.fileInput.addEventListener('change', (e) => {
      const picked = e.target.files && e.target.files[0];
      e.target.value = '';
      if (picked) loadFile(picked);
    });

    document.getElementById('btnSidebar').addEventListener('click', () => {
      dom.sidebar.classList.toggle('hidden-sidebar');
      if (dom.viewport.classList.contains('paginated-mode')) {
        setTimeout(updatePaginatedMetrics, 200);
      }
    });

    document.getElementById('btnQuickSearch').addEventListener('click', () => {
      openSidebarTab('paneSearch');
      dom.inputSearch.focus();
      dom.inputSearch.select();
    });

    document.getElementById('btnOpenVocab').addEventListener('click', () => {
      openSidebarTab('paneVocab');
    });

    document.querySelectorAll('.sidebar-nav button').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.sidebar-nav button').forEach(b => b.classList.remove('active'));
        document.querySelectorAll('.sidebar-pane').forEach(p => p.classList.remove('active'));
        btn.classList.add('active');
        const targetPane = document.getElementById(btn.dataset.pane);
        if (targetPane) targetPane.classList.add('active');
        if (btn.dataset.pane === 'paneImages' && typeof renderImageGallery === 'function') {
          renderImageGallery();
        }
      });
    });

    // No modo Mangá (Direita -> Esquerda), invertemos as setas esquerda/direita para leitura japonesa natural
    document.getElementById('btnPrev').addEventListener('click', () => {
      if (state.mangaRtl) stepForward(); else stepBackward();
    });
    document.getElementById('btnNext').addEventListener('click', () => {
      if (state.mangaRtl) stepBackward(); else stepForward();
    });
    document.getElementById('btnSheetPrev').addEventListener('click', () => {
      if (state.mangaRtl) stepForward(); else stepBackward();
    });
    document.getElementById('btnSheetNext').addEventListener('click', () => {
      if (state.mangaRtl) stepBackward(); else stepForward();
    });
    document.getElementById('btnBookmark').addEventListener('click', toggleBookmark);
    document.getElementById('btnAddPageBookmark').addEventListener('click', toggleBookmark);

    dom.btnMangaRtl.addEventListener('click', () => {
      state.mangaRtl = !state.mangaRtl;
      applySettings();
      if (state.sections.length) renderSection({ restoreSubPage: state.subPageIndex });
      showToast(state.mangaRtl ? 'Modo Mangá Japonês: leitura da Direita para a Esquerda ativada' : 'Modo HQ Ocidental: leitura da Esquerda para a Direita ativada');
    });

    const btnMangaStripEl = document.getElementById('btnMangaStrip');
    if (btnMangaStripEl) {
      btnMangaStripEl.addEventListener('click', () => {
        state.webtoonStrip = !state.webtoonStrip;
        if (state.webtoonStrip) {
          state.flowMode = 'scroll-all';
          state.mangaRtl = false;
        }
        applySettings();
        if (state.sections.length) renderSection({ forceRebuildContinuous: true, restoreSubPage: 0 });
        showToast(state.webtoonStrip ? 'Modo Tira Vertical (Webtoon) ativado — imagens coladas em sequência!' : 'Modo Tira Vertical desativado.');
      });
    }

    const chkTapZonesEl = document.getElementById('chkTapZones');
    if (chkTapZonesEl) {
      chkTapZonesEl.addEventListener('change', () => {
        state.tapZones = chkTapZonesEl.checked;
        applySettings();
        showToast(state.tapZones ? 'Toque nas bordas para virar página ativado' : 'Toque nas bordas desativado');
      });
    }

    if (dom.viewport) {
      dom.viewport.addEventListener('click', (e) => {
        if (!state.tapZones || !state.sections.length) return;
        if (document.body.classList.contains('is-shelf-home')) return;
        if (dom.emptyState && !dom.emptyState.classList.contains('hidden')) return;
        if (e.target.closest('button, a, input, select, textarea, mark.user-hl, .entity-xray, .running-footer, .popover, .modal-backdrop')) return;
        const sel = window.getSelection && window.getSelection().toString();
        if (sel && sel.trim().length > 0) return;
        const rect = dom.viewport.getBoundingClientRect();
        if (!rect.width) return;
        const relX = (e.clientX - rect.left) / rect.width;
        if (relX <= 0.18) {
          if (state.mangaRtl) stepForward(); else stepBackward();
        } else if (relX >= 0.82) {
          if (state.mangaRtl) stepBackward(); else stepForward();
        }
      });

      let _swipeStartX = 0, _swipeStartY = 0, _swipeStartT = 0;
      dom.viewport.addEventListener('touchstart', (e) => {
        if (!e.touches || e.touches.length !== 1) return;
        _swipeStartX = e.touches[0].clientX;
        _swipeStartY = e.touches[0].clientY;
        _swipeStartT = Date.now();
      }, { passive: true });
      dom.viewport.addEventListener('touchend', (e) => {
        if (!state.sections.length || !e.changedTouches || !e.changedTouches.length) return;
        if (document.body.classList.contains('is-shelf-home')) return;
        if (dom.emptyState && !dom.emptyState.classList.contains('hidden')) return;
        if (Date.now() - _swipeStartT > 650) return;
        const dx = e.changedTouches[0].clientX - _swipeStartX;
        const dy = e.changedTouches[0].clientY - _swipeStartY;
        if (Math.abs(dx) < 55 || Math.abs(dx) < Math.abs(dy) * 1.6) return;
        const sel = window.getSelection && window.getSelection().toString();
        if (sel && sel.trim().length > 0) return;
        if (dx < 0) {
          if (state.mangaRtl) stepBackward(); else stepForward();
        } else {
          if (state.mangaRtl) stepForward(); else stepBackward();
        }
      }, { passive: true });
    }

    const inpWebtoonWidthEl = document.getElementById('inputWebtoonWidth');
    if (inpWebtoonWidthEl) {
      inpWebtoonWidthEl.addEventListener('input', () => {
        state.webtoonWidth = parseInt(inpWebtoonWidthEl.value, 10) || 100;
        applySettings();
      });
    }
    ['inputPdfContrast', 'inputPdfBrightness'].forEach(id => {
      const el = document.getElementById(id);
      if (el) {
        el.addEventListener('input', () => {
          state.pdfContrast = parseInt((document.getElementById('inputPdfContrast') || {}).value || '100', 10) || 100;
          state.pdfBrightness = parseInt((document.getElementById('inputPdfBrightness') || {}).value || '100', 10) || 100;
          applySettings();
        });
      }
    });

    function updateNextSeriesButtonUi() {
      const btn = document.getElementById('btnNextSeriesChapter');
      if (!btn) return;
      const q = state.seriesQueue;
      const hasNext = Boolean(q && Array.isArray(q.items) && q.index >= 0 && q.index + 1 < q.items.length);
      btn.classList.toggle('hidden', !hasNext);
      if (hasNext) {
        const nextItem = q.items[q.index + 1];
        btn.textContent = `Próximo: ${(nextItem.label || 'Capítulo').slice(0, 22)} →`;
        btn.title = `Carregar e abrir ${nextItem.label || 'próximo capítulo'}`;
      }
    }
    const btnNextSeriesEl = document.getElementById('btnNextSeriesChapter');
    if (btnNextSeriesEl) {
      btnNextSeriesEl.addEventListener('click', async () => {
        const q = state.seriesQueue;
        if (!q || q.index + 1 >= q.items.length || typeof q.openItem !== 'function') return;
        q.index += 1;
        updateNextSeriesButtonUi();
        await q.openItem(q.items[q.index], q.index);
      });
    }

    // Alternador separado entre Modo Livro e Modo Mangá
    const btnModeBookEl = document.getElementById('btnModeBook');
    const btnModeMangaEl = document.getElementById('btnModeManga');
    if (btnModeBookEl && btnModeMangaEl) {
      btnModeBookEl.addEventListener('click', () => {
        state.readingType = 'book';
        state.mangaRtl = false;
        applySettings();
        if (state.sections.length) renderSection({ restoreSubPage: state.subPageIndex });
        showToast('Modo Livro selecionado');
      });
      btnModeMangaEl.addEventListener('click', () => {
        state.readingType = 'manga';
        state.mangaRtl = true;
        state.pdfTint = false;
        if (typeof syncPdfTintUi === 'function') syncPdfTintUi();
        applySettings();
        if (state.sections.length) renderSection({ restoreSubPage: state.subPageIndex });
        showToast('Modo Mangá selecionado (Sentido Oriental D→E ativado)');
      });
    }

    // Menu suspenso organizado "Recursos ▾"
    const btnToolsMenuToggleEl = document.getElementById('btnToolsMenuToggle');
    const toolsDropdownEl = document.getElementById('toolsDropdown');
    if (btnToolsMenuToggleEl && toolsDropdownEl) {
      btnToolsMenuToggleEl.addEventListener('click', (e) => {
        e.stopPropagation();
        const isOpen = toolsDropdownEl.classList.toggle('open');
        dom.typoPopover.classList.remove('open');
        const userDd = document.getElementById('userProfileDropdown');
        if (userDd) userDd.classList.remove('open');
      });
      toolsDropdownEl.addEventListener('click', () => {
        toolsDropdownEl.classList.remove('open');
      });
      document.addEventListener('click', (e) => {
        if (!toolsDropdownEl.contains(e.target) && !e.target.closest('#btnToolsMenuToggle')) {
          toolsDropdownEl.classList.remove('open');
        }
      });
    }
    const btnMenuAnkiLoginEl = document.getElementById('btnMenuAnkiLogin');
    if (btnMenuAnkiLoginEl) {
      btnMenuAnkiLoginEl.addEventListener('click', () => {
        const modal = document.getElementById('ankiAccountModal');
        if (modal) {
          if (typeof loadAnkiConfigIntoUi === 'function') loadAnkiConfigIntoUi();
          modal.classList.add('open');
        }
      });
    }

    // Eventos da barra flutuante de seleção
    document.querySelectorAll('[data-hl-color]').forEach(btn => {
      btn.addEventListener('click', () => addTextHighlight(btn.dataset.hlColor));
    });
    document.getElementById('btnSelDict').addEventListener('click', () => openLookupModal('dict'));
    document.getElementById('btnSelTrans').addEventListener('click', () => openLookupModal('trans'));
    document.getElementById('btnSelAnki').addEventListener('click', () => openLookupModal('anki'));

    // Eventos do Modal de Dicionário / Tradutor / Anki
    document.getElementById('btnCloseModal').addEventListener('click', () => dom.lookupModal.classList.remove('open'));
    document.getElementById('btnModalCancel').addEventListener('click', () => dom.lookupModal.classList.remove('open'));
    document.getElementById('btnModalFetchDict').addEventListener('click', () => fetchDictionaryDefinition(dom.inputAnkiFront.value));
    document.getElementById('btnModalFetchTrans').addEventListener('click', () => fetchTranslation(dom.inputAnkiFront.value));
    dom.selectTargetLang.addEventListener('change', () => {
      if (dom.inputAnkiFront.value.trim()) fetchTranslation(dom.inputAnkiFront.value);
    });

    document.getElementById('btnExtDicio').addEventListener('click', () => {
      const w = dom.inputAnkiFront.value.trim().split(/\s+/)[0] || '';
      window.open(`https://www.dicio.com.br/pesquisa.php?q=${encodeURIComponent(w)}`, '_blank', 'noopener');
    });
    document.getElementById('btnExtWiktionary').addEventListener('click', () => {
      const w = dom.inputAnkiFront.value.trim().split(/\s+/)[0] || '';
      window.open(`https://pt.wiktionary.org/wiki/${encodeURIComponent(w)}`, '_blank', 'noopener');
    });
    document.getElementById('btnExtGoogleTrans').addEventListener('click', () => {
      const t = dom.inputAnkiFront.value.trim();
      const tl = dom.selectTargetLang.value || 'pt';
      window.open(`https://translate.google.com/?sl=auto&tl=${encodeURIComponent(tl)}&text=${encodeURIComponent(t)}&op=translate`, '_blank', 'noopener');
    });
    document.getElementById('btnExtDeepL').addEventListener('click', () => {
      const t = dom.inputAnkiFront.value.trim();
      const tl = dom.selectTargetLang.value || 'pt';
      window.open(`https://www.deepl.com/translator#auto/${encodeURIComponent(tl)}/${encodeURIComponent(t)}`, '_blank', 'noopener');
    });

    document.getElementById('btnModalSaveAnki').addEventListener('click', () => {
      const front = dom.inputAnkiFront.value.trim();
      if (!front) {
        alert('Informe a palavra ou frase na frente do cartão.');
        return;
      }
      const list = getVocabList();
      const secTitle = state.sections[state.currentIndex] ? state.sections[state.currentIndex].title : '';
      list.push({
        id: 'vc_' + Date.now(),
        front,
        back: dom.inputAnkiBack.value.trim(),
        context: dom.inputAnkiContext.value.trim(),
        book: state.title ? `${state.title}${secTitle ? ' · ' + secTitle : ''}` : 'Leitor Portátil',
        date: new Date().toLocaleDateString('pt-BR')
      });
      saveVocabList(list);
      dom.lookupModal.classList.remove('open');
      showToast('Salvo no Vocabulário Anki!');
    });

    document.getElementById('btnExportAnkiTsv').addEventListener('click', exportVocabForAnkiTsv);
    document.getElementById('btnExportVocabCsv').addEventListener('click', exportVocabCsv);
    document.getElementById('btnNewVocabCard').addEventListener('click', () => {
      state.selectedText = '';
      state.selectedContext = '';
      openLookupModal('manual');
    });

    dom.inputSectionNum.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && state.sections.length) {
        const val = parseInt(dom.inputSectionNum.value, 10);
        if (!isNaN(val)) {
          state.currentIndex = Math.max(0, Math.min(state.sections.length - 1, val - 1));
          renderSection();
        }
      }
    });

    // Controles de Tema, Modo de Fluxo e Tipografia
    document.querySelectorAll('[data-theme-val]').forEach(btn => {
      btn.addEventListener('click', () => {
        state.theme = btn.dataset.themeVal;
        applySettings();
      });
    });
    document.querySelectorAll('.book-theme-opt').forEach(btn => {
      btn.addEventListener('click', () => {
        state.bookTheme = btn.dataset.bookTheme;
        applySettings();
      });
    });
    document.querySelectorAll('[data-accent-val]').forEach(btn => {
      btn.addEventListener('click', () => {
        state.accentPreset = btn.dataset.accentVal;
        applySettings();
      });
    });
    document.querySelectorAll('.density-opt').forEach(btn => {
      btn.addEventListener('click', () => {
        state.shelfDensity = btn.dataset.density;
        applySettings();
      });
    });

    document.querySelectorAll('[data-flow]').forEach(btn => {
      btn.addEventListener('click', () => {
        state.flowMode = btn.dataset.flow;
        state.subPageIndex = 0;
        applySettings();
        renderSection({ forceRebuildContinuous: true });
      });
    });

    document.getElementById('btnTypography').addEventListener('click', (e) => {
      e.stopPropagation();
      const userDd = document.getElementById('userProfileDropdown');
      if (userDd) userDd.classList.remove('open');
      const toolsDd = document.getElementById('toolsDropdown');
      if (toolsDd) toolsDd.classList.remove('open');
      dom.typoPopover.classList.toggle('open');
    });
    document.addEventListener('click', (e) => {
      if (!dom.typoPopover.contains(e.target) && !e.target.closest('#btnTypography')) {
        dom.typoPopover.classList.remove('open');
      }
    });

    document.getElementById('btnFontDec').addEventListener('click', () => {
      state.fontSize = Math.max(12, state.fontSize - 1);
      applySettings();
    });
    document.getElementById('btnFontInc').addEventListener('click', () => {
      state.fontSize = Math.min(34, state.fontSize + 1);
      applySettings();
    });
    document.getElementById('btnFontReset').addEventListener('click', () => {
      state.fontSize = 18;
      applySettings();
    });

    dom.selectFontFamily.addEventListener('change', () => {
      state.fontFamily = dom.selectFontFamily.value;
      applySettings();
    });

    document.querySelectorAll('.line-opt').forEach(btn => {
      btn.addEventListener('click', () => {
        state.lineHeight = btn.dataset.lh;
        applySettings();
      });
    });
    document.querySelectorAll('.width-opt').forEach(btn => {
      btn.addEventListener('click', () => {
        state.maxWidth = btn.dataset.mw;
        applySettings();
      });
    });
    document.querySelectorAll('.align-opt').forEach(btn => {
      btn.addEventListener('click', () => {
        state.textAlign = btn.dataset.align;
        applySettings();
      });
    });

    function setOriginalFormatMode(enabled) {
      state.originalFormat = Boolean(enabled);
      state.sections.forEach(s => {
        if (s.buildHtml && s.rawSlice !== undefined) s.html = null;
      });
      applySettings();
      if (state.sections.length) renderSection({ forceRebuildContinuous: true, restoreSubPage: state.subPageIndex });
      showToast(state.originalFormat ? 'Formatação Original do Livro ativada' : 'Formatação Adaptada ativada');
    }
    document.getElementById('btnStyleAdapted').addEventListener('click', () => setOriginalFormatMode(false));
    document.getElementById('btnStyleOriginal').addEventListener('click', () => setOriginalFormatMode(true));

    function setTextOrientationMode(mode) {
      state.textOrientation = mode;
      localStorage.setItem('reader_textOrientation', mode);
      applySettings();
      showToast(mode === 'vertical' ? 'Leitura Vertical (縦書き Tate-gaki CJK) ativada' : 'Leitura Horizontal padrão ativada');
    }
    const btnOrientH = document.getElementById('btnTextOrientHorizontal');
    const btnOrientV = document.getElementById('btnTextOrientVertical');
    if (btnOrientH) btnOrientH.addEventListener('click', () => setTextOrientationMode('horizontal'));
    if (btnOrientV) btnOrientV.addEventListener('click', () => setTextOrientationMode('vertical'));

    // Controles de PDF
    document.getElementById('btnZoomOut').addEventListener('click', () => {
      state.pdfScale = Math.max(0.6, +(state.pdfScale - 0.15).toFixed(2));
      dom.lblZoom.textContent = Math.round((state.pdfScale / 1.35) * 100) + '%';
      renderSection();
    });
    document.getElementById('btnZoomIn').addEventListener('click', () => {
      state.pdfScale = Math.min(3.0, +(state.pdfScale + 0.15).toFixed(2));
      dom.lblZoom.textContent = Math.round((state.pdfScale / 1.35) * 100) + '%';
      renderSection();
    });
    dom.btnPdfViewMode.addEventListener('click', () => {
      state.pdfViewMode = state.pdfViewMode === 'canvas' ? 'reflow' : 'canvas';
      dom.btnPdfViewMode.textContent = state.pdfViewMode === 'canvas' ? 'PDF: Original' : 'PDF: Modo Texto';
      renderSection();
    });
    function syncPdfTintUi() {
      dom.btnPdfTint.classList.toggle('active', state.pdfTint);
      const tbBtn = document.getElementById('btnPdfTintToolbar');
      const isMangaMode = state.readingType === 'manga' || state.format === 'CBZ';
      if (tbBtn) {
        tbBtn.classList.toggle('hidden', isMangaMode);
        tbBtn.classList.toggle('active', state.pdfTint);
        tbBtn.textContent = state.pdfTint ? 'Fundo do PDF: Escuro' : 'Fundo do PDF: Original';
        tbBtn.title = 'Inverte o fundo branco de PDFs de livros de texto para escuro ou sépia (desativado em Mangás para preservar a arte)';
      }
      const shouldTint = Boolean(state.pdfTint && !isMangaMode);
      dom.pdfContainer.classList.toggle('tint-pdf', shouldTint);
      const c2 = document.getElementById('pdfContainer2');
      if (c2) c2.classList.toggle('tint-pdf', shouldTint);
    }

    function togglePdfTintMode() {
      if (state.readingType === 'manga') {
        state.pdfTint = false;
        syncPdfTintUi();
        showToast('No Modo Mangá as páginas mantêm a arte original sem inversão de cores');
        return;
      }
      state.pdfTint = !state.pdfTint;
      state.forcePdfTintOnImages = state.pdfTint;
      syncPdfTintUi();
      showToast(state.pdfTint ? 'Fundo escuro para PDF de texto ativado' : 'Fundo original do PDF restaurado');
    }

    dom.btnPdfTint.addEventListener('click', togglePdfTintMode);
    const btnPdfTintToolbarEl = document.getElementById('btnPdfTintToolbar');
    if (btnPdfTintToolbarEl) btnPdfTintToolbarEl.addEventListener('click', togglePdfTintMode);

    // Busca e Barra de Progresso
    document.getElementById('btnRunSearch').addEventListener('click', runBookSearch);
    dom.inputSearch.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') runBookSearch();
    });

    dom.progressTrack.addEventListener('click', (e) => {
      if (!state.sections.length) return;
      const r = dom.progressTrack.getBoundingClientRect();
      const ratio = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width));
      state.currentIndex = Math.floor(ratio * (state.sections.length - 1));
      renderSection();
    });

    // Drag & Drop
    window.addEventListener('dragover', (e) => {
      e.preventDefault();
      dom.emptyState.classList.add('dragover');
    });
    window.addEventListener('dragleave', () => {
      dom.emptyState.classList.remove('dragover');
    });
    window.addEventListener('drop', (e) => {
      e.preventDefault();
      dom.emptyState.classList.remove('dragover');
      if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0]) {
        loadFile(e.dataTransfer.files[0]);
      }
    });

    // Atalhos de Teclado
    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        const qrM = document.getElementById('qrCodeModal');
        if (qrM && qrM.classList.contains('open')) {
          qrM.classList.remove('open');
          return;
        }
        dom.lookupModal.classList.remove('open');
        dom.selectionToolbar.classList.remove('open');
        dom.typoPopover.classList.remove('open');
        const td = document.getElementById('toolsDropdown');
        if (td) td.classList.remove('open');
        document.getElementById('toolsModal').classList.remove('open');
        document.getElementById('cloudModal').classList.remove('open');
        document.getElementById('coverModal').classList.remove('open');
        const ankiMod = document.getElementById('ankiAccountModal');
        if (ankiMod) ankiMod.classList.remove('open');
        const flipMod = document.getElementById('pageFlipModal');
        if (flipMod) flipMod.classList.remove('open');
        const profMod = document.getElementById('profileModal');
        if (profMod) profMod.classList.remove('open');
        const userDd = document.getElementById('userProfileDropdown');
        if (userDd) userDd.classList.remove('open');
        const catModEl = document.getElementById('catalogDetailModal');
        if (catModEl && catModEl.classList.contains('open')) {
          catModEl.classList.remove('open');
          return;
        }
        document.getElementById('bookInfoModal').classList.remove('open');
        document.getElementById('imgLightbox').classList.remove('open');
        if (state.sections.length > 0 && !dom.emptyState.classList.contains('hidden')) {
          dom.emptyState.classList.add('hidden');
        }
        return;
      }
      if ((e.ctrlKey || e.metaKey) && (e.key === 'f' || e.key === 'F')) {
        e.preventDefault();
        openSidebarTab('paneSearch');
        dom.inputSearch.focus();
        dom.inputSearch.select();
        return;
      }
      if ((e.ctrlKey || e.metaKey) && (e.key === 'd' || e.key === 'D')) {
        e.preventDefault();
        toggleBookmark();
        return;
      }
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT' || e.target.tagName === 'TEXTAREA') return;
      if (dom.emptyState && !dom.emptyState.classList.contains('hidden')) return;
      if (e.key === 'ArrowLeft') {
        e.preventDefault();
        if (state.mangaRtl) stepForward(); else stepBackward();
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        if (state.mangaRtl) stepBackward(); else stepForward();
      } else if (e.key === 't' || e.key === 'T') {
        dom.sidebar.classList.toggle('hidden-sidebar');
        if (dom.viewport.classList.contains('paginated-mode')) setTimeout(updatePaginatedMetrics, 200);
      } else if (e.key === '+' || e.key === '=') {
        if (state.format === 'PDF' && state.pdfViewMode === 'canvas') document.getElementById('btnZoomIn').click();
        else { state.fontSize = Math.min(34, state.fontSize + 1); applySettings(); }
      } else if (e.key === '-') {
        if (state.format === 'PDF' && state.pdfViewMode === 'canvas') document.getElementById('btnZoomOut').click();
        else { state.fontSize = Math.max(12, state.fontSize - 1); applySettings(); }
      }
    });

    /* =====================================================================
     * 9. ESTANTE LOCAL DE LIVROS (INDEXEDDB) + ABRIR POR LINK URL
     * ===================================================================== */
    function idbOpen() {
      return new Promise((resolve, reject) => {
        if (!window.indexedDB) return reject(new Error('IndexedDB indisponível'));
        const req = indexedDB.open('reader_library_db', 1);
        req.onupgradeneeded = (e) => {
          const db = e.target.result;
          if (!db.objectStoreNames.contains('books')) {
            db.createObjectStore('books', { keyPath: 'bookKey' });
          }
        };
        req.onsuccess = (e) => resolve(e.target.result);
        req.onerror = (e) => reject(e.target.error);
      });
    }

    async function idbSaveBook(bookObj) {
      const db = await idbOpen();
      return new Promise((resolve, reject) => {
        const tx = db.transaction('books', 'readwrite');
        tx.objectStore('books').put(bookObj);
        tx.oncomplete = () => resolve(true);
        tx.onerror = (e) => reject(e.target.error);
      });
    }

    async function idbGetAllBooks() {
      try {
        const db = await idbOpen();
        return await new Promise((resolve, reject) => {
          const tx = db.transaction('books', 'readonly');
          const req = tx.objectStore('books').getAll();
          req.onsuccess = () => resolve(req.result || []);
          req.onerror = (e) => reject(e.target.error);
        });
      } catch {
        return [];
      }
    }

    async function idbGetBook(bookKey) {
      const db = await idbOpen();
      return new Promise((resolve, reject) => {
        const tx = db.transaction('books', 'readonly');
        const req = tx.objectStore('books').get(bookKey);
        req.onsuccess = () => resolve(req.result || null);
        req.onerror = (e) => reject(e.target.error);
      });
    }

    async function idbDeleteBook(bookKey) {
      const db = await idbOpen();
      return new Promise((resolve, reject) => {
        const tx = db.transaction('books', 'readwrite');
        tx.objectStore('books').delete(bookKey);
        tx.oncomplete = () => resolve(true);
        tx.onerror = (e) => reject(e.target.error);
      });
    }

    function safeCloudFileName(name) {
      return String(name || 'livro.epub').replace(/[^a-zA-Z0-9._-]/g, '_');
    }

    function getCloudCatalogMap() {
      try { return JSON.parse(localStorage.getItem('reader_cloud_catalog') || '{}'); }
      catch { return {}; }
    }

    function saveCloudCatalogEntry(safeName, meta) {
      if (!safeName || !meta) return;
      const cat = getCloudCatalogMap();
      cat[safeName] = { ...(cat[safeName] || {}), ...meta, safeFileName: safeName, updatedAt: Date.now() };
      localStorage.setItem('reader_cloud_catalog', JSON.stringify(cat));
    }

    let cachedCloudFilesList = [];

    function getBookMetadataMap() {
      try { return JSON.parse(localStorage.getItem('reader_book_metadata') || '{}'); }
      catch { return {}; }
    }

    function saveBookMetadata(bookKey, safeName, metaObj) {
      const map = getBookMetadataMap();
      const merged = { ...(map[bookKey] || {}), ...(safeName ? (map['safe_' + safeName] || {}) : {}), ...metaObj, updatedAt: Date.now() };
      if (bookKey) map[bookKey] = merged;
      if (safeName) map['safe_' + safeName] = merged;
      try { localStorage.setItem('reader_book_metadata', JSON.stringify(map)); } catch {}
      return merged;
    }

    function getBookFavoritesMap() {
      try { return JSON.parse(localStorage.getItem('reader_book_favorites') || '{}'); }
      catch { return {}; }
    }

    function isBookFavorite(bookKey, safeName) {
      const favs = getBookFavoritesMap();
      return Boolean(favs[bookKey] || (safeName && favs['safe_' + safeName]));
    }

    function toggleBookFavorite(bookKey, safeName) {
      const favs = getBookFavoritesMap();
      const next = !isBookFavorite(bookKey, safeName);
      if (bookKey) favs[bookKey] = next;
      if (safeName) favs['safe_' + safeName] = next;
      localStorage.setItem('reader_book_favorites', JSON.stringify(favs));
      if (typeof pushCloudSyncSilent === 'function') pushCloudSyncSilent();
      return next;
    }

    function getBookStatusValue(bookKey, title) {
      const revMap = getBookReviewsMap();
      const r = revMap[bookKey] || Object.values(revMap).find(x => x.title === title);
      return (r && r.status) || 'reading';
    }

    function setBookStatusValue(bookObj, newStatus) {
      const revMap = getBookReviewsMap();
      const cur = revMap[bookObj.bookKey] || { title: bookObj.title, author: bookObj.author || '', rating: 0, reviewText: '' };
      cur.status = newStatus;
      cur.date = new Date().toLocaleDateString('pt-BR');
      cur.updatedAt = Date.now();
      revMap[bookObj.bookKey] = cur;
      saveBookReviewsMap(revMap);
    }

    let activeShelfTab = 'all';
    document.querySelectorAll('[data-shelf-tab]').forEach(btn => {
      btn.addEventListener('click', () => {
        activeShelfTab = btn.dataset.shelfTab || 'all';
        document.querySelectorAll('[data-shelf-tab]').forEach(b => b.classList.toggle('active', b === btn));
        renderBookshelf(document.getElementById('inputFilterShelf') ? document.getElementById('inputFilterShelf').value : '');
      });
    });

    async function computeBufferSha1(buffer) {
      if (!buffer || !window.crypto || !window.crypto.subtle) return '';
      try {
        const digest = await crypto.subtle.digest('SHA-1', buffer);
        return Array.from(new Uint8Array(digest)).map(b => b.toString(16).padStart(2, '0')).join('');
      } catch { return ''; }
    }

    let activeBookInfoTarget = null;
    async function openBookInfoModal(bookObj) {
      activeBookInfoTarget = bookObj;
      const modal = document.getElementById('bookInfoModal');
      if (!modal) return;
      const hist = JSON.parse(localStorage.getItem('reader_history') || '{}');
      const h = hist[bookObj.bookKey] || Object.values(hist).find(x => x.title && bookObj.title && x.title.toLowerCase() === bookObj.title.toLowerCase());
      const revMap = getBookReviewsMap();
      const rev = revMap[bookObj.bookKey] || {};
      const metaMap = getBookMetadataMap();
      let meta = metaMap[bookObj.bookKey] || (bookObj.safeName && metaMap['safe_' + bookObj.safeName]) || {};

      // Se ainda não tiver SHA-1/metadados locais e o buffer estiver disponível, extrair na hora
      if (bookObj.buffer && !meta.sha1) {
        const sha1 = await computeBufferSha1(bookObj.buffer);
        meta = saveBookMetadata(bookObj.bookKey, bookObj.safeName, { sha1 });
      }

      const coverDataUrl = getBookCoverDataUrl(bookObj.bookKey, bookObj.safeName);
      const coverBox = document.getElementById('infoCoverBox');
      coverBox.innerHTML = coverDataUrl
        ? `<img src="${coverDataUrl}" alt="Capa" style="width:100%; height:100%; object-fit:cover;" />`
        : `<span>${escapeHtml(bookObj.format || 'LIVRO')}</span>`;
      coverBox.onclick = () => openCoverModalForBook(bookObj);

      document.getElementById('infoBookTitle').textContent = bookObj.title || 'Livro';
      document.getElementById('infoBookAuthor').textContent = bookObj.author || 'Autor desconhecido';
      if (typeof renderBookClubReviewsBox === 'function') {
        renderBookClubReviewsBox(bookObj);
      }

      const favBtn = document.getElementById('btnInfoFavToggle');
      const syncFavBtn = () => {
        const fav = isBookFavorite(bookObj.bookKey, bookObj.safeName);
        favBtn.textContent = fav ? '★ Favorito' : '☆ Favoritar';
        favBtn.classList.toggle('primary', fav);
      };
      syncFavBtn();
      favBtn.onclick = () => {
        toggleBookFavorite(bookObj.bookKey, bookObj.safeName);
        syncFavBtn();
        renderBookshelf(document.getElementById('inputFilterShelf') ? document.getElementById('inputFilterShelf').value : '');
      };

      const stSel = document.getElementById('selectInfoBookStatus');
      stSel.value = rev.status || 'reading';
      stSel.onchange = () => {
        setBookStatusValue(bookObj, stSel.value);
        renderBookshelf(document.getElementById('inputFilterShelf') ? document.getElementById('inputFilterShelf').value : '');
        showToast('Status de leitura atualizado!');
      };

      // Estrelas dentro da Ficha do Livro
      const starRow = document.getElementById('infoStarRow');
      const renderInfoStars = (val) => {
        starRow.innerHTML = '';
        for (let s = 1; s <= 5; s++) {
          const sb = document.createElement('button');
          sb.type = 'button';
          sb.className = 'star-btn' + (s <= val ? ' filled' : '');
          sb.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="1.5"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>';
          sb.onclick = () => {
            const cur = revMap[bookObj.bookKey] || { title: bookObj.title, author: bookObj.author || '', status: stSel.value, reviewText: '' };
            cur.rating = s;
            cur.date = new Date().toLocaleDateString('pt-BR');
            cur.updatedAt = Date.now();
            revMap[bookObj.bookKey] = cur;
            saveBookReviewsMap(revMap);
            renderInfoStars(s);
            renderBookshelf(document.getElementById('inputFilterShelf') ? document.getElementById('inputFilterShelf').value : '');
            showToast(`Nota ${s}/5 salva!`);
          };
          starRow.appendChild(sb);
        }
      };
      renderInfoStars(rev.rating || 0);

      const langNames = { pt: 'Português', 'pt-br': 'Português (BR)', en: 'Inglês', es: 'Espanhol', fr: 'Francês', de: 'Alemão', ja: 'Japonês', it: 'Italiano' };
      const rawLang = (meta.language || '').toLowerCase();
      document.getElementById('infoMetaLanguage').textContent = langNames[rawLang] || meta.language || 'Não informado';
      document.getElementById('infoMetaPublisher').textContent = [meta.publisher, meta.year, meta.isbn ? 'ISBN ' + meta.isbn : ''].filter(Boolean).join(' · ') || 'Não informado';

      const pct = h ? Math.round(((h.currentIndex + 1) / Math.max(1, h.total || bookObj.totalSections || 1)) * 100) : 0;
      const lastDate = h && h.updatedAt ? new Date(h.updatedAt).toLocaleString('pt-BR') : 'Não iniciado';
      document.getElementById('infoMetaProgress').textContent = `${pct}% · ${lastDate}`;
      const sizeStr = bookObj.size ? (bookObj.size > 1048576 ? (bookObj.size / 1048576).toFixed(2) + ' MB' : Math.round(bookObj.size / 1024) + ' KB') : 'Nuvem';
      document.getElementById('infoMetaFormatSize').textContent = `${bookObj.format || 'LIVRO'} · ${sizeStr}`;
      document.getElementById('infoMetaFileHash').textContent = `${bookObj.fileName || ''}${meta.sha1 ? ' · SHA-1: ' + meta.sha1 : ''}`;

      document.getElementById('infoMetaDescription').textContent = meta.description || 'Nenhuma sinopse extraída ainda. Clique em "Extrair do Arquivo & Buscar Online" acima.';
      document.getElementById('inputInfoBookReview').value = rev.reviewText || '';
      const groupInput = document.getElementById('inputInfoCustomGroup');
      const groupDl = document.getElementById('customBookGroupsDatalist');
      if (groupDl) {
        groupDl.innerHTML = '';
        getAllCustomBookGroupNames(metaMap).forEach(gn => {
          const opt = document.createElement('option');
          opt.value = gn;
          groupDl.appendChild(opt);
        });
      }
      if (groupInput) groupInput.value = meta.customGroup || '';
      const btnSaveGrp = document.getElementById('btnSaveInfoCustomGroup');
      if (btnSaveGrp) {
        btnSaveGrp.onclick = () => {
          const val = (groupInput ? groupInput.value : '').trim();
          saveBookMetadata(bookObj.bookKey, bookObj.safeName, { customGroup: val });
          if (val && !state.groupShelfSeries) {
            state.groupShelfSeries = true;
            if (typeof applySettings === 'function') applySettings();
          }
          if (typeof pushCloudSyncSilent === 'function') pushCloudSyncSilent();
          document.getElementById('lblBookInfoStatus').textContent = val ? `Adicionado ao grupo "${val}"!` : 'Grupo removido.';
          renderBookshelf(document.getElementById('inputFilterShelf') ? document.getElementById('inputFilterShelf').value : '');
          showToast(val ? `Livro salvo no grupo "${val}"!` : 'Livro removido do grupo.');
        };
      }
      const btnClearGrp = document.getElementById('btnClearInfoCustomGroup');
      if (btnClearGrp) {
        btnClearGrp.onclick = () => {
          if (groupInput) groupInput.value = '';
          saveBookMetadata(bookObj.bookKey, bookObj.safeName, { customGroup: '' });
          if (typeof pushCloudSyncSilent === 'function') pushCloudSyncSilent();
          document.getElementById('lblBookInfoStatus').textContent = 'Livro removido do grupo personalizado.';
          renderBookshelf(document.getElementById('inputFilterShelf') ? document.getElementById('inputFilterShelf').value : '');
          showToast('Livro removido do grupo.');
        };
      }
      document.getElementById('lblBookInfoStatus').textContent = 'Pronto.';

      document.getElementById('btnInfoReadNow').onclick = async () => {
        modal.classList.remove('open');
        if (bookObj.isLocal && bookObj.buffer) {
          loadFile({ name: bookObj.fileName, size: bookObj.size, buffer: bookObj.buffer }, { skipIdbSave: true });
        } else {
          await downloadAndOpenCloudBook(bookObj.safeName, bookObj.fileName);
        }
      };
      document.getElementById('btnInfoEditCover').onclick = () => openCoverModalForBook(bookObj);
      document.getElementById('btnInfoSendCloud').onclick = () => uploadBookRecordToCloud(bookObj);

      modal.classList.add('open');
    }

    document.getElementById('btnCloseBookInfoModal').addEventListener('click', () => {
      document.getElementById('bookInfoModal').classList.remove('open');
    });

    document.getElementById('btnSaveInfoBookReview').addEventListener('click', () => {
      if (!activeBookInfoTarget) return;
      const revMap = getBookReviewsMap();
      const cur = revMap[activeBookInfoTarget.bookKey] || { title: activeBookInfoTarget.title, author: activeBookInfoTarget.author || '', rating: 0 };
      cur.status = document.getElementById('selectInfoBookStatus').value;
      cur.reviewText = document.getElementById('inputInfoBookReview').value.trim();
      cur.date = new Date().toLocaleDateString('pt-BR');
      cur.updatedAt = Date.now();
      revMap[activeBookInfoTarget.bookKey] = cur;
      saveBookReviewsMap(revMap);
      document.getElementById('lblBookInfoStatus').textContent = 'Resenha salva!';
      if (typeof pushPublicClubProfile === 'function') pushPublicClubProfile().catch(() => {});
      showToast('Resenha salva no livro!');
    });

    function buildBookStudyDossierMarkdown(bookObj, highlights = [], notes = [], review = {}) {
      const title = (bookObj && bookObj.title) || 'Livro';
      const author = (bookObj && bookObj.author) || 'Autor desconhecido';
      const lines = [
        `# Dossiê de Estudo — ${title}`,
        `**Autor:** ${author}`,
        `**Gerado em:** ${new Date().toLocaleString('pt-BR')}`,
        ''
      ];
      if (review && (review.rating || review.text)) {
        lines.push('## Resenha & Avaliação');
        if (review.rating) lines.push(`- **Nota:** ${'★'.repeat(review.rating)}${'☆'.repeat(5 - review.rating)} (${review.rating}/5)`);
        if (review.text) lines.push('', review.text.trim());
        lines.push('');
      }
      if (Array.isArray(highlights) && highlights.length) {
        lines.push(`## Marcações & Destaques (${highlights.length})`);
        highlights.forEach((hl, i) => {
          const quote = (hl.text || hl.quote || '').trim();
          const note = (hl.note || '').trim();
          lines.push(`${i + 1}. "${quote}"${note ? ` — *Nota: ${note}*` : ''}`);
        });
        lines.push('');
      }
      if (Array.isArray(notes) && notes.length) {
        lines.push(`## Notas & Fichamento (${notes.length})`);
        notes.forEach((n, i) => {
          lines.push(`- **${n.name || n.title || `Nota ${i + 1}`}**: ${n.note || n.text || ''}`);
        });
        lines.push('');
      }
      try {
        const cMap = JSON.parse(localStorage.getItem('reader_cornell_notes') || '{}');
        const cn = bookObj && bookObj.bookKey ? cMap[bookObj.bookKey] : null;
        if (cn && (cn.cues || cn.notes || cn.summary)) {
          lines.push('## Notas no Método Cornell');
          if (cn.cues) lines.push('### Palavras-chave / Perguntas', cn.cues.trim(), '');
          if (cn.notes) lines.push('### Anotações Principais', cn.notes.trim(), '');
          if (cn.summary) lines.push('### Resumo', cn.summary.trim(), '');
        }
      } catch {}
      if (!highlights.length && !notes.length && !(review && review.text)) {
        lines.push('_Nenhum destaque, nota ou resenha registrada para este livro ainda._');
      }
      return lines.join('\n');
    }

    const btnExportDossierEl = document.getElementById('btnExportBookStudyDossier');
    if (btnExportDossierEl) {
      btnExportDossierEl.addEventListener('click', () => {
        if (!activeBookInfoTarget) return;
        const bk = activeBookInfoTarget.bookKey;
        const hlMap = getHighlightsMap();
        const highlights = Array.isArray(hlMap[bk]) ? hlMap[bk] : [];
        const notes = typeof getEntityNotesMap === 'function' ? Object.values(getEntityNotesMap(bk) || {}) : [];
        const rev = (getBookReviewsMap()[bk] || {});
        const md = buildBookStudyDossierMarkdown(activeBookInfoTarget, highlights, notes, rev);
        const safe = (activeBookInfoTarget.title || 'dossie').replace(/[^a-z0-9_-]/gi, '_').slice(0, 60);
        const blob = new Blob([md], { type: 'text/markdown;charset=utf-8' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = `Dossie_${safe}.md`;
        a.click();
        setTimeout(() => URL.revokeObjectURL(a.href), 1500);
        showToast('Dossiê de Estudo (.md) exportado!');
      });
    }

    document.getElementById('btnInfoExtractMetadata').addEventListener('click', async () => {
      if (!activeBookInfoTarget) return;
      const st = document.getElementById('lblBookInfoStatus');
      st.textContent = 'Extraindo metadados do arquivo e buscando sinopse/informações online...';
      let collected = {};
      if (activeBookInfoTarget.buffer) {
        try {
          const parsed = await parseAnyBookBuffer(activeBookInfoTarget.buffer, activeBookInfoTarget.fileName);
          if (parsed && parsed.metadata) collected = { ...parsed.metadata };
          collected.sha1 = await computeBufferSha1(activeBookInfoTarget.buffer);
          if (!getBookCoverDataUrl(activeBookInfoTarget.bookKey, activeBookInfoTarget.safeName) && parsed.coverUrl) {
            const thumb = await resizeImageSrcToCoverThumb(parsed.coverUrl, 260, 390);
            if (thumb) saveBookCoverDataUrl(activeBookInfoTarget.bookKey, activeBookInfoTarget.safeName, thumb);
          }
        } catch {}
      }
      // Enriquecer online via Google Books API (sinopse, editora, ano, idioma, capa)
      try {
        const q = `${activeBookInfoTarget.title || ''} ${activeBookInfoTarget.author && activeBookInfoTarget.author !== 'Salvo na Nuvem' ? activeBookInfoTarget.author : ''}`.trim();
        const gbRes = await fetch(`https://www.googleapis.com/books/v1/volumes?q=${encodeURIComponent(q)}&maxResults=1`).catch(() => null);
        if (gbRes && gbRes.ok) {
          const gbJson = await gbRes.json();
          const vi = gbJson.items && gbJson.items[0] && gbJson.items[0].volumeInfo;
          if (vi) {
            if (!collected.description && vi.description) collected.description = vi.description;
            if (!collected.publisher && vi.publisher) collected.publisher = vi.publisher;
            if (!collected.year && vi.publishedDate) collected.year = (vi.publishedDate.match(/\d{4}/) || [''])[0];
            if (!collected.language && vi.language) collected.language = vi.language;
            if (!getBookCoverDataUrl(activeBookInfoTarget.bookKey, activeBookInfoTarget.safeName) && vi.imageLinks && vi.imageLinks.thumbnail) {
              const cUrl = vi.imageLinks.thumbnail.replace(/^http:/, 'https:').replace('&edge=curl', '');
              const thumb = await resizeImageSrcToCoverThumb(cUrl, 260, 390);
              saveBookCoverDataUrl(activeBookInfoTarget.bookKey, activeBookInfoTarget.safeName, thumb || cUrl);
            }
          }
        }
      } catch {}
      saveBookMetadata(activeBookInfoTarget.bookKey, activeBookInfoTarget.safeName, collected);
      if (typeof pushCloudSyncSilent === 'function') pushCloudSyncSilent();
      await openBookInfoModal(activeBookInfoTarget);
      document.getElementById('lblBookInfoStatus').textContent = 'Informações e sinopse atualizadas!';
      showToast('Metadados do livro extraídos!');
    });

    async function getUnifiedShelfBooks() {
      const localBooks = await idbGetAllBooks().catch(() => []);
      const cloudCat = getCloudCatalogMap();
      const unified = [];
      const seenSafeNames = new Set();
      const seenBookKeys = new Set();

      const getCloudShortTag = (cf) => {
        const prov = cf && cf._bankProfile && cf._bankProfile.provider;
        if (prov === 'gdrive') return 'GDRIVE';
        if (prov === 'onedrive') return 'ONEDRIVE';
        if (prov === 'supabase') return 'SUPABASE';
        return (cf && cf._bankName ? String(cf._bankName).split(' ')[0].toUpperCase() : 'NUVEM');
      };

      localBooks.forEach(b => {
        const safeName = safeCloudFileName(b.fileName || `${b.title}.epub`);
        seenSafeNames.add(safeName);
        seenBookKeys.add(b.bookKey);
        const cloudMatches = cachedCloudFilesList.filter(cf => cf.name === safeName);
        const inCloud = cloudMatches.length > 0;
        const cloudProviders = Array.from(new Set(cloudMatches.map(getCloudShortTag)));
        unified.push({ ...b, safeName, isLocal: true, inCloud, cloudProviders, cloudSources: cloudMatches });
      });

      cachedCloudFilesList.forEach(cf => {
        if (!cf || !cf.name || cf.name.startsWith('_reader_sync') || cf.name.startsWith('_shared_')) return;
        const meta = cloudCat[cf.name] || {};
        if (seenSafeNames.has(cf.name) || (meta.bookKey && seenBookKeys.has(meta.bookKey))) return;
        seenSafeNames.add(cf.name);
        const cloudMatches = cachedCloudFilesList.filter(x => x.name === cf.name);
        const cloudProviders = Array.from(new Set(cloudMatches.map(getCloudShortTag)));
        const fallbackTitle = meta.title || cf.name.replace(/\.[^.]+$/, '').replace(/_/g, ' ');
        const ext = (cf.name.split('.').pop() || 'LIVRO').toUpperCase();
        unified.push({
          bookKey: meta.bookKey || `${cf.name}_cloud`,
          fileName: meta.originalFileName || cf.name,
          safeName: cf.name,
          title: fallbackTitle,
          author: meta.author || (cf._bankName ? `Nuvem (${cf._bankName})` : 'Salvo na Nuvem'),
          format: meta.format || ext,
          size: meta.size || (cf.metadata && cf.metadata.size) || 0,
          totalSections: meta.total || 1,
          savedAt: meta.updatedAt || (cf.updated_at ? Date.parse(cf.updated_at) : Date.now()),
          isLocal: false,
          inCloud: true,
          cloudProviders,
          cloudSources: cloudMatches,
          _bankId: cf._bankId || '',
          _bankName: cf._bankName || '',
          _bankProfile: cf._bankProfile || null
        });
      });
      return unified;
    }

    const __natCollator = typeof Intl !== 'undefined' ? new Intl.Collator('pt-BR', { numeric: true, sensitivity: 'base' }) : null;
    function naturalCompareTitles(a, b) {
      const sa = String(a || '');
      const sb = String(b || '');
      return __natCollator ? __natCollator.compare(sa, sb) : sa.localeCompare(sb, 'pt-BR');
    }

    function extractBookSeriesName(rawTitle) {
      let s = String(rawTitle || '').trim();
      s = s.replace(/\.(epub|pdf|cbz|mobi|azw3|fb2|txt|md)$/i, '');
      s = s.replace(/\s*[—–-]\s*(?:Vol\.?|Volume|Cap\.?|Capítulo|Chapter|Ep\.?|Episódio)\s*\d+.*$/i, '');
      s = s.replace(/\s+(?:Vol\.?|Volume|Cap\.?|Capítulo|Chapter|Ep\.?|Episódio|Pt\.?|Part|Tomo|Livro)\s*\d+.*$/i, '');
      s = s.replace(/\s*#\s*\d+.*$/i, '');
      s = s.replace(/\s*\(\d{4}\)\s*$/i, '');
      s = s.replace(/[_]+/g, ' ').replace(/\s+/g, ' ').trim();
      return s || String(rawTitle || 'Série').trim();
    }

    function getEffectiveBookGroupName(book, metaMap = {}) {
      const m = metaMap || {};
      const entry = (book && book.bookKey && m[book.bookKey]) || (book && book.safeName && m['safe_' + book.safeName]) || {};
      const custom = (entry.customGroup || '').trim();
      if (custom) return { name: custom, isCustom: true };
      return { name: extractBookSeriesName(book ? book.title : ''), isCustom: false };
    }

    function getAllCustomBookGroupNames(metaMap = {}) {
      const set = new Set();
      Object.values(metaMap || {}).forEach(m => {
        const g = (m && m.customGroup || '').trim();
        if (g) set.add(g);
      });
      return Array.from(set).sort((a, b) => a.localeCompare(b, 'pt-BR'));
    }

    function computeShelfProfileStats({ unified, hist, revMap, favs, insights, bms, kindleHist, activeState }) {
      const counts = {
        readCount: 0,
        readingCount: 0,
        wishlistCount: 0,
        rereadingCount: 0,
        abandonedCount: 0,
        reviewsCount: 0,
        pagesMeter: 0,
        pagesBreakdown: []
      };
      const histValues = Object.values(hist || {});
      const finishedTitleSet = new Set(((insights && insights.finishedBooks) || []).map(x => (x.title || '').toLowerCase()).filter(Boolean));
      const matchedFinishedTitles = new Set();

      (unified || []).forEach(b => {
        const rev = revMap[b.bookKey] || Object.values(revMap || {}).find(x => x.title && b.title && x.title === b.title);
        const titleLow = (b.title || '').toLowerCase();
        let st = (rev && rev.status) || 'reading';
        if (titleLow && finishedTitleSet.has(titleLow)) {
          st = 'finished';
          matchedFinishedTitles.add(titleLow);
        }
        if (st === 'finished') counts.readCount++;
        else if (st === 'wishlist') counts.wishlistCount++;
        else if (st === 'rereading') counts.rereadingCount++;
        else if (st === 'paused') counts.abandonedCount++;
        else counts.readingCount++;

        if (rev && ((rev.reviewText && rev.reviewText.trim()) || rev.rating > 0)) {
          counts.reviewsCount++;
        }

        // Paginômetro: soma apenas páginas/seções realmente avançadas nos livros ativos da Estante
        let h = hist[b.bookKey];
        if (!h && b.title) {
          h = histValues.find(x => x.title && x.title.toLowerCase() === b.title.toLowerCase());
        }
        let bookPages = 0;
        if (st === 'finished') {
          bookPages = Math.max(1, (h && h.total) || b.totalSections || 1);
        } else if (h) {
          const idx = Math.max(0, h.currentIndex || 0);
          const advanced = idx > 0 || (h.subPageIndex || 0) > 0 || (h.scrollRatio || 0) > 0.03;
          if (advanced) bookPages = idx + 1;
        } else if (activeState && activeState.bookKey === b.bookKey && activeState.sections && activeState.sections.length) {
          if (activeState.currentIndex > 0 || activeState.subPageIndex > 0) {
            bookPages = activeState.currentIndex + 1;
          }
        }
        counts.pagesMeter += bookPages;
        if (bookPages > 0) {
          counts.pagesBreakdown.push(`${b.title}: ${bookPages}`);
        }
      });

      // Livros concluídos manualmente no diário que já tenham sido removidos da estante
      finishedTitleSet.forEach(t => {
        if (!matchedFinishedTitles.has(t)) counts.readCount++;
      });

      counts.totalBookmarks = Object.values(bms || {}).reduce((s, arr) => s + (Array.isArray(arr) ? arr.length : 0), 0);
      counts.favCount = Object.values(favs || {}).filter(Boolean).length;
      counts.kindleCount = Array.isArray(kindleHist) ? kindleHist.length : 0;
      return counts;
    }

    function matchesShelfOriginFilter(book, originMode) {
      const mode = originMode || 'all';
      const isLocal = Boolean(book && book.isLocal);
      const inCloud = Boolean(book && book.inCloud);
      if (mode === 'local-only') return isLocal && !inCloud;
      if (mode === 'cloud-only') return !isLocal && inCloud;
      if (mode === 'both') return isLocal && inCloud;
      if (mode === 'local') return isLocal;
      if (mode === 'cloud') return inCloud;
      return true;
    }

    async function renderBookshelf(filterText = '') {
      const grid = document.getElementById('bookshelfGrid');
      if (!grid) return;
      const unified = await getUnifiedShelfBooks();
      const hist = JSON.parse(localStorage.getItem('reader_history') || '{}');
      const revMap = getBookReviewsMap();
      const metaMap = getBookMetadataMap();
      const q = filterText.trim().toLowerCase();

      // Atualizar contadores nas abas de status (estilo Cabeceira)
      if (typeof updateQuickGDriveRenewUi === 'function') updateQuickGDriveRenewUi();
      const localSpaceEl = document.getElementById('lblLocalShelfSpace');
      if (localSpaceEl) {
        const localOnly = unified.filter(x => x.isLocal);
        const totalLocalBytes = localOnly.reduce((s, x) => s + (x.size || 0), 0);
        localSpaceEl.textContent = localOnly.length
          ? `· Offline: ${(totalLocalBytes / 1048576).toFixed(1)} MB (${localOnly.length})`
          : '';
        if (!localSpaceEl.dataset.hasListener) {
          localSpaceEl.dataset.hasListener = 'true';
          localSpaceEl.style.cursor = 'pointer';
          localSpaceEl.title = 'Armazenamento local (IndexedDB). Clique para detalhes.';
          localSpaceEl.addEventListener('click', () => {
            showToast(`Armazenamento Local: ${(totalLocalBytes / 1048576).toFixed(1)} MB salvos no disco. Os livros não pesam na memória RAM e você pode liberar espaço clicando em "Só Nuvem".`, 5500);
          });
        }
      }

      const tabCounts = { all: unified.length, reading: 0, wishlist: 0, finished: 0, rereading: 0, paused: 0, favorites: 0 };
      unified.forEach(b => {
        const st = getBookStatusValue(b.bookKey, b.title);
        if (tabCounts[st] !== undefined) tabCounts[st]++;
        if (isBookFavorite(b.bookKey, b.safeName)) tabCounts.favorites++;
      });
      const tabNames = { all: 'Todos', reading: 'Lendo Agora', wishlist: 'Quero Ler', finished: 'Lidos', rereading: 'Relendo', paused: 'Parei de Ler', favorites: 'Favoritos' };
      document.querySelectorAll('[data-shelf-tab]').forEach(btn => {
        const k = btn.dataset.shelfTab;
        btn.textContent = `${tabNames[k] || k} (${tabCounts[k] || 0})`;
      });

      const getBookHistRatio = (bk) => {
        let h = hist[bk.bookKey] || Object.values(hist).find(x => x.title && bk.title && x.title.toLowerCase() === bk.title.toLowerCase());
        if (!h) return { updatedAt: bk.savedAt || 0, ratio: 0 };
        const tot = Math.max(1, h.total || bk.totalSections || 1);
        return { updatedAt: h.updatedAt || bk.savedAt || 0, ratio: (h.currentIndex + 1) / tot };
      };

      const resumeBtn = document.getElementById('btnResumeLastBook');
      if (resumeBtn) {
        const lastPair = unified
          .filter(b => b.isLocal)
          .map(b => ({ b, meta: getBookHistRatio(b) }))
          .filter(x => hist[x.b.bookKey] || x.meta.ratio > 0)
          .sort((x, y) => y.meta.updatedAt - x.meta.updatedAt)[0];
        if (lastPair && state.sections.length === 0) {
          const shortTitle = (lastPair.b.title || 'Último Livro').slice(0, 26) + ((lastPair.b.title || '').length > 26 ? '…' : '');
          resumeBtn.textContent = `▶ Continuar: ${shortTitle}`;
          resumeBtn.classList.remove('hidden');
          resumeBtn.onclick = () => loadFile({ name: lastPair.b.fileName, size: lastPair.b.size, buffer: lastPair.b.buffer }, { skipIdbSave: true });
        } else {
          resumeBtn.classList.add('hidden');
        }
      }

      const sortMode = state.shelfSort || 'recent';
      const originMode = state.shelfOrigin || 'all';
      const filtered = unified
        .filter(b => {
          if (!matchesShelfOriginFilter(b, originMode)) return false;
          const fmtFilter = document.getElementById('selectShelfFormat') ? document.getElementById('selectShelfFormat').value : 'all';
          if (fmtFilter && fmtFilter !== 'all') {
            const bf = (b.format || '').toLowerCase();
            if (fmtFilter === 'cbz' && bf !== 'cbz' && !/mang[aá]/i.test(b.title || '')) return false;
            if (fmtFilter === 'epub' && bf !== 'epub') return false;
            if (fmtFilter === 'pdf' && bf !== 'pdf') return false;
            if (fmtFilter === 'mobi' && !['mobi', 'azw', 'azw3'].includes(bf)) return false;
          }
          if (q && !(b.title || '').toLowerCase().includes(q) && !(b.author || '').toLowerCase().includes(q) && !(b.format || '').toLowerCase().includes(q) && !getEffectiveBookGroupName(b, metaMap).name.toLowerCase().includes(q)) return false;
          if (activeShelfTab === 'favorites') return isBookFavorite(b.bookKey, b.safeName);
          if (activeShelfTab !== 'all') return getBookStatusValue(b.bookKey, b.title) === activeShelfTab;
          return true;
        })
        .sort((a, b) => {
          if (sortMode === 'title') return (a.title || '').localeCompare(b.title || '', 'pt-BR');
          if (sortMode === 'author') return (a.author || '').localeCompare(b.author || '', 'pt-BR');
          if (sortMode === 'progress') return getBookHistRatio(b).ratio - getBookHistRatio(a).ratio;
          return getBookHistRatio(b).updatedAt - getBookHistRatio(a).updatedAt;
        });

      if (!filtered.length) {
        const hasFilter = Boolean(q || (originMode && originMode !== 'all'));
        grid.innerHTML = `<div style="padding:14px; color:var(--text-muted); font-size:12px; border:1px dashed var(--border-color); border-radius:6px; grid-column: 1 / -1;">${hasFilter ? 'Nenhum livro corresponde ao filtro de busca ou origem.' : 'Nenhum livro nesta aba ainda. Abra um livro ou mude o filtro acima.'}</div>`;
        return;
      }

      grid.innerHTML = '';
      window.__expandedShelfSeries = window.__expandedShelfSeries || new Set();

      const buildSingleShelfCard = (b) => {
        let h = hist[b.bookKey];
        if (!h) {
          h = Object.values(hist).find(x => x.title && b.title && x.title.toLowerCase() === b.title.toLowerCase());
        }
        const total = (h && h.total) || b.totalSections || 1;
        const cur = h ? (h.currentIndex + 1) : 1;
        const pct = h ? Math.round((cur / Math.max(1, total)) * 100) : 0;
        const sizeLabel = b.size ? (b.size > 1048576 ? (b.size / 1048576).toFixed(2) + ' MB' : Math.round(b.size / 1024) + ' KB') : 'Nuvem';
        const cloudLabel = (b.cloudProviders && b.cloudProviders.length) ? b.cloudProviders.join(' + ') : 'NUVEM';
        const syncTag = b.isLocal && b.inCloud ? `${cloudLabel} + OFFLINE` : (b.isLocal ? 'LOCAL (OFFLINE)' : cloudLabel);
        const favActive = isBookFavorite(b.bookKey, b.safeName);
        const rev = revMap[b.bookKey] || Object.values(revMap).find(r => r.title === b.title);
        window.__selectedShelfKeys = window.__selectedShelfKeys || new Set();
        const isChecked = window.__selectedShelfKeys.has(b.bookKey);
        const showCopyCloudBtn = Boolean(b.inCloud && typeof getWritableCloudBankTargets === 'function' && getWritableCloudBankTargets().length > 1);

        const coverDataUrl = getBookCoverDataUrl(b.bookKey, b.safeName);
        const card = document.createElement('div');
        card.className = 'book-card';
        card.dataset.bookKey = b.bookKey;
        card.innerHTML = `
          <div>
            <div class="book-card-top" style="margin-bottom:6px;">
              <span style="display:inline-flex; align-items:center; gap:5px; min-width:0;">
                ${state.shelfBatchMode ? `<input type="checkbox" class="chk-shelf-select" ${isChecked ? 'checked' : ''} title="Selecionar livro" style="cursor:pointer;" />` : ''}
                <span class="book-badge">${escapeHtml(b.format || 'LIVRO')} · ${escapeHtml(syncTag)}</span>
              </span>
              <span style="font-size:10.5px; color:var(--text-muted);">${sizeLabel}</span>
            </div>
            <div class="book-card-body-row">
              <div class="book-card-cover" title="Ver Sobre o Livro e capa">
                ${coverDataUrl ? `<img src="${coverDataUrl}" alt="Capa" loading="lazy" decoding="async" />` : `<span>${escapeHtml((b.format || 'LIVRO').slice(0, 5))}</span>`}
              </div>
              <div style="flex:1; min-width:0;">
                <div class="book-card-title clickable-title" title="Clique para ver detalhes, sinopse e resenha">${escapeHtml(b.title)}</div>
                <div class="book-card-author">${escapeHtml(b.author || 'Autor desconhecido')}</div>
                ${(() => { const g = getEffectiveBookGroupName(b, metaMap); return g.isCustom ? `<div style="font-size:10.5px; color:var(--accent); font-weight:600; margin-top:2px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">Grupo: ${escapeHtml(g.name)}</div>` : ''; })()}
                <div class="book-card-rating" style="font-size:11px; color:#eab308; margin-top:4px; min-height:14px;">${rev && rev.rating ? ('★'.repeat(rev.rating) + '☆'.repeat(5 - rev.rating)) : ''}</div>
              </div>
            </div>
            <div class="book-card-iconrow">
              <button class="btn-icon-inline btn-quick-fav ${favActive ? 'is-fav' : ''}" title="Favoritar livro">
                <svg viewBox="0 0 24 24"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>
              </button>
              <button class="btn-icon-inline btn-quick-done" title="Marcar como Lido (Concluído)">
                <svg viewBox="0 0 24 24"><polyline points="20 6 9 17 4 12"/></svg>
              </button>
              <button class="btn-icon-inline btn-book-info" title="Sobre o Livro (Sinopse, Metadados e Resenha)">
                <svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>
              </button>
              <button class="btn btn-book-cover" style="height:28px; padding:0 8px;" title="Alterar ou baixar capa">Capa</button>
              <button class="btn btn-book-group" style="height:28px; padding:0 8px;" title="Mover para um grupo/coleção personalizada">Grupo</button>
            </div>
          </div>
          <div>
            <div style="display:flex; justify-content:space-between; font-size:10.5px; color:var(--text-muted);">
              <span>${h ? `Seção ${cur}/${total}` : `${total} seções`}</span>
              <span>${pct}%</span>
            </div>
            <div class="book-card-progress"><div style="width:${pct}%"></div></div>
            <div class="book-card-actions">
              <button class="btn primary btn-read-book" style="flex:1;">${b.isLocal ? (h ? 'Continuar' : 'Ler') : (h ? 'Baixar e Continuar' : 'Baixar e Ler')}</button>
              ${b.isLocal && !b.inCloud ? '<button class="btn btn-up-cloud" title="Enviar este livro para sua Estante na Nuvem">Nuvem</button>' : ''}
              ${showCopyCloudBtn ? '<button class="btn btn-copy-cloud" title="Copiar/espelhar este livro para outro banco na nuvem">⇄ Nuvem</button>' : ''}
              ${b.isLocal && b.inCloud ? '<button class="btn btn-evict-local" title="Liberar espaço deste dispositivo mantendo o livro salvo na Nuvem">☁ Só Nuvem</button>' : ''}
              ${b.isLocal ? '<button class="btn btn-dl-book" title="Baixar arquivo original">↓</button>' : ''}
              <button class="btn btn-del-book" title="Remover">${b.isLocal ? '✕' : '✕ Nuvem'}</button>
            </div>
          </div>
        `;

        const openBookAction = async (e) => {
          if (e) e.stopPropagation();
          if (b.isLocal && b.buffer) {
            loadFile({ name: b.fileName, size: b.size, buffer: b.buffer }, { skipIdbSave: true });
          } else {
            await downloadAndOpenCloudBook(b.safeName, b.fileName, b);
          }
        };

        card.querySelector('.clickable-title').addEventListener('click', (e) => { e.stopPropagation(); openBookInfoModal(b); });
        card.querySelector('.book-card-cover').addEventListener('click', (e) => { e.stopPropagation(); openBookInfoModal(b); });
        card.querySelector('.btn-book-info').addEventListener('click', (e) => { e.stopPropagation(); openBookInfoModal(b); });
        card.querySelector('.btn-book-cover').addEventListener('click', (e) => { e.stopPropagation(); openCoverModalForBook(b); });
        const grpBtn = card.querySelector('.btn-book-group');
        if (grpBtn) {
          grpBtn.addEventListener('click', async (e) => {
            e.stopPropagation();
            await openBookInfoModal(b);
            const inp = document.getElementById('inputInfoCustomGroup');
            if (inp) setTimeout(() => { inp.focus(); inp.select(); }, 80);
          });
        }
        card.querySelector('.btn-quick-fav').addEventListener('click', (e) => {
          e.stopPropagation();
          const nowFav = toggleBookFavorite(b.bookKey, b.safeName);
          renderBookshelf(document.getElementById('inputFilterShelf') ? document.getElementById('inputFilterShelf').value : '');
          showToast(nowFav ? 'Adicionado aos Favoritos' : 'Removido dos Favoritos');
        });
        card.querySelector('.btn-quick-done').addEventListener('click', (e) => {
          e.stopPropagation();
          const curSt = getBookStatusValue(b.bookKey, b.title);
          const nextSt = curSt === 'finished' ? 'reading' : 'finished';
          setBookStatusValue(b, nextSt);
          renderBookshelf(document.getElementById('inputFilterShelf') ? document.getElementById('inputFilterShelf').value : '');
          showToast(nextSt === 'finished' ? 'Marcado como Lido!' : 'Movido para Lendo Agora');
        });

        card.querySelector('.btn-read-book').addEventListener('click', openBookAction);

        const chkSel = card.querySelector('.chk-shelf-select');
        if (chkSel) {
          chkSel.addEventListener('click', (e) => e.stopPropagation());
          chkSel.addEventListener('change', () => {
            if (chkSel.checked) window.__selectedShelfKeys.add(b.bookKey);
            else window.__selectedShelfKeys.delete(b.bookKey);
            updateShelfBatchBarUi();
          });
        }

        const upBtn = card.querySelector('.btn-up-cloud');
        if (upBtn) {
          upBtn.addEventListener('click', async (e) => {
            e.stopPropagation();
            await uploadBookRecordToCloud(b);
          });
        }

        const copyCloudBtn = card.querySelector('.btn-copy-cloud');
        if (copyCloudBtn) {
          copyCloudBtn.addEventListener('click', async (e) => {
            e.stopPropagation();
            await copyBookBetweenClouds(b);
          });
        }

        const dlBtn = card.querySelector('.btn-dl-book');
        if (dlBtn) {
          dlBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            const blob = new Blob([b.buffer]);
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = b.fileName || `${b.title}.epub`;
            a.click();
            setTimeout(() => URL.revokeObjectURL(url), 2000);
          });
        }

        const evictBtn = card.querySelector('.btn-evict-local');
        if (evictBtn) {
          evictBtn.addEventListener('click', async (e) => {
            e.stopPropagation();
            if (confirm(`Liberar "${b.title}" da memória local do dispositivo (ele continua salvo na Nuvem com seu progresso)?`)) {
              await idbDeleteBook(b.bookKey);
              renderBookshelf(document.getElementById('inputFilterShelf') ? document.getElementById('inputFilterShelf').value : '');
              showToast('Espaço local liberado — livro mantido na Nuvem!');
            }
          });
        }

        card.querySelector('.btn-del-book').addEventListener('click', async (e) => {
          e.stopPropagation();
          const inviteState = getActiveInviteState();
          if (inviteState && inviteState.role !== 'member' && !b.isLocal) {
            alert('No modo Convidado (Somente Ver / Colaborador) você não pode remover livros da estante do proprietário.');
            return;
          }
          if (b.isLocal) {
            if (confirm(`Remover "${b.title}" da memória local do navegador?`)) {
              await idbDeleteBook(b.bookKey);
              if (!b.inCloud) {
                const h = JSON.parse(localStorage.getItem('reader_history') || '{}');
                if (h[b.bookKey]) { delete h[b.bookKey]; localStorage.setItem('reader_history', JSON.stringify(h)); }
              }
              renderBookshelf(document.getElementById('inputFilterShelf').value);
              renderRecentHistory();
              showToast('Livro removido da estante local');
            }
          } else {
            if (confirm(`Remover "${b.title}" da Nuvem?`)) {
              const h = JSON.parse(localStorage.getItem('reader_history') || '{}');
              if (h[b.bookKey]) { delete h[b.bookKey]; localStorage.setItem('reader_history', JSON.stringify(h)); }
              await deleteCloudBook(b.safeName, b);
              renderRecentHistory();
            }
          }
        });

        card.addEventListener('click', openBookAction);
        return card;
      };

      if (!state.groupShelfSeries) {
        filtered.forEach(b => grid.appendChild(buildSingleShelfCard(b)));
        return;
      }

      const groupsMap = new Map();
      filtered.forEach(b => {
        const res = getEffectiveBookGroupName(b, metaMap);
        if (!groupsMap.has(res.name)) groupsMap.set(res.name, { isCustom: res.isCustom, items: [] });
        const bucket = groupsMap.get(res.name);
        if (res.isCustom) bucket.isCustom = true;
        bucket.items.push(b);
      });

      for (const [seriesName, grpObj] of groupsMap.entries()) {
        const items = grpObj.items.slice().sort((a, b) => naturalCompareTitles(a.title || a.fileName, b.title || b.fileName));
        // Séries automáticas só viram pasta com 2+ livros; grupos personalizados sempre aparecem como pasta!
        if (!grpObj.isCustom && items.length === 1) {
          grid.appendChild(buildSingleShelfCard(items[0]));
          continue;
        }
        const isOpen = window.__expandedShelfSeries.has(seriesName);
        const firstCov = items.map(it => getBookCoverDataUrl(it.bookKey, it.safeName)).find(Boolean) || '';
        const folder = document.createElement('div');
        folder.className = 'series-group-card';
        const kindLabel = grpObj.isCustom
          ? `Grupo Personalizado · ${items.length} ${items.length === 1 ? 'livro' : 'livros'}`
          : `Série · ${items.length} volumes/caps`;
        folder.innerHTML = `
          <div style="display:flex; gap:10px; align-items:center;">
            <div class="book-card-cover">${firstCov ? `<img src="${firstCov}" alt="" />` : `<span>${grpObj.isCustom ? 'GRUPO' : 'SÉRIE'}</span>`}</div>
            <div style="flex:1; min-width:0;">
              <div style="font-size:10.5px; font-weight:700; color:var(--accent); text-transform:uppercase;">${kindLabel}</div>
              <div style="font-size:13.5px; font-weight:700; color:var(--text-primary); margin-top:2px;">${escapeHtml(seriesName)}</div>
              <div style="font-size:11px; color:var(--text-muted); margin-top:4px;">${isOpen ? 'Clique para recolher ▲' : 'Clique para abrir pasta ▼'}</div>
            </div>
          </div>
        `;
        folder.addEventListener('click', () => {
          if (window.__expandedShelfSeries.has(seriesName)) window.__expandedShelfSeries.delete(seriesName);
          else window.__expandedShelfSeries.add(seriesName);
          renderBookshelf(document.getElementById('inputFilterShelf') ? document.getElementById('inputFilterShelf').value : '');
        });
        grid.appendChild(folder);
        if (isOpen) {
          items.forEach(it => grid.appendChild(buildSingleShelfCard(it)));
        }
      }
    }

    function closeCurrentBook() {
      if (state.bookKey && state.sections.length) {
        saveProgress();
      }
      if ('speechSynthesis' in window) {
        try { window.speechSynthesis.cancel(); } catch {}
      }
      if (typeof ttsPlaying !== 'undefined') ttsPlaying = false;
      if (typeof setImmersiveMode === 'function' && document.body.classList.contains('immersive-mode')) {
        setImmersiveMode(false);
      }
      if (dom.sidebar) dom.sidebar.classList.add('hidden-sidebar');
      const parallelEl = document.getElementById('parallelPane');
      if (parallelEl) parallelEl.classList.remove('open');
      state.objectUrls.forEach(u => { try { URL.revokeObjectURL(u); } catch {} });
      state.objectUrls = [];
      state.bookKey = null;
      state.title = '';
      state.author = '';
      state.format = '';
      state.sections = [];
      state.toc = [];
      state.pathToSection = new Map();
      state.idToSection = new Map();
      state.currentIndex = 0;
      state.subPageIndex = 0;
      state.subPageCount = 1;
      state.pdfDoc = null;
      state.currentFileBuffer = null;
      state.currentFileName = '';
      state.readingType = null;
      if (dom.readerFlow) dom.readerFlow.innerHTML = '';
      if (dom.pdfStage) dom.pdfStage.style.display = 'none';
      if (dom.pageSheet) dom.pageSheet.style.display = '';
      if (dom.pdfControls) dom.pdfControls.classList.add('hidden');
      if (dom.btnMangaRtl) dom.btnMangaRtl.classList.add('hidden');
      if (dom.headerTitle) dom.headerTitle.textContent = 'Estante de Livros';
      if (dom.headerMeta) dom.headerMeta.textContent = 'EPUB · MOBI · AZW3 · PDF · FB2 · CBZ · MD';
      if (dom.inputSectionNum) dom.inputSectionNum.value = '0';
      if (dom.lblTotalSections) dom.lblTotalSections.textContent = '/ 0';
      if (dom.statusLeft) dom.statusLeft.textContent = 'Pronto';
      if (dom.statusPercent) dom.statusPercent.textContent = '0%';
      if (dom.progressFill) dom.progressFill.style.width = '0%';
      document.body.classList.add('is-shelf-home');
      applySettings();
      state.seriesQueue = null;
      if (typeof updateNextSeriesButtonUi === 'function') updateNextSeriesButtonUi();
      if (btnMangaStripEl) btnMangaStripEl.classList.add('hidden');
      const btnCloseShelfEl = document.getElementById('btnCloseShelf');
      if (btnCloseShelfEl) btnCloseShelfEl.classList.add('hidden');
      const btnCloseBookShelfEl = document.getElementById('btnCloseBookShelf');
      if (btnCloseBookShelfEl) btnCloseBookShelfEl.classList.add('hidden');
      dom.emptyState.classList.remove('hidden');
      renderBookshelf(document.getElementById('inputFilterShelf').value || '');
      renderRecentHistory();
      showToast('Livro fechado — de volta à Estante.');
    }

    const btnCloseBookEl = document.getElementById('btnCloseBook');
    if (btnCloseBookEl) btnCloseBookEl.addEventListener('click', closeCurrentBook);
    const btnCloseBookShelfEl = document.getElementById('btnCloseBookShelf');
    if (btnCloseBookShelfEl) btnCloseBookShelfEl.addEventListener('click', closeCurrentBook);

    document.getElementById('btnShowShelf').addEventListener('click', () => {
      // Fecha popovers, dropdowns e modais para não sobreporem a Estante
      if (dom.typoPopover) dom.typoPopover.classList.remove('open');
      const td = document.getElementById('toolsDropdown');
      if (td) td.classList.remove('open');
      const userDd = document.getElementById('userProfileDropdown');
      if (userDd) userDd.classList.remove('open');
      const qrM = document.getElementById('qrCodeModal');
      if (qrM) qrM.classList.remove('open');

      if (state.sections.length > 0 && !dom.emptyState.classList.contains('hidden')) {
        dom.emptyState.classList.add('hidden');
        return;
      }
      const btnCloseShelfEl = document.getElementById('btnCloseShelf');
      if (btnCloseShelfEl) btnCloseShelfEl.classList.toggle('hidden', state.sections.length === 0);
      const bCloseBookShelf = document.getElementById('btnCloseBookShelf');
      if (bCloseBookShelf) bCloseBookShelf.classList.toggle('hidden', state.sections.length === 0);
      dom.emptyState.classList.remove('hidden');
      renderBookshelf(document.getElementById('inputFilterShelf').value || '');
      renderRecentHistory();
    });

    const btnCloseShelfEl = document.getElementById('btnCloseShelf');
    if (btnCloseShelfEl) {
      btnCloseShelfEl.addEventListener('click', () => {
        dom.emptyState.classList.add('hidden');
      });
    }

    // Fechar a Estante suspensa ao clicar fora da caixa (quando já houver um livro aberto)
    dom.emptyState.addEventListener('click', (e) => {
      if (e.target === dom.emptyState && state.sections.length > 0) {
        dom.emptyState.classList.add('hidden');
      }
    });

    document.getElementById('inputFilterShelf').addEventListener('input', (e) => {
      renderBookshelf(e.target.value);
    });
    window.__selectedShelfKeys = window.__selectedShelfKeys || new Set();
    let __lastRenderedShelfBooks = [];

    function updateShelfBatchBarUi() {
      const bar = document.getElementById('shelfBatchBar');
      const cntEl = document.getElementById('lblShelfBatchCount');
      const modeBtn = document.getElementById('btnShelfBatchMode');
      if (modeBtn) modeBtn.classList.toggle('active', Boolean(state.shelfBatchMode));
      if (!bar) return;
      const count = window.__selectedShelfKeys.size;
      bar.classList.toggle('hidden', !state.shelfBatchMode && count === 0);
      if (cntEl) cntEl.textContent = `${count} livro(s) selecionado(s)`;
    }

    async function getBookRecordWithBuffer(b) {
      if (b && b.isLocal && b.buffer) return b;
      const src = (b && b.cloudSources && b.cloudSources[0]) || b;
      const cfg = (src && src._bankProfile) || getCloudConfig();
      let buf = null;
      if (cfg.provider === 'gdrive') {
        const fCfg = await ensureFreshOAuthToken(cfg);
        if (!fCfg.accessToken || fCfg._tokenExpired) throw new Error('Sessão do Google Drive expirou.');
        const fid = (src && src._remoteFileId) || '';
        if (!fid) throw new Error('Arquivo não localizado no Google Drive.');
        const r = await fetch(`https://www.googleapis.com/drive/v3/files/${fid}?alt=media`, { headers: { Authorization: `Bearer ${fCfg.accessToken}` } });
        if (!r.ok) throw new Error(`Google Drive HTTP ${r.status}`);
        buf = await r.arrayBuffer();
      } else if (cfg.provider === 'onedrive') {
        const fCfg = await ensureFreshOAuthToken(cfg);
        if (!fCfg.accessToken || fCfg._tokenExpired) throw new Error('Sessão do OneDrive expirou.');
        const fid = (src && src._remoteFileId) || '';
        const u = fid ? `https://graph.microsoft.com/v1.0/me/drive/items/${fid}/content` : `https://graph.microsoft.com/v1.0/me/drive/special/approot:/${encodeURIComponent(fCfg.syncKey || 'minha-estante')}/${encodeURIComponent(b.safeName)}:/content`;
        const r = await fetch(u, { headers: { Authorization: `Bearer ${fCfg.accessToken}` } });
        if (!r.ok) throw new Error(`OneDrive HTTP ${r.status}`);
        buf = await r.arrayBuffer();
      } else {
        const r = await fetch(`${cfg.url}/storage/v1/object/${cfg.bucket || 'books'}/${cfg.syncKey || 'minha-estante'}/${encodeURIComponent(b.safeName)}`, { headers: getSupabaseHeaders(cfg) });
        if (!r.ok) throw new Error(`Supabase HTTP ${r.status}`);
        buf = await r.arrayBuffer();
      }
      return { ...b, buffer: buf, size: buf.byteLength };
    }

    async function copyBookBetweenClouds(b) {
      try {
        showToast(`Preparando "${b.title}" para copiar para outra nuvem...`);
        const fullRec = await getBookRecordWithBuffer(b);
        await uploadBookRecordToCloud(fullRec);
      } catch (err) {
        alert('Erro ao copiar livro entre nuvens: ' + err.message);
      }
    }

    function updateQuickGDriveRenewUi() {
      const btn = document.getElementById('btnQuickRenewGDrive');
      if (!btn) return;
      const profs = typeof getCloudProfilesList === 'function' ? getCloudProfilesList() : [];
      const gd = profs.find(p => p && p.provider === 'gdrive' && p.clientId);
      const needsRenew = Boolean(gd && (!gd.accessToken || (gd.tokenExpiresAt && Date.now() > (gd.tokenExpiresAt - 60000))));
      btn.classList.toggle('hidden', !needsRenew);
      if (needsRenew && !btn._boundQuickRenew) {
        btn._boundQuickRenew = true;
        btn.addEventListener('click', async () => {
          await activateOrAddPersonalCloudProvider('gdrive');
          const connectBtn = document.getElementById('btnConnectOAuthNow');
          if (connectBtn) connectBtn.click();
        });
      }
    }

    const btnShelfBatchEl = document.getElementById('btnShelfBatchMode');
    if (btnShelfBatchEl) {
      btnShelfBatchEl.addEventListener('click', () => {
        state.shelfBatchMode = !state.shelfBatchMode;
        if (!state.shelfBatchMode) window.__selectedShelfKeys.clear();
        updateShelfBatchBarUi();
        renderBookshelf(document.getElementById('inputFilterShelf') ? document.getElementById('inputFilterShelf').value : '');
      });
    }
    const btnBatchClearEl = document.getElementById('btnBatchClear');
    if (btnBatchClearEl) {
      btnBatchClearEl.addEventListener('click', () => {
        state.shelfBatchMode = false;
        window.__selectedShelfKeys.clear();
        updateShelfBatchBarUi();
        renderBookshelf(document.getElementById('inputFilterShelf') ? document.getElementById('inputFilterShelf').value : '');
      });
    }
    const btnBatchAllEl = document.getElementById('btnBatchSelectAll');
    if (btnBatchAllEl) {
      btnBatchAllEl.addEventListener('click', () => {
        document.querySelectorAll('#bookshelfGrid .book-card').forEach(c => {
          if (c.dataset.bookKey) window.__selectedShelfKeys.add(c.dataset.bookKey);
        });
        updateShelfBatchBarUi();
        renderBookshelf(document.getElementById('inputFilterShelf') ? document.getElementById('inputFilterShelf').value : '');
      });
    }
    const getSelectedShelfObjects = async () => {
      const all = await getUnifiedShelfBooks();
      return all.filter(b => window.__selectedShelfKeys.has(b.bookKey));
    };
    const btnBatchUpEl = document.getElementById('btnBatchUploadCloud');
    if (btnBatchUpEl) {
      btnBatchUpEl.addEventListener('click', async () => {
        const picked = await getSelectedShelfObjects();
        if (!picked.length) return;
        const writable = getWritableCloudBankTargets();
        const chosenBanks = await promptUploadBankDestinations({ title: `${picked.length} livro(s) selecionado(s)`, size: picked.reduce((s, x) => s + (x.size || 0), 0) }, writable);
        if (!chosenBanks || !chosenBanks.length) return;
        let okCount = 0;
        const inv = getActiveInviteState();
        for (const item of picked) {
          try {
            const full = await getBookRecordWithBuffer(item);
            for (const bank of chosenBanks) {
              await uploadBookRecordToSingleBank(full, bank, inv);
            }
            okCount++;
          } catch {}
        }
        window.__selectedShelfKeys.clear();
        updateShelfBatchBarUi();
        await listCloudBooks();
        showToast(`${okCount}/${picked.length} livro(s) enviado(s) em lote!`);
      });
    }
    const btnBatchGrpEl = document.getElementById('btnBatchMoveGroup');
    if (btnBatchGrpEl) {
      btnBatchGrpEl.addEventListener('click', async () => {
        const picked = await getSelectedShelfObjects();
        if (!picked.length) return;
        const gName = prompt(`Nome do Grupo/Coleção para os ${picked.length} livros selecionados (deixe vazio para remover):`, '');
        if (gName === null) return;
        const clean = gName.trim();
        picked.forEach(b => saveBookMetadata(b.bookKey, b.safeName, { customGroup: clean }));
        if (clean && !state.groupShelfSeries) { state.groupShelfSeries = true; applySettings(); }
        if (typeof pushCloudSyncSilent === 'function') pushCloudSyncSilent();
        window.__selectedShelfKeys.clear();
        updateShelfBatchBarUi();
        renderBookshelf(document.getElementById('inputFilterShelf') ? document.getElementById('inputFilterShelf').value : '');
        showToast(clean ? `${picked.length} livros movidos para "${clean}"!` : 'Grupo removido dos livros selecionados.');
      });
    }
    const btnBatchEvictEl = document.getElementById('btnBatchEvictLocal');
    if (btnBatchEvictEl) {
      btnBatchEvictEl.addEventListener('click', async () => {
        const picked = (await getSelectedShelfObjects()).filter(b => b.isLocal && b.inCloud);
        if (!picked.length) { alert('Nenhum dos livros selecionados está salvo na nuvem para liberar o cache local.'); return; }
        if (!confirm(`Liberar cache local de ${picked.length} livro(s) (continuarão salvos na Nuvem)?`)) return;
        for (const b of picked) await idbDeleteBook(b.bookKey);
        window.__selectedShelfKeys.clear();
        updateShelfBatchBarUi();
        renderBookshelf(document.getElementById('inputFilterShelf') ? document.getElementById('inputFilterShelf').value : '');
        showToast(`Espaço local liberado para ${picked.length} livro(s)!`);
      });
    }
    const btnBatchDelEl = document.getElementById('btnBatchDelete');
    if (btnBatchDelEl) {
      btnBatchDelEl.addEventListener('click', async () => {
        const picked = await getSelectedShelfObjects();
        if (!picked.length) return;
        if (!confirm(`Remover ${picked.length} livro(s) selecionado(s)?`)) return;
        for (const b of picked) {
          if (b.isLocal) await idbDeleteBook(b.bookKey);
          else await deleteCloudBook(b.safeName, b);
        }
        window.__selectedShelfKeys.clear();
        updateShelfBatchBarUi();
        renderBookshelf(document.getElementById('inputFilterShelf') ? document.getElementById('inputFilterShelf').value : '');
        showToast(`${picked.length} livro(s) removido(s).`);
      });
    }

    const btnBatchCbzEl = document.getElementById('btnBatchCompileCbz');
    if (btnBatchCbzEl) {
      btnBatchCbzEl.addEventListener('click', async () => {
        const items = await getSelectedShelfObjects();
        if (!items.length) return;
        const sorted = items.slice().sort((a, b) => {
          const cmp = typeof naturalCompareTitles === 'function'
            ? naturalCompareTitles(a.title || a.fileName || '', b.title || b.fileName || '')
            : (a.title || '').localeCompare(b.title || '');
          return cmp;
        });
        btnBatchCbzEl.disabled = true;
        btnBatchCbzEl.textContent = 'Compilando .CBZ...';
        try {
          const zipEntries = [];
          let pageCounter = 1;
          for (const it of sorted) {
            let buf = it.buffer;
            if (!buf && it.bookKey && typeof idbGetBook === 'function') {
              const rec = await idbGetBook(it.bookKey).catch(() => null);
              if (rec && rec.buffer) buf = rec.buffer;
            }
            if (!buf) continue;
            const ext = (it.fileName || it.title || '').split('.').pop().toLowerCase();
            if (['cbz', 'zip'].includes(ext) || it.format === 'CBZ') {
              const innerZip = await openZipBuffer(buf);
              const names = Array.from(innerZip.entries.keys())
                .filter(k => /\.(jpe?g|png|webp|gif|avif|bmp)$/i.test(k) && !k.startsWith('__MACOSX'))
                .sort((a, b) => typeof naturalCompareTitles === 'function' ? naturalCompareTitles(a, b) : a.localeCompare(b));
              for (const n of names) {
                const b = await innerZip.readBytes(n);
                if (b && b.length) {
                  const imgExt = (n.split('.').pop() || 'jpg').toLowerCase();
                  const pad = String(pageCounter++).padStart(4, '0');
                  zipEntries.push({ path: `${pad}.${imgExt}`, content: b });
                }
              }
            }
          }
          if (!zipEntries.length) {
            showToast('Selecione arquivos .cbz / .zip baixados localmente para compilar o volume.', true);
            return;
          }
          const volBlob = createZipBlob(zipEntries, 'application/vnd.comicbook+zip');
          const baseName = (sorted[0].title || 'Volume_Compilado').replace(/[^a-z0-9_-]/gi, '_').slice(0, 40);
          const a = document.createElement('a');
          a.href = URL.createObjectURL(volBlob);
          a.download = `${baseName}_Vol_${sorted.length}_caps.cbz`;
          a.click();
          setTimeout(() => URL.revokeObjectURL(a.href), 2000);
          showToast(`Volume .CBZ compilado com ${zipEntries.length} páginas!`);
        } catch (err) {
          showToast('Erro ao compilar .CBZ: ' + err.message, true);
        } finally {
          btnBatchCbzEl.disabled = false;
          btnBatchCbzEl.textContent = 'Compilar Volume (.CBZ)';
        }
      });
    }

    const btnToggleGroupEl = document.getElementById('btnToggleShelfGroup');
    if (btnToggleGroupEl) {
      btnToggleGroupEl.addEventListener('click', () => {
        state.groupShelfSeries = !state.groupShelfSeries;
        applySettings();
        renderBookshelf(document.getElementById('inputFilterShelf') ? document.getElementById('inputFilterShelf').value : '');
      });
    }
    const shelfOriginEl = document.getElementById('selectShelfOrigin');
    if (shelfOriginEl) {
      if (state.shelfOrigin === 'local') state.shelfOrigin = 'local-only';
      if (state.shelfOrigin === 'cloud') state.shelfOrigin = 'cloud-only';
      if (!Array.from(shelfOriginEl.options).some(o => o.value === state.shelfOrigin)) {
        state.shelfOrigin = 'all';
        localStorage.setItem('reader_shelfOrigin', 'all');
      }
      shelfOriginEl.value = state.shelfOrigin;
      shelfOriginEl.addEventListener('change', () => {
        state.shelfOrigin = shelfOriginEl.value;
        localStorage.setItem('reader_shelfOrigin', state.shelfOrigin);
        renderBookshelf(document.getElementById('inputFilterShelf') ? document.getElementById('inputFilterShelf').value : '');
      });
    }
    const shelfSortEl = document.getElementById('selectShelfSort');
    if (shelfSortEl) {
      shelfSortEl.value = state.shelfSort || 'recent';
      shelfSortEl.addEventListener('change', () => {
        state.shelfSort = shelfSortEl.value;
        localStorage.setItem('reader_shelfSort', state.shelfSort);
        renderBookshelf(document.getElementById('inputFilterShelf').value || '');
      });
    }

    const shelfFmtEl = document.getElementById('selectShelfFormat');
    if (shelfFmtEl) {
      shelfFmtEl.addEventListener('change', () => {
        renderBookshelf(document.getElementById('inputFilterShelf') ? document.getElementById('inputFilterShelf').value : '');
      });
    }

    document.getElementById('btnLoadUrl').addEventListener('click', async () => {
      const url = document.getElementById('inputBookUrl').value.trim();
      if (!url) {
        alert('Cole o link direto (URL) de um arquivo .epub, .mobi, .pdf, .fb2 ou .md.');
        return;
      }
      try {
        showToast('Baixando livro pelo link...');
        const buffer = await fetchExternalBinary(url);
        const rawName = decodeURIComponent(url.split('?')[0].split('/').pop() || 'livro_remoto.epub');
        await loadFile({ name: rawName, size: buffer.byteLength, buffer });
        const chkSaveCloud = document.getElementById('chkSaveUrlToCloud');
        if (chkSaveCloud && chkSaveCloud.checked) {
          await uploadBookRecordToCloud({
            bookKey: state.bookKey,
            fileName: rawName,
            title: state.title || rawName,
            author: state.author || '',
            format: state.format || '',
            size: buffer.byteLength,
            totalSections: state.sections.length,
            buffer
          });
        }
      } catch (err) {
        alert('Não foi possível baixar o livro desse link (verifique se o servidor permite acesso CORS direto): ' + err.message);
      }
    });

    /* =====================================================================
     * 10. LEITURA PARALELA (SPLIT-SCREEN), RÉGUA DE FOCO, TELA CHEIA E LIGHTBOX
     * ===================================================================== */
    const parallelPane = document.getElementById('parallelPane');
    const selectParallelSection = document.getElementById('selectParallelSection');
    const parallelBody = document.getElementById('parallelBody');

    function populateParallelSectionSelect() {
      if (!selectParallelSection) return;
      selectParallelSection.innerHTML = '';
      state.sections.forEach((s, idx) => {
        const opt = document.createElement('option');
        opt.value = String(idx);
        opt.textContent = `${idx + 1}. ${s.title}`;
        selectParallelSection.appendChild(opt);
      });
      if (state.sections.length) {
        selectParallelSection.value = String(state.currentIndex);
      }
    }

    function renderParallelSection(idx) {
      if (!state.sections.length || !state.sections[idx]) return;
      const sec = state.sections[idx];
      if (sec.html === null && sec.buildHtml) {
        sec.html = sec.buildHtml(sec.rawSlice);
      }
      parallelBody.innerHTML = `<div style="max-width:680px; margin:0 auto;">${sec.html || `<p>${escapeHtml(sec.text || '')}</p>`}</div>`;
    }

    document.getElementById('btnParallelToggle').addEventListener('click', () => {
      const isOpen = parallelPane.classList.toggle('open');
      document.getElementById('btnParallelToggle').classList.toggle('active', isOpen);
      if (isOpen && state.sections.length) {
        populateParallelSectionSelect();
        renderParallelSection(state.currentIndex);
      }
      if (dom.viewport.classList.contains('paginated-mode')) {
        setTimeout(updatePaginatedMetrics, 220);
      }
    });

    document.getElementById('btnCloseParallel').addEventListener('click', () => {
      parallelPane.classList.remove('open');
      document.getElementById('btnParallelToggle').classList.remove('active');
      if (dom.viewport.classList.contains('paginated-mode')) {
        setTimeout(updatePaginatedMetrics, 220);
      }
    });

    selectParallelSection.addEventListener('change', () => {
      const idx = parseInt(selectParallelSection.value, 10);
      if (!isNaN(idx)) renderParallelSection(idx);
    });

    let __parallelSyncLock = false;
    const chkParallelSyncEl = document.getElementById('chkParallelSyncScroll');
    if (dom.viewport && parallelBody && chkParallelSyncEl) {
      dom.viewport.addEventListener('scroll', () => {
        if (!chkParallelSyncEl.checked || !parallelPane.classList.contains('open') || __parallelSyncLock) return;
        const maxSrc = dom.viewport.scrollHeight - dom.viewport.clientHeight;
        const maxDst = parallelBody.scrollHeight - parallelBody.clientHeight;
        if (maxSrc <= 0 || maxDst <= 0) return;
        __parallelSyncLock = true;
        parallelBody.scrollTop = (dom.viewport.scrollTop / maxSrc) * maxDst;
        requestAnimationFrame(() => { __parallelSyncLock = false; });
      }, { passive: true });
      parallelBody.addEventListener('scroll', () => {
        if (!chkParallelSyncEl.checked || !parallelPane.classList.contains('open') || __parallelSyncLock) return;
        const maxSrc = parallelBody.scrollHeight - parallelBody.clientHeight;
        const maxDst = dom.viewport.scrollHeight - dom.viewport.clientHeight;
        if (maxSrc <= 0 || maxDst <= 0) return;
        __parallelSyncLock = true;
        dom.viewport.scrollTop = (parallelBody.scrollTop / maxSrc) * maxDst;
        requestAnimationFrame(() => { __parallelSyncLock = false; });
      }, { passive: true });
    }

    document.getElementById('parallelFileInput').addEventListener('change', async (e) => {
      const f = e.target.files && e.target.files[0];
      if (!f) return;
      const ext = f.name.split('.').pop().toLowerCase();
      const buf = await f.arrayBuffer();
      try {
        let p;
        if (ext === 'epub') p = await parseEpub(buf, f.name);
        else if (['mobi', 'azw', 'azw3', 'prc'].includes(ext)) p = await parseMobi(buf, f.name);
        else if (ext === 'fb2') p = await parseFb2(buf, f.name);
        else if (ext === 'md') p = parseMarkdown(buf, f.name);
        else {
          const txt = new TextDecoder('utf-8').decode(buf);
          p = { title: f.name, sections: [{ title: f.name, html: `<p>${escapeHtml(txt)}</p>`, text: txt }] };
        }
        state.parallelBookSections = p.sections;
        selectParallelSection.innerHTML = '';
        p.sections.forEach((s, i) => {
          const opt = document.createElement('option');
          opt.value = 'p_' + i;
          opt.textContent = `[2º Livro] ${i + 1}. ${s.title}`;
          selectParallelSection.appendChild(opt);
        });
        const firstSec = p.sections[0];
        if (firstSec.html === null && firstSec.buildHtml) firstSec.html = firstSec.buildHtml(firstSec.rawSlice);
        parallelBody.innerHTML = `<div style="max-width:680px; margin:0 auto;">${firstSec.html || ''}</div>`;
        selectParallelSection.onchange = () => {
          const v = selectParallelSection.value;
          if (v.startsWith('p_')) {
            const s = state.parallelBookSections[parseInt(v.slice(2), 10)];
            if (s) {
              if (s.html === null && s.buildHtml) s.html = s.buildHtml(s.rawSlice);
              parallelBody.innerHTML = `<div style="max-width:680px; margin:0 auto;">${s.html || ''}</div>`;
            }
          } else {
            renderParallelSection(parseInt(v, 10));
          }
        };
        showToast(`2º livro aberto no painel paralelo: ${p.title}`);
      } catch (err) {
        alert('Erro ao abrir 2º livro: ' + err.message);
      }
    });

    // Régua de Leitura (Visual & Focus Aid)
    const readingRuler = document.getElementById('readingRuler');
    let rulerEnabled = false;
    document.getElementById('btnRulerToggle').addEventListener('click', () => {
      rulerEnabled = !rulerEnabled;
      document.getElementById('btnRulerToggle').classList.toggle('active', rulerEnabled);
      readingRuler.style.display = rulerEnabled ? 'block' : 'none';
      showToast(rulerEnabled ? 'Régua de Foco ativada' : 'Régua de Foco desativada');
    });
    window.addEventListener('mousemove', (e) => {
      if (rulerEnabled) {
        readingRuler.style.top = Math.max(46, e.clientY - 19) + 'px';
      }
    });

    // Modo Leitura Imersivo & Tela Cheia (com fallback automático para iOS/Android)
    function setImmersiveMode(enabled) {
      document.body.classList.toggle('immersive-mode', Boolean(enabled));
      const btnImm = document.getElementById('btnImmersive');
      if (btnImm) btnImm.classList.toggle('active', Boolean(enabled));
      handleViewportReflowOnResize();
    }
    const btnImmersiveEl = document.getElementById('btnImmersive');
    if (btnImmersiveEl) {
      btnImmersiveEl.addEventListener('click', () => {
        setImmersiveMode(!document.body.classList.contains('immersive-mode'));
      });
    }
    const btnExitImmersiveEl = document.getElementById('btnExitImmersive');
    if (btnExitImmersiveEl) {
      btnExitImmersiveEl.addEventListener('click', () => setImmersiveMode(false));
    }
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && document.body.classList.contains('immersive-mode')) {
        setImmersiveMode(false);
      }
    });

    // Tela Cheia
    document.getElementById('btnFullscreen').addEventListener('click', () => {
      if (!document.fullscreenElement) {
        if (document.documentElement.requestFullscreen) {
          document.documentElement.requestFullscreen().catch(() => {
            setImmersiveMode(!document.body.classList.contains('immersive-mode'));
          });
        } else {
          setImmersiveMode(!document.body.classList.contains('immersive-mode'));
        }
      } else {
        document.exitFullscreen().catch(() => {});
      }
    });

    // =====================================================================
    // 10B. VISUALIZADOR & AMPLIADOR PROFISSIONAL DE IMAGENS COM ZOOM E DOWNLOAD
    // =====================================================================
    const lbModal = document.getElementById('imgLightbox');
    const lbImg = document.getElementById('imgLightboxTarget');
    const lbStage = document.getElementById('lightboxStage');
    const lbTitle = document.getElementById('lblLightboxTitle');
    const lbZoomPct = document.getElementById('lblLightboxZoomPct');
    const btnLbClose = document.getElementById('btnCloseLightbox');
    const btnLbZoomIn = document.getElementById('btnLightboxZoomIn');
    const btnLbZoomOut = document.getElementById('btnLightboxZoomOut');
    const btnLbZoomReset = document.getElementById('btnLightboxZoomReset');
    const btnLbRotate = document.getElementById('btnLightboxRotate');
    const btnLbCopy = document.getElementById('btnLightboxCopy');
    const btnLbDownload = document.getElementById('btnLightboxDownload');

    let lbZoom = 1.0;
    let lbRotate = 0;
    let lbPanX = 0;
    let lbPanY = 0;
    let isLbDragging = false;
    let lbDragStartX = 0;
    let lbDragStartY = 0;

    function applyLbTransform() {
      if (!lbImg) return;
      lbImg.style.transform = `translate(${lbPanX}px, ${lbPanY}px) scale(${lbZoom}) rotate(${lbRotate}deg)`;
      if (lbZoomPct) lbZoomPct.textContent = `${Math.round(lbZoom * 100)}%`;
      if (lbStage) {
        lbStage.style.cursor = lbZoom > 1.05 ? (isLbDragging ? 'grabbing' : 'grab') : 'default';
      }
    }

    function resetLbTransform() {
      lbZoom = 1.0;
      lbRotate = 0;
      lbPanX = 0;
      lbPanY = 0;
      applyLbTransform();
    }

    window.openImageLightbox = function(src, title) {
      if (!lbModal || !lbImg) return;
      lbImg.src = src;
      if (lbTitle) {
        lbTitle.textContent = title || state.title || 'Imagem do Livro';
      }
      resetLbTransform();
      lbModal.classList.add('open');
    };

    window.closeImageLightbox = function() {
      if (!lbModal) return;
      lbModal.classList.remove('open');
      resetLbTransform();
    };

    if (btnLbClose) btnLbClose.addEventListener('click', window.closeImageLightbox);

    // Fechar ao clicar no fundo escuro (fora da barra e fora da imagem)
    if (lbModal) {
      lbModal.addEventListener('click', (e) => {
        if (e.target === lbModal || e.target === lbStage) {
          window.closeImageLightbox();
        }
      });
    }

    if (btnLbZoomIn) {
      btnLbZoomIn.addEventListener('click', () => {
        lbZoom = Math.min(5.0, Number((lbZoom + 0.25).toFixed(2)));
        applyLbTransform();
      });
    }
    if (btnLbZoomOut) {
      btnLbZoomOut.addEventListener('click', () => {
        lbZoom = Math.max(0.5, Number((lbZoom - 0.25).toFixed(2)));
        if (lbZoom <= 1.0) { lbPanX = 0; lbPanY = 0; }
        applyLbTransform();
      });
    }
    if (btnLbZoomReset) {
      btnLbZoomReset.addEventListener('click', resetLbTransform);
    }
    if (btnLbRotate) {
      btnLbRotate.addEventListener('click', () => {
        lbRotate = (lbRotate + 90) % 360;
        applyLbTransform();
      });
    }

    // Zoom via Scroll do Mouse (Wheel)
    if (lbStage) {
      lbStage.addEventListener('wheel', (e) => {
        e.preventDefault();
        const delta = e.deltaY < 0 ? 0.2 : -0.2;
        lbZoom = Math.max(0.5, Math.min(5.0, Number((lbZoom + delta).toFixed(2))));
        if (lbZoom <= 1.0) { lbPanX = 0; lbPanY = 0; }
        applyLbTransform();
      }, { passive: false });

      // Arrastar / Pan com mouse
      lbStage.addEventListener('mousedown', (e) => {
        if (lbZoom <= 1.0) return;
        isLbDragging = true;
        lbDragStartX = e.clientX - lbPanX;
        lbDragStartY = e.clientY - lbPanY;
        lbStage.classList.add('dragging');
      });
      window.addEventListener('mousemove', (e) => {
        if (!isLbDragging) return;
        lbPanX = e.clientX - lbDragStartX;
        lbPanY = e.clientY - lbDragStartY;
        applyLbTransform();
      });
      window.addEventListener('mouseup', () => {
        if (isLbDragging) {
          isLbDragging = false;
          if (lbStage) lbStage.classList.remove('dragging');
          applyLbTransform();
        }
      });

      // Arrastar no Celular (Touch Drag)
      let touchStartX = 0, touchStartY = 0;
      lbStage.addEventListener('touchstart', (e) => {
        if (!e.touches || e.touches.length !== 1 || lbZoom <= 1.0) return;
        touchStartX = e.touches[0].clientX - lbPanX;
        touchStartY = e.touches[0].clientY - lbPanY;
      }, { passive: true });
      lbStage.addEventListener('touchmove', (e) => {
        if (!e.touches || e.touches.length !== 1 || lbZoom <= 1.0) return;
        lbPanX = e.touches[0].clientX - touchStartX;
        lbPanY = e.touches[0].clientY - touchStartY;
        applyLbTransform();
      }, { passive: true });
    }

    // Baixar a imagem específica
    if (btnLbDownload) {
      btnLbDownload.addEventListener('click', async () => {
        if (!lbImg || !lbImg.src) return;
        try {
          const src = lbImg.src;
          const bookName = (state.title || 'livro').replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 30);
          let blob;
          if (src.startsWith('blob:') || src.startsWith('data:')) {
            const res = await fetch(src);
            blob = await res.blob();
          } else {
            const res = await fetch(src, { mode: 'cors' });
            blob = await res.blob();
          }
          const ext = blob.type.includes('jpeg') ? 'jpg' : (blob.type.includes('webp') ? 'webp' : 'png');
          const fileName = `${bookName}_img_${Date.now()}.${ext}`;
          const blobUrl = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = blobUrl;
          a.download = fileName;
          document.body.appendChild(a);
          a.click();
          setTimeout(() => {
            document.body.removeChild(a);
            URL.revokeObjectURL(blobUrl);
          }, 1000);
          showToast(`Imagem "${fileName}" baixada com sucesso!`);
        } catch (err) {
          const a = document.createElement('a');
          a.href = lbImg.src;
          a.download = `imagem_${Date.now()}.png`;
          a.target = '_blank';
          document.body.appendChild(a);
          a.click();
          document.body.removeChild(a);
          showToast('Download da imagem iniciado!');
        }
      });
    }

    // Copiar imagem para a área de transferência
    if (btnLbCopy) {
      btnLbCopy.addEventListener('click', () => {
        if (!lbImg || !lbImg.src) return;
        try {
          const img = new Image();
          img.crossOrigin = 'anonymous';
          img.onload = () => {
            const canvas = document.createElement('canvas');
            canvas.width = img.naturalWidth || img.width;
            canvas.height = img.naturalHeight || img.height;
            const ctx = canvas.getContext('2d');
            ctx.drawImage(img, 0, 0);
            canvas.toBlob(async (pngBlob) => {
              if (!pngBlob) { showToast('Não foi possível processar a imagem.'); return; }
              try {
                await navigator.clipboard.write([
                  new ClipboardItem({ 'image/png': pngBlob })
                ]);
                showToast('Imagem copiada para a área de transferência!');
              } catch {
                showToast('Acesso à área de transferência negado pelo navegador.');
              }
            }, 'image/png');
          };
          img.onerror = () => {
            showToast('Não foi possível copiar esta imagem.');
          };
          img.src = lbImg.src;
        } catch (e) {
          showToast('Copiar imagem não suportado neste navegador.');
        }
      });
    }

    // =====================================================================
    // 10C. FITA MARCADORA DE RETORNO DE LEITURA (VOCÊ PAROU AQUI)
    // =====================================================================
    window.showReadingReturnRibbon = function() {
      const existing = document.getElementById('readingReturnRibbon');
      if (existing) existing.remove();

      const ribbon = document.createElement('div');
      ribbon.id = 'readingReturnRibbon';
      ribbon.className = 'reading-return-ribbon';
      ribbon.innerHTML = '<span>Você parou aqui</span>';

      if (dom.viewport.classList.contains('paginated-mode')) {
        const sheet = document.getElementById('pageSheet');
        if (sheet) {
          ribbon.style.position = 'absolute';
          ribbon.style.top = '10px';
          ribbon.style.right = '16px';
          sheet.appendChild(ribbon);
        }
      } else {
        const paras = Array.from(dom.readerFlow.querySelectorAll('p, div, h1, h2, h3, img, section, blockquote'));
        const viewTop = dom.viewport.scrollTop;
        let targetEl = null;
        for (const p of paras) {
          if (p.offsetTop >= viewTop - 10) {
            targetEl = p;
            break;
          }
        }
        if (targetEl && targetEl.parentNode) {
          targetEl.parentNode.insertBefore(ribbon, targetEl);
        } else if (dom.readerFlow.firstChild) {
          dom.readerFlow.insertBefore(ribbon, dom.readerFlow.firstChild);
        }
      }

      setTimeout(() => {
        if (ribbon && ribbon.parentNode) {
          ribbon.style.transition = 'opacity 0.8s ease-out, transform 0.8s ease-out';
          ribbon.style.opacity = '0';
          ribbon.style.transform = 'translateY(-6px)';
          setTimeout(() => { if (ribbon.parentNode) ribbon.remove(); }, 850);
        }
      }, 6500);
    };

    // =====================================================================
    // 10D. GALERIA DE ILUSTRAÇÕES, MAPAS E IMAGENS DO LIVRO (SIDEBAR)
    // =====================================================================
    window.renderImageGallery = function() {
      const grid = document.getElementById('imagesGalleryGrid');
      const countEl = document.getElementById('lblImagesCount');
      if (!grid) return;
      grid.innerHTML = '';

      const foundImages = [];
      const seenSrc = new Set();

      function addImg(src, alt, sectionNum) {
        if (!src || src.startsWith('data:image/svg') || seenSrc.has(src)) return;
        seenSrc.add(src);
        foundImages.push({ src, alt: alt || `Ilustração ${foundImages.length + 1}`, section: sectionNum || 1 });
      }

      const currentImgs = dom.readerFlow.querySelectorAll('img');
      currentImgs.forEach((img, i) => {
        addImg(img.src, img.alt || `Cap. ${state.currentIndex + 1} · Imagem ${i + 1}`, state.currentIndex + 1);
      });

      if (state.sections && state.sections.length) {
        state.sections.forEach((sec, sIdx) => {
          if (sec.images && sec.images.length) {
            sec.images.forEach((imgSrc, iIdx) => {
              addImg(imgSrc, `Cap. ${sIdx + 1} · Imagem ${iIdx + 1}`, sIdx + 1);
            });
          } else if (sec.html && typeof sec.html === 'string' && sec.html.includes('<img')) {
            const matches = sec.html.matchAll(/src=["']([^"']+)["']/g);
            let imgCount = 1;
            for (const m of matches) {
              const src = m[1];
              addImg(src, `Cap. ${sIdx + 1} · Imagem ${imgCount++}`, sIdx + 1);
            }
          }
        });
      }

      if (countEl) countEl.textContent = String(foundImages.length);

      if (!foundImages.length) {
        grid.innerHTML = '<div style="grid-column:1/-1; font-size:11.5px; color:var(--text-muted); text-align:center; padding:24px 0;">Nenhuma ilustração ou mapa detectado neste livro.</div>';
        return;
      }

      foundImages.forEach((item, idx) => {
        const card = document.createElement('div');
        card.className = 'gallery-thumb-card';
        card.innerHTML = `
          <div class="gallery-thumb-wrap">
            <img src="${item.src}" alt="${escapeHtml(item.alt)}" loading="lazy" />
          </div>
          <div class="gallery-thumb-meta">
            <span class="gallery-thumb-title" title="${escapeHtml(item.alt)}">${escapeHtml(item.alt)}</span>
            <button class="tb-btn btn-dl-thumb" title="Baixar esta imagem" style="height:20px; width:20px; padding:0; font-size:11px; flex-shrink:0;">↓</button>
          </div>
        `;
        card.querySelector('.gallery-thumb-wrap').addEventListener('click', () => {
          if (typeof window.openImageLightbox === 'function') {
            window.openImageLightbox(item.src, `${state.title || 'Livro'} — ${item.alt}`);
          }
        });
        card.querySelector('.btn-dl-thumb').addEventListener('click', (e) => {
          e.stopPropagation();
          const a = document.createElement('a');
          a.href = item.src;
          a.download = `${(state.title || 'livro').replace(/[^a-zA-Z0-9_-]/g, '_')}_img_${idx + 1}.png`;
          document.body.appendChild(a);
          a.click();
          document.body.removeChild(a);
          showToast('Download da ilustração iniciado!');
        });
        grid.appendChild(card);
      });
    };

    // =====================================================================
    // 10E. CONVERSOR DE CAPÍTULO PARA ÁUDIO MP3 OFFLINE
    // =====================================================================
    async function exportCurrentChapterAudioMp3() {
      if (!state.sections.length || state.currentIndex < 0) {
        showToast('Abra um livro para exportar o áudio do capítulo.');
        return;
      }
      const sec = state.sections[state.currentIndex];
      const rawHtml = sec.html || '';
      const tempDiv = document.createElement('div');
      tempDiv.innerHTML = rawHtml;
      tempDiv.querySelectorAll('script, style, noscript, nav').forEach(el => el.remove());
      const text = (tempDiv.innerText || tempDiv.textContent || '').trim();
      if (!text || text.length < 15) {
        showToast('Este capítulo não possui texto suficiente para narrar.');
        return;
      }

      const isEnglish = (state.lang || '').toLowerCase().startsWith('en') || /[a-z]/i.test(text.slice(0, 50)) && !/[ãõéáíóúç]/i.test(text.slice(0, 100));
      const lang = isEnglish ? 'en' : 'pt-BR';
      showToast('Sintetizando áudio MP3 narrado do capítulo... Aguarde alguns instantes.');

      const chunks = [];
      const sentences = text.match(/[^.!?\n]+[.!?\n]+/g) || [text];
      let curChunk = '';
      for (const s of sentences) {
        const cleanS = s.trim();
        if (!cleanS) continue;
        if ((curChunk + ' ' + cleanS).length <= 160) {
          curChunk = curChunk ? (curChunk + ' ' + cleanS) : cleanS;
        } else {
          if (curChunk) chunks.push(curChunk);
          if (cleanS.length <= 160) {
            curChunk = cleanS;
          } else {
            const words = cleanS.split(' ');
            let sub = '';
            for (const w of words) {
              if ((sub + ' ' + w).length <= 160) sub = sub ? (sub + ' ' + w) : w;
              else { chunks.push(sub); sub = w; }
            }
            if (sub) chunks.push(sub);
            curChunk = '';
          }
        }
      }
      if (curChunk) chunks.push(curChunk);

      const toProcess = chunks.slice(0, 50);
      const audioBlobs = [];

      try {
        for (let i = 0; i < toProcess.length; i++) {
          const q = encodeURIComponent(toProcess[i]);
          const ttsUrl = `https://translate.google.com/translate_tts?ie=UTF-8&client=tw-ob&tl=${lang}&q=${q}`;
          const res = await fetch(ttsUrl);
          if (!res.ok) throw new Error('Falha no streaming de voz');
          const ab = await res.arrayBuffer();
          audioBlobs.push(ab);
          if (i % 6 === 0) {
            showToast(`Gerando áudio MP3: ${Math.round(((i + 1) / toProcess.length) * 100)}% concluído...`);
          }
        }

        const finalBlob = new Blob(audioBlobs, { type: 'audio/mp3' });
        const bookSlug = (state.title || 'livro').replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 25);
        const audioFileName = `${bookSlug}_Cap_${state.currentIndex + 1}_Audio.mp3`;
        const downloadUrl = URL.createObjectURL(finalBlob);
        const a = document.createElement('a');
        a.href = downloadUrl;
        a.download = audioFileName;
        document.body.appendChild(a);
        a.click();
        setTimeout(() => {
          document.body.removeChild(a);
          URL.revokeObjectURL(downloadUrl);
        }, 2000);
        showToast(`Áudio MP3 "${audioFileName}" baixado com sucesso!`);
      } catch (err) {
        showToast('Não foi possível gerar arquivo MP3 externo. Iniciando narração por voz local...');
        const btnPlay = document.getElementById('btnTtsPlayPause');
        if (btnPlay) btnPlay.click();
      }
    }

    const btnExportChapterAudioEl = document.getElementById('btnExportChapterAudio');
    if (btnExportChapterAudioEl) {
      btnExportChapterAudioEl.addEventListener('click', exportCurrentChapterAudioMp3);
    }

    /* =====================================================================
     * 11. NARRAÇÃO POR VOZ (TTS / READ-ALONG COM DESTAQUE DE PARÁGRAFO)
     * ===================================================================== */
    const ttsBar = document.getElementById('ttsBar');
    const selectTtsVoice = document.getElementById('selectTtsVoice');
    const selectTtsRate = document.getElementById('selectTtsRate');
    let ttsParagraphs = [];
    let ttsCurrentIdx = 0;
    let ttsPlaying = false;

    function populateVoices() {
      if (!('speechSynthesis' in window)) return;
      const voices = window.speechSynthesis.getVoices();
      if (!voices.length) return;
      selectTtsVoice.innerHTML = '';
      voices.forEach((v, i) => {
        const opt = document.createElement('option');
        opt.value = String(i);
        opt.textContent = `${v.name} (${v.lang})`;
        if (v.lang.toLowerCase().startsWith('pt') && !selectTtsVoice.value) opt.selected = true;
        selectTtsVoice.appendChild(opt);
      });
    }
    if ('speechSynthesis' in window) {
      populateVoices();
      window.speechSynthesis.onvoiceschanged = populateVoices;
    }

    function collectReadableParagraphs() {
      const blocks = Array.from(dom.readerFlow.querySelectorAll('h1, h2, h3, p, li, blockquote'));
      return blocks.filter(el => el.textContent && el.textContent.trim().length > 2);
    }

    function clearTtsHighlight() {
      dom.readerFlow.querySelectorAll('.tts-speaking').forEach(el => el.classList.remove('tts-speaking'));
    }

    function speakCurrentParagraph() {
      if (!('speechSynthesis' in window)) {
        alert('Seu navegador não suporta síntese de voz (Web Speech API).');
        return;
      }
      window.speechSynthesis.cancel();
      clearTtsHighlight();

      if (!ttsParagraphs.length) {
        ttsParagraphs = collectReadableParagraphs();
      }
      if (!ttsParagraphs.length) {
        showToast('Nenhum parágrafo de texto disponível nesta página para narração.');
        return;
      }

      ttsCurrentIdx = Math.max(0, Math.min(ttsParagraphs.length - 1, ttsCurrentIdx));
      const targetEl = ttsParagraphs[ttsCurrentIdx];
      targetEl.classList.add('tts-speaking');
      targetEl.scrollIntoView({ behavior: 'smooth', block: 'center' });

      const text = targetEl.textContent.replace(/\s+/g, ' ').trim();
      const utter = new SpeechSynthesisUtterance(text);
      utter.rate = parseFloat(selectTtsRate.value || '1.0');
      const voices = window.speechSynthesis.getVoices();
      const vIdx = parseInt(selectTtsVoice.value, 10);
      if (!isNaN(vIdx) && voices[vIdx]) {
        utter.voice = voices[vIdx];
        utter.lang = voices[vIdx].lang;
      }

      document.getElementById('lblTtsStatus').textContent = `Lendo parágrafo ${ttsCurrentIdx + 1} de ${ttsParagraphs.length}`;
      document.getElementById('btnTtsPlayPause').textContent = '⏸ Pausar';
      ttsPlaying = true;

      utter.onend = async () => {
        if (!ttsPlaying) return;
        if (ttsCurrentIdx < ttsParagraphs.length - 1) {
          ttsCurrentIdx++;
          speakCurrentParagraph();
        } else {
          const chkAutoNext = document.getElementById('chkTtsAutoNext');
          const hasNextSec = state.book && Array.isArray(state.book.sections) && (state.currentSectionIndex + 1) < state.book.sections.length;
          if (chkAutoNext && chkAutoNext.checked && hasNextSec) {
            await renderSection(state.currentSectionIndex + 1, { scrollToEnd: false });
            setTimeout(() => {
              if (typeof collectParagraphs === 'function') collectParagraphs();
              if (ttsParagraphs.length > 0) {
                ttsCurrentIdx = 0;
                speakCurrentParagraph();
              }
            }, 350);
            return;
          }
          ttsPlaying = false;
          clearTtsHighlight();
          document.getElementById('btnTtsPlayPause').textContent = '▶ Ouvir';
          document.getElementById('lblTtsStatus').textContent = 'Capítulo concluído';
        }
      };

      window.speechSynthesis.speak(utter);
    }

    // --- Sleep Timer do TTS ---
    let __ttsSleepTimerId = null;
    const selTtsSleepEl = document.getElementById('selectTtsSleepTimer');
    if (selTtsSleepEl) {
      selTtsSleepEl.addEventListener('change', () => {
        if (__ttsSleepTimerId) { clearTimeout(__ttsSleepTimerId); __ttsSleepTimerId = null; }
        const mins = parseInt(selTtsSleepEl.value, 10) || 0;
        if (mins > 0) {
          __ttsSleepTimerId = setTimeout(() => {
            ttsPlaying = false;
            try { window.speechSynthesis.cancel(); } catch {}
            clearTtsHighlight();
            document.getElementById('btnTtsPlayPause').textContent = '▶ Ouvir';
            document.getElementById('lblTtsStatus').textContent = 'Timer encerrado';
            selTtsSleepEl.value = '0';
            showToast(`Timer de sono (${mins} min) pausou o áudio.`);
          }, mins * 60000);
          showToast(`Sleep timer definido para ${mins} min.`);
        }
      });
    }

    // --- Pomodoro Timer (25 min) com registro automático no Reading Insights ---
    let __pomodoroMinutes = parseInt(localStorage.getItem('reader_pomodoro_minutes') || '25', 10) || 25;
    let __pomodoroSec = __pomodoroMinutes * 60;
    let __pomodoroInterval = null;
    const pomWidgetEl = document.getElementById('pomodoroWidget');
    const chkPomEnableEl = document.getElementById('chkEnablePomodoro');
    const selPomMinEl = document.getElementById('selectPomodoroMinutes');
    const btnPomodoroEl = document.getElementById('btnPomodoroToggle');
    const btnPomResetEl = document.getElementById('btnPomodoroReset');
    const lblPomodoroEl = document.getElementById('lblPomodoroTimer');
    function updatePomodoroDisplay() {
      if (!lblPomodoroEl) return;
      const m = String(Math.floor(__pomodoroSec / 60)).padStart(2, '0');
      const s = String(__pomodoroSec % 60).padStart(2, '0');
      lblPomodoroEl.textContent = `⏱ ${m}:${s}`;
    }
    function resetPomodoroTimer(silent = false) {
      if (__pomodoroInterval) {
        clearInterval(__pomodoroInterval);
        __pomodoroInterval = null;
      }
      __pomodoroSec = __pomodoroMinutes * 60;
      if (btnPomodoroEl) btnPomodoroEl.classList.remove('active');
      updatePomodoroDisplay();
      if (!silent) showToast(`Pomodoro reiniciado para ${__pomodoroMinutes} min.`);
    }
    function syncPomodoroVisibility() {
      const enabled = localStorage.getItem('reader_pomodoro_enabled') === '1';
      if (chkPomEnableEl) chkPomEnableEl.checked = enabled;
      if (pomWidgetEl) pomWidgetEl.classList.toggle('hidden', !enabled);
    }
    if (selPomMinEl) {
      selPomMinEl.value = String(__pomodoroMinutes);
      selPomMinEl.addEventListener('change', () => {
        __pomodoroMinutes = parseInt(selPomMinEl.value, 10) || 25;
        localStorage.setItem('reader_pomodoro_minutes', String(__pomodoroMinutes));
        resetPomodoroTimer(true);
        showToast(`Duração do Pomodoro ajustada para ${__pomodoroMinutes} min.`);
      });
    }
    if (chkPomEnableEl) {
      chkPomEnableEl.addEventListener('change', () => {
        localStorage.setItem('reader_pomodoro_enabled', chkPomEnableEl.checked ? '1' : '0');
        if (!chkPomEnableEl.checked) resetPomodoroTimer(true);
        syncPomodoroVisibility();
      });
    }
    syncPomodoroVisibility();
    if (btnPomResetEl) btnPomResetEl.addEventListener('click', () => resetPomodoroTimer(false));
    if (btnPomodoroEl && lblPomodoroEl) {
      updatePomodoroDisplay();
      btnPomodoroEl.addEventListener('click', () => {
        if (__pomodoroInterval) {
          clearInterval(__pomodoroInterval);
          __pomodoroInterval = null;
          btnPomodoroEl.classList.remove('active');
          showToast('Pomodoro pausado.');
          return;
        }
        btnPomodoroEl.classList.add('active');
        showToast(`Pomodoro de ${__pomodoroMinutes} min iniciado! Bom foco.`);
        __pomodoroInterval = setInterval(() => {
          __pomodoroSec--;
          if (__pomodoroSec <= 0) {
            const doneMins = __pomodoroMinutes;
            resetPomodoroTimer(true);
            try {
              const ins = getReadingInsights();
              const dKey = getLocalDateKey();
              ins.minutesByDate[dKey] = (ins.minutesByDate[dKey] || 0) + doneMins;
              saveReadingInsights(ins);
            } catch {}
            showToast(`Pomodoro concluído! +${doneMins} min registrados nas Metas.`);
            return;
          }
          updatePomodoroDisplay();
        }, 1000);
      });
    }

    // --- Definir página atual (PDF / Mangá) como capa do livro ---
    const btnSetPageCoverEl = document.getElementById('btnSetPageAsCover');
    if (btnSetPageCoverEl) {
      btnSetPageCoverEl.addEventListener('click', () => {
        const bk = state.bookKey || (state.book && state.book.bookKey);
        if (!bk || !state.sections || !state.sections.length) {
          showToast('Abra um livro primeiro.', true);
          return;
        }
        let srcEl = null;
        const pdfCvs = document.getElementById('pdfCanvas');
        if (pdfCvs && pdfCvs.width > 0 && pdfCvs.height > 0 && !pdfCvs.closest('.hidden')) {
          srcEl = pdfCvs;
        } else {
          const imgs = Array.from(document.querySelectorAll('.manga-page-wrap img, #readerFlow img'));
          srcEl = imgs.find(im => im.complete && (im.naturalWidth > 0 || im.width > 0)) || null;
        }
        if (!srcEl) {
          showToast('Nenhuma página visual (PDF/Mangá/HQ) visível para capturar como capa.', true);
          return;
        }
        try {
          const w = srcEl.width || srcEl.naturalWidth;
          const h = srcEl.height || srcEl.naturalHeight;
          const scale = Math.min(1, 420 / Math.max(1, w));
          const c = document.createElement('canvas');
          c.width = Math.max(1, Math.round(w * scale));
          c.height = Math.max(1, Math.round(h * scale));
          c.getContext('2d').drawImage(srcEl, 0, 0, c.width, c.height);
          const dataUrl = c.toDataURL('image/jpeg', 0.85);
          const safe = safeCloudFileName(state.currentFileName || state.title || 'livro');
          saveBookCoverDataUrl(bk, safe, dataUrl);
          if (typeof renderBookshelf === 'function') renderBookshelf();
          showToast('Página atual definida como capa do livro!');
        } catch (err) {
          showToast('Não foi possível capturar a página (CORS ou canvas protegido).', true);
        }
      });
    }

    // --- Revisão Espaçada Anki Interna (SRS) ---
    let __srsQueue = [];
    let __srsRevealed = false;
    function renderAnkiSrsCard() {
      const box = document.getElementById('ankiSrsBox');
      if (!box) return;
      if (!__srsQueue.length) {
        box.innerHTML = '<div style="font-size:12px; color:var(--accent); font-weight:600;">Revisão concluída! Nenhum cartão pendente agora.</div>';
        setTimeout(() => { box.classList.add('hidden'); }, 1800);
        return;
      }
      const card = __srsQueue[0];
      box.classList.remove('hidden');
      box.innerHTML = `
        <div style="font-size:11px; color:var(--text-muted); margin-bottom:4px;">Restantes na fila: ${__srsQueue.length}</div>
        <div style="font-size:15px; font-weight:700; margin-bottom:6px;">${escapeHtml(card.front)}</div>
        ${__srsRevealed ? `
          <div style="font-size:13px; color:var(--text-primary); padding:6px 8px; background:var(--bg-elevated); border-radius:6px; margin-bottom:8px;">
            ${escapeHtml(card.back || '(Sem resposta)')}
            ${card.context ? `<div style="font-size:11px; color:var(--text-muted); margin-top:4px; font-style:italic;">"${escapeHtml(card.context.slice(0, 140))}"</div>` : ''}
          </div>
          <div style="display:flex; gap:4px; flex-wrap:wrap;">
            <button class="tb-btn srs-rate-btn" data-r="again" style="flex:1; font-size:11px; height:26px;">Errei (1d)</button>
            <button class="tb-btn srs-rate-btn" data-r="hard" style="flex:1; font-size:11px; height:26px;">Difícil</button>
            <button class="tb-btn tb-btn-solid srs-rate-btn" data-r="good" style="flex:1; font-size:11px; height:26px;">Bom</button>
            <button class="tb-btn srs-rate-btn" data-r="easy" style="flex:1; font-size:11px; height:26px;">Fácil</button>
          </div>
        ` : `<button id="btnSrsShowAnswer" class="tb-btn tb-btn-solid" style="width:100%; height:28px;">Mostrar Resposta</button>`}
      `;
      const showBtn = document.getElementById('btnSrsShowAnswer');
      if (showBtn) {
        showBtn.addEventListener('click', () => { __srsRevealed = true; renderAnkiSrsCard(); });
      }
      box.querySelectorAll('.srs-rate-btn').forEach(btn => {
        btn.addEventListener('click', () => {
          const rating = btn.dataset.r;
          const all = getVocabList();
          const idx = all.findIndex(c => c.id === card.id);
          if (idx >= 0) {
            all[idx] = computeNextSrsCardState(all[idx], rating);
            saveVocabList(all);
          }
          __srsQueue.shift();
          __srsRevealed = false;
          renderAnkiSrsCard();
        });
      });
    }
    const btnStartSrsEl = document.getElementById('btnStartAnkiSrsReview');
    if (btnStartSrsEl) {
      btnStartSrsEl.addEventListener('click', () => {
        const now = Date.now();
        const all = getVocabList();
        const due = all.filter(c => !c.dueAt || c.dueAt <= now);
        __srsQueue = due.length ? due.slice() : all.slice();
        __srsRevealed = false;
        if (!__srsQueue.length) {
          showToast('Salve palavras/cartões primeiro para revisar no SRS.', true);
          return;
        }
        renderAnkiSrsCard();
      });
    }

    document.getElementById('btnTtsToggle').addEventListener('click', () => {
      const open = ttsBar.classList.toggle('open');
      document.getElementById('btnTtsToggle').classList.toggle('active', open);
      if (open) {
        populateVoices();
        ttsParagraphs = collectReadableParagraphs();
        ttsCurrentIdx = 0;
      } else if ('speechSynthesis' in window) {
        ttsPlaying = false;
        window.speechSynthesis.cancel();
        clearTtsHighlight();
      }
    });

    document.getElementById('btnTtsPlayPause').addEventListener('click', () => {
      if (!('speechSynthesis' in window)) return;
      if (ttsPlaying && window.speechSynthesis.speaking && !window.speechSynthesis.paused) {
        window.speechSynthesis.pause();
        document.getElementById('btnTtsPlayPause').textContent = '▶ Continuar';
      } else if (ttsPlaying && window.speechSynthesis.paused) {
        window.speechSynthesis.resume();
        document.getElementById('btnTtsPlayPause').textContent = '⏸ Pausar';
      } else {
        ttsParagraphs = collectReadableParagraphs();
        speakCurrentParagraph();
      }
    });

    document.getElementById('btnTtsPrevPara').addEventListener('click', () => {
      ttsParagraphs = collectReadableParagraphs();
      ttsCurrentIdx = Math.max(0, ttsCurrentIdx - 1);
      speakCurrentParagraph();
    });

    document.getElementById('btnTtsNextPara').addEventListener('click', () => {
      ttsParagraphs = collectReadableParagraphs();
      ttsCurrentIdx = Math.min(Math.max(0, ttsParagraphs.length - 1), ttsCurrentIdx + 1);
      speakCurrentParagraph();
    });

    document.getElementById('btnTtsStop').addEventListener('click', () => {
      ttsPlaying = false;
      if ('speechSynthesis' in window) window.speechSynthesis.cancel();
      clearTtsHighlight();
      document.getElementById('btnTtsPlayPause').textContent = '▶ Ouvir';
      document.getElementById('lblTtsStatus').textContent = 'Parado';
    });

    document.getElementById('btnSelSpeak').addEventListener('click', () => {
      if (!state.selectedText || !('speechSynthesis' in window)) return;
      window.speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(state.selectedText);
      u.rate = parseFloat(selectTtsRate.value || '1.0');
      window.speechSynthesis.speak(u);
      dom.selectionToolbar.classList.remove('open');
    });

    /* =====================================================================
     * 12. CONVERSOR DE EBOOKS (GERADOR EPUB ZIP / HTML / MD / TXT),
     *     TRADUTOR DE CAPÍTULO INTEIRO E RESUMO + ESTATÍSTICAS
     * ===================================================================== */
    const sessionStartTime = Date.now();

    // Gerador CRC32 e Empacotador ZIP (Método Store = 0) para criar arquivos .EPUB válidos no navegador
    const crcTable = (() => {
      const t = new Uint32Array(256);
      for (let i = 0; i < 256; i++) {
        let c = i;
        for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
        t[i] = c >>> 0;
      }
      return t;
    })();

    function crc32(bytes) {
      let crc = 0xFFFFFFFF;
      for (let i = 0; i < bytes.length; i++) {
        crc = crcTable[(crc ^ bytes[i]) & 0xFF] ^ (crc >>> 8);
      }
      return (crc ^ 0xFFFFFFFF) >>> 0;
    }

    function createZipBlob(files, mimeType = 'application/epub+zip') {
      const encoder = new TextEncoder();
      const localParts = [];
      const centralParts = [];
      let offset = 0;

      files.forEach(f => {
        const nameBytes = encoder.encode(f.path);
        const dataBytes = typeof f.content === 'string' ? encoder.encode(f.content) : f.content;
        const crc = crc32(dataBytes);
        const size = dataBytes.length;

        const localHdr = new Uint8Array(30 + nameBytes.length);
        const lv = new DataView(localHdr.buffer);
        lv.setUint32(0, 0x04034b50, true);
        lv.setUint16(4, 20, true);
        lv.setUint16(6, 0x0800, true); // UTF-8
        lv.setUint16(8, 0, true);      // Store
        lv.setUint32(14, crc, true);
        lv.setUint32(18, size, true);
        lv.setUint32(22, size, true);
        lv.setUint16(26, nameBytes.length, true);
        localHdr.set(nameBytes, 30);

        const centralHdr = new Uint8Array(46 + nameBytes.length);
        const cv = new DataView(centralHdr.buffer);
        cv.setUint32(0, 0x02014b50, true);
        cv.setUint16(4, 20, true);
        cv.setUint16(6, 20, true);
        cv.setUint16(8, 0x0800, true);
        cv.setUint16(10, 0, true);
        cv.setUint32(16, crc, true);
        cv.setUint32(20, size, true);
        cv.setUint32(24, size, true);
        cv.setUint16(28, nameBytes.length, true);
        cv.setUint32(42, offset, true);
        centralHdr.set(nameBytes, 46);

        localParts.push(localHdr, dataBytes);
        centralParts.push(centralHdr);
        offset += localHdr.length + dataBytes.length;
      });

      const centralSize = centralParts.reduce((acc, b) => acc + b.length, 0);
      const eocd = new Uint8Array(22);
      const ev = new DataView(eocd.buffer);
      ev.setUint32(0, 0x06054b50, true);
      ev.setUint16(8, files.length, true);
      ev.setUint16(10, files.length, true);
      ev.setUint32(12, centralSize, true);
      ev.setUint32(16, offset, true);

      return new Blob([...localParts, ...centralParts, eocd], { type: mimeType });
    }

    // Gerador Binário nativo de arquivos .MOBI (PalmDOC / Mobipocket PDB + EXTH UTF-8)
    function createMobiBlob(title, author, sections) {
      const encoder = new TextEncoder();
      const bodyParts = sections.map(s => `<h2>${escapeHtml(s.title)}</h2>\n` + (s.html || `<p>${escapeHtml(s.text || '')}</p>`));
      const fullHtml = `<html><head><title>${escapeHtml(title)}</title></head><body><h1>${escapeHtml(title)}</h1><p><i>${escapeHtml(author)}</i></p><mbp:pagebreak/>${bodyParts.join('\n<mbp:pagebreak/>\n')}</body></html>`;
      const textBytes = encoder.encode(fullHtml);

      // Fatiar texto em blocos de até 4096 bytes sem cortar sequências UTF-8 no meio
      const textRecords = [];
      let pos = 0;
      while (pos < textBytes.length) {
        let end = Math.min(pos + 4096, textBytes.length);
        if (end < textBytes.length) {
          while (end > pos && (textBytes[end] & 0xC0) === 0x80) end--;
        }
        textRecords.push(textBytes.subarray(pos, end));
        pos = end;
      }
      if (!textRecords.length) textRecords.push(encoder.encode('<html><body></body></html>'));

      const titleBytes = encoder.encode(title || 'Livro Convertido');
      const authorBytes = encoder.encode(author || 'Autor');

      // Bloco EXTH (Autor = tipo 100, Título = tipo 503)
      const exthRec100Len = 8 + authorBytes.length;
      const exthRec503Len = 8 + titleBytes.length;
      const exthRawLen = 12 + exthRec100Len + exthRec503Len;
      const exthPaddedLen = Math.ceil(exthRawLen / 4) * 4;
      const exthBuf = new Uint8Array(exthPaddedLen);
      const exthView = new DataView(exthBuf.buffer);
      exthBuf.set(encoder.encode('EXTH'), 0);
      exthView.setUint32(4, exthRawLen, false);
      exthView.setUint32(8, 2, false);
      exthView.setUint32(12, 100, false);
      exthView.setUint32(16, exthRec100Len, false);
      exthBuf.set(authorBytes, 20);
      const r2Off = 12 + exthRec100Len;
      exthView.setUint32(r2Off, 503, false);
      exthView.setUint32(r2Off + 4, exthRec503Len, false);
      exthBuf.set(titleBytes, r2Off + 8);

      // Record 0: 16 bytes PalmDOC + 232 bytes MOBI Header + EXTH + Full Name
      const mobiHeaderLen = 232;
      const fullNameOffset = 16 + mobiHeaderLen + exthPaddedLen;
      const rec0Len = Math.ceil((fullNameOffset + titleBytes.length + 2) / 4) * 4;
      const rec0 = new Uint8Array(rec0Len);
      const r0v = new DataView(rec0.buffer);

      // PalmDOC Header (16 bytes)
      r0v.setUint16(0, 1, false); // Compression = 1 (Uncompressed)
      r0v.setUint32(4, textBytes.length, false);
      r0v.setUint16(8, textRecords.length, false);
      r0v.setUint16(10, 4096, false);

      // MOBI Header (inicia no byte 16)
      rec0.set(encoder.encode('MOBI'), 16);
      r0v.setUint32(20, mobiHeaderLen, false);
      r0v.setUint32(24, 2, false);     // MOBI type: 2 (Book)
      r0v.setUint32(28, 65001, false); // Encoding: 65001 (UTF-8)
      r0v.setUint32(32, Math.floor(Math.random() * 0x7FFFFFFF), false);
      r0v.setUint32(36, 6, false);     // File version: 6
      for (let p = 40; p < 80; p += 4) r0v.setUint32(p, 0xFFFFFFFF, false);
      r0v.setUint32(80, textRecords.length + 1, false); // First non-book index
      r0v.setUint32(84, fullNameOffset, false);
      r0v.setUint32(88, titleBytes.length, false);
      r0v.setUint32(92, 0x0416, false); // Locale: pt-BR (0x0416)
      r0v.setUint32(104, 6, false);     // Min version
      r0v.setUint32(108, textRecords.length + 1, false); // First image index
      r0v.setUint32(128, 0x40, false);  // EXTH flag (bit 6 = 0x40)
      r0v.setUint16(192, 1, false);     // First content record = 1
      r0v.setUint16(194, textRecords.length, false); // Last content record

      rec0.set(exthBuf, 16 + mobiHeaderLen);
      rec0.set(titleBytes, fullNameOffset);

      // FLIS, FCIS e EOF Records
      const flisRec = new Uint8Array([
        0x46,0x4C,0x49,0x53, 0x00,0x00,0x00,0x08, 0x00,0x41, 0x00,0x00, 0x00,0x00,0x00,0x00,
        0xFF,0xFF,0xFF,0xFF, 0x00,0x01, 0x00,0x03, 0x00,0x00,0x00,0x03, 0x00,0x00,0x00,0x01,
        0xFF,0xFF,0xFF,0xFF
      ]);
      const eofRec = new Uint8Array([0xE9, 0x8E, 0x0D, 0x0A]);
      const allRecords = [rec0, ...textRecords, flisRec, eofRec];

      // Cabeçalho PDB (78 bytes + 8 bytes por registro + 2 bytes de alinhamento)
      const numRecs = allRecords.length;
      const pdbHdrSize = 78 + numRecs * 8 + 2;
      const pdbHdr = new Uint8Array(pdbHdrSize);
      const pv = new DataView(pdbHdr.buffer);

      const safePdbName = (title || 'Livro').replace(/[^\x20-\x7E]/g, '_').slice(0, 31);
      pdbHdr.set(encoder.encode(safePdbName), 0);
      const nowSec = Math.floor(Date.now() / 1000) + 2082844800;
      pv.setUint32(36, nowSec, false);
      pv.setUint32(40, nowSec, false);
      pdbHdr.set(encoder.encode('BOOKMOBI'), 60);
      pv.setUint16(76, numRecs, false);

      let curOff = pdbHdrSize;
      for (let i = 0; i < numRecs; i++) {
        pv.setUint32(78 + i * 8, curOff, false);
        pv.setUint32(78 + i * 8 + 4, i * 2, false);
        curOff += allRecords[i].length;
      }

      return new Blob([pdbHdr, ...allRecords], { type: 'application/x-mobipocket-ebook' });
    }

    // Estado de arquivo avulso carregado direto na aba do Conversor
    let standaloneConvertBook = null;

    async function convertCurrentBook(overrideTargetFmt) {
      let bookTitle = state.title || 'livro_convertido';
      let bookAuthor = state.author || 'Autor';
      let bookFormat = state.format || 'EPUB';
      let bookSections = state.sections || [];
      let rawBuffer = state.currentFileBuffer;

      if (standaloneConvertBook) {
        bookTitle = standaloneConvertBook.title;
        bookAuthor = standaloneConvertBook.author;
        bookFormat = standaloneConvertBook.format;
        bookSections = standaloneConvertBook.sections;
        rawBuffer = standaloneConvertBook.buffer;
      }

      if (!bookSections.length) {
        alert('Abra um livro no leitor ou selecione um arquivo na caixa de upload acima para converter.');
        return;
      }

      const fmtSelect = document.getElementById('selectConvertFormat');
      if (typeof overrideTargetFmt === 'string' && overrideTargetFmt) {
        fmtSelect.value = overrideTargetFmt;
      }
      const targetFmt = fmtSelect.value;
      const safeTitle = (bookTitle || 'livro_convertido').replace(/[<>:"/\\|?*]+/g, '_');

      // Garantir que todas as seções tenham texto/HTML carregado
      for (const sec of bookSections) {
        if (bookFormat === 'PDF' && sec.text === null && !standaloneConvertBook) await ensurePdfSectionText(sec);
        else if (sec.html === null && sec.buildHtml) sec.html = sec.buildHtml(sec.rawSlice);
      }

      const triggerDownload = (blob, ext, msg) => {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${safeTitle}.${ext}`;
        a.click();
        setTimeout(() => URL.revokeObjectURL(url), 2000);
        document.getElementById('toolsModalStatus').textContent = msg;
        showToast(msg);
      };

      if (targetFmt === 'epub') {
        const zipFiles = [
          { path: 'mimetype', content: 'application/epub+zip' },
          {
            path: 'META-INF/container.xml',
            content: `<?xml version="1.0" encoding="UTF-8"?>\n<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>`
          }
        ];

        const manifestItems = [];
        const spineItems = [];
        const navPoints = [];

        bookSections.forEach((sec, idx) => {
          const id = `ch_${idx + 1}`;
          const fname = `${id}.xhtml`;
          const paras = (sec.text || '').split(/\r?\n+/).filter(Boolean).map(p => `<p>${escapeHtml(p.trim())}</p>`).join('\n');
          const xhtml = `<?xml version="1.0" encoding="utf-8"?>\n<!DOCTYPE html>\n<html xmlns="http://www.w3.org/1999/xhtml"><head><title>${escapeHtml(sec.title)}</title><meta charset="utf-8"/></head><body><h2>${escapeHtml(sec.title)}</h2>\n${paras}\n</body></html>`;
          zipFiles.push({ path: `OEBPS/${fname}`, content: xhtml });
          manifestItems.push(`<item id="${id}" href="${fname}" media-type="application/xhtml+xml"/>`);
          spineItems.push(`<itemref idref="${id}"/>`);
          navPoints.push(`<navPoint id="nav_${idx + 1}" playOrder="${idx + 1}"><navLabel><text>${escapeHtml(sec.title)}</text></navLabel><content src="${fname}"/></navPoint>`);
        });

        const opf = `<?xml version="1.0" encoding="utf-8"?>\n<package xmlns="http://www.idpf.org/2007/opf" unique-identifier="BookId" version="2.0"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>${escapeHtml(bookTitle)}</dc:title><dc:creator>${escapeHtml(bookAuthor)}</dc:creator><dc:language>pt</dc:language><dc:identifier id="BookId">urn:uuid:${Date.now()}</dc:identifier></metadata><manifest><item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>${manifestItems.join('')}</manifest><spine toc="ncx">${spineItems.join('')}</spine></package>`;
        const ncx = `<?xml version="1.0" encoding="utf-8"?>\n<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1"><head><meta name="dtb:uid" content="urn:uuid:${Date.now()}"/></head><docTitle><text>${escapeHtml(bookTitle)}</text></docTitle><navMap>${navPoints.join('')}</navMap></ncx>`;

        zipFiles.push({ path: 'OEBPS/content.opf', content: opf });
        zipFiles.push({ path: 'OEBPS/toc.ncx', content: ncx });

        triggerDownload(createZipBlob(zipFiles), 'epub', 'Livro convertido para .EPUB e baixado!');
      } else if (targetFmt === 'mobi' || targetFmt === 'azw3') {
        const blob = createMobiBlob(bookTitle, bookAuthor, bookSections);
        const ext = targetFmt === 'azw3' ? 'azw3' : 'mobi';
        triggerDownload(blob, ext, `Livro convertido para .${ext.toUpperCase()} (Kindle) e baixado!`);
      } else if (targetFmt === 'docx') {
        const chaptersHtml = bookSections.map(s => `<h2>${escapeHtml(s.title)}</h2>${s.html || `<p>${escapeHtml(s.text || '')}</p>`}<br clear="all" style="page-break-before:always" />`).join('\n');
        const wordDoc = `<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word" xmlns="http://www.w3.org/TR/REC-html40"><head><meta charset="utf-8"><title>${escapeHtml(bookTitle)}</title><style>body{font-family:Georgia,serif;font-size:12pt;line-height:1.6;}h1,h2{color:#111;}p{text-align:justify;margin-bottom:8pt;}</style></head><body><h1>${escapeHtml(bookTitle)}</h1><p><i>${escapeHtml(bookAuthor)}</i></p><hr/>${chaptersHtml}</body></html>`;
        const blob = new Blob(['\uFEFF' + wordDoc], { type: 'application/msword;charset=utf-8' });
        triggerDownload(blob, 'doc', 'Livro convertido para Documento WORD (.DOC) e baixado!');
      } else if (targetFmt === 'rtf') {
        const rtfEsc = (str) => String(str || '').replace(/\\/g, '\\\\').replace(/\{/g, '\\{').replace(/\}/g, '\\}').replace(/[\u0080-\uFFFF]/g, ch => `\\u${ch.charCodeAt(0)}?`);
        const rtfBody = bookSections.map(s => `\\pard\\sa200\\b\\fs32 ${rtfEsc(s.title)}\\b0\\fs24\\par\n` + (s.text || '').split(/\r?\n+/).filter(Boolean).map(p => `\\pard\\sa160\\qj ${rtfEsc(p.trim())}\\par`).join('\n')).join('\n\\page\n');
        const rtfContent = `{\\rtf1\\ansi\\ansicpg1252\\deff0{\\fonttbl{\\f0 Georgia;}}\\f0\\fs24 \\pard\\qc\\b\\fs40 ${rtfEsc(bookTitle)}\\b0\\par\\pard\\qc\\i\\fs26 ${rtfEsc(bookAuthor)}\\i0\\par\\page\n${rtfBody}}`;
        const blob = new Blob([rtfContent], { type: 'application/rtf' });
        triggerDownload(blob, 'rtf', 'Livro convertido para Rich Text (.RTF) e baixado!');
      } else if (targetFmt === 'odt') {
        const parasXml = bookSections.map(s => `<text:h text:outline-level="2">${escapeHtml(s.title)}</text:h>` + (s.text || '').split(/\r?\n+/).filter(Boolean).map(p => `<text:p>${escapeHtml(p.trim())}</text:p>`).join('')).join('');
        const contentXml = `<?xml version="1.0" encoding="UTF-8"?><office:document-content xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0" office:version="1.2"><office:body><office:text><text:h text:outline-level="1">${escapeHtml(bookTitle)}</text:h><text:p>${escapeHtml(bookAuthor)}</text:p>${parasXml}</office:text></office:body></office:document-content>`;
        const manifestXml = `<?xml version="1.0" encoding="UTF-8"?><manifest:manifest xmlns:manifest="urn:oasis:names:tc:opendocument:xmlns:manifest:1.0"><manifest:file-entry manifest:media-type="application/vnd.oasis.opendocument.text" manifest:full-path="/"/><manifest:file-entry manifest:media-type="text/xml" manifest:full-path="content.xml"/></manifest:manifest>`;
        const odtBlob = createZipBlob([
          { path: 'mimetype', content: 'application/vnd.oasis.opendocument.text' },
          { path: 'content.xml', content: contentXml },
          { path: 'META-INF/manifest.xml', content: manifestXml }
        ]);
        triggerDownload(odtBlob, 'odt', 'Livro convertido para OpenDocument (.ODT) e baixado!');
      } else if (targetFmt === 'pdf') {
        if (bookFormat === 'PDF' && rawBuffer) {
          triggerDownload(new Blob([rawBuffer], { type: 'application/pdf' }), 'pdf', 'Arquivo .PDF baixado!');
          return;
        }
        const chaptersHtml = bookSections.map(s => `<section class="pdf-ch"><h2>${escapeHtml(s.title)}</h2>${s.html || `<p>${escapeHtml(s.text || '')}</p>`}</section>`).join('\n');
        const printWin = window.open('', '_blank');
        if (!printWin) {
          alert('Permita pop-ups neste site para gerar o documento .PDF.');
          return;
        }
        printWin.document.write(`<!DOCTYPE html><html lang="pt-BR"><head><meta charset="utf-8"><title>${escapeHtml(safeTitle)}</title><style>
          @page { size: A4; margin: 20mm 18mm; }
          body { font-family: Georgia, "Times New Roman", serif; font-size: 12pt; line-height: 1.65; color: #111; margin: 0; padding: 0; }
          .cover { text-align: center; padding: 120px 20px; page-break-after: always; }
          .cover h1 { font-size: 26pt; margin-bottom: 12px; }
          .cover p { font-size: 14pt; color: #444; font-style: italic; }
          .pdf-ch { page-break-before: always; }
          h2 { font-size: 16pt; margin-top: 0; margin-bottom: 14px; border-bottom: 1px solid #ddd; padding-bottom: 6px; }
          p { text-indent: 1.4em; margin: 0 0 0.55em 0; text-align: justify; }
          img { max-width: 100%; height: auto; page-break-inside: avoid; }
          .no-print-bar { position: sticky; top: 0; background: #1c1d22; color: #fff; padding: 10px 18px; font-family: sans-serif; font-size: 13px; display: flex; justify-content: space-between; align-items: center; }
          .no-print-bar button { background: #2f5e4e; color: #fff; border: none; padding: 6px 14px; border-radius: 5px; cursor: pointer; font-weight: 600; }
          @media print { .no-print-bar { display: none !important; } }
        </style></head><body>
          <div class="no-print-bar">
            <span>Pronto para salvar como <b>${escapeHtml(safeTitle)}.pdf</b> — na janela de impressão, escolha o destino <b>"Salvar como PDF"</b>.</span>
            <button onclick="window.print()">Salvar como .PDF agora</button>
          </div>
          <div class="cover"><h1>${escapeHtml(bookTitle)}</h1><p>${escapeHtml(bookAuthor)}</p></div>
          ${chaptersHtml}
          <script>window.onload = function(){ setTimeout(function(){ window.print(); }, 350); };<\/script>
        </body></html>`);
        printWin.document.close();
        showToast('Janela de exportação .PDF aberta! Escolha "Salvar como PDF".');
      } else if (targetFmt === 'html') {
        const chaptersHtml = bookSections.map(s => `<section style="margin-bottom:3em;"><h2>${escapeHtml(s.title)}</h2>${s.html || `<p>${escapeHtml(s.text || '')}</p>`}</section>`).join('\n<hr/>\n');
        const fullHtml = `<!DOCTYPE html><html lang="pt-BR"><head><meta charset="utf-8"><title>${escapeHtml(bookTitle)}</title><style>body{max-width:740px;margin:40px auto;padding:0 20px;font-family:Georgia,serif;line-height:1.7;color:#222;background:#fbf8f1;}img{max-width:100%;}</style></head><body><h1>${escapeHtml(bookTitle)}</h1><p><em>${escapeHtml(bookAuthor)}</em></p><hr/>${chaptersHtml}</body></html>`;
        triggerDownload(new Blob([fullHtml], { type: 'text/html;charset=utf-8' }), 'html', 'Livro exportado em .HTML único!');
      } else if (targetFmt === 'md') {
        const md = `# ${bookTitle}\n*${bookAuthor}*\n\n` + bookSections.map(s => `## ${s.title}\n\n${s.text || ''}`).join('\n\n---\n\n');
        triggerDownload(new Blob([md], { type: 'text/markdown;charset=utf-8' }), 'md', 'Livro convertido para Markdown (.MD)!');
      } else {
        const txt = `${bookTitle} - ${bookAuthor}\n\n` + bookSections.map(s => `=== ${s.title} ===\n\n${s.text || ''}`).join('\n\n');
        triggerDownload(new Blob([txt], { type: 'text/plain;charset=utf-8' }), 'txt', 'Livro convertido para Texto (.TXT)!');
      }
    }

    function switchStudioPane(paneId) {
      document.querySelectorAll('[data-studio-pane]').forEach(b => {
        b.classList.toggle('active', b.dataset.studioPane === paneId);
      });
      document.querySelectorAll('.studio-pane').forEach(p => {
        p.classList.toggle('active', p.id === paneId);
      });
      if (paneId === 'paneStudioQuotes') {
        renderQuotesManager();
      } else if (paneId === 'paneStudioXray') {
        renderXRayStudioPane();
      } else if (paneId === 'paneStudioInsights') {
        renderReadingInsightsPane();
      } else if (paneId === 'paneStudioReviews') {
        renderReviewsStudioPane();
      } else if (paneId === 'paneStudioKindle') {
        loadKindleConfigIntoUi();
      } else if (paneId === 'paneStudioSummary' && !document.getElementById('inputSumSource').value.trim() && state.sections.length) {
        loadCurrentChapterIntoSummarizer();
      }
    }

    const openToolsModalFn = (defaultPane) => {
      document.getElementById('toolsModal').classList.add('open');
      if (typeof defaultPane === 'string' && defaultPane.startsWith('paneStudio')) {
        switchStudioPane(defaultPane);
      }
      if (!standaloneConvertBook && state.title) {
        document.getElementById('convSelectedFileLabel').textContent = `Livro ativo pronto p/ converter: "${state.title}" (${state.format}) — ou clique aqui para enviar outro arquivo`;
      }
    };

    document.querySelectorAll('[data-studio-pane]').forEach(btn => {
      btn.addEventListener('click', () => switchStudioPane(btn.dataset.studioPane));
    });
    document.querySelectorAll('[data-open-studio-tab]').forEach(btn => {
      btn.addEventListener('click', () => openToolsModalFn(btn.dataset.openStudioTab));
    });
    document.getElementById('btnStudioGoReader').addEventListener('click', () => {
      document.getElementById('toolsModal').classList.remove('open');
    });


    document.getElementById('btnCloseToolsModal').addEventListener('click', () => {
      document.getElementById('toolsModal').classList.remove('open');
    });
    document.getElementById('btnCloseToolsFooter').addEventListener('click', () => {
      document.getElementById('toolsModal').classList.remove('open');
    });
    document.getElementById('btnRunConvert').addEventListener('click', () => convertCurrentBook());

    // Upload avulso na aba de Conversão + Presets Populares
    const convDropZone = document.getElementById('convDropZone');
    const convUploadInput = document.getElementById('convUploadInput');
    convDropZone.addEventListener('click', () => convUploadInput.click());
    convDropZone.addEventListener('dragover', (e) => { e.preventDefault(); convDropZone.classList.add('dragover'); });
    convDropZone.addEventListener('dragleave', () => convDropZone.classList.remove('dragover'));
    convDropZone.addEventListener('drop', async (e) => {
      e.preventDefault();
      convDropZone.classList.remove('dragover');
      if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0]) {
        await handleConvStandaloneFile(e.dataTransfer.files[0]);
      }
    });
    convUploadInput.addEventListener('change', async (e) => {
      if (e.target.files && e.target.files[0]) {
        await handleConvStandaloneFile(e.target.files[0]);
      }
    });

    async function handleConvStandaloneFile(file) {
      try {
        document.getElementById('convSelectedFileLabel').textContent = `Carregando "${file.name}" para conversão...`;
        const buffer = await file.arrayBuffer();
        const parsed = await parseAnyBookBuffer(buffer, file.name);
        if (parsed.format === 'PDF') {
          for (const sec of parsed.sections) {
            if (sec.text === null) {
              const page = await state.pdfDoc.getPage(sec.pdfPageNum);
              const tc = await page.getTextContent();
              sec.text = tc.items.map(i => i.str).join(' ');
              sec.html = `<p>${escapeHtml(sec.text)}</p>`;
            }
          }
        }
        standaloneConvertBook = { ...parsed, buffer, fileName: file.name };
        document.getElementById('convSelectedFileLabel').textContent = `Arquivo selecionado: "${file.name}" (${parsed.format}, ${parsed.sections.length} seções) — escolha o formato abaixo e clique em Converter!`;
        showToast(`Arquivo "${file.name}" pronto para converter!`);
      } catch (err) {
        alert('Erro ao ler arquivo para conversão: ' + err.message);
      }
    }

    document.getElementById('btnConvClearFile').addEventListener('click', () => {
      standaloneConvertBook = null;
      document.getElementById('convSelectedFileLabel').textContent = state.title
        ? `Usando o livro aberto atualmente: "${state.title}" (${state.format})`
        : 'Clique aqui para selecionar um arquivo do computador';
      showToast('Usando o livro aberto no leitor');
    });

    document.querySelectorAll('.conv-preset-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const target = btn.dataset.convTarget;
        document.getElementById('selectConvertFormat').value = target;
        if (!standaloneConvertBook && !state.sections.length) {
          convUploadInput.click();
          showToast(`Selecione o arquivo para converter para .${target.toUpperCase()}`);
        } else {
          convertCurrentBook(target);
        }
      });
    });

    /* =====================================================================
     * CONVERSOR DE MANGÁS P/ KINDLE (KCC WEB & CALIBRE RTL)
     * ===================================================================== */
    async function convertMangaForKindle(sendToAmazon = false) {
      const statusEl = document.getElementById('kccStatusMsg');
      const dirRadio = document.querySelector('input[name="kccDirection"]:checked');
      const dir = dirRadio ? dirRadio.value : 'rtl';
      let title = state.title || 'Manga';
      let fileBuf = state.currentFileBuffer;
      let fileName = state.title ? `${state.title}.cbz` : 'manga.cbz';

      if (standaloneConvertBook) {
        title = standaloneConvertBook.title || 'Manga';
        fileBuf = standaloneConvertBook.buffer;
        fileName = standaloneConvertBook.fileName || `${title}.cbz`;
      }

      if (!fileBuf) {
        alert('Abra um mangá/HQ no leitor ou selecione um arquivo .cbz, .zip ou .epub no conversor.');
        return;
      }

      if (statusEl) statusEl.textContent = 'Processando páginas e ajustando direção para Kindle...';

      try {
        const isEpubInput = fileName.toLowerCase().endsWith('.epub') || (state.format === 'EPUB' && !standaloneConvertBook);

        if (isEpubInput) {
          const zip = await openZipBuffer(fileBuf);
          const zipEntries = [];
          for (const [p, entry] of zip.entries.entries()) {
            let bytes = await zip.readBytes(p);
            if (p.toLowerCase().endsWith('.opf')) {
              let opfText = new TextDecoder('utf-8').decode(bytes);
              if (opfText.includes('page-progression-direction')) {
                opfText = opfText.replace(/page-progression-direction="[^"]*"/gi, `page-progression-direction="${dir}"`);
              } else {
                opfText = opfText.replace(/<spine\b([^>]*)>/i, `<spine$1 page-progression-direction="${dir}">`);
              }
              if (!opfText.includes('rendition:layout')) {
                opfText = opfText.replace('</metadata>', '  <meta property="rendition:layout">pre-paginated</meta>\n  <meta property="rendition:orientation">auto</meta>\n  <meta property="rendition:spread">auto</meta>\n</metadata>');
              }
              bytes = new TextEncoder().encode(opfText);
            }
            zipEntries.push({ path: p, content: bytes });
          }
          const outBlob = createZipBlob(zipEntries, 'application/epub+zip');
          const cleanName = title.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 40);
          const finalName = `${cleanName}_Kindle_${dir.toUpperCase()}.epub`;
          const u = URL.createObjectURL(outBlob);
          const a = document.createElement('a');
          a.href = u;
          a.download = finalName;
          a.click();
          setTimeout(() => URL.revokeObjectURL(u), 3000);
          if (statusEl) statusEl.textContent = `EPUB corrigido com sucesso para ${dir.toUpperCase()} e baixado!`;
          showToast(`Mangá Kindle (${dir.toUpperCase()}) gerado!`);
        } else {
          const zip = await openZipBuffer(fileBuf);
          const imgEntries = [];
          for (const [p, entry] of zip.entries.entries()) {
            if (/\.(jpe?g|png|webp|avif|bmp)$/i.test(p) && !p.includes('__MACOSX')) {
              imgEntries.push(p);
            }
          }
          if (!imgEntries.length) throw new Error('Nenhuma imagem encontrada no arquivo .cbz / .zip.');
          imgEntries.sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }));

          const zipFiles = [
            { path: 'mimetype', content: 'application/epub+zip' },
            {
              path: 'META-INF/container.xml',
              content: '<?xml version="1.0" encoding="UTF-8"?>\n<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>'
            }
          ];

          const manifest = [];
          const spine = [];
          const navMap = [];

          for (let i = 0; i < imgEntries.length; i++) {
            const imgPath = imgEntries[i];
            const imgBytes = await zip.readBytes(imgPath);
            const ext = (imgPath.split('.').pop() || 'jpg').toLowerCase();
            const mime = ext === 'png' ? 'image/png' : (ext === 'webp' ? 'image/webp' : 'image/jpeg');
            const imgId = `img_${i + 1}`;
            const pageId = `page_${i + 1}`;
            const imgTarget = `images/p_${String(i + 1).padStart(4, '0')}.${ext}`;
            const pageTarget = `pages/p_${String(i + 1).padStart(4, '0')}.xhtml`;

            zipFiles.push({ path: `OEBPS/${imgTarget}`, content: imgBytes });

            const pageXhtml = `<?xml version="1.0" encoding="utf-8"?>\n<!DOCTYPE html>\n<html xmlns="http://www.w3.org/1999/xhtml">\n<head>\n  <title>Pág. ${i + 1}</title>\n  <meta name="viewport" content="width=1200, height=1600" />\n  <style type="text/css">\n    @page { margin: 0; padding: 0; }\n    body { margin: 0; padding: 0; background: #000; text-align: center; }\n    img { width: 100vw; height: 100vh; object-fit: contain; }\n  </style>\n</head>\n<body><img src="../${imgTarget}" alt="Pág ${i + 1}" /></body>\n</html>`;
            zipFiles.push({ path: `OEBPS/${pageTarget}`, content: pageXhtml });
            manifest.push(`<item id="${imgId}" href="${imgTarget}" media-type="${mime}"/>`);
            manifest.push(`<item id="${pageId}" href="${pageTarget}" media-type="application/xhtml+xml"/>`);
            spine.push(`<itemref idref="${pageId}"/>`);
            navMap.push(`<navPoint id="nav_${i + 1}" playOrder="${i + 1}"><navLabel><text>Página ${i + 1}</text></navLabel><content src="${pageTarget}"/></navPoint>`);
          }

          const opf = `<?xml version="1.0" encoding="utf-8"?>\n<package xmlns="http://www.idpf.org/2007/opf" unique-identifier="BookId" version="3.0">\n  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">\n    <dc:title>${escapeHtml(title)}</dc:title>\n    <dc:language>ja</dc:language>\n    <dc:identifier id="BookId">urn:uuid:${Date.now()}</dc:identifier>\n    <meta property="rendition:layout">pre-paginated</meta>\n    <meta property="rendition:orientation">auto</meta>\n    <meta property="rendition:spread">auto</meta>\n  </metadata>\n  <manifest>\n    <item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>\n    ${manifest.join('\n    ')}\n  </manifest>\n  <spine page-progression-direction="${dir}" toc="ncx">\n    ${spine.join('\n    ')}\n  </spine>\n</package>`;

          const ncx = `<?xml version="1.0" encoding="utf-8"?>\n<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1">\n  <head><meta name="dtb:uid" content="urn:uuid:${Date.now()}"/></head>\n  <docTitle><text>${escapeHtml(title)}</text></docTitle>\n  <navMap>${navMap.join('\n')}</navMap>\n</ncx>`;

          zipFiles.push({ path: 'OEBPS/content.opf', content: opf });
          zipFiles.push({ path: 'OEBPS/toc.ncx', content: ncx });

          const outBlob = createZipBlob(zipFiles, 'application/epub+zip');
          const cleanName = title.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 40);
          const finalName = `${cleanName}_Kindle_${dir.toUpperCase()}.epub`;
          const u = URL.createObjectURL(outBlob);
          const a = document.createElement('a');
          a.href = u;
          a.download = finalName;
          a.click();
          setTimeout(() => URL.revokeObjectURL(u), 3000);
          if (statusEl) statusEl.textContent = `EPUB Mangá Fixed-Layout gerado com ${imgEntries.length} páginas!`;
          showToast(`Mangá Kindle (${dir.toUpperCase()}) gerado!`);
        }

        if (sendToAmazon) {
          window.open('https://www.amazon.com/sendtokindle', '_blank', 'noopener');
          showToast('Abrindo Send to Kindle oficial da Amazon!');
        }
      } catch (err) {
        if (statusEl) statusEl.textContent = 'Erro ao converter mangá: ' + err.message;
        showToast('Erro: ' + err.message, true);
      }
    }

    const btnKccConvertEl = document.getElementById('btnRunKccConvert');
    if (btnKccConvertEl) btnKccConvertEl.addEventListener('click', () => convertMangaForKindle(false));
    const btnKccSendEl = document.getElementById('btnKccSendKindle');
    if (btnKccSendEl) btnKccSendEl.addEventListener('click', () => convertMangaForKindle(true));
    const btnKccUseBookEl = document.getElementById('btnKccUseOpenBook');
    if (btnKccUseBookEl) {
      btnKccUseBookEl.addEventListener('click', () => {
        standaloneConvertBook = null;
        const msg = state.title ? `Usando mangá aberto: "${state.title}"` : 'Nenhum mangá aberto.';
        const statusEl = document.getElementById('kccStatusMsg');
        if (statusEl) statusEl.textContent = msg;
        showToast(msg);
      });
    }

    const btnMenuKcc = document.getElementById('btnMenuKccManga');
    if (btnMenuKcc) {
      btnMenuKcc.addEventListener('click', () => {
        const toolsDd = document.getElementById('toolsDropdown');
        if (toolsDd) toolsDd.classList.remove('open');
        const userDd = document.getElementById('userProfileDropdown');
        if (userDd) userDd.classList.remove('open');
        if (typeof openToolsModalFn === 'function') openToolsModalFn('paneStudioConvert');
        else {
          const btnSt = document.getElementById('btnToolsStudio');
          if (btnSt) btnSt.click();
        }
        setTimeout(() => {
          const box = document.getElementById('kccConverterBox');
          if (box) box.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }, 150);
      });
    }

    const chkPrefetchEl = document.getElementById('chkAutoPrefetchChapter');
    if (chkPrefetchEl) {
      chkPrefetchEl.checked = Boolean(state.autoPrefetchChapters);
      chkPrefetchEl.addEventListener('change', () => {
        state.autoPrefetchChapters = chkPrefetchEl.checked;
        localStorage.setItem('reader_autoPrefetch', String(chkPrefetchEl.checked));
        showToast(state.autoPrefetchChapters ? 'Pré-carregamento automático de mangá ativado' : 'Pré-carregamento desativado (só carrega ao clicar)');
      });
    }

    /* =====================================================================
     * NOTEBOOK LM SUITE: CHAT GROUNDED, PODCAST 2-HOSTS & GUIA DE ESTUDO
     * ===================================================================== */
    const inpGemini = document.getElementById('inputGeminiApiKey');
    if (inpGemini) {
      inpGemini.value = state.geminiApiKey || '';
      document.getElementById('btnSaveGeminiKey').addEventListener('click', () => {
        state.geminiApiKey = inpGemini.value.trim();
        localStorage.setItem('reader_geminiApiKey', state.geminiApiKey);
        showToast(state.geminiApiKey ? 'Chave Gemini API salva com sucesso!' : 'Chave removida. Usando modo offline.');
      });
    }

    async function callGeminiOrLocal(prompt, bookContext) {
      if (state.geminiApiKey) {
        try {
          const resp = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${encodeURIComponent(state.geminiApiKey)}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              contents: [{
                parts: [
                  { text: `Você é o assistente inteligente de leitura NotebookLM. Responda em português com clareza e embasamento no texto da obra fornecida.\n\nCONTEXTO DO LIVRO:\n${bookContext.slice(0, 40000)}\n\nPERGUNTA/TAREFA:\n${prompt}` }
                ]
              }]
            })
          });
          if (resp.ok) {
            const data = await resp.json();
            const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
            if (text) return text;
          }
        } catch (e) {
          console.warn('Erro Gemini API:', e);
        }
      }
      const queryWords = prompt.toLowerCase().split(/\s+/).filter(w => w.length > 3);
      const matchedSecs = (state.sections || []).filter(s => {
        const t = (s.text || '').toLowerCase();
        return queryWords.some(w => t.includes(w));
      }).slice(0, 3);

      if (matchedSecs.length) {
        const snippets = matchedSecs.map((s, idx) => `[Seção ${s.pageNumber || idx + 1}: ${s.title}]\n"...${(s.text || '').slice(0, 240).trim()}..."`).join('\n\n');
        return `Passagens identificadas no livro "${state.title}":\n\n${snippets}\n\n(Dica: adicione sua chave gratuita do Gemini no campo acima para respostas detalhadas com IA)`;
      }
      return `Com base na obra "${state.title}", os temas abordados tratam da jornada principal dos capítulos lidos.`;
    }

    let podcastUtterances = [];
    let podcastPlaying = false;

    async function generatePodcastScript() {
      const curSec = state.sections[state.currentIndex] || state.sections[0];
      const context = curSec ? (curSec.text || '').slice(0, 6000) : '';
      const prompt = `Crie um diálogo de podcast dinâmico entre dois apresentadores (Alex e Sam) conversando sobre este capítulo de "${state.title}". 
      Alex é curioso e entusiasmado; Sam é perspicaz e aprofunda os significados.
      Formato estrito (5 falas):
      Alex: ...
      Sam: ...
      Alex: ...
      Sam: ...
      Alex: ...`;

      let scriptText = '';
      if (state.geminiApiKey) {
        scriptText = await callGeminiOrLocal(prompt, context);
      } else {
        scriptText = `Alex: Cara, você viu o que aconteceu neste capítulo de "${state.title}"? O autor constrói uma atmosfera incrível logo nas primeiras linhas!\n` +
          `Sam: Com certeza, Alex! O ponto alto é como o texto aprofunda a motivação dos personagens de forma sutil.\n` +
          `Alex: Exatamente! Dá muita vontade de ver o que vai acontecer a seguir.\n` +
          `Sam: Essa é a marca de uma boa narrativa. Vale a pena reler com atenção aos detalhes!`;
      }

      const box = document.getElementById('nlmPodcastBox');
      const scriptDiv = document.getElementById('nlmPodcastScript');
      if (box) box.style.display = 'flex';
      if (scriptDiv) {
        scriptDiv.innerHTML = '';
        const lines = scriptText.split('\n').filter(l => l.includes(':'));
        podcastUtterances = [];
        lines.forEach(line => {
          const isHost1 = /^Alex/i.test(line);
          const host = isHost1 ? 'Alex' : 'Sam';
          const speech = line.replace(/^(Alex|Sam):\s*/i, '').trim();
          const b = document.createElement('div');
          b.className = `nlm-podcast-bubble ${isHost1 ? 'host1' : 'host2'}`;
          b.innerHTML = `<strong>${host}:</strong> ${escapeHtml(speech)}`;
          scriptDiv.appendChild(b);
          podcastUtterances.push({ host, text: speech });
        });
      }
      showToast('Roteiro do podcast gerado!');
    }

    function playPodcast() {
      if (!('speechSynthesis' in window)) {
        alert('Seu navegador não suporta síntese de voz.');
        return;
      }
      window.speechSynthesis.cancel();
      podcastPlaying = true;
      const bPlay = document.getElementById('btnPlayPodcastAudio');
      const bStop = document.getElementById('btnStopPodcastAudio');
      if (bPlay) bPlay.style.display = 'none';
      if (bStop) bStop.style.display = 'inline-block';

      const voices = window.speechSynthesis.getVoices().filter(v => v.lang.startsWith('pt') || v.lang.startsWith('en'));
      const voice1 = voices[0] || null;
      const voice2 = voices[1] || voices[0] || null;

      let idx = 0;
      function speakNext() {
        if (!podcastPlaying || idx >= podcastUtterances.length) {
          stopPodcast();
          return;
        }
        const item = podcastUtterances[idx++];
        const u = new SpeechSynthesisUtterance(item.text);
        if (item.host === 'Alex') {
          u.voice = voice1;
          u.pitch = 1.15;
          u.rate = 1.05;
        } else {
          u.voice = voice2;
          u.pitch = 0.9;
          u.rate = 1.0;
        }
        u.onend = () => setTimeout(speakNext, 300);
        u.onerror = () => stopPodcast();
        window.speechSynthesis.speak(u);
      }
      speakNext();
    }

    function stopPodcast() {
      podcastPlaying = false;
      if ('speechSynthesis' in window) window.speechSynthesis.cancel();
      const bPlay = document.getElementById('btnPlayPodcastAudio');
      const bStop = document.getElementById('btnStopPodcastAudio');
      if (bPlay) bPlay.style.display = 'inline-block';
      if (bStop) bStop.style.display = 'none';
    }

    const btnNlmPodGen = document.getElementById('btnNlmPodcastGen');
    if (btnNlmPodGen) btnNlmPodGen.addEventListener('click', generatePodcastScript);
    const btnPlayPod = document.getElementById('btnPlayPodcastAudio');
    if (btnPlayPod) btnPlayPod.addEventListener('click', playPodcast);
    const btnStopPod = document.getElementById('btnStopPodcastAudio');
    if (btnStopPod) btnStopPod.addEventListener('click', stopPodcast);

    // Chat Grounded com o Livro
    const btnSendNlm = document.getElementById('btnSendNlmQuestion');
    const inputNlm = document.getElementById('inputNlmQuestion');
    if (btnSendNlm && inputNlm) {
      const doSend = async () => {
        const q = inputNlm.value.trim();
        if (!q) return;
        inputNlm.value = '';
        const list = document.getElementById('nlmChatList');
        const userMsg = document.createElement('div');
        userMsg.className = 'nlm-msg user';
        userMsg.textContent = q;
        list.appendChild(userMsg);
        list.scrollTop = list.scrollHeight;

        const aiMsg = document.createElement('div');
        aiMsg.className = 'nlm-msg ai';
        aiMsg.textContent = 'Pensando com base no livro...';
        list.appendChild(aiMsg);
        list.scrollTop = list.scrollHeight;

        const curSec = state.sections[state.currentIndex] || state.sections[0];
        const context = curSec ? (curSec.text || '').slice(0, 10000) : '';
        const ans = await callGeminiOrLocal(q, context);
        aiMsg.innerHTML = `<strong>NotebookLM:</strong> ${escapeHtml(ans).replace(/\n/g, '<br/>')}`;
        list.scrollTop = list.scrollHeight;
      };
      btnSendNlm.addEventListener('click', doSend);
      inputNlm.addEventListener('keydown', (e) => { if (e.key === 'Enter') doSend(); });
    }

    // Guia de Estudo e Exportação Markdown
    const btnStudyGuide = document.getElementById('btnNlmStudyGuide');
    if (btnStudyGuide) {
      btnStudyGuide.addEventListener('click', async () => {
        const container = document.getElementById('nlmStudyGuideContainer');
        const content = document.getElementById('nlmStudyGuideContent');
        if (container) container.style.display = 'block';
        if (content) content.innerHTML = '<em>Gerando Guia de Estudo NotebookLM...</em>';

        const curSec = state.sections[state.currentIndex] || state.sections[0];
        const context = curSec ? (curSec.text || '').slice(0, 8000) : '';
        const prompt = `Crie um Guia de Estudo estruturado estilo NotebookLM para o livro "${state.title}".\n1. RESUMO EXECUTIVO\n2. 5 CONCEITOS E LIÇÕES-CHAVE\n3. FAQ DO CAPÍTULO\n4. GLOSSÁRIO`;
        const res = await callGeminiOrLocal(prompt, context);
        if (content) content.innerText = res;
        showToast('Guia de Estudo gerado com sucesso!');
      });
    }

    const btnNlmExport = document.getElementById('btnNlmExportMarkdown');
    if (btnNlmExport) {
      btnNlmExport.addEventListener('click', () => {
        const contentEl = document.getElementById('nlmStudyGuideContent');
        const txt = contentEl ? contentEl.innerText : '';
        if (!txt || txt.startsWith('Gerando')) {
          alert('Clique em "Gerar Guia de Estudo Completo" primeiro para criar o conteúdo.');
          return;
        }
        const md = `---\ntitle: "Dossiê NotebookLM - ${state.title}"\nauthor: "${state.author}"\ndate: "${new Date().toISOString()}"\ntags: [estudo, leitura, notebooklm]\n---\n\n# ${state.title}\n\n${txt}`;
        const blob = new Blob([md], { type: 'text/markdown;charset=utf-8' });
        const u = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = u;
        a.download = `${(state.title || 'livro').replace(/[^a-zA-Z0-9_-]/g, '_')}_NotebookLM.md`;
        a.click();
        setTimeout(() => URL.revokeObjectURL(u), 2000);
        showToast('Guia exportado para Markdown / Obsidian!');
      });
    }

    // Leitura Biônica Toggle
    const chkBionicEl = document.getElementById('chkEnableBionic');
    if (chkBionicEl) {
      chkBionicEl.checked = Boolean(state.bionicReading);
      chkBionicEl.addEventListener('change', () => {
        state.bionicReading = chkBionicEl.checked;
        applySettings();
        if (state.sections.length && !dom.viewport.classList.contains('continuous-mode')) {
          renderSection();
        }
        showToast(state.bionicReading ? 'Leitura Biônica ativada' : 'Leitura Biônica desativada');
      });
    }

    // QR Code de Continuação no Celular
    const btnMenuQr = document.getElementById('btnMenuQrCode');
    if (btnMenuQr) {
      btnMenuQr.addEventListener('click', () => {
        const userDd = document.getElementById('userProfileDropdown');
        if (userDd) userDd.classList.remove('open');
        const toolsDd = document.getElementById('toolsDropdown');
        if (toolsDd) toolsDd.classList.remove('open');

        const modal = document.getElementById('qrCodeModal');
        const container = document.getElementById('qrCodeContainer');
        const txt = document.getElementById('qrCodeLinkText');
        if (!modal || !container) return;

        const url = new URL(window.location.href);
        if (state.bookKey) {
          url.searchParams.set('book', state.bookKey);
          url.searchParams.set('sec', String(state.currentIndex));
        }
        const fullUrl = url.toString();
        if (txt) txt.textContent = fullUrl;

        const qrApi = `https://api.qrserver.com/v1/create-qr-code/?size=180x180&data=${encodeURIComponent(fullUrl)}`;
        container.innerHTML = `<img src="${qrApi}" alt="QR Code de Leitura" style="width:180px; height:180px; display:block;" onerror="this.parentElement.innerHTML='<div style=\\'font-size:12px;color:var(--accent);\\'>Copie o link abaixo para abrir no celular.</div>'" />`;
        modal.classList.add('open');
      });
    }
    const btnCloseQr = document.getElementById('btnCloseQrModal');
    if (btnCloseQr) {
      btnCloseQr.addEventListener('click', () => {
        const modal = document.getElementById('qrCodeModal');
        if (modal) modal.classList.remove('open');
      });
    }
    const qrModalBackdrop = document.getElementById('qrCodeModal');
    if (qrModalBackdrop) {
      qrModalBackdrop.addEventListener('click', (e) => {
        if (e.target === qrModalBackdrop) qrModalBackdrop.classList.remove('open');
      });
    }
    const btnCopyQr = document.getElementById('btnCopyQrUrl');
    if (btnCopyQr) {
      btnCopyQr.addEventListener('click', () => {
        const txt = document.getElementById('qrCodeLinkText');
        if (txt && txt.textContent) {
          navigator.clipboard.writeText(txt.textContent).then(() => showToast('Link de leitura copiado!'));
        }
      });
    }

    // Arrastar e Soltar Global (Drag and Drop)
    window.addEventListener('dragover', (e) => { e.preventDefault(); });
    window.addEventListener('drop', async (e) => {
      if (e.target && e.target.closest('#convDropZone')) return;
      e.preventDefault();
      if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0]) {
        const file = e.dataTransfer.files[0];
        const ext = (file.name.split('.').pop() || '').toLowerCase();
        if (['epub', 'pdf', 'cbz', 'zip', 'mobi', 'azw', 'azw3', 'prc', 'txt', 'html'].includes(ext)) {
          showToast(`Carregando "${file.name}"...`);
          const buf = await file.arrayBuffer();
          await loadFile({ name: file.name, size: file.size, buffer: buf });
        }
      }
    });

    const btnTtsCloseEl = document.getElementById('btnTtsClose');
    if (btnTtsCloseEl) {
      btnTtsCloseEl.addEventListener('click', () => {
        ttsBar.classList.remove('open');
        document.getElementById('btnTtsToggle').classList.remove('active');
        ttsPlaying = false;
        if ('speechSynthesis' in window) window.speechSynthesis.cancel();
        clearTtsHighlight();
      });
    }

    // Consulta Direta na Wikipédia (PT e EN)
    async function fetchWikipediaSummary(queryText) {
      const term = (queryText || '').trim().replace(/[.,!?;:"'()[\]{}«»“”]/g, '');
      if (!term) return;
      dom.modalStatus.textContent = `Consultando Wikipédia para "${term}"...`;
      for (const lang of ['pt', 'en']) {
        try {
          const url = `https://${lang}.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(term)}`;
          const res = await fetch(url);
          if (res.ok) {
            const data = await res.json();
            if (data && data.extract) {
              dom.inputAnkiBack.value = `[Wikipédia ${lang.toUpperCase()}] ${data.extract}`;
              dom.modalStatus.textContent = `Resumo carregado da Wikipédia (${lang.toUpperCase()}).`;
              return;
            }
          }
        } catch {}
      }
      dom.modalStatus.textContent = 'Artigo exato não encontrado na Wikipédia; traduzindo termo...';
      await fetchTranslation(term);
    }

    document.getElementById('btnModalFetchWiki').addEventListener('click', () => {
      fetchWikipediaSummary(dom.inputAnkiFront.value);
    });
    document.getElementById('btnExtWikipedia').addEventListener('click', () => {
      const w = dom.inputAnkiFront.value.trim() || '';
      window.open(`https://pt.wikipedia.org/wiki/Special:Search?search=${encodeURIComponent(w)}`, '_blank', 'noopener');
    });

    // Importador de Artigo Web / Web Novel (Web Page Clipping)
    document.getElementById('btnClipWebPage').addEventListener('click', async () => {
      const url = document.getElementById('inputClipWebUrl').value.trim();
      if (!url) {
        alert('Informe a URL de um artigo, capítulo web ou feed OPDS.');
        return;
      }
      const statusEl = document.getElementById('toolsModalStatus');
      statusEl.textContent = 'Capturando conteúdo da página web...';
      try {
        let htmlText = '';
        try {
          const directRes = await fetch(url);
          if (directRes.ok) htmlText = await directRes.text();
        } catch {}
        if (!htmlText) {
          const proxyRes = await fetch(`https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`);
          if (!proxyRes.ok) throw new Error(`HTTP ${proxyRes.status}`);
          htmlText = await proxyRes.text();
        }
        const doc = new DOMParser().parseFromString(htmlText, 'text/html');
        doc.querySelectorAll('script, style, nav, footer, iframe, noscript').forEach(el => el.remove());
        const title = (doc.querySelector('h1') ? doc.querySelector('h1').textContent : doc.title || 'Artigo Web').trim();
        const mainNode = doc.querySelector('article, main, [role="main"]') || doc.body;
        const paras = Array.from(mainNode.querySelectorAll('h1, h2, h3, p, blockquote, pre'))
          .map(el => el.outerHTML)
          .join('\n');
        const cleanHtml = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${escapeHtml(title)}</title></head><body><h1>${escapeHtml(title)}</h1><p><small>Fonte: ${escapeHtml(url)}</small></p>${paras || mainNode.innerHTML}</body></html>`;
        const buf = new TextEncoder().encode(cleanHtml).buffer;
        document.getElementById('toolsModal').classList.remove('open');
        await loadFile({ name: `${title.replace(/[<>:"/\\|?*]+/g, '_').slice(0, 50)}.html`, size: buf.byteLength, buffer: buf });
        showToast('Página Web importada para a Estante e aberta no leitor!');
      } catch (err) {
        statusEl.textContent = 'Erro ao capturar página: ' + err.message;
      }
    });

    /* =====================================================================
     * 12B. LOGIN & INTEGRAÇÃO DIRETA COM O ANKI (ANKICONNECT + ANKIWEB API)
     * ===================================================================== */
    function getAnkiConfig() {
      try {
        return JSON.parse(localStorage.getItem('reader_anki_config') || '{}');
      } catch {
        return {};
      }
    }

    function saveAnkiConfigObj(cfg) {
      localStorage.setItem('reader_anki_config', JSON.stringify(cfg));
    }

    function loadAnkiConfigIntoUi() {
      const cfg = getAnkiConfig();
      document.getElementById('inputAnkiConnectUrl').value = cfg.connectUrl || 'http://127.0.0.1:8765';
      document.getElementById('inputAnkiDefaultDeck').value = cfg.defaultDeck || 'Leitura';
      document.getElementById('inputAnkiWebUser').value = cfg.ankiWebUser || '';
      document.getElementById('inputAnkiWebPass').value = cfg.ankiWebPass || '';
      document.getElementById('inputAnkiWebEndpoint').value = cfg.ankiWebEndpoint || '/api/ankiweb';

      const deckSelect = document.getElementById('selectAnkiDeckModal');
      if (deckSelect && cfg.defaultDeck) {
        if (!Array.from(deckSelect.options).some(o => o.value === cfg.defaultDeck)) {
          const opt = document.createElement('option');
          opt.value = cfg.defaultDeck;
          opt.textContent = cfg.defaultDeck;
          deckSelect.appendChild(opt);
        }
        deckSelect.value = cfg.defaultDeck;
      }
    }

    const openAnkiAccountModalFn = () => {
      loadAnkiConfigIntoUi();
      document.getElementById('ankiAccountModal').classList.add('open');
      testAnkiConnectDecks(true);
    };

    document.getElementById('btnOpenAnkiSettingsFromModal').addEventListener('click', openAnkiAccountModalFn);
    document.getElementById('btnOpenAnkiAccountPane').addEventListener('click', openAnkiAccountModalFn);

    document.getElementById('btnCloseAnkiAccountModal').addEventListener('click', () => {
      document.getElementById('ankiAccountModal').classList.remove('open');
    });
    document.getElementById('btnCloseAnkiAccountFooter').addEventListener('click', () => {
      document.getElementById('ankiAccountModal').classList.remove('open');
    });

    document.getElementById('btnSaveAnkiAccount').addEventListener('click', () => {
      const cfg = {
        connectUrl: document.getElementById('inputAnkiConnectUrl').value.trim() || 'http://127.0.0.1:8765',
        defaultDeck: document.getElementById('inputAnkiDefaultDeck').value.trim() || 'Leitura',
        ankiWebUser: document.getElementById('inputAnkiWebUser').value.trim(),
        ankiWebPass: document.getElementById('inputAnkiWebPass').value,
        ankiWebEndpoint: document.getElementById('inputAnkiWebEndpoint').value.trim() || '/api/ankiweb'
      };
      saveAnkiConfigObj(cfg);
      loadAnkiConfigIntoUi();
      document.getElementById('ankiModalStatus').textContent = 'Configurações do Anki salvas!';
      showToast('Configurações do Anki salvas!');
    });

    async function ankiConnectInvoke(action, params = {}) {
      const cfg = getAnkiConfig();
      const url = cfg.connectUrl || 'http://127.0.0.1:8765';
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, version: 6, params })
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      return data.result;
    }

    async function testAnkiConnectDecks(silent = false) {
      const badge = document.getElementById('ankiConnectBadge');
      const statusEl = document.getElementById('ankiModalStatus');
      try {
        const decks = await ankiConnectInvoke('deckNames');
        const models = await ankiConnectInvoke('modelNames');
        badge.textContent = `Conectado (${decks.length} baralhos)`;
        badge.style.color = 'var(--accent)';
        badge.style.borderColor = 'var(--accent)';

        const cfg = getAnkiConfig();
        cfg.cachedModels = models;
        saveAnkiConfigObj(cfg);

        const deckSelect = document.getElementById('selectAnkiDeckModal');
        if (deckSelect && Array.isArray(decks)) {
          deckSelect.innerHTML = '';
          const targetDeck = cfg.defaultDeck || 'Leitura';
          if (!decks.includes(targetDeck)) decks.unshift(targetDeck);
          decks.forEach(d => {
            const opt = document.createElement('option');
            opt.value = d;
            opt.textContent = d;
            if (d === targetDeck) opt.selected = true;
            deckSelect.appendChild(opt);
          });
        }
        if (!silent) {
          statusEl.textContent = `AnkiConnect conectado com sucesso! Baralhos encontrados: ${decks.slice(0, 6).join(', ')}`;
          showToast('Conectado ao Anki Desktop via AnkiConnect!');
        }
        return true;
      } catch (err) {
        badge.textContent = 'Anki Desktop fechado / Usando AnkiWeb';
        badge.style.color = 'var(--text-muted)';
        if (!silent) {
          statusEl.textContent = 'Não foi possível conectar em 127.0.0.1:8765 (verifique se o Anki está aberto com o add-on 2055492159 ou use o Login AnkiWeb abaixo).';
        }
        return false;
      }
    }

    document.getElementById('btnTestAnkiConnect').addEventListener('click', () => {
      document.getElementById('btnSaveAnkiAccount').click();
      testAnkiConnectDecks(false);
    });

    async function sendSingleCardToAnki(card, targetDeckOverride) {
      const cfg = getAnkiConfig();
      const deckName = targetDeckOverride || document.getElementById('selectAnkiDeckModal').value || cfg.defaultDeck || 'Leitura';
      const cleanFront = (card.front || '').trim();
      const cleanContext = (card.context || '').trim();
      const cleanBack = (card.back || '').replace(/\r?\n/g, '<br>').trim();
      const cleanBook = (card.book || state.title || 'Leitor').trim();

      const frontHtml = cleanContext
        ? `<b>${escapeHtml(cleanFront)}</b><br><br><small style="color:#666;"><i>"${escapeHtml(cleanContext)}"</i></small>`
        : `<b>${escapeHtml(cleanFront)}</b>`;
      const backHtml = `${cleanBack || escapeHtml(cleanFront)}<br><small style="color:#888;">Fonte: ${escapeHtml(cleanBook)}</small>`;
      const tag = cleanBook.replace(/[^a-zA-Z0-9À-ÿ]+/g, '_').replace(/^_|_$/g, '') || 'Leitura';

      // 1. Tentar enviar direto para o AnkiConnect (Anki Desktop aberto)
      try {
        await ankiConnectInvoke('createDeck', { deck: deckName });
        const models = await ankiConnectInvoke('modelNames');
        const preferredModel = models.find(m => /^(basic|básico|basico)$/i.test(m)) || models[0] || 'Basic';
        const fieldsList = await ankiConnectInvoke('modelFieldNames', { modelName: preferredModel });
        const f0 = fieldsList[0] || 'Front';
        const f1 = fieldsList[1] || 'Back';

        await ankiConnectInvoke('addNote', {
          note: {
            deckName,
            modelName: preferredModel,
            fields: { [f0]: frontHtml, [f1]: backHtml },
            options: { allowDuplicate: true },
            tags: [tag, 'LeitorOnline']
          }
        });

        // Marcar cartão como enviado
        const list = getVocabList();
        const found = list.find(c => c.id === card.id);
        if (found) {
          found.syncedToAnki = true;
          saveVocabList(list);
        }
        showToast(`Cartão adicionado direto ao baralho "${deckName}" no Anki!`);
        return { ok: true, method: 'AnkiConnect' };
      } catch (ankiConnectErr) {
        // 2. Fallback: Se o usuário configurou Login AnkiWeb (Online API /api/ankiweb na Vercel/Netlify)
        if (cfg.ankiWebUser && cfg.ankiWebPass) {
          try {
            const res = await fetch(cfg.ankiWebEndpoint || '/api/ankiweb', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                username: cfg.ankiWebUser,
                password: cfg.ankiWebPass,
                deck: deckName,
                front: frontHtml,
                back: backHtml,
                tags: tag
              })
            });
            const data = await res.json();
            if (res.ok && data.ok) {
              const list = getVocabList();
              const found = list.find(c => c.id === card.id);
              if (found) {
                found.syncedToAnki = true;
                saveVocabList(list);
              }
              showToast(`Cartão adicionado na sua conta AnkiWeb (baralho "${deckName}")!`);
              return { ok: true, method: 'AnkiWeb' };
            }
            throw new Error(data.error || `HTTP ${res.status}`);
          } catch (webErr) {
            showToast(`Salvo na lista local (abra o Anki ou publique na Vercel/Netlify para envio direto).`);
            return { ok: false, error: webErr.message };
          }
        } else {
          showToast('Salvo na lista! Abra o Anki Desktop (AnkiConnect) ou configure seu login AnkiWeb.');
          return { ok: false, error: ankiConnectErr.message };
        }
      }
    }

    // Botão "Adicionar Direto no Anki" dentro do Modal de Palavra/Frase
    document.getElementById('btnModalSendAnkiDirect').addEventListener('click', async () => {
      const front = dom.inputAnkiFront.value.trim();
      if (!front) {
        alert('Informe a palavra ou frase na frente do cartão.');
        return;
      }
      const secTitle = state.sections[state.currentIndex] ? state.sections[state.currentIndex].title : '';
      const newCard = {
        id: 'vc_' + Date.now(),
        front,
        back: dom.inputAnkiBack.value.trim(),
        context: dom.inputAnkiContext.value.trim(),
        book: state.title ? `${state.title}${secTitle ? ' · ' + secTitle : ''}` : 'Leitor Online',
        date: new Date().toLocaleDateString('pt-BR'),
        syncedToAnki: false
      };
      const list = getVocabList();
      list.push(newCard);
      saveVocabList(list);
      dom.lookupModal.classList.remove('open');
      await sendSingleCardToAnki(newCard, document.getElementById('selectAnkiDeckModal').value);
    });

    // Enviar todos os cartões pendentes de uma vez para o Anki + Sincronizar com AnkiWeb
    document.getElementById('btnSyncAllVocabToAnki').addEventListener('click', async () => {
      const list = getVocabList();
      const pending = list.filter(c => !c.syncedToAnki);
      const statusEl = document.getElementById('ankiModalStatus');
      if (!pending.length) {
        statusEl.textContent = 'Todos os cartões da lista já foram enviados ao Anki!';
        showToast('Todos os cartões já estão no Anki!');
        return;
      }
      statusEl.textContent = `Enviando ${pending.length} cartão(ões) para o Anki...`;
      let sent = 0;
      for (const c of pending) {
        const res = await sendSingleCardToAnki(c);
        if (res.ok) sent++;
      }
      try {
        await ankiConnectInvoke('sync');
        statusEl.textContent = `${sent} cartão(ões) adicionados e sincronizados com o AnkiWeb!`;
      } catch {
        statusEl.textContent = `${sent} de ${pending.length} cartão(ões) enviados ao Anki.`;
      }
    });

    document.getElementById('btnTestAnkiWebLogin').addEventListener('click', async () => {
      document.getElementById('btnSaveAnkiAccount').click();
      const cfg = getAnkiConfig();
      const statusEl = document.getElementById('ankiModalStatus');
      if (!cfg.ankiWebUser || !cfg.ankiWebPass) {
        statusEl.textContent = 'Preencha seu e-mail e senha do AnkiWeb primeiro.';
        return;
      }
      statusEl.textContent = 'Testando autenticação com AnkiWeb via endpoint...';
      try {
        const res = await fetch(cfg.ankiWebEndpoint || '/api/ankiweb', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'testLogin',
            username: cfg.ankiWebUser,
            password: cfg.ankiWebPass
          })
        });
        const data = await res.json();
        if (res.ok && data.ok) {
          statusEl.textContent = 'Login no AnkiWeb validado com sucesso! Seus cartões serão enviados direto para sua conta.';
          showToast('Conta AnkiWeb conectada com sucesso!');
        } else {
          statusEl.textContent = 'Aviso: ' + (data.error || 'Para usar o login direto AnkiWeb sem o Anki Desktop aberto, hospede a pasta na Vercel/Netlify (função /api/ankiweb incluída).');
        }
      } catch {
        statusEl.textContent = 'Endpoint /api/ankiweb disponível quando hospedado online (Vercel / Netlify). No computador local, você pode usar o AnkiConnect (127.0.0.1:8765) ou exportar .TSV.';
      }
    });

    // Tradutor de Capítulo Inteiro (Paralelo ou Inline)
    async function translateFullChapter(mode) {
      if (!state.sections.length) return;
      const tl = document.getElementById('selectChapterTransLang').value || 'pt';
      const paras = Array.from(dom.readerFlow.querySelectorAll('p, h1, h2, h3, blockquote')).filter(p => p.textContent.trim().length > 2);
      if (!paras.length) {
        alert('Nenhum parágrafo de texto encontrado neste capítulo.');
        return;
      }

      document.getElementById('toolsModal').classList.remove('open');
      showToast('Traduzindo capítulo... aguarde alguns segundos.');

      const chunks = [];
      let curBatch = [];
      let curLen = 0;
      paras.forEach((p, idx) => {
        const t = p.textContent.replace(/\s+/g, ' ').trim();
        if (curLen + t.length > 1600 && curBatch.length) {
          chunks.push(curBatch);
          curBatch = [];
          curLen = 0;
        }
        curBatch.push({ idx, el: p, text: t });
        curLen += t.length;
      });
      if (curBatch.length) chunks.push(curBatch);

      const translatedMap = new Map();
      for (const batch of chunks) {
        const joined = batch.map(item => item.text).join('\n\n');
        try {
          const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=${encodeURIComponent(tl)}&dt=t&q=${encodeURIComponent(joined)}`;
          const res = await fetch(url);
          if (res.ok) {
            const data = await res.json();
            const fullTrans = Array.isArray(data[0]) ? data[0].map(part => part[0]).join('') : '';
            const parts = fullTrans.split(/\n\n+/);
            batch.forEach((item, i) => {
              translatedMap.set(item.idx, parts[i] || parts[0] || '');
            });
          }
        } catch {}
      }

      if (mode === 'parallel') {
        parallelPane.classList.add('open');
        document.getElementById('btnParallelToggle').classList.add('active');
        let html = `<div style="max-width:680px; margin:0 auto;"><h3>Tradução (${tl.toUpperCase()}) — ${escapeHtml(state.sections[state.currentIndex].title)}</h3>`;
        paras.forEach((p, idx) => {
          const tr = translatedMap.get(idx) || p.textContent;
          html += `<p style="margin-bottom:1em;">${escapeHtml(tr)}</p>`;
        });
        html += '</div>';
        parallelBody.innerHTML = html;
        showToast('Tradução aberta lado a lado no Painel Paralelo!');
      } else {
        paras.forEach((p, idx) => {
          const tr = translatedMap.get(idx);
          if (tr) {
            const sub = document.createElement('div');
            sub.style.cssText = 'color:var(--accent); font-size:0.92em; margin:4px 0 14px; padding-left:10px; border-left:2px solid var(--accent);';
            sub.textContent = tr;
            p.insertAdjacentElement('afterend', sub);
          }
        });
        showToast('Tradução inserida abaixo de cada parágrafo!');
      }
    }

    document.getElementById('btnTranslateChapterParallel').addEventListener('click', () => translateFullChapter('parallel'));
    document.getElementById('btnTranslateChapterInline').addEventListener('click', () => translateFullChapter('inline'));

    /* =====================================================================
     * 12C. RESUMIDOR DE TEXTO & GERADOR DE QUIZ IA + EXPORTAÇÃO
     * ===================================================================== */
    let lastGeneratedSummaryText = '';
    let lastGeneratedQuizItems = [];

    async function loadCurrentChapterIntoSummarizer() {
      if (!state.sections.length) return;
      const sec = state.sections[state.currentIndex];
      if (state.format === 'PDF' && sec.text === null) await ensurePdfSectionText(sec);
      const txt = (sec.text || dom.readerFlow.textContent || '').replace(/\s+/g, ' ').trim();
      document.getElementById('inputSumSource').value = txt;
    }

    document.getElementById('btnSumUseChapter').addEventListener('click', async () => {
      if (!state.sections.length) {
        alert('Abra um livro primeiro ou cole o texto manualmente.');
        return;
      }
      await loadCurrentChapterIntoSummarizer();
      generateSummaryAndStats();
    });

    document.getElementById('btnSumUseBook').addEventListener('click', async () => {
      if (!state.sections.length) {
        alert('Abra um livro primeiro.');
        return;
      }
      for (const sec of state.sections.slice(0, 35)) {
        if (state.format === 'PDF' && sec.text === null) await ensurePdfSectionText(sec);
      }
      const allTxt = state.sections.map(s => s.text || '').join('\n\n').slice(0, 90000);
      document.getElementById('inputSumSource').value = allTxt;
      generateSummaryAndStats();
    });

    document.getElementById('sumUploadInput').addEventListener('change', async (e) => {
      const f = e.target.files && e.target.files[0];
      if (!f) return;
      try {
        const buf = await f.arrayBuffer();
        const parsed = await parseAnyBookBuffer(buf, f.name);
        const fullTxt = parsed.sections.map(s => s.text || '').join('\n\n').slice(0, 90000);
        document.getElementById('inputSumSource').value = fullTxt;
        generateSummaryAndStats(f.name);
        showToast(`Documento "${f.name}" carregado e resumido!`);
      } catch (err) {
        alert('Erro ao ler documento: ' + err.message);
      }
    });

    function generateSummaryAndStats(customTitle) {
      const box = document.getElementById('summaryOutput');
      const quizBox = document.getElementById('quizOutputContainer');
      if (!box) return;

      let text = document.getElementById('inputSumSource').value.trim();
      if (!text && state.sections.length) {
        const sec = state.sections[state.currentIndex];
        text = (sec.text || dom.readerFlow.textContent || '').replace(/\s+/g, ' ').trim();
        document.getElementById('inputSumSource').value = text;
      }
      if (!text) {
        box.textContent = 'Cole um texto acima, envie um documento ou abra um livro para gerar o resumo e o Quiz.';
        return;
      }

      const lenMode = document.getElementById('selectSumLength').value || 'medium';
      const maxBullets = lenMode === 'short' ? 3 : (lenMode === 'long' ? 10 : 6);

      const words = text ? text.split(/\s+/).length : 0;
      const totalBookWords = state.sections.length
        ? state.sections.reduce((acc, s) => acc + ((s.text ? s.text.split(/\s+/).length : 0)), 0)
        : words;
      const readTimeMin = Math.max(1, Math.round(words / 220));
      const totalTimeHours = (totalBookWords / (220 * 60)).toFixed(1);
      const sessionMin = Math.max(1, Math.round((Date.now() - sessionStartTime) / 60000));

      const rawSentences = (text.match(/[^.!?]+[.!?]+/g) || [text]).map(s => s.replace(/\s+/g, ' ').trim());
      const sentences = rawSentences.filter(s => s.length > 40 && s.length < 380);
      const freq = {};
      const stop = new Set(['para', 'como', 'mais', 'pelo', 'pela', 'seus', 'suas', 'isso', 'este', 'esta', 'aquele', 'aquela', 'entre', 'depois', 'quando', 'muito', 'mesmo', 'sobre', 'with', 'that', 'this', 'from', 'have', 'were', 'they', 'their', 'what', 'when', 'where', 'which', 'porque', 'ainda', 'então', 'havia', 'tinha', 'foram', 'está', 'estava']);
      text.toLowerCase().replace(/[^a-zà-ÿ\s]/g, '').split(/\s+/).forEach(w => {
        if (w.length > 4 && !stop.has(w)) freq[w] = (freq[w] || 0) + 1;
      });

      const pool = sentences.length ? sentences : rawSentences.slice(0, 15);
      const scored = pool.map((s, idx) => {
        const ws = s.toLowerCase().replace(/[^a-zà-ÿ\s]/g, '').split(/\s+/);
        const score = ws.reduce((acc, w) => acc + (freq[w] || 0), 0) / Math.max(7, ws.length);
        return { idx, s, score };
      });
      scored.sort((a, b) => b.score - a.score);
      const selected = scored.slice(0, maxBullets).sort((a, b) => a.idx - b.idx);
      const topSentences = selected.map(x => `• ${x.s}`);
      const docLabel = customTitle || (state.sections[state.currentIndex] ? state.sections[state.currentIndex].title : 'Texto Analisado');

      lastGeneratedSummaryText = `RESUMO (${docLabel})\n\n` + topSentences.join('\n\n');

      box.innerHTML = `
        <div style="display:grid; grid-template-columns:repeat(4, 1fr); gap:8px; margin-bottom:12px;">
          <div style="padding:6px; background:var(--bg-page); border-radius:4px; border:1px solid var(--border-color);">
            <div style="font-size:10px; color:var(--text-muted);">PALAVRAS NO TEXTO</div>
            <div style="font-size:14px; font-weight:600; color:var(--text-primary);">${words.toLocaleString('pt-BR')}</div>
          </div>
          <div style="padding:6px; background:var(--bg-page); border-radius:4px; border:1px solid var(--border-color);">
            <div style="font-size:10px; color:var(--text-muted);">TEMPO DE LEITURA</div>
            <div style="font-size:14px; font-weight:600; color:var(--text-primary);">~${readTimeMin} min</div>
          </div>
          <div style="padding:6px; background:var(--bg-page); border-radius:4px; border:1px solid var(--border-color);">
            <div style="font-size:10px; color:var(--text-muted);">LIVRO INTEIRO</div>
            <div style="font-size:14px; font-weight:600; color:var(--text-primary);">~${totalTimeHours} h</div>
          </div>
          <div style="padding:6px; background:var(--bg-page); border-radius:4px; border:1px solid var(--border-color);">
            <div style="font-size:10px; color:var(--text-muted);">SESSÃO ATUAL</div>
            <div style="font-size:14px; font-weight:600; color:var(--text-primary);">${sessionMin} min</div>
          </div>
        </div>
        <div style="font-weight:700; color:var(--text-primary); margin-bottom:6px;">Ideias Principais — ${escapeHtml(docLabel)}:</div>
        <div style="line-height:1.65;">${topSentences.length ? topSentences.map(escapeHtml).join('<br><br>') : 'Texto curto.'}</div>
      `;

      // Se "Generate Quiz!" estiver marcado, gerar Quiz de Múltipla Escolha
      const wantQuiz = document.getElementById('chkSumQuiz').checked;
      if (wantQuiz && selected.length > 0) {
        const topKeywords = Object.entries(freq).sort((a, b) => b[1] - a[1]).map(e => e[0]).slice(0, 30);
        lastGeneratedQuizItems = [];

        selected.slice(0, 5).forEach((item, qIdx) => {
          const wordsInSent = item.s.split(/\s+/);
          const candidate = wordsInSent.find(w => {
            const cl = w.toLowerCase().replace(/[^a-zà-ÿ]/g, '');
            return cl.length >= 5 && !stop.has(cl) && topKeywords.includes(cl);
          }) || wordsInSent.find(w => w.replace(/[^a-zA-ZÀ-ÿ]/g, '').length >= 6);

          if (!candidate) return;
          const cleanAnswer = candidate.replace(/^[.,!?;:"'()«»“”]+|[.,!?;:"'()«»“”]+$/g, '');
          const questionSent = item.s.replace(cleanAnswer, '__________');
          const distractors = topKeywords
            .filter(w => w !== cleanAnswer.toLowerCase() && Math.abs(w.length - cleanAnswer.length) <= 4)
            .slice(qIdx * 3, qIdx * 3 + 3);
          while (distractors.length < 3) {
            distractors.push(['contexto', 'história', 'conceito', 'capítulo'][distractors.length]);
          }
          const options = [cleanAnswer, ...distractors].sort(() => Math.random() - 0.5);
          lastGeneratedQuizItems.push({
            question: `Complete a ideia-chave do texto: "${questionSent}"`,
            answer: cleanAnswer,
            fullContext: item.s,
            options
          });
        });

        if (lastGeneratedQuizItems.length) {
          quizBox.classList.remove('hidden');
          quizBox.innerHTML = `
            <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:8px; margin-bottom:8px;">
              <span style="font-weight:700; font-size:13.5px;">Quiz de Revisão (${lastGeneratedQuizItems.length} questões geradas)</span>
              <button class="studio-btn-primary" id="btnSendQuizToAnki" style="height:28px; font-size:11.5px;">Enviar Perguntas para o Anki</button>
            </div>
            <div id="quizCardsList"></div>
          `;
          const listEl = quizBox.querySelector('#quizCardsList');
          lastGeneratedQuizItems.forEach((q, idx) => {
            const card = document.createElement('div');
            card.className = 'quiz-card';
            card.innerHTML = `<div style="font-weight:600; font-size:12.5px; margin-bottom:4px;">${idx + 1}. ${escapeHtml(q.question)}</div>`;
            q.options.forEach(opt => {
              const btn = document.createElement('button');
              btn.className = 'quiz-opt-btn';
              btn.textContent = opt;
              btn.addEventListener('click', () => {
                card.querySelectorAll('.quiz-opt-btn').forEach(b => {
                  if (b.textContent === q.answer) b.classList.add('correct');
                });
                if (opt === q.answer) {
                  btn.classList.add('correct');
                  showToast('Resposta correta!');
                } else {
                  btn.classList.add('wrong');
                  showToast(`Resposta correta: ${q.answer}`);
                }
              });
              card.appendChild(btn);
            });
            listEl.appendChild(card);
          });

          quizBox.querySelector('#btnSendQuizToAnki').addEventListener('click', async () => {
            const list = getVocabList();
            for (const q of lastGeneratedQuizItems) {
              const newCard = {
                id: 'vc_quiz_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
                front: q.question,
                back: `Resposta: ${q.answer}`,
                context: q.fullContext,
                book: state.title ? `${state.title} (Quiz)` : 'Quiz de Revisão',
                date: new Date().toLocaleDateString('pt-BR')
              };
              list.push(newCard);
              await sendSingleCardToAnki(newCard);
            }
            saveVocabList(list);
            showToast(`${lastGeneratedQuizItems.length} questões do Quiz adicionadas ao Anki!`);
          });
        } else {
          quizBox.classList.add('hidden');
        }
      } else if (quizBox) {
        quizBox.classList.add('hidden');
      }
    }

    document.getElementById('btnGenerateSummary').addEventListener('click', () => generateSummaryAndStats());

    document.getElementById('btnExportSummary').addEventListener('click', () => {
      if (!lastGeneratedSummaryText) {
        generateSummaryAndStats();
      }
      if (!lastGeneratedSummaryText) return;
      const fmt = document.getElementById('selectSumExportFmt').value || 'pdf';
      const quizTxt = lastGeneratedQuizItems.length
        ? '\n\nQUIZ DE REVISÃO:\n' + lastGeneratedQuizItems.map((q, i) => `${i + 1}. ${q.question}\n   Resposta: ${q.answer}`).join('\n\n')
        : '';
      const fullContent = lastGeneratedSummaryText + quizTxt;
      const safeName = `resumo_${(state.title || 'documento').replace(/[<>:"/\\|?*]+/g, '_')}`;

      if (fmt === 'pdf') {
        const w = window.open('', '_blank');
        if (!w) { alert('Permita pop-ups para salvar o resumo em PDF.'); return; }
        w.document.write(`<!DOCTYPE html><html><head><meta charset="utf-8"><title>${escapeHtml(safeName)}</title><style>body{font-family:Georgia,serif;max-width:700px;margin:30px auto;line-height:1.65;color:#111;white-space:pre-wrap;}</style></head><body>${escapeHtml(fullContent)}<script>window.onload=function(){window.print();};<\/script></body></html>`);
        w.document.close();
      } else if (fmt === 'docx') {
        const docHtml = `<html><head><meta charset="utf-8"></head><body style="font-family:Georgia,serif;white-space:pre-wrap;">${escapeHtml(fullContent)}</body></html>`;
        const blob = new Blob(['\uFEFF' + docHtml], { type: 'application/msword;charset=utf-8' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = `${safeName}.doc`;
        a.click();
      } else if (fmt === 'md') {
        const blob = new Blob([fullContent], { type: 'text/markdown;charset=utf-8' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = `${safeName}.md`;
        a.click();
      } else {
        const blob = new Blob([fullContent], { type: 'text/plain;charset=utf-8' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = `${safeName}.txt`;
        a.click();
      }
      showToast(`Resumo exportado em .${fmt.toUpperCase()}!`);
    });

    /* =====================================================================
     * 12D. TRADUTOR IA DE TEXTOS (2 PAINÉIS LADO A LADO + VOZ + ANKI)
     * ===================================================================== */
    const inputStudioTransSrc = document.getElementById('inputStudioTransSrc');
    const outputStudioTrans = document.getElementById('outputStudioTrans');

    inputStudioTransSrc.addEventListener('input', () => {
      document.getElementById('lblTransSrcCount').textContent = `${inputStudioTransSrc.value.length} / 5000`;
    });

    document.getElementById('btnClearTransSrc').addEventListener('click', () => {
      inputStudioTransSrc.value = '';
      document.getElementById('lblTransSrcCount').textContent = '0 / 5000';
    });
    document.getElementById('btnClearTransOut').addEventListener('click', () => {
      outputStudioTrans.value = '';
      document.getElementById('lblTransOutCount').textContent = '0 / 5000';
    });

    document.getElementById('btnTransLoadChapter').addEventListener('click', async () => {
      if (!state.sections.length) {
        alert('Abra um livro primeiro.');
        return;
      }
      const sec = state.sections[state.currentIndex];
      if (state.format === 'PDF' && sec.text === null) await ensurePdfSectionText(sec);
      inputStudioTransSrc.value = (sec.text || dom.readerFlow.textContent || '').trim().slice(0, 5000);
      document.getElementById('lblTransSrcCount').textContent = `${inputStudioTransSrc.value.length} / 5000`;
    });

    document.getElementById('btnSwapStudioLangs').addEventListener('click', () => {
      const srcSel = document.getElementById('selectStudioSrcLang');
      const tgtSel = document.getElementById('selectChapterTransLang');
      if (srcSel.value !== 'auto') {
        const tmp = srcSel.value;
        srcSel.value = tgtSel.value;
        tgtSel.value = tmp;
      } else {
        srcSel.value = tgtSel.value;
        tgtSel.value = 'en';
      }
      const tmpTxt = inputStudioTransSrc.value;
      inputStudioTransSrc.value = outputStudioTrans.value;
      outputStudioTrans.value = tmpTxt;
    });

    document.getElementById('btnRunStudioTranslate').addEventListener('click', async () => {
      const text = inputStudioTransSrc.value.trim();
      if (!text) return;
      const sl = document.getElementById('selectStudioSrcLang').value || 'auto';
      const tl = document.getElementById('selectChapterTransLang').value || 'pt';
      outputStudioTrans.value = 'Traduzindo...';
      try {
        const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=${encodeURIComponent(sl)}&tl=${encodeURIComponent(tl)}&dt=t&q=${encodeURIComponent(text)}`;
        const res = await fetch(url);
        if (res.ok) {
          const data = await res.json();
          const translated = Array.isArray(data[0]) ? data[0].map(part => part[0]).join('') : '';
          outputStudioTrans.value = translated || 'Não foi possível traduzir.';
          document.getElementById('lblTransOutCount').textContent = `${outputStudioTrans.value.length} / 5000`;
          showToast('Tradução concluída!');
        }
      } catch (err) {
        outputStudioTrans.value = 'Erro ao traduzir: ' + err.message;
      }
    });

    document.getElementById('btnCopyTransSrc').addEventListener('click', () => {
      navigator.clipboard.writeText(inputStudioTransSrc.value || '');
      showToast('Texto original copiado!');
    });
    document.getElementById('btnCopyTransOut').addEventListener('click', () => {
      navigator.clipboard.writeText(outputStudioTrans.value || '');
      showToast('Tradução copiada!');
    });
    document.getElementById('btnSpeakTransSrc').addEventListener('click', () => {
      if ('speechSynthesis' in window && inputStudioTransSrc.value.trim()) {
        window.speechSynthesis.cancel();
        window.speechSynthesis.speak(new SpeechSynthesisUtterance(inputStudioTransSrc.value.trim()));
      }
    });
    document.getElementById('btnSpeakTransOut').addEventListener('click', () => {
      if ('speechSynthesis' in window && outputStudioTrans.value.trim()) {
        window.speechSynthesis.cancel();
        const u = new SpeechSynthesisUtterance(outputStudioTrans.value.trim());
        u.lang = document.getElementById('selectChapterTransLang').value || 'pt';
        window.speechSynthesis.speak(u);
      }
    });
    document.getElementById('btnSaveTransToAnki').addEventListener('click', async () => {
      const f = inputStudioTransSrc.value.trim();
      const b = outputStudioTrans.value.trim();
      if (!f || !b) {
        alert('Traduza um texto primeiro para salvar no Anki.');
        return;
      }
      const card = {
        id: 'vc_tr_' + Date.now(),
        front: f.slice(0, 350),
        back: b.slice(0, 350),
        context: '',
        book: state.title || 'Tradutor BookStudio',
        date: new Date().toLocaleDateString('pt-BR')
      };
      const list = getVocabList();
      list.push(card);
      saveVocabList(list);
      await sendSingleCardToAnki(card);
    });

    /* =====================================================================
     * 12E. REVISOR GRAMATICAL, ORTOGRÁFICO & ESTILO (AI PROOFREADER)
     * ===================================================================== */
    const inputProofText = document.getElementById('inputProofText');
    let lastCorrectedProofText = '';

    inputProofText.addEventListener('input', () => {
      document.getElementById('lblProofCharCount').textContent = `${inputProofText.value.length} / 5000`;
    });
    document.getElementById('btnClearProofText').addEventListener('click', () => {
      inputProofText.value = '';
      document.getElementById('lblProofCharCount').textContent = '0 / 5000';
      document.getElementById('proofResultBox').classList.add('hidden');
    });
    document.getElementById('btnProofLoadChapter').addEventListener('click', async () => {
      if (!state.sections.length) {
        alert('Abra um livro primeiro ou cole seu texto na caixa.');
        return;
      }
      const sec = state.sections[state.currentIndex];
      if (state.format === 'PDF' && sec.text === null) await ensurePdfSectionText(sec);
      inputProofText.value = (sec.text || dom.readerFlow.textContent || '').trim().slice(0, 4500);
      document.getElementById('lblProofCharCount').textContent = `${inputProofText.value.length} / 5000`;
    });
    document.getElementById('btnSpeakProofText').addEventListener('click', () => {
      if ('speechSynthesis' in window && inputProofText.value.trim()) {
        window.speechSynthesis.cancel();
        window.speechSynthesis.speak(new SpeechSynthesisUtterance(inputProofText.value.trim()));
      }
    });
    document.getElementById('btnCopyProofText').addEventListener('click', () => {
      navigator.clipboard.writeText(inputProofText.value || '');
      showToast('Texto copiado!');
    });

    document.getElementById('btnRunProofread').addEventListener('click', async () => {
      const text = inputProofText.value;
      if (!text.trim()) {
        alert('Digite ou cole um texto para revisar.');
        return;
      }
      const lang = document.getElementById('selectProofLang').value || 'auto';
      const resultBox = document.getElementById('proofResultBox');
      const issuesList = document.getElementById('proofIssuesList');
      const previewEl = document.getElementById('proofCorrectedPreview');
      const summaryEl = document.getElementById('lblProofSummary');

      resultBox.classList.remove('hidden');
      summaryEl.textContent = 'Analisando gramática, ortografia, pontuação e estilo...';
      issuesList.innerHTML = '';

      let matches = [];
      try {
        const params = new URLSearchParams();
        params.append('text', text.slice(0, 5000));
        params.append('language', lang);
        const res = await fetch('https://api.languagetool.org/v2/check', {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: params.toString()
        });
        if (res.ok) {
          const data = await res.json();
          matches = data.matches || [];
        }
      } catch {}

      // Construir versão corrigida aplicando as melhores sugestões de trás para frente
      let corrected = text;
      const sortedDesc = matches.slice().sort((a, b) => b.offset - a.offset);
      sortedDesc.forEach(m => {
        if (m.replacements && m.replacements.length > 0) {
          const rep = m.replacements[0].value;
          corrected = corrected.slice(0, m.offset) + rep + corrected.slice(m.offset + m.length);
        }
      });
      // Regras extras locais de tipografia (espaços duplos, espaço antes de pontuação)
      corrected = corrected.replace(/ {2,}/g, ' ').replace(/\s+([,.;:!?])/g, '$1');
      lastCorrectedProofText = corrected;
      previewEl.textContent = corrected;

      if (!matches.length) {
        summaryEl.textContent = 'Nenhum erro gramatical ou ortográfico detectado.';
        issuesList.innerHTML = '<div style="padding:8px; color:var(--accent); font-size:12.5px;">Seu texto está claro, bem pontuado e sem erros aparentes.</div>';
        return;
      }

      summaryEl.textContent = `${matches.length} sugestão(ões) de correção encontradas:`;
      matches.forEach((m) => {
        const wrongSnippet = text.substr(m.offset, m.length);
        const bestFix = (m.replacements && m.replacements[0]) ? m.replacements[0].value : '(remover/revisar)';
        const cat = (m.rule && m.rule.category && m.rule.category.name) ? m.rule.category.name : 'Gramática & Estilo';
        const item = document.createElement('div');
        item.className = 'card-item';
        item.innerHTML = `
          <div style="display:flex; justify-content:space-between; font-size:11px; color:var(--text-muted); margin-bottom:3px;">
            <span style="font-weight:700; text-transform:uppercase;">${escapeHtml(cat)}</span>
          </div>
          <div style="font-size:12.5px; margin-bottom:4px;">
            <span style="background:rgba(239,68,68,0.18); text-decoration:line-through; padding:1px 4px; border-radius:3px;">${escapeHtml(wrongSnippet)}</span>
            →
            <span style="background:rgba(34,197,94,0.22); font-weight:700; padding:1px 5px; border-radius:3px;">${escapeHtml(bestFix)}</span>
          </div>
          <div style="font-size:11.5px; color:var(--text-secondary);">${escapeHtml(m.message || '')}</div>
        `;
        issuesList.appendChild(item);
      });
    });

    document.getElementById('btnApplyAllProofFixes').addEventListener('click', () => {
      if (lastCorrectedProofText) {
        inputProofText.value = lastCorrectedProofText;
        document.getElementById('lblProofCharCount').textContent = `${inputProofText.value.length} / 5000`;
        showToast('Todas as correções foram aplicadas ao seu texto!');
      }
    });
    document.getElementById('btnCopyCorrectedText').addEventListener('click', () => {
      navigator.clipboard.writeText(lastCorrectedProofText || inputProofText.value || '');
      showToast('Versão corrigida copiada para a área de transferência!');
    });

    /* =====================================================================
     * 12F. GERENCIADOR DE CITAÇÕES E DESTAQUES (QUOTE & HIGHLIGHT MANAGER)
     * ===================================================================== */
    function collectAllQuotesData(filterQuery = '') {
      const hlMap = getHighlightsMap();
      const bmMap = getBookmarksMap();
      const hist = JSON.parse(localStorage.getItem('reader_history') || '{}');
      const allKeys = new Set([...Object.keys(hlMap), ...Object.keys(bmMap), ...Object.keys(hist)]);
      const q = filterQuery.trim().toLowerCase();

      const booksSummary = [];
      const allQuotes = [];

      allKeys.forEach(bookKey => {
        const hList = hlMap[bookKey] || [];
        const bList = bmMap[bookKey] || [];
        const hInfo = hist[bookKey] || {};
        const bookTitle = hInfo.title || bookKey.replace(/_\d+$/, '');
        if (!hList.length && !bList.length) return;

        const matchingQuotes = hList.filter(h => !q || bookTitle.toLowerCase().includes(q) || (h.text || '').toLowerCase().includes(q) || (h.chapterTitle || '').toLowerCase().includes(q));
        if (q && !matchingQuotes.length && !bookTitle.toLowerCase().includes(q)) return;

        booksSummary.push({
          bookKey,
          bookTitle,
          highlightCount: hList.length,
          bookmarkCount: bList.length
        });

        matchingQuotes.forEach(h => {
          allQuotes.push({
            ...h,
            bookKey,
            bookTitle
          });
        });
      });

      return { booksSummary, allQuotes };
    }

    function renderQuotesManager() {
      const q = (document.getElementById('inputFilterQuotes').value || '');
      const { booksSummary, allQuotes } = collectAllQuotesData(q);
      const tbody = document.getElementById('quotesBooksTableBody');
      const detailList = document.getElementById('quotesDetailedList');
      if (!tbody || !detailList) return;

      tbody.innerHTML = '';
      if (!booksSummary.length) {
        tbody.innerHTML = `<tr><td colspan="3" style="color:var(--text-muted); padding:14px;">Nenhuma citação ou destaque salvo ainda. Selecione qualquer frase em um livro ou PDF e escolha uma cor de marca-texto para salvar aqui.</td></tr>`;
        detailList.innerHTML = '';
        return;
      }

      booksSummary.forEach(b => {
        const tr = document.createElement('tr');
        tr.innerHTML = `
          <td style="font-weight:600; color:var(--text-primary);">${escapeHtml(b.bookTitle)}</td>
          <td>${b.highlightCount} citação(ões) grifada(s) · ${b.bookmarkCount} marcador(es)</td>
          <td style="text-align:right;">
            <button class="tb-btn tb-btn-solid btn-filter-this-book" style="height:24px; font-size:11px; display:inline-flex;">Ver Citações</button>
          </td>
        `;
        tr.querySelector('.btn-filter-this-book').addEventListener('click', () => {
          document.getElementById('inputFilterQuotes').value = b.bookTitle;
          renderQuotesManager();
        });
        tbody.appendChild(tr);
      });

      detailList.innerHTML = `<div style="font-size:12px; font-weight:700; color:var(--text-secondary); margin-top:6px;">TODAS AS CITAÇÕES SALVAS (${allQuotes.length})</div>`;
      allQuotes.forEach(item => {
        const card = document.createElement('div');
        card.className = 'card-item';
        card.innerHTML = `
          <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:4px;">
            <span style="font-weight:700; color:var(--text-primary);">${escapeHtml(item.bookTitle)} — <span style="font-weight:400; color:var(--text-muted);">${escapeHtml(item.chapterTitle || ('Seção ' + (item.sectionIndex + 1)))}</span></span>
            <span style="font-size:11px; color:var(--text-muted);">${escapeHtml(item.date || '')}</span>
          </div>
          <div style="margin:6px 0; font-size:13px; line-height:1.55;">
            <mark class="user-hl user-hl-${item.color || 'yellow'}">"${escapeHtml(item.text)}"</mark>
          </div>
          <div style="display:flex; gap:6px; justify-content:flex-end; margin-top:6px;">
            <button class="tb-btn tb-btn-solid btn-q-copy" style="height:24px; font-size:11px;">Copiar Citação</button>
            <button class="tb-btn tb-btn-solid btn-q-anki" style="height:24px; font-size:11px;">Enviar p/ Anki</button>
            <button class="tb-btn tb-btn-solid btn-q-jump" style="height:24px; font-size:11px;">Ir p/ Página</button>
          </div>
        `;
        card.querySelector('.btn-q-copy').addEventListener('click', () => {
          navigator.clipboard.writeText(`"${item.text}" — ${item.bookTitle} (${item.chapterTitle || ''})`);
          showToast('Citação copiada!');
        });
        card.querySelector('.btn-q-anki').addEventListener('click', async () => {
          const newCard = {
            id: 'vc_hl_' + Date.now(),
            front: item.text.slice(0, 350),
            back: `Citação de ${item.bookTitle} (${item.chapterTitle || ''})`,
            context: item.text,
            book: item.bookTitle,
            date: new Date().toLocaleDateString('pt-BR')
          };
          const list = getVocabList();
          list.push(newCard);
          saveVocabList(list);
          await sendSingleCardToAnki(newCard);
        });
        card.querySelector('.btn-q-jump').addEventListener('click', () => {
          if (state.bookKey === item.bookKey) {
            document.getElementById('toolsModal').classList.remove('open');
            state.currentIndex = item.sectionIndex || 0;
            renderSection({ restoreSubPage: item.subPage || 0 });
          } else {
            showToast(`Abra o livro "${item.bookTitle}" na Estante para pular direto para esta página.`);
          }
        });
        detailList.appendChild(card);
      });
    }

    document.getElementById('inputFilterQuotes').addEventListener('input', renderQuotesManager);

    function exportAllQuotes(format) {
      const { allQuotes } = collectAllQuotesData(document.getElementById('inputFilterQuotes').value || '');
      if (!allQuotes.length) {
        alert('Nenhuma citação encontrada para exportar.');
        return;
      }
      if (format === 'md') {
        const md = `# Minhas Citações & Destaques de Leitura\n\n` + allQuotes.map(q => `> "${q.text}"\n— **${q.bookTitle}** (*${q.chapterTitle || 'Seção ' + (q.sectionIndex + 1)}*, ${q.date || ''})`).join('\n\n---\n\n');
        const blob = new Blob([md], { type: 'text/markdown;charset=utf-8' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = 'minhas_citacoes.md';
        a.click();
      } else if (format === 'doc') {
        const html = `<html><head><meta charset="utf-8"></head><body style="font-family:Georgia,serif;"><h1>Minhas Citações & Destaques</h1>` + allQuotes.map(q => `<blockquote style="border-left:3px solid #2f5e4e;padding-left:10px;margin:14px 0;"><p>"${escapeHtml(q.text)}"</p><small><b>${escapeHtml(q.bookTitle)}</b> — ${escapeHtml(q.chapterTitle || '')}</small></blockquote>`).join('') + `</body></html>`;
        const blob = new Blob(['\uFEFF' + html], { type: 'application/msword;charset=utf-8' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = 'minhas_citacoes.doc';
        a.click();
      } else {
        const w = window.open('', '_blank');
        if (!w) { alert('Permita pop-ups para salvar em PDF.'); return; }
        w.document.write(`<!DOCTYPE html><html><head><meta charset="utf-8"><title>Citações e Destaques</title><style>body{font-family:Georgia,serif;max-width:700px;margin:30px auto;color:#111;}blockquote{border-left:3px solid #2f5e4e;padding-left:12px;margin:16px 0;}</style></head><body><h1>Minhas Citações & Destaques</h1>${allQuotes.map(q => `<blockquote><p>"${escapeHtml(q.text)}"</p><small><b>${escapeHtml(q.bookTitle)}</b> — ${escapeHtml(q.chapterTitle || '')}</small></blockquote>`).join('')}<script>window.onload=function(){window.print();};<\/script></body></html>`);
        w.document.close();
      }
      showToast('Citações exportadas!');
    }

    document.getElementById('btnExportQuotesMd').addEventListener('click', () => exportAllQuotes('md'));
    document.getElementById('btnExportQuotesDoc').addEventListener('click', () => exportAllQuotes('doc'));
    document.getElementById('btnExportQuotesPdf').addEventListener('click', () => exportAllQuotes('pdf'));



    // =========================================================
    // SUÍTE DE IDIOMAS & ESTUDO ACADÊMICO (V5)
    // =========================================================

    // 1. Player Local Sincronizado para Legendas (.SRT / .VTT)
    const subMediaInputEl = document.getElementById('subMediaInput');
    const subMediaPlayerEl = document.getElementById('subMediaPlayer');
    const subYoutubeFrameEl = document.getElementById('subYoutubeFrame');
    const btnLoadYtEl = document.getElementById('btnLoadSubYoutube');
    const inpYtUrlEl = document.getElementById('inputSubYoutubeUrl');
    const lblSubMediaStatusEl = document.getElementById('lblSubMediaStatus');
    if (btnLoadYtEl && inpYtUrlEl && subYoutubeFrameEl) {
      btnLoadYtEl.addEventListener('click', () => {
        const raw = (inpYtUrlEl.value || '').trim();
        const m = raw.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([a-zA-Z0-9_-]{11})/);
        if (!m) { showToast('Cole um link válido do YouTube.', true); return; }
        if (subMediaPlayerEl) { subMediaPlayerEl.pause(); subMediaPlayerEl.classList.add('hidden'); }
        subYoutubeFrameEl.src = `https://www.youtube.com/embed/${m[1]}`;
        subYoutubeFrameEl.classList.remove('hidden');
        if (lblSubMediaStatusEl) lblSubMediaStatusEl.textContent = 'YouTube embeddado! Selecione qualquer palavra da legenda abaixo para traduzir.';
        showToast('Vídeo do YouTube carregado na barra!');
      });
    }
    if (subMediaInputEl && subMediaPlayerEl) {
      subMediaInputEl.addEventListener('change', (e) => {
        const f = e.target.files && e.target.files[0];
        if (!f) return;
        const url = URL.createObjectURL(f);
        state.objectUrls.push(url);
        subMediaPlayerEl.src = url;
        subMediaPlayerEl.classList.remove('hidden');
        if (lblSubMediaStatusEl) lblSubMediaStatusEl.textContent = `Sincronizado: ${f.name}`;
        showToast('Mídia local vinculada à legenda!');
      });
      subMediaPlayerEl.addEventListener('timeupdate', () => {
        const t = subMediaPlayerEl.currentTime || 0;
        const cues = dom.readerFlow.querySelectorAll('.sub-cue');
        cues.forEach(el => {
          const st = parseFloat(el.dataset.start || '0');
          const en = parseFloat(el.dataset.end || '0');
          const active = t >= st && t <= en + 0.15;
          el.classList.toggle('active', active);
        });
      });
      dom.readerFlow.addEventListener('click', (e) => {
        const cueEl = e.target.closest && e.target.closest('.sub-cue');
        if (!cueEl || subMediaPlayerEl.classList.contains('hidden')) return;
        const st = parseFloat(cueEl.dataset.start || '0');
        subMediaPlayerEl.currentTime = st;
        subMediaPlayerEl.play().catch(() => {});
      });
    }

    // 2. Shadowing (Gravar sua voz e comparar com TTS)
    const btnShadowEl = document.getElementById('btnShadowingRec');
    const audioShadowEl = document.getElementById('audioShadowingPlayback');
    let __shadowRec = null;
    let __shadowChunks = [];
    if (btnShadowEl && audioShadowEl) {
      btnShadowEl.addEventListener('click', async () => {
        if (__shadowRec && __shadowRec.state === 'recording') {
          __shadowRec.stop();
          btnShadowEl.textContent = '🎙 Shadowing';
          btnShadowEl.classList.remove('active');
          return;
        }
        if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
          showToast('Microfone não suportado neste navegador.', true);
          return;
        }
        try {
          const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
          __shadowChunks = [];
          __shadowRec = new MediaRecorder(stream);
          __shadowRec.ondataavailable = (ev) => { if (ev.data && ev.data.size > 0) __shadowChunks.push(ev.data); };
          __shadowRec.onstop = () => {
            stream.getTracks().forEach(t => t.stop());
            const blob = new Blob(__shadowChunks, { type: 'audio/webm' });
            audioShadowEl.src = URL.createObjectURL(blob);
            audioShadowEl.classList.remove('hidden');
            audioShadowEl.play().catch(() => {});
          };
          __shadowRec.start();
          btnShadowEl.textContent = '⏹ Parar Voz';
          btnShadowEl.classList.add('active');
        } catch (err) {
          showToast('Permissão de microfone negada: ' + err.message, true);
        }
      });
    }

    // 3. Mapa de Frequência de Vocabulário do Livro
    function computeBookWordFrequency(sections, existingFronts = []) {
      const stop = new Set(['the','and','that','have','for','not','with','you','this','but','his','from','they','she','her','was','were','are','been','one','all','would','there','their','what','out','about','who','get','which','when','make','can','like','time','just','him','know','take','into','your','some','could','them','than','then','now','only','its','over','also','after','use','two','how','our','well','way','even','new','because','any','these','most','que','não','nao','com','uma','para','por','mais','dos','das','como','mas','foi','ele','ela','seu','sua','nos','nas','isso','este','esta','esse','essa','muito','sem','sob','entre','sobre','quando','onde']);
      const known = new Set((existingFronts || []).map(w => String(w || '').toLowerCase().trim()));
      const counts = new Map();
      (sections || []).forEach(sec => {
        const words = String(sec.text || '').toLowerCase().match(/[a-záàâãéèêíïóôõöúçñ'-]{3,}/gi) || [];
        words.forEach(w => {
          const clean = w.replace(/^['-]+|['-]+$/g, '');
          if (clean.length < 3 || stop.has(clean) || known.has(clean) || /^\d+$/.test(clean)) return;
          counts.set(clean, (counts.get(clean) || 0) + 1);
        });
      });
      return Array.from(counts.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, 50)
        .map(([word, count]) => ({ word, count }));
    }

    const btnFreqEl = document.getElementById('btnAnalyzeBookFreq');
    const freqBoxEl = document.getElementById('bookFreqList');
    if (btnFreqEl && freqBoxEl) {
      btnFreqEl.addEventListener('click', () => {
        if (!state.sections || !state.sections.length) {
          showToast('Abra um livro primeiro para analisar o vocabulário.', true);
          return;
        }
        const wasHidden = freqBoxEl.classList.contains('hidden');
        freqBoxEl.classList.toggle('hidden', !wasHidden);
        if (!wasHidden) return;
        const fronts = getVocabList().map(c => c.front);
        const topWords = computeBookWordFrequency(state.sections, fronts);
        if (!topWords.length) {
          freqBoxEl.innerHTML = '<div style="font-size:11.5px; color:var(--text-muted);">Nenhuma palavra nova frequente encontrada.</div>';
          return;
        }
        freqBoxEl.innerHTML = `<div style="font-size:11px; font-weight:700; color:var(--accent); margin-bottom:4px;">Top ${topWords.length} palavras novas neste livro:</div>` +
          topWords.map(w => `
            <div style="display:flex; justify-content:space-between; align-items:center; font-size:12px; padding:2px 4px; border-bottom:1px solid var(--border-color);">
              <span><strong>${escapeHtml(w.word)}</strong> <span style="font-size:10.5px; color:var(--text-muted);">(${w.count}x)</span></span>
              <button class="tb-btn btn-add-freq-word" data-w="${escapeHtml(w.word)}" style="height:20px; font-size:10.5px; padding:0 6px;">+ Anki</button>
            </div>
          `).join('');
        freqBoxEl.querySelectorAll('.btn-add-freq-word').forEach(btn => {
          btn.addEventListener('click', () => {
            const w = btn.dataset.w;
            const list = getVocabList();
            list.push({ id: `${Date.now()}_${Math.random().toString(36).slice(2, 6)}`, front: w, back: '', context: '', book: state.title || '' });
            saveVocabList(list);
            btn.textContent = '✓ Salva';
            btn.disabled = true;
          });
        });
      });
    }

    // 4. Gerador de Quiz / Lacunas (Cloze Deletion) a partir de Destaques & Notas
    function generateClozeQuizItems(highlights = [], notes = []) {
      const items = [];
      const pushFromText = (raw, extraNote = '') => {
        const clean = String(raw || '').trim();
        if (clean.length < 18) return;
        const candidates = (clean.match(/[A-Za-zÀ-ÿ]{5,}/g) || []).filter(w => !/^(sobre|entre|porque|quando|where|which|their|there|about)$/i.test(w));
        if (!candidates.length) return;
        const answer = candidates.sort((a, b) => b.length - a.length)[0];
        const masked = clean.replace(new RegExp(`\\b${answer.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`), '[ ... ]');
        if (masked !== clean) items.push({ prompt: masked, answer, hint: extraNote });
      };
      (highlights || []).forEach(h => pushFromText(h.text || h.quote, h.note || ''));
      (notes || []).forEach(n => pushFromText(`${n.name || ''}: ${n.note || n.text || ''}`));
      return items.slice(0, 20);
    }

    let __clozeQueue = [];
    let __clozeScore = 0;
    function renderClozeQuizStep() {
      const box = document.getElementById('clozeQuizBox');
      if (!box) return;
      if (!__clozeQueue.length) {
        box.innerHTML = `<div style="font-size:12px; font-weight:700; color:var(--accent);">Quiz concluído! Acertos: ${__clozeScore}</div>`;
        setTimeout(() => box.classList.add('hidden'), 2200);
        return;
      }
      const cur = __clozeQueue[0];
      box.classList.remove('hidden');
      box.innerHTML = `
        <div style="font-size:11px; color:var(--text-muted);">Questão restante: ${__clozeQueue.length}</div>
        <div style="font-size:12.5px; line-height:1.5;">"${escapeHtml(cur.prompt)}"</div>
        ${cur.hint ? `<div style="font-size:11px; color:var(--text-muted);">Dica: ${escapeHtml(cur.hint)}</div>` : ''}
        <input type="text" id="inputClozeGuess" placeholder="Digite a palavra que completa a lacuna..." style="height:28px; padding:0 8px; border:1px solid var(--border-color); border-radius:4px; background:var(--bg-page); color:var(--text-primary); font-size:12px;" />
        <div style="display:flex; gap:4px;">
          <button id="btnCheckClozeGuess" class="tb-btn tb-btn-solid" style="flex:1; height:26px; font-size:11px;">Verificar</button>
          <button id="btnSkipClozeGuess" class="tb-btn" style="height:26px; font-size:11px;">Revelar</button>
        </div>
        <div id="lblClozeFeedback" style="font-size:11.5px; font-weight:600;"></div>
      `;
      const inp = document.getElementById('inputClozeGuess');
      const fb = document.getElementById('lblClozeFeedback');
      document.getElementById('btnCheckClozeGuess').addEventListener('click', () => {
        const guess = (inp.value || '').trim().toLowerCase();
        if (guess === cur.answer.toLowerCase()) {
          __clozeScore++;
          fb.style.color = '#22c55e';
          fb.textContent = `✓ Correto! (${cur.answer})`;
          setTimeout(() => { __clozeQueue.shift(); renderClozeQuizStep(); }, 900);
        } else {
          fb.style.color = '#f59e0b';
          fb.textContent = `Quase! Resposta esperada: ${cur.answer}`;
          setTimeout(() => { __clozeQueue.shift(); renderClozeQuizStep(); }, 1300);
        }
      });
      document.getElementById('btnSkipClozeGuess').addEventListener('click', () => {
        fb.style.color = 'var(--accent)';
        fb.textContent = `Resposta: ${cur.answer}`;
        setTimeout(() => { __clozeQueue.shift(); renderClozeQuizStep(); }, 1100);
      });
    }

    const btnClozeEl = document.getElementById('btnStartClozeQuiz');
    if (btnClozeEl) {
      btnClozeEl.addEventListener('click', () => {
        const bk = state.bookKey;
        const hls = bk ? (getHighlightsMap()[bk] || []) : [];
        const nts = bk && typeof getEntityNotesMap === 'function' ? Object.values(getEntityNotesMap(bk) || {}) : [];
        __clozeQueue = generateClozeQuizItems(hls, nts);
        __clozeScore = 0;
        if (!__clozeQueue.length) {
          showToast('Destaque trechos (>= 18 caracteres) no livro para gerar o Quiz de Lacunas!', true);
          return;
        }
        renderClozeQuizStep();
      });
    }

    // 5. Citações Acadêmicas em 1 Clique (ABNT / APA / BibTeX)
    function formatAcademicCitation(bookObj, style = 'ABNT', pageOrLoc = '') {
      const title = (bookObj && bookObj.title) || 'Sem título';
      const authorRaw = (bookObj && bookObj.author) || 'Autor Desconhecido';
      const year = (bookObj && (bookObj.year || bookObj.publishYear)) || new Date().getFullYear();
      const publisher = (bookObj && bookObj.publisher) || 'Edição Digital';
      const parts = authorRaw.trim().split(/\s+/);
      const last = parts.length > 1 ? parts[parts.length - 1] : authorRaw;
      const firsts = parts.length > 1 ? parts.slice(0, -1).join(' ') : '';
      const loc = pageOrLoc ? `, p. ${pageOrLoc}` : '';
      if (style === 'APA') {
        const initials = firsts ? firsts.split(/\s+/).map(x => x[0].toUpperCase() + '.').join(' ') : '';
        return `${last}${initials ? ', ' + initials : ''} (${year}). ${title}. ${publisher}.${pageOrLoc ? ` (p. ${pageOrLoc})` : ''}`;
      }
      if (style === 'BIBTEX') {
        const key = `${last.toLowerCase().replace(/[^a-z0-9]/g, '')}${year}`;
        return `@book{${key},\n  author = {${authorRaw}},\n  title = {${title}},\n  year = {${year}},\n  publisher = {${publisher}}\n}`;
      }
      return `${last.toUpperCase()}${firsts ? ', ' + firsts : ''}. ${title}. ${publisher}, ${year}${loc}.`;
    }

    const btnCopyCitEl = document.getElementById('btnCopyBookCitation');
    const selCitStyleEl = document.getElementById('selectCitationStyle');
    if (btnCopyCitEl && selCitStyleEl) {
      btnCopyCitEl.addEventListener('click', async () => {
        if (!activeBookInfoTarget) return;
        const metaMap = getBookMetadataMap();
        const meta = metaMap[activeBookInfoTarget.bookKey] || {};
        const cit = formatAcademicCitation({ ...activeBookInfoTarget, ...meta }, selCitStyleEl.value);
        try { await navigator.clipboard.writeText(cit); } catch {}
        const statusEl = document.getElementById('lblBookInfoStatus');
        if (statusEl) statusEl.textContent = `Citação ${selCitStyleEl.value} copiada!`;
        showToast(`Citação ${selCitStyleEl.value} copiada para a área de transferência!`);
      });
    }

    // 6. Método Cornell Split Pane
    const cornellPaneEl = document.getElementById('cornellPane');
    const btnCornellToggleEl = document.getElementById('btnCornellToggle');
    const cornellCuesEl = document.getElementById('cornellCues');
    const cornellNotesEl = document.getElementById('cornellNotes');
    const cornellSummaryEl = document.getElementById('cornellSummary');
    function loadCornellNotesForBook() {
      if (!cornellCuesEl || !cornellNotesEl || !cornellSummaryEl) return;
      try {
        const map = JSON.parse(localStorage.getItem('reader_cornell_notes') || '{}');
        const d = map[state.bookKey] || {};
        cornellCuesEl.value = d.cues || '';
        cornellNotesEl.value = d.notes || '';
        cornellSummaryEl.value = d.summary || '';
      } catch {}
    }
    function saveCornellNotesForBook() {
      if (!state.bookKey || !cornellCuesEl) return;
      try {
        const map = JSON.parse(localStorage.getItem('reader_cornell_notes') || '{}');
        map[state.bookKey] = {
          cues: cornellCuesEl.value,
          notes: cornellNotesEl.value,
          summary: cornellSummaryEl.value,
          updatedAt: Date.now()
        };
        localStorage.setItem('reader_cornell_notes', JSON.stringify(map));
      } catch {}
    }
    if (btnCornellToggleEl && cornellPaneEl) {
      btnCornellToggleEl.addEventListener('click', () => {
        const open = cornellPaneEl.classList.toggle('open');
        btnCornellToggleEl.classList.toggle('active', open);
        if (open) loadCornellNotesForBook();
      });
      const btnCloseCornellEl = document.getElementById('btnCloseCornell');
      if (btnCloseCornellEl) btnCloseCornellEl.addEventListener('click', () => {
        cornellPaneEl.classList.remove('open');
        btnCornellToggleEl.classList.remove('active');
      });
      [cornellCuesEl, cornellNotesEl, cornellSummaryEl].forEach(el => {
        if (el) el.addEventListener('input', saveCornellNotesForBook);
      });
      const btnExpCornellEl = document.getElementById('btnExportCornellMd');
      if (btnExpCornellEl) {
        btnExpCornellEl.addEventListener('click', () => {
          saveCornellNotesForBook();
          const md = `# Notas Método Cornell — ${state.title || 'Livro'}\n\n## Palavras-chave & Perguntas\n${cornellCuesEl.value || '-'}\n\n## Anotações Principais\n${cornellNotesEl.value || '-'}\n\n## Resumo\n${cornellSummaryEl.value || '-'}\n`;
          const blob = new Blob([md], { type: 'text/markdown;charset=utf-8' });
          const a = document.createElement('a');
          a.href = URL.createObjectURL(blob);
          a.download = `Cornell_${(state.title || 'notas').replace(/[^a-z0-9_-]/gi, '_')}.md`;
          a.click();
          setTimeout(() => URL.revokeObjectURL(a.href), 1500);
          showToast('Notas Cornell (.md) exportadas!');
        });
      }
    }


    // =========================================================
    // INTERFACE LIMPA: ESTANTE SEM POLUIÇÃO + PACOTES HABILITÁVEIS + SONS AMBIENTE
    // =========================================================
    (function initCleanWorkspaceControls() {
      const emptyEl = document.getElementById('emptyState');
      const syncShelfBodyClass = () => {
        if (!emptyEl) return;
        document.body.classList.toggle('shelf-overlay-open', !emptyEl.classList.contains('hidden'));
      };
      if (emptyEl) {
        syncShelfBodyClass();
        new MutationObserver(syncShelfBodyClass).observe(emptyEl, { attributes: true, attributeFilter: ['class'] });
      }

      const packs = [
        { id: 'chkEnableStudyTools', key: 'reader_v2_study_tools', attr: 'studyTools', label: 'Ferramentas de Estudo' },
        { id: 'chkEnableLangTools', key: 'reader_v2_lang_tools', attr: 'langTools', label: 'Ferramentas de Idiomas' },
        { id: 'chkEnableAmbientAudio', key: 'reader_v2_ambient_audio', attr: 'ambientAudio', label: 'Sons Ambiente' }
      ];
      packs.forEach(p => {
        const el = document.getElementById(p.id);
        const on = localStorage.getItem(p.key) === '1';
        document.body.dataset[p.attr] = on ? '1' : '0';
        if (el) {
          el.checked = on;
          el.addEventListener('change', () => {
            const val = el.checked ? '1' : '0';
            document.body.dataset[p.attr] = val;
            localStorage.setItem(p.key, val);
            showToast(`${p.label} ${el.checked ? 'habilitadas' : 'ocultadas'}.`);
          });
        }
      });

      const selAmb = document.getElementById('selectAmbientSound');
      const rngVol = document.getElementById('rangeAmbientVol');
      let ambCtx = null, ambGain = null, ambNode = null;
      function stopAmbient() {
        try { if (ambNode) ambNode.disconnect(); } catch {}
        try { if (ambCtx) ambCtx.close(); } catch {}
        ambCtx = null; ambGain = null; ambNode = null;
      }
      function startAmbient(mode) {
        stopAmbient();
        if (mode === 'off') return;
        const AudioCtx = window.AudioContext || window.webkitAudioContext;
        if (!AudioCtx) return;
        ambCtx = new AudioCtx();
        const bufSize = ambCtx.sampleRate * 2;
        const buffer = ambCtx.createBuffer(1, bufSize, ambCtx.sampleRate);
        const data = buffer.getChannelData(0);
        let lastOut = 0;
        for (let i = 0; i < bufSize; i++) {
          const white = Math.random() * 2 - 1;
          lastOut = (lastOut + (0.02 * white)) / 1.02;
          data[i] = mode === 'rain' ? white * 0.25 : lastOut * 2.8;
        }
        const src = ambCtx.createBufferSource();
        src.buffer = buffer;
        src.loop = true;
        const filter = ambCtx.createBiquadFilter();
        filter.type = 'lowpass';
        filter.frequency.value = mode === 'rain' ? 1400 : (mode === 'fire' ? 420 : 650);
        ambGain = ambCtx.createGain();
        ambGain.gain.value = ((parseInt(rngVol ? rngVol.value : '35', 10) || 35) / 100) * 0.35;
        src.connect(filter);
        filter.connect(ambGain);
        ambGain.connect(ambCtx.destination);
        src.start();
        ambNode = src;
      }
      if (selAmb) selAmb.addEventListener('change', () => startAmbient(selAmb.value));
      if (rngVol) rngVol.addEventListener('input', () => {
        if (ambGain) ambGain.gain.value = ((parseInt(rngVol.value, 10) || 0) / 100) * 0.35;
      });
    })();
