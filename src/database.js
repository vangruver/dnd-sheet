// ============================================================
// Banco de dados D&D 5e — leitura direta do 5etools no GitHub
// ------------------------------------------------------------
// Expõe para o app.js uma API parecida com a das versões
// antigas (manifestEntries / filterEntities / recordsForEntity
// / findClassFeatures / ...), porém sem manifesto gigante:
// os catálogos são baixados sob demanda e ficam em cache.
// ============================================================

import { getJson, tryJson } from "./store.js";
import { editionOf as editionOfRec, editionMatches } from "./sources.js";

// ------------------------------------------------------------
// Tipos
// ------------------------------------------------------------
const TYPE_ALIASES = {
  class: "class", classes: "class",
  subclass: "subclass", subclasses: "subclass",
  race: "race", races: "race", species: "race",
  background: "background", backgrounds: "background",
  spell: "spell", spells: "spell",
  feat: "feat", feats: "feat",
  item: "item", items: "item", baseitem: "item", baseitems: "item",
  optionalfeature: "optionalfeature", optionalfeatures: "optionalfeature",
  classfeature: "classFeature", classfeatures: "classFeature",
  subclassfeature: "subclassFeature", subclassfeatures: "subclassFeature",
};
export const normType = (t) => TYPE_ALIASES[String(t || "").toLowerCase()] || String(t || "");

const CATALOG_FILE = {
  race: "races.json",
  background: "backgrounds.json",
  feat: "feats.json",
  optionalfeature: "optionalfeatures.json",
};

// ------------------------------------------------------------
// Registro em memória
// ------------------------------------------------------------
const registry = new Map();     // id -> stub
const loaded = new Set();        // tipos/catálogos já carregados
const classFiles = new Map();    // "className|classSource" -> arquivo de classe parseado
let listCache = null;

function edId(parts) { return parts.map((p) => String(p ?? "").trim()).join("|"); }
function invalidate() { listCache = null; }

function register(stub) {
  if (!stub || !stub.id) return stub;
  const prev = registry.get(stub.id);
  registry.set(stub.id, prev ? { ...prev, ...stub } : stub);
  invalidate();
  return registry.get(stub.id);
}

export function isHomebrew(x) {
  return !!(x && (x.homebrew || x._isBrew || x.brew));
}
export function editionOf(x) {
  // stub já traz string "2014"/"2024"; registro cru é derivado.
  if (x && (x.edition === "2014" || x.edition === "2024")) return x.edition;
  return editionOfRec(x);
}

// ------------------------------------------------------------
// _copy (herança) — resolução mínima para races/backgrounds
// ------------------------------------------------------------
function indexByNameSource(arr) {
  const m = new Map();
  for (const o of arr || []) m.set(`${String(o.name).toLowerCase()}|${String(o.source).toLowerCase()}`, o);
  return m;
}
function resolveCopies(arr) {
  if (!Array.isArray(arr)) return [];
  const idx = indexByNameSource(arr);
  return arr.map((o) => {
    if (!o || !o._copy) return o;
    const key = `${String(o._copy.name).toLowerCase()}|${String(o._copy.source).toLowerCase()}`;
    const base = idx.get(key);
    if (!base) return o;
    const merged = { ...base, ...o };
    delete merged._copy;
    delete merged._mod; // _mod não é aplicado nesta versão
    return merged;
  });
}

// ------------------------------------------------------------
// Carga de catálogos
// ------------------------------------------------------------
export async function ensureCatalog(type, onProgress) {
  type = normType(type);
  if (type === "subclass") type = "class";
  if (loaded.has(type)) return;

  if (type === "class") { await loadAllClasses(onProgress); loaded.add("class"); return; }
  if (type === "spell") { await loadSpellCatalog(onProgress); loaded.add("spell"); return; }
  if (type === "item") { await loadItemCatalog(onProgress); loaded.add("item"); return; }

  const file = CATALOG_FILE[type];
  if (!file) return;
  const json = await getJson(file);
  const key = Object.keys(json).find((k) => Array.isArray(json[k]) && k !== "_meta") || type;
  const arr = resolveCopies(json[key] || []);
  for (const rec of arr) {
    const source = rec.source || "";
    register({
      id: edId([type, source, rec.name]),
      type, name: rec.name, source,
      edition: editionOfRec(rec),
      homebrew: false,
      __rec: rec,
    });
  }
  loaded.add(type);
}

