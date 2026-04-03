/**
 * reader.js — Vista de Lectura
 * Responsabilidades: renderizar ePub con epub.js, navegación,
 * ajustes de visualización, guardar progreso, acceso al editor.
 */

import { db, STORES } from './db.js';

// ─── Constantes ────────────────────────────────────────────────────────────

const THEMES = {
  dark:   { bg: '#0f0e0c', fg: '#e8e0d0', link: '#c9a96e' },
  light:  { bg: '#faf8f4', fg: '#2c2520', link: '#8b5e2a' },
  sepia:  { bg: '#f4ede0', fg: '#3d2b1f', link: '#7a4f2d' },
};

const FONTS = [
  { id: 'georgia',   label: 'Georgia',      css: 'Georgia, serif' },
  { id: 'palatino',  label: 'Palatino',     css: '"Palatino Linotype", Palatino, serif' },
  { id: 'merriweather', label: 'Merriweather', css: "'Merriweather', serif" },
  { id: 'literata',  label: 'Literata',     css: "'Literata', serif" },
  { id: 'sans',      label: 'Sans-serif',   css: "'Lato', sans-serif" },
];

const ALIGNMENTS = [
  { id: 'original', label: 'Original' },
  { id: 'justify',  label: 'Justificado' },
  { id: 'left',     label: 'Izquierda' },
  { id: 'right',    label: 'Derecha' },
];

// ─── ReaderView ────────────────────────────────────────────────────────────

export class ReaderView {
  #container;
  #onBack;
  #onEdit;
  #bookId;
  #book;          // epub.js Book
  #rendition;     // epub.js Rendition
  #bookData;      // record de IndexedDB
  #toc = [];
  #settings = { fontSize: 18, fontId: 'georgia', theme: 'dark', lineHeight: 1.7, textAlign: 'original' };
  #saveTimer = null;
  #currentCfi = null;
  #currentChapterHref = null;

  constructor(container, { onBack, onEdit }) {
    this.#container = container;
    this.#onBack    = onBack;
    this.#onEdit    = onEdit;
  }

  // ── Ciclo de vida ────────────────────────────────────────────────────────

