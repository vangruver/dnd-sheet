// ============================================================
// Camada de rede + cache
// ------------------------------------------------------------
// getJson(path) -> baixa data/<path> do 5etools (com fallback
// para jsDelivr), guarda em IndexedDB e devolve o objeto.
// Leituras seguintes vêm do cache até expirar o TTL.
// ============================================================

import { DATA_BASES, LOCAL_DATA_BASE } from "./sources.js";

const DB_NAME = "dnd5e-cache";
const STORE = "files";
const TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 dias
const MAX_PARALLEL = 6;

let dbPromise = null;
function openDb() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    if (!("indexedDB" in window)) { resolve(null); return; }
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: "path" });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => resolve(null); // degradar sem cache
  });
  return dbPromise;
}

async function cacheGet(path) {
  const db = await openDb();
  if (!db) return null;
  return new Promise((resolve) => {
    const tx = db.transaction(STORE, "readonly");
    const req = tx.objectStore(STORE).get(path);
    req.onsuccess = () => {
      const row = req.result;
      if (!row) return resolve(null);
      if (Date.now() - row.savedAt > TTL_MS) return resolve(null);
      resolve(row.data);
    };
    req.onerror = () => resolve(null);
  });
}

async function cachePut(path, data) {
  const db = await openDb();
  if (!db) return;
  try {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).put({ path, data, savedAt: Date.now() });
  } catch { /* quota / modo privado: ignora */ }
}

export async function clearCache() {
  const db = await openDb();
  if (!db) return;
  await new Promise((resolve) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).clear();
    tx.oncomplete = () => resolve();
    tx.onerror = () => resolve();
  });
  memory.clear();
}

// Cache em memória para a sessão atual (evita reparse do IndexedDB).
const memory = new Map();
const inflight = new Map();

// Fila de concorrência simples.
let active = 0;
const queue = [];
function schedule(task) {
  return new Promise((resolve, reject) => {
    queue.push({ task, resolve, reject });
    pump();
  });
}
function pump() {
  while (active < MAX_PARALLEL && queue.length) {
    const { task, resolve, reject } = queue.shift();
    active++;
    task().then(resolve, reject).finally(() => { active--; pump(); });
  }
}

// Alguns nomes de arquivo (principalmente do homebrew) trazem
// espaços, ponto-e-vírgula, apóstrofo etc. — precisam ir
// codificados na URL, segmento por segmento (preservando "/").
function encodePath(path) {
  return String(path).split("/").map(encodeURIComponent).join("/");
}

async function fetchJson(path, bases) {
  let lastErr;
  for (const base of bases) {
    try {
      const res = await fetch(base + encodePath(path), { mode: "cors" });
      if (!res.ok) { lastErr = new Error(`HTTP ${res.status} — ${base + path}`); continue; }
      return await res.json();
    } catch (err) { lastErr = err; }
  }
  throw lastErr || new Error(`Falha ao baixar ${path}`);
}

function makeLoader(bases, keyPrefix) {
  async function getJson(path) {
    path = String(path).replace(/^\.?\/*/, "");
    const key = keyPrefix + path;
    if (memory.has(key)) return memory.get(key);
    if (inflight.has(key)) return inflight.get(key);

    const p = (async () => {
      const cached = await cacheGet(key);
      if (cached != null) { memory.set(key, cached); return cached; }
      const data = await schedule(() => fetchJson(path, bases));
      memory.set(key, data);
      cachePut(key, data);
      return data;
    })();

    inflight.set(key, p);
    try { return await p; }
    finally { inflight.delete(key); }
  }
  async function tryJson(path) {
    try { return await getJson(path); }
    catch { return null; }
  }
  return { getJson, tryJson };
}

// Banco oficial (5etools, via GitHub raw / jsDelivr) — path relativo
// a data/, ex.: "class/class-wizard.json".
const official = makeLoader(DATA_BASES, "");
export const getJson = official.getJson;
export const tryJson = official.tryJson;

// Banco "local" (este mesmo repositório, atualizado todo dia pelo
// workflow de sincronização — inclui o homebrew do TheGiddyLimit).
const local = makeLoader([LOCAL_DATA_BASE], "local:");
export const getLocalJson = local.getJson;
export const tryLocalJson = local.tryJson;

// data/version.json é pequeno e é a nossa "sonda" de atualização:
// buscamos sempre fresco (sem cache de HTTP nem de IndexedDB) para
// saber, a cada carregamento da página, se o banco foi atualizado
// desde a última visita.
export async function getVersionInfo() {
  const res = await fetch(LOCAL_DATA_BASE + "version.json?t=" + Date.now(), { mode: "cors", cache: "no-store" });
  if (!res.ok) throw new Error(`HTTP ${res.status} — version.json`);
  return await res.json();
}