async function loadAllClasses(onProgress) {
  const index = await getJson("class/index.json"); // { wizard: "class-wizard.json", ... }
  const files = Object.values(index);
  let done = 0;
  await Promise.all(files.map(async (fname) => {
    const file = await tryJson(`class/${fname}`);
    done++; onProgress && onProgress(done, files.length);
    if (!file) return;
    registerClassFile(file);
  }));
}

function registerClassFile(file) {
  for (const cls of file.class || []) {
    const csrc = cls.source || "";
    classFiles.set(`${String(cls.name).toLowerCase()}|${String(csrc).toLowerCase()}`, { cls, file });
    register({
      id: edId(["class", csrc, cls.name]),
      type: "class", name: cls.name, source: csrc,
      edition: editionOfRec(cls), homebrew: false,
      __rec: cls, __file: file,
    });
  }
  for (const sub of file.subclass || []) {
    const csrc = sub.classSource || "";
    const ssrc = sub.source || "";
    register({
      id: edId(["subclass", ssrc, sub.className, sub.shortName || sub.name]),
      type: "subclass",
      name: sub.name,
      source: ssrc,
      className: sub.className || "",
      classSource: csrc,
      shortName: sub.shortName || sub.name,
      edition: editionOfRec(sub.edition ? sub : { source: ssrc }),
      homebrew: false,
      __rec: sub, __file: file,
    });
  }
}

// Garante que o arquivo da classe indicada está carregado.
async function ensureClassFile(name, source) {
  const key = `${String(name).toLowerCase()}|${String(source).toLowerCase()}`;
  if (classFiles.has(key)) return classFiles.get(key);
  // procura no index pelo slug
  const index = await getJson("class/index.json");
  const slug = String(name).toLowerCase().replace(/[^a-z]/g, "");
  const fname = index[slug] || index[String(name).toLowerCase()];
  if (fname) {
    const file = await tryJson(`class/${fname}`);
    if (file) { registerClassFile(file); return classFiles.get(key); }
  }
  return null;
}

// ------------------------------------------------------------
// Magias
// ------------------------------------------------------------
let spellIndex = null;      // { PHB: "spells-phb.json", ... }
let spellSources = null;    // sources.json bruto
const spellFileCache = new Map(); // source -> [spell records]

async function loadSpellCatalog(onProgress) {
  spellIndex = spellIndex || await getJson("spells/index.json");
  const sources = Object.keys(spellIndex);
  let done = 0;
  await Promise.all(sources.map(async (src) => {
    const arr = await loadSpellFile(src);
    done++; onProgress && onProgress(done, sources.length);
    for (const sp of arr) {
      register({
        id: edId(["spell", sp.source, sp.name]),
        type: "spell", name: sp.name, source: sp.source || "",
        level: sp.level ?? 0,
        edition: editionOfRec(sp),
        homebrew: false, __rec: sp,
      });
    }
  }));
}

async function loadSpellFile(src) {
  if (spellFileCache.has(src)) return spellFileCache.get(src);
  spellIndex = spellIndex || await getJson("spells/index.json");
  const fname = spellIndex[src];
  if (!fname) { spellFileCache.set(src, []); return []; }
  const json = await tryJson(`spells/${fname}`);
  const arr = (json && json.spell) || [];
  spellFileCache.set(src, arr);
  return arr;
}

