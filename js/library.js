/**
 * library.js — Vista de Biblioteca
 * Responsabilidades: listar libros, importar ePub, eliminar libros
 */

import { db, STORES } from './db.js';

// ─── Helpers ───────────────────────────────────────────────────────────────

function escapeHtml(str = '') {
  const d = document.createElement('div');
  d.textContent = str;
  return d.innerHTML;
}

function formatDate(ts) {
  if (!ts) return '';
  return new Date(ts).toLocaleDateString('es-ES', { day: 'numeric', month: 'short', year: 'numeric' });
}

function formatSize(bytes) {
  if (bytes < 1024)       return `${bytes} B`;
  if (bytes < 1024 ** 2)  return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
}

/** Extrae metadatos y portada de un ArrayBuffer de ePub usando JSZip */
async function parseEpubMetadata(arrayBuffer) {
  const meta = { title: '', author: '', cover: null };
  try {
    const zip    = await JSZip.loadAsync(arrayBuffer);
    const parser = new DOMParser();

    // 1. container.xml → OPF path
    const containerXml = await zip.file('META-INF/container.xml')?.async('string');
    if (!containerXml) return meta;

    const containerDoc = parser.parseFromString(containerXml, 'text/xml');
    const opfPath = containerDoc.querySelector('rootfile')?.getAttribute('full-path');
    if (!opfPath) return meta;

    // 2. OPF → title, author, cover
    const opfContent = await zip.file(opfPath)?.async('string');
    if (!opfContent) return meta;

    const opfDoc = parser.parseFromString(opfContent, 'text/xml');
    meta.title  = opfDoc.querySelector('metadata title, dc\\:title')?.textContent?.trim() || '';
    meta.author = opfDoc.querySelector('metadata creator, dc\\:creator')?.textContent?.trim() || '';

    // 3. Buscar portada
    const opfDir     = opfPath.includes('/') ? opfPath.slice(0, opfPath.lastIndexOf('/') + 1) : '';
    const coverId    = opfDoc.querySelector('meta[name="cover"]')?.getAttribute('content');
    const coverItem  = coverId
      ? opfDoc.querySelector(`[id="${coverId}"]`)
      : opfDoc.querySelector('item[media-type^="image/"]');

    if (coverItem) {
      const href      = coverItem.getAttribute('href') || '';
      const fullPath  = href.startsWith('/') ? href.slice(1) : opfDir + href;
      const coverFile = zip.file(fullPath) || zip.file(href);
      if (coverFile) {
        const b64       = await coverFile.async('base64');
        const mediaType = coverItem.getAttribute('media-type') || 'image/jpeg';
        meta.cover      = `data:${mediaType};base64,${b64}`;
      }
    }
  } catch (err) {
    console.warn('[Library] Error parsando ePub:', err);
  }
  return meta;
}

// ─── LibraryView ───────────────────────────────────────────────────────────

export class LibraryView {
  #container;
  #onBookOpen;
  #books = [];
  #sortBy = 'addedAt'; // 'addedAt' | 'title' | 'lastRead'
  #toast = null;
  #theme = 'dark';

  constructor(container, { onBookOpen }) {
    this.#container  = container;
    this.#onBookOpen = onBookOpen;
  }

  // ── Ciclo de vida ────────────────────────────────────────────────────────

  async mount() {
    await this.#loadSettings();
    this.#render();
    this.#applyTheme();
    this.#bindEvents();
    await this.#loadBooks();
  }

  unmount() {
    document.removeEventListener('click', this.#onGlobalClick);
    this.#container.innerHTML = '';
  }

  async #loadSettings() {
    const saved = await db.get(STORES.SETTINGS, 'readerSettings');
    if (saved?.value?.theme) this.#sortBy = this.#sortBy; // No related, just to check if exists
    this.#theme = saved?.value?.theme || 'dark';
  }

