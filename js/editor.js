/**
 * editor.js — Vista de Edición de Capítulo
 * Responsabilidades: extraer HTML del capítulo del ePub con JSZip,
 * permitir edición en un editor de texto enriquecido, guardar cambios
 * de vuelta al ePub almacenado en IndexedDB.
 */

import { db, STORES } from './db.js';

// ─── Constantes ────────────────────────────────────────────────────────────

const THEMES = {
  dark:   { bg: '#0f0e0c', fg: '#e8e0d0', border: '#2e2b24' },
  light:  { bg: '#faf8f4', fg: '#2c2520', border: '#ddd8d0' },
  sepia:  { bg: '#f4ede0', fg: '#3d2b1f', border: '#d4c8b8' },
};

// ─── EditorView ────────────────────────────────────────────────────────────

export class EditorView {
  #container;
  #onBack;
  #onReadChapter;
  #bookId;
  #chapterHref;
  #bookData;
  #zip;
  #allChapters = [];    // [{ href, label, index }]
  #currentIndex = 0;
  #isDirty = false;
  #originalContent = '';
  #settings = { theme: 'dark' };

  constructor(container, { onBack, onReadChapter }) {
    this.#container     = container;
    this.#onBack        = onBack;
    this.#onReadChapter = onReadChapter;
  }

  // ── Ciclo de vida ────────────────────────────────────────────────────────