  async mount(bookId) {
    try {
      this.#bookId   = bookId;
      this.#bookData = await db.get(STORES.BOOKS, bookId);
      
      if (!this.#bookData) {
        throw new Error('El libro seleccionado no se encuentra en la base de datos.');
      }

      await this.#loadSettings();
      this.#renderShell();
      await this.#initEpub();
      this.#bindEvents();
    } catch (err) {
      console.error('[Reader] Error mounting:', err);
      // Intentar mostrar el error en el UI si el shell se cargó, sino usar alert
      const toast = this.#container.querySelector('#toast');
      if (toast) {
        this.#showToast(err.message);
      } else {
        alert(`Error al abrir el libro: ${err.message}`);
      }
      // Pequeña pausa para que el usuario vea el error antes de volver
      setTimeout(() => this.#onBack(), 2500);
    }
  }

  async unmount() {
    clearTimeout(this.#saveTimer);
    document.removeEventListener('keydown', this.#handleKey);
    await this.#saveProgress();
    this.#rendition?.destroy();
    this.#book?.destroy();
    this.#container.innerHTML = '';
  }

  // ── Shell HTML ───────────────────────────────────────────────────────────

  #renderShell() {
    const t = this.#settings.theme;
    this.#container.innerHTML = `
      <div class="reader-view theme-${t}" id="readerRoot">

        <!-- Top bar -->
        <header class="reader-header" id="readerHeader">
          <button class="btn-icon" id="backBtn" aria-label="Volver a la biblioteca">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M19 12H5M12 5l-7 7 7 7"/>
            </svg>
          </button>
          <div class="reader-header__title">
            <span class="reader-title" id="chapterTitle">${this.#bookData.title}</span>
          </div>
          <div class="reader-header__actions">
            <button class="btn-icon" id="tocBtn" aria-label="Tabla de contenidos">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <line x1="3" y1="6"  x2="21" y2="6"/>
                <line x1="3" y1="12" x2="17" y2="12"/>
                <line x1="3" y1="18" x2="13" y2="18"/>
              </svg>
            </button>
            <button class="btn-icon" id="settingsBtn" aria-label="Ajustes de lectura">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <circle cx="12" cy="12" r="3"/>
                <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>
              </svg>
            </button>
            <button class="btn-icon" id="downloadBtn" aria-label="Descargar libro" title="Descargar ePub">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>
              </svg>
            </button>
            <button class="btn-edit" id="editBtn" aria-label="Editar capítulo">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
                <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
              </svg>
              Editar
            </button>
          </div>
        </header>

        <!-- Área de lectura -->
        <div class="reader-area">
          <!-- Zonas invisibles de navegación -->
          <div class="reader-nav-zone reader-nav-zone--prev" id="prevZone" title="Capítulo/Página anterior"></div>
          <div class="reader-nav-zone reader-nav-zone--next" id="nextZone" title="Capítulo/Página siguiente"></div>

          <!-- Visor epub.js -->
          <div class="epub-viewer" id="epubViewer">
            <div class="loading-epub" id="loadingEpub">
              <div class="spinner"></div>
              <span>Cargando libro…</span>
            </div>
          </div>
        </div>

        <!-- Barra inferior con progreso -->
        <footer class="reader-footer" id="readerFooter">
          <span class="reader-footer__progress" id="progressLabel">0%</span>
          <div class="reader-footer__bar">
            <div class="reader-footer__fill" id="progressFill" style="width:0%"></div>
          </div>
          <span class="reader-footer__loc" id="locationLabel">—</span>
        </footer>

        <!-- Panel TOC (oculto) -->
        <aside class="toc-panel hidden" id="tocPanel" aria-label="Tabla de contenidos">
          <div class="toc-panel__header">
            <h2>Contenido</h2>
            <button class="btn-icon" id="closeTocBtn" aria-label="Cerrar">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
              </svg>
            </button>
          </div>
          <ul class="toc-list" id="tocList"></ul>
        </aside>

        <!-- Panel de ajustes (oculto) -->
        <div class="settings-panel hidden" id="settingsPanel">
          <div class="settings-panel__header">
            <h2>Ajustes de lectura</h2>
            <button class="btn-icon" id="closeSettingsBtn" aria-label="Cerrar">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
              </svg>
            </button>
          </div>

          <section class="settings-section">
            <label class="settings-label">Tamaño de texto</label>
            <div class="font-size-ctrl">
              <button class="btn-icon" id="fontDecBtn" aria-label="Reducir texto">A−</button>
              <span id="fontSizeVal">${this.#settings.fontSize}px</span>
              <button class="btn-icon" id="fontIncBtn" aria-label="Aumentar texto">A+</button>
            </div>
          </section>

          <section class="settings-section">
            <label class="settings-label">Fuente</label>
            <div class="font-selector" id="fontSelector">
              ${FONTS.map(f => `
                <button class="font-btn ${f.id === this.#settings.fontId ? 'active' : ''}"
                        data-font="${f.id}" style="font-family:${f.css}">${f.label}</button>
              `).join('')}
            </div>
          </section>

          <section class="settings-section">
            <label class="settings-label">Tema</label>
            <div class="theme-selector" id="themeSelector">
              ${Object.keys(THEMES).map(t => `
                <button class="theme-btn ${t === this.#settings.theme ? 'active' : ''}"
                        data-theme="${t}"
                        style="background:${THEMES[t].bg}; color:${THEMES[t].fg}">
                  ${t.charAt(0).toUpperCase() + t.slice(1)}
                </button>
              `).join('')}
            </div>
          </section>

          <section class="settings-section">
            <label class="settings-label">Alineación de texto</label>
            <div class="align-ctrl" id="alignSelector">
              ${ALIGNMENTS.map(a => `
                <button class="align-btn ${a.id === this.#settings.textAlign ? 'active' : ''}"
                        data-align="${a.id}">${a.label}</button>
              `).join('')}
            </div>
          </section>

          <section class="settings-section">
            <label class="settings-label">Interlineado</label>
            <div class="line-height-ctrl">
              ${[1.4, 1.7, 2.0, 2.3].map(v => `
                <button class="lh-btn ${v === this.#settings.lineHeight ? 'active' : ''}" data-lh="${v}">${v}</button>
              `).join('')}
            </div>
          </section>
        </div>

        <!-- Overlay para cerrar paneles -->
        <div class="panel-overlay hidden" id="panelOverlay"></div>

        <!-- Toast de errores/info -->
        <div class="toast" id="toast" role="alert" aria-live="polite"></div>
      </div>
    `;
  }

  #showToast(msg, type = 'error') {
    const toast = this.#container.querySelector('#toast');
    if (!toast) { console.error('[Reader] No toast element found'); return; }
    toast.textContent = msg;
    toast.className   = `toast toast--${type} toast--visible`;
    setTimeout(() => toast.classList.remove('toast--visible'), 3000);
  }

  // ── Inicializar epub.js ──────────────────────────────────────────────────

  async #initEpub() {
    // 1. Verificar dependencias globales
    if (typeof ePub === 'undefined') {
      throw new Error('La librería de lectura (epub.js) no se ha cargado correctamente.');
    }
    if (typeof JSZip === 'undefined') {
      throw new Error('La librería de archivos (JSZip) no se ha cargado correctamente.');
    }

    const viewerEl = this.#container.querySelector('#epubViewer');

    try {
      // Obtener archivo desde IndexedDB, aplicar edits si existen
      let arrayBuffer = this.#bookData.file;

      if (!arrayBuffer || arrayBuffer.byteLength === 0) {
        throw new Error('El archivo del libro está vacío o corrupto.');
      }

      arrayBuffer = await this.#applyEdits(arrayBuffer);

      this.#book = ePub(arrayBuffer);

      this.#rendition = this.#book.renderTo(viewerEl, {
        width:    '100%',
        height:   '100%',
        flow:     'scrolled',
        manager:  'default',
      });

      // Esperar a que el libro sea procesado (con timeout de 15s)
      await Promise.race([
        this.#book.ready,
        new Promise((_, reject) => setTimeout(() => reject(new Error('Tiempo de espera agotado al cargar el ePub')), 15000))
      ]);

      // Aplicar tema y tipografía
      this.#applyTheme();

      // Cargar progreso guardado
      const progress = await db.get(STORES.PROGRESS, this.#bookId);
      const startCfi = progress?.cfi || null;

      try {
        if (startCfi) {
          await this.#rendition.display(startCfi);
        } else {
          await this.#rendition.display();
        }
      } catch (err) {
        console.warn('[Reader] Error en display inicial:', err);
        await this.#rendition.display(); // Fallback al inicio
      }

      // TOC
      try {
        const nav = await this.#book.loaded.navigation;
        this.#toc = nav?.toc || [];
        this.#renderToc();
      } catch (err) {
        console.warn('[Reader] Error cargando TOC:', err);
      }

      // Generar localizaciones para el progreso (segundo plano)
      this.#book.ready.then(() => {
        this.#book.locations.generate(1024).catch(() => {});
      });

      // Eventos del rendition
      this.#rendition.on('rendered', (section) => {
        this.#currentChapterHref = section.href;
        this.#updateChapterTitle(section.href);
      });

      this.#rendition.on('relocated', (location) => {
        this.#currentCfi = location.start.cfi;
        this.#updateProgress(location);
        this.#scheduleSave();
      });

    } finally {
      // Quitar el loader siempre al finalizar (éxito o error)
      this.#container.querySelector('#loadingEpub')?.remove();
    }
  }

  /** Aplica los edits guardados al ArrayBuffer del epub */
  async #applyEdits(originalBuffer) {
    const edits = await db.getAllByIndex(STORES.EDITS, 'bookId', this.#bookId);
    if (!edits.length) return originalBuffer;

    const zip = await JSZip.loadAsync(originalBuffer);

    for (const edit of edits) {
      // Buscar el archivo del capítulo en el zip
      const file = zip.file(edit.chapterHref)
        || Object.values(zip.files).find(f => f.name.endsWith(edit.chapterHref));
      
      if (file) {
        let finalContent = edit.content;
        
        // Si el contenido guardado es solo un fragmento (no tiene etiqueta body),
        // debemos integrarlo en el documento original para mantener la validez del XML
        if (!finalContent.includes('<body') && !finalContent.includes('<html')) {
          const original = await file.async('string');
          finalContent = original.replace(/(<body[^>]*>)([\s\S]*?)(<\/body>)/i, `$1${finalContent}$3`);
        }
        
        zip.file(file.name, finalContent);
      }
    }

    return await zip.generateAsync({ type: 'arraybuffer' });
  }

  // ── Aplicar estilos al rendition ─────────────────────────────────────────

  #applyTheme() {
    if (!this.#rendition) return;
    const theme = THEMES[this.#settings.theme];
    const font  = FONTS.find(f => f.id === this.#settings.fontId) || FONTS[0];

    const styles = {
      body: {
        'background-color': `${theme.bg} !important`,
        'color':            `${theme.fg} !important`,
        'font-family':      `${font.css} !important`,
        'font-size':        `${this.#settings.fontSize}px !important`,
        'line-height':      `${this.#settings.lineHeight} !important`,
        'max-width':        '800px !important',
        'margin':           '0 auto !important',
        'padding':          '2rem 2rem 8rem !important',
      },
      'a': { 'color': `${theme.link} !important` },
      'p, div, span, li, h1, h2, h3, h4, h5, h6': { 
        'color':         `${theme.fg} !important`,
        'line-height':   'inherit !important'
      },
      'p': { 
        'margin-bottom': '0.9em !important'
      },
    };

    // Aplicar alineación explícitamente a body y p para mayor especificidad
    const alignValue = this.#settings.textAlign === 'original' 
      ? 'initial' 
      : this.#settings.textAlign;

    styles.body['text-align'] = `${alignValue} !important`;
    styles['p']['text-align']  = `${alignValue} !important`;

    this.#rendition.themes.default(styles);

    // Actualizar tema del root
    const root = this.#container.querySelector('#readerRoot');
    if (root) {
      root.className = root.className.replace(/theme-\w+/, `theme-${this.#settings.theme}`);
    }
  }

  // ── TOC ──────────────────────────────────────────────────────────────────

  #renderToc() {
    const list = this.#container.querySelector('#tocList');
    if (!list || !this.#toc.length) {
      list.innerHTML = '<li class="toc-empty">Sin índice disponible</li>';
      return;
    }

    list.innerHTML = this.#toc.map(item => this.#tocItemHtml(item, 0)).join('');

    list.querySelectorAll('[data-href]').forEach(link => {
      link.addEventListener('click', () => {
        this.#rendition.display(link.dataset.href);
        this.#closePanels();
      });
    });
  }

  #tocItemHtml(item, depth) {
    const indent  = depth * 16;
    const childrenHtml = (item.subitems || []).map(c => this.#tocItemHtml(c, depth + 1)).join('');
    return `
      <li class="toc-item" style="padding-left:${indent}px">
        <button data-href="${item.href}" class="toc-link">${item.label?.trim() || '—'}</button>
        ${childrenHtml ? `<ul>${childrenHtml}</ul>` : ''}
      </li>`;
  }

  #updateChapterTitle(href) {
    const match = this.#findTocItem(this.#toc, href);
    const el    = this.#container.querySelector('#chapterTitle');
    if (el && match) el.textContent = match.label?.trim() || this.#bookData.title;
  }

  #findTocItem(items, href) {
    for (const item of items) {
      if (item.href?.includes(href) || href?.includes(item.href)) return item;
      const sub = this.#findTocItem(item.subitems || [], href);
      if (sub) return sub;
    }
    return null;
  }

