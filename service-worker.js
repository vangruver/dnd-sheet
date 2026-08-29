// ============================================================
// Service worker da casca do app (PWA instalável)
// ------------------------------------------------------------
// Só cacheia os arquivos do próprio site (HTML/JS/CSS/ícones), pra a
// ficha abrir offline e ser instalável no celular/desktop. Os dados do
// 5etools (raw.githubusercontent.com / cdn.jsdelivr.net) e as fontes do
// Google NÃO passam por aqui — eles já têm seu próprio cache em
// IndexedDB com TTL de 7 dias na camada de dados (src/store.js) e um
// botão "Atualizar dados" próprio; interceptar aqui também só criaria
// uma segunda cópia desatualizada por cima da primeira.
// ============================================================
// Subir a versão invalida a casca cacheada — necessário sempre que
// HTML/CSS/JS mudam de forma visível (aqui: os quatro temas e a barra
// do topo agrupada em menus).
const CACHE_NAME = "dnd-ficha-shell-v2";
const CORE_ASSETS = [
  "./",
  "./index.html",
  "./manifest.json",
  "./assets/style.css",
  "./src/app.js",
  "./src/database.js",
  "./src/rules.js",
  "./src/sources.js",
  "./src/storage.js",
  "./src/store.js",
  "./assets/icons/icon-192.png",
  "./assets/icons/icon-512.png",
  "./assets/icons/icon-maskable-512.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(CORE_ASSETS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// Network-first com fallback pro cache: mantém a casca atualizada
// sempre que há conexão, e permite abrir a ficha offline (voltando pro
// index.html em caso de navegação sem cache exato, ex.: refresh numa
// URL com hash/query).
self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  event.respondWith(
    fetch(req)
      .then((res) => {
        if (res && res.ok) {
          const copy = res.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(req, copy));
        }
        return res;
      })
      .catch(() => caches.match(req).then((cached) => cached || caches.match("./index.html")))
  );
});
