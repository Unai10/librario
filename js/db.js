/**
 * db.js — Capa de acceso a datos (IndexedDB)
 * Patrón Repository: abstrae completamente la API de IndexedDB
 */

const DB_NAME    = 'librario-db';
const DB_VERSION = 1;

export const STORES = Object.freeze({
  BOOKS:    'books',
  PROGRESS: 'progress',
  EDITS:    'edits',
  SETTINGS: 'settings',
});

// ─── Schema ────────────────────────────────────────────────────────────────
/**
 * books:    { id, title, author, cover(base64?), file(ArrayBuffer), addedAt, fileSize }
 * progress: { bookId, cfi, percentage, chapter, lastRead }
 * edits:    { bookId, chapterHref, content, editedAt }  — unique por [bookId+chapterHref]
 * settings: { key, value }
 */
function onUpgradeNeeded(event) {
  const db = event.target.result;

  if (!db.objectStoreNames.contains(STORES.BOOKS)) {
    const books = db.createObjectStore(STORES.BOOKS, { keyPath: 'id' });
    books.createIndex('addedAt', 'addedAt', { unique: false });
    books.createIndex('title',   'title',   { unique: false });
  }

  if (!db.objectStoreNames.contains(STORES.PROGRESS)) {
    db.createObjectStore(STORES.PROGRESS, { keyPath: 'bookId' });
  }

  if (!db.objectStoreNames.contains(STORES.EDITS)) {
    const edits = db.createObjectStore(STORES.EDITS, { keyPath: ['bookId', 'chapterHref'] });
    edits.createIndex('bookId', 'bookId', { unique: false });
  }

  if (!db.objectStoreNames.contains(STORES.SETTINGS)) {
    db.createObjectStore(STORES.SETTINGS, { keyPath: 'key' });
  }
}

// ─── DBService Singleton ───────────────────────────────────────────────────
class DBService {
  #db = null;

  /** Abre (o reutiliza) la conexión a la base de datos */
  open() {
    if (this.#db) return Promise.resolve(this.#db);

    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = onUpgradeNeeded;
      req.onsuccess  = e => { this.#db = e.target.result; resolve(this.#db); };
      req.onerror    = () => reject(req.error);
      req.onblocked  = () => {
        console.warn('[DB] Conexión bloqueada por otra pestaña');
        reject(new Error('IndexedDB blocked'));
      };
    });
  }

  /** Devuelve un object store dentro de una transacción */
  async #store(storeName, mode = 'readonly') {
    const db = await this.open();
    return db.transaction(storeName, mode).objectStore(storeName);
  }

  /** Devuelve un único registro por clave primaria */
  async get(storeName, key) {
    const store = await this.#store(storeName);
    return this.#promisify(store.get(key));
  }

  /** Devuelve todos los registros de un store */
  async getAll(storeName) {
    const store = await this.#store(storeName);
    return this.#promisify(store.getAll());
  }

  /** Devuelve todos los registros que coinciden con un índice */
  async getAllByIndex(storeName, indexName, value) {
    const store = await this.#store(storeName);
    const index = store.index(indexName);
    return this.#promisify(index.getAll(value));
  }

  /** Inserta o actualiza un registro */
  async put(storeName, value) {
    const store = await this.#store(storeName, 'readwrite');
    return this.#promisify(store.put(value));
  }

  /** Elimina un registro por clave primaria */
  async delete(storeName, key) {
    const store = await this.#store(storeName, 'readwrite');
    return this.#promisify(store.delete(key));
  }

  /** Elimina todos los registros de un store */
  async clear(storeName) {
    const store = await this.#store(storeName, 'readwrite');
    return this.#promisify(store.clear());
  }

  /** Cuenta los registros de un store */
  async count(storeName) {
    const store = await this.#store(storeName);
    return this.#promisify(store.count());
  }

  /** Convierte una IDBRequest en Promise */
  #promisify(request) {
    return new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror   = () => reject(request.error);
    });
  }
}

// Exportar instancia única (Singleton)
export const db = new DBService();
