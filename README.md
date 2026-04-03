# 📚 Librario — ePub Reader & Editor PWA

Aplicación web progresiva (PWA) para leer y editar libros en formato ePub.
Funciona en iOS, Android y escritorio como app instalada o desde el navegador.

---

## ✨ Características

### Lector
- Renderizado completo de ePub con epub.js
- Temas: Oscuro / Claro / Sepia
- Tipografía ajustable (5 fuentes, tamaño, interlineado)
- Navegación por páginas (botones, swipe en móvil, teclado)
- Tabla de contenidos (TOC)
- Guarda automáticamente el progreso por libro
- Indicador de porcentaje leído

### Editor
- Modo WYSIWYG (visual) para editar el texto sin ver código
- Modo código fuente (HTML) para edits más técnicos
- Búsqueda y reemplazo (en texto y en HTML)
- Formato de texto: negrita, cursiva, subrayado, tachado, encabezados
- Vista previa antes de guardar
- Navegación entre capítulos sin salir del editor
- Los cambios se guardan en el ePub almacenado localmente
- Indicador de cambios sin guardar (`Ctrl+S` / `⌘+S`)

### Biblioteca
- Importación de múltiples ePub a la vez
- Portadas automáticas extraídas del archivo
- Ordenación por fecha, título o última lectura
- Progreso de lectura visible en cada tarjeta
- Eliminación de libros (también borra progreso y ediciones)

### PWA
- Instalable en iOS (Safari → Añadir a pantalla inicio)
- Instalable en Android (Chrome → Añadir a pantalla inicio)
- Funciona offline tras la primera carga
- Service Worker con estrategia cache-first

---

## 🏗️ Arquitectura

```
librario/
├── index.html          # App shell: meta PWA, carga de scripts CDN
├── manifest.json       # Manifiesto PWA (iconos, nombre, colores)
├── sw.js               # Service Worker (cache, offline, actualizaciones)
├── styles.css          # Estilos globales (variables CSS, componentes)
├── icons/
│   ├── icon-192.svg    # Icono de app
│   └── icon-512.svg    # Icono de app (grande)
└── js/
    ├── app.js          # Bootstrap, Router basado en hash, gestión de vistas
    ├── db.js           # Capa de datos: abstracción de IndexedDB (Singleton)
    ├── library.js      # Vista Biblioteca: grid de libros, importación, eliminación
    ├── reader.js       # Vista Lector: epub.js, navegación, ajustes, progreso
    └── editor.js       # Vista Editor: JSZip, WYSIWYG/source, buscar/reemplazar
```

### Patrones utilizados
| Patrón | Dónde |
|--------|-------|
| **Repository** | `db.js` — abstrae IndexedDB, nunca se accede directamente desde las vistas |
| **Singleton**  | `db.js` exporta una única instancia `db` |
| **Router**     | `app.js` — hash-based router, controla el ciclo de vida de vistas |
| **Lifecycle**  | Cada vista implementa `mount()` y `unmount()` |
| **Private class fields** | `#campo` en todas las clases — encapsulación real |

### Flujo de datos
```
Usuario importa ePub
  └─> LibraryView.importEpub()
        ├─> JSZip: extrae metadatos y portada
        └─> db.put(STORES.BOOKS, {..., file: ArrayBuffer})

Usuario abre libro
  └─> ReaderView.mount(bookId)
        ├─> db.get(STORES.BOOKS, bookId) → ArrayBuffer
        ├─> db.getAllByIndex(STORES.EDITS, 'bookId') → aplica edits
        └─> ePub(buffer) → rendition.display(savedCfi)

Usuario edita capítulo
  └─> EditorView.mount(bookId, chapterHref)
        ├─> JSZip.loadAsync(buffer) → extrae HTML del capítulo
        ├─> Usuario edita WYSIWYG o código fuente
        └─> save():
              ├─> db.put(STORES.EDITS, {bookId, chapterHref, content})
              ├─> zip.file(chapterPath, newContent)
              ├─> zip.generateAsync('arraybuffer')
              └─> db.put(STORES.BOOKS, {..., file: newBuffer})
```