// Lista de magias de uma classe, para a edição escolhida.
export async function spellsForClass(classStub, subclassStub, edition) {
  if (!classStub) return [];
  spellSources = spellSources || await getJson("spells/sources.json");
  spellIndex = spellIndex || await getJson("spells/index.json");

  const className = String(classStub.name);
  const classSrcWanted = edition === "2024" ? "XPHB" : "PHB";
  const subName = subclassStub ? String(subclassStub.shortName || subclassStub.name) : null;

  const wanted = []; // { name, bookSource }
  for (const [bookSource, spells] of Object.entries(spellSources)) {
    for (const [spellName, info] of Object.entries(spells)) {
      const refs = [].concat(info.class || [], info.classVariant || [], info.subclass || []);
      const hit = refs.some((r) => {
        if (!r) return false;
        const n = String(r.name || r.className || "");
        const s = String(r.source || r.classSource || "");
        if (n.toLowerCase() === className.toLowerCase()) {
          return !s || s === classSrcWanted || (edition === "2014" && s === "PHB") || (edition === "2024" && s === "XPHB");
        }
        if (subName && String(r.subclass?.name || r.subclassShortName || "").toLowerCase() === subName.toLowerCase()) return true;
        return false;
      });
      if (hit) wanted.push({ name: spellName, bookSource });
    }
  }

  // baixa só os arquivos de magia necessários
  const bySource = new Map();
  for (const w of wanted) {
    if (!bySource.has(w.bookSource)) bySource.set(w.bookSource, await loadSpellFile(w.bookSource));
  }

  const out = [];
  const seen = new Set();
  for (const w of wanted) {
    const arr = bySource.get(w.bookSource) || [];
    const rec = arr.find((s) => String(s.name).toLowerCase() === w.name.toLowerCase());
    if (!rec) continue;
    if (!editionMatches(rec, edition) && rec.source !== w.bookSource) { /* mantém */ }
    const key = `${rec.name}|${rec.source}`;
    if (seen.has(key)) continue;
    seen.add(key);
    register({
      id: edId(["spell", rec.source, rec.name]),
      type: "spell", name: rec.name, source: rec.source || "",
      level: rec.level ?? 0, edition: editionOfRec(rec), homebrew: false, __rec: rec,
    });
    out.push(rec);
  }
  out.sort((a, b) => (a.level ?? 0) - (b.level ?? 0) || String(a.name).localeCompare(String(b.name), "pt-BR"));
  return out;
}

// ------------------------------------------------------------
// Itens
// ------------------------------------------------------------
async function loadItemCatalog(onProgress) {
  const files = ["items.json", "items-base.json"];
  let done = 0;
  for (const f of files) {
    const json = await tryJson(f);
    done++; onProgress && onProgress(done, files.length);
    if (!json) continue;
    const arr = [].concat(json.item || [], json.baseitem || []);
    for (const it of arr) {
      register({
        id: edId(["item", it.source, it.name]),
        type: "item", name: it.name, source: it.source || "",
        edition: editionOfRec(it), homebrew: false, __rec: it,
      });
    }
  }
}

// ------------------------------------------------------------
// Consulta
// ------------------------------------------------------------
export function manifestEntries() {
  if (!listCache) listCache = [...registry.values()];
  return listCache;
}

export function filterEntities(type, edition, content = "all", query = "") {
  type = normType(type);
  const q = String(query || "").trim().toLowerCase();
  return manifestEntries()
    .filter((x) => {
      if (normType(x.type) !== type) return false;
      if (edition && editionOf(x) !== String(edition)) return false;
      const hb = isHomebrew(x);
      if (content === "official" && hb) return false;
      if (content === "homebrew" && !hb) return false;
      if (q && !String(x.name || "").toLowerCase().includes(q) && !String(x.source || "").toLowerCase().includes(q)) return false;
      return true;
    })
    .sort((a, b) => Number(isHomebrew(a)) - Number(isHomebrew(b)) || String(a.name || "").localeCompare(String(b.name || ""), "pt-BR"));
}

export function recordsForEntity(e) {
  if (!e) return [];
  if (e.__rec) return [e.__rec];
  const s = registry.get(e.id);
  return s && s.__rec ? [s.__rec] : [];
}
export const getRecordArrays = recordsForEntity;
export async function loadEntity(e) { return recordsForEntity(e)[0] || e; }

