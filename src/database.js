// ============================================================
// Banco de dados D&D 5e — leitura direta do 5etools no GitHub
// ------------------------------------------------------------
// Expõe para o app.js uma API parecida com a das versões
// antigas (manifestEntries / filterEntities / recordsForEntity
// / findClassFeatures / ...), porém sem manifesto gigante:
// os catálogos são baixados sob demanda e ficam em cache.
// ============================================================

import { getJson, tryJson, tryLocalJson, getVersionInfo } from "./store.js";
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
// Conteúdo de pré-lançamento (Unearthed Arcana e outros playtests) — não
// é homebrew (não é fã-feito) nem oficial publicado, mas trata-se do
// mesmo jeito que homebrew pra fins de filtro de conteúdo (ver
// pickerContentOk em app.js) e ganha uma etiqueta própria na ficha.
export function isPrerelease(x) {
  return !!(x && x.prerelease);
}
export function editionOf(x) {
  // stub já traz string "2014"/"2024"/"both" (homebrew não amarrado a
  // uma edição específica); registro cru é derivado via heurística.
  if (x && (x.edition === "2014" || x.edition === "2024" || x.edition === "both")) return x.edition;
  return editionOfRec(x);
}

// O 5etools marca em cada registro de 2014 que foi refeito em 2024 um
// campo `reprintedAs` (ex.: "Wizard|XPHB"). É o "filtro de reprint" da
// interface deles: em uma sessão 2024, esconder o registro 2014 que já
// tem versão nova evita a duplicata (Mago PHB + Mago XPHB lado a lado).
export function isReprinted(x) {
  const rec = (x && (x.__rec || registry.get(x.id)?.__rec)) || {};
  return Array.isArray(rec.reprintedAs) && rec.reprintedAs.length > 0;
}
// O registro combina com a edição escolhida?
//  - homebrew (edição "both"): sempre passa;
//  - mesma edição: passa;
//  - 2014 numa sessão 2024: passa só se `includeLegacy` e o registro
//    NÃO tiver sido reimpresso em 2024.
export function matchesEdition(x, edition, includeLegacy = false) {
  const ed = editionOf(x);
  if (ed === "both") return true;
  if (ed === String(edition)) return true;
  if (includeLegacy && String(edition) === "2024" && ed === "2014") return !isReprinted(x);
  return false;
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
// Fluff (texto narrativo / lore) de raça e classe
// ------------------------------------------------------------
// O 5etools guarda a prosa (lore) separada dos dados mecânicos:
// fluff-races.json / class/fluff-class-<slug>.json (oficial), ou a
// própria chave "raceFluff"/"classFluff"/"subclassFluff" dentro do
// arquivo homebrew. Indexamos tudo por "tipo|nome|fonte" para achar
// rapidamente o texto de qualquer raça/classe/subclasse.
const fluffIndex = new Map();
function fluffKey(type, name, source) {
  return `${type}|${String(name || "").trim().toLowerCase()}|${String(source || "").trim().toLowerCase()}`;
}
function registerFluff(type, arr) {
  for (const f of arr || []) {
    if (!f || !f.name || !f.entries) continue;
    fluffIndex.set(fluffKey(type, f.name, f.source), f.entries);
  }
}
// Devolve as entries de lore (ou null se o banco não tiver texto
// narrativo estruturado para esse registro).
export function fluffFor(type, name, source) {
  type = normType(type);
  return fluffIndex.get(fluffKey(type, name, source)) || null;
}
export function descriptionEntries(e) {
  if (!e) return null;
  const t = normType(e.type);
  if (t !== "race" && t !== "class" && t !== "subclass") return null;
  return fluffFor(t, e.name, e.source);
}

// ------------------------------------------------------------
// Carga de catálogos
// ------------------------------------------------------------
export async function ensureCatalog(type, onProgress) {
  type = normType(type);
  if (type === "subclass") type = "class";
  if (loaded.has(type)) return;

  if (type === "race") { await loadRaces(onProgress); loaded.add("race"); return; }
  if (type === "class") { await loadAllClasses(onProgress); loaded.add("class"); return; }
  if (type === "spell") {
    await loadSpellCatalog(onProgress);
    await loadBrewCatalog("homebrew", "spell", onProgress).catch((e) => console.warn("Magias homebrew indisponíveis:", e));
    await loadBrewCatalog("prerelease", "spell", onProgress).catch((e) => console.warn("Magias de pré-lançamento indisponíveis:", e));
    loaded.add("spell"); return;
  }
  if (type === "item") {
    await loadItemCatalog(onProgress);
    await loadBrewCatalog("homebrew", "item", onProgress).catch((e) => console.warn("Itens homebrew indisponíveis:", e));
    await loadBrewCatalog("prerelease", "item", onProgress).catch((e) => console.warn("Itens de pré-lançamento indisponíveis:", e));
    loaded.add("item"); return;
  }

  const file = CATALOG_FILE[type];
  if (file) {
    // tryJson (não getJson): se o CDN oficial estiver fora do ar/bloqueado,
    // não pode impedir o carregamento do homebrew logo abaixo — mesmo
    // motivo do tryJson em loadAllClasses/loadRaces.
    const json = await tryJson(file);
    const key = json && (Object.keys(json).find((k) => Array.isArray(json[k]) && k !== "_meta") || type);
    const arr = key ? resolveCopies(json[key] || []) : [];
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
  }
  await loadBrewCatalog("homebrew", type, onProgress).catch((e) => console.warn(`Homebrew (${type}) indisponível:`, e));
  await loadBrewCatalog("prerelease", type, onProgress).catch((e) => console.warn(`Pré-lançamento (${type}) indisponível:`, e));
  loaded.add(type);
}

// Baixa os arquivos homebrew/prerelease (deste repositório) que contêm o
// tipo pedido — lista vinda de data/version.json (homebrew.filesByType
// ou prerelease.filesByType, mesmo formato pros dois).
async function brewFilesFor(kind, type) {
  const v = await loadVersionInfo();
  const byType = v?.[kind]?.filesByType || {};
  return Array.isArray(byType[type]) ? byType[type] : [];
}
// kind: "homebrew" | "prerelease" — mesmo formato de arquivo, só muda de
// onde a lista de arquivos vem e como a entidade resultante é marcada
// (isHomebrew/isPrerelease em app.js leem esses dois campos).
async function loadBrewCatalog(kind, type, onProgress) {
  const files = await brewFilesFor(kind, type);
  if (!files.length) return;
  const keys = type === "item" ? ["item", "baseitem"] : [type];
  let done = 0;
  await Promise.all(files.map(async (fname) => {
    const file = await tryLocalJson(fname);
    done++; onProgress && onProgress(done, files.length);
    if (!file) return;
    for (const k of keys) {
      for (const rec of resolveCopies(file[k] || [])) {
        if (!rec || !rec.name) continue;
        const stub = {
          id: edId([type, rec.source || "", rec.name]),
          type, name: rec.name, source: rec.source || "",
          edition: "both", homebrew: kind === "homebrew", prerelease: kind === "prerelease", __rec: rec,
        };
        if (type === "spell") stub.level = rec.level ?? 0;
        register(stub);
      }
    }
  }));
}

async function loadAllClasses(onProgress) {
  // Classes/subclasses oficiais (5etools) + homebrew compatível com
  // 5etools (TheGiddyLimit/homebrew), este último já baixado e
  // normalizado neste próprio repositório pelo workflow diário de
  // sincronização (ver data/version.json).
  // Não deixamos uma falha ao buscar o índice oficial (rede fora do
  // ar, mirror bloqueado etc.) impedir o carregamento do homebrew —
  // por isso tryJson aqui em vez de getJson.
  const [index, homebrewFiles, prereleaseFiles] = await Promise.all([
    tryJson("class/index.json").then((v) => v || {}), // { wizard: "class-wizard.json", ... }
    brewClassFiles("homebrew"),
    brewClassFiles("prerelease"),
  ]);
  const officialFiles = Object.values(index);

  const total = officialFiles.length + homebrewFiles.length + prereleaseFiles.length;
  let done = 0;
  const tick = () => { done++; onProgress && onProgress(done, total); };

  await Promise.all([
    loadOfficialClassFluff().catch((err) => console.warn("Lore de classes oficiais indisponível:", err)),
    ...officialFiles.map(async (fname) => {
      const file = await tryJson(`class/${fname}`);
      tick();
      if (file) registerClassFile(file, false, false);
    }),
    ...homebrewFiles.map(async (fname) => {
      const file = await tryLocalJson(fname);
      tick();
      if (file) registerClassFile(file, true, false);
    }),
    ...prereleaseFiles.map(async (fname) => {
      const file = await tryLocalJson(fname);
      tick();
      if (file) registerClassFile(file, false, true);
    }),
  ]);
}

// Lore oficial de classe/subclasse mora em arquivos separados
// (class/fluff-class-<slug>.json), listados em class/fluff-index.json.
// O homebrew já traz classFluff/subclassFluff dentro do próprio
// arquivo de classe (ver registerClassFile), então não precisa disso.
async function loadOfficialClassFluff() {
  let idx = await tryJson("class/fluff-index.json").then((v) => v || {});
  // Se o índice de lore falhar/vier vazio, deriva os nomes de arquivo
  // a partir do índice de classes (class/fluff-class-<slug>.json).
  if (!Object.keys(idx).length) {
    const classIdx = await tryJson("class/index.json").then((v) => v || {});
    idx = Object.fromEntries(Object.keys(classIdx).map((slug) => [slug, `fluff-class-${slug}.json`]));
  }
  await Promise.all(Object.values(idx).map(async (fname) => {
    const file = await tryJson(`class/${fname}`);
    if (!file) return;
    if (Array.isArray(file.classFluff)) registerFluff("class", resolveCopies(file.classFluff));
    if (Array.isArray(file.subclassFluff)) registerFluff("subclass", resolveCopies(file.subclassFluff));
  }));
}

// ------------------------------------------------------------
// Raças / espécies — oficiais + homebrew, com subespécies e lore
// ------------------------------------------------------------
// Diferente de classe, o homebrew de raça normalmente NÃO tem uma
// classe própria (não filtra por className/edição) — por isso não
// reaproveitamos loadAllClasses. version.json precisa listar os
// arquivos de raça homebrew (`homebrew.raceFiles`, gerado pelo
// sync-data.mjs) para sabermos quais baixar.
async function brewRaceFiles(kind) {
  const v = await loadVersionInfo();
  return Array.isArray(v?.[kind]?.raceFiles) ? v[kind].raceFiles : [];
}
function registerRaceRecords(arr, isHomebrew, isPrerelease) {
  for (const rec of arr || []) {
    if (!rec || !rec.name) continue;
    const source = rec.source || "";
    // Subespécie: 5etools amarra `raceName`/`raceSource` à raça-mãe.
    const subraceOf = rec.raceName ? { name: rec.raceName, source: rec.raceSource || source } : null;
    register({
      id: edId(["race", source, rec.name, rec.raceName || ""]),
      type: "race", name: rec.name, source,
      edition: (isHomebrew || isPrerelease) ? "both" : editionOfRec(rec),
      homebrew: isHomebrew, prerelease: !!isPrerelease,
      subraceOf,
      __rec: rec,
    });
  }
}
async function loadRaces(onProgress) {
  const [officialJson, raceFluffJson, homebrewFiles, prereleaseFiles] = await Promise.all([
    tryJson("races.json").then((v) => v || {}),
    tryJson("fluff-races.json").then((v) => v || {}),
    brewRaceFiles("homebrew"),
    brewRaceFiles("prerelease"),
  ]);
  registerFluff("race", resolveCopies(raceFluffJson.raceFluff || []));
  registerRaceRecords(resolveCopies([...(officialJson.race || []), ...(officialJson.subrace || [])]), false, false);

  let done = 0;
  const total = homebrewFiles.length + prereleaseFiles.length;
  await Promise.all([
    ...homebrewFiles.map(async (fname) => {
      const file = await tryLocalJson(fname);
      done++; onProgress && onProgress(done, total);
      if (!file) return;
      if (Array.isArray(file.raceFluff)) registerFluff("race", resolveCopies(file.raceFluff));
      registerRaceRecords(resolveCopies([...(file.race || []), ...(file.subrace || [])]), true, false);
    }),
    ...prereleaseFiles.map(async (fname) => {
      const file = await tryLocalJson(fname);
      done++; onProgress && onProgress(done, total);
      if (!file) return;
      if (Array.isArray(file.raceFluff)) registerFluff("race", resolveCopies(file.raceFluff));
      registerRaceRecords(resolveCopies([...(file.race || []), ...(file.subrace || [])]), false, true);
    }),
  ]);
}

// data/version.json é buscado uma única vez por sessão e reaproveitado
// tanto para saber quais arquivos de classe/subclasse homebrew existem
// quanto para o aviso de "banco atualizado" (ver currentVersionInfo,
// usado por app.js). Em caso de falha (offline, version.json ausente
// etc.) simplesmente não há homebrew nesta sessão — o resto da ficha
// continua funcionando normalmente.
let versionInfoPromise = null;
function loadVersionInfo() {
  if (!versionInfoPromise) {
    versionInfoPromise = getVersionInfo().catch((err) => { console.warn("Banco local/homebrew indisponível:", err); return null; });
  }
  return versionInfoPromise;
}
export async function currentVersionInfo() { return loadVersionInfo(); }
async function brewClassFiles(kind) {
  const v = await loadVersionInfo();
  return Array.isArray(v?.[kind]?.classFiles) ? v[kind].classFiles : [];
}

// Vários arquivos do 5etools trazem a classe/subclasse DUAS vezes: a
// entrada real e uma "casca" `{_copy:{...mesmo nome/fonte}}` usada pelo
// build deles. Como as duas têm o mesmo id, a casca sobrescrevia a real
// e a subclasse perdia optionalfeatureProgression / subclassFeatures.
// Aqui ficamos sempre com a entrada mais completa (mais chaves).
function dedupeRicher(arr, keyFn) {
  const m = new Map();
  for (const o of arr || []) {
    if (!o) continue;
    const k = keyFn(o);
    const prev = m.get(k);
    if (!prev || Object.keys(o).length > Object.keys(prev).length) m.set(k, o);
  }
  return [...m.values()];
}

function registerClassFile(file, isHomebrew = false, isPrerelease = false) {
  // Homebrew/prerelease trazem classFluff/subclassFluff dentro do
  // próprio arquivo de classe — nenhum download extra necessário.
  if (Array.isArray(file.classFluff)) registerFluff("class", resolveCopies(file.classFluff));
  if (Array.isArray(file.subclassFluff)) registerFluff("subclass", resolveCopies(file.subclassFluff));
  file = {
    ...file,
    class: dedupeRicher(file.class, (c) => `${String(c.name).toLowerCase()}|${String(c.source).toLowerCase()}`),
    subclass: dedupeRicher(file.subclass, (s) => `${String(s.name).toLowerCase()}|${String(s.source).toLowerCase()}|${String(s.className).toLowerCase()}`),
  };
  const nonOfficial = isHomebrew || isPrerelease;
  for (const cls of file.class || []) {
    const csrc = cls.source || "";
    classFiles.set(`${String(cls.name).toLowerCase()}|${String(csrc).toLowerCase()}`, { cls, file });
    register({
      id: edId(["class", csrc, cls.name]),
      type: "class", name: cls.name, source: csrc,
      edition: nonOfficial ? "both" : editionOfRec(cls), homebrew: isHomebrew, prerelease: isPrerelease,
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
      edition: nonOfficial ? "both" : editionOfRec(sub.edition ? sub : { source: ssrc }),
      homebrew: isHomebrew, prerelease: isPrerelease,
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

  // Cada magia é marcada como vinda da lista da CLASSE, concedida pela
  // SUBCLASSE (magias de domínio/círculo/patrono etc.), ou as duas — pra
  // deixar explícito na ficha de onde ela veio, em vez de uma lista única
  // sem distinção entre o que é da classe e o que é específico da subclasse.
  const wanted = []; // { name, bookSource, viaClass, viaSubclass }
  for (const [bookSource, spells] of Object.entries(spellSources)) {
    for (const [spellName, info] of Object.entries(spells)) {
      const refs = [].concat(info.class || [], info.classVariant || [], info.subclass || []);
      let viaClass = false, viaSubclass = false;
      for (const r of refs) {
        if (!r) continue;
        const n = String(r.name || r.className || "");
        const s = String(r.source || r.classSource || "");
        if (n.toLowerCase() === className.toLowerCase() &&
            (!s || s === classSrcWanted || (edition === "2014" && s === "PHB") || (edition === "2024" && s === "XPHB"))) viaClass = true;
        if (subName && String(r.subclass?.name || r.subclassShortName || "").toLowerCase() === subName.toLowerCase()) viaSubclass = true;
      }
      if (viaClass || viaSubclass) wanted.push({ name: spellName, bookSource, viaClass, viaSubclass });
    }
  }

  // baixa só os arquivos de magia necessários
  const bySource = new Map();
  for (const w of wanted) {
    if (!bySource.has(w.bookSource)) bySource.set(w.bookSource, await loadSpellFile(w.bookSource));
  }

  const found = new Map(); // "nome|fonte" -> { rec, viaClass, viaSubclass }
  for (const w of wanted) {
    const arr = bySource.get(w.bookSource) || [];
    const rec = arr.find((s) => String(s.name).toLowerCase() === w.name.toLowerCase());
    if (!rec) continue;
    const key = `${rec.name}|${rec.source}`;
    const cur = found.get(key) || { rec, viaClass: false, viaSubclass: false };
    cur.viaClass = cur.viaClass || w.viaClass;
    cur.viaSubclass = cur.viaSubclass || w.viaSubclass;
    found.set(key, cur);
  }

  // Magias concedidas pela própria subclasse (domínio do Clérigo, patrono
  // do Bruxo, tradição arcana do Mago, círculo do Druida…) NÃO aparecem em
  // spells/sources.json — elas ficam no campo `additionalSpells` do
  // registro da subclasse (prepared/known/expanded/innate, cada um com um
  // formato de chaves diferente). Em vez de tratar cada formato à mão,
  // percorre a árvore inteira e trata toda string-folha como uma
  // referência de magia ("nome" ou "nome|fonte").
  if (subclassStub) {
    const subRec = recordsForEntity(subclassStub)[0] || subclassStub.__rec || null;
    const refs = [];
    const walk = (node) => {
      if (node == null) return;
      if (Array.isArray(node)) { node.forEach((x) => (typeof x === "string" ? refs.push(x) : walk(x))); return; }
      if (typeof node === "object") Object.values(node).forEach(walk);
    };
    walk(subRec?.additionalSpells);
    const seenRef = new Set();
    for (const raw of refs) {
      let [name, src] = String(raw).split("|");
      name = name.replace(/#.*$/, "").trim();
      src = src ? src.toUpperCase() : null;
      const refKey = `${name.toLowerCase()}|${src || ""}`;
      if (!name || seenRef.has(refKey)) continue;
      seenRef.add(refKey);
      const candidates = [...new Set([src, classSrcWanted, subRec?.source].filter(Boolean))];
      let rec = null;
      for (const book of candidates) {
        if (!bySource.has(book)) bySource.set(book, await loadSpellFile(book).catch(() => []));
        rec = (bySource.get(book) || []).find((s) => String(s.name).toLowerCase() === name.toLowerCase());
        if (rec) break;
      }
      if (!rec) continue;
      const key = `${rec.name}|${rec.source}`;
      const cur = found.get(key) || { rec, viaClass: false, viaSubclass: false };
      cur.viaSubclass = true;
      found.set(key, cur);
    }
  }

  const out = [];
  for (const { rec, viaClass, viaSubclass } of found.values()) {
    register({
      id: edId(["spell", rec.source, rec.name]),
      type: "spell", name: rec.name, source: rec.source || "",
      level: rec.level ?? 0, edition: editionOfRec(rec), homebrew: false, __rec: rec,
    });
    out.push({ ...rec, _fromClass: viaClass, _fromSubclass: viaSubclass });
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
      // Homebrew é marcado como edition "both" (não sabemos se é
      // 2014 ou 2024) — deixamos passar em qualquer edição escolhida.
      if (edition && editionOf(x) !== "both" && editionOf(x) !== String(edition)) return false;
      const nonOfficial = isHomebrew(x) || isPrerelease(x);
      if (content === "official" && nonOfficial) return false;
      if (content === "homebrew" && !nonOfficial) return false;
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
