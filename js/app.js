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

    // Comprobar actualización al cargar y cada vez que la pestaña gane foco
    const checkUpdate = () => {
      reg.update().catch(err => console.warn('[App] Error actualizando SW:', err));
    };

    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') checkUpdate();
    });

    // 1. Si ya hay un worker esperando ser activado, mostrar el banner
    if (reg.waiting) {
      showUpdateBanner(reg.waiting);
    }

    // 2. Escuchar futuras actualizaciones
    reg.addEventListener('updatefound', () => {
      const newSW = reg.installing;
      newSW?.addEventListener('statechange', () => {
        // Solo mostrar cuando el worker termine de instalarse (pase a 'installed')
        if (newSW.state === 'installed' && navigator.serviceWorker.controller) {
          showUpdateBanner(newSW);
        }
      });
    });

    // 3. Recargar automáticamente cuando el nuevo Service Worker tome el control
    let refreshing = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (!refreshing) {
        refreshing = true;
        window.location.reload();
      }
    });

  } catch (err) {
    console.warn('[App] Error registrando SW:', err);
  }
}

function showUpdateBanner(worker) {
  // Evitar duplicados
  if (document.querySelector('.update-banner')) return;

  const banner = document.createElement('div');
  banner.className = 'update-banner';
  banner.innerHTML = `
    <span>Hay una nueva versión de Librario disponible</span>
    <button id="reloadBtn">Actualizar ahora</button>
  `;
  document.body.appendChild(banner);

  banner.querySelector('#reloadBtn')?.addEventListener('click', () => {
    // Mandar señal al worker esperando para que tome el control
    worker.postMessage({ type: 'SKIP_WAITING' });
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
  #currentParams = null;

  constructor() {
    this.#root = document.getElementById('app');
  }

  start() {
    // Inicializar router basado en hash/state
    window.addEventListener('popstate', () => this.#handleRoute());
    this.#handleRoute();
  }

  // ── Routing ──────────────────────────────────────────────────────────────

  #handleRoute() {
    const hash = window.location.hash.slice(1); // eliminar '#'
    const [route, ...params] = hash.split('/');

    let targetRoute = ROUTES.LIBRARY;
    let targetParams = {};

    if (route === ROUTES.READER && params[0]) {
      targetRoute = ROUTES.READER;
      targetParams = { bookId: params[0] };
    } else if (route === ROUTES.EDITOR && params[0]) {
      const chapterHref = decodeURIComponent(params.slice(1).join('/'));
      targetRoute = ROUTES.EDITOR;
      targetParams = { bookId: params[0], chapterHref };
    }

    this.#navigate(targetRoute, targetParams);
  }

  async #navigate(route, params = {}) {
    // Si la ruta y los parámetros principales (bookId) son iguales, es un cambio interno
    const isSameView = this.#currentRoute === route && this.#currentParams?.bookId === params.bookId;
    
    // Si es exactamente la misma ruta y params (incluyendo capítulo), no hacemos nada
    if (isSameView && this.#currentParams?.chapterHref === params.chapterHref) return;

    // Desmontar vista actual si cambiamos de tipo de vista
    if (this.#currentView?.unmount && this.#currentRoute !== route) {
      await this.#currentView.unmount();
      this.#currentView = null;
    }

    this.#currentRoute = route;
    this.#currentParams = { ...params };
    this.#root.className = `view-${route}`;

    // Animación solo si cambiamos de vista principal
    if (!isSameView) {
      this.#root.classList.add('view-entering');
      requestAnimationFrame(() => this.#root.classList.remove('view-entering'));
    }

    try {
      switch (route) {
        case ROUTES.LIBRARY:
          if (!this.#currentView) {
            this.#currentView = new LibraryView(this.#root, {
              onBookOpen: (bookId) => this.#goToReader(bookId),
            });
            await this.#currentView.mount();
          }
          break;

        case ROUTES.READER:
          if (!this.#currentView) {
            this.#currentView = new ReaderView(this.#root, {
              onBack: () => this.#goToLibrary(),
              onEdit: (bookId, chapterHref) => this.#goToEditor(bookId, chapterHref),
            });
            await this.#currentView.mount(params.bookId);
          }
          break;

        case ROUTES.EDITOR:
          if (!this.#currentView) {
            this.#currentView = new EditorView(this.#root, {
              onBack:         () => this.#goToReader(params.bookId),
              onReadChapter:  () => this.#goToReader(params.bookId),
            });
            await this.#currentView.mount(params.bookId, params.chapterHref);
          } else if (isSameView) {
            // Si ya estamos en el editor y solo cambia el capítulo, notificamos a la vista
            // (Asumiendo que mount puede manejar recargas o implementando un método update)
            await this.#currentView.mount(params.bookId, params.chapterHref);
          }
          break;

        default:
          this.#goToLibrary();
      }
    } catch (err) {
      console.error('[App] Navigation error:', err);
      // Fallback a la biblioteca
      if (route !== ROUTES.LIBRARY) this.#goToLibrary();
    }
  }

  // ── Navegación con gestión de historial ──────────────────────────────────

  #updateHash(newHash, replace = false) {
    if (replace) {
      history.replaceState(null, '', `#${newHash}`);
    } else {
      location.hash = newHash;
    }
  }

  #goToLibrary() {
    // Si estamos en Reader, volver atrás en el historial es mejor para Android
    if (this.#currentRoute === ROUTES.READER) {
      history.back();
    } else {
      this.#updateHash('', true);
      this.#handleRoute();
    }
  }

  #goToReader(bookId) {
    const newHash = `${ROUTES.READER}/${bookId}`;
    // Si venimos del Editor, volvemos atrás
    if (this.#currentRoute === ROUTES.EDITOR) {
      history.back();
    } else {
      this.#updateHash(newHash);
    }
  }

  #goToEditor(bookId, chapterHref) {
    const enc = chapterHref ? `/${encodeURIComponent(chapterHref)}` : '';
    const newHash = `${ROUTES.EDITOR}/${bookId}${enc}`;
    
    // Si ya estamos en Editor y cambiamos de capítulo, usamos replaceState
    if (this.#currentRoute === ROUTES.EDITOR) {
      this.#updateHash(newHash, true);
      this.#handleRoute();
    } else {
      this.#updateHash(newHash);
    }
  }
}

// ─── Bootstrap ─────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', () => {
  registerSW();
  const app = new App();
  app.start();
});
