/**
 * app.js — Punto de entrada principal de Librario PWA
 * Patrón: Router simple + gestión de ciclo de vida de vistas
 */

import { LibraryView } from './library.js';
import { ReaderView   } from './reader.js';
import { EditorView   } from './editor.js';

// ─── Registro del Service Worker ───────────────────────────────────────────

async function registerSW() {
  if (!('serviceWorker' in navigator)) return;
  try {
    const reg = await navigator.serviceWorker.register('./sw.js', { scope: './' });
    console.log('[App] Service Worker registrado:', reg.scope);

    // Escuchar actualizaciones
    reg.addEventListener('updatefound', () => {
      const newSW = reg.installing;
      newSW?.addEventListener('statechange', () => {
        if (newSW.state === 'installed' && navigator.serviceWorker.controller) {
          showUpdateBanner();
        }
      });
    });
  } catch (err) {
    console.warn('[App] Error registrando SW:', err);
  }
}

function showUpdateBanner() {
  const banner = document.createElement('div');
  banner.className = 'update-banner';
  banner.innerHTML = `
    <span>Nueva versión disponible</span>
    <button id="reloadBtn">Actualizar</button>
  `;
  document.body.appendChild(banner);
  banner.querySelector('#reloadBtn')?.addEventListener('click', () => {
    navigator.serviceWorker.controller?.postMessage({ type: 'SKIP_WAITING' });
    window.location.reload();
  });
}

// ─── Router ────────────────────────────────────────────────────────────────

const ROUTES = Object.freeze({
  LIBRARY: 'library',
  READER:  'reader',
  EDITOR:  'editor',
});

class App {
  #root;
  #currentView = null;
  #currentRoute = null;

  constructor() {
    this.#root = document.getElementById('app');
  }

  start() {
    // Inicializar router basado en hash
    window.addEventListener('hashchange', () => this.#handleRoute());
    this.#handleRoute();
  }

  // ── Routing ──────────────────────────────────────────────────────────────

  #handleRoute() {
    const hash   = window.location.hash.slice(1); // eliminar '#'
    const [route, ...params] = hash.split('/');

    if (route === ROUTES.READER && params[0]) {
      this.#navigate(ROUTES.READER, { bookId: params[0] });
    } else if (route === ROUTES.EDITOR && params[0]) {
      const chapterHref = decodeURIComponent(params.slice(1).join('/'));
      this.#navigate(ROUTES.EDITOR, { bookId: params[0], chapterHref });
    } else {
      this.#navigate(ROUTES.LIBRARY);
    }
  }

  async #navigate(route, params = {}) {
    if (this.#currentRoute === route) return;

    // Desmontar vista actual
    if (this.#currentView?.unmount) {
      await this.#currentView.unmount();
    }

    this.#currentRoute = route;
    this.#root.className = `view-${route}`;

    // Añadir clase de transición
    this.#root.classList.add('view-entering');
    requestAnimationFrame(() => this.#root.classList.remove('view-entering'));

    try {
      switch (route) {
        case ROUTES.LIBRARY:
          this.#currentView = new LibraryView(this.#root, {
            onBookOpen: (bookId) => this.#goToReader(bookId),
          });
          await this.#currentView.mount();
          break;

        case ROUTES.READER:
          this.#currentView = new ReaderView(this.#root, {
            onBack: () => this.#goToLibrary(),
            onEdit: (bookId, chapterHref) => this.#goToEditor(bookId, chapterHref),
          });
          await this.#currentView.mount(params.bookId);
          break;

        case ROUTES.EDITOR:
          this.#currentView = new EditorView(this.#root, {
            onBack:         () => this.#goToReader(params.bookId),
            onReadChapter:  () => this.#goToReader(params.bookId),
          });
          await this.#currentView.mount(params.bookId, params.chapterHref);
          break;

        default:
          this.#goToLibrary();
      }
    } catch (err) {
      console.error('[App] Navigation error:', err);
      alert(`Error de navegación: ${err.message}`);
      // Fallback a la biblioteca si algo falla catastróficamente
      if (route !== ROUTES.LIBRARY) this.#goToLibrary();
    }
  }

  // ── Navegación pública ───────────────────────────────────────────────────

  #goToLibrary() {
    window.location.hash = '';
    this.#navigate(ROUTES.LIBRARY);
  }

  #goToReader(bookId) {
    window.location.hash = `${ROUTES.READER}/${bookId}`;
  }

  #goToEditor(bookId, chapterHref) {
    const enc = chapterHref ? `/${encodeURIComponent(chapterHref)}` : '';
    window.location.hash = `${ROUTES.EDITOR}/${bookId}${enc}`;
  }
}

// ─── Bootstrap ─────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', () => {
  registerSW();
  const app = new App();
  app.start();
});
