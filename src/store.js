// ============================================================
// Camada de rede + cache
// ------------------------------------------------------------
// getJson(path) -> baixa data/<path> do 5etools (com fallback
// para jsDelivr), guarda em IndexedDB e devolve o objeto.
// Leituras seguintes vêm do cache até expirar o TTL.
// ============================================================

import { DATA_BASES } from "./sources.js";

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

async function fetchJson(path) {
  let lastErr;
  for (const base of DATA_BASES) {
    try {
      const res = await fetch(base + path, { mode: "cors" });
      if (!res.ok) { lastErr = new Error(`HTTP ${res.status} — ${base + path}`); continue; }
      return await res.json();
    } catch (err) { lastErr = err; }
  }
  throw lastErr || new Error(`Falha ao baixar ${path}`);
}

// path relativo a data/, ex.: "class/class-wizard.json"
export async function getJson(path) {
  path = String(path).replace(/^\.?\/*/, "");
  if (memory.has(path)) return memory.get(path);
  if (inflight.has(path)) return inflight.get(path);

  const p = (async () => {
    const cached = await cacheGet(path);
    if (cached != null) { memory.set(path, cached); return cached; }
    const data = await schedule(() => fetchJson(path));
    memory.set(path, data);
    cachePut(path, data);
    return data;
  })();

  inflight.set(path, p);
  try { return await p; }
  finally { inflight.delete(path); }
}

// Tenta baixar; devolve null em vez de lançar (para arquivos opcionais).
export async function tryJson(path) {
  try { return await getJson(path); }
  catch { return null; }
}