  #applyTheme() {
    const root = this.#container.querySelector('.library-view');
    if (root) {
      root.className = `library-view theme-${this.#theme}`;
    }
  }

  // ── Renderizado ──────────────────────────────────────────────────────────

  #render() {
    this.#container.innerHTML = `
      <div class="library-view">

        <!-- Header -->
        <header class="lib-header">
          <div class="lib-header__brand">
            <svg class="brand-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
              <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/>
              <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/>
            </svg>
            <h1>Librario</h1>
          </div>

          <div class="lib-header__actions">
            <button class="btn-icon" id="sortBtn" title="Ordenar biblioteca" aria-label="Ordenar">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M3 6h18M7 12h10M11 18h2"/>
              </svg>
            </button>
            <label class="btn-primary" for="fileInput" role="button" tabindex="0">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M12 5v14M5 12l7-7 7 7"/>
              </svg>
              <span>Añadir ePub</span>
            </label>
            <input type="file" id="fileInput" accept=".epub" multiple hidden>

            <!-- Dropdown de ordenación -->
            <div class="sort-dropdown hidden" id="sortDropdown">
              <button data-sort="addedAt">Más recientes</button>
              <button data-sort="title">Título A–Z</button>
              <button data-sort="lastRead">Última lectura</button>
            </div>
          </div>
        </header>

        <!-- Stats bar -->
        <div class="lib-stats" id="libStats"></div>

        <!-- Grid de libros -->
        <main class="books-grid" id="booksGrid" role="list">
          <div class="skeleton-grid" id="skeletonGrid">
            ${[...Array(4)].map(() => '<div class="book-card skeleton"></div>').join('')}
          </div>
        </main>

        <!-- Empty state (oculto inicialmente) -->
        <div class="empty-state hidden" id="emptyState">
          <div class="empty-state__illustration">
            <svg viewBox="0 0 120 120" fill="none" xmlns="http://www.w3.org/2000/svg">
              <rect x="20" y="15" width="55" height="80" rx="4" fill="currentColor" opacity="0.08"/>
              <rect x="30" y="15" width="55" height="80" rx="4" fill="currentColor" opacity="0.15"/>
              <rect x="40" y="15" width="55" height="80" rx="4" fill="currentColor" opacity="0.3"/>
              <rect x="53" y="35" width="30" height="3" rx="1.5" fill="currentColor" opacity="0.5"/>
              <rect x="53" y="44" width="24" height="2.5" rx="1.25" fill="currentColor" opacity="0.3"/>
              <line x1="20" y1="105" x2="100" y2="105" stroke="currentColor" stroke-width="2" stroke-linecap="round" opacity="0.2"/>
            </svg>
          </div>
          <h2>Tu biblioteca está vacía</h2>
          <p>Importa archivos ePub para empezar<br>a leer y editar tus libros</p>
          <label class="btn-primary large" for="fileInput2" role="button" tabindex="0">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M12 5v14M5 12l7-7 7 7"/>
            </svg>
            Importar primer libro
          </label>
          <input type="file" id="fileInput2" accept=".epub" multiple hidden>
        </div>

        <!-- Toast de notificaciones -->
        <div class="toast" id="toast" role="alert" aria-live="polite"></div>
      </div>
    `;
  }

  #renderBooks() {
    const grid       = this.#container.querySelector('#booksGrid');
    const emptyState = this.#container.querySelector('#emptyState');
    const stats      = this.#container.querySelector('#libStats');
    const skeleton   = this.#container.querySelector('#skeletonGrid');

    skeleton?.remove();

    // Stats
    const total = this.#books.length;
    stats.textContent = `${total} libro${total !== 1 ? 's' : ''}`;

    if (total === 0) {
      grid.classList.add('hidden');
      emptyState.classList.remove('hidden');
      return;
    }

    grid.classList.remove('hidden');
    emptyState.classList.add('hidden');

    grid.innerHTML = this.#books.map(b => this.#cardHtml(b)).join('');

    // Event listeners en tarjetas
    grid.querySelectorAll('.book-card:not(.skeleton)').forEach(card => {
      card.addEventListener('click', e => {
        const isDelete = e.target.closest('.book-card__delete');
        const isDownload = e.target.closest('.book-card__download');
        if (isDelete || isDownload) return;

        // Si es táctil y no está activo, activamos las opciones en el primer toque
        const isTouch = window.matchMedia("(pointer: coarse)").matches;
        if (isTouch && !card.classList.contains('mobile-active')) {
          grid.querySelectorAll('.book-card.mobile-active').forEach(c => c.classList.remove('mobile-active'));
          card.classList.add('mobile-active');
          e.stopPropagation(); // Evitar que el global click lo cierre inmediatamente
          return;
        }

        this.#onBookOpen(card.dataset.id);
      });
      card.querySelector('.book-card__delete')?.addEventListener('click', e => {
        e.stopPropagation();
        this.#confirmDelete(card.dataset.id, card.dataset.title);
      });
      card.querySelector('.book-card__download')?.addEventListener('click', e => {
        e.stopPropagation();
        this.#downloadBook(card.dataset.id);
      });
    });
  }

  async #downloadBook(bookId) {
    const book = await db.get(STORES.BOOKS, bookId);
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
    this.#showToast('Descarga iniciada ✓', 'success');
  }

  #cardHtml(book) {
    const coverHtml = book.cover
      ? `<img src="${book.cover}" alt="${escapeHtml(book.title)}" class="book-card__cover-img" loading="lazy">`
      : `<div class="book-card__cover-placeholder">${escapeHtml(book.title.charAt(0).toUpperCase())}</div>`;

    const pct = book.progress ?? 0;
    const progressHtml = pct > 0
      ? `<div class="progress-bar" aria-label="${pct.toFixed(0)}% leído">
           <div class="progress-bar__fill" style="width:${pct}%"></div>
         </div>`
      : '';

    const lastReadHtml = book.lastRead
      ? `<span class="book-card__date">${formatDate(book.lastRead)}</span>`
      : '<span class="book-card__date new-badge">Nuevo</span>';

    return `
      <article class="book-card" data-id="${escapeHtml(book.id)}" data-title="${escapeHtml(book.title)}"
               role="listitem" tabindex="0" aria-label="${escapeHtml(book.title)}">
        <div class="book-card__cover">
          ${coverHtml}
          <div class="book-card__overlay">
            <span class="book-card__read-btn">Abrir</span>
          </div>
        </div>
        <div class="book-card__info">
          <h3 class="book-card__title">${escapeHtml(book.title)}</h3>
          <p class="book-card__author">${escapeHtml(book.author || 'Autor desconocido')}</p>
          ${progressHtml}
          <div class="book-card__meta">
            ${lastReadHtml}
            <span class="book-card__size">${formatSize(book.fileSize || 0)}</span>
          </div>
        </div>
        <button class="book-card__download" aria-label="Descargar ${escapeHtml(book.title)}" title="Descargar ePub">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>
          </svg>
        </button>
        <button class="book-card__delete" aria-label="Eliminar ${escapeHtml(book.title)}" title="Eliminar">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/>
            <path d="M10 11v6M14 11v6"/><path d="M9 6V4h6v2"/>
          </svg>
        </button>
      </article>
    `;
  }

  // ── Eventos ──────────────────────────────────────────────────────────────

  #bindEvents() {
    const fileInput  = this.#container.querySelector('#fileInput');
    const fileInput2 = this.#container.querySelector('#fileInput2');
    const sortBtn    = this.#container.querySelector('#sortBtn');
    const sortDrop   = this.#container.querySelector('#sortDropdown');

    fileInput?.addEventListener('change',  e => this.#handleFiles(e));
    fileInput2?.addEventListener('change', e => this.#handleFiles(e));

    sortBtn?.addEventListener('click', e => {
      e.stopPropagation();
      sortDrop?.classList.toggle('hidden');
    });

    sortDrop?.addEventListener('click', e => e.stopPropagation());

    sortDrop?.querySelectorAll('button').forEach(btn => {
      btn.addEventListener('click', () => {
        this.#sortBy = btn.dataset.sort;
        this.#sortBooks();
        this.#renderBooks();
        sortDrop.classList.add('hidden');
      });
    });

    document.addEventListener('click', this.#onGlobalClick, { passive: true });
  }

  #onGlobalClick = () => {
    const sortDrop = this.#container.querySelector('#sortDropdown');
    sortDrop?.classList.add('hidden');

    // Quitar estado activo de las tarjetas en móvil al tocar fuera
    this.#container.querySelectorAll('.book-card.mobile-active').forEach(c => c.classList.remove('mobile-active'));
  };

  // ── Carga de libros ──────────────────────────────────────────────────────

  async #loadBooks() {
    this.#books = await db.getAll(STORES.BOOKS);

    // Cargar progreso para cada libro
    const progressList = await db.getAll(STORES.PROGRESS);
    const progressMap  = Object.fromEntries(progressList.map(p => [p.bookId, p]));

    this.#books.forEach(b => {
      const prog  = progressMap[b.id];
      b.progress  = prog?.percentage ?? 0;
      b.lastRead  = prog?.lastRead   ?? b.lastRead ?? null;
    });

    this.#sortBooks();
    this.#renderBooks();
  }

  #sortBooks() {
    const map = { addedAt: (a, b) => b.addedAt - a.addedAt,
                  title:   (a, b) => a.title.localeCompare(b.title, 'es'),
                  lastRead:(a, b) => (b.lastRead || 0) - (a.lastRead || 0) };
    this.#books.sort(map[this.#sortBy] || map.addedAt);
  }

  // ── Importación ──────────────────────────────────────────────────────────

  async #handleFiles(event) {
    const files = [...event.target.files];
    event.target.value = '';
    if (!files.length) return;

    this.#showToast(`Importando ${files.length} libro${files.length > 1 ? 's' : ''}…`, 'info');

    let imported = 0;
    for (const file of files) {
      try {
        await this.#importEpub(file);
        imported++;
      } catch (err) {
        console.error('[Library] Error importando', file.name, err);
        this.#showToast(`Error al importar ${file.name}`, 'error');
      }
    }

    if (imported > 0) {
      this.#showToast(`${imported} libro${imported > 1 ? 's' : ''} importado${imported > 1 ? 's' : ''} ✓`, 'success');
      await this.#loadBooks();
    }
  }

  async #importEpub(file) {
    const arrayBuffer = await file.arrayBuffer();
    const { title, author, cover } = await parseEpubMetadata(arrayBuffer);

    await db.put(STORES.BOOKS, {
      id:       crypto.randomUUID(),
      title:    title || file.name.replace(/\.epub$/i, ''),
      author:   author || '',
      cover:    cover || null,
      file:     arrayBuffer,
      fileSize: file.size,
      addedAt:  Date.now(),
      lastRead: null,
    });
  }

  // ── Eliminación ──────────────────────────────────────────────────────────

  async #confirmDelete(bookId, title) {
    // Confirmación nativa (se puede reemplazar por un modal propio)
    if (!confirm(`¿Eliminar "${title}" de tu biblioteca?\nEsta acción no se puede deshacer.`)) return;

    await db.delete(STORES.BOOKS,    bookId);
    await db.delete(STORES.PROGRESS, bookId);
    // Borrar edits asociados
    const edits = await db.getAllByIndex(STORES.EDITS, 'bookId', bookId);
    for (const edit of edits) {
      await db.delete(STORES.EDITS, [edit.bookId, edit.chapterHref]);
    }

    this.#books = this.#books.filter(b => b.id !== bookId);
    this.#renderBooks();
    this.#showToast('Libro eliminado', 'info');
  }

  // ── Toast ────────────────────────────────────────────────────────────────

  #showToast(msg, type = 'info') {
    const toast = this.#container.querySelector('#toast');
    if (!toast) return;
    toast.textContent  = msg;
    toast.className    = `toast toast--${type} toast--visible`;
    clearTimeout(this.#toast);
    this.#toast = setTimeout(() => toast.classList.remove('toast--visible'), 3000);
  }
}
