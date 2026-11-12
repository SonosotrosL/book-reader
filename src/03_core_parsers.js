    /**********************************************************************
     * LEITOR PORTÁTIL DE LIVROS (EPUB · MOBI · PDF)
     * - Parser MOBI/PalmDOC corrigido (varint big-endian oficial KindleUnpack,
     *   suporte a filepos, divisão inteligente de capítulos longos e imagens)
     * - Parser EPUB com resolução de links internos, âncoras e árvore NCX/Nav
     * - Renderizador PDF sob demanda (Canvas HD com Zoom + modo Texto opcional)
     * - Paginação por colunas (1 ou 2 colunas) + Rolagem contínua
     **********************************************************************/

    const state = {
      bookKey: null,
      title: '',
      author: '',
      format: '',
      sections: [],        // [{ title, html, text, path, fileposStart, fileposEnd, pageNumber, imageUrl }]
      toc: [],             // [{ label, sectionIndex, anchor, filepos, depth }]
      pathToSection: new Map(),
      idToSection: new Map(),
      currentIndex: 0,
      subPageIndex: 0,
      subPageCount: 1,
      flowMode: localStorage.getItem('reader_flowMode') || 'scroll', // 'scroll' | 'paginated-1' | 'paginated-2'
      mangaRtl: localStorage.getItem('reader_mangaRtl') === 'true',
      // PDF state
      pdfDoc: null,
      pdfViewMode: 'canvas', // 'canvas' | 'reflow'
      pdfScale: 1.35,
      pdfTint: false,
      // Seleção atual p/ Dicionário / Tradutor / Anki
      selectedText: '',
      selectedContext: '',
      // Preferências visuais (Site/App vs Folha do Livro)
      theme: localStorage.getItem('reader_theme') || 'sepia',
      bookTheme: localStorage.getItem('reader_bookTheme') || 'same',
      accentPreset: localStorage.getItem('reader_accentPreset') || 'default',
      shelfDensity: localStorage.getItem('reader_shelfDensity') || 'normal',
      shelfSort: localStorage.getItem('reader_shelfSort') || 'recent',
      shelfOrigin: localStorage.getItem('reader_shelfOrigin') || 'all',
      groupShelfSeries: localStorage.getItem('reader_groupShelfSeries') === 'true',
      textOrientation: localStorage.getItem('reader_textOrientation') || 'horizontal',
      webtoonStrip: localStorage.getItem('reader_webtoonStrip') === 'true',
      webtoonWidth: parseInt(localStorage.getItem('reader_webtoonWidth') || '100', 10) || 100,
      pdfContrast: parseInt(localStorage.getItem('reader_pdfContrast') || '100', 10) || 100,
      pdfBrightness: parseInt(localStorage.getItem('reader_pdfBrightness') || '100', 10) || 100,
      shelfBatchMode: false,
      tapZones: localStorage.getItem('reader_tapZones') !== 'false',
      seriesQueue: null,
      fontSize: parseInt(localStorage.getItem('reader_fontSize') || '18', 10),
      fontFamily: localStorage.getItem('reader_fontFamily') || "Georgia, 'Times New Roman', serif",
      lineHeight: localStorage.getItem('reader_lineHeight') || '1.72',
      maxWidth: localStorage.getItem('reader_maxWidth') || '720px',
      textAlign: localStorage.getItem('reader_textAlign') || 'justify',
      wordWise: localStorage.getItem('reader_wordWise') === 'true',
      warmthLevel: parseInt(localStorage.getItem('reader_warmthLevel') || '0', 10),
      footerMode: localStorage.getItem('reader_footerMode') || 'full',
      readingWpm: parseInt(localStorage.getItem('reader_wpm') || '215', 10),
      lastPageTurnTime: Date.now(),
      originalFormat: localStorage.getItem('reader_originalFormat') === 'true',
      bionicReading: localStorage.getItem('reader_bionicReading') === 'true',
      geminiApiKey: localStorage.getItem('reader_geminiApiKey') || '',
      autoPrefetchChapters: localStorage.getItem('reader_autoPrefetch') === 'true',
      pinnedLocation: null,
      objectUrls: []
    };

    const dom = {
      fileInput: document.getElementById('fileInput'),
      sidebar: document.getElementById('sidebar'),
      viewport: document.getElementById('viewport'),
      emptyState: document.getElementById('emptyState'),
      pdfStage: document.getElementById('pdfStage'),
      pdfContainer: document.getElementById('pdfContainer'),
      pdfCanvas: document.getElementById('pdfCanvas'),
      pdfControls: document.getElementById('pdfControls'),
      flowModeGroup: document.getElementById('flowModeGroup'),
      btnMangaRtl: document.getElementById('btnMangaRtl'),
      pageSheet: document.getElementById('pageSheet'),
      readerFlow: document.getElementById('readerFlow'),
      headerTitle: document.getElementById('headerTitle'),
      headerMeta: document.getElementById('headerMeta'),
      sheetBookTitle: document.getElementById('sheetBookTitle'),
      sheetChapterTitle: document.getElementById('sheetChapterTitle'),
      sheetFooterInfo: document.getElementById('sheetFooterInfo'),
      inputSectionNum: document.getElementById('inputSectionNum'),
      lblTotalSections: document.getElementById('lblTotalSections'),
      tocContainer: document.getElementById('tocContainer'),
      bookmarksContainer: document.getElementById('bookmarksContainer'),
      searchContainer: document.getElementById('searchContainer'),
      vocabContainer: document.getElementById('vocabContainer'),
      inputSearch: document.getElementById('inputSearch'),
      statusLeft: document.getElementById('statusLeft'),
      statusPercent: document.getElementById('statusPercent'),
      progressFill: document.getElementById('progressFill'),
      progressTrack: document.getElementById('progressTrack'),
      typoPopover: document.getElementById('typoPopover'),
      lblFontSize: document.getElementById('lblFontSize'),
      selectFontFamily: document.getElementById('selectFontFamily'),
      lblZoom: document.getElementById('lblZoom'),
      btnPdfViewMode: document.getElementById('btnPdfViewMode'),
      btnPdfTint: document.getElementById('btnPdfTint'),
      recentBlock: document.getElementById('recentBlock'),
      recentTableBody: document.getElementById('recentTableBody'),
      selectionToolbar: document.getElementById('selectionToolbar'),
      lookupModal: document.getElementById('lookupModal'),
      inputAnkiFront: document.getElementById('inputAnkiFront'),
      inputAnkiBack: document.getElementById('inputAnkiBack'),
      inputAnkiContext: document.getElementById('inputAnkiContext'),
      selectTargetLang: document.getElementById('selectTargetLang'),
      modalStatus: document.getElementById('modalStatus'),
      toastBar: document.getElementById('toastBar')
    };

    let toastTimer = null;
    function showToast(msg) {
      dom.toastBar.textContent = msg;
      dom.toastBar.classList.add('show');
      clearTimeout(toastTimer);
      toastTimer = setTimeout(() => dom.toastBar.classList.remove('show'), 2800);
    }

    /* =====================================================================
     * 1. PREFERÊNCIAS DE TEMA, TIPOGRAFIA E PAGINAÇÃO REAL (MODO LIVRO)
     * ===================================================================== */
    function applySettings() {
      document.documentElement.setAttribute('data-theme', state.theme);
      document.documentElement.setAttribute('data-accent', state.accentPreset || 'default');
      if (dom.pageSheet) {
        if (state.bookTheme && state.bookTheme !== 'same') {
          dom.pageSheet.setAttribute('data-book-theme', state.bookTheme);
        } else {
          dom.pageSheet.removeAttribute('data-book-theme');
        }
      }
      const shelfGridEl = document.getElementById('bookshelfGrid');
      if (shelfGridEl) {
        shelfGridEl.classList.toggle('density-compact', state.shelfDensity === 'compact');
        shelfGridEl.classList.toggle('density-large', state.shelfDensity === 'large');
      }
      const lblTypo = document.getElementById('lblTypographyBtn');
      if (lblTypo) {
        lblTypo.textContent = (document.body.classList.contains('is-shelf-home') || !state.sections.length)
          ? 'Tema / Visual'
          : 'Aa Tema';
      }
      document.documentElement.style.setProperty('--book-font-size', state.fontSize + 'px');
      document.documentElement.style.setProperty('--book-font', state.fontFamily);
      document.documentElement.style.setProperty('--book-line-height', state.lineHeight);
      document.documentElement.style.setProperty('--book-max-width', state.maxWidth);
      document.documentElement.style.setProperty('--book-align', state.textAlign);
      const wtPct = Math.max(55, Math.min(100, Number(state.webtoonWidth) || 100));
      document.documentElement.style.setProperty('--webtoon-max-width', wtPct + '%');
      const pdfC = Math.max(85, Math.min(160, Number(state.pdfContrast) || 100));
      const pdfB = Math.max(75, Math.min(130, Number(state.pdfBrightness) || 100));
      document.documentElement.style.setProperty('--pdf-contrast', pdfC + '%');
      document.documentElement.style.setProperty('--pdf-brightness', pdfB + '%');
      document.documentElement.style.setProperty('--pdf-contrast-num', String(pdfC / 100));
      document.documentElement.style.setProperty('--pdf-brightness-num', String(pdfB / 100));
      const lblWt = document.getElementById('lblWebtoonWidth');
      if (lblWt) lblWt.textContent = wtPct + '%';
      const inpWt = document.getElementById('inputWebtoonWidth');
      if (inpWt) inpWt.value = String(wtPct);
      const lblPdfAdj = document.getElementById('lblPdfAdjust');
      if (lblPdfAdj) lblPdfAdj.textContent = `${pdfC}% / ${pdfB}%`;
      const inpPdfC = document.getElementById('inputPdfContrast');
      if (inpPdfC) inpPdfC.value = String(pdfC);
      const inpPdfB = document.getElementById('inputPdfBrightness');
      if (inpPdfB) inpPdfB.value = String(pdfB);

      if (dom.readerFlow) {
        dom.readerFlow.classList.toggle('vertical-cjk', state.textOrientation === 'vertical');
      }
      const btnOrientH = document.getElementById('btnTextOrientHorizontal');
      const btnOrientV = document.getElementById('btnTextOrientVertical');
      if (btnOrientH && btnOrientV) {
        btnOrientH.classList.toggle('active', state.textOrientation !== 'vertical');
        btnOrientV.classList.toggle('active', state.textOrientation === 'vertical');
      }

      dom.lblFontSize.textContent = state.fontSize + 'px';
      dom.selectFontFamily.value = state.fontFamily;

      document.querySelectorAll('[data-theme-val]').forEach(b => {
        b.classList.toggle('active', b.dataset.themeVal === state.theme);
      });
      document.querySelectorAll('.book-theme-opt').forEach(b => {
        b.classList.toggle('active', b.dataset.bookTheme === state.bookTheme);
      });
      document.querySelectorAll('[data-accent-val]').forEach(b => {
        b.classList.toggle('active', b.dataset.accentVal === state.accentPreset);
      });
      document.querySelectorAll('.density-opt').forEach(b => {
        b.classList.toggle('active', b.dataset.density === state.shelfDensity);
      });
      document.querySelectorAll('.line-opt').forEach(b => {
        b.classList.toggle('active', b.dataset.lh === state.lineHeight);
      });
      document.querySelectorAll('.width-opt').forEach(b => {
        b.classList.toggle('active', b.dataset.mw === state.maxWidth);
      });
      document.querySelectorAll('.align-opt').forEach(b => {
        b.classList.toggle('active', b.dataset.align === state.textAlign);
      });
      document.querySelectorAll('[data-flow]').forEach(b => {
        b.classList.toggle('active', b.dataset.flow === state.flowMode);
      });

      const isMangaMode = state.readingType === 'manga' || state.format === 'CBZ';
      const btnModeBook = document.getElementById('btnModeBook');
      const btnModeManga = document.getElementById('btnModeManga');
      if (btnModeBook && btnModeManga) {
        btnModeBook.classList.toggle('active', !isMangaMode);
        btnModeManga.classList.toggle('active', isMangaMode);
      }
      if (dom.btnMangaRtl) {
        dom.btnMangaRtl.classList.toggle('hidden', !isMangaMode || Boolean(state.webtoonStrip));
        dom.btnMangaRtl.classList.toggle('active', state.mangaRtl);
        const lblDir = document.getElementById('lblMangaDir');
        if (lblDir) {
          lblDir.textContent = state.mangaRtl ? 'Mangá Japonês (Direita ← Esquerda)' : 'HQ Ocidental (Esquerda → Direita)';
        }
      }
      const btnStripEl = document.getElementById('btnMangaStrip');
      if (btnStripEl) {
        btnStripEl.classList.toggle('hidden', !isMangaMode);
        btnStripEl.classList.toggle('active', Boolean(state.webtoonStrip && isMangaMode));
      }
      if (dom.pageSheet) {
        dom.pageSheet.classList.toggle('webtoon-strip', Boolean(isMangaMode && state.webtoonStrip));
      }
      if (dom.readerFlow) {
        dom.readerFlow.classList.toggle('webtoon-strip', Boolean(isMangaMode && state.webtoonStrip));
      }
      const chkTapEl = document.getElementById('chkTapZones');
      if (chkTapEl) chkTapEl.checked = state.tapZones !== false;
      const btnGroupShelfEl = document.getElementById('btnToggleShelfGroup');
      if (btnGroupShelfEl) btnGroupShelfEl.classList.toggle('active', Boolean(state.groupShelfSeries));

      const tbTintBtn = document.getElementById('btnPdfTintToolbar');
      if (tbTintBtn) {
        tbTintBtn.classList.toggle('hidden', isMangaMode);
      }
      if (dom.pdfStage) {
        dom.pdfStage.classList.toggle('manga-rtl-stage', Boolean(state.mangaRtl && isMangaMode));
      }

      const isContinuousAll = state.flowMode === 'scroll-all';
      const isPdfCanvas = state.format === 'PDF' && state.pdfViewMode === 'canvas' && !isContinuousAll;
      const isPaginated = state.flowMode.startsWith('paginated') && !isPdfCanvas;
      dom.viewport.classList.toggle('paginated-mode', isPaginated);
      dom.viewport.classList.toggle('two-columns', state.flowMode === 'paginated-2' && window.innerWidth >= 700);
      dom.viewport.classList.toggle('manga-rtl', state.mangaRtl && (isMangaMode || state.format === 'CBZ'));
      dom.readerFlow.classList.toggle('original-format', Boolean(state.originalFormat));

      const btnStyleAd = document.getElementById('btnStyleAdapted');
      const btnStyleOr = document.getElementById('btnStyleOriginal');
      if (btnStyleAd && btnStyleOr) {
        btnStyleAd.classList.toggle('active', !state.originalFormat);
        btnStyleOr.classList.toggle('active', Boolean(state.originalFormat));
      }
      localStorage.setItem('reader_originalFormat', String(!!state.originalFormat));

      if (state.sections.length && !isPdfCanvas) {
        dom.pageSheet.style.display = isPaginated ? 'flex' : 'block';
      }

      localStorage.setItem('reader_theme', state.theme);
      localStorage.setItem('reader_bookTheme', state.bookTheme);
      localStorage.setItem('reader_accentPreset', state.accentPreset);
      localStorage.setItem('reader_shelfDensity', state.shelfDensity);
      localStorage.setItem('reader_shelfSort', state.shelfSort);
      localStorage.setItem('reader_groupShelfSeries', String(!!state.groupShelfSeries));
      localStorage.setItem('reader_webtoonStrip', String(!!state.webtoonStrip));
      localStorage.setItem('reader_webtoonWidth', String(state.webtoonWidth || 100));
      localStorage.setItem('reader_pdfContrast', String(state.pdfContrast || 100));
      localStorage.setItem('reader_pdfBrightness', String(state.pdfBrightness || 100));
      localStorage.setItem('reader_tapZones', String(state.tapZones !== false));
      localStorage.setItem('reader_fontSize', String(state.fontSize));
      localStorage.setItem('reader_fontFamily', state.fontFamily);
      localStorage.setItem('reader_lineHeight', state.lineHeight);
      localStorage.setItem('reader_maxWidth', state.maxWidth);
      localStorage.setItem('reader_textAlign', state.textAlign);
      localStorage.setItem('reader_flowMode', state.flowMode);
      localStorage.setItem('reader_mangaRtl', String(state.mangaRtl));
      localStorage.setItem('reader_wordWise', String(!!state.wordWise));
      localStorage.setItem('reader_warmthLevel', String(state.warmthLevel || 0));

      document.body.classList.toggle('bionic-active', Boolean(state.bionicReading));
      const chkBionic = document.getElementById('chkEnableBionic');
      if (chkBionic) chkBionic.checked = Boolean(state.bionicReading);
      localStorage.setItem('reader_bionicReading', String(!!state.bionicReading));

      const chkPrefetch = document.getElementById('chkAutoPrefetchChapter');
      if (chkPrefetch) chkPrefetch.checked = Boolean(state.autoPrefetchChapters);
      localStorage.setItem('reader_autoPrefetch', String(!!state.autoPrefetchChapters));

      const warmthEl = document.getElementById('warmthOverlay');
      if (warmthEl) {
        const alpha = Math.max(0, Math.min(0.42, (state.warmthLevel || 0) / 100 * 0.42));
        warmthEl.style.background = `rgba(255, 148, 42, ${alpha.toFixed(3)})`;
      }
      const lblWarmth = document.getElementById('lblWarmthVal');
      if (lblWarmth) lblWarmth.textContent = `${state.warmthLevel || 0}%`;
      const inputWarmth = document.getElementById('inputWarmthLevel');
      if (inputWarmth && document.activeElement !== inputWarmth) inputWarmth.value = String(state.warmthLevel || 0);

      const lblWw = document.getElementById('lblWordWiseState');
      if (lblWw) lblWw.textContent = state.wordWise ? 'Ativo' : 'Desativado';
      const btnWw = document.getElementById('btnWordWiseToggle');
      if (btnWw) btnWw.classList.toggle('active', !!state.wordWise);

      if (isPaginated && state.sections.length) {
        requestAnimationFrame(updatePaginatedMetrics);
      } else {
        dom.readerFlow.style.columnWidth = '';
        dom.readerFlow.style.columnGap = '';
        dom.readerFlow.style.columnCount = '';
        dom.readerFlow.scrollLeft = 0;
      }
    }

    function updatePaginatedMetrics() {
      const flow = dom.readerFlow;
      if (!dom.viewport.classList.contains('paginated-mode')) {
        state.subPageCount = 1;
        state.subPageIndex = 0;
        flow.style.columnWidth = '';
        flow.style.columnGap = '';
        flow.style.columnCount = '';
        flow.scrollLeft = 0;
        return;
      }

      // Em modo Mangá (CBZ, PDF ou EPUB ilustrado), cada página ou par de páginas é ajustado inteiro na tela sem dividir em sub-colunas
      if (state.format === 'CBZ' || state.readingType === 'manga' || flow.querySelector('.manga-page-wrap')) {
        state.subPageCount = 1;
        state.subPageIndex = 0;
        flow.style.columnWidth = '';
        flow.style.columnGap = '';
        flow.style.columnCount = '';
        flow.scrollLeft = 0;
        updateFooterLabels();
        return;
      }

      const w = flow.clientWidth;
      if (w <= 0) return;

      const isTwoCols = state.flowMode === 'paginated-2' && window.innerWidth >= 700;
      const gap = isTwoCols ? 64 : 48;
      const colW = isTwoCols ? ((w - gap) / 2) : w;

      flow.style.columnGap = gap + 'px';
      flow.style.columnWidth = colW + 'px';
      flow.style.columnCount = isTwoCols ? '2' : '1';

      // Em CSS multi-column, col1 + gap + col2 = w sempre; logo a próxima página começa em (w + gap) sem acumular erro de arredondamento
      const stride = w + gap;
      const totalWidth = flow.scrollWidth;
      state.subPageCount = Math.max(1, Math.round((totalWidth + gap) / Math.max(1, stride)));
      state.subPageIndex = Math.max(0, Math.min(state.subPageIndex, state.subPageCount - 1));
      flow.scrollLeft = state.subPageIndex * stride;
      updateFooterLabels();
    }

    if (!state.sections.length && dom.inputSectionNum) {
      dom.inputSectionNum.value = '0';
      if (dom.lblTotalSections) dom.lblTotalSections.textContent = '/ 0';
    }

    let resizeFitTimer = null;
    function handleViewportReflowOnResize() {
      if (!state.sections.length) return;
      clearTimeout(resizeFitTimer);
      resizeFitTimer = setTimeout(() => {
        if (state.format === 'PDF' && state.pdfViewMode === 'canvas' && state.pdfDoc) {
          const sec = state.sections[state.currentIndex];
          if (sec) renderPdfPageCanvas(sec.pageNumber);
        } else if (dom.viewport.classList.contains('paginated-mode')) {
          updatePaginatedMetrics();
        }
      }, 140);
    }
    window.addEventListener('resize', handleViewportReflowOnResize);
    window.addEventListener('orientationchange', handleViewportReflowOnResize);

    /* =====================================================================
     * 2. LEITOR ZIP NATIVO (PARA EPUB)
     * ===================================================================== */
    let __zipWorkerSingleton = null;
    let __zipWorkerJobSeq = 0;
    const __zipWorkerPending = new Map();

    function getZipInflateWorker() {
      if (__zipWorkerSingleton) return __zipWorkerSingleton;
      if (typeof Worker === 'undefined' || typeof Blob === 'undefined' || !location.protocol.startsWith('http')) return null;
      try {
        const workerSrc = `
          self.onmessage = async (ev) => {
            const { id, buf } = ev.data;
            try {
              if (typeof DecompressionStream === 'undefined') throw new Error('no-ds');
              const stream = new Blob([buf]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
              const out = await new Response(stream).arrayBuffer();
              self.postMessage({ id, ok: true, out }, [out]);
            } catch (err) {
              self.postMessage({ id, ok: false, error: String(err && err.message || err) });
            }
          };
        `;
        const blobUrl = URL.createObjectURL(new Blob([workerSrc], { type: 'application/javascript' }));
        const w = new Worker(blobUrl);
        w.onmessage = (ev) => {
          const msg = ev.data || {};
          const job = __zipWorkerPending.get(msg.id);
          if (!job) return;
          __zipWorkerPending.delete(msg.id);
          if (msg.ok && msg.out) job.resolve(new Uint8Array(msg.out));
          else job.reject(new Error(msg.error || 'worker-inflate-failed'));
        };
        w.onerror = () => {
          for (const [, job] of __zipWorkerPending.entries()) job.reject(new Error('worker-error'));
          __zipWorkerPending.clear();
          __zipWorkerSingleton = null;
        };
        __zipWorkerSingleton = w;
        return w;
      } catch {
        return null;
      }
    }

    function inflateDeflateRawInWorker(slice) {
      const w = getZipInflateWorker();
      if (!w) return Promise.resolve(null);
      const id = ++__zipWorkerJobSeq;
      const copyBuf = slice.slice().buffer;
      return new Promise((resolve, reject) => {
        __zipWorkerPending.set(id, { resolve, reject });
        w.postMessage({ id, buf: copyBuf }, [copyBuf]);
      });
    }

    async function openZipBuffer(arrayBuffer) {
      const view = new DataView(arrayBuffer);
      const bytes = new Uint8Array(arrayBuffer);
      let eocd = -1;
      const minPos = Math.max(0, bytes.length - 65557);
      for (let i = bytes.length - 22; i >= minPos; i--) {
        if (view.getUint32(i, true) === 0x06054b50) {
          eocd = i;
          break;
        }
      }
      if (eocd === -1) throw new Error('Arquivo EPUB/ZIP inválido.');

      const count = view.getUint16(eocd + 10, true);
      const cdOffset = view.getUint32(eocd + 16, true);
      const utf8 = new TextDecoder('utf-8');
      const latin1 = new TextDecoder('windows-1252');
      const entries = new Map();

      let ptr = cdOffset;
      for (let i = 0; i < count && ptr + 46 <= bytes.length; i++) {
        if (view.getUint32(ptr, true) !== 0x02014b50) break;
        const flags = view.getUint16(ptr + 8, true);
        const method = view.getUint16(ptr + 10, true);
        const compSize = view.getUint32(ptr + 20, true);
        const uncompSize = view.getUint32(ptr + 24, true);
        const nameLen = view.getUint16(ptr + 28, true);
        const extraLen = view.getUint16(ptr + 30, true);
        const commentLen = view.getUint16(ptr + 32, true);
        const localOffset = view.getUint32(ptr + 42, true);
        const nameSlice = bytes.subarray(ptr + 46, ptr + 46 + nameLen);
        const rawName = (flags & 0x0800) ? utf8.decode(nameSlice) : utf8.decode(nameSlice);
        const normName = rawName.replace(/\\/g, '/').replace(/^\/+/, '');
        entries.set(normName, { method, compSize, uncompSize, localOffset, name: normName });
        if (!(flags & 0x0800)) {
          const altName = latin1.decode(nameSlice).replace(/\\/g, '/').replace(/^\/+/, '');
          if (!entries.has(altName)) {
            entries.set(altName, { method, compSize, uncompSize, localOffset, name: altName });
          }
        }
        ptr += 46 + nameLen + extraLen + commentLen;
      }

      function findEntry(path) {
        if (!path) return null;
        const clean = path.replace(/\\/g, '/').replace(/^\/+/, '');
        if (entries.has(clean)) return entries.get(clean);
        let decoded = clean;
        try { decoded = decodeURIComponent(clean); } catch {}
        if (entries.has(decoded)) return entries.get(decoded);
        const lower = decoded.toLowerCase();
        for (const [k, v] of entries.entries()) {
          const kl = k.toLowerCase();
          if (kl === lower) return v;
          try {
            if (decodeURIComponent(kl) === lower) return v;
          } catch {}
        }
        // Fallback por sufixo ou basename caso o OPF tenha caminhos relativos fora de padrão
        const base = lower.split('/').pop();
        for (const [k, v] of entries.entries()) {
          const kl = k.toLowerCase();
          if (kl.endsWith('/' + lower) || kl.split('/').pop() === base) return v;
        }
        return null;
      }

      async function readBytes(path) {
        const entry = findEntry(path);
        if (!entry) return null;
        const lh = entry.localOffset;
        if (lh + 30 > bytes.length || view.getUint32(lh, true) !== 0x04034b50) return null;
        const nLen = view.getUint16(lh + 26, true);
        const exLen = view.getUint16(lh + 28, true);
        const start = lh + 30 + nLen + exLen;
        const slice = bytes.subarray(start, Math.min(bytes.length, start + entry.compSize));
        if (entry.method === 0) return slice;
        if (entry.method === 8) {
          if (slice.byteLength >= 131072 && location.protocol.startsWith('http') && typeof Worker !== 'undefined') {
            try {
              const workerBytes = await inflateDeflateRawInWorker(slice);
              if (workerBytes) return workerBytes;
            } catch {}
          }
          const stream = new Blob([slice]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
          const ab = await new Response(stream).arrayBuffer();
          return new Uint8Array(ab);
        }
        throw new Error('Método de compressão ZIP não suportado: ' + entry.method);
      }

      function decodeTextBytes(b) {
        if (!b || !b.length) return '';
        if (b.length >= 2 && b[0] === 0xfe && b[1] === 0xff) {
          return new TextDecoder('utf-16be').decode(b.subarray(2));
        }
        if (b.length >= 2 && b[0] === 0xff && b[1] === 0xfe) {
          return new TextDecoder('utf-16le').decode(b.subarray(2));
        }
        let start = 0;
        if (b.length >= 3 && b[0] === 0xef && b[1] === 0xbb && b[2] === 0xbf) {
          start = 3;
        }
        const headAscii = new TextDecoder('latin1').decode(b.subarray(start, Math.min(b.length, start + 250)));
        if (/encoding=["'](iso-8859-1|latin1|windows-1252|cp1252)["']/i.test(headAscii)) {
          return new TextDecoder('windows-1252').decode(b.subarray(start));
        }
        return new TextDecoder('utf-8', { fatal: false }).decode(b.subarray(start));
      }

      async function readText(path) {
        const b = await readBytes(path);
        return b ? decodeTextBytes(b) : null;
      }

      return { entries, readBytes, readText };
    }

    function resolveRelPath(baseFile, href) {
      if (!href) return '';
      const pathPart = href.split('#')[0].trim().replace(/\\/g, '/');
      if (!pathPart) return baseFile;
      if (pathPart.startsWith('/')) return pathPart.replace(/^\/+/, '');
      const parts = baseFile.replace(/\\/g, '/').split('/');
      parts.pop();
      for (const seg of pathPart.split('/')) {
        if (!seg || seg === '.') continue;
        if (seg === '..') parts.pop();
        else parts.push(seg);
      }
      return parts.join('/');
    }

    function parseXmlFlexible(parser, xmlText) {
      const cleaned = xmlText
        .replace(/^\uFEFF/, '')
        .trim()
        .replace(/&nbsp;/gi, '&#160;')
        .replace(/&mdash;/gi, '&#8212;')
        .replace(/&ndash;/gi, '&#8211;')
        .replace(/&copy;/gi, '&#169;')
        .replace(/&reg;/gi, '&#174;')
        .replace(/&(?!#[0-9]+;|#x[0-9a-fA-F]+;|[a-zA-Z0-9_]+;)/g, '&amp;');
      let doc = parser.parseFromString(cleaned, 'application/xml');
      if (doc.querySelector('parsererror')) {
        doc = parser.parseFromString(cleaned, 'text/html');
      }
      return doc;
    }

    // Expande tags XHTML auto-fechadas (<title/>, <div/>, <a id="..."/>, <span/>)
    // que no parser HTML5 ('text/html') engoliriam o restante do capítulo!
    function normalizeXhtmlForHtml(rawXhtml) {
      return rawXhtml
        .replace(/<head\b[^>]*>[\s\S]*?<\/head>/gi, '')
        .replace(/<(title|script|style|textarea|iframe)\b[^>]*\/>/gi, '')
        .replace(/<(div|p|span|a|section|article|header|footer|aside|nav|h[1-6]|blockquote|ul|ol|li|dl|dt|dd|table|thead|tbody|tr|td|th|em|strong|b|i|u|s|sup|sub|small|big|center|font|figure|figcaption)\b([^>]*?)\/>/gi, '<$1$2></$1>');
    }

    /* =====================================================================
     * 3. PARSER EPUB COMPLETO (COM LINKS INTERNOS E ÁRVORE DE SUMÁRIO)
     * ===================================================================== */
    async function parseEpub(arrayBuffer, fileName) {
      const zip = await openZipBuffer(arrayBuffer);
      const parser = new DOMParser();

      let opfPath = null;
      const containerXml = await zip.readText('META-INF/container.xml');
      if (containerXml) {
        const containerDoc = parseXmlFlexible(parser, containerXml);
        const allC = Array.from(containerDoc.getElementsByTagName('*'));
        const rootfile = allC.find(n => (n.localName || n.tagName || '').toLowerCase().endsWith('rootfile') && n.getAttribute('full-path'));
        if (rootfile) opfPath = rootfile.getAttribute('full-path');
      }
      // Fallback caso META-INF/container.xml não exista ou aponte para caminho diferente
      if (!opfPath) {
        for (const k of zip.entries.keys()) {
          if (k.toLowerCase().endsWith('.opf')) {
            opfPath = k;
            break;
          }
        }
      }
      if (!opfPath) throw new Error('EPUB inválido: arquivo .opf não encontrado.');

      const opfXml = await zip.readText(opfPath);
      if (!opfXml) throw new Error('Não foi possível ler o arquivo OPF do EPUB.');
      const opfDoc = parseXmlFlexible(parser, opfXml);

      const allOpfNodes = Array.from(opfDoc.getElementsByTagName('*'));
      const getLocal = (n) => (n.localName || n.tagName || '').split(':').pop().toLowerCase();

      const titleNode = allOpfNodes.find(n => getLocal(n) === 'title' && n.textContent.trim());
      const authorNode = allOpfNodes.find(n => getLocal(n) === 'creator' && n.textContent.trim());
      const descNode = allOpfNodes.find(n => getLocal(n) === 'description' && n.textContent.trim());
      const pubNode = allOpfNodes.find(n => getLocal(n) === 'publisher' && n.textContent.trim());
      const langNode = allOpfNodes.find(n => getLocal(n) === 'language' && n.textContent.trim());
      const dateNode = allOpfNodes.find(n => getLocal(n) === 'date' && n.textContent.trim());
      const title = titleNode
        ? titleNode.textContent.trim()
        : fileName.replace(/\.epub$/i, '');
      const author = authorNode
        ? authorNode.textContent.trim()
        : 'Autor Desconhecido';
      const opfMeta = {
        description: descNode ? descNode.textContent.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim() : '',
        publisher: pubNode ? pubNode.textContent.trim() : '',
        language: langNode ? langNode.textContent.trim() : '',
        year: dateNode ? (dateNode.textContent.match(/\d{4}/) || [''])[0] : ''
      };

      const manifest = new Map();
      const manifestLower = new Map();
      allOpfNodes.filter(n => getLocal(n) === 'item').forEach(el => {
        const id = el.getAttribute('id');
        if (!id) return;
        const entryObj = {
          id,
          href: el.getAttribute('href') || '',
          type: (el.getAttribute('media-type') || '').toLowerCase(),
          props: el.getAttribute('properties') || ''
        };
        manifest.set(id, entryObj);
        manifestLower.set(id.toLowerCase(), entryObj);
      });

      // Extrair imagens em lotes paralelos (evita travar a aba ao abrir livros ilustrados)
      const imageBlobs = new Map();
      const epubImgItems = [];
      for (const [, item] of manifest.entries()) {
        if (item.type.startsWith('image/') || /\.(jpe?g|png|gif|webp|svg|bmp)$/i.test(item.href)) {
          epubImgItems.push(item);
        }
      }
      const EPUB_IMG_BATCH = 10;
      for (let i = 0; i < epubImgItems.length; i += EPUB_IMG_BATCH) {
        const chunk = epubImgItems.slice(i, i + EPUB_IMG_BATCH);
        await Promise.all(chunk.map(async (item) => {
          const fullPath = resolveRelPath(opfPath, item.href);
          const bytes = await zip.readBytes(fullPath);
          if (!bytes) return;
          const extLow = item.href.split('.').pop().toLowerCase();
          const mimeFallback = extLow === 'svg' ? 'image/svg+xml' : extLow === 'png' ? 'image/png' : extLow === 'webp' ? 'image/webp' : extLow === 'gif' ? 'image/gif' : 'image/jpeg';
          const mime = item.type.startsWith('image/') ? item.type : mimeFallback;
          const url = URL.createObjectURL(new Blob([bytes], { type: mime }));
          state.objectUrls.push(url);
          imageBlobs.set(fullPath, url);
          imageBlobs.set(fullPath.toLowerCase(), url);
          try {
            const decPath = decodeURIComponent(fullPath);
            imageBlobs.set(decPath, url);
            imageBlobs.set(decPath.toLowerCase(), url);
          } catch {}
          const baseImg = fullPath.split('/').pop().toLowerCase();
          if (baseImg && !imageBlobs.has(baseImg)) imageBlobs.set(baseImg, url);
        }));
        if (i % 30 === 20) await new Promise(r => setTimeout(r, 0));
      }

      // Ler entradas do Sumário (NCX ou EPUB3 Nav)
      const rawTocEntries = [];
      const spineEl = allOpfNodes.find(n => getLocal(n) === 'spine');
      let tocId = spineEl ? spineEl.getAttribute('toc') : null;
      if (!tocId) {
        for (const [id, it] of manifest.entries()) {
          if (it.type.includes('dtbncx') || it.href.toLowerCase().endsWith('.ncx')) {
            tocId = id;
            break;
          }
        }
      }

      if (tocId && (manifest.has(tocId) || manifestLower.has(tocId.toLowerCase()))) {
        const ncxItem = manifest.get(tocId) || manifestLower.get(tocId.toLowerCase());
        const ncxPath = resolveRelPath(opfPath, ncxItem.href);
        const ncxXml = await zip.readText(ncxPath);
        if (ncxXml) {
          const ncxDoc = parseXmlFlexible(parser, ncxXml);
          function walkNavPoints(parent, depth) {
            Array.from(parent.children).forEach(node => {
              if (getLocal(node) === 'navpoint') {
                const children = Array.from(node.children);
                const navLabel = children.find(c => getLocal(c) === 'navlabel');
                const contentEl = children.find(c => getLocal(c) === 'content');
                const lblText = navLabel ? navLabel.textContent.replace(/\s+/g, ' ').trim() : '';
                if (lblText && contentEl) {
                  const rawSrc = contentEl.getAttribute('src') || '';
                  const [relFile, hash] = rawSrc.split('#');
                  const targetPath = resolveRelPath(ncxPath, relFile);
                  rawTocEntries.push({
                    label: lblText,
                    path: targetPath,
                    anchor: hash || '',
                    depth
                  });
                }
                walkNavPoints(node, Math.min(2, depth + 1));
              }
            });
          }
          const allNcx = Array.from(ncxDoc.getElementsByTagName('*'));
          const navMap = allNcx.find(n => getLocal(n) === 'navmap');
          if (navMap) walkNavPoints(navMap, 0);
        }
      }

      if (rawTocEntries.length === 0) {
        for (const [, item] of manifest.entries()) {
          if (item.props.includes('nav') || item.href.toLowerCase().includes('nav')) {
            const navPath = resolveRelPath(opfPath, item.href);
            const navHtml = await zip.readText(navPath);
            if (navHtml) {
              const navDoc = parser.parseFromString(normalizeXhtmlForHtml(navHtml), 'text/html');
              navDoc.querySelectorAll('nav a[href], a[href]').forEach(a => {
                const rawHref = a.getAttribute('href') || '';
                if (/^(https?:|mailto:)/i.test(rawHref)) return;
                const [relFile, hash] = rawHref.split('#');
                const lbl = a.textContent.replace(/\s+/g, ' ').trim();
                if (lbl) {
                  rawTocEntries.push({
                    label: lbl,
                    path: resolveRelPath(navPath, relFile),
                    anchor: hash || '',
                    depth: 0
                  });
                }
              });
              if (rawTocEntries.length > 0) break;
            }
          }
        }
      }

      // Montar lista de itens do Spine (com fallback para todos os HTML/XHTML do manifest caso o spine falhe)
      const itemrefs = allOpfNodes.filter(n => getLocal(n) === 'itemref');
      const spineItems = [];
      for (const ref of itemrefs) {
        const idref = ref.getAttribute('idref') || '';
        const it = manifest.get(idref) || manifestLower.get(idref.toLowerCase());
        if (it) spineItems.push(it);
      }
      if (spineItems.length === 0) {
        for (const [, it] of manifest.entries()) {
          if (it.type.includes('html') || /\.(x?html?|htm|xml)$/i.test(it.href)) {
            if (!it.href.toLowerCase().endsWith('.ncx')) spineItems.push(it);
          }
        }
      }

      const sections = [];
      state.pathToSection.clear();
      state.idToSection.clear();

      function registerPathMapping(p, idx) {
        state.pathToSection.set(p, idx);
        state.pathToSection.set(p.toLowerCase(), idx);
        try {
          const dec = decodeURIComponent(p);
          state.pathToSection.set(dec, idx);
          state.pathToSection.set(dec.toLowerCase(), idx);
        } catch {}
        const base = p.split('/').pop().toLowerCase();
        if (base && !state.pathToSection.has(base)) {
          state.pathToSection.set(base, idx);
        }
      }

      // Ler arquivos CSS embutidos no EPUB para suportar o modo "Formatação Original do Livro"
      const cssCache = new Map();
      for (const [, item] of manifest.entries()) {
        if (item.type.includes('css') || item.href.toLowerCase().endsWith('.css')) {
          const cssFull = resolveRelPath(opfPath, item.href);
          const cssTxt = await zip.readText(cssFull);
          if (cssTxt) {
            cssCache.set(cssFull, cssTxt);
            cssCache.set(cssFull.toLowerCase(), cssTxt);
          }
        }
      }

      function scopeBookCss(rawCss) {
        if (!rawCss) return '';
        let cleaned = rawCss
          .replace(/@import[^;]+;/gi, '')
          .replace(/@font-face\s*\{[^}]*\}/gi, '')
          .replace(/@page\s*\{[^}]*\}/gi, '')
          .replace(/\b(?:html|body)\b/gi, '.reader-flow.original-format');
        // Prefixar seletores simples para não vazar fora de .reader-flow.original-format
        cleaned = cleaned.replace(/(^|\})\s*([^@{}]+?)\s*\{/g, (full, prefix, sel) => {
          const parts = sel.split(',').map(s => {
            const st = s.trim();
            if (!st) return '';
            if (st.includes('.reader-flow.original-format')) return st;
            return `.reader-flow.original-format ${st}`;
          }).filter(Boolean);
          return parts.length ? `${prefix} ${parts.join(', ')} {` : full;
        });
        return cleaned;
      }

      function buildCleanEpubSectionHtml(rawXhtml, secPath) {
        // Extrair CSS de links e <style> antes da normalização caso esteja em Formatação Original
        let extraCssBlocks = '';
        if (state.originalFormat) {
          const linkMatches = Array.from(rawXhtml.matchAll(/<link\b[^>]*href=["']([^"']+\.css[^"']*)["'][^>]*>/gi));
          linkMatches.forEach(lm => {
            const resolvedCss = resolveRelPath(secPath, lm[1]);
            const cssTxt = cssCache.get(resolvedCss) || cssCache.get(resolvedCss.toLowerCase());
            if (cssTxt) extraCssBlocks += scopeBookCss(cssTxt) + '\n';
          });
          const styleMatches = Array.from(rawXhtml.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/gi));
          styleMatches.forEach(sm => {
            extraCssBlocks += scopeBookCss(sm[1]) + '\n';
          });
        }

        const safeHtml = normalizeXhtmlForHtml(rawXhtml);
        const doc = parser.parseFromString(safeHtml, 'text/html');
        doc.querySelectorAll('script, style, link, meta, title, [hidden]').forEach(el => el.remove());

        // Remover elementos ocultos via CSS inline (ex: camadas de OCR ocultas com display:none ou visibility:hidden)
        doc.querySelectorAll('[style]').forEach(el => {
          const st = (el.getAttribute('style') || '').toLowerCase();
          if (/display\s*:\s*none|visibility\s*:\s*hidden|font-size\s*:\s*0(?:px|pt|em)?(?:\s*;|$)|opacity\s*:\s*0(?:\s*;|$)/.test(st)) {
            if (!el.querySelector('img, image, svg')) {
              el.remove();
              return;
            }
          }
          // Se o elemento só tiver background-image (muito usado em capas EPUB), converter para <img> visível
          const bgMatch = st.match(/background-image\s*:\s*url\(["']?([^"')]+)["']?\)/i);
          if (bgMatch && !el.querySelector('img, image')) {
            const bgImg = doc.createElement('img');
            bgImg.setAttribute('src', bgMatch[1]);
            el.prepend(bgImg);
          }
        });

        // Remover avisos de OCR automático (Archive.org / Abbyy FineReader)
        let hadOcrDisclaimer = false;
        doc.querySelectorAll('p, div, span, h1, h2, h3, h4, small').forEach(el => {
          if (el.querySelector('img, image, svg')) return;
          const t = (el.textContent || '').replace(/\s+/g, ' ').trim();
          if (/The text on this page is estimated to be only/i.test(t)) {
            hadOcrDisclaimer = true;
            el.remove();
          }
        });

        if (hadOcrDisclaimer && doc.querySelector('img, image, svg')) {
          doc.querySelectorAll('p, div, span, h1, h2, h3, h4').forEach(el => {
            if (!el.querySelector('img, image, svg') && el.tagName.toLowerCase() !== 'body') {
              el.remove();
            }
          });
        }

        if (!state.originalFormat) {
          doc.querySelectorAll('[style], [bgcolor], [color], [height]').forEach(el => {
            el.removeAttribute('style');
            el.removeAttribute('bgcolor');
            el.removeAttribute('color');
            if (el.tagName.toLowerCase() !== 'img') el.removeAttribute('height');
          });
        } else {
          // Em Formatação Original, preservar inline style mas evitar fundo branco fixo no modo escuro
          if (state.theme === 'dark') {
            doc.querySelectorAll('[style]').forEach(el => {
              let st = el.getAttribute('style') || '';
              st = st.replace(/background(?:-color)?\s*:\s*[^;]+;?/gi, '');
              el.setAttribute('style', st);
            });
          }
        }

        // Resolver imagens e capas SVG
        doc.querySelectorAll('img, image').forEach(img => {
          const rawSrc = img.getAttribute('src') || img.getAttribute('href') || img.getAttribute('xlink:href');
          if (!rawSrc) return;
          const resolved = resolveRelPath(secPath, rawSrc);
          let decResolved = resolved;
          try { decResolved = decodeURIComponent(resolved); } catch {}
          const baseName = decResolved.split('/').pop().toLowerCase();
          const blobUrl = imageBlobs.get(resolved)
            || imageBlobs.get(resolved.toLowerCase())
            || imageBlobs.get(decResolved)
            || imageBlobs.get(decResolved.toLowerCase())
            || imageBlobs.get(baseName);
          if (blobUrl) {
            if (img.tagName.toLowerCase() === 'img') {
              img.setAttribute('src', blobUrl);
            } else {
              const newImg = doc.createElement('img');
              newImg.setAttribute('src', blobUrl);
              const parentSvg = img.closest('svg');
              if (parentSvg) parentSvg.replaceWith(newImg);
              else img.replaceWith(newImg);
            }
          }
        });

        // Reescrever links internos <a href="...">
        doc.querySelectorAll('a[href]').forEach(a => {
          const href = a.getAttribute('href') || '';
          if (/^(https?:|mailto:)/i.test(href)) {
            a.setAttribute('target', '_blank');
            a.setAttribute('rel', 'noopener');
          } else {
            const [filePart, hashPart] = href.split('#');
            const targetPath = filePart ? resolveRelPath(secPath, filePart) : secPath;
            a.setAttribute('data-internal-path', targetPath);
            if (hashPart) a.setAttribute('data-internal-anchor', hashPart);
            a.removeAttribute('href');
          }
        });

        let bodyHtml = doc.body ? doc.body.innerHTML.trim() : '';
        if (doc.body && !doc.body.textContent.trim() && /<img\b/i.test(bodyHtml) && !/class=["'][^"']*manga-page-wrap/i.test(bodyHtml)) {
          bodyHtml = `<div class="manga-page-wrap">${bodyHtml}</div>`;
        }
        return (extraCssBlocks ? `<style>${extraCssBlocks}</style>` : '') + bodyHtml;
      }

      for (let i = 0; i < spineItems.length; i++) {
        const item = spineItems[i];
        const secPath = resolveRelPath(opfPath, item.href);
        const rawHtml = await zip.readText(secPath);
        if (!rawHtml) continue;

        const cleanBody = normalizeXhtmlForHtml(rawHtml);
        const plainText = cleanBody
          .replace(/<style[\s\S]*?<\/style>|<script[\s\S]*?<\/script>/gi, ' ')
          .replace(/<[^>]+>/g, ' ')
          .replace(/&nbsp;/gi, ' ')
          .replace(/\s+/g, ' ')
          .trim();

        const hasImage = /<(img|image|svg|object)\b|background-image\s*:\s*url\(/i.test(cleanBody);
        if (!plainText && !hasImage) continue;

        const secIdx = sections.length;
        registerPathMapping(secPath, secIdx);

        let decSecPath = secPath;
        try { decSecPath = decodeURIComponent(secPath); } catch {}
        const tocMatch = rawTocEntries.find(t => {
          let decT = t.path;
          try { decT = decodeURIComponent(t.path); } catch {}
          return decT.toLowerCase() === decSecPath.toLowerCase()
            || decT.split('/').pop().toLowerCase() === decSecPath.split('/').pop().toLowerCase();
        });

        const hMatch = cleanBody.match(/<h[1-4]\b[^>]*>([\s\S]{1,200}?)<\/h[1-4]>/i);
        const headingTxt = hMatch ? hMatch[1].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim() : '';

        const secTitle = (tocMatch && tocMatch.label)
          || headingTxt
          || (hasImage && !plainText ? 'Capa / Ilustração' : `Capítulo ${secIdx + 1}`);

        sections.push({
          title: secTitle.length > 80 ? secTitle.slice(0, 77) + '…' : secTitle,
          html: null,
          rawSlice: rawHtml,
          buildHtml: (raw) => buildCleanEpubSectionHtml(raw, secPath),
          text: plainText,
          path: secPath
        });
      }

      if (!sections.length) throw new Error('Nenhum capítulo legível encontrado no EPUB.');

      // Garantir que todo EPUB comece com a Capa / Primeira Página caso o OPF declare capa mas ela não esteja na primeira posição do Spine
      let coverImgUrl = null;
      const coverMetaNode = allOpfNodes.find(n => getLocal(n) === 'meta' && (n.getAttribute('name') || '').toLowerCase() === 'cover');
      const coverId = coverMetaNode ? coverMetaNode.getAttribute('content') : null;
      const coverManifestItem = (coverId && (manifest.get(coverId) || manifestLower.get(coverId.toLowerCase())))
        || Array.from(manifest.values()).find(it => (it.props || '').toLowerCase().includes('cover-image'));
      if (coverManifestItem) {
        const cPath = resolveRelPath(opfPath, coverManifestItem.href);
        coverImgUrl = imageBlobs.get(cPath) || imageBlobs.get(cPath.toLowerCase()) || imageBlobs.get(cPath.split('/').pop().toLowerCase()) || null;
      }
      const firstHasImg = sections[0] && /<(img|image|svg)\b|background-image\s*:\s*url\(/i.test(sections[0].rawSlice || sections[0].html || '');
      if (coverImgUrl && !firstHasImg) {
        sections.unshift({
          title: 'Capa',
          html: `<div class="manga-page-wrap"><img src="${coverImgUrl}" alt="Capa" /></div>`,
          rawSlice: '',
          text: '',
          path: '__cover__'
        });
        for (const [k, v] of state.pathToSection.entries()) {
          state.pathToSection.set(k, v + 1);
        }
      }

      // Construir lista final de Sumário
      const toc = [];
      for (const entry of rawTocEntries) {
        let decPath = entry.path;
        try { decPath = decodeURIComponent(entry.path); } catch {}
        const idx = state.pathToSection.get(entry.path)
          ?? state.pathToSection.get(entry.path.toLowerCase())
          ?? state.pathToSection.get(decPath.toLowerCase())
          ?? state.pathToSection.get(decPath.split('/').pop().toLowerCase());
        if (idx !== undefined && !toc.some(t => t.sectionIndex === idx && t.label === entry.label)) {
          toc.push({
            label: entry.label,
            sectionIndex: idx,
            anchor: entry.anchor,
            depth: entry.depth
          });
        }
      }
      if (sections.length > 0 && !toc.some(t => t.sectionIndex === 0)) {
        const firstLbl = (sections[0].title && sections[0].title !== 'Capítulo 1') ? sections[0].title : 'Capa (1ª Página)';
        toc.unshift({ label: firstLbl, sectionIndex: 0, anchor: '', depth: 0 });
      }
      if (!toc.length) {
        sections.forEach((s, idx) => toc.push({ label: s.title, sectionIndex: idx, anchor: '', depth: 0 }));
      }

      // Identificar URL da capa para a Estante
      let resolvedCoverUrl = coverImgUrl;
      if (!resolvedCoverUrl && sections[0]) {
        const mCover = (sections[0].html || sections[0].rawSlice || '').match(/<img\b[^>]*src=["']([^"']+)["']/i);
        if (mCover) {
          const rawSrc = mCover[1];
          if (/^(?:blob:|data:)/i.test(rawSrc)) resolvedCoverUrl = rawSrc;
          else if (sections[0].path) {
            const rp = resolveRelPath(sections[0].path, rawSrc);
            resolvedCoverUrl = imageBlobs.get(rp) || imageBlobs.get(rp.toLowerCase()) || imageBlobs.get(rp.split('/').pop().toLowerCase()) || null;
          }
        }
      }
      return { title, author, format: 'EPUB', sections, toc, coverUrl: resolvedCoverUrl || null, metadata: opfMeta };
    }

    /* =====================================================================
     * 4. PARSER MOBI / PALMDOC CORRIGIDO (OFICIAL KINDLEUNPACK + FILEPOS)
     * ===================================================================== */
    function decompressPalmDOC(input) {
      const out = [];
      let i = 0;
      const len = input.length;
      while (i < len) {
        const b = input[i++];
        if (b === 0x00) {
          out.push(0x00);
        } else if (b >= 0x01 && b <= 0x08) {
          for (let j = 0; j < b && i < len; j++) out.push(input[i++]);
        } else if (b >= 0x09 && b <= 0x7f) {
          out.push(b);
        } else if (b >= 0x80 && b <= 0xbf) {
          if (i >= len) break;
          const b2 = input[i++];
          const pair = ((b << 8) | b2) & 0x3fff;
          const dist = pair >> 3;
          const copyLen = (pair & 0x07) + 3;
          if (dist < 1) continue;
          for (let j = 0; j < copyLen; j++) {
            const pos = out.length - dist;
            out.push(pos >= 0 ? out[pos] : 32);
          }
        } else {
          out.push(0x20, b ^ 0x80);
        }
      }
      return new Uint8Array(out);
    }

    // Cálculo exato do tamanho de trailing data entry (forward big-endian varint)
    function getSizeOfTrailingDataEntry(data, end) {
      let num = 0;
      const start = Math.max(0, end - 4);
      for (let i = start; i < end; i++) {
        const b = data[i];
        if (b & 0x80) num = 0;
        num = (num << 7) | (b & 0x7f);
      }
      return num;
    }

    function trimMobiTrailingBytes(recordBytes, extraFlags) {
      if (!extraFlags) return recordBytes;
      let end = recordBytes.length;
      for (let flags = extraFlags >> 1; flags > 0; flags >>= 1) {
        if (flags & 1) {
          const size = getSizeOfTrailingDataEntry(recordBytes, end);
          if (size > 0 && size <= end) end -= size;
        }
      }
      if ((extraFlags & 1) && end > 0) {
        const overlap = (recordBytes[end - 1] & 0x03) + 1;
        if (overlap <= end) end -= overlap;
      }
      return recordBytes.subarray(0, end);
    }

    async function parseMobi(arrayBuffer, fileName) {
      const view = new DataView(arrayBuffer);
      const bytes = new Uint8Array(arrayBuffer);

      if (bytes.byteLength < 78) throw new Error('Arquivo MOBI inválido ou corrompido.');
      const pdbName = new TextDecoder('latin1').decode(bytes.subarray(0, 32)).replace(/\0.*$/, '').trim();
      const numRecords = view.getUint16(76, false);
      if (numRecords < 2) throw new Error('Arquivo MOBI sem registros de texto.');

      const offsets = [];
      for (let i = 0; i < numRecords; i++) {
        offsets.push(view.getUint32(78 + i * 8, false));
      }
      offsets.push(bytes.byteLength);

      function getRecord(idx) {
        const start = offsets[idx];
        const end = offsets[idx + 1];
        if (start >= bytes.byteLength || end <= start) return new Uint8Array(0);
        return bytes.subarray(start, Math.min(bytes.byteLength, end));
      }

      function parseHeaderAt(recIndex) {
        const rBytes = getRecord(recIndex);
        if (rBytes.byteLength < 16) return null;
        const rv = new DataView(rBytes.buffer, rBytes.byteOffset, rBytes.byteLength);
        const comp = rv.getUint16(0, false);
        const uncompTextLen = rv.getUint32(4, false);
        const txtRecCount = rv.getUint16(8, false);
        const encType = rv.getUint16(12, false);

        let enc = 'windows-1252';
        let bkTitle = pdbName || fileName.replace(/\.(mobi|azw3?|prc)$/i, '');
        let bkAuthor = 'Autor Desconhecido';
        let firstImgIdx = -1;
        let firstNonBkIdx = txtRecCount + 1;
        let extraFlags = 0;
        let fmtVer = 6;
        let coverOffset = -1;

        if (rBytes.byteLength >= 36) {
          const magic = new TextDecoder('ascii').decode(rBytes.subarray(16, 20));
          if (magic === 'MOBI') {
            const mobiHeaderLen = rv.getUint32(20, false);
            const codepage = rv.getUint32(28, false);
            if (codepage === 65001) enc = 'utf-8';
            else enc = 'windows-1252';

            if (rBytes.byteLength >= 108) {
              firstNonBkIdx = rv.getUint32(80, false) || (txtRecCount + 1);
              const fnOffset = rv.getUint32(84, false);
              const fnLen = rv.getUint32(88, false);
              fmtVer = rv.getUint32(104, false);
              if (fnOffset && fnLen && fnOffset + fnLen <= rBytes.byteLength) {
                const decodedTitle = new TextDecoder(enc).decode(rBytes.subarray(fnOffset, fnOffset + fnLen)).trim();
                if (decodedTitle) bkTitle = decodedTitle;
              }
              if (rBytes.byteLength >= 112) {
                firstImgIdx = rv.getUint32(108, false);
              }
              if (mobiHeaderLen >= 228 && rBytes.byteLength >= 244 && fmtVer >= 5) {
                const rawFlags = rv.getUint16(242, false);
                if (rawFlags !== 0xffff) extraFlags = rawFlags;
              }
            }

            // EXTH Header
            const exthFlags = rBytes.byteLength >= 132 ? rv.getUint32(128, false) : 0;
            const exthStart = 16 + mobiHeaderLen;
            if ((exthFlags & 0x40) && rBytes.byteLength >= exthStart + 12) {
              const exthMagic = new TextDecoder('ascii').decode(rBytes.subarray(exthStart, exthStart + 4));
              if (exthMagic === 'EXTH') {
                const recCount = rv.getUint32(exthStart + 8, false);
                let ptr = exthStart + 12;
                const authors = [];
                var mobiExtraMeta = { publisher: '', description: '', isbn: '', year: '', language: '' };
                for (let k = 0; k < recCount && ptr + 8 <= rBytes.byteLength; k++) {
                  const rType = rv.getUint32(ptr, false);
                  const rLen = rv.getUint32(ptr + 4, false);
                  if (rLen < 8 || ptr + rLen > rBytes.byteLength) break;
                  const val = new TextDecoder(enc).decode(rBytes.subarray(ptr + 8, ptr + rLen)).replace(/\0/g, '').trim();
                  if (rType === 100 && val) authors.push(val);
                  else if (rType === 101 && val) mobiExtraMeta.publisher = val;
                  else if (rType === 103 && val) mobiExtraMeta.description = val.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
                  else if (rType === 104 && val) mobiExtraMeta.isbn = val;
                  else if (rType === 106 && val) mobiExtraMeta.year = (val.match(/\d{4}/) || [''])[0];
                  else if (rType === 524 && val) mobiExtraMeta.language = val;
                  else if (rType === 503 && val) bkTitle = val;
                  else if (rType === 201 && rLen >= 12) coverOffset = rv.getUint32(ptr + 8, false);
                  ptr += rLen;
                }
                if (authors.length) bkAuthor = authors.join(', ');
              }
            }
          }
        }
        return {
          baseRec: recIndex,
          compression: comp,
          uncompTextLen,
          textRecordCount: txtRecCount,
          encryptionType: encType,
          encoding: enc,
          title: bkTitle,
          author: bkAuthor,
          firstImageIndex: firstImgIdx,
          firstNonBookIndex: firstNonBkIdx,
          extraDataFlags: extraFlags,
          formatVersion: fmtVer,
          coverOffset,
          extraMeta: typeof mobiExtraMeta !== 'undefined' ? mobiExtraMeta : {}
        };
      }

      let hdr = parseHeaderAt(0);
      if (!hdr) throw new Error('Cabeçalho MOBI/AZW3 inválido.');

      // Se o Record 0 tiver apenas um stub vazio e existir um registro BOUNDARY (Combo KF8/AZW3), usar o cabeçalho KF8
      if (hdr.textRecordCount <= 2) {
        const asciiDec = new TextDecoder('ascii');
        for (let r = 1; r < numRecords - 1; r++) {
          const b = getRecord(r);
          if (b.byteLength === 8 && asciiDec.decode(b) === 'BOUNDARY') {
            const kf8Hdr = parseHeaderAt(r + 1);
            if (kf8Hdr && kf8Hdr.textRecordCount > hdr.textRecordCount) {
              hdr = kf8Hdr;
              break;
            }
          }
        }
      }

      if (hdr.encryptionType !== 0) {
        throw new Error('Este arquivo possui proteção DRM e não pode ser aberto.');
      }
      if (hdr.compression !== 1 && hdr.compression !== 2) {
        throw new Error('Este arquivo usa compressão proprietária HUFF/CDIC. Converta para EPUB ou MOBI padrão no Calibre.');
      }

      const {
        baseRec,
        compression,
        textRecordCount,
        encoding,
        title,
        author,
        firstImageIndex,
        extraDataFlags
      } = hdr;

      // Descompactar todos os registros de texto (baseRec + 1 .. baseRec + textRecordCount)
      const maxTextRec = Math.min(baseRec + textRecordCount, numRecords - 1);
      const chunks = [];
      let totalBytes = 0;
      for (let r = baseRec + 1; r <= maxTextRec; r++) {
        let rec = getRecord(r);
        rec = trimMobiTrailingBytes(rec, extraDataFlags);
        const decomp = compression === 2 ? decompressPalmDOC(rec) : rec;
        chunks.push(decomp);
        totalBytes += decomp.byteLength;
      }

      let rawDecompressed = new Uint8Array(totalBytes);
      let cursor = 0;
      for (const c of chunks) {
        rawDecompressed.set(c, cursor);
        cursor += c.byteLength;
      }

      // Em arquivos .azw3 (KF8), verificar se há tabela FDST para isolar exatamente o Flow 0 (HTML completo do livro)
      // e descartar os Flows secundários de CSS/SVG brutos concatenados ao final
      for (let r = maxTextRec + 1; r < numRecords; r++) {
        const b = getRecord(r);
        if (b.byteLength >= 20 && b[0] === 0x46 && b[1] === 0x44 && b[2] === 0x53 && b[3] === 0x54) { // "FDST"
          const fv = new DataView(b.buffer, b.byteOffset, b.byteLength);
          const secOff = fv.getUint32(4, false);
          const numFlows = fv.getUint32(8, false);
          if (numFlows >= 1 && secOff + 8 <= b.byteLength) {
            const flow0Start = fv.getUint32(secOff, false);
            const flow0End = fv.getUint32(secOff + 4, false);
            if (flow0Start === 0 && flow0End > 0 && flow0End <= rawDecompressed.byteLength) {
              rawDecompressed = rawDecompressed.subarray(0, flow0End);
            }
          }
          break;
        }
      }

      // Extrair TODAS as imagens embutidas nos registros do arquivo (suporta MOBI7 e Combo KF8/AZW3)
      const mobiImages = new Map();
      let seqImg = 1;
      for (let r = 1; r < numRecords; r++) {
        if (r > baseRec && r <= maxTextRec) continue;
        const b = getRecord(r);
        if (b.byteLength < 12) continue;
        let mime = null;
        if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) mime = 'image/jpeg';
        else if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) mime = 'image/png';
        else if (b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46) mime = 'image/gif';
        else if (b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45) mime = 'image/webp';
        if (mime) {
          const url = URL.createObjectURL(new Blob([b], { type: mime }));
          state.objectUrls.push(url);
          if (firstImageIndex > 0 && r >= firstImageIndex) {
            mobiImages.set(r - firstImageIndex + 1, url);
          }
          if (firstImageIndex > 0 && r >= baseRec + firstImageIndex) {
            mobiImages.set(r - (baseRec + firstImageIndex) + 1, url);
          }
          if (!mobiImages.has(seqImg)) {
            mobiImages.set(seqImg, url);
          }
          seqImg++;
        }
      }

      const dec = new TextDecoder(encoding, { fatal: false });
      const fullHtml = dec.decode(rawDecompressed).replace(/\0/g, '');

      // Helper para converter TODOS os offsets filepos (que são em BYTES no MOBI) para índices exatos de string UTF-16 no fullHtml!
      function mapMobiBytesToCharIndices(bytes, enc, byteOffsets) {
        const uniqueBytes = Array.from(new Set(byteOffsets.filter(b => Number.isFinite(b) && b >= 0 && b <= bytes.length))).sort((a, b) => a - b);
        const map = new Map();
        if (!uniqueBytes.length) return map;
        if (enc !== 'utf-8') {
          uniqueBytes.forEach(b => map.set(b, Math.min(fullHtml.length, b)));
          return map;
        }
        const streamDec = new TextDecoder('utf-8', { fatal: false });
        let prevB = 0;
        let charAcc = 0;
        for (const rawB of uniqueBytes) {
          let safeB = rawB;
          while (safeB > prevB && safeB < bytes.length && (bytes[safeB] & 0xC0) === 0x80) {
            safeB--;
          }
          if (safeB > prevB) {
            charAcc += streamDec.decode(bytes.subarray(prevB, safeB), { stream: true }).replace(/\0/g, '').length;
            prevB = safeB;
          }
          map.set(rawB, Math.min(fullHtml.length, charAcc));
        }
        return map;
      }

      // Garante que NENHUM corte de seção caia dentro de uma tag (<img ...>, <p align="left">) ou no meio de uma palavra!
      function snapSplitToSafeHtmlBoundary(htmlStr, pos) {
        const len = htmlStr.length;
        if (pos <= 0) return 0;
        if (pos >= len) return len;

        // 1. Se pos caiu dentro de <...>, recuar exatamente para o '<' de abertura da tag
        const lastLt = htmlStr.lastIndexOf('<', pos);
        const lastGt = htmlStr.lastIndexOf('>', pos - 1);
        if (lastLt > lastGt) {
          pos = lastLt;
        }

        // 2. Se pos não está imediatamente antes de uma tag (<), recuar até a tag de bloco anterior ou avançar até o próximo '<'
        const afterSnippet = htmlStr.slice(pos, Math.min(len, pos + 32));
        if (!/^\s*</.test(afterSnippet)) {
          const backWinStart = Math.max(0, pos - 600);
          const backChunk = htmlStr.slice(backWinStart, pos);
          const openBlocks = Array.from(backChunk.matchAll(/<(?:p|div|h[1-6]|blockquote|center|li|section|mbp:pagebreak)\b/gi));
          if (openBlocks.length) {
            const candidate = backWinStart + openBlocks[openBlocks.length - 1].index;
            if (candidate > 0) return candidate;
          }
          const nextLt = htmlStr.indexOf('<', pos);
          if (nextLt !== -1 && nextLt - pos < 1200) {
            return nextLt;
          }
        }
        return pos;
      }

      // Coletar todos os filepos existentes para mapear Byte -> Char com 100% de precisão em UTF-8
      const allBytePositions = [];
      const anyFileposRx = /\bfilepos=["']?0*(\d+)["']?/gi;
      let m;
      while ((m = anyFileposRx.exec(fullHtml)) !== null) {
        if (m.index === anyFileposRx.lastIndex) anyFileposRx.lastIndex++;
        const bPos = parseInt(m[1], 10);
        if (!isNaN(bPos)) allBytePositions.push(bPos);
      }
      const byteToCharMap = mapMobiBytesToCharIndices(rawDecompressed, encoding, allBytePositions);
      const getCharPosFromByte = (bPos) => (byteToCharMap.has(bPos) ? byteToCharMap.get(bPos) : Math.min(fullHtml.length, bPos));

      // Coletar entradas reais de Sumário (ignorando marcadores de notas de rodapé como "1.", "2.", "[3]", "**", "Voltar")
      const fileposToc = [];
      const linkFileposRegex = /<a\b[^>]{1,240}?\bfilepos=["']?0*(\d+)["']?[^>]{0,240}?>([\s\S]{1,300}?)<\/a>/gi;
      const isFootnoteLabel = (lbl, matchOffset, rawInner) => {
        if (!lbl || lbl.length < 2 || lbl.length > 140) return true;
        if (/^\s*[\[\(\{]?(\d{1,4}[\.\):]?|\*{1,6}|†+|‡+|§+|notas?\s*\d*|voltar|retorno|back|fn\s*\d*)[\]\)\}]?\s*$/i.test(lbl)) return true;
        if (/<sup\b/i.test(rawInner)) return true;
        const ctxBefore = fullHtml.slice(Math.max(0, matchOffset - 24), matchOffset);
        if (/<sup\b[^>]*>$/i.test(ctxBefore)) return true;
        return false;
      };

      while ((m = linkFileposRegex.exec(fullHtml)) !== null) {
        if (m.index === linkFileposRegex.lastIndex) linkFileposRegex.lastIndex++;
        const rawBytePos = parseInt(m[1], 10);
        const label = m[2].replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
        if (isNaN(rawBytePos) || isFootnoteLabel(label, m.index, m[2])) continue;
        const charPos = snapSplitToSafeHtmlBoundary(fullHtml, getCharPosFromByte(rawBytePos));
        if (!fileposToc.some(t => Math.abs(t.charPos - charPos) < 16)) {
          fileposToc.push({ label, bytePos: rawBytePos, charPos });
        }
      }

      // Dividir o livro nos marcadores reais de capítulo e NUNCA cortar tags ou palavras ao meio
      const splitOffsets = new Set([0]);
      const addSafeSplit = (rawCharPos) => {
        const safe = snapSplitToSafeHtmlBoundary(fullHtml, rawCharPos);
        if (safe > 16 && safe < fullHtml.length - 8) {
          splitOffsets.add(safe);
        }
      };

      const breakRegex = /<mbp:pagebreak\s*\/?>|<\/html>\s*(?:<\?xml[^>]*>\s*)?(?:<!doctype[^>]*>\s*)?<html\b|<(?:div|p|br)\b[^>]{0,160}?\b(?:class=["'][^"']*pagebreak[^"']*["']|id=["']calibre_pb_\d+["'])[^>]{0,160}?>|<h[12]\b/gi;
      while ((m = breakRegex.exec(fullHtml)) !== null) {
        if (m.index === breakRegex.lastIndex) breakRegex.lastIndex++;
        const matched = m[0];
        let splitPos = m.index;
        if (/^<\/html>/i.test(matched)) {
          const idxHtml = matched.toLowerCase().lastIndexOf('<html');
          if (idxHtml !== -1) splitPos = m.index + idxHtml;
        }
        addSafeSplit(splitPos);
      }

      for (const item of fileposToc) {
        if (item.charPos > 16 && item.charPos < fullHtml.length - 8) {
          let nearExisting = false;
          for (const existing of splitOffsets) {
            if (Math.abs(existing - item.charPos) <= 64) {
              nearExisting = true;
              break;
            }
          }
          if (!nearExisting) addSafeSplit(item.charPos);
        }
      }

      const sortedSplits = Array.from(splitOffsets).sort((a, b) => a - b);

      const finalRanges = [];
      const MAX_CHUNK = sortedSplits.length >= 4 ? 350000 : 90000;
      for (let i = 0; i < sortedSplits.length; i++) {
        let start = sortedSplits[i];
        const limit = (i + 1 < sortedSplits.length) ? sortedSplits[i + 1] : fullHtml.length;
        while (limit - start > MAX_CHUNK) {
          let cut = fullHtml.indexOf('<p', start + Math.floor(MAX_CHUNK * 0.8));
          if (cut === -1 || cut >= limit) cut = fullHtml.indexOf('<div', start + Math.floor(MAX_CHUNK * 0.8));
          if (cut === -1 || cut >= limit) cut = fullHtml.indexOf('<br', start + Math.floor(MAX_CHUNK * 0.8));
          if (cut === -1 || cut >= limit || cut <= start) {
            cut = snapSplitToSafeHtmlBoundary(fullHtml, start + MAX_CHUNK);
            if (cut <= start || cut >= limit) cut = fullHtml.indexOf('<', start + 250);
          } else {
            cut = snapSplitToSafeHtmlBoundary(fullHtml, cut);
          }
          if (cut === -1 || cut >= limit || cut <= start) break;
          finalRanges.push([start, cut]);
          start = cut;
        }
        if (limit > start) finalRanges.push([start, limit]);
      }

      const domParser = new DOMParser();
      const sections = [];
      state.idToSection.clear();

      function resolveMobiImageAttr(rawAttr) {
        if (!rawAttr) return null;
        const embedMatch = rawAttr.match(/kindle:embed:([0-9A-Za-z]+)/i);
        if (embedMatch) {
          const code = embedMatch[1];
          const num10 = parseInt(code, 10);
          const num32 = parseInt(code, 32);
          if (!isNaN(num10) && mobiImages.has(num10)) return mobiImages.get(num10);
          if (!isNaN(num32) && mobiImages.has(num32)) return mobiImages.get(num32);
        }
        const digits = rawAttr.replace(/\D/g, '');
        if (digits) {
          const num = parseInt(digits, 10);
          if (!isNaN(num) && mobiImages.has(num)) return mobiImages.get(num);
        }
        return null;
      }

      // Sanitizador sob demanda preservando alinhamentos editoriais (center/right/noindent) e imagens MOBI
      function buildCleanMobiHtml(rawSlice) {
        const safeSlice = normalizeXhtmlForHtml(rawSlice);
        const doc = domParser.parseFromString(safeSlice, 'text/html');
        doc.querySelectorAll('script, head, meta, link, title, guide').forEach(s => s.remove());
        if (!state.originalFormat) doc.querySelectorAll('style').forEach(s => s.remove());
        doc.querySelectorAll('center').forEach(c => c.classList.add('book-center'));
        doc.querySelectorAll('[align]').forEach(el => {
          const al = (el.getAttribute('align') || '').toLowerCase().trim();
          if (al === 'center') el.classList.add('book-center');
          else if (al === 'right') el.classList.add('book-right');
        });
        doc.querySelectorAll('p[width]').forEach(p => {
          const w = (p.getAttribute('width') || '').trim();
          if (w === '0' || w === '0px' || w === '0pt' || w === '0em' || w.startsWith('-')) {
            p.classList.add('book-noindent');
          }
        });
        if (!state.originalFormat) {
          doc.querySelectorAll('[style], [bgcolor], [color], [height]').forEach(el => {
            el.removeAttribute('style');
            el.removeAttribute('bgcolor');
            el.removeAttribute('color');
            if (el.tagName.toLowerCase() !== 'img') el.removeAttribute('height');
          });
        }
        doc.querySelectorAll('img, image').forEach(img => {
          const recAttr = img.getAttribute('recindex')
            || img.getAttribute('data-recindex')
            || img.getAttribute('src')
            || img.getAttribute('href')
            || img.getAttribute('xlink:href')
            || '';
          const blobUrl = resolveMobiImageAttr(recAttr);
          if (blobUrl) {
            if (img.tagName.toLowerCase() === 'img') {
              img.setAttribute('src', blobUrl);
            } else {
              const newImg = doc.createElement('img');
              newImg.setAttribute('src', blobUrl);
              const parentSvg = img.closest('svg');
              if (parentSvg) parentSvg.replaceWith(newImg);
              else img.replaceWith(newImg);
            }
          } else if (img.tagName.toLowerCase() === 'img' && !/^blob:|^data:/i.test(img.getAttribute('src') || '')) {
            img.remove();
          }
        });
        doc.querySelectorAll('a').forEach(a => {
          const fp = a.getAttribute('filepos');
          const href = a.getAttribute('href') || '';
          if (fp) {
            const rawB = parseInt(fp, 10);
            const targetChar = getCharPosFromByte(rawB);
            a.setAttribute('data-mobi-filepos', String(targetChar));
            a.removeAttribute('href');
          } else if (href.startsWith('#')) {
            a.setAttribute('data-internal-anchor', href.slice(1));
            a.removeAttribute('href');
          } else if (href.startsWith('kindle:')) {
            a.removeAttribute('href');
          }
        });
        return doc.body ? doc.body.innerHTML.trim() : '';
      }

      for (let i = 0; i < finalRanges.length; i++) {
        const [charStart, charEnd] = finalRanges[i];
        const sliceHtml = fullHtml.slice(charStart, charEnd);
        const safeSlice = normalizeXhtmlForHtml(sliceHtml);
        const plainText = safeSlice
          .replace(/<style[\s\S]*?<\/style>|<script[\s\S]*?<\/script>/gi, ' ')
          .replace(/<[^>]+>/g, ' ')
          .replace(/&nbsp;/gi, ' ')
          .replace(/\s+/g, ' ')
          .trim();

        const hasImgTag = /<(img|image)\b/i.test(safeSlice);
        if (!plainText && !hasImgTag) continue;

        // Se a seção não tem texto (ex: página de capa com imagem), validar se a imagem realmente existe
        let prebuiltHtml = null;
        if (!plainText && hasImgTag) {
          prebuiltHtml = buildCleanMobiHtml(sliceHtml);
          if (!/<img\b/i.test(prebuiltHtml)) continue;
        }

        const secIdx = sections.length;

        const matchingToc = fileposToc.find(t => Math.abs(t.charPos - charStart) <= 128);
        let headingMatch = safeSlice.match(/<h[1-4]\b[^>]*>([\s\S]{1,200}?)<\/h[1-4]>/i);
        if (!headingMatch) headingMatch = safeSlice.match(/<(?:p|div)\b[^>]*align=["']center["'][^>]*>([\s\S]{1,140}?)<\/(?:p|div)>/i);
        if (!headingMatch) headingMatch = safeSlice.match(/<blockquote\b[^>]*>([\s\S]{1,160}?)<\/blockquote>/i);
        const headingTxt = headingMatch
          ? headingMatch[1].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
          : '';

        let secTitle = (matchingToc && matchingToc.label) || headingTxt || '';
        if (!secTitle || secTitle.length < 2) {
          secTitle = !plainText ? 'Capa / Ilustração' : `Seção ${secIdx + 1}`;
        } else if (secTitle.length > 75) {
          secTitle = secTitle.slice(0, 72) + '…';
        }

        sections.push({
          title: secTitle,
          html: prebuiltHtml,
          rawSlice: sliceHtml,
          buildHtml: buildCleanMobiHtml,
          text: plainText,
          fileposStart: charStart,
          fileposEnd: charEnd
        });
      }

      function findSectionForCharPos(cPos) {
        let idx = sections.findIndex(s => Math.abs(s.fileposStart - cPos) <= 128);
        if (idx === -1) {
          idx = sections.findIndex(s => cPos >= s.fileposStart && cPos < s.fileposEnd);
        }
        return idx;
      }

      const toc = [];
      if (fileposToc.length > 0) {
        for (const item of fileposToc) {
          const targetIdx = findSectionForCharPos(item.charPos);
          if (targetIdx !== -1 && !toc.some(t => t.sectionIndex === targetIdx && t.label === item.label)) {
            toc.push({
              label: item.label,
              sectionIndex: targetIdx,
              filepos: item.charPos,
              depth: 0
            });
          }
        }
        // Ordenar o Sumário na sequência real de leitura e garantir a 1ª página no topo
        toc.sort((a, b) => a.sectionIndex - b.sectionIndex);
        if (sections.length > 0 && !toc.some(t => t.sectionIndex === 0)) {
          const firstLbl = sections[0].title || 'Capa / Início';
          toc.unshift({ label: firstLbl, sectionIndex: 0, filepos: 0, depth: 0 });
        }
      }
      if (toc.length === 0) {
        sections.forEach((s, idx) => toc.push({ label: s.title, sectionIndex: idx, depth: 0 }));
      }

      const fmtLabel = fileName.toLowerCase().endsWith('.azw3') ? 'AZW3' : 'MOBI';
      let mobiCoverUrl = null;
      if (hdr.coverOffset >= 0 && mobiImages.has(hdr.coverOffset + 1)) {
        mobiCoverUrl = mobiImages.get(hdr.coverOffset + 1);
      } else if (mobiImages.has(1)) {
        mobiCoverUrl = mobiImages.get(1);
      }
      return { title, author, format: fmtLabel, sections, toc, coverUrl: mobiCoverUrl, metadata: hdr.extraMeta || {} };
    }

    /* =====================================================================
     * 4B. PARSER DE MANGÁ / QUADRINHOS (.CBZ / .ZIP DE IMAGENS)
     * ===================================================================== */
    async function parseCbz(arrayBuffer, fileName) {
      const zip = await openZipBuffer(arrayBuffer);
      const imageEntries = [];
      for (const [name, entry] of zip.entries.entries()) {
        if (/\.(jpe?g|png|webp|gif|bmp|avif)$/i.test(name) && !name.includes('__MACOSX')) {
          imageEntries.push(entry);
        }
      }
      if (!imageEntries.length) {
        throw new Error('Nenhuma página de imagem (.jpg, .png, .webp) encontrada neste arquivo .cbz/.zip.');
      }

      // Ordenação numérica natural (ex: 1.jpg, 2.jpg, 10.jpg)
      imageEntries.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }));

      const sections = imageEntries.map((entry, idx) => {
        const pNum = idx + 1;
        return {
          title: `Página ${pNum}`,
          imageUrl: null,
          _cbzEntryName: entry.name,
          _cbzZip: zip,
          html: null,
          text: '',
          pageNumber: pNum
        };
      });

      // Decodifica somente a primeira página na abertura para exibição e capa instantâneas
      if (sections[0]) {
        await ensureCbzImage(sections[0]);
      }

      const title = fileName.replace(/\.(cbz|zip)$/i, '');
      const toc = sections.map((s, idx) => ({ label: s.title, sectionIndex: idx, depth: 0 }));
      return { title, author: 'Mangá / HQ', format: 'CBZ', sections, toc, coverUrl: sections[0] ? sections[0].imageUrl : null };
    }

    async function ensureCbzImage(sec) {
      if (!sec) return null;
      if (sec.imageUrl) return sec.imageUrl;
      if (!sec._cbzZip || !sec._cbzEntryName) return null;
      if (sec._cbzPromise) return sec._cbzPromise;
      sec._cbzPromise = (async () => {
        const bytes = await sec._cbzZip.readBytes(sec._cbzEntryName);
        if (!bytes) return null;
        const ext = sec._cbzEntryName.split('.').pop().toLowerCase();
        const mime = ext === 'png' ? 'image/png' : ext === 'webp' ? 'image/webp' : ext === 'gif' ? 'image/gif' : 'image/jpeg';
        const url = URL.createObjectURL(new Blob([bytes], { type: mime }));
        state.objectUrls.push(url);
        sec.imageUrl = url;
        sec.html = `<div class="manga-page-wrap"><img src="${url}" alt="${escapeHtml(sec.title)}" /></div>`;
        return url;
      })();
      try {
        return await sec._cbzPromise;
      } finally {
        delete sec._cbzPromise;
      }
    }

    function prefetchCbzAdjacent(centerIdx) {
      if (state.format !== 'CBZ' || !state.sections.length) return;
      [centerIdx + 1, centerIdx + 2, centerIdx - 1].forEach(idx => {
        const s = state.sections[idx];
        if (s && !s.imageUrl && s._cbzZip) {
          ensureCbzImage(s).catch(() => {});
        }
      });
    }

    /* =====================================================================
     * 5. LEITOR PDF (CANVAS HD SOB DEMANDA + OUTLINE + MODO TEXTO OPCIONAL)
     * ===================================================================== */
    async function parsePdf(arrayBuffer, fileName) {
      function createNativePdfFallback() {
        const blobUrl = URL.createObjectURL(new Blob([arrayBuffer], { type: 'application/pdf' }));
        state.objectUrls.push(blobUrl);
        state.pdfDoc = null;
        state.pdfViewMode = 'reflow';
        return {
          title: fileName.replace(/\.pdf$/i, ''),
          author: 'Documento PDF',
          format: 'PDF',
          sections: [{
            title: 'Documento PDF',
            html: `<embed src="${blobUrl}" type="application/pdf" style="width:100%; height:80vh; border:none;" />`,
            text: '',
            pageNumber: 1
          }],
          toc: [{ label: 'Documento PDF', sectionIndex: 0, depth: 0 }]
        };
      }

      if (!window.pdfjsLib) {
        return createNativePdfFallback();
      }

      function ensurePdfBlobWorkerUrl() {
        if (window.__pdfBlobWorkerUrl) return window.__pdfBlobWorkerUrl;
        if (!location.protocol.startsWith('http') || typeof Worker === 'undefined' || typeof Blob === 'undefined') return null;
        try {
          const code = "importScripts('https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js');";
          window.__pdfBlobWorkerUrl = URL.createObjectURL(new Blob([code], { type: 'application/javascript' }));
          return window.__pdfBlobWorkerUrl;
        } catch {
          return null;
        }
      }

      const blobWorkerUrl = ensurePdfBlobWorkerUrl();
      const useBgWorkerFirst = Boolean(blobWorkerUrl && arrayBuffer.byteLength >= 6 * 1024 * 1024);
      window.pdfjsLib.GlobalWorkerOptions.workerSrc = blobWorkerUrl || 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

      let pdfDoc;
      try {
        pdfDoc = await window.pdfjsLib.getDocument({
          data: new Uint8Array(useBgWorkerFirst ? arrayBuffer.slice(0) : arrayBuffer),
          disableWorker: !useBgWorkerFirst
        }).promise;
      } catch (err1) {
        try {
          pdfDoc = await window.pdfjsLib.getDocument({
            data: new Uint8Array(arrayBuffer),
            disableWorker: true
          }).promise;
        } catch (err2) {
          console.warn('Fallback para visualizador PDF nativo:', err2);
          return createNativePdfFallback();
        }
      }
      state.pdfDoc = pdfDoc;
      state.pdfViewMode = 'canvas';
      dom.btnPdfViewMode.textContent = 'PDF: Original';

      let title = fileName.replace(/\.pdf$/i, '');
      let author = 'Documento PDF';
      try {
        const meta = await pdfDoc.getMetadata();
        if (meta && meta.info) {
          if (meta.info.Title && meta.info.Title.trim()) title = meta.info.Title.trim();
          if (meta.info.Author && meta.info.Author.trim()) author = meta.info.Author.trim();
        }
      } catch {}

      // Criar entradas leves de página (lazy loading: não extrai todas as páginas de uma vez!)
      const sections = [];
      for (let p = 1; p <= pdfDoc.numPages; p++) {
        sections.push({
          title: `Página ${p}`,
          html: null,
          text: null,
          pageNumber: p
        });
      }

      // Extrair Sumário (Outline) real do PDF se existir
      const toc = [];
      try {
        const outline = await pdfDoc.getOutline();
        if (outline && outline.length) {
          async function walkOutline(items, depth) {
            for (const item of items) {
              let pageIdx = 0;
              try {
                let dest = item.dest;
                if (typeof dest === 'string') dest = await pdfDoc.getDestination(dest);
                if (Array.isArray(dest) && dest[0]) {
                  pageIdx = await pdfDoc.getPageIndex(dest[0]);
                }
              } catch {}
              const safeIdx = Math.max(0, Math.min(sections.length - 1, pageIdx));
              let lbl = (item.title || `Página ${safeIdx + 1}`).trim();
              if (/^(capa|cover)$/i.test(lbl) && safeIdx > 0) {
                lbl = `${lbl} (Pág. ${safeIdx + 1})`;
              }
              toc.push({
                label: lbl,
                sectionIndex: safeIdx,
                depth: Math.min(2, depth)
              });
              if (item.items && item.items.length) {
                await walkOutline(item.items, depth + 1);
              }
            }
          }
          await walkOutline(outline, 0);
        }
      } catch {}

      // Se o Sumário interno do PDF começar depois da Página 1 (ex: "Capa" apontando p/ Pág. 3),
      // adicionar a Capa Real (Pág. 1) e Contracapa (Pág. 2) no topo do Sumário!
      if (toc.length > 0 && toc[0].sectionIndex > 0) {
        if (toc[0].sectionIndex >= 2 && sections.length >= 2) {
          toc.unshift({ label: 'Contracapa / Guarda (Pág. 2)', sectionIndex: 1, depth: 0 });
        }
        toc.unshift({ label: 'Capa Principal (Pág. 1)', sectionIndex: 0, depth: 0 });
      } else if (!toc.length) {
        sections.forEach((s, idx) => toc.push({ label: s.title, sectionIndex: idx, depth: 0 }));
      }

      return { title, author, format: 'PDF', sections, toc };
    }

    async function renderSinglePdfPageToSlot(pageNum, canvasEl, textLayerEl, containerEl, mySeq, isTwoPageSpread) {
      if (!state.pdfDoc || !canvasEl || !containerEl) return;
      const page = await state.pdfDoc.getPage(pageNum);
      if (mySeq !== state.pdfRenderSeq) return;

      const baseVp = page.getViewport({ scale: 1 });
      const zoomFactor = state.pdfScale / 1.35; // 1.0 = 100%

      // Auto-ajuste inteligente: garante que PDFs com dimensões internas pequenas (comum em Mangás/Scans)
      // ocupem toda a altura útil da tela com nitidez HD, sem ficar pequenos nem estourar a largura
      const isMobile = window.innerWidth <= 768;
      const availH = Math.max(500, (dom.viewport.clientHeight || (window.innerHeight - 92)) - (isMobile ? 12 : 24));
      const totalAvailW = Math.max(260, (dom.viewport.clientWidth || window.innerWidth) - (isMobile ? 12 : 48));
      const slotAvailW = isTwoPageSpread ? Math.floor((totalAvailW - 16) / 2) : totalAvailW;

      const fitH = availH / Math.max(1, baseVp.height);
      const fitW = slotAvailW / Math.max(1, baseVp.width);
      let autoBaseScale = Math.min(fitH, fitW);
      if (!isMobile && !isTwoPageSpread) {
        autoBaseScale = Math.max(1.35, Math.min(fitH, fitW));
      }
      const effectiveScale = +(Math.max(0.5, autoBaseScale * zoomFactor)).toFixed(3);
      const viewport = page.getViewport({ scale: effectiveScale });

      // Supersampling mínimo de 2x (HD) para que traços de mangá, furigana e letras pequenas nunca fiquem borrados
      const renderDpr = Math.min(3, Math.max(2, window.devicePixelRatio || 1));

      // Renderizar SEMPRE em um canvas offscreen isolado para impedir que cliques rápidos
      // de Avançar/Voltar corrompam a matriz de transformação do PDF.js e deixem a página de cabeça para baixo!
      const offCanvas = document.createElement('canvas');
      offCanvas.width = Math.floor(viewport.width * renderDpr);
      offCanvas.height = Math.floor(viewport.height * renderDpr);
      const offCtx = offCanvas.getContext('2d');
      offCtx.setTransform(renderDpr, 0, 0, renderDpr, 0, 0);

      const renderTask = page.render({ canvasContext: offCtx, viewport });
      if (!state.activePdfRenderTasks) state.activePdfRenderTasks = [];
      state.activePdfRenderTasks.push(renderTask);

      try {
        await renderTask.promise;
      } catch (err) {
        if (err && err.name === 'RenderingCancelledException') return;
        throw err;
      }

      // Se o usuário já virou para outra página enquanto esta renderizava, descartar silenciosamente
      if (mySeq !== state.pdfRenderSeq) return;

      canvasEl.width = offCanvas.width;
      canvasEl.height = offCanvas.height;
      canvasEl.style.width = Math.floor(viewport.width) + 'px';
      canvasEl.style.height = Math.floor(viewport.height) + 'px';

      const ctx = canvasEl.getContext('2d');
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, canvasEl.width, canvasEl.height);
      ctx.drawImage(offCanvas, 0, 0);

      // Camada de Texto Selecionável sobre o Canvas do PDF
      if (textLayerEl) {
        textLayerEl.innerHTML = '';
        textLayerEl.style.width = Math.floor(viewport.width) + 'px';
        textLayerEl.style.height = Math.floor(viewport.height) + 'px';
        textLayerEl.style.setProperty('--scale-factor', String(effectiveScale));
        try {
          const textContent = await page.getTextContent();
          if (mySeq !== state.pdfRenderSeq) return;
          const sec = state.sections[pageNum - 1];
          if (sec && sec.text === null) {
            sec.text = textContent.items.map(it => it.str).join(' ').replace(/\s+/g, ' ').trim();
          }
          // Em modo Mangá, não sobrepor spans de ruído de OCR malfeito sobre os balões
          if (state.readingType !== 'manga') {
            if (window.pdfjsLib && window.pdfjsLib.renderTextLayer) {
              await window.pdfjsLib.renderTextLayer({
                textContentSource: textContent,
                container: textLayerEl,
                viewport,
                textDivs: []
              }).promise;
            } else {
              textContent.items.forEach(item => {
                if (!item.str) return;
                const span = document.createElement('span');
                span.textContent = item.str + ' ';
                textLayerEl.appendChild(span);
              });
            }
            textLayerEl.innerHTML = applySavedHighlightsToHtml(textLayerEl.innerHTML, pageNum - 1);
          }
        } catch (e) {
          console.warn('Aviso ao criar camada de texto do PDF:', e);
        }
      }

      // Nunca inverter cores de páginas de Mangá ou páginas de Capa/Ilustração
      const secObj = state.sections[pageNum - 1];
      const isImageOrCoverPage = pageNum === 1 || !secObj || !secObj.text || secObj.text.trim().length < 180;
      const shouldTint = Boolean(state.pdfTint && state.readingType !== 'manga' && (!isImageOrCoverPage || state.forcePdfTintOnImages));
      containerEl.classList.toggle('tint-pdf', shouldTint);
    }

    async function renderPdfPageCanvas(pageNum) {
      if (!state.pdfDoc) return;
      state.pdfRenderSeq = (state.pdfRenderSeq || 0) + 1;
      const mySeq = state.pdfRenderSeq;

      if (Array.isArray(state.activePdfRenderTasks)) {
        state.activePdfRenderTasks.forEach(t => {
          try { if (t && typeof t.cancel === 'function') t.cancel(); } catch {}
        });
      }
      state.activePdfRenderTasks = [];

      const isTwoPageSpread = state.flowMode === 'paginated-2' && window.innerWidth >= 620;
      const hasSecondPage = isTwoPageSpread && (pageNum + 1 <= state.sections.length);

      const container2 = document.getElementById('pdfContainer2');
      const canvas2 = document.getElementById('pdfCanvas2');
      const textLayer2 = document.getElementById('pdfTextLayer2');

      if (container2) {
        container2.classList.toggle('hidden', !hasSecondPage);
      }
      if (dom.pdfStage) {
        const isMangaMode = state.readingType === 'manga' || state.format === 'CBZ';
        dom.pdfStage.classList.toggle('manga-rtl-stage', Boolean(state.mangaRtl && isMangaMode));
      }

      await renderSinglePdfPageToSlot(
        pageNum,
        dom.pdfCanvas,
        document.getElementById('pdfTextLayer'),
        dom.pdfContainer,
        mySeq,
        hasSecondPage
      );

      if (hasSecondPage && container2 && canvas2 && mySeq === state.pdfRenderSeq) {
        await renderSinglePdfPageToSlot(
          pageNum + 1,
          canvas2,
          textLayer2,
          container2,
          mySeq,
          true
        );
      }
    }

    async function ensurePdfSectionText(sec) {
      // Se o usuário mudou entre Modo Livro e Modo Mangá, regenerar caso uma página de mangá tenha sido cacheada como texto de OCR
      if (sec.html !== null && !(state.readingType === 'manga' && !sec.imageUrl)) return;
      const page = await state.pdfDoc.getPage(sec.pageNumber);
      const tc = await page.getTextContent();
      const paragraphs = [];
      let line = '';
      let lastY = null;
      for (const item of tc.items) {
        const y = item.transform ? Math.round(item.transform[5]) : null;
        if (lastY !== null && y !== null && Math.abs(y - lastY) > 10) {
          if (line.trim()) paragraphs.push(line.trim());
          line = item.str;
        } else {
          line += (line && !line.endsWith(' ') && !item.str.startsWith(' ') ? ' ' : '') + item.str;
        }
        if (y !== null) lastY = y;
      }
      if (line.trim()) paragraphs.push(line.trim());
      sec.text = paragraphs.join('\n\n');

      const cleanText = sec.text.trim();
      const avgLineLen = paragraphs.length ? (cleanText.length / paragraphs.length) : 0;
      // Mangás escaneados costumam ter de 5 a 150 caracteres soltos de OCR quebrado por página (ex: "@う5 ここ ュー MS 3").
      // Só exibimos como texto puro se NÃO estiver em Modo Mangá e a página tiver texto real de livro (>= 180 caracteres e linhas normais).
      const isRealTextPage = state.readingType !== 'manga' && cleanText.length >= 180 && avgLineLen >= 22;

      if (isRealTextPage) {
        sec.html = paragraphs.map(p => `<p>${escapeHtml(p)}</p>`).join('');
      } else {
        // Página de Mangá, HQ, Capa ou Ilustração: renderizar a imagem da página em Alta Definição (HD)!
        try {
          const baseVp = page.getViewport({ scale: 1 });
          const hdScale = Math.max(2.2, Math.min(3.5, 1650 / Math.max(1, baseVp.height)));
          const vp = page.getViewport({ scale: hdScale });
          const offCanvas = document.createElement('canvas');
          offCanvas.width = Math.floor(vp.width);
          offCanvas.height = Math.floor(vp.height);
          await page.render({ canvasContext: offCanvas.getContext('2d'), viewport: vp }).promise;
          const dataUrl = offCanvas.toDataURL('image/jpeg', 0.94);
          sec.imageUrl = dataUrl;
          sec.html = `<div class="manga-page-wrap"><img src="${dataUrl}" alt="Página ${sec.pageNumber}" /></div>`;
        } catch {
          sec.html = `<p style="color:var(--text-muted);font-style:italic;">[Página ${sec.pageNumber} somente gráfica]</p>`;
        }
      }
    }

    function escapeHtml(str) {
      return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    }

    /* =====================================================================
     * 6. RENDERIZAÇÃO E NAVEGAÇÃO DE SEÇÕES, MODO LIVRO 2 PÁGINAS E MANGÁ
     * ===================================================================== */
    function getHighlightsMap() {
      try { return JSON.parse(localStorage.getItem('reader_highlights') || '{}'); }
      catch { return {}; }
    }

    function getEntityNotesMap() {
      try { return JSON.parse(localStorage.getItem('reader_entity_notes') || '{}'); }
      catch { return {}; }
    }

    function applySavedHighlightsToHtml(html, sectionIndex) {
      if (!state.bookKey) return html;
      let out = html;

      // 1. Reconhecimento automático em TODO O LIVRO de Personagens, Lugares, Conceitos e Notas (Estilo Kindle X-Ray)
      const entities = getEntityNotesMap()[state.bookKey] || [];
      if (entities.length) {
        const termEntries = [];
        entities.forEach(ent => {
          const allNames = [ent.name, ...(Array.isArray(ent.aliases) ? ent.aliases : [])]
            .map(s => (s || '').trim())
            .filter(s => s.length >= 2);
          allNames.forEach(term => {
            termEntries.push({ term, ent });
          });
        });
        // Ordenar do termo mais longo para o mais curto (ex: "Bill Denbrough" antes de "Bill")
        termEntries.sort((a, b) => b.term.length - a.term.length);

        for (const { term, ent } of termEntries) {
          const safe = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
          const cat = ent.category || 'character';
          try {
            const rx = new RegExp(`(^|[^a-zA-ZÀ-ÿ0-9_])(${safe})(?=$|[^a-zA-ZÀ-ÿ0-9_])(?![^<]*>)`, 'gi');
            out = out.replace(
              rx,
              `$1<span class="entity-note-ref entity-cat-${escapeHtml(cat)}" data-entity-id="${escapeHtml(ent.id)}" title="Clique para ver sua nota sobre ${escapeHtml(ent.name)}">$2</span>`
            );
          } catch {}
        }
      }

      // 2. Destaques de marca-texto salvos nesta seção
      const list = (getHighlightsMap()[state.bookKey] || []).filter(h => h.sectionIndex === sectionIndex);
      for (const h of list) {
        if (!h.text || h.text.length < 2) continue;
        const safe = h.text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const col = h.color || 'yellow';
        try {
          out = out.replace(
            new RegExp(`(${safe})(?![^<]*>)`, 'i'),
            `<mark class="user-hl user-hl-${col}" data-hl-id="${escapeHtml(h.id)}" title="Clique para remover este destaque">$1</mark>`
          );
        } catch {}
      }

      // 3. Word Wise (Dicas entrelinhas sutis acima de palavras complexas + vocabulário salvo no Anki)
      if (state.wordWise && state.format !== 'CBZ') {
        const wwPairs = getWordWiseDictionaryPairs();
        for (const [word, hint] of wwPairs) {
          if (!word || word.length < 4) continue;
          const safeW = word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
          try {
            // Anota a primeira ocorrência da palavra por bloco sem quebrar tags HTML
            const rx = new RegExp(`(^|[^a-zA-ZÀ-ÿ0-9_])(${safeW})(?=$|[^a-zA-ZÀ-ÿ0-9_])(?![^<]*>)`, 'i');
            out = out.replace(
              rx,
              `$1<ruby class="wordwise-ruby" title="${escapeHtml(hint)}">$2<rt>${escapeHtml(hint)}</rt></ruby>`
            );
          } catch {}
        }
      }
      return out;
    }

    const BUILTIN_WORDWISE_DICT = {
      // Português (palavras literárias/eruditas)
      'efêmero': 'passageiro, breve',
      'efêmera': 'passageira, breve',
      'inexorável': 'implacável, inevitável',
      'ubíquo': 'onipresente',
      'melancolia': 'tristeza profunda',
      'melancólico': 'triste, pensativo',
      'inefável': 'indescritível',
      'pragmático': 'prático, objetivo',
      'clandestino': 'secreto, oculto',
      'esotérico': 'hermético, restrito',
      'pernicioso': 'nocivo, prejudicial',
      'resiliente': 'que se recupera',
      'ambíguo': 'de duplo sentido',
      'taciturno': 'calado, sombrio',
      'idiossincrasia': 'traço peculiar',
      'verossímil': 'plausível, crível',
      'indolente': 'apático, preguiçoso',
      'perspicaz': 'astuto, sagaz',
      'magnânimo': 'generoso, nobre',
      'efígie': 'imagem, representação',
      'quimera': 'ilusão, utopia',
      'alacridade': 'entusiasmo, alegria',
      'letargia': 'apatia, torpor',
      'letárgico': 'lento, sem reação',
      'auspicioso': 'promissor, favorável',
      'heurística': 'método de descoberta',
      'ontológico': 'relativo ao ser',
      'epistemologia': 'teoria do conhecimento',
      'paradoxo': 'contradição aparente',
      'arquétipo': 'modelo primordial',
      'anátema': 'maldição, condenação',
      'apócrifo': 'sem autenticidade',
      'beligerante': 'hostil, combativo',
      'circunspecto': 'cauteloso, sério',
      'complacente': 'condescendente',
      'contumaz': 'obstinado, teimoso',
      'corolário': 'consequência lógica',
      'deleterio': 'prejudicial, danoso',
      'deletério': 'prejudicial, danoso',
      'dissimulado': 'fingido, oculto',
      'empírico': 'baseado na prática',
      'escrupuloso': 'cuidadoso, ético',
      'fastígio': 'ponto culminante',
      'frugal': 'simples, moderado',
      'ignóbil': 'vil, desprezível',
      'imperscrutável': 'incompreensível',
      'incólume': 'intacto, são e salvo',
      'indolência': 'falta de ânimo',
      'inócuo': 'inofensivo',
      'insidioso': 'traiçoeiro, sutil',
      'intempestivo': 'fora de hora',
      'inveterado': 'enraizado, crônico',
      'lúgubre': 'sombrio, fúnebre',
      'nefasto': 'trágico, funesto',
      'obstinado': 'persistente, firme',
      'oprobrio': 'desonra, vergonha',
      'opróbrio': 'desonra, vergonha',
      'parcimonioso': 'econômico, contido',
      'peremptório': 'decisivo, final',
      'perfídia': 'traição, deslealdade',
      'prolixo': 'longo, repetitivo',
      'pusilânime': 'covarde, fraco',
      'recôndito': 'escondido, íntimo',
      'sagaz': 'esperto, perspicaz',
      'subjacente': 'implícito, por baixo',
      'supérfluo': 'desnecessário',
      ' tergiversar': 'evitar o assunto',
      'veemente': 'intenso, energético',
      'vicissitude': 'reviravolta, mudança',
      // Inglês (literary words)
      'ephemeral': 'short-lived, brief',
      'ubiquitous': 'present everywhere',
      'melancholy': 'deep sadness',
      'ineffable': 'beyond words',
      'pragmatic': 'practical, realistic',
      'ominous': 'threatening, dark',
      'resilient': 'able to recover',
      'ambiguous': 'open to interpretation',
      'clandestine': 'kept secret',
      'esoteric': 'understood by few',
      'inexorable': 'impossible to stop',
      'pernicious': 'harmful, subtle',
      'voracious': 'eager, insatiable',
      'taciturn': 'reserved, silent',
      'alacrity': 'cheerful readiness',
      'lethargic': 'sluggish, weary',
      'auspicious': 'favorable, promising',
      'belligerent': 'hostile, aggressive',
      'circumspect': 'wary, cautious',
      'deleterious': 'causing harm',
      'inscrutable': 'impossible to understand',
      'insidious': 'gradually harmful',
      'lugubrious': 'mournful, gloomy',
      'nefarious': 'wicked, criminal',
      'obstinate': 'stubborn, unyielding',
      'perfidious': 'deceitful, untrustworthy',
      'superfluous': 'unnecessary, extra',
      'trepidation': 'fear, anxiety',
      'visceral': 'deeply felt, instinctive',
      'wretched': 'unfortunate, miserable',
      'fathom': 'understand deeply',
      'behemoth': 'huge creature/thing',
      'harbinger': 'sign of what is to come',
      'labyrinth': 'complex maze',
      'solitude': 'state of being alone'
    };

    function getWordWiseDictionaryPairs() {
      const map = new Map();
      // 1. Incluir palavras que o próprio usuário salvou no Anki (com dica curta)
      try {
        const vocab = getVocabList();
        vocab.forEach(c => {
          const w = (c.front || '').trim();
          const b = (c.back || '').replace(/\[(?:PT|EN|Wikipédia[^\]]*)\]\s*/gi, '').split(/[|\n.;]/)[0].trim();
          if (w && w.length >= 4 && w.length <= 24 && !w.includes(' ') && b) {
            map.set(w.toLowerCase(), b.slice(0, 28));
          }
        });
      } catch {}
      // 2. Dicionário literário integrado
      for (const [k, v] of Object.entries(BUILTIN_WORDWISE_DICT)) {
        if (!map.has(k)) map.set(k, v);
      }
      return Array.from(map.entries());
    }

    let continuousObserver = null;
    async function hydrateContinuousChapter(secIdx, wrapEl) {
      if (!wrapEl || wrapEl.dataset.loaded === '1' || wrapEl.dataset.loading === '1') return;
      wrapEl.dataset.loading = '1';
      const sec = state.sections[secIdx];
      if (!sec) return;
      try {
        if (state.format === 'PDF' && state.pdfViewMode === 'canvas' && state.pdfDoc) {
          const page = await state.pdfDoc.getPage(sec.pageNumber);
          const baseVp = page.getViewport({ scale: 1 });
          const maxW = Math.min(920, Math.max(280, (dom.readerFlow.clientWidth || window.innerWidth - 60)));
          const zoomF = (state.pdfScale || 1.35) / 1.35;
          const sc = +((maxW / Math.max(1, baseVp.width)) * zoomF).toFixed(3);
          const vp = page.getViewport({ scale: sc });
          const dpr = Math.min(2.5, Math.max(1.5, window.devicePixelRatio || 1));
          const cvs = document.createElement('canvas');
          cvs.width = Math.floor(vp.width * dpr);
          cvs.height = Math.floor(vp.height * dpr);
          cvs.style.width = Math.floor(vp.width) + 'px';
          cvs.style.height = Math.floor(vp.height) + 'px';
          const ctx = cvs.getContext('2d');
          ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
          await page.render({ canvasContext: ctx, viewport: vp }).promise;
          wrapEl.innerHTML = `<div class="continuous-chapter-badge">Página ${sec.pageNumber} / ${state.sections.length}</div><div class="continuous-pdf-wrap"></div>`;
          wrapEl.querySelector('.continuous-pdf-wrap').appendChild(cvs);
        } else if (state.format === 'CBZ') {
          await ensureCbzImage(sec);
          wrapEl.innerHTML = `<div class="continuous-chapter-badge">${escapeHtml(sec.title)} (${secIdx + 1}/${state.sections.length})</div><div class="manga-page-wrap"><img src="${sec.imageUrl || ''}" alt="${escapeHtml(sec.title)}" /></div>`;
        } else {
          if (state.format === 'PDF') await ensurePdfSectionText(sec);
          else if (sec.html === null && sec.buildHtml) sec.html = sec.buildHtml(sec.rawSlice);
          const secHtml = applySavedHighlightsToHtml(sec.html || '', secIdx);
          wrapEl.innerHTML = `<div class="continuous-chapter-badge">${escapeHtml(sec.title)}</div>${secHtml}`;
        }
        wrapEl.dataset.loaded = '1';
      } catch (err) {
        wrapEl.innerHTML = `<div class="continuous-chapter-badge">${escapeHtml(sec.title)}</div><p style="color:var(--text-muted);">Erro ao carregar seção.</p>`;
      } finally {
        wrapEl.dataset.loading = '0';
      }
    }

    async function renderContinuousFullBook(scrollToSecIdx = state.currentIndex) {
      if (continuousObserver) {
        continuousObserver.disconnect();
        continuousObserver = null;
      }
      dom.pdfStage.style.display = 'none';
      dom.pageSheet.style.display = 'block';
      dom.viewport.classList.remove('paginated-mode', 'two-columns', 'manga-rtl');
      applySettings();

      dom.sheetBookTitle.textContent = `${state.title} · Modo Contínuo`;
      dom.sheetChapterTitle.textContent = `${state.sections.length} seções`;

      const frag = document.createDocumentFragment();
      state.sections.forEach((sec, idx) => {
        const secEl = document.createElement('section');
        secEl.className = 'continuous-chapter';
        secEl.id = `cont-sec-${idx}`;
        secEl.dataset.secIdx = String(idx);
        secEl.innerHTML = `<div class="continuous-placeholder">Carregando: ${escapeHtml(sec.title)}...</div>`;
        frag.appendChild(secEl);
      });
      dom.readerFlow.dataset.continuousBookKey = state.bookKey || '';
      dom.readerFlow.innerHTML = '';
      dom.readerFlow.appendChild(frag);

      // Pré-carregar imediatamente ao redor da posição atual para exibição instantânea
      const preloadStart = Math.max(0, scrollToSecIdx - 1);
      const preloadEnd = Math.min(state.sections.length - 1, scrollToSecIdx + 3);
      for (let i = preloadStart; i <= preloadEnd; i++) {
        await hydrateContinuousChapter(i, document.getElementById(`cont-sec-${i}`));
      }

      if ('IntersectionObserver' in window) {
        continuousObserver = new IntersectionObserver((entries) => {
          entries.forEach(entry => {
            if (entry.isIntersecting) {
              const idx = parseInt(entry.target.dataset.secIdx, 10);
              if (!isNaN(idx)) hydrateContinuousChapter(idx, entry.target);
            }
          });
        }, { root: dom.viewport, rootMargin: '950px 0px' });
        dom.readerFlow.querySelectorAll('.continuous-chapter').forEach(el => continuousObserver.observe(el));
      }

      requestAnimationFrame(() => {
        const targetEl = document.getElementById(`cont-sec-${scrollToSecIdx}`);
        if (targetEl && scrollToSecIdx > 0) {
          targetEl.scrollIntoView({ behavior: 'auto', block: 'start' });
        } else {
          dom.viewport.scrollTop = 0;
        }
      });

      updateFooterLabels();
      highlightActiveToc();
      saveProgress();
      renderBookmarks();
    }

    /* =====================================================================
     * LEITURA BIÔNICA (BIONIC READING) E CLASSIFICADOR CEFR
     * ===================================================================== */
    function applyBionicReadingToHtml(htmlStr) {
      if (!htmlStr || typeof htmlStr !== 'string') return htmlStr;
      return htmlStr.replace(/(<p\b[^>]*>)([\s\S]*?)(<\/p>)/gi, (match, openTag, innerText, closeTag) => {
        const transformed = innerText.replace(/(<[^>]+>)|([A-Za-zÀ-ÿ0-9_]+)/g, (m, tag, word) => {
          if (tag) return tag;
          if (!word || word.length < 2) return word;
          const half = Math.ceil(word.length * 0.45);
          return `<b>${word.slice(0, half)}</b>${word.slice(half)}`;
        });
        return `${openTag}${transformed}${closeTag}`;
      });
    }

    function analyzeBookCefr(sections) {
      if (!sections || !sections.length) return null;
      const sampleText = sections.slice(0, 15).map(s => s.text || '').join(' ').toLowerCase();
      const words = sampleText.match(/[a-zà-ÿ]{2,}/gi) || [];
      if (words.length < 50) return null;
      const wordCount = words.length;
      const totalLen = words.reduce((acc, w) => acc + w.length, 0);
      const avgLen = totalLen / wordCount;
      const uniqueWords = new Set(words);
      const diversity = uniqueWords.size / wordCount;

      let level = 'B1 (Intermediário)';
      if (avgLen < 4.3 && diversity < 0.30) level = 'A1 (Básico)';
      else if (avgLen < 4.7 && diversity < 0.38) level = 'A2 (Elementar)';
      else if (avgLen < 5.1 && diversity < 0.46) level = 'B1 (Intermediário)';
      else if (avgLen < 5.6 && diversity < 0.54) level = 'B2 (Independente)';
      else if (avgLen < 6.1) level = 'C1 (Avançado / Acadêmico)';
      else level = 'C2 (Domínio Pleno / Literário)';

      return { level, avgWordLength: avgLen.toFixed(1), uniqueWordsCount: uniqueWords.size, totalSampleWords: wordCount };
    }

    async function renderSection(options = {}) {
      if (!state.sections.length) return;
      state.currentIndex = Math.max(0, Math.min(state.sections.length - 1, state.currentIndex));
      const sec = state.sections[state.currentIndex];

      if (state.flowMode === 'scroll-all') {
        dom.pdfControls.classList.toggle('hidden', state.format !== 'PDF');
        dom.flowModeGroup.classList.remove('hidden');
        dom.selectionToolbar.classList.remove('open');
        const alreadyCont = dom.readerFlow.querySelector('.continuous-chapter') && dom.readerFlow.dataset.continuousBookKey === (state.bookKey || '') && !options.forceRebuildContinuous;
        if (alreadyCont && !options.highlight) {
          const targetEl = document.getElementById(`cont-sec-${state.currentIndex}`);
          if (targetEl) {
            await hydrateContinuousChapter(state.currentIndex, targetEl);
            targetEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
            updateFooterLabels();
            highlightActiveToc();
            saveProgress();
            return;
          }
        }
        await renderContinuousFullBook(state.currentIndex);
        return;
      }

      if (continuousObserver) {
        continuousObserver.disconnect();
        continuousObserver = null;
      }

      const isPdfCanvas = state.format === 'PDF' && state.pdfViewMode === 'canvas';
      dom.pdfControls.classList.toggle('hidden', state.format !== 'PDF');
      dom.flowModeGroup.classList.remove('hidden');
      dom.selectionToolbar.classList.remove('open');

      if (isPdfCanvas) {
        dom.pageSheet.style.display = 'none';
        dom.pdfStage.style.display = 'flex';
        dom.viewport.classList.remove('paginated-mode', 'two-columns', 'manga-rtl');
        applySettings();
        await renderPdfPageCanvas(sec.pageNumber);
        dom.viewport.scrollTop = 0;
      } else {
        dom.pdfStage.style.display = 'none';
        const isPag = state.flowMode.startsWith('paginated');
        dom.pageSheet.style.display = isPag ? 'flex' : 'block';

        // Modo Mangá (CBZ ou PDF em Modo Mangá) em 2 Páginas (exibe página atual e próxima lado a lado, respeitando Direita<-Esquerda)
        if ((state.format === 'CBZ' || (state.format === 'PDF' && state.readingType === 'manga')) && state.flowMode === 'paginated-2' && window.innerWidth >= 700) {
          if (state.format === 'PDF') {
            await ensurePdfSectionText(sec);
            if (state.currentIndex + 1 < state.sections.length) {
              await ensurePdfSectionText(state.sections[state.currentIndex + 1]);
            }
          } else if (state.format === 'CBZ') {
            await ensureCbzImage(sec);
            if (state.currentIndex + 1 < state.sections.length) {
              await ensureCbzImage(state.sections[state.currentIndex + 1]);
            }
            prefetchCbzAdjacent(state.currentIndex + 1);
          }
          const isSpreadImage = (sec && sec.imageWidth && sec.imageHeight && sec.imageWidth > sec.imageHeight * 1.15);
          const nextSec = (!isSpreadImage && state.currentIndex + 1 < state.sections.length) ? state.sections[state.currentIndex + 1] : null;
          const dirStyle = state.mangaRtl ? 'flex-direction: row-reverse;' : 'flex-direction: row;';
          dom.readerFlow.innerHTML = `
            <div style="display:flex; ${dirStyle} width:100%; height:100%; align-items:center; justify-content:center; gap:0;">
              <div class="manga-page-wrap" style="flex:1;"><img src="${sec.imageUrl || ''}" alt="${escapeHtml(sec.title)}" /></div>
              ${nextSec ? `<div class="manga-page-wrap" style="flex:1;"><img src="${nextSec.imageUrl || ''}" alt="${escapeHtml(nextSec.title)}" /></div>` : ''}
            </div>
          `;
          dom.sheetBookTitle.textContent = `${state.title} · ${sec.title}${nextSec ? '–' + (state.currentIndex + 2) : ''}`;
          dom.sheetChapterTitle.textContent = isSpreadImage ? 'Página Dupla Panorâmica' : (state.mangaRtl ? 'Modo Mangá (Direita → Esquerda)' : 'Página Dupla');
          applySettings();
        } else {
          if (state.format === 'PDF') {
            await ensurePdfSectionText(sec);
          } else if (state.format === 'CBZ') {
            await ensureCbzImage(sec);
            prefetchCbzAdjacent(state.currentIndex);
          } else if (sec.html === null && sec.buildHtml) {
            sec.html = sec.buildHtml(sec.rawSlice);
          }

          let html = renderLightweightMathHtml(sec.html || '');
          html = applySavedHighlightsToHtml(html, state.currentIndex);
          if (state.bionicReading) {
            html = applyBionicReadingToHtml(html);
          }

          if (options.highlight) {
            const safe = options.highlight.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            html = html.replace(new RegExp(`(${safe})(?![^<]*>)`, 'gi'), '<mark class="hl">$1</mark>');
          }
          dom.readerFlow.innerHTML = html;
          dom.sheetBookTitle.textContent = `${state.title} › ${sec.title}`;
          dom.sheetChapterTitle.textContent = `${state.currentIndex + 1} / ${state.sections.length}`;

          applySettings();

          if (options.anchor) {
            const targetEl = dom.readerFlow.querySelector(`[id="${CSS.escape(options.anchor)}"], a[name="${CSS.escape(options.anchor)}"]`);
            if (targetEl) targetEl.scrollIntoView({ block: 'start' });
            else dom.viewport.scrollTop = 0;
          } else if (options.restoreSubPage !== undefined && dom.viewport.classList.contains('paginated-mode')) {
            updatePaginatedMetrics();
            state.subPageIndex = Math.max(0, Math.min(state.subPageCount - 1, options.restoreSubPage));
            updatePaginatedMetrics();
            if (options.restoreSubPage > 0 && typeof showReadingReturnRibbon === 'function') {
              setTimeout(showReadingReturnRibbon, 200);
            }
          } else if (options.restoreScrollRatio !== undefined && !dom.viewport.classList.contains('paginated-mode')) {
            requestAnimationFrame(() => {
              const maxScroll = Math.max(0, dom.viewport.scrollHeight - dom.viewport.clientHeight);
              dom.viewport.scrollTop = Math.round(options.restoreScrollRatio * maxScroll);
              if (options.restoreScrollRatio > 0.04 && typeof showReadingReturnRibbon === 'function') {
                setTimeout(showReadingReturnRibbon, 250);
              }
            });
          } else if (options.fromEnd && dom.viewport.classList.contains('paginated-mode')) {
            updatePaginatedMetrics();
            state.subPageIndex = Math.max(0, state.subPageCount - 1);
            updatePaginatedMetrics();
          } else {
            state.subPageIndex = 0;
            dom.viewport.scrollTop = 0;
            dom.readerFlow.scrollLeft = 0;
            if (dom.viewport.classList.contains('paginated-mode')) {
              updatePaginatedMetrics();
            }
          }

          if (options.highlight) {
            requestAnimationFrame(() => {
              const firstMark = dom.readerFlow.querySelector('mark.hl');
              if (firstMark) firstMark.scrollIntoView({ block: 'center' });
            });
          }
        }
      }

      updateFooterLabels();
      highlightActiveToc();
      saveProgress();
      renderBookmarks();
    }

    function formatMinutesHuman(mins) {
      if (mins <= 1) return '~1 min';
      if (mins < 60) return `~${Math.round(mins)} min`;
      const h = Math.floor(mins / 60);
      const m = Math.round(mins % 60);
      return m > 0 ? `~${h}h ${m}min` : `~${h}h`;
    }

    function updateReadingSpeedSample(wordsReadNow) {
      const now = Date.now();
      const elapsedMin = (now - (state.lastPageTurnTime || now)) / 60000;
      state.lastPageTurnTime = now;
      if (wordsReadNow >= 30 && elapsedMin >= 0.08 && elapsedMin <= 8) {
        const sampleWpm = Math.round(wordsReadNow / elapsedMin);
        if (sampleWpm >= 100 && sampleWpm <= 520) {
          state.readingWpm = Math.round((state.readingWpm * 0.75) + (sampleWpm * 0.25));
          localStorage.setItem('reader_wpm', String(state.readingWpm));
        }
      }
    }

    function computeKindleReadingMetrics() {
      const total = state.sections.length;
      if (!total) return null;
      const wpm = Math.max(110, state.readingWpm || 215);
      const sec = state.sections[state.currentIndex];
      const secWords = sec && sec.text ? sec.text.trim().split(/\s+/).length : 250;

      // Fração restante na seção atual
      let secFractionDone = 0;
      if (dom.viewport.classList.contains('paginated-mode') && state.subPageCount > 1) {
        secFractionDone = state.subPageIndex / Math.max(1, state.subPageCount);
      } else if (!dom.viewport.classList.contains('paginated-mode')) {
        const maxScroll = Math.max(1, dom.viewport.scrollHeight - dom.viewport.clientHeight);
        secFractionDone = Math.min(1, Math.max(0, dom.viewport.scrollTop / maxScroll));
      }
      const wordsLeftInChapter = Math.max(0, Math.round(secWords * (1 - secFractionDone)));
      const minLeftChapter = Math.max(1, Math.ceil(wordsLeftInChapter / wpm));

      // Palavras totais e restantes no livro
      let wordsBefore = 0;
      let totalBookWords = 0;
      for (let i = 0; i < total; i++) {
        const s = state.sections[i];
        const w = (s && s.text) ? s.text.trim().split(/\s+/).length : 250;
        if (i < state.currentIndex) wordsBefore += w;
        totalBookWords += w;
      }
      const currentWordsRead = wordsBefore + Math.round(secWords * secFractionDone);
      const wordsLeftBook = Math.max(0, totalBookWords - currentWordsRead);
      const minLeftBook = Math.max(1, Math.ceil(wordsLeftBook / wpm));

      // Posição estilo Kindle (1 Posição/Location ≈ 22 palavras / 128 bytes)
      const currentLoc = Math.max(1, Math.round(currentWordsRead / 22));
      const totalLoc = Math.max(currentLoc, Math.round(totalBookWords / 22));

      return {
        minLeftChapter,
        minLeftBook,
        currentLoc,
        totalLoc,
        wpm
      };
    }

    function updateFooterLabels() {
      const total = state.sections.length;
      if (!total) return;
      const cur = state.currentIndex + 1;
      const pct = Math.round((cur / Math.max(1, total)) * 100);

      dom.inputSectionNum.value = String(cur);
      dom.lblTotalSections.textContent = `/ ${total}`;
      dom.statusPercent.textContent = `${pct}%`;
      dom.progressFill.style.width = `${pct}%`;

      if (dom.progressTrack && total > 1 && dom.progressTrack.dataset.renderedBook !== (state.bookKey || '')) {
        dom.progressTrack.querySelectorAll('.chapter-tick-marker').forEach(el => el.remove());
        const step = Math.max(1, Math.floor(total / 40));
        for (let i = 1; i < total; i += step) {
          const tick = document.createElement('div');
          tick.className = 'chapter-tick-marker';
          tick.style.left = `${(i / total) * 100}%`;
          dom.progressTrack.appendChild(tick);
        }
        dom.progressTrack.dataset.renderedBook = state.bookKey || '';
      }

      const cefrBadgeEl = document.getElementById('lblCefrBadge');
      if (cefrBadgeEl && state.sections && state.sections.length && state.format !== 'CBZ') {
        if (!state._cachedCefr) {
          state._cachedCefr = analyzeBookCefr(state.sections);
        }
        if (state._cachedCefr) {
          cefrBadgeEl.classList.remove('hidden');
          cefrBadgeEl.textContent = `CEFR: ${state._cachedCefr.level.split(' ')[0]}`;
          cefrBadgeEl.title = `Nível de Vocabulário: ${state._cachedCefr.level} (Média: ${state._cachedCefr.avgWordLength} letras, ${state._cachedCefr.uniqueWordsCount} palavras únicas)`;
        } else {
          cefrBadgeEl.classList.add('hidden');
        }
      } else if (cefrBadgeEl) {
        cefrBadgeEl.classList.add('hidden');
      }

      if (pct >= 80 && state.autoPrefetchChapters && typeof prefetchNextSeriesChapter === 'function') {
        prefetchNextSeriesChapter();
      }

      const sec = state.sections[state.currentIndex];
      const metrics = computeKindleReadingMetrics();

      let kindleSummary = '';
      if (metrics && state.format !== 'CBZ') {
        const chStr = `Faltam ${formatMinutesHuman(metrics.minLeftChapter)} no cap.`;
        const bkStr = `${formatMinutesHuman(metrics.minLeftBook)} no livro`;
        const locStr = `Pos. ${metrics.currentLoc} de ${metrics.totalLoc}`;
        if (state.footerMode === 'chapter') kindleSummary = chStr;
        else if (state.footerMode === 'book') kindleSummary = `Faltam ${bkStr}`;
        else if (state.footerMode === 'loc') kindleSummary = locStr;
        else kindleSummary = `${chStr} · ${bkStr} · ${locStr}`;

        dom.statusLeft.textContent = `${kindleSummary} (${pct}%)`;
        dom.statusLeft.style.cursor = 'pointer';
        dom.statusLeft.title = 'Clique para alternar entre: Completo, Tempo no Capítulo, Tempo no Livro e Posição Kindle';
      } else {
        dom.statusLeft.textContent = `${state.format} · Seção ${cur}/${total} (${pct}%)`;
      }

      if (dom.viewport.classList.contains('paginated-mode') && state.format !== 'CBZ') {
        dom.sheetChapterTitle.textContent = `${state.subPageIndex + 1} / ${state.subPageCount}`;
        dom.sheetFooterInfo.textContent = `${sec ? sec.title : ''} · Pág. ${state.subPageIndex + 1}/${state.subPageCount} · ${kindleSummary || (`Cap. ${cur}/${total}`)}`;
      } else {
        dom.sheetFooterInfo.textContent = `${sec ? sec.title : ''} · ${kindleSummary || (`${cur} de ${total} (${pct}%)`)}`;
      }
      dom.sheetFooterInfo.style.cursor = 'pointer';
      dom.sheetFooterInfo.title = 'Clique para alternar o indicador de tempo/posição estilo Kindle';
    }

    function cycleKindleFooterMode() {
      const modes = ['full', 'chapter', 'book', 'loc'];
      const next = modes[(modes.indexOf(state.footerMode) + 1) % modes.length];
      state.footerMode = next;
      localStorage.setItem('reader_footerMode', next);
      updateFooterLabels();
    }
    dom.statusLeft.addEventListener('click', cycleKindleFooterMode);
    dom.sheetFooterInfo.addEventListener('click', cycleKindleFooterMode);

    // Extrair texto de uma nota de rodapé para exibir em Pop-up sem sair da página
    function extractFootnoteTargetPreview(targetSecIdx, anchorId, linkEl) {
      try {
        // 1. Procurar no próprio DOM se for na mesma seção
        if ((targetSecIdx === undefined || targetSecIdx === state.currentIndex) && anchorId) {
          const el = dom.readerFlow.querySelector(`[id="${CSS.escape(anchorId)}"], a[name="${CSS.escape(anchorId)}"]`);
          if (el) {
            const container = el.closest('aside, li, p, div, dd') || el.parentElement || el;
            const txt = (container.textContent || '').replace(/\s+/g, ' ').trim();
            if (txt.length >= 3) return txt.slice(0, 900);
          }
        }
        // 2. Procurar na seção de destino
        if (targetSecIdx !== undefined && state.sections[targetSecIdx]) {
          const sec = state.sections[targetSecIdx];
          if (sec.html === null && sec.buildHtml) sec.html = sec.buildHtml(sec.rawSlice);
          const doc = new DOMParser().parseFromString(sec.html || '', 'text/html');
          if (anchorId) {
            const el = doc.getElementById(anchorId) || doc.querySelector(`[name="${CSS.escape(anchorId)}"]`);
            if (el) {
              const container = el.closest('aside, li, p, div, dd') || el.parentElement || el;
              const txt = (container.textContent || '').replace(/\s+/g, ' ').trim();
              if (txt.length >= 3) return txt.slice(0, 900);
            }
          }
          const secTxt = (sec.text || doc.body.textContent || '').replace(/\s+/g, ' ').trim();
          if (secTxt.length >= 3 && secTxt.length <= 1400) return secTxt;
        }
      } catch {}
      return '';
    }

    function showFootnotePopover(footnoteText, linkEl, onJumpCallback) {
      activePopoverEntityId = null;
      document.getElementById('popEntityCategory').textContent = 'Nota de Rodapé';
      document.getElementById('popEntityName').textContent = (linkEl.textContent || 'Referência').trim().slice(0, 40);
      document.getElementById('popEntityAliases').textContent = 'Visualização instantânea sem sair da página';
      document.getElementById('popEntityNoteBody').textContent = footnoteText;
      document.getElementById('popEntityMeta').textContent = 'Clique no botão abaixo se desejar ir até a página da nota.';

      const btnSearch = document.getElementById('btnPopEntitySearch');
      const btnEdit = document.getElementById('btnPopEntityEdit');
      const btnDel = document.getElementById('btnPopEntityDelete');
      btnSearch.textContent = 'Ir para a página da nota';
      btnEdit.classList.add('hidden');
      btnDel.classList.add('hidden');

      btnSearch.onclick = () => {
        entityNotePopover.classList.remove('open');
        if (onJumpCallback) onJumpCallback();
      };

      entityNotePopover.classList.add('open');
      if (linkEl && linkEl.getBoundingClientRect) {
        const r = linkEl.getBoundingClientRect();
        const popW = entityNotePopover.offsetWidth || 340;
        const popH = entityNotePopover.offsetHeight || 190;
        const left = Math.max(12, Math.min(window.innerWidth - popW - 12, r.left + r.width / 2 - popW / 2));
        const top = (r.bottom + popH + 20 < window.innerHeight) ? (r.bottom + 8) : Math.max(48, r.top - popH - 8);
        entityNotePopover.style.left = `${Math.round(left)}px`;
        entityNotePopover.style.top = `${Math.round(top)}px`;
      }
    }

    // Interceptar cliques em Personagens/Notas (X-Ray), destaques salvos e links internos / Notas de Rodapé
    dom.readerFlow.addEventListener('click', (e) => {
      const entitySpan = e.target.closest('.entity-note-ref');
      if (entitySpan && entitySpan.dataset.entityId) {
        e.stopPropagation();
        showEntityNotePopover(entitySpan.dataset.entityId, entitySpan);
        return;
      }

      const hlMark = e.target.closest('mark.user-hl');
      if (hlMark) {
        const hlId = hlMark.getAttribute('data-hl-id');
        if (hlId && confirm('Remover este destaque do texto?')) {
          removeHighlightById(hlId);
        }
        return;
      }

      const imgEl = e.target.closest('img');
      if (imgEl && imgEl.src) {
        e.preventDefault();
        e.stopPropagation();
        if (typeof openImageLightbox === 'function') {
          openImageLightbox(imgEl.src, imgEl.alt || 'Imagem do Livro');
        } else {
          const lb = document.getElementById('imgLightbox');
          const lbImg = document.getElementById('imgLightboxTarget');
          if (lb && lbImg) {
            lbImg.src = imgEl.src;
            lb.classList.add('open');
          }
        }
        return;
      }

      const a = e.target.closest('a');
      if (!a) return;

      const mobiFp = a.getAttribute('data-mobi-filepos');
      if (mobiFp !== null) {
        e.preventDefault();
        const fp = parseInt(mobiFp, 10);
        let idx = state.sections.findIndex(s => Math.abs(s.fileposStart - fp) <= 64);
        if (idx === -1) {
          idx = state.sections.findIndex(s => fp >= s.fileposStart && fp < s.fileposEnd);
        }
        if (idx !== -1) {
          state.currentIndex = idx;
          renderSection();
        }
        return;
      }

      const internalPath = a.getAttribute('data-internal-path');
      const internalAnchor = a.getAttribute('data-internal-anchor');
      if (internalPath || internalAnchor) {
        e.preventDefault();
        let targetSecIdx;
        if (internalPath) {
          let decP = internalPath;
          try { decP = decodeURIComponent(internalPath); } catch {}
          targetSecIdx = state.pathToSection.get(internalPath)
            ?? state.pathToSection.get(internalPath.toLowerCase())
            ?? state.pathToSection.get(decP.toLowerCase())
            ?? state.pathToSection.get(decP.split('/').pop().toLowerCase());
        }
        if (targetSecIdx === undefined && internalAnchor) {
          const key = `#${internalAnchor}`;
          if (state.idToSection.has(key)) targetSecIdx = state.idToSection.get(key);
        }

        const performJump = () => {
          pinCurrentReadingLocation();
          if (targetSecIdx !== undefined) {
            state.currentIndex = targetSecIdx;
            renderSection({ anchor: internalAnchor || '' });
          } else if (internalAnchor) {
            const el = dom.readerFlow.querySelector(`[id="${CSS.escape(internalAnchor)}"], a[name="${CSS.escape(internalAnchor)}"]`);
            if (el) el.scrollIntoView({ block: 'start' });
          }
        };

        // Verificar se é uma nota de rodapé / referência curta para exibir em Pop-up sem perder a página
        const linkText = (a.textContent || '').trim();
        const isFootnoteLike = internalAnchor || a.closest('sup') || /^\[?\d+\]?$|^\*+$|^nota/i.test(linkText) || /note|fn|ref|rodape/i.test(internalAnchor || internalPath || '');
        if (isFootnoteLike) {
          const previewTxt = extractFootnoteTargetPreview(targetSecIdx, internalAnchor, a);
          if (previewTxt) {
            showFootnotePopover(previewTxt, a, performJump);
            return;
          }
        }
        performJump();
      }
    });

    function isTwoPageSpreadActive() {
      if (state.flowMode !== 'paginated-2' || window.innerWidth < 700) return false;
      if (state.format === 'CBZ') return true;
      if (state.format === 'PDF' && (state.pdfViewMode === 'canvas' || state.readingType === 'manga')) return true;
      return false;
    }

    function stepForward() {
      if (!state.sections.length) return;
      updateReadingSpeedSample(180);
      if (isTwoPageSpreadActive()) {
        const curSec = state.sections[state.currentIndex];
        const isSpread = Boolean(curSec && curSec.imageWidth && curSec.imageHeight && curSec.imageWidth > curSec.imageHeight * 1.15);
        const step = isSpread ? 1 : 2;
        if (state.currentIndex < state.sections.length - 1) {
          state.currentIndex = Math.min(state.sections.length - 1, state.currentIndex + step);
          renderSection();
        }
        return;
      }
      const isPdfCanvas = state.format === 'PDF' && state.pdfViewMode === 'canvas';
      if (!isPdfCanvas && dom.viewport.classList.contains('paginated-mode') && state.subPageIndex < state.subPageCount - 1) {
        state.subPageIndex++;
        updatePaginatedMetrics();
        saveProgress();
        return;
      }
      if (state.currentIndex < state.sections.length - 1) {
        state.currentIndex++;
        renderSection();
      }
    }

    function stepBackward() {
      if (!state.sections.length) return;
      if (isTwoPageSpreadActive()) {
        if (state.currentIndex > 0) {
          state.currentIndex = Math.max(0, state.currentIndex - 2);
          renderSection();
        }
        return;
      }
      const isPdfCanvas = state.format === 'PDF' && state.pdfViewMode === 'canvas';
      if (!isPdfCanvas && dom.viewport.classList.contains('paginated-mode') && state.subPageIndex > 0) {
        state.subPageIndex--;
        updatePaginatedMetrics();
        saveProgress();
        return;
      }
      if (state.currentIndex > 0) {
        state.currentIndex--;
        renderSection({ fromEnd: true });
      }
    }

    // Permitir virar páginas com o scroll do mouse quando estiver no Modo Livro Paginado
    let wheelCooldown = false;
    dom.viewport.addEventListener('wheel', (e) => {
      if ((dom.emptyState && !dom.emptyState.classList.contains('hidden')) || !dom.viewport.classList.contains('paginated-mode') || !state.sections.length) return;
      e.preventDefault();
      if (Math.abs(e.deltaY) < 10 || wheelCooldown) return;
      wheelCooldown = true;
      setTimeout(() => { wheelCooldown = false; }, 260);
      if (e.deltaY > 0) stepForward();
      else if (e.deltaY < 0) stepBackward();
    }, { passive: false });

    // Salvar progresso de rolagem continuamente para retomar no ponto exato
    let scrollSaveTimer = null;
    dom.viewport.addEventListener('scroll', () => {
      if (dom.viewport.classList.contains('paginated-mode') || !state.sections.length) return;
      if (state.flowMode === 'scroll-all') {
        const vpTop = dom.viewport.getBoundingClientRect().top + 90;
        const chaps = dom.readerFlow.querySelectorAll('.continuous-chapter');
        for (const ch of chaps) {
          const rect = ch.getBoundingClientRect();
          if (rect.bottom > vpTop) {
            const idx = parseInt(ch.dataset.secIdx, 10);
            if (!isNaN(idx) && idx !== state.currentIndex) {
              state.currentIndex = idx;
              updateFooterLabels();
              highlightActiveToc();
            }
            break;
          }
        }
      }
      clearTimeout(scrollSaveTimer);
      scrollSaveTimer = setTimeout(saveProgress, 250);
    });

    /* =====================================================================
     * 7. SUMÁRIO, MARCADORES DE PÁGINA, DESTAQUES DE TEXTO E BUSCA
     * ===================================================================== */
    function openSidebarTab(paneId) {
      dom.sidebar.classList.remove('hidden-sidebar');
      if (typeof syncSidebarBackdrop === 'function') syncSidebarBackdrop();
      document.querySelectorAll('.sidebar-nav button').forEach(b => {
        b.classList.toggle('active', b.dataset.pane === paneId);
      });
      document.querySelectorAll('.sidebar-pane').forEach(p => {
        p.classList.toggle('active', p.id === paneId);
      });
      if (paneId === 'paneImages' && typeof renderImageGallery === 'function') {
        renderImageGallery();
      }
      if (dom.viewport.classList.contains('paginated-mode')) {
        setTimeout(updatePaginatedMetrics, 200);
      }
    }

    function renderToc() {
      dom.tocContainer.innerHTML = '';
      state.toc.forEach(item => {
        const btn = document.createElement('button');
        btn.className = `toc-entry toc-depth-${item.depth || 0}`;
        btn.textContent = item.label;
        btn.dataset.secIdx = String(item.sectionIndex);
        btn.addEventListener('click', () => {
          pinCurrentReadingLocation();
          state.currentIndex = item.sectionIndex;
          renderSection({ anchor: item.anchor || '' });
        });
        dom.tocContainer.appendChild(btn);
      });
      highlightActiveToc();
    }

    function highlightActiveToc() {
      const buttons = dom.tocContainer.querySelectorAll('.toc-entry');
      let activeBtn = null;
      buttons.forEach(btn => {
        const match = parseInt(btn.dataset.secIdx, 10) === state.currentIndex;
        btn.classList.toggle('active', match);
        if (match && !activeBtn) activeBtn = btn;
      });
      if (activeBtn) {
        activeBtn.scrollIntoView({ block: 'nearest' });
      }
    }

    function getBookmarksMap() {
      try { return JSON.parse(localStorage.getItem('reader_bookmarks') || '{}'); }
      catch { return {}; }
    }

    function toggleBookmark() {
      if (!state.bookKey || !state.sections.length) return;
      const map = getBookmarksMap();
      const list = map[state.bookKey] || [];
      const pos = list.findIndex(b => b.index === state.currentIndex && (b.subPage || 0) === state.subPageIndex);
      if (pos >= 0) {
        list.splice(pos, 1);
        showToast('Marcador de página removido');
      } else {
        const maxScroll = Math.max(1, dom.viewport.scrollHeight - dom.viewport.clientHeight);
        const scrollRatio = dom.viewport.classList.contains('paginated-mode') ? 0 : (dom.viewport.scrollTop / maxScroll);
        const pageLbl = dom.viewport.classList.contains('paginated-mode') && state.subPageCount > 1
          ? ` (Pág. ${state.subPageIndex + 1}/${state.subPageCount})`
          : '';
        list.push({
          index: state.currentIndex,
          subPage: state.subPageIndex,
          scrollRatio,
          title: state.sections[state.currentIndex].title + pageLbl,
          date: new Date().toLocaleDateString('pt-BR')
        });
        showToast('Página marcada com sucesso');
      }
      map[state.bookKey] = list;
      localStorage.setItem('reader_bookmarks', JSON.stringify(map));
      renderBookmarks();
    }

    // Permitir clicar em um Personagem/Nota (X-Ray) ou destaque na camada de texto do PDF
    dom.pdfContainer.addEventListener('click', (e) => {
      const entitySpan = e.target.closest('.entity-note-ref');
      if (entitySpan && entitySpan.dataset.entityId) {
        e.stopPropagation();
        showEntityNotePopover(entitySpan.dataset.entityId, entitySpan);
        return;
      }
      const hlEl = e.target.closest('mark.user-hl');
      if (hlEl && hlEl.dataset.hlId) {
        if (confirm('Remover este destaque de texto?')) {
          removeHighlightById(hlEl.dataset.hlId);
        }
      }
    });

    async function addTextHighlight(color) {
      if (!state.bookKey || !state.selectedText) return;
      if (state.format === 'PDF' && state.sections[state.currentIndex] && state.sections[state.currentIndex].text === null) {
        await ensurePdfSectionText(state.sections[state.currentIndex]);
      }
      const map = getHighlightsMap();
      const list = map[state.bookKey] || [];
      const id = 'hl_' + Date.now();
      list.push({
        id,
        sectionIndex: state.currentIndex,
        subPage: state.subPageIndex,
        chapterTitle: state.sections[state.currentIndex] ? state.sections[state.currentIndex].title : '',
        text: state.selectedText,
        color,
        date: new Date().toLocaleDateString('pt-BR')
      });
      map[state.bookKey] = list;
      localStorage.setItem('reader_highlights', JSON.stringify(map));
      window.getSelection().removeAllRanges();
      dom.selectionToolbar.classList.remove('open');
      renderSection({ restoreSubPage: state.subPageIndex });
      showToast('Trecho destacado salvo em Marcadores');
    }

    function removeHighlightById(id) {
      if (!state.bookKey) return;
      const map = getHighlightsMap();
      const list = (map[state.bookKey] || []).filter(h => h.id !== id);
      map[state.bookKey] = list;
      localStorage.setItem('reader_highlights', JSON.stringify(map));
      renderSection({ restoreSubPage: state.subPageIndex });
    }

    /* =====================================================================
     * 7A. FICHAS DE PERSONAGENS, LUGARES E NOTAS INTELIGENTES (ESTILO KINDLE X-RAY)
     * ===================================================================== */
    let activePopoverEntityId = null;
    const entityNotePopover = document.getElementById('entityNotePopover');
    const entityNoteModal = document.getElementById('entityNoteModal');

    const categoryMeta = {
      character: { badge: 'Personagem' },
      place: { badge: 'Lugar / Facção' },
      concept: { badge: 'Conceito / Objeto' },
      note: { badge: 'Nota de Trecho' }
    };

    function showEntityNotePopover(entityId, anchorEl) {
      if (!state.bookKey) return;
      const list = getEntityNotesMap()[state.bookKey] || [];
      const ent = list.find(x => x.id === entityId);
      if (!ent) return;

      activePopoverEntityId = ent.id;
      const btnSearch = document.getElementById('btnPopEntitySearch');
      const btnEdit = document.getElementById('btnPopEntityEdit');
      const btnDel = document.getElementById('btnPopEntityDelete');
      btnSearch.textContent = 'Ver Aparições';
      btnSearch.onclick = null;
      btnEdit.classList.remove('hidden');
      btnDel.classList.remove('hidden');
      const catInfo = categoryMeta[ent.category] || categoryMeta.character;
      document.getElementById('popEntityCategory').textContent = catInfo.badge;
      document.getElementById('popEntityName').textContent = ent.name;
      const aliasesArr = Array.isArray(ent.aliases) ? ent.aliases.filter(Boolean) : [];
      document.getElementById('popEntityAliases').textContent = aliasesArr.length ? `Também reconhecido como: ${aliasesArr.join(', ')}` : '';
      document.getElementById('popEntityNoteBody').textContent = ent.note || '(Sem descrição cadastrada)';
      document.getElementById('popEntityMeta').textContent = `Anotado em: ${ent.firstChapterTitle || ('Seção ' + ((ent.firstSectionIndex || 0) + 1))} · ${ent.updatedAt || ''}`;

      entityNotePopover.classList.add('open');
      if (anchorEl && anchorEl.getBoundingClientRect) {
        const r = anchorEl.getBoundingClientRect();
        const popW = entityNotePopover.offsetWidth || 320;
        const popH = entityNotePopover.offsetHeight || 200;
        const left = Math.max(12, Math.min(window.innerWidth - popW - 12, r.left + r.width / 2 - popW / 2));
        const top = (r.bottom + popH + 20 < window.innerHeight) ? (r.bottom + 8) : Math.max(48, r.top - popH - 8);
        entityNotePopover.style.left = `${Math.round(left)}px`;
        entityNotePopover.style.top = `${Math.round(top)}px`;
      } else {
        entityNotePopover.style.left = '50%';
        entityNotePopover.style.top = '120px';
      }
    }

    document.getElementById('btnCloseEntityPopover').addEventListener('click', () => {
      entityNotePopover.classList.remove('open');
    });
    document.addEventListener('click', (e) => {
      if (entityNotePopover.classList.contains('open') && !entityNotePopover.contains(e.target) && !e.target.closest('.entity-note-ref')) {
        entityNotePopover.classList.remove('open');
      }
    });

    function openEntityNoteModal(prefillText = '', existingEntityId = '') {
      if (!state.bookKey || !state.sections.length) {
        alert('Abra um livro primeiro para adicionar notas de personagens ou termos.');
        return;
      }
      dom.selectionToolbar.classList.remove('open');
      entityNotePopover.classList.remove('open');

      const list = getEntityNotesMap()[state.bookKey] || [];
      let existing = null;
      if (existingEntityId) {
        existing = list.find(x => x.id === existingEntityId);
      } else if (prefillText) {
        const lower = prefillText.trim().toLowerCase();
        existing = list.find(x => x.name.toLowerCase() === lower || (Array.isArray(x.aliases) && x.aliases.some(a => a.toLowerCase() === lower)));
      }

      if (existing) {
        document.getElementById('inputEntityId').value = existing.id;
        document.getElementById('inputEntityName').value = existing.name;
        document.getElementById('selectEntityCategory').value = existing.category || 'character';
        document.getElementById('inputEntityAliases').value = (existing.aliases || []).join(', ');
        document.getElementById('inputEntityNote').value = existing.note || '';
      } else {
        document.getElementById('inputEntityId').value = '';
        document.getElementById('inputEntityName').value = (prefillText || '').trim().slice(0, 120);
        document.getElementById('selectEntityCategory').value = 'character';
        document.getElementById('inputEntityAliases').value = '';
        document.getElementById('inputEntityNote').value = '';
      }

      entityNoteModal.classList.add('open');
      setTimeout(() => document.getElementById('inputEntityNote').focus(), 40);
    }

    document.getElementById('btnSelEntityNote').addEventListener('click', () => {
      openEntityNoteModal(state.selectedText || '');
    });
    document.getElementById('btnNewEntitySidebar').addEventListener('click', () => {
      openEntityNoteModal(state.selectedText || '');
    });
    document.getElementById('btnCloseEntityModal').addEventListener('click', () => entityNoteModal.classList.remove('open'));
    document.getElementById('btnCancelEntityModal').addEventListener('click', () => entityNoteModal.classList.remove('open'));

    document.getElementById('btnSaveEntityNote').addEventListener('click', async () => {
      if (!state.bookKey) return;
      const name = document.getElementById('inputEntityName').value.trim();
      const note = document.getElementById('inputEntityNote').value.trim();
      const category = document.getElementById('selectEntityCategory').value || 'character';
      const aliases = document.getElementById('inputEntityAliases').value
        .split(',')
        .map(s => s.trim())
        .filter(Boolean);

      if (!name) {
        alert('Informe o nome do personagem, lugar ou termo.');
        return;
      }

      if (state.format === 'PDF' && state.sections[state.currentIndex] && state.sections[state.currentIndex].text === null) {
        await ensurePdfSectionText(state.sections[state.currentIndex]);
      }

      const map = getEntityNotesMap();
      const list = map[state.bookKey] || [];
      const existingId = document.getElementById('inputEntityId').value;
      const secTitle = state.sections[state.currentIndex] ? state.sections[state.currentIndex].title : `Seção ${state.currentIndex + 1}`;

      if (existingId) {
        const idx = list.findIndex(x => x.id === existingId);
        if (idx !== -1) {
          list[idx] = {
            ...list[idx],
            name,
            aliases,
            category,
            note,
            updatedAt: new Date().toLocaleDateString('pt-BR')
          };
        }
      } else {
        list.push({
          id: 'en_' + Date.now(),
          name,
          aliases,
          category,
          note,
          firstSectionIndex: state.currentIndex,
          firstChapterTitle: secTitle,
          updatedAt: new Date().toLocaleDateString('pt-BR')
        });
      }

      map[state.bookKey] = list;
      localStorage.setItem('reader_entity_notes', JSON.stringify(map));
      entityNoteModal.classList.remove('open');
      window.getSelection().removeAllRanges();
      await renderSection({ restoreSubPage: state.subPageIndex });
      showToast(`Nota salva! Sempre que "${name}" aparecer no livro, clique nele para ver sua anotação.`);
    });

    document.getElementById('btnPopEntityEdit').addEventListener('click', () => {
      if (activePopoverEntityId) openEntityNoteModal('', activePopoverEntityId);
    });

    document.getElementById('btnPopEntityDelete').addEventListener('click', async () => {
      if (!activePopoverEntityId || !state.bookKey) return;
      if (!confirm('Excluir esta nota de personagem/termo do livro?')) return;
      const map = getEntityNotesMap();
      map[state.bookKey] = (map[state.bookKey] || []).filter(x => x.id !== activePopoverEntityId);
      localStorage.setItem('reader_entity_notes', JSON.stringify(map));
      entityNotePopover.classList.remove('open');
      await renderSection({ restoreSubPage: state.subPageIndex });
      showToast('Nota removida.');
    });

    document.getElementById('btnPopEntitySearch').addEventListener('click', () => {
      if (!activePopoverEntityId || !state.bookKey) return;
      const list = getEntityNotesMap()[state.bookKey] || [];
      const ent = list.find(x => x.id === activePopoverEntityId);
      if (!ent) return;
      entityNotePopover.classList.remove('open');
      openSidebarTab('paneSearch');
      document.getElementById('selectSearchScope').value = 'book';
      dom.inputSearch.value = ent.name;
      runBookSearch();
    });

    function renderBookmarks() {
      if (!state.bookKey) return;
      const eList = getEntityNotesMap()[state.bookKey] || [];
      const bList = getBookmarksMap()[state.bookKey] || [];
      const hList = getHighlightsMap()[state.bookKey] || [];
      const isMarked = bList.some(b => b.index === state.currentIndex && (b.subPage || 0) === state.subPageIndex);
      document.getElementById('btnBookmark').classList.toggle('active', isMarked);

      if (!eList.length && !bList.length && !hList.length) {
        dom.bookmarksContainer.innerHTML = '<div style="padding:10px; color:var(--text-muted);">Nenhum personagem, nota ou marcador salvo neste livro. Selecione o nome de qualquer personagem no texto e clique em "+ Nota / Personagem"!</div>';
        return;
      }

      dom.bookmarksContainer.innerHTML = '';

      if (eList.length) {
        const hdr = document.createElement('div');
        hdr.style.cssText = 'font-size:11px; font-weight:700; color:var(--accent); padding:4px 6px; text-transform:uppercase;';
        hdr.textContent = `Personagens & Notas X-Ray (${eList.length})`;
        dom.bookmarksContainer.appendChild(hdr);

        eList.forEach((ent) => {
          const catInfo = categoryMeta[ent.category] || categoryMeta.character;
          const item = document.createElement('div');
          item.className = 'card-item';
          item.innerHTML = `
            <div class="search-item-title">
              <span>${escapeHtml(ent.name)} <small style="color:var(--text-muted); font-weight:400;">(${escapeHtml(catInfo.badge)})</small></span>
              <button class="card-del-btn" title="Editar nota">Editar</button>
            </div>
            <div style="font-size:12px; color:var(--text-primary); margin:3px 0; white-space:pre-wrap;">${escapeHtml((ent.note || '').slice(0, 140))}${(ent.note || '').length > 140 ? '…' : ''}</div>
            ${ent.aliases && ent.aliases.length ? `<div style="font-size:10.5px; color:var(--text-muted);">Apelidos: ${escapeHtml(ent.aliases.join(', '))}</div>` : ''}
          `;
          item.querySelector('.card-del-btn').addEventListener('click', (e) => {
            e.stopPropagation();
            openEntityNoteModal('', ent.id);
          });
          item.addEventListener('click', () => {
            showEntityNotePopover(ent.id, item);
          });
          dom.bookmarksContainer.appendChild(item);
        });
      }

      if (bList.length) {
        const hdr = document.createElement('div');
        hdr.style.cssText = 'font-size:11px; font-weight:600; color:var(--text-muted); padding:4px 6px; text-transform:uppercase;';
        hdr.textContent = `Páginas Marcadas (${bList.length})`;
        dom.bookmarksContainer.appendChild(hdr);

        bList.forEach((b, idx) => {
          const item = document.createElement('div');
          item.className = 'card-item';
          item.innerHTML = `
            <div class="search-item-title">
              <span>Seção ${b.index + 1}: ${escapeHtml(b.title)}</span>
              <button class="card-del-btn" title="Excluir marcador">✕</button>
            </div>
            <div style="font-size:11px; color:var(--text-muted);">Salvo em ${escapeHtml(b.date)}</div>
          `;
          item.querySelector('.card-del-btn').addEventListener('click', (e) => {
            e.stopPropagation();
            const map = getBookmarksMap();
            map[state.bookKey].splice(idx, 1);
            localStorage.setItem('reader_bookmarks', JSON.stringify(map));
            renderBookmarks();
          });
          item.addEventListener('click', () => {
            state.currentIndex = b.index;
            renderSection({ restoreSubPage: b.subPage || 0, restoreScrollRatio: b.scrollRatio || 0 });
          });
          dom.bookmarksContainer.appendChild(item);
        });
      }

      if (hList.length) {
        const hdr = document.createElement('div');
        hdr.style.cssText = 'font-size:11px; font-weight:600; color:var(--text-muted); padding:10px 6px 4px; text-transform:uppercase;';
        hdr.textContent = `Trechos Destacados (${hList.length})`;
        dom.bookmarksContainer.appendChild(hdr);

        hList.forEach((h) => {
          const item = document.createElement('div');
          item.className = 'card-item';
          item.innerHTML = `
            <div class="search-item-title">
              <span>${escapeHtml(h.chapterTitle || ('Seção ' + (h.sectionIndex + 1)))}</span>
              <button class="card-del-btn" title="Remover destaque">✕</button>
            </div>
            <div style="margin:3px 0;"><mark class="user-hl user-hl-${h.color || 'yellow'}">${escapeHtml(h.text.slice(0, 140))}${h.text.length > 140 ? '…' : ''}</mark></div>
          `;
          item.querySelector('.card-del-btn').addEventListener('click', (e) => {
            e.stopPropagation();
            removeHighlightById(h.id);
          });
          item.addEventListener('click', () => {
            state.currentIndex = h.sectionIndex;
            renderSection({ restoreSubPage: h.subPage || 0 });
          });
          dom.bookmarksContainer.appendChild(item);
        });
      }
    }

    async function runBookSearch() {
      const q = dom.inputSearch.value.trim();
      if (!q) return;
      const scopeEl = document.getElementById('selectSearchScope');
      const scope = scopeEl ? scopeEl.value : 'book';
      const qLower = q.toLowerCase();

      if (scope === 'shelf') {
        dom.searchContainer.innerHTML = '<div style="padding:8px;">Buscando em todos os livros da sua Estante...</div>';
        const books = await idbGetAllBooks();
        const hits = [];
        for (const b of books) {
          try {
            const ext = (b.fileName || '').split('.').pop().toLowerCase();
            let parsed = null;
            if (ext === 'epub') parsed = await parseEpub(b.buffer, b.fileName);
            else if (['mobi', 'azw', 'azw3', 'prc'].includes(ext)) parsed = await parseMobi(b.buffer, b.fileName);
            else if (ext === 'fb2') parsed = await parseFb2(b.buffer, b.fileName);
            else if (ext === 'md') parsed = parseMarkdown(b.buffer, b.fileName);
            if (!parsed || !parsed.sections) continue;
            for (let i = 0; i < parsed.sections.length; i++) {
              const sec = parsed.sections[i];
              const txt = sec.text || '';
              const idx = txt.toLowerCase().indexOf(qLower);
              if (idx !== -1) {
                const start = Math.max(0, idx - 35);
                hits.push({
                  book: b,
                  sectionIndex: i,
                  title: `${b.title} › ${sec.title}`,
                  snippet: txt.slice(start, idx + q.length + 55)
                });
                if (hits.length >= 80) break;
              }
            }
          } catch {}
          if (hits.length >= 80) break;
        }
        if (!hits.length) {
          dom.searchContainer.innerHTML = `<div style="padding:8px;">Nenhuma ocorrência encontrada na Estante para "${escapeHtml(q)}".</div>`;
          return;
        }
        dom.searchContainer.innerHTML = `<div style="padding:4px 8px; font-size:11px; color:var(--text-muted);">${hits.length} resultado(s) na Estante</div>`;
        hits.forEach(h => {
          const div = document.createElement('div');
          div.className = 'search-item';
          const safeQ = q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
          const highlightedSnippet = escapeHtml(h.snippet).replace(new RegExp(`(${safeQ})`, 'gi'), '<mark class="hl">$1</mark>');
          div.innerHTML = `<div class="search-item-title"><span>${escapeHtml(h.title)}</span><span>Cap. ${h.sectionIndex + 1}</span></div><div>…${highlightedSnippet}…</div>`;
          div.addEventListener('click', async () => {
            await loadFile({ name: h.book.fileName, size: h.book.size, buffer: h.book.buffer }, { skipIdbSave: true });
            state.currentIndex = h.sectionIndex;
            renderSection({ highlight: q });
          });
          dom.searchContainer.appendChild(div);
        });
        return;
      }

      if (!state.sections.length) return;
      dom.searchContainer.innerHTML = '<div style="padding:8px;">Buscando em todo o livro...</div>';

      const hits = [];
      for (let i = 0; i < state.sections.length; i++) {
        const sec = state.sections[i];
        if (state.format === 'PDF' && sec.text === null) {
          await ensurePdfSectionText(sec);
        }
        const txt = sec.text || '';
        const lowerTxt = txt.toLowerCase();
        let searchPos = 0;
        while (searchPos < lowerTxt.length) {
          const idx = lowerTxt.indexOf(qLower, searchPos);
          if (idx === -1) break;
          const start = Math.max(0, idx - 40);
          const snippet = txt.slice(start, idx + q.length + 60);
          hits.push({ sectionIndex: i, title: sec.title, snippet });
          searchPos = idx + Math.max(1, qLower.length);
          if (hits.length >= 100) break;
        }
        if (hits.length >= 100) break;
      }

      if (!hits.length) {
        dom.searchContainer.innerHTML = `<div style="padding:8px;">Nenhuma ocorrência encontrada para "${escapeHtml(q)}".</div>`;
        return;
      }

      dom.searchContainer.innerHTML = `<div style="padding:4px 8px; font-size:11px; color:var(--text-muted);">${hits.length} resultado(s) encontrado(s)</div>`;
      hits.forEach(h => {
        const div = document.createElement('div');
        div.className = 'search-item';
        const safeQ = q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const highlightedSnippet = escapeHtml(h.snippet).replace(new RegExp(`(${safeQ})`, 'gi'), '<mark class="hl">$1</mark>');
        div.innerHTML = `<div class="search-item-title"><span>${escapeHtml(h.title)}</span><span>Cap. ${h.sectionIndex + 1}</span></div><div>…${highlightedSnippet}…</div>`;
        div.addEventListener('click', () => {
          if (state.format === 'PDF') {
            state.pdfViewMode = 'reflow';
            dom.btnPdfViewMode.textContent = 'Modo Texto';
          }
          state.currentIndex = h.sectionIndex;
          renderSection({ highlight: q });
        });
        dom.searchContainer.appendChild(div);
      });
    }

    let autoSyncTimer = null;
    function saveProgress() {
      if (!state.bookKey || !state.sections.length) return;
      try {
        const maxScroll = Math.max(1, dom.viewport.scrollHeight - dom.viewport.clientHeight);
        const scrollRatio = dom.viewport.classList.contains('paginated-mode') ? 0 : (dom.viewport.scrollTop / maxScroll);
        const hist = JSON.parse(localStorage.getItem('reader_history') || '{}');
        hist[state.bookKey] = {
          title: state.title,
          author: state.author,
          format: state.format,
          currentIndex: state.currentIndex,
          subPageIndex: state.subPageIndex,
          scrollRatio: +scrollRatio.toFixed(4),
          total: state.sections.length,
          updatedAt: Date.now()
        };
        localStorage.setItem('reader_history', JSON.stringify(hist));

        const chkAuto = document.getElementById('chkAutoCloudSync');
        if (chkAuto && chkAuto.checked && typeof pushCloudSyncSilent === 'function') {
          clearTimeout(autoSyncTimer);
          autoSyncTimer = setTimeout(pushCloudSyncSilent, 2200);
        }
      } catch {}
    }

    function renderRecentHistory() {
      try {
        const hist = JSON.parse(localStorage.getItem('reader_history') || '{}');
        const items = Object.values(hist).sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 8);
        if (!items.length) {
          dom.recentBlock.classList.add('hidden');
          return;
        }
        dom.recentBlock.classList.remove('hidden');
        dom.recentTableBody.innerHTML = '';
        items.forEach(it => {
          const pct = Math.round(((it.currentIndex + 1) / Math.max(1, it.total)) * 100);
          const subLbl = it.subPageIndex ? ` · Pág. ${it.subPageIndex + 1}` : '';
          const tr = document.createElement('tr');
          tr.innerHTML = `
            <td style="font-weight:500; color:var(--text-primary);">${escapeHtml(it.title)}</td>
            <td>${escapeHtml(it.format)}</td>
            <td>Seção ${it.currentIndex + 1} de ${it.total}${subLbl} (${pct}%)</td>
          `;
          dom.recentTableBody.appendChild(tr);
        });
      } catch {}
    }

    /* =====================================================================
     * 7B. DICIONÁRIO, TRADUTOR E VOCABULÁRIO SALVO PARA O ANKI (.TSV / .CSV)
     * ===================================================================== */
    function getVocabList() {
      try { return JSON.parse(localStorage.getItem('reader_vocab_anki') || '[]'); }
      catch { return []; }
    }

    function saveVocabList(list) {
      localStorage.setItem('reader_vocab_anki', JSON.stringify(list));
      renderVocabList();
    }

    // --- Parser nativo para legendas .SRT e .VTT (agrupamento por cenas + timestamps clicáveis) ---
    function parseSrtTimestampSec(ts) {
      if (!ts) return 0;
      const clean = ts.trim().replace(',', '.');
      const parts = clean.split(':').map(Number);
      if (parts.some(isNaN)) return 0;
      if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
      if (parts.length === 2) return parts[0] * 60 + parts[1];
      return parts[0] || 0;
    }

    function formatSubTimeShort(sec) {
      const s = Math.max(0, Math.floor(sec || 0));
      const h = Math.floor(s / 3600);
      const m = Math.floor((s % 3600) / 60);
      const r = s % 60;
      return h > 0
        ? `${h}:${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}`
        : `${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}`;
    }

    function parseSubtitleText(input, fileName) {
      const raw = typeof input === 'string'
        ? input
        : new TextDecoder('utf-8', { fatal: false }).decode(input);
      const ext = (fileName || '').split('.').pop().toLowerCase();
      const title = (fileName || 'Legenda').replace(/\.[^.]+$/, '');
      const blocks = raw.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n').split(/\n\s*\n+/);
      const cues = [];
      for (const blk of blocks) {
        const lines = blk.split('\n').map(l => l.trim()).filter(Boolean);
        if (!lines.length || /^WEBVTT/i.test(lines[0]) || /^NOTE\b/i.test(lines[0])) continue;
        const tsIdx = lines.findIndex(l => /-->/.test(l));
        if (tsIdx === -1) continue;
        const m = lines[tsIdx].match(/([0-9:.]+,[0-9]+|[0-9:.]+)\s*-->\s*([0-9:.]+,[0-9]+|[0-9:.]+)/);
        if (!m) continue;
        const start = parseSrtTimestampSec(m[1]);
        const end = parseSrtTimestampSec(m[2]);
        const text = lines.slice(tsIdx + 1).join(' ')
          .replace(/<[^>]+>/g, '')
          .replace(/\{\\[^}]+\}/g, '')
          .replace(/\s+/g, ' ')
          .trim();
        if (text) cues.push({ start, end, text });
      }
      const sections = [];
      const toc = [];
      let curCues = [];
      const flushScene = () => {
        if (!curCues.length) return;
        const idx = sections.length + 1;
        const startStr = formatSubTimeShort(curCues[0].start);
        const secTitle = `Cena ${idx} (${startStr})`;
        const html = `<div class="book-chapter"><h2>${escapeHtml(secTitle)}</h2>` +
          curCues.map(c => `<p class="sub-cue" data-start="${c.start.toFixed(2)}" data-end="${c.end.toFixed(2)}"><span class="sub-ts">[${formatSubTimeShort(c.start)}]</span>${escapeHtml(c.text)}</p>`).join('') +
          `</div>`;
        sections.push({ title: secTitle, html, text: curCues.map(c => c.text).join('\n') });
        toc.push({ label: secTitle, sectionIndex: sections.length - 1, depth: 0 });
        curCues = [];
      };
      for (let i = 0; i < cues.length; i++) {
        const c = cues[i];
        const prev = curCues[curCues.length - 1];
        if (prev && ((c.start - prev.end) > 45 || curCues.length >= 80)) {
          flushScene();
        }
        curCues.push(c);
      }
      flushScene();
      if (!sections.length) {
        sections.push({ title: 'Legenda', html: '<p>Nenhuma fala encontrada no arquivo.</p>', text: '' });
        toc.push({ label: 'Início', sectionIndex: 0, depth: 0 });
      }
      return {
        title,
        author: 'Legenda / Episódio',
        format: ext === 'vtt' ? 'VTT' : 'SRT',
        sections,
        toc
      };
    }

    // --- Renderizador leve de fórmulas LaTeX ($...$ e $$...$$) 100% offline ---
    function formatLatexExprLightweight(expr) {
      let s = String(expr || '').trim();
      const map = {
        '\\alpha': 'α', '\\beta': 'β', '\\gamma': 'γ', '\\delta': 'δ', '\\epsilon': 'ε',
        '\\theta': 'θ', '\\lambda': 'λ', '\\mu': 'μ', '\\pi': 'π', '\\sigma': 'σ',
        '\\phi': 'φ', '\\omega': 'ω', '\\Delta': 'Δ', '\\Sigma': 'Σ', '\\Omega': 'Ω',
        '\\sum': '∑', '\\int': '∫', '\\infty': '∞', '\\cdot': '·', '\\times': '×',
        '\\div': '÷', '\\pm': '±', '\\leq': '≤', '\\le': '≤', '\\geq': '≥', '\\ge': '≥',
        '\\neq': '≠', '\\approx': '≈', '\\to': '→', '\\rightarrow': '→', '\\leftarrow': '←',
        '\\sqrt': '√'
      };
      s = s.replace(/\\frac\{([^}]+)\}\{([^}]+)\}/g, '($1)/($2)');
      Object.keys(map).forEach(k => { s = s.split(k).join(map[k]); });
      s = s.replace(/\^\{([^}]+)\}/g, '<sup>$1</sup>').replace(/\^([a-zA-Z0-9])/g, '<sup>$1</sup>');
      s = s.replace(/_\{([^}]+)\}/g, '<sub>$1</sub>').replace(/_([a-zA-Z0-9])/g, '<sub>$1</sub>');
      return s;
    }

    function renderLightweightMathHtml(html) {
      if (!html || !html.includes('$')) return html;
      return html.replace(/(<code[\s\S]*?<\/code>|<pre[\s\S]*?<\/pre>|<[^>]+>)|\$\$([\s\S]+?)\$\$|\$([^$\n]{1,160})\$/g, (m, tag, blockExpr, inlineExpr) => {
        if (tag) return tag;
        if (blockExpr !== undefined) return `<div class="math-block">${formatLatexExprLightweight(blockExpr)}</div>`;
        if (inlineExpr !== undefined) return `<span class="math-inline">${formatLatexExprLightweight(inlineExpr)}</span>`;
        return m;
      });
    }

    // --- Algoritmo SM-2 simplificado para Revisão Espaçada (Anki Interno) ---
    function computeNextSrsCardState(card, rating) {
      const now = Date.now();
      const dayMs = 86400000;
      const prevEase = Number(card && card.ease) || 2.5;
      const prevInterval = Number(card && card.intervalDays) || 0;
      const prevReps = Number(card && card.reps) || 0;
      let ease = prevEase;
      let intervalDays = 1;
      let reps = prevReps;
      if (rating === 'again') {
        reps = 0;
        intervalDays = 1;
        ease = Math.max(1.3, +(prevEase - 0.2).toFixed(2));
      } else if (rating === 'hard') {
        reps = prevReps + 1;
        intervalDays = Math.max(1, Math.round((prevInterval || 1) * 1.2));
        ease = Math.max(1.3, +(prevEase - 0.15).toFixed(2));
      } else if (rating === 'good') {
        reps = prevReps + 1;
        if (prevReps === 0) intervalDays = 1;
        else if (prevReps === 1) intervalDays = 3;
        else intervalDays = Math.max(3, Math.round(prevInterval * prevEase));
      } else if (rating === 'easy') {
        reps = prevReps + 1;
        ease = +(prevEase + 0.15).toFixed(2);
        intervalDays = prevReps === 0 ? 4 : Math.max(5, Math.round((prevInterval || 2) * ease * 1.3));
      }
      return {
        ...(card || {}),
        ease,
        intervalDays,
        reps,
        lastReviewedAt: now,
        dueAt: now + intervalDays * dayMs
      };
    }

    // --- Pré-carregamento em segundo plano do próximo capítulo de série ---
    window.__prefetchedSeriesChapters = window.__prefetchedSeriesChapters || new Map();
    async function prefetchNextSeriesChapter() {
      try {
        if (!state.autoPrefetchChapters) return;
        const dataSaver = document.getElementById('chkOpdsDataSaver');
        if (dataSaver && dataSaver.checked) return;
        if (!state.seriesQueue || !Array.isArray(state.seriesQueue.items)) return;
        const nextIdx = state.seriesQueue.index + 1;
        const nextItem = state.seriesQueue.items[nextIdx];
        if (!nextItem || !nextItem.id) return;
        const cacheKey = String(nextItem.source || '') + ':' + String(nextItem.id);
        if (window.__prefetchedSeriesChapters.has(cacheKey)) return;
        window.__prefetchedSeriesChapters.set(cacheKey, { status: 'loading' });
        if (nextItem.source === 'mangadex' && typeof fetchMangadexChapterBlob === 'function') {
          const res = await fetchMangadexChapterBlob(nextItem.id, nextItem.title || 'Cap').catch(() => null);
          if (res && res.blob) {
            window.__prefetchedSeriesChapters.set(cacheKey, { status: 'ready', blob: res.blob, fileName: res.fileName });
            return;
          }
        }
        window.__prefetchedSeriesChapters.delete(cacheKey);
      } catch {}
    }

    function renderVocabList() {
      const list = getVocabList();
      if (!list.length) {
        dom.vocabContainer.innerHTML = '<div style="padding:8px; color:var(--text-muted);">Nenhuma palavra ou frase salva ainda. Selecione qualquer trecho no livro para consultar o dicionário, traduzir ou adicionar direto ao Anki.</div>';
        return;
      }
      dom.vocabContainer.innerHTML = `<div style="padding:2px 6px 6px; font-size:11px; color:var(--text-muted);">${list.length} cartão(ões) salvos</div>`;
      list.slice().reverse().forEach((card) => {
        const div = document.createElement('div');
        div.className = 'card-item';
        const statusBadge = card.syncedToAnki
          ? `<span style="font-size:10px; color:var(--accent); font-weight:600;">No Anki</span>`
          : `<button class="tb-btn tb-btn-solid btn-push-single-anki" style="height:20px; font-size:10px; padding:0 6px;">Enviar p/ Anki</button>`;
        div.innerHTML = `
          <div class="search-item-title">
            <span>${escapeHtml(card.front)}</span>
            <div style="display:flex; gap:4px; align-items:center;">
              ${statusBadge}
              <button class="card-del-btn" title="Excluir cartão">✕</button>
            </div>
          </div>
          <div style="color:var(--text-primary); margin-bottom:3px;">${escapeHtml(card.back || '(Sem tradução/nota)')}</div>
          ${card.context ? `<div style="font-size:11px; color:var(--text-muted); font-style:italic;">"${escapeHtml(card.context.slice(0, 120))}"</div>` : ''}
          <div style="font-size:10.5px; color:var(--text-muted); margin-top:2px;">${escapeHtml(card.book || '')}</div>
        `;
        const pushBtn = div.querySelector('.btn-push-single-anki');
        if (pushBtn) {
          pushBtn.addEventListener('click', async (e) => {
            e.stopPropagation();
            if (typeof sendSingleCardToAnki === 'function') {
              await sendSingleCardToAnki(card);
            }
          });
        }
        div.querySelector('.card-del-btn').addEventListener('click', (e) => {
          e.stopPropagation();
          const filtered = getVocabList().filter(c => c.id !== card.id);
          saveVocabList(filtered);
        });
        div.addEventListener('click', () => {
          dom.inputAnkiFront.value = card.front;
          dom.inputAnkiBack.value = card.back || '';
          dom.inputAnkiContext.value = card.context || '';
          dom.modalStatus.textContent = 'Editando cartão salvo';
          dom.lookupModal.classList.add('open');
        });
        dom.vocabContainer.appendChild(div);
      });
    }

    function exportVocabForAnkiTsv() {
      const list = getVocabList();
      if (!list.length) {
        alert('Salve ao menos uma palavra ou frase antes de exportar para o Anki.');
        return;
      }
      // Cabeçalho padrão reconhecido automaticamente pelo Anki 2.1.54+
      const lines = [
        '#separator:tab',
        '#html:true',
        '#columns:Frente\tVerso\tTags'
      ];
      for (const c of list) {
        const cleanFront = (c.front || '').replace(/[\t\r\n]+/g, ' ').trim();
        const cleanContext = (c.context || '').replace(/[\t\r\n]+/g, ' ').trim();
        const cleanBack = (c.back || '').replace(/\r?\n/g, '<br>').replace(/\t/g, ' ').trim();
        const cleanBook = (c.book || 'Leitor').replace(/[\t\r\n]+/g, ' ').trim();

        const ankiFront = cleanContext
          ? `<b>${escapeHtml(cleanFront)}</b><br><br><small style="color:#666;"><i>"${escapeHtml(cleanContext)}"</i></small>`
          : `<b>${escapeHtml(cleanFront)}</b>`;
        const ankiBack = `${cleanBack || escapeHtml(cleanFront)}<br><small style="color:#888;">Fonte: ${escapeHtml(cleanBook)}</small>`;
        const tag = cleanBook.replace(/[^a-zA-Z0-9À-ÿ]+/g, '_').replace(/^_|_$/g, '') || 'Leitura';
        lines.push(`${ankiFront}\t${ankiBack}\t${tag}`);
      }
      const blob = new Blob(['\uFEFF' + lines.join('\n')], { type: 'text/tab-separated-values;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `anki_vocabulario_${new Date().toISOString().slice(0, 10)}.tsv`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 2000);
      showToast('Arquivo .TSV do Anki baixado! No Anki, clique em Arquivo → Importar.');
    }

    function exportVocabCsv() {
      const list = getVocabList();
      if (!list.length) {
        alert('Nenhuma palavra ou frase salva para exportar.');
        return;
      }
      const csvEsc = (s) => `"${String(s || '').replace(/"/g, '""')}"`;
      const rows = [
        ['Frente (Palavra/Frase)', 'Verso (Significado/Tradução)', 'Contexto no Livro', 'Livro', 'Data'].map(csvEsc).join(',')
      ];
      for (const c of list) {
        rows.push([c.front, c.back, c.context, c.book, c.date].map(csvEsc).join(','));
      }
      const blob = new Blob(['\uFEFF' + rows.join('\r\n')], { type: 'text/csv;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `vocabulario_${new Date().toISOString().slice(0, 10)}.csv`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 2000);
    }

    // Detectar seleção de texto no PC (mouseup) e no Celular (touchend / selectionchange)
    let selCheckTimer = null;
    function handleReaderTextSelection(e) {
      if (e && e.target && (dom.selectionToolbar.contains(e.target) || dom.lookupModal.contains(e.target))) return;
      clearTimeout(selCheckTimer);
      selCheckTimer = setTimeout(() => {
        const sel = window.getSelection();
        const text = sel ? sel.toString().trim() : '';
        const anchorInReader = sel && sel.anchorNode && (dom.readerFlow.contains(sel.anchorNode) || dom.pdfContainer.contains(sel.anchorNode));
        const isCJK = /[\u4e00-\u9fff\u3400-\u4dbf\u3040-\u30ff\uac00-\ud7af]/.test(text);
        if (!text || (!isCJK && text.length < 2) || !anchorInReader) {
          dom.selectionToolbar.classList.remove('open');
          return;
        }
        state.selectedText = text.slice(0, 400);

        let contextSentence = '';
        try {
          const baseEl = sel.anchorNode.nodeType === 3 ? sel.anchorNode.parentElement : sel.anchorNode;
          const blockEl = baseEl.closest('p, li, blockquote, td, .pdf-text-layer') || baseEl;
          if (blockEl) {
            const fullPara = blockEl.textContent.replace(/\s+/g, ' ').trim();
            const sentences = fullPara.match(/[^.!?]+[.!?]+|[^.!?]+$/g) || [fullPara];
            const found = sentences.find(s => s.includes(state.selectedText.slice(0, 25)));
            contextSentence = (found || fullPara).trim().slice(0, 320);
          }
        } catch {}
        state.selectedContext = contextSentence;

        const qBadge = document.getElementById('selectionQuickTransBadge');
        if (qBadge) {
          const wc = state.selectedText.split(/\s+/).filter(Boolean).length;
          if (wc >= 1 && wc <= 4 && state.selectedText.length <= 42) {
            qBadge.textContent = 'Traduzindo...';
            qBadge.classList.remove('hidden');
            const targetWord = state.selectedText;
            fetch(`https://api.mymemory.translated.net/get?q=${encodeURIComponent(targetWord)}&langpair=en|pt-BR`)
              .then(r => r.json())
              .then(d => {
                if (state.selectedText === targetWord && d && d.responseData && d.responseData.translatedText) {
                  qBadge.textContent = `→ ${d.responseData.translatedText}`;
                }
              })
              .catch(() => { qBadge.classList.add('hidden'); });
          } else {
            qBadge.classList.add('hidden');
          }
        }
        dom.selectionToolbar.classList.add('open');
        if (window.innerWidth > 768 && sel.rangeCount > 0) {
          const range = sel.getRangeAt(0);
          const rect = range.getBoundingClientRect();
          const tbWidth = dom.selectionToolbar.offsetWidth || 310;
          const left = Math.max(10, Math.min(window.innerWidth - tbWidth - 10, rect.left + rect.width / 2 - tbWidth / 2));
          const top = Math.max(50, rect.top - 42);
          dom.selectionToolbar.style.left = `${Math.round(left)}px`;
          dom.selectionToolbar.style.top = `${Math.round(top)}px`;
        }
      }, 35);
    }

    document.addEventListener('mouseup', handleReaderTextSelection);
    document.addEventListener('touchend', handleReaderTextSelection, { passive: true });
    document.addEventListener('selectionchange', () => {
      if (window.innerWidth <= 768) handleReaderTextSelection(null);
    });

    async function fetchDictionaryDefinition(wordText) {
      const cleanWord = wordText.trim().split(/\s+/)[0].replace(/[.,!?;:"'()[\]{}«»“”]/g, '');
      if (!cleanWord) return;
      dom.modalStatus.textContent = `Consultando dicionário para "${cleanWord}"...`;
      const results = [];

      // 1. Tentar Dicionário Português (dicionario-aberto) e Inglês (dictionaryapi.dev) em paralelo
      try {
        const resPt = await fetch(`https://api.dicionario-aberto.net/word/${encodeURIComponent(cleanWord.toLowerCase())}`);
        if (resPt.ok) {
          const dataPt = await resPt.json();
          if (Array.isArray(dataPt) && dataPt.length && dataPt[0].xml) {
            const xmlDoc = new DOMParser().parseFromString(dataPt[0].xml, 'text/xml');
            const defs = Array.from(xmlDoc.getElementsByTagName('def')).map(d => d.textContent.replace(/\s+/g, ' ').trim()).filter(Boolean);
            if (defs.length) results.push(`[PT] ${defs.slice(0, 3).join(' | ')}`);
          }
        }
      } catch {}

      try {
        const resEn = await fetch(`https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(cleanWord.toLowerCase())}`);
        if (resEn.ok) {
          const dataEn = await resEn.json();
          if (Array.isArray(dataEn) && dataEn[0] && dataEn[0].meanings) {
            const defs = [];
            for (const m of dataEn[0].meanings.slice(0, 2)) {
              const d0 = m.definitions && m.definitions[0] ? m.definitions[0].definition : '';
              if (d0) defs.push(`(${m.partOfSpeech}) ${d0}`);
            }
            if (defs.length) results.push(`[EN] ${defs.join(' | ')}`);
          }
        }
      } catch {}

      if (results.length) {
        dom.inputAnkiBack.value = results.join('\n');
        dom.modalStatus.textContent = 'Definição encontrada no dicionário.';
      } else {
        // Fallback: buscar tradução automática se for frase ou palavra flexionada
        await fetchTranslation(wordText);
      }
    }

    async function fetchTranslation(textToTranslate) {
      if (!textToTranslate) return;
      const targetLang = dom.selectTargetLang.value || 'pt';
      dom.modalStatus.textContent = 'Traduzindo e analisando fonética...';
      try {
        const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=${encodeURIComponent(targetLang)}&dt=t&dt=bd&dt=rm&q=${encodeURIComponent(textToTranslate)}`;
        const res = await fetch(url);
        if (res.ok) {
          const data = await res.json();
          const translated = Array.isArray(data[0]) ? data[0].map(part => (part && part[0]) ? part[0] : '').join('') : '';
          let transliteration = '';
          if (Array.isArray(data[0])) {
            for (const part of data[0]) {
              if (part && typeof part[2] === 'string' && part[2].trim()) transliteration = part[2].trim();
              if (part && typeof part[3] === 'string' && part[3].trim()) transliteration = part[3].trim();
            }
          }
          let dictExtra = '';
          if (Array.isArray(data[1])) {
            dictExtra = data[1].map(entry => `${entry[0]}: ${(entry[1] || []).slice(0, 5).join(', ')}`).join('\n');
          }
          let finalBack = translated;
          if (transliteration) {
            finalBack = `🗣 Pronúncia / Fonética: [ ${transliteration} ]\n\n📖 Tradução: ${translated}`;
          }
          if (dictExtra) {
            finalBack += `\n\n${dictExtra}`;
          }
          if (finalBack) {
            dom.inputAnkiBack.value = finalBack;
            dom.modalStatus.textContent = transliteration ? 'Tradução e fonética CJK concluídas.' : 'Tradução concluída.';
            return;
          }
        }
      } catch {}

      dom.modalStatus.textContent = 'Sem conexão com a API — use os botões externos abaixo ou digite a nota manualmente.';
    }

    function openLookupModal(mode) {
      dom.selectionToolbar.classList.remove('open');
      dom.inputAnkiFront.value = state.selectedText || '';
      dom.inputAnkiBack.value = '';
      let ctx = state.selectedContext || '';
      if (ctx && state.selectedText && !ctx.includes('<b>')) {
        try {
          const escaped = state.selectedText.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
          ctx = ctx.replace(new RegExp(escaped, 'i'), `<b>${state.selectedText}</b>`);
        } catch {}
      }
      dom.inputAnkiContext.value = ctx;
      dom.lookupModal.classList.add('open');
      if (mode === 'dict' && state.selectedText) {
        fetchDictionaryDefinition(state.selectedText);
      } else if (mode === 'trans' && state.selectedText) {
        fetchTranslation(state.selectedText);
      } else if (state.selectedText) {
        fetchTranslation(state.selectedText);
      }
    }