  async mount(bookId, chapterHref) {
    this.#bookId      = bookId;
    this.#chapterHref = chapterHref;
    this.#bookData    = await db.get(STORES.BOOKS, bookId);
    if (!this.#bookData) { this.#onBack(); return; }

    await this.#loadSettings();
    this.#renderShell();
    this.#applyTheme();
    await this.#loadEpubChapters();
    this.#bindEvents();
  }

  unmount() {
    this.#container.innerHTML = '';
  }

  // ── Shell HTML ───────────────────────────────────────────────────────────

  #renderShell() {
    this.#container.innerHTML = `
      <div class="editor-view" id="editorRoot">

        <!-- Top bar -->
        <header class="editor-header">
          <div class="editor-header__left">
            <button class="btn-icon" id="backToReaderBtn" aria-label="Volver al lector">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M19 12H5M12 5l-7 7 7 7"/>
              </svg>
            </button>
            <div class="editor-header__book">
              <span class="editor-book-title">${this.#escHtml(this.#bookData.title)}</span>
              <span class="editor-mode-badge">Modo Edición</span>
            </div>
          </div>

          <div class="editor-header__actions">
            <button class="btn-icon" id="settingsBtn" aria-label="Ajustes de tema">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <circle cx="12" cy="12" r="3"/>
                <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>
              </svg>
            </button>
            <button class="btn-secondary" id="previewBtn" aria-label="Vista previa">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
                <circle cx="12" cy="12" r="3"/>
              </svg>
              <span>Vista previa</span>
            </button>
            <button class="btn-icon" id="downloadBookBtn" aria-label="Descargar libro" title="Descargar ePub editado">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M21 15v4a2 2 0 0 1-2-2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>
              </svg>
            </button>
            <button class="btn-primary" id="saveBtn" aria-label="Guardar cambios" disabled>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/>
                <polyline points="17 21 17 13 7 13 7 21"/>
                <polyline points="7 3 7 8 15 8"/>
              </svg>
              Guardar
            </button>
          </div>
        </header>

        <!-- Selector de capítulo -->
        <div class="chapter-bar">
          <button class="btn-icon chapter-nav" id="prevChapterBtn" aria-label="Capítulo anterior" disabled>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M15 18l-6-6 6-6"/>
            </svg>
          </button>
          <select class="chapter-select" id="chapterSelect" aria-label="Seleccionar capítulo">
            <option>Cargando capítulos…</option>
          </select>
          <button class="btn-icon chapter-nav" id="nextChapterBtn" aria-label="Capítulo siguiente" disabled>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M9 18l6-6-6-6"/>
            </svg>
          </button>
        </div>

        <!-- Toolbar de formato -->
        <div class="editor-toolbar" id="editorToolbar">
          <div class="toolbar-group">
            <button class="toolbar-btn" data-cmd="bold"        title="Negrita (Ctrl+B)"><b>B</b></button>
            <button class="toolbar-btn" data-cmd="italic"      title="Cursiva (Ctrl+I)"><i>I</i></button>
            <button class="toolbar-btn" data-cmd="underline"   title="Subrayado (Ctrl+U)"><u>U</u></button>
            <button class="toolbar-btn" data-cmd="strikeThrough" title="Tachado"><s>S</s></button>
          </div>
          <div class="toolbar-sep"></div>
          <div class="toolbar-group">
            <button class="toolbar-btn" data-cmd="removeFormat" title="Limpiar formato">✕f</button>
          </div>
          <div class="toolbar-sep"></div>
          <div class="toolbar-group">
            <button class="toolbar-btn" data-insert="h1" title="Encabezado 1">H1</button>
            <button class="toolbar-btn" data-insert="h2" title="Encabezado 2">H2</button>
            <button class="toolbar-btn" data-insert="h3" title="Encabezado 3">H3</button>
            <button class="toolbar-btn" data-insert="p"  title="Párrafo">¶</button>
          </div>
          <div class="toolbar-sep"></div>
          <div class="toolbar-group">
            <button class="toolbar-btn" id="undoBtn" title="Deshacer (Ctrl+Z)">↩</button>
            <button class="toolbar-btn" id="redoBtn" title="Rehacer (Ctrl+Y)">↪</button>
          </div>
          <div class="toolbar-sep"></div>
          <div class="toolbar-group">
            <button class="toolbar-btn" id="toggleModeBtn" title="Alternar código fuente HTML">
              <span id="toggleModeIcon">&lt;/&gt;</span>
            </button>
          </div>
          <div class="toolbar-sep"></div>
          <div class="toolbar-group search-group">
            <input type="text"   class="search-input" id="findInput"    placeholder="Buscar…"      aria-label="Buscar texto">
            <input type="text"   class="search-input" id="replaceInput" placeholder="Reemplazar…"   aria-label="Reemplazar con">
            <button class="toolbar-btn" id="findNextBtn"    title="Buscar siguiente">▶</button>
            <button class="toolbar-btn" id="replaceOneBtn"  title="Reemplazar uno">R₁</button>
            <button class="toolbar-btn" id="replaceAllBtn"  title="Reemplazar todos">R∀</button>
          </div>
        </div>

        <!-- Editor principal / código fuente -->
        <div class="editor-body" id="editorBody">
          <div class="editor-loading" id="editorLoading">
            <div class="spinner"></div>
            <span>Cargando capítulo…</span>
          </div>

          <!-- WYSIWYG -->
          <div class="editor-wysiwyg hidden" id="editorWysiwyg"
               contenteditable="true"
               spellcheck="true"
               aria-label="Editor de contenido">
          </div>

          <!-- Código fuente HTML -->
          <textarea class="editor-source hidden" id="editorSource"
                    spellcheck="false"
                    aria-label="Código fuente HTML del capítulo"></textarea>
        </div>

        <!-- Status bar -->
        <footer class="editor-statusbar">
          <span id="statusMsg" class="status-msg">Listo</span>
          <span id="charCount" class="char-count">0 caracteres</span>
          <span id="dirtyIndicator" class="dirty-indicator hidden">● Sin guardar</span>
        </footer>

        <!-- Panel vista previa -->
        <div class="preview-panel hidden" id="previewPanel">
          <div class="preview-panel__header">
            <h2>Vista previa</h2>
            <button class="btn-icon" id="closePreviewBtn" aria-label="Cerrar vista previa">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
              </svg>
            </button>
          </div>
          <div class="preview-content" id="previewContent"></div>
        </div>

        <!-- Panel de ajustes (reusando CSS) -->
        <div class="settings-panel hidden" id="settingsPanel">
          <div class="settings-panel__header">
            <h2>Ajustes de tema</h2>
            <button class="btn-icon" id="closeSettingsBtn" aria-label="Cerrar">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
              </svg>
            </button>
          </div>
          <section class="settings-section">
            <label class="settings-label">Tema del editor</label>
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
        </div>
        <div class="panel-overlay hidden" id="panelOverlay"></div>
      </div>
    `;
  }

  // ── Carga de capítulos del ePub ──────────────────────────────────────────

  async #loadEpubChapters() {
    // Obtener archivo, ya con edits previos aplicados si los hubiera
    let arrayBuffer = this.#bookData.file;

    // Cargar edits persistidos (los aplicamos sobre el zip)
    const edits = await db.getAllByIndex(STORES.EDITS, 'bookId', this.#bookId);
    const editsMap = Object.fromEntries(edits.map(e => [e.chapterHref, e.content]));

    this.#zip = await JSZip.loadAsync(arrayBuffer);

    // Parsear OPF para obtener orden de capítulos
    const containerXml = await this.#zip.file('META-INF/container.xml')?.async('string');
    if (!containerXml) { this.#showStatus('No se pudo leer el ePub', 'error'); return; }

    const parser     = new DOMParser();
    const containerDoc = parser.parseFromString(containerXml, 'text/xml');
    const opfPath    = containerDoc.querySelector('rootfile')?.getAttribute('full-path') || '';
    const opfDir     = opfPath.includes('/') ? opfPath.slice(0, opfPath.lastIndexOf('/') + 1) : '';
    const opfContent = await this.#zip.file(opfPath)?.async('string');
    if (!opfContent) return;

    const opfDoc     = parser.parseFromString(opfContent, 'text/xml');
    const spineItems = [...opfDoc.querySelectorAll('spine itemref')];
    const manifest   = Object.fromEntries(
      [...opfDoc.querySelectorAll('manifest item')].map(i => [i.getAttribute('id'), i])
    );

    // Leer navegación (nav.xhtml o ncx)
    const navItem = opfDoc.querySelector('manifest item[properties="nav"]')
      || opfDoc.querySelector('manifest item[media-type="application/x-dtbncx+xml"]');
    const navHref   = navItem?.getAttribute('href') || '';
    const navPath   = opfDir + navHref;
    const navContent = await this.#zip.file(navPath)?.async('string') || '';
    const navDoc    = navContent ? parser.parseFromString(navContent, 'text/xml') : null;

    const getLabelFor = (href) => {
      if (!navDoc) return href;
      const link = navDoc.querySelector(`[href*="${href.split('/').pop()}"]`);
      return link?.textContent?.trim() || href;
    };

    this.#allChapters = spineItems
      .map((item, idx) => {
        const id       = item.getAttribute('idref');
        const manifest_item = manifest[id];
        if (!manifest_item) return null;
        const href     = opfDir + manifest_item.getAttribute('href');
        const label    = getLabelFor(manifest_item.getAttribute('href'));
        return { href, label, index: idx };
      })
      .filter(Boolean);

    // Aplicar edits al zip de forma segura
    for (const [href, content] of Object.entries(editsMap)) {
      const file = this.#zip.file(href) || Object.values(this.#zip.files).find(f => f.name.endsWith(href));
      if (file) {
        let finalContent = content;
        // Si el edit guardado es solo un fragmento, lo integramos en el original
        if (!finalContent.includes('<body') && !finalContent.includes('<html')) {
          const original = await file.async('string');
          finalContent = original.replace(/(<body[^>]*>)([\s\S]*?)(<\/body>)/i, (m, p1, p2, p3) => `${p1}${content}${p3}`);
        }
        this.#zip.file(file.name, finalContent);
      }
    }

    // Poblar selector de capítulos
    const select = this.#container.querySelector('#chapterSelect');
    select.innerHTML = this.#allChapters.map((c, i) =>
      `<option value="${i}">${this.#escHtml(c.label || `Capítulo ${i + 1}`)}</option>`
    ).join('');

    // Seleccionar capítulo inicial
    const initialIndex = this.#chapterHref
      ? this.#allChapters.findIndex(c => c.href.endsWith(this.#chapterHref) || c.href === this.#chapterHref)
      : 0;
    this.#currentIndex = Math.max(0, initialIndex);
    select.value = this.#currentIndex;

    await this.#loadChapter(this.#currentIndex);
  }

  async #loadChapter(index) {
    this.#currentIndex = index;
    const chapter = this.#allChapters[index];
    if (!chapter) return;

    this.#container.querySelector('#editorLoading')?.classList.remove('hidden');

    const file = this.#zip.file(chapter.href)
      || Object.values(this.#zip.files).find(f => f.name.endsWith(chapter.href));

    if (!file) {
      this.#showStatus(`No se encontró el archivo: ${chapter.href}`, 'error');
      return;
    }

    const html = await file.async('string');

    // Extraer solo el body
    const bodyContent = this.#extractBody(html);
    this.#originalContent  = bodyContent;
    this.#isDirty          = false;
    this.#updateDirty();

    // Mostrar en el editor activo
    const wysiwyg = this.#container.querySelector('#editorWysiwyg');
    const source  = this.#container.querySelector('#editorSource');

    // Siempre reseteamos a WYSIWYG por defecto en la carga inicial si ambos están ocultos
    const isSource = !source.classList.contains('hidden');
    
    if (isSource) {
      source.value = this.#prettyPrintHtml(bodyContent);
    } else {
      wysiwyg.innerHTML = bodyContent;
      wysiwyg.classList.remove('hidden');
      source.classList.add('hidden');
    }

    this.#container.querySelector('#editorLoading')?.classList.add('hidden');
    this.#container.querySelector('#toggleModeIcon').textContent = isSource ? '👁' : '</>';

    this.#updateNavButtons();
    this.#updateCharCount();
    this.#showStatus(`Capítulo "${chapter.label}" cargado`);
  }

  // ── Guardar ──────────────────────────────────────────────────────────────

  async #save() {
    const chapter = this.#allChapters[this.#currentIndex];
    if (!chapter) return;

    const wysiwyg  = this.#container.querySelector('#editorWysiwyg');
    const source   = this.#container.querySelector('#editorSource');
    const isSource = !source.classList.contains('hidden');

    let editedBody = isSource ? source.value : wysiwyg.innerHTML;

    // Sanitizar HTML para que sea XHTML válido (especialmente etiquetas autoconclusivas como <hr> -> <hr />)
    editedBody = this.#sanitizeXhtml(editedBody);

    let updatedFull = editedBody;

    // Actualizar zip en memoria y preparar el contenido completo
    const file = this.#zip.file(chapter.href)
      || Object.values(this.#zip.files).find(f => f.name.endsWith(chapter.href));
    
    if (file) {
      const originalFull = await file.async('string');
      updatedFull = this.#replaceBody(originalFull, editedBody);
      this.#zip.file(file.name, updatedFull);

      // Guardar nuevo ArrayBuffer en IndexedDB para persistencia total
      const newBuffer = await this.#zip.generateAsync({ type: 'arraybuffer' });
      const bookRecord = await db.get(STORES.BOOKS, this.#bookId);
      if (bookRecord) {
        bookRecord.file = newBuffer;
        await db.put(STORES.BOOKS, bookRecord);
      }
    }

    // Guardar edit en STORES.EDITS (guardamos el documento completo para evitar XML malformado)
    await db.put(STORES.EDITS, {
      bookId:      this.#bookId,
      chapterHref: chapter.href,
      content:     updatedFull,
      editedAt:    Date.now(),
    });

    if (isSource) source.value = editedBody;
    else wysiwyg.innerHTML = editedBody;

    this.#originalContent = editedBody;
    this.#isDirty = false;
    this.#updateDirty();
    this.#showStatus('Cambios guardados ✓', 'success');
  }

  async #downloadBook() {
    if (this.#isDirty) {
      if (!confirm('Tienes cambios sin guardar. ¿Descargar la última versión guardada?')) return;
    }
    
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
    this.#showStatus('Descarga iniciada ✓', 'success');
  }

  // ── Buscar y reemplazar ──────────────────────────────────────────────────

  #findNext() {
    const term = this.#container.querySelector('#findInput').value.trim();
    if (!term) return;

    const wysiwyg = this.#container.querySelector('#editorWysiwyg');
    const source  = this.#container.querySelector('#editorSource');

    if (!source.classList.contains('hidden')) {
      const start = source.selectionEnd;
      let idx = source.value.indexOf(term, start);
      
      if (idx === -1 && start > 0) {
        idx = source.value.indexOf(term, 0);
        if (idx !== -1) {
          this.#showStatus('Búsqueda reiniciada desde el principio', 'info');
        }
      }

      if (idx === -1) {
        this.#showStatus('No se encontraron coincidencias', 'info');
        return;
      }
      source.setSelectionRange(idx, idx + term.length);
      source.focus();
    } else {
      const found = window.find(term, false, false, true);
      if (found) {
        wysiwyg.focus();
      } else {
        this.#showStatus('No se encontraron coincidencias', 'info');
      }
    }
  }