  // ── Progreso ─────────────────────────────────────────────────────────────

  #updateProgress(location) {
    const pct  = this.#book.locations.percentageFromCfi(location.start.cfi) * 100;
    const fill = this.#container.querySelector('#progressFill');
    const pctLabel  = this.#container.querySelector('#progressLabel');
    const locLabel  = this.#container.querySelector('#locationLabel');

    if (fill)     fill.style.width = `${pct.toFixed(1)}%`;
    if (pctLabel) pctLabel.textContent = `${pct.toFixed(0)}%`;
    if (locLabel) {
      const curr = location.start.displayed?.page;
      const tot  = location.start.displayed?.total;
      locLabel.textContent = (curr && tot) ? `${curr} / ${tot}` : '—';
    }
  }

  #scheduleSave() {
    clearTimeout(this.#saveTimer);
    this.#saveTimer = setTimeout(() => this.#saveProgress(), 5000);
  }

  async #downloadBook() {
    const book = await db.get(STORES.BOOKS, this.#bookId);
    if (!book || !book.file) return;

    const blob = new Blob([book.file], { type: 'application/epub+zip' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href     = url;
    a.download = `${book.title.replace(/[\\/:*?"<>|]/g, '')}.epub`;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }, 100);
  }

  async #saveProgress() {
    if (!this.#currentCfi) return;
    const pct = this.#book?.locations?.percentageFromCfi(this.#currentCfi) * 100 || 0;

    await db.put(STORES.PROGRESS, {
      bookId:     this.#bookId,
      cfi:        this.#currentCfi,
      percentage: pct,
      chapter:    this.#currentChapterHref,
      lastRead:   Date.now(),
    });

    // Actualizar lastRead en el registro del libro
    const bookRecord = await db.get(STORES.BOOKS, this.#bookId);
    if (bookRecord) {
      bookRecord.lastRead = Date.now();
      bookRecord.progress = pct;
      await db.put(STORES.BOOKS, bookRecord);
    }
  }

  // ── Eventos ──────────────────────────────────────────────────────────────

  #bindEvents() {
    const q = id => this.#container.querySelector(id);

    q('#backBtn')?.addEventListener('click', () => this.#onBack());
    
    // Zonas de navegación (para saltar entre secciones)
    q('#prevZone')?.addEventListener('click', () => this.#rendition?.prev());
    q('#nextZone')?.addEventListener('click', () => this.#rendition?.next());

    // TOC
    q('#tocBtn')?.addEventListener('click', () => this.#openPanel('toc'));
    q('#closeTocBtn')?.addEventListener('click', () => this.#closePanels());

    // Settings
    q('#settingsBtn')?.addEventListener('click', () => this.#openPanel('settings'));
    q('#closeSettingsBtn')?.addEventListener('click', () => this.#closePanels());

    q('#downloadBtn')?.addEventListener('click', () => this.#downloadBook());

    // Edit button
    q('#editBtn')?.addEventListener('click', () => this.#onEdit(this.#bookId, this.#currentChapterHref));

    // Overlay
    q('#panelOverlay')?.addEventListener('click', () => this.#closePanels());

    // Font size
    q('#fontDecBtn')?.addEventListener('click', () => this.#changeFontSize(-1));
    q('#fontIncBtn')?.addEventListener('click', () => this.#changeFontSize(+1));

    // Fonts
    q('#fontSelector')?.querySelectorAll('.font-btn').forEach(btn => {
      btn.addEventListener('click', () => this.#changeFont(btn.dataset.font));
    });

    // Themes
    q('#themeSelector')?.querySelectorAll('.theme-btn').forEach(btn => {
      btn.addEventListener('click', () => this.#changeTheme(btn.dataset.theme));
    });

    // Line height
    q('.line-height-ctrl')?.querySelectorAll('.lh-btn').forEach(btn => {
      btn.addEventListener('click', () => this.#changeLineHeight(parseFloat(btn.dataset.lh)));
    });

    // Alignment
    q('#alignSelector')?.querySelectorAll('.align-btn').forEach(btn => {
      btn.addEventListener('click', () => this.#changeTextAlign(btn.dataset.align));
    });

    // Teclado
    document.addEventListener('keydown', this.#handleKey);
  }

  #handleKey = (e) => {
    if (e.key === 'Escape') this.#closePanels();
  };

  // ── Paneles ──────────────────────────────────────────────────────────────

  #openPanel(name) {
    this.#closePanels();
    const map = { toc: '#tocPanel', settings: '#settingsPanel' };
    this.#container.querySelector(map[name])?.classList.remove('hidden');
    this.#container.querySelector('#panelOverlay')?.classList.remove('hidden');
  }

  #closePanels() {
    ['#tocPanel', '#settingsPanel', '#panelOverlay'].forEach(s => {
      this.#container.querySelector(s)?.classList.add('hidden');
    });
  }

  // ── Ajustes ──────────────────────────────────────────────────────────────

  #changeFontSize(delta) {
    this.#settings.fontSize = Math.min(28, Math.max(12, this.#settings.fontSize + delta));
    this.#container.querySelector('#fontSizeVal').textContent = `${this.#settings.fontSize}px`;
    this.#applyTheme();
    this.#saveSettings();
  }

  #changeFont(fontId) {
    this.#settings.fontId = fontId;
    this.#container.querySelectorAll('.font-btn').forEach(b => {
      b.classList.toggle('active', b.dataset.font === fontId);
    });
    this.#applyTheme();
    this.#saveSettings();
  }

  #changeTheme(theme) {
    this.#settings.theme = theme;
    this.#container.querySelectorAll('.theme-btn').forEach(b => {
      b.classList.toggle('active', b.dataset.theme === theme);
    });
    this.#applyTheme();
    this.#saveSettings();
  }

  #changeLineHeight(lh) {
    this.#settings.lineHeight = lh;
    this.#container.querySelectorAll('.lh-btn').forEach(b => {
      b.classList.toggle('active', parseFloat(b.dataset.lh) === lh);
    });
    this.#applyTheme();
    this.#saveSettings();
  }

  #changeTextAlign(align) {
    this.#settings.textAlign = align;
    this.#container.querySelectorAll('.align-btn').forEach(b => {
      b.classList.toggle('active', b.dataset.align === align);
    });
    this.#applyTheme();
    this.#saveSettings();
  }

  async #loadSettings() {
    const saved = await db.get(STORES.SETTINGS, 'readerSettings');
    if (saved?.value) Object.assign(this.#settings, saved.value);
  }

  async #saveSettings() {
    await db.put(STORES.SETTINGS, { key: 'readerSettings', value: { ...this.#settings } });
  }
}