// ------------------------------------------------------------
// Características de classe / subclasse por nível
// ------------------------------------------------------------
function parseFeatureRef(ref) {
  // "Name|Class|ClassSource|Level|FeatureSource"
  const p = String(ref).split("|");
  return { name: p[0], className: p[1], classSource: p[2] || "", level: Number(p[3] || 0), featureSource: p[4] || "" };
}
function parseSubFeatureRef(ref) {
  // "Name|Class|ClassSource|SubShort|SubSource|Level"
  const p = String(ref).split("|");
  return { name: p[0], className: p[1], classSource: p[2] || "", subShort: p[3] || "", subSource: p[4] || "", level: Number(p[5] || 0) };
}

export async function findClassFeatures(classStub, level) {
  if (!classStub) return [];
  const rec = recordsForEntity(classStub)[0];
  const packed = await ensureClassFile(classStub.name, classStub.source);
  const file = packed?.file;
  const cls = rec || packed?.cls;
  if (!cls || !file) return [];
  const pool = file.classFeature || [];
  const out = [];
  for (const raw of cls.classFeatures || []) {
    const refStr = typeof raw === "string" ? raw : raw.classFeature;
    if (!refStr) continue;
    const ref = parseFeatureRef(refStr);
    if (ref.level > Number(level)) continue;
    const feat = pool.find((f) =>
      String(f.name).toLowerCase() === ref.name.toLowerCase() &&
      Number(f.level) === ref.level &&
      (!ref.classSource || String(f.classSource).toLowerCase() === ref.classSource.toLowerCase()));
    if (feat) out.push({ name: feat.name, level: feat.level, entries: feat.entries, source: feat.source });
    else out.push({ name: ref.name, level: ref.level, entries: null, source: ref.featureSource || ref.classSource });
  }
  return dedupe(out);
}

export async function findSubclassFeatures(subclassStub, level) {
  if (!subclassStub) return [];
  const sub = recordsForEntity(subclassStub)[0];
  const packed = await ensureClassFile(subclassStub.className, subclassStub.classSource);
  const file = packed?.file;
  if (!sub || !file) return [];
  const pool = file.subclassFeature || [];
  const out = [];
  for (const raw of sub.subclassFeatures || []) {
    const refStr = typeof raw === "string" ? raw : raw.subclassFeature;
    if (!refStr) continue;
    const ref = parseSubFeatureRef(refStr);
    if (ref.level > Number(level)) continue;
    const feat = pool.find((f) =>
      String(f.name).toLowerCase() === ref.name.toLowerCase() &&
      Number(f.level) === ref.level &&
      String(f.subclassShortName || "").toLowerCase() === ref.subShort.toLowerCase());
    if (feat) out.push({ name: feat.name, level: feat.level, entries: feat.entries, source: feat.source });
    else out.push({ name: ref.name, level: ref.level, entries: null, source: ref.subSource });
  }
  return dedupe(out);
}

function dedupe(arr) {
  const m = new Map();
  for (const f of arr) m.set(`${f.name}|${f.level}`, f);
  return [...m.values()].sort((a, b) => Number(a.level || 0) - Number(b.level || 0));
}

// ------------------------------------------------------------
// Estatísticas / init
// ------------------------------------------------------------
export function stats() {
  const a = manifestEntries();
  return {
    entities: a.length,
    official: a.filter((x) => !isHomebrew(x)).length,
    homebrew: a.filter(isHomebrew).length,
  };
}

export async function initDatabase(onProgress) {
  const steps = [
    () => ensureCatalog("race"),
    () => ensureCatalog("background"),
    () => ensureCatalog("class", (d, t) => onProgress && onProgress("Classes", d, t)),
  ];
  let i = 0;
  for (const step of steps) {
    i++;
    onProgress && onProgress("Catálogos", i, steps.length);
    await step();
  }
  return { ok: true, stats: stats() };
}