  #replaceOne() {
    const find    = this.#container.querySelector('#findInput').value;
    const replace = this.#container.querySelector('#replaceInput').value;
    const source  = this.#container.querySelector('#editorSource');

    if (!source.classList.contains('hidden')) {
      const sel = source.value.slice(source.selectionStart, source.selectionEnd);
      if (sel === find) {
        const s = source.selectionStart;
        source.value = source.value.slice(0, s) + replace + source.value.slice(s + find.length);
        source.setSelectionRange(s, s + replace.length);
        this.#markDirty();
      } else {
        this.#findNext();
      }
    }
  }

  #replaceAll() {
    const find    = this.#container.querySelector('#findInput').value;
    const replace = this.#container.querySelector('#replaceInput').value;
    if (!find) return;

    const source  = this.#container.querySelector('#editorSource');
    const wysiwyg = this.#container.querySelector('#editorWysiwyg');

    const isSource = !source.classList.contains('hidden');
    const count    = isSource
      ? (source.value.split(find).length - 1)
      : (wysiwyg.innerHTML.split(find).length - 1);

    if (isSource) {
      source.value = source.value.replaceAll(find, () => replace);
    } else {
      wysiwyg.innerHTML = wysiwyg.innerHTML.replaceAll(find, () => replace);
    }

    this.#markDirty();
    this.#showStatus(`${count} reemplazo${count !== 1 ? 's' : ''} realizado${count !== 1 ? 's' : ''}`, 'success');
  }

  // ── Eventos ──────────────────────────────────────────────────────────────

  #bindEvents() {
    const q = id => this.#container.querySelector(id);

    q('#backToReaderBtn')?.addEventListener('click', () => {
      if (this.#isDirty && !confirm('Hay cambios sin guardar. ¿Salir de todos modos?')) return;
      this.#onBack();
    });

    q('#saveBtn')?.addEventListener('click', () => this.#save());
    q('#downloadBookBtn')?.addEventListener('click', () => this.#downloadBook());

    q('#chapterSelect')?.addEventListener('change', async (e) => {
      if (this.#isDirty && !confirm('Cambios sin guardar. ¿Cambiar de capítulo?')) {
        e.target.value = this.#currentIndex;
        return;
      }
      await this.#loadChapter(parseInt(e.target.value));
    });

    q('#prevChapterBtn')?.addEventListener('click', () => {
      if (this.#currentIndex > 0) {
        q('#chapterSelect').value = this.#currentIndex - 1;
        q('#chapterSelect').dispatchEvent(new Event('change'));
      }
    });

    q('#nextChapterBtn')?.addEventListener('click', () => {
      if (this.#currentIndex < this.#allChapters.length - 1) {
        q('#chapterSelect').value = this.#currentIndex + 1;
        q('#chapterSelect').dispatchEvent(new Event('change'));
      }
    });

    // Toolbar format buttons
    q('#editorToolbar')?.querySelectorAll('[data-cmd]').forEach(btn => {
      btn.addEventListener('click', () => {
        document.execCommand(btn.dataset.cmd, false, null);
        q('#editorWysiwyg')?.focus();
        this.#markDirty();
      });
    });

    // Paragraph styles
    q('#editorToolbar')?.querySelectorAll('[data-insert]').forEach(btn => {
      btn.addEventListener('click', () => {
        document.execCommand('formatBlock', false, `<${btn.dataset.insert}>`);
        q('#editorWysiwyg')?.focus();
        this.#markDirty();
      });
    });

    q('#undoBtn')?.addEventListener('click', () => { document.execCommand('undo'); this.#markDirty(); });
    q('#redoBtn')?.addEventListener('click', () => { document.execCommand('redo'); this.#markDirty(); });

    // Toggle wysiwyg / source
    q('#toggleModeBtn')?.addEventListener('click', () => this.#toggleMode());

    // WYSIWYG content change
    q('#editorWysiwyg')?.addEventListener('input', () => {
      this.#markDirty();
      this.#updateCharCount();
    });

    // Source change
    q('#editorSource')?.addEventListener('input', () => {
      this.#markDirty();
      this.#updateCharCount();
    });

    // Vista previa
    q('#previewBtn')?.addEventListener('click', () => this.#openPreview());
    q('#closePreviewBtn')?.addEventListener('click', () => q('#previewPanel')?.classList.add('hidden'));

    // Theme settings
    q('#settingsBtn')?.addEventListener('click', () => this.#openPanel('settings'));
    q('#closeSettingsBtn')?.addEventListener('click', () => this.#closePanels());
    q('#panelOverlay')?.addEventListener('click', () => this.#closePanels());

    q('#themeSelector')?.querySelectorAll('.theme-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        this.#settings.theme = btn.dataset.theme;
        this.#container.querySelectorAll('.theme-btn').forEach(b => {
          b.classList.toggle('active', b.dataset.theme === this.#settings.theme);
        });
        this.#applyTheme();
        this.#saveSettings();
      });
    });

    // Buscar / reemplazar
    q('#findNextBtn')?.addEventListener('click', () => this.#findNext());
    q('#replaceOneBtn')?.addEventListener('click', () => this.#replaceOne());
    q('#replaceAllBtn')?.addEventListener('click', () => this.#replaceAll());
    q('#findInput')?.addEventListener('keydown', e => { if (e.key === 'Enter') this.#findNext(); });

    // Ctrl+S para guardar
    document.addEventListener('keydown', this.#handleKey);
  }

  #handleKey = (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 's') {
      e.preventDefault();
      this.#save();
    }
  };

  // ── Modo WYSIWYG ↔ código fuente ─────────────────────────────────────────

  #toggleMode() {
    const wysiwyg = this.#container.querySelector('#editorWysiwyg');
    const source  = this.#container.querySelector('#editorSource');
    const icon    = this.#container.querySelector('#toggleModeIcon');

    if (wysiwyg.classList.contains('hidden')) {
      // Source → WYSIWYG
      wysiwyg.innerHTML = source.value;
      source.classList.add('hidden');
      wysiwyg.classList.remove('hidden');
      icon.textContent = '</>';
    } else {
      // WYSIWYG → Source
      source.value = this.#prettyPrintHtml(wysiwyg.innerHTML);
      wysiwyg.classList.add('hidden');
      source.classList.remove('hidden');
      icon.textContent = '👁';
    }
  }

  // ── Vista previa ─────────────────────────────────────────────────────────

  #openPreview() {
    const wysiwyg  = this.#container.querySelector('#editorWysiwyg');
    const source   = this.#container.querySelector('#editorSource');
    const isSource = !source.classList.contains('hidden');
    const html     = isSource ? source.value : wysiwyg.innerHTML;

    const preview = this.#container.querySelector('#previewContent');
    preview.innerHTML = html;
    this.#container.querySelector('#previewPanel')?.classList.remove('hidden');
  }

  // ── Helpers ──────────────────────────────────────────────────────────────

  #extractBody(html) {
    const match = html.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
    return match ? match[1].trim() : html;
  }

  #replaceBody(original, newBody) {
    const hasBody = /<body[^>]*>[\s\S]*?<\/body>/i.test(original);
    // Usamos función de reemplazo para evitar que caracteres como $ en newBody se interpreten
    if (hasBody) return original.replace(/(<body[^>]*>)([\s\S]*?)(<\/body>)/i, (m, p1, p2, p3) => `${p1}${newBody}${p3}`);
    return newBody;
  }

  #sanitizeXhtml(html) {
    // Asegurar que etiquetas vacías comunes sean autoconclusivas para evitar errores XML en ePub
    const tags = ['hr', 'br', 'img', 'meta', 'link', 'input', 'col', 'source', 'area', 'base'];
    let sanitized = html;
    
    tags.forEach(tag => {
      // Busca <tag ...> que NO termina en /> y le añade la barra
      const regex = new RegExp(`<(${tag})(\\b[^>]*?)(?<!/)>`, 'gi');
      sanitized = sanitized.replace(regex, '<$1$2 />');
    });
    
    return sanitized;
  }

  #prettyPrintHtml(html) {
    // Indentación básica del HTML
    let indent = 0;
    const selfClosing = /^(?:area|base|br|col|embed|hr|img|input|link|meta|param|source|track|wbr)$/i;

    return html
      .replace(/>\s*</g, '>\n<')
      .split('\n')
      .map(line => {
        const trimmed = line.trim();
        if (!trimmed) return '';

        // Contar aperturas y cierres en la misma línea para evitar cascadas
        const openingMatches = (trimmed.match(/<[^\/!][^>]*[^\/]>/g) || []).filter(tag => {
          const tagName = tag.match(/^<([a-z0-9]+)/i)?.[1];
          return tagName && !selfClosing.test(tagName);
        }).length;
        
        const closingMatches = (trimmed.match(/<\/[^>]+>/g) || []).length;
        const startsWithClosing = /^<\//.test(trimmed);

        if (startsWithClosing) {
          indent = Math.max(0, indent - 1);
        }
        
        const out = '  '.repeat(indent) + trimmed;

        // Ajustar indent para la siguiente línea
        if (!startsWithClosing) {
          indent += (openingMatches - closingMatches);
        } else {
          // Si empezaba cerrando, ya restamos 1, pero si hay más cierres/aperturas...
          indent += (openingMatches - (closingMatches - 1));
        }
        
        indent = Math.max(0, indent);
        return out;
      })
      .join('\n');
  }

  #markDirty() {
    if (!this.#isDirty) {
      this.#isDirty = true;
      this.#updateDirty();
    }
  }

  #updateDirty() {
    const saveBtn   = this.#container.querySelector('#saveBtn');
    const indicator = this.#container.querySelector('#dirtyIndicator');
    if (saveBtn)   saveBtn.disabled = !this.#isDirty;
    if (indicator) indicator.classList.toggle('hidden', !this.#isDirty);
  }

  #updateNavButtons() {
    const prev = this.#container.querySelector('#prevChapterBtn');
    const next = this.#container.querySelector('#nextChapterBtn');
    if (prev) prev.disabled = this.#currentIndex === 0;
    if (next) next.disabled = this.#currentIndex >= this.#allChapters.length - 1;
  }

  #updateCharCount() {
    const wysiwyg = this.#container.querySelector('#editorWysiwyg');
    const source  = this.#container.querySelector('#editorSource');
    const isSource = !source.classList.contains('hidden');
    const len     = isSource ? source.value.length : (wysiwyg.textContent?.length || 0);
    const el      = this.#container.querySelector('#charCount');
    if (el) el.textContent = `${len.toLocaleString('es-ES')} caracteres`;
  }

  #showStatus(msg, type = 'info') {
    const el = this.#container.querySelector('#statusMsg');
    if (!el) return;
    el.textContent  = msg;
    el.className    = `status-msg status-msg--${type}`;
    setTimeout(() => { el.textContent = 'Listo'; el.className = 'status-msg'; }, 3000);
  }

  #applyTheme() {
    const root  = this.#container.querySelector('#editorRoot');
    const theme = THEMES[this.#settings.theme];
    if (!root) return;

    // Actualizar clase del root para CSS global
    root.className = root.className.replace(/theme-\w+/, '');
    root.classList.add(`theme-${this.#settings.theme}`);

    // Aplicar colores directamente a variables si fuera necesario, 
    // pero aquí confiaremos en que el CSS maneja .theme-xxx
    // Para el editor, necesitamos que el área de edición también cambie
    const wysiwyg = this.#container.querySelector('#editorWysiwyg');
    const source  = this.#container.querySelector('#editorSource');
    
    if (wysiwyg) {
      wysiwyg.style.backgroundColor = theme.bg;
      wysiwyg.style.color           = theme.fg;
    }
    if (source) {
      source.style.backgroundColor = theme.bg === '#0f0e0c' ? '#0a0908' : theme.bg;
      source.style.color           = theme.fg;
    }
  }

  async #loadSettings() {
    const saved = await db.get(STORES.SETTINGS, 'readerSettings');
    if (saved?.value?.theme) this.#settings.theme = saved.value.theme;
  }

  async #saveSettings() {
    // Compartimos el mismo almacén de settings que el lector para coherencia
    const saved = await db.get(STORES.SETTINGS, 'readerSettings') || { key: 'readerSettings', value: {} };
    saved.value.theme = this.#settings.theme;
    await db.put(STORES.SETTINGS, saved);
  }

  #openPanel(name) {
    this.#closePanels();
    const map = { settings: '#settingsPanel' };
    this.#container.querySelector(map[name])?.classList.remove('hidden');
    this.#container.querySelector('#panelOverlay')?.classList.remove('hidden');
  }

  #closePanels() {
    ['#settingsPanel', '#panelOverlay'].forEach(s => {
      this.#container.querySelector(s)?.classList.add('hidden');
    });
  }

  #escHtml(str = '') {
    const d = document.createElement('div');
    d.textContent = str;
    return d.innerHTML;
  }
}