### IndexedDB — Esquema
| Store | Clave | Campos |
|-------|-------|--------|
| `books` | `id` (UUID) | title, author, cover (base64), file (ArrayBuffer), addedAt, fileSize |
| `progress` | `bookId` | cfi, percentage, chapter, lastRead |
| `edits` | `[bookId, chapterHref]` | content (HTML), editedAt |
| `settings` | `key` | value (any) |

---

## 🚀 Despliegue

### Opción 1 — Servidor local (desarrollo)
```bash
# Python
python3 -m http.server 8080

# Node.js (npx)
npx serve .

# Luego abre http://localhost:8080
```

> ⚠️ **Importante**: Los módulos ES (`type="module"`) y el Service Worker
> requieren un servidor HTTP. **No funciona abriendo index.html directamente** con `file://`.

### Opción 2 — GitHub Pages (gratis)
1. Crea un repositorio en GitHub
2. Sube todos los archivos
3. Activa Pages en Settings → Pages → Branch: main
4. URL: `https://tuusuario.github.io/librario/`

### Opción 3 — Netlify / Vercel (gratis)
1. Arrastra la carpeta a netlify.com/drop
2. URL generada automáticamente

### Instalar como app móvil
**iOS (Safari):**
1. Abre la URL en Safari
2. Toca el botón compartir (□↑)
3. "Añadir a la pantalla de inicio"

**Android (Chrome):**
1. Abre la URL en Chrome
2. Toca los 3 puntos → "Añadir a pantalla inicio"
3. O espera la notificación automática de instalación

---

## 📦 Dependencias externas (CDN)

| Librería | Versión | Uso |
|----------|---------|-----|
| [epub.js](https://github.com/futurepress/epub.js/) | 0.3.93 | Renderizado y navegación de ePub |
| [JSZip](https://stuk.github.io/jszip/) | 3.10.1 | Lectura/escritura del archivo ePub (ZIP) |
| Google Fonts | — | Cormorant Garamond, DM Sans, DM Mono |

Sin framework, sin bundler, sin proceso de build. Vanilla JS con ES Modules nativos.

---

## 🔧 Personalización

### Añadir un nuevo tema de lectura
En `reader.js`, añade al objeto `THEMES`:
```js
const THEMES = {
  // ... temas existentes
  midnight: { bg: '#0d0d1a', fg: '#c8c8e0', link: '#7c7cff' },
};
```
Y en `styles.css`, añade:
```css
.reader-view.theme-midnight { background: #0d0d1a; --rt-header-bg: #0d0d1a; --rt-border: #2a2a40; --rt-text: #c8c8e0; }
```

### Añadir soporte a otros formatos
El editor soporta cualquier archivo HTML dentro del ePub. Para `.txt`:
1. Convierte `.txt` a `.epub` con Calibre o Pandoc antes de importar.

---

## 🗒️ Notas técnicas

- Los libros se almacenan completos en IndexedDB como `ArrayBuffer`.
  Libros muy grandes (>50 MB) pueden ser lentos dependiendo del dispositivo.
- Las ediciones se guardan como overrides por capítulo; el archivo ePub
  completo se regenera con JSZip al guardar.
- epub.js inyecta el contenido en un `<iframe>` gestionado por él;
  los estilos del lector se aplican mediante `rendition.themes.default()`.
- El Service Worker cachea los assets estáticos en la instalación y
  los recursos CDN en el primer uso; posteriores visitas son offline-first.

---
## imagenes
<img width="1911" height="916" alt="image" src="https://github.com/user-attachments/assets/37fbfa05-12bd-4e6f-9b3a-36bbf9a62399" />


## 📄 Licencia
MIT — libre para uso personal y comercial.
