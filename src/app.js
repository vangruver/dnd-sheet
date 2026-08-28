import {
  initDatabase, ensureCatalog, filterEntities, recordsForEntity, getRecordArrays,
  findClassFeatures, findSubclassFeatures, spellsForClass, stats,
  manifestEntries, isHomebrew as hb, normType, editionOf, currentVersionInfo,
  descriptionEntries, matchesEdition, isReprinted,
} from "./database.js";
import { clearCache } from "./store.js";
import { ABILITIES, ABILITY_NAMES, SKILLS, mod, fmt, proficiency, hpAverage, abilityKey, spellDc, spellAttack, casterSlots, pactSlots } from "./rules.js";
import {
  saveCharacter, loadCharacter, clearCharacter, downloadCharacter, readCharacterFile, getSeenDataVersion, setSeenDataVersion,
  getSavedTheme, saveTheme, getSavedCreationMode, saveCreationMode,
} from "./storage.js";

const $ = (id) => document.getElementById(id);
let character, refs = { class: null, subclass: null, race: null, background: null, multiclasses: [] }, details = {};
let pickerType = null, eqCat = "inventory", pickerLegacy = true, spellBookClassId = null;
let codexState = { type: "all", content: "all", query: "", legacy: false };

// ------------------------------------------------------------
// Assistente guiado de criação — passo a passo (espécie → classe →
// background → atributos → revisão) como alternativa ao "modo livre"
// (todos os cards visíveis de uma vez, comportamento original).
// ------------------------------------------------------------
const WIZARD_STEPS = [
  { key: "race", type: "race", title: "Espécie", hint: "Escolha a espécie/raça do seu personagem — ela define deslocamento, traços e, em muitos casos, um bônus de atributo." },
  { key: "class", type: "class", title: "Classe", hint: "Escolha a classe — ela define dado de vida, testes de resistência com proficiência e a lista de magias disponível." },
  { key: "background", type: "background", title: "Background", hint: "Escolha um background — ele concede perícias, ferramentas e, na edição 2024, um talento de origem." },
  { key: "abilities", title: "Atributos", hint: "Distribua seus atributos. Bônus de espécie, background, talentos e melhorias entram automaticamente — clique no ⓘ de cada atributo pra ver de onde vêm." },
  { key: "review", title: "Revisão", hint: "Revise as escolhas e finalize. Dá pra ajustar tudo depois, a qualquer momento, no modo livre." },
];
let wizardIndex = 0;
let creationMode = getSavedCreationMode();

const fresh = () => ({
  schema: 1, name: "", level: 1, xp: 0, inspiration: 0, edition: "2024", content: "official", abilityMode: "pointbuy",
  classId: "", subclassId: "", raceId: "", backgroundId: "",
  multiclasses: [], // classes adicionais: [{classId, subclassId, level}] — classId/subclassId acima são a classe primária
  scores: { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 },
  saveProficiencies: [], skillProficiencies: [], skillExpertise: [],
  hpCurrent: null, hpTemp: 0, ac: null, speed: "30 ft", attacks: [], inventory: [], preparedSpells: [], deathSaves: { success: 0, failure: 0 }, equipApplied: false,
  alignment: "", languages: "", appearance: "", backstory: "",
  coins: { cp: 0, pp: 0, pe: 0, po: 0, pl: 0 },
  auto: { classSkills: [], backgroundSkills: [], classSaves: [], fixedSkills: [], speed: null, hitDice: null, spellcastingAbility: null },
  choiceSelections: { classSkills: [], backgroundSkills: [], raceSkills: {}, abilityChoices: {}, bgAbility: [], bgAbilityMode: 0, optionalFeatures: {}, asi: [], originFeat: null, raceFeat: null, featAbility: {}, startingEquip: {} }, manualSkillProficiencies: [],
});
const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[c]));
const toast = (t) => { const e = $("toast"); e.textContent = t; e.classList.add("show"); clearTimeout(toast.t); toast.t = setTimeout(() => e.classList.remove("show"), 2400); };
const manifest = () => manifestEntries();
const list = (t, q = "") => filterEntities(t, character.edition, character.content, q);
const editionLabel = (x) => (editionOf(x) === "both" ? "2014/2024" : editionOf(x));
const labelMeta = (x) => `${hb(x) ? "Homebrew" : "Oficial"} · ${editionLabel(x)}${x?.source ? " · " + x.source : ""}`;
const sourceTag = (x) => `<span class="tag ${hb(x) ? "brew" : "official"}">${hb(x) ? "HOMEBREW" : "OFICIAL"}${x?.source ? ` · ${esc(x.source)}` : ""}</span>`;
const titleOf = (x) => String(x?.name || "Sem nome");
const typeLabel = (t) => ({ class: "Classe", subclass: "Subclasse", race: "Espécie/Raça", background: "Background", spell: "Magia", item: "Item", feat: "Talento", optionalfeature: "Opção", classFeature: "Característica", subclassFeature: "Característica" }[normType(t)] || t);

// ------------------------------------------------------------
// Renderização de texto do formato 5etools
// ------------------------------------------------------------
function inlineTags(s) {
  return String(s)
    .replace(/\{@(?:dice|damage|scaledice)\s+([^}|]+)(?:\|[^}]*)?\}/gi, "$1")
    .replace(/\{@(?:dc)\s+([^}|]+)(?:\|[^}]*)?\}/gi, "CD $1")
    .replace(/\{@(?:hit)\s+([^}|]+)(?:\|[^}]*)?\}/gi, "+$1")
    .replace(/\{@(?:chance)\s+([^}|]+)(?:\|[^}]*)?\}/gi, "$1%")
    .replace(/\{@(?:h)\}/gi, "Acerto: ")
    .replace(/\{@(?:atk)\s+([^}|]+)(?:\|[^}]*)?\}/gi, "")
    .replace(/\{@(?:i|italic|note)\s+([^}|]+)(?:\|[^}]*)?\}/gi, "$1")
    .replace(/\{@(?:b|bold)\s+([^}|]+)(?:\|[^}]*)?\}/gi, "$1")
    .replace(/\{@[a-z]+\s+([^}|]+)(?:\|[^}]*)?\}/gi, "$1")
    .replace(/\{@[^}]+\}/g, "");
}
function richText(v) {
  const out = [];
  const walk = (x) => {
    if (x == null) return;
    if (typeof x === "string") { out.push(`<p>${esc(inlineTags(x))}</p>`); return; }
    if (Array.isArray(x)) { x.forEach(walk); return; }
    if (typeof x !== "object") return;
    if (x.type === "list" && Array.isArray(x.items)) {
      out.push("<ul>");
      x.items.forEach((it) => {
        if (it && typeof it === "object" && it.name) out.push(`<li><strong>${esc(inlineTags(it.name))}</strong> ${esc(inlineTags(plainOf(it.entry || it.entries || "")))}</li>`);
        else { out.push("<li>"); walk(it); out.push("</li>"); }
      });
      out.push("</ul>"); return;
    }
    if (x.type === "table" && Array.isArray(x.rows)) {
      out.push("<table><tbody>");
      if (x.colLabels) out.push("<tr>" + x.colLabels.map((h) => `<th>${esc(inlineTags(h))}</th>`).join("") + "</tr>");
      x.rows.forEach((r) => out.push("<tr>" + r.map((c) => `<td>${esc(inlineTags(typeof c === "string" ? c : JSON.stringify(c)))}</td>`).join("") + "</tr>"));
      out.push("</tbody></table>"); return;
    }
    if (x.type === "quote" && Array.isArray(x.entries)) {
      out.push(`<blockquote class="lore-quote">${x.entries.map((t) => `<p>${esc(inlineTags(t))}</p>`).join("")}${x.by ? `<cite>— ${esc(inlineTags(x.by))}</cite>` : ""}</blockquote>`);
      return;
    }
    if (x.name && x.entries) { out.push(`<h3>${esc(inlineTags(x.name))}</h3>`); walk(x.entries); return; }
    if (x.entries) walk(x.entries); else if (x.items) walk(x.items); else if (x.entry) walk(x.entry); else if (x.desc) walk(x.desc);
  };
  walk(v);
  return out.join("") || "<p class='muted'>Sem descrição estruturada disponível para este registro.</p>";
}
function plainOf(v) {
  const d = document.createElement("div");
  // Espaço antes de fechar blocos, senão "Wizard" + "Masters of…" colam.
  d.innerHTML = richText(v).replace(/<\/(p|h[1-6]|li|tr|blockquote|div)>/gi, " </$1>");
  return d.textContent.replace(/\s+/g, " ").trim();
}
const plain = plainOf;

async function records(e) { return e ? getRecordArrays(e) : []; }
async function firstRecord(e) {
  const a = await records(e);
  return a.find((r) => String(r.name || "").toLowerCase() === String(e?.name || "").toLowerCase()) || a[0] || null;
}
function descriptionOf(r, e) { return r?.entries || r?.desc || r?.description || r?.fluff || r?.traits || e?.description || ""; }
// Lore de raça/classe/subclasse (texto narrativo real do 5etools),
// com fallback pros dados mecânicos quando o banco não tem prosa
// estruturada para aquele registro (comum em homebrew mais simples).
function loreOf(e) { return e ? descriptionEntries(e) : null; }
function bestDescription(e, r) { return loreOf(e) || descriptionOf(r, e); }
// Muitos textos de lore do 5etools começam repetindo o nome da
// raça/classe (que já aparece no título do card/modal) — tira isso do
// começo do resumo pra não ficar "Artificer Artificers use…".
function stripLeadingName(text, name) {
  if (!text || !name) return text;
  const re = new RegExp("^\\s*" + String(name).replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "[\\s:.,—-]+", "i");
  return text.replace(re, "");
}
function teaserText(e, r, max = 190) {
  return stripLeadingName(plain(bestDescription(e, r)), e?.name).slice(0, max);
}
// Alguns arquivos de lore embrulham o texto inteiro num único bloco
// "section" cujo nome repete o nome da própria raça/classe — evita
// duplicar o título (que já aparece no cabeçalho do card/modal).
function unwrapSelfSection(entries, ownName) {
  if (Array.isArray(entries) && entries.length === 1 && entries[0]?.type === "section" &&
      String(entries[0].name || "").toLowerCase() === String(ownName || "").toLowerCase()) {
    return entries[0].entries;
  }
  return entries;
}
function classMatches(x, c) {
  if (!c) return false;
  // Casa subclasse <-> classe SÓ pelo nome. O 5etools marca subclasses
  // 2014 do Mago com classSource:"XPHB" (não "PHB"), então comparar a
  // fonte descartava as subclasses oficiais. A separação 2014/2024 fica
  // por conta de matchesEdition em quem chama.
  const n = String(c.name || "").toLowerCase();
  const cn = String(x.className || x.class || "").toLowerCase();
  return !cn || cn === n;
}

// ------------------------------------------------------------
// Multiclasse — classe primária (classId/subclassId/level) + classes
// adicionais em character.multiclasses ([{classId, subclassId, level}]).
// Nível total = soma de todas; proficiência/PV usam o total, enquanto
// características/magias de cada classe usam o nível PRÓPRIO dela.
// ------------------------------------------------------------
function totalLevel() {
  const extra = (character.multiclasses || []).reduce((n, m) => n + (Number(m.level) || 0), 0);
  return Math.max(1, Number(character.level) || 1) + extra;
}
function usedMulticlassIds(excludeIndex) {
  const set = new Set();
  if (character.classId) set.add(character.classId);
  (character.multiclasses || []).forEach((m, i) => { if (i !== excludeIndex && m.classId) set.add(m.classId); });
  return set;
}
function resolveMulticlassRefs() {
  refs.multiclasses = (character.multiclasses || []).map((m) => ({
    classEntry: manifest().find((x) => x.id === m.classId) || null,
    subclassEntry: manifest().find((x) => x.id === m.subclassId) || null,
    level: Math.max(1, Math.min(19, Number(m.level) || 1)),
  }));
}
function multiclassRequirement(rec) {
  const req = rec?.multiclassing?.requirements;
  if (!req) return null;
  const seg = (o) => Object.entries(o || {}).filter(([k]) => abilityKey(k)).map(([k, v]) => [abilityKey(k), Number(v)]);
  const ands = seg(req);
  const orGroups = (req.or || []).map(seg);
  return { ands, orGroups };
}
function meetsMulticlassRequirement(rec) {
  const req = multiclassRequirement(rec);
  if (!req) return true;
  const andOk = req.ands.every(([a, v]) => effScore(a) >= v);
  const orOk = req.orGroups.every((g) => !g.length || g.some(([a, v]) => effScore(a) >= v));
  return andOk && orOk;
}
function multiclassRequirementText(rec) {
  const req = multiclassRequirement(rec);
  if (!req) return "";
  const parts = req.ands.map(([a, v]) => `${ABILITY_NAMES[a]} ${v}`);
  req.orGroups.forEach((g) => { if (g.length) parts.push(g.map(([a, v]) => `${ABILITY_NAMES[a]} ${v}`).join(" ou ")); });
  return parts.join(" e ");
}

// ------------------------------------------------------------
// Painel de construção
// ------------------------------------------------------------
async function updateChoice(type) {
  const e = refs[type], value = $(`choice-${type}-value`), meta = $(`choice-${type}-meta`), prev = $(`${type}-preview`), card = $(`choice-${type}`);
  if (!e) {
    value.textContent = type === "subclass" ? "Escolha a classe primeiro" : "Escolher…";
    meta.textContent = type === "subclass" ? "—" : "Nenhuma opção selecionada";
    prev.textContent = type === "subclass" ? "A lista será filtrada pela classe escolhida." : "Escolha uma opção para começar.";
    card.classList.remove("selected"); return;
  }
  value.textContent = titleOf(e);
  meta.textContent = labelMeta(e);
  card.classList.add("selected");
  const r = await firstRecord(e);
  prev.textContent = teaserText(e, r, 280) || "Sem descrição estruturada.";
}
async function refreshChoices() {
  refs.race = manifest().find((x) => x.id === character.raceId) || null;
  refs.class = manifest().find((x) => x.id === character.classId) || null;
  refs.subclass = manifest().find((x) => x.id === character.subclassId) || null;
  refs.background = manifest().find((x) => x.id === character.backgroundId) || null;
  resolveMulticlassRefs();
  for (const t of ["race", "class", "subclass", "background"]) await updateChoice(t);
  renderMulticlasses();
  await recalc();
}
const pickerContentOk = (x) => character.content === "all" || (character.content === "official" && !hb(x)) || (character.content === "homebrew" && hb(x));
function filteredPicker(type, q) {
  const ql = String(q || "").toLowerCase();
  if (type === "subclass") {
    if (!refs.class) return [];
    const cn = String(refs.class.name).toLowerCase();
    return manifest().filter((x) =>
      normType(x.type) === "subclass" &&
      matchesEdition(x, character.edition, pickerLegacy) &&
      String(x.className || "").toLowerCase() === cn &&
      pickerContentOk(x) &&
      (!q || titleOf(x).toLowerCase().includes(ql)))
      .sort((a, b) => Number(hb(a)) - Number(hb(b)) || String(a.name).localeCompare(String(b.name), "pt-BR"));
  }
  const t = normType(type);
  return manifest().filter((x) =>
    normType(x.type) === t &&
    matchesEdition(x, character.edition, pickerLegacy) &&
    pickerContentOk(x) &&
    (!q || `${titleOf(x)} ${x.source || ""}`.toLowerCase().includes(ql)))
    .sort((a, b) => Number(hb(a)) - Number(hb(b)) || String(a.name).localeCompare(String(b.name), "pt-BR"));
}
async function openPicker(type) {
  pickerType = type;
  if (type === "subclass" && !refs.class) { toast("Escolha a classe primeiro."); return; }
  const modal = $("modal"), content = $("modal-content");
  content.innerHTML = `<div class="modal-title"><div><span class="eyebrow">ESCOLHER</span><h2>${typeLabel(type)}</h2></div></div><div class="loading">Carregando catálogo…</div>`;
  modal.classList.remove("hidden");
  try { await ensureCatalog(type); } catch (err) { console.error(err); }
  const legacyToggle = character.edition === "2024"
    ? `<label class="codex-legacy"><input type="checkbox" id="picker-legacy" ${pickerLegacy ? "checked" : ""}> Incluir conteúdo de 2014 (legado)</label>`
    : "";
  content.innerHTML = `<div class="modal-title"><div><span class="eyebrow">ESCOLHER</span><h2>${typeLabel(type)}</h2></div></div>
  <div class="picker-controls"><input id="picker-search" placeholder="Pesquisar ${typeLabel(type).toLowerCase()}…"><div class="filter-pills"><button class="active" data-pfilter="all">Todos</button><button data-pfilter="official">Oficial</button><button data-pfilter="homebrew">Homebrew</button></div></div>
  ${legacyToggle}
  <div id="picker-results" class="picker-grid"></div>`;
  const render = () => {
    const q = $("picker-search").value.trim();
    let arr = filteredPicker(type, q);
    const pf = content.querySelector(".filter-pills .active")?.dataset.pfilter || "all";
    if (pf === "official") arr = arr.filter((x) => !hb(x));
    if (pf === "homebrew") arr = arr.filter((x) => hb(x));
    renderPicker(arr.slice(0, 300));
  };
  $("picker-search").addEventListener("input", render);
  $("picker-legacy")?.addEventListener("change", (e) => { pickerLegacy = e.target.checked; render(); });
  content.querySelectorAll("[data-pfilter]").forEach((b) => b.addEventListener("click", () => {
    content.querySelectorAll("[data-pfilter]").forEach((x) => x.classList.remove("active"));
    b.classList.add("active"); render();
  }));
  render();
  setTimeout(() => $("picker-search")?.focus(), 50);
}
function pickCardHtml(x) {
  return `<button class="pick-card" data-id="${esc(x.id)}"><div class="pick-top"><strong>${esc(titleOf(x))}</strong>${sourceTag(x)}</div><div class="pick-meta">${esc(labelMeta(x))}</div><div class="pick-desc">…</div></button>`;
}
// Pinta uma grade de cartões pesquisáveis (raça/classe/subclasse/background) e
// liga o clique a `onPick` — usado tanto pelo modal de seleção quanto pelo
// assistente guiado, que reaproveita a mesma grade dentro do passo atual.
function paintPickResults(box, arr, onPick) {
  if (!box) return;
  if (!arr.length) { box.innerHTML = `<div class="empty">Nenhum resultado encontrado.</div>`; return; }
  box.innerHTML = arr.map(pickCardHtml).join("");
  for (const b of box.querySelectorAll(".pick-card")) {
    const e = manifest().find((x) => x.id === b.dataset.id);
    firstRecord(e).then((r) => { const d = b.querySelector(".pick-desc"); if (d) d.textContent = teaserText(e, r, 160) || "Sem descrição estruturada."; });
    b.addEventListener("click", () => onPick(e));
  }
}
async function renderPicker(arr) {
  paintPickResults($("picker-results"), arr, async (e) => { await selectRef(e); $("modal").classList.add("hidden"); });
}
async function selectRef(e) {
  const t = pickerType;
  if (!e) return;
  character[`${t}Id`] = e.id;
  refs[t] = e;
  if (t === "class") { character.subclassId = ""; refs.subclass = null; character.choiceSelections.classSkills = []; character.choiceSelections.optionalFeatures = {}; }
  if (t === "background") { character.choiceSelections.backgroundSkills = []; character.choiceSelections.bgAbility = []; character.choiceSelections.originFeat = null; }
  if (t === "race") { character.choiceSelections.raceSkills = {}; character.choiceSelections.abilityChoices = {}; character.choiceSelections.raceFeat = null; }
  await refreshChoices();
  saveCharacter(character);
  toast(`${titleOf(e)} selecionado.`);
}
function openInfo(type) {
  if (type === "multiclass") {
    $("modal-content").innerHTML = `<div class="modal-title"><div><span class="eyebrow">REGRA</span><h2>Multiclasse</h2></div></div><div class="modal-body">
      <p>Além da classe primária (nível informado no topo da ficha), você pode adicionar outras classes, cada uma com seu próprio nível e subclasse. O nível total do personagem é a soma de todos — é ele que define a proficiência e os pontos de vida.</p>
      <p>Cada classe concede suas próprias características e magias no nível em que você a tem. Proficiências e perícias de multiclasse seguem a tabela reduzida do PHB (não repetem as escolhas da classe inicial) e aparecem no painel de automação quando aplicável.</p>
      <p class="muted">Um aviso amarelo aparece na linha da classe quando seus atributos não atingem o mínimo recomendado para multiclassar (o jogo não te impede de continuar mesmo assim).</p>
    </div>`;
    $("modal").classList.remove("hidden");
    return;
  }
  const e = refs[type]; if (!e) { toast("Nada selecionado."); return; } openEntityModal(e);
}

// ------------------------------------------------------------
// Linhas de multiclasse — selects nativos (classe/subclasse/nível)
// no painel de construção, independentes do modal de escolha usado
// pela classe primária.
// ------------------------------------------------------------
function classSelectOptions(selectedId, excludeIndex) {
  const used = usedMulticlassIds(excludeIndex);
  const arr = manifest().filter((x) =>
    normType(x.type) === "class" && matchesEdition(x, character.edition, true) && pickerContentOk(x) &&
    (x.id === selectedId || !used.has(x.id)))
    .sort((a, b) => Number(hb(a)) - Number(hb(b)) || String(a.name).localeCompare(String(b.name), "pt-BR"));
  return `<option value="">Selecionar classe…</option>` + arr.map((x) =>
    `<option value="${esc(x.id)}"${x.id === selectedId ? " selected" : ""}>${esc(titleOf(x))}${hb(x) ? " (Homebrew)" : ""}</option>`).join("");
}
function subclassSelectOptions(classEntry, selectedId) {
  if (!classEntry) return `<option value="">Escolha a classe primeiro</option>`;
  const cn = String(classEntry.name).toLowerCase();
  const arr = manifest().filter((x) =>
    normType(x.type) === "subclass" && matchesEdition(x, character.edition, true) &&
    String(x.className || "").toLowerCase() === cn && pickerContentOk(x))
    .sort((a, b) => Number(hb(a)) - Number(hb(b)) || String(a.name).localeCompare(String(b.name), "pt-BR"));
  return `<option value="">Sem subclasse ainda</option>` + arr.map((x) =>
    `<option value="${esc(x.id)}"${x.id === selectedId ? " selected" : ""}>${esc(titleOf(x))}${hb(x) ? " (Homebrew)" : ""}</option>`).join("");
}
function renderMulticlasses() {
  const box = $("multiclass-list");
  if (!box) return;
  const rows = character.multiclasses || [];
  if (!rows.length) { box.innerHTML = `<p class="muted">Nenhuma classe adicional. Use "+ Adicionar classe" para multiclassar.</p>`; return; }
  box.innerHTML = rows.map((m, i) => {
    const classEntry = manifest().find((x) => x.id === m.classId) || null;
    const rec = classEntry ? recordsForEntity(classEntry)[0] : null;
    const warn = classEntry && !meetsMulticlassRequirement(rec) ? `<div class="multiclass-warn">Requer ${esc(multiclassRequirementText(rec))} para multiclassar.</div>` : "";
    return `<div class="multiclass-row" data-mc-row="${i}">
      <select data-mc-class="${i}" aria-label="Classe adicional">${classSelectOptions(m.classId, i)}</select>
      <select data-mc-subclass="${i}" aria-label="Subclasse adicional" ${classEntry ? "" : "disabled"}>${subclassSelectOptions(classEntry, m.subclassId)}</select>
      <input type="number" min="1" max="19" value="${Number(m.level) || 1}" data-mc-level="${i}" aria-label="Nível">
      <button type="button" class="remove-btn no-print" data-mc-remove="${i}" title="Remover classe">×</button>
      ${warn}
    </div>`;
  }).join("");
  box.querySelectorAll("[data-mc-class]").forEach((s) => s.addEventListener("change", async () => {
    const i = Number(s.dataset.mcClass);
    character.multiclasses[i].classId = s.value;
    character.multiclasses[i].subclassId = "";
    saveCharacter(character);
    await refreshChoices();
  }));
  box.querySelectorAll("[data-mc-subclass]").forEach((s) => s.addEventListener("change", async () => {
    const i = Number(s.dataset.mcSubclass);
    character.multiclasses[i].subclassId = s.value;
    saveCharacter(character);
    await refreshChoices();
  }));
  box.querySelectorAll("[data-mc-level]").forEach((inp) => inp.addEventListener("change", async () => {
    const i = Number(inp.dataset.mcLevel);
    const others = (Number(character.level) || 1) + rows.reduce((n, m, j) => n + (j === i ? 0 : Number(m.level) || 0), 0);
    character.multiclasses[i].level = Math.max(1, Math.min(19, 20 - others, Number(inp.value) || 1));
    saveCharacter(character);
    await recalc();
  }));
  box.querySelectorAll("[data-mc-remove]").forEach((b) => b.addEventListener("click", async () => {
    const i = Number(b.dataset.mcRemove);
    character.multiclasses.splice(i, 1);
    saveCharacter(character);
    await refreshChoices();
  }));
}

// ------------------------------------------------------------
// Fichas de detalhe de raça / classe / subclasse — lore real do
// 5etools (oficial e homebrew) + fatos rápidos + traços mecânicos,
// usadas tanto no modal padrão quanto no Codex (aba Raças & Classes).
// ------------------------------------------------------------
function primaryAbilitiesFrom(rec) {
  const out = new Set();
  (rec?.primaryAbility || []).forEach((o) => Object.entries(o || {}).forEach(([k, v]) => { if (!v) return; const a = abilityKey(k); if (a) out.add(a); }));
  return [...out];
}
function subclassesOf(e) {
  return manifest().filter((x) =>
    normType(x.type) === "subclass" && classMatches(x, e) &&
    matchesEdition(x, character.edition, codexState.legacy) &&
    (codexState.content === "all" || (codexState.content === "official" && !hb(x)) || (codexState.content === "homebrew" && hb(x))))
    .sort((a, b) => Number(hb(a)) - Number(hb(b)) || String(a.name).localeCompare(String(b.name), "pt-BR"));
}
function raceQuickFacts(rec) {
  const facts = [];
  const speed = speedFrom(rec); if (speed) facts.push(["Deslocamento", speed]);
  const size = Array.isArray(rec?.size) ? rec.size.join("/") : rec?.size; if (size) facts.push(["Tamanho", size]);
  const abilities = (rec?.ability || []).map((blk) => Object.entries(blk || {})
    .filter(([k]) => k !== "choose").map(([k, v]) => `${(ABILITY_NAMES[abilityKey(k)] || k.toUpperCase())} ${fmt(v)}`).join(", ")).filter(Boolean);
  if (abilities.length) facts.push(["Atributos", abilities.join(" · ")]);
  return facts;
}
function classQuickFacts(rec) {
  const facts = [];
  const hd = hitDiceFrom(rec); if (hd) facts.push(["Dado de vida", `d${hd}`]);
  const prim = primaryAbilitiesFrom(rec).map((a) => ABILITY_NAMES[a]).filter(Boolean); if (prim.length) facts.push(["Atributo primário", prim.join(" ou ")]);
  const saves = savesFrom(rec).map((a) => ABILITY_NAMES[a]).filter(Boolean); if (saves.length) facts.push(["Resistências", saves.join(", ")]);
  return facts;
}
function factsHtml(facts) {
  return facts.length ? `<div class="codex-facts">${facts.map(([k, v]) => `<div class="codex-fact"><span>${esc(k)}</span><b>${esc(v)}</b></div>`).join("")}</div>` : "";
}
// Lista de características (classe/subclasse) usada como "descrição" quando
// o 5etools não tem prosa de lore para o registro — que é o caso da
// maioria das subclasses oficiais e de quase todo homebrew.
function featuresListHtml(feats) {
  if (!feats || !feats.length) return "";
  return `<div class="lore-features">${feats.map((f) => `
    <article class="lore-feature">
      <div class="lore-feature-head"><b>${esc(f.name || "Característica")}</b><span>Nível ${esc(f.level ?? "—")}</span></div>
      ${f.entries ? richText(f.entries) : "<p class='muted'>Sem texto para esta característica.</p>"}
    </article>`).join("")}</div>`;
}
async function detailModalHtml(e) {
  const r = await firstRecord(e);
  const t = normType(e.type);
  const lore = loreOf(e);
  const hasLore = !!lore;
  let facts = "", extra = "", body = "";
  if (hasLore) body = richText(unwrapSelfSection(lore, e.name));

  if (t === "race") {
    facts = factsHtml(raceQuickFacts(r));
    if (e.subraceOf) extra += `<p class="codex-subnote">Subespécie de <strong>${esc(e.subraceOf.name)}</strong>.</p>`;
    const traits = Array.isArray(r?.entries) ? r.entries : [];
    if (traits.length) extra += `<h3 class="codex-divider">Traços</h3>${richText(traits)}`;
    if (!hasLore && !traits.length) extra += `<p class="muted">Sem texto no banco para esta raça.</p>`;
  } else if (t === "class") {
    facts = factsHtml(classQuickFacts(r));
    if (!hasLore) {
      const feats = await findClassFeatures(e, 20).catch(() => []);
      if (feats.length) extra += `<h3 class="codex-divider">Características da classe</h3>${featuresListHtml(feats)}`;
      else extra += `<p class="muted">Sem texto narrativo no banco para esta classe.</p>`;
    }
    const subs = subclassesOf(e);
    if (subs.length) extra += `<h3 class="codex-divider">Subclasses (${subs.length})</h3><div class="codex-chip-row">${subs.map((s) => `<button class="codex-chip" data-codex-id="${esc(s.id)}">${esc(titleOf(s))} ${sourceTag(s)}</button>`).join("")}</div>`;
  } else if (t === "subclass") {
    if (!hasLore) {
      const feats = await findSubclassFeatures(e, 20).catch(() => []);
      if (feats.length) extra += `<h3 class="codex-divider">Características da subclasse</h3>${featuresListHtml(feats)}`;
      else extra += `<p class="muted">Sem texto no banco para esta subclasse.</p>`;
    }
  }
  return `<div class="modal-title"><div><span class="eyebrow">${esc(typeLabel(e.type))}</span><h2>${esc(titleOf(e))}</h2><div>${sourceTag(e)} <span class="tag edition">${esc(editionLabel(e))}</span></div></div></div>${facts}<div class="modal-body">${body}${extra}</div>`;
}
async function openEntityModal(e) {
  const t = normType(e.type);
  if (t === "race" || t === "class" || t === "subclass") { await openCodexModal(e); return; }
  const r = await firstRecord(e), d = descriptionOf(r, e);
  $("modal-content").innerHTML = `<div class="modal-title"><div><span class="eyebrow">${esc(typeLabel(e.type))}</span><h2>${esc(titleOf(e))}</h2><div>${sourceTag(e)} <span class="tag edition">${esc(editionLabel(e))}</span></div></div></div><div class="modal-body">${richText(d)}</div>`;
  $("modal").classList.remove("hidden");
}
async function openCodexModal(e) {
  $("modal-content").innerHTML = `<div class="loading">Carregando…</div>`;
  $("modal").classList.remove("hidden");
  $("modal-content").innerHTML = await detailModalHtml(e);
  $("modal-content").querySelectorAll("[data-codex-id]").forEach((b) => b.addEventListener("click", async () => {
    const sub = manifest().find((x) => x.id === b.dataset.codexId);
    if (sub) await openCodexModal(sub);
  }));
}

// ------------------------------------------------------------
// Atributos / point buy
// ------------------------------------------------------------
function pointCost(score) {
  score = Number(score) || 10;
  const costs = { 8: 0, 9: 1, 10: 2, 11: 3, 12: 4, 13: 5, 14: 7, 15: 9 };
  return costs[Math.max(8, Math.min(15, score))] ?? 0;
}
function pointBuyTotal() { return ABILITIES.reduce((n, a) => n + pointCost(character.scores[a]), 0); }
// Pinta o grid de atributos (somente leitura, com ⓘ pra ver a origem de
// cada bônus) + o editor de point buy/valores livres. Recebe um prefixo de
// id (`ns`) pra poder existir em dois lugares ao mesmo tempo com a MESMA
// lógica: a aba "Atributos & Perícias" (ns="") e o passo de atributos do
// assistente guiado (ns="wiz-"). Se os elementos daquele ns não existem no
// DOM no momento (ex.: passo do assistente fechado), não faz nada.
function paintAbilityEditor(ns) {
  const el = (id) => document.getElementById(ns + id);
  const grid = el("ability-grid"), editor = el("ability-editor");
  if (!grid && !editor) return;
  const free = character.abilityMode === "free";
  const lo = free ? 1 : 8, hi = free ? 30 : 15;
  // Mostra o valor EFETIVO (base do point buy + aumentos de espécie/background/talentos).
  if (grid) {
    grid.innerHTML = ABILITIES.map((a) => {
      const base = Number(character.scores[a]) || 10, eff = effScore(a), bonus = eff - base;
      const info = bonus ? `<button type="button" class="ability-info-btn" data-ability-detail="${a}" title="Ver de onde vêm esses pontos">ⓘ</button>` : "";
      return `<div class="ability-box"><span>${ABILITY_NAMES[a]}</span><b>${eff}${bonus ? `<i>${fmt(bonus)}</i>` : ""}</b><em>${fmt(mod(eff))}</em>${info}</div>`;
    }).join("");
  }
  if (!editor) return;
  const spent = pointBuyTotal(), remaining = 27 - spent;
  const remEl = el("pointbuy-remaining");
  if (remEl) { remEl.textContent = remaining; remEl.classList.toggle("over", remaining < 0); }
  if (el("ability-mode")) el("ability-mode").value = free ? "free" : "pointbuy";
  el("pointbuy-remaining-wrap")?.classList.toggle("hidden", free);
  el("reset-pointbuy")?.classList.toggle("hidden", free);
  if (el("ability-editor-hint")) el("ability-editor-hint").textContent = free
    ? "Digite qualquer valor de 1 a 30 (rolagem, array padrão, homebrew). Ajustes de espécie/background continuam entrando automaticamente."
    : "Use +/− para distribuir pontos (custo padrão 8–15). Ajustes de espécie/background entram automaticamente quando o banco os estrutura.";
  editor.innerHTML = ABILITIES.map((a) => {
    const v = Number(character.scores[a]) || 10;
    return `<div class="ability-edit"><span>${ABILITY_NAMES[a]}</span><div class="ability-stepper"><button type="button" data-ability-dec="${a}" ${v <= lo ? "disabled" : ""}>−</button><input data-ability="${a}" type="number" min="1" max="30" value="${v}"><button type="button" data-ability-inc="${a}" ${v >= hi ? "disabled" : ""}>+</button></div><b>${fmt(mod(v))}</b><small>${free ? "" : `Custo ${pointCost(v)}`}</small></div>`;
  }).join("");
  editor.querySelectorAll("[data-ability]").forEach((i) => i.addEventListener("change", () => {
    character.scores[i.dataset.ability] = Math.max(1, Math.min(30, Number(i.value) || 10));
    recalc(); saveCharacter(character);
  }));
  editor.querySelectorAll("[data-ability-inc],[data-ability-dec]").forEach((b) => b.addEventListener("click", () => {
    const a = b.dataset.abilityInc || b.dataset.abilityDec, v = Number(character.scores[a]) || 10;
    const next = v + (b.dataset.abilityInc ? 1 : -1);
    if (next < lo || next > hi) return;
    if (!free) {
      const delta = pointCost(next) - pointCost(v);
      if (delta > 27 - pointBuyTotal()) { toast("Você não tem pontos suficientes."); return; }
    }
    character.scores[a] = next; recalc(); saveCharacter(character);
  }));
  const reset = el("reset-pointbuy");
  if (reset) reset.onclick = () => { ABILITIES.forEach((a) => (character.scores[a] = 10)); saveCharacter(character); recalc(); };
  const modeSel = el("ability-mode");
  if (modeSel) modeSel.onchange = () => { character.abilityMode = modeSel.value === "free" ? "free" : "pointbuy"; saveCharacter(character); recalc(); };
}
function renderAbilities() { paintAbilityEditor(""); paintAbilityEditor("wiz-"); }

// ------------------------------------------------------------
// Automação
// ------------------------------------------------------------
function flatObjects(v, out = []) {
  if (v == null) return out;
  if (Array.isArray(v)) { v.forEach((x) => flatObjects(x, out)); return out; }
  if (typeof v === "object") { out.push(v); Object.values(v).forEach((x) => { if (x && typeof x === "object") flatObjects(x, out); }); }
  return out;
}
const keyText = (v) => String(v ?? "").trim().toLowerCase().replace(/[\s_-]+/g, "");
function skillKey(v) {
  const k = keyText(v);
  const aliases = {
    acrobatics: "acrobatics", acrobacia: "acrobatics", animalhandling: "animalHandling", adestraranimais: "animalHandling",
    arcana: "arcana", arcanismo: "arcana", athletics: "athletics", atletismo: "athletics", deception: "deception", enganacao: "deception",
    history: "history", historia: "history", insight: "insight", intuicao: "insight", intimidation: "intimidation", intimidacao: "intimidation",
    investigation: "investigation", investigacao: "investigation", medicine: "medicine", medicina: "medicine", nature: "nature", natureza: "nature",
    perception: "perception", percepcao: "perception", performance: "performance", atuacao: "performance", persuasion: "persuasion", persuasao: "persuasion",
    religion: "religion", religiao: "religion", sleightofhand: "sleightOfHand", prestidigitacao: "sleightOfHand", stealth: "stealth", furtividade: "stealth",
    survival: "survival", sobrevivencia: "survival",
  };
  return aliases[k] || null;
}
function abilityChoicesFrom(v) {
  const out = [];
  flatObjects(v).forEach((o) => {
    const ch = o?.choose;
    if (ch && ch.weighted && Array.isArray(ch.weighted.from)) {
      const abilities = ch.weighted.from.map(abilityKey).filter(Boolean);
      const count = (ch.weighted.weights || []).length || abilities.length;
      if (abilities.length) out.push({ from: [...new Set(abilities)], count });
      return;
    }
    if (!ch || !ch.from) return;
    const from = Array.isArray(ch.from) ? ch.from : typeof ch.from === "object" ? Object.keys(ch.from) : [];
    const abilities = from.map(abilityKey).filter(Boolean);
    if (abilities.length) out.push({ from: [...new Set(abilities)], count: Number(ch.count || ch.amount || 1) || 1 });
  });
  return out;
}
function skillChoicesFrom(v) {
  const out = [];
  const ALL = SKILLS.map(([k]) => k);
  flatObjects(v).forEach((o) => {
    const ch = o?.choose;
    if (ch && ch.from) {
      const from = (Array.isArray(ch.from) ? ch.from : Object.keys(ch.from || {})).map(skillKey).filter(Boolean);
      if (from.length) out.push({ from: [...new Set(from)], count: Number(ch.count || ch.amount || 1) || 1 });
    } else if (typeof o?.any === "number" && o.any > 0) {
      // "escolha 2 perícias quaisquer" (Meio-Elfo, Linhagem Personalizada)
      out.push({ from: ALL, count: o.any });
    }
  });
  return out;
}
function fixedSkillsFrom(v) {
  const out = [];
  flatObjects(v).forEach((o) => {
    for (const [k, val] of Object.entries(o || {})) {
      const sk = skillKey(k);
      if (sk && (val === true || typeof val === "number")) out.push(sk);
    }
    if (Array.isArray(o?.skills)) o.skills.forEach((x) => { const sk = skillKey(typeof x === "string" ? x : x?.name); if (sk) out.push(sk); });
  });
  return [...new Set(out)];
}
function savesFrom(cr) {
  const out = [];
  if (Array.isArray(cr?.proficiency)) cr.proficiency.forEach((x) => { const k = abilityKey(x); if (k) out.push(k); });
  flatObjects(cr).forEach((o) => {
    for (const k of ["savingThrows", "saves", "savingThrowProficiencies"]) {
      const a = o?.[k]; if (Array.isArray(a)) a.forEach((x) => { const k2 = abilityKey(x); if (k2) out.push(k2); });
    }
  });
  return [...new Set(out)];
}
function speedFrom(r) {
  const v = r?.speed;
  if (typeof v === "number") return `${v} ft`;
  if (typeof v === "string" && v.trim()) return v;
  if (v && typeof v === "object") {
    const n = v.walk ?? v.walking ?? v.base;
    if (typeof n === "number") return `${n} ft`;
    if (typeof n === "string") return n;
  }
  return null;
}
function hitDiceFrom(r) {
  const v = r?.hd ?? r?.hitDice;
  if (typeof v === "number") return v;
  if (v && typeof v === "object") return Number(v.faces || v.number || 0) || null;
  const m = String(v || "").match(/d\s*(\d+)/i);
  return m ? Number(m[1]) : null;
}
function spellAbilityFrom(r) {
  for (const v of [r?.spellcastingAbility, r?.spellcasting?.ability]) { const k = abilityKey(v); if (k) return k; }
  return null;
}

// ------------------------------------------------------------
// Características opcionais — estilo de luta, metamagia, invocações,
// manobras, infusões, dádiva de pacto (optionalfeatures do 5etools).
// ------------------------------------------------------------
const OFT_LABEL = {
  "FS:F": "Estilo de luta", "FS:R": "Estilo de luta", "FS:P": "Estilo de luta", "FS:B": "Estilo de luta",
  MM: "Metamagia", EI: "Invocação mística", "MV:B": "Manobra", AI: "Infusão de artífice",
  AS: "Disparo arcano", ED: "Disciplina elemental", RN: "Runa", PB: "Dádiva de pacto", RP: "Opção", RN2: "Runa",
};
function progressionAt(progression, level) {
  if (Array.isArray(progression)) return Number(progression[Math.min(level, progression.length) - 1]) || 0;
  if (progression && typeof progression === "object") {
    let best = 0;
    for (const [k, v] of Object.entries(progression)) if (Number(k) <= level) best = Math.max(best, Number(v) || 0);
    return best;
  }
  return 0;
}
function prereqLevel(o) {
  let max = 0;
  for (const p of o?.prerequisite || []) {
    const l = typeof p.level === "number" ? p.level : p.level?.level;
    if (l) max = Math.max(max, Number(l) || 0);
  }
  return max;
}
function prereqText(o) {
  const parts = [];
  for (const p of o?.prerequisite || []) {
    if (p.level) parts.push(`nível ${typeof p.level === "number" ? p.level : p.level.level}`);
    if (p.pact) parts.push(`Pacto d${{ Blade: "a Lâmina", Tome: "o Tomo", Chain: "a Corrente", Talisman: "o Talismã" }[p.pact] || "e " + p.pact}`);
    if (p.patron) parts.push(String(p.patron));
    if (Array.isArray(p.spell)) parts.push(p.spell.map((s) => String(s).replace(/#.*/, "")).join(", "));
    if (p.otherSummary?.entry) parts.push(inlineTags(p.otherSummary.entry));
  }
  return parts.join(" · ");
}
function optionalFeatureProgs(level) {
  const out = [];
  for (const rec of [details.classRec || {}, details.subclassRec || {}]) {
    for (const p of rec.optionalfeatureProgression || []) {
      const count = progressionAt(p.progression, level);
      if (count > 0) out.push({ name: p.name, featureType: p.featureType || [], count });
    }
  }
  return out;
}

// ------------------------------------------------------------
// Talentos (feats) — feat de origem do background (2024) + as
// melhorias de níveis 4/8/12/16/19 (talento OU +2/+1 de atributo).
// ------------------------------------------------------------
const featStubs = () => manifest().filter((x) => normType(x.type) === "feat");
const featRec = (e) => (e && (e.__rec || recordsForEntity(e)[0])) || {};
function featAbilityChoose(rec) {
  for (const blk of rec?.ability || []) {
    const ch = blk?.choose;
    if (ch && Array.isArray(ch.from)) return { from: ch.from.map(abilityKey).filter(Boolean), count: Number(ch.count || ch.amount || 1) || 1 };
  }
  return null;
}
function featFixedAbility(rec) {
  const out = {};
  for (const blk of rec?.ability || []) {
    if (!blk || blk.choose) continue;
    for (const [k, v] of Object.entries(blk)) { const a = abilityKey(k); if (a && typeof v === "number") out[a] = (out[a] || 0) + v; }
  }
  return out;
}
function featFixedSkills(rec) {
  const out = [];
  for (const blk of rec?.skillProficiencies || []) {
    if (!blk || blk.choose) continue;
    for (const [k, v] of Object.entries(blk)) { const s = skillKey(k); if (s && v === true) out.push(s); }
  }
  return [...new Set(out)];
}
// "magic initiate; cleric|xphb" -> stub do feat "Magic Initiate" fonte XPHB
function resolveFeatKey(key) {
  const [rawName, src] = String(key).split("|");
  const name = rawName.replace(/;.*$/, "").trim().toLowerCase();
  return featStubs().find((e) => e.name.toLowerCase() === name && String(e.source || "").toLowerCase() === String(src || "").toLowerCase())
    || featStubs().find((e) => e.name.toLowerCase() === name) || null;
}
// Espec. de talento a partir de um campo `feats` (background ou espécie).
// anyMeansOrigin: no background 2024, "any" = talento de origem; na
// espécie (Linhagem Personalizada / Humano Variante), "any" = qualquer.
function featSpecFrom(rec, anyMeansOrigin) {
  const blk = Array.isArray(rec?.feats) ? rec.feats[0] : null;
  if (!blk) return null;
  for (const [k, v] of Object.entries(blk)) {
    if (k === "anyFromCategory" && v) {
      const cats = [].concat(v.category || []).map((c) => String(c).toUpperCase());
      return { fixed: null, categories: cats.length ? cats : null };
    }
    if (k === "any") return { fixed: null, categories: anyMeansOrigin ? ["O"] : null };
    if (v === true) { const e = resolveFeatKey(k); if (e) return { fixed: e, categories: null }; }
  }
  return null;
}
const originFeatSpec = (br) => featSpecFrom(br, true);
const raceFeatSpec = (rr) => featSpecFrom(rr, false);
function asiSlotCount(classFeatures) {
  return (classFeatures || []).filter((f) => /ability score improvement/i.test(String(f.name || ""))).length;
}
function chosenFeatEntities() {
  const out = [];
  for (const id of [character.choiceSelections?.originFeat, character.choiceSelections?.raceFeat]) {
    if (id) { const e = manifest().find((x) => x.id === id); if (e) out.push(e); }
  }
  for (const slot of character.choiceSelections?.asi || []) {
    if (slot && slot.mode === "feat" && slot.feat) { const e = manifest().find((x) => x.id === slot.feat); if (e) out.push(e); }
  }
  return out;
}
// Bônus de atributo e perícias vindos dos talentos escolhidos.
function featBonuses() {
  const abilities = {}, skills = [];
  for (const e of chosenFeatEntities()) {
    const r = featRec(e);
    const fx = featFixedAbility(r);
    for (const [a, n] of Object.entries(fx)) abilities[a] = (abilities[a] || 0) + n;
    const chooseSpec = featAbilityChoose(r);
    if (chooseSpec) {
      const picked = character.choiceSelections?.featAbility?.[e.id];
      if (picked && chooseSpec.from.includes(picked)) abilities[picked] = (abilities[picked] || 0) + 1;
    }
    featFixedSkills(r).forEach((s) => skills.push(s));
  }
  return { abilities, skills: [...new Set(skills)] };
}

async function buildAutomation() {
  character.auto = character.auto || {};
  const cr = details.classRec || {}, rr = details.raceRec || {}, br = details.backgroundRec || {};
  const classProf = cr.startingProficiencies || cr;
  const bgProf = br.skillProficiencies ? br : (br.startingProficiencies || br);
  const classFixedSkills = fixedSkillsFrom(classProf);
  const bgFixedSkills = fixedSkillsFrom(br.skillProficiencies || bgProf);
  const raceFixedSkills = fixedSkillsFrom(rr.skillProficiencies);
  const classSaves = savesFrom(cr);
  const previousAuto = [...(character.auto?.classSkills || []), ...(character.auto?.backgroundSkills || [])];
  const previousChoices = [...Object.values(character.choiceSelections?.classSkills || {}).flat(), ...Object.values(character.choiceSelections?.backgroundSkills || {}).flat()];
  if (!Array.isArray(character.manualSkillProficiencies) || !character.manualSkillProficiencies.length) {
    character.manualSkillProficiencies = (character.skillProficiencies || []).filter((k) => !previousAuto.includes(k) && !previousChoices.includes(k));
  }
  character.auto.classSkills = classFixedSkills;
  character.auto.backgroundSkills = bgFixedSkills;
  character.auto.raceSkills = raceFixedSkills;
  character.auto.classSaves = classSaves;
  character.auto.speed = speedFrom(rr);
  character.auto.hitDice = hitDiceFrom(cr);
  character.auto.spellcastingAbility = spellAbilityFrom(cr);
  const fixedSkills = [...new Set([...classFixedSkills, ...bgFixedSkills, ...raceFixedSkills])];
  // Perícias de multiclasse: tabela reduzida do PHB — cada classe
  // adicional pode conceder no máximo 1 escolha de perícia (armas e
  // armaduras entram só como texto, ver renderProficiencies).
  const mcSkillChoices = (details.multiclasses || []).map((m) => {
    const gained = m.classRec?.multiclassing?.proficienciesGained;
    return gained ? (skillChoicesFrom(gained.skills || gained)[0] || null) : null;
  });
  character.skillProficiencies = [...new Set([
    ...(character.manualSkillProficiencies || []), ...fixedSkills,
    ...Object.values(character.choiceSelections?.classSkills || {}).flat(),
    ...Object.values(character.choiceSelections?.backgroundSkills || {}).flat(),
    ...Object.values(character.choiceSelections?.raceSkills || {}).flat(),
    ...Object.values(character.choiceSelections?.multiclassSkills || {}).flat(),
  ])];
  character.saveProficiencies = [...new Set([...classSaves, ...(character.manualSaveProficiencies || [])])];
  if (character.auto.speed && !character.manualSpeed) character.speed = character.auto.speed;
  if (character.auto.spellcastingAbility && !character.manualSpellAbility) character.spellAbility = character.auto.spellcastingAbility;

  const classFeats = refs.class ? await findClassFeatures(refs.class, Number(character.level)).catch(() => []) : [];
  const mcClassFeats = await Promise.all((details.multiclasses || []).map((m) =>
    m.classEntry ? findClassFeatures(m.classEntry, Number(m.level)).catch(() => []) : Promise.resolve([])));

  // Especialização: nº de perícias vem das características "Expertise" da
  // classe até o nível atual (Ladino 1/6, Bardo 3/10 = 2 cada).
  const expertise = classFeats.filter((f) => /^expertise$/i.test(String(f.name || "").trim())).length * 2;
  character.auto.expertiseSlots = expertise;
  character.skillExpertise = (character.skillExpertise || []).filter((k) => character.skillProficiencies.includes(k));

  const optFeatures = optionalFeatureProgs(Number(character.level));
  if (optFeatures.length) { try { await ensureCatalog("optionalfeature"); } catch (e) { console.warn("Catálogo de opções indisponível:", e); } }

  // Talentos: feat de origem do background (2024), talento de espécie
  // (Linhagem Personalizada / Humano Variante) + slots de melhoria. Cada
  // classe (primária + multiclasse) concede seus próprios slots de ASI
  // nos níveis 4/8/12/16/19 — próprios de cada classe, não do total.
  const asiCount = asiSlotCount(classFeats) + mcClassFeats.reduce((n, f) => n + asiSlotCount(f), 0);
  const wantsFeats = asiCount || originFeatSpec(br) || raceFeatSpec(rr);
  if (wantsFeats) { try { await ensureCatalog("feat"); } catch (e) { console.warn("Catálogo de talentos indisponível:", e); } }
  const originSpec2 = wantsFeats ? originFeatSpec(br) : null; // recomputa após carregar o catálogo
  const raceSpec = wantsFeats ? raceFeatSpec(rr) : null;
  if (originSpec2 && originSpec2.fixed) character.choiceSelections.originFeat = originSpec2.fixed.id;
  else if (!originSpec2) character.choiceSelections.originFeat = null;
  if (raceSpec && raceSpec.fixed) character.choiceSelections.raceFeat = raceSpec.fixed.id;
  else if (!raceSpec) character.choiceSelections.raceFeat = null;
  character.choiceSelections.asi = (character.choiceSelections.asi || []).slice(0, asiCount);
  const fb = featBonuses();
  character.auto.featSkills = fb.skills;
  if (fb.skills.length) character.skillProficiencies = [...new Set([...character.skillProficiencies, ...fb.skills])];

  renderAutoChoices({
    classChoices: skillChoicesFrom(classProf),
    backgroundChoices: skillChoicesFrom(br.skillProficiencies || bgProf),
    raceChoices: skillChoicesFrom(rr.skillProficiencies),
    abilityChoices: abilityChoicesFrom(rr),
    bgAbility: bgAbilitySpec(br),
    expertise,
    optFeatures,
    asiCount,
    originSpec: originSpec2,
    raceSpec,
    mcSkillChoices,
  });
}
function choiceStore(type) { return character.choiceSelections?.[type] || []; }
function toggleIn(a, v, on) { const i = a.indexOf(v); if (on && i < 0) a.push(v); if (!on && i >= 0) a.splice(i, 1); }
function renderAutoChoices(data) {
  const box = $("auto-choices");
  if (!box) return;
  const sections = [];
  const addSkillSection = (label, choices, type) => {
    choices.forEach((ch, idx) => {
      const selected = choiceStore(type)[idx] || [];
      const remaining = Math.max(0, ch.count - selected.length);
      sections.push(`<div class="auto-choice"><div class="auto-choice-head"><strong>${esc(label)}</strong><span>Escolha ${ch.count}</span></div><p>${remaining ? `Faltam ${remaining} escolha(s).` : "Completo."}</p><div class="choice-options">${ch.from.map((k) => {
        const on = selected.includes(k);
        return `<label class="choice-option"><input type="checkbox" data-auto-choice="${esc(type)}" data-choice-index="${idx}" data-choice-value="${esc(k)}" ${on ? "checked" : ""} ${!on && selected.length >= ch.count ? "disabled" : ""}><span>${esc(SKILLS.find((x) => x[0] === k)?.[1] || k)}</span></label>`;
      }).join("")}</div></div>`);
    });
  };
  addSkillSection(`Perícias da classe — ${titleOf(refs.class)}`, data.classChoices, "classSkills");
  addSkillSection(`Perícias do background — ${titleOf(refs.background)}`, data.backgroundChoices, "backgroundSkills");
  addSkillSection(`Perícias da espécie — ${titleOf(refs.race)}`, data.raceChoices || [], "raceSkills");
  (data.mcSkillChoices || []).forEach((ch, idx) => {
    if (!ch) return;
    const mc = details.multiclasses?.[idx];
    if (!mc?.classEntry) return;
    const selected = character.choiceSelections.multiclassSkills?.[idx] || [];
    const remaining = Math.max(0, ch.count - selected.length);
    sections.push(`<div class="auto-choice"><div class="auto-choice-head"><strong>Perícia de multiclasse — ${esc(titleOf(mc.classEntry))}</strong><span>Escolha ${ch.count}</span></div><p>${remaining ? `Faltam ${remaining} escolha(s).` : "Completo."}</p><div class="choice-options">${ch.from.map((k) => {
      const on = selected.includes(k);
      return `<label class="choice-option"><input type="checkbox" data-mc-skill-choice="${idx}" data-choice-value="${esc(k)}" ${on ? "checked" : ""} ${!on && selected.length >= ch.count ? "disabled" : ""}><span>${esc(SKILLS.find((x) => x[0] === k)?.[1] || k)}</span></label>`;
    }).join("")}</div></div>`);
  });
  data.abilityChoices.forEach((ch, idx) => {
    const selected = character.choiceSelections.abilityChoices?.[idx] || [];
    sections.push(`<div class="auto-choice"><div class="auto-choice-head"><strong>Aumentos de atributo — ${esc(titleOf(refs.race))}</strong><span>Escolha ${ch.count}</span></div><div class="choice-options">${ch.from.map((k) => `<label class="choice-option"><input type="checkbox" data-ability-choice="${idx}" value="${k}" ${selected.includes(k) ? "checked" : ""} ${!selected.includes(k) && selected.length >= ch.count ? "disabled" : ""}><span>${ABILITY_NAMES[k]}</span></label>`).join("")}</div></div>`);
  });
  const bga = data.bgAbility;
  if (bga && bga.hasChoice) {
    const modeIdx = Math.max(0, Math.min(Number(character.choiceSelections.bgAbilityMode || 0), bga.modes.length - 1));
    const weights = bga.modes[modeIdx] || [];
    const picks = character.choiceSelections.bgAbility || [];
    const lbl = (w) => w.map((n) => `+${n}`).join(" / ");
    const modeBtns = bga.modes.length > 1
      ? `<div class="asi-modes">${bga.modes.map((w, i) => `<button type="button" class="asi-mode${i === modeIdx ? " active" : ""}" data-bg-ability-mode="${i}">${lbl(w)}</button>`).join("")}</div>`
      : "";
    const selects = weights.map((n, i) => {
      const chosen = picks[i] || "";
      const used = picks.filter((_, j) => j !== i);
      const opts = bga.from.map((k) => `<option value="${k}"${k === chosen ? " selected" : ""}${used.includes(k) ? " disabled" : ""}>${ABILITY_NAMES[k]}</option>`).join("");
      return `<label class="asi-pick"><span>+${n}</span><select data-bg-ability="${i}"><option value="">—</option>${opts}</select></label>`;
    }).join("");
    sections.push(`<div class="auto-choice"><div class="auto-choice-head"><strong>Aumento de atributo — ${esc(titleOf(refs.background))}</strong><span>${lbl(weights)}</span></div><p>Regra 2024: o background distribui esses aumentos entre os atributos.</p>${modeBtns}<div class="asi-picks">${selects}</div></div>`);
  }
  if (data.expertise > 0) {
    const proficient = SKILLS.filter(([k]) => character.skillProficiencies.includes(k));
    const chosen = character.skillExpertise || [];
    sections.push(`<div class="auto-choice"><div class="auto-choice-head"><strong>Especialização — ${esc(titleOf(refs.class))}</strong><span>Escolha ${data.expertise}</span></div>
      <p>Dobra a proficiência na perícia. Só vale para perícias em que você já tem proficiência.</p>
      <div class="choice-options">${proficient.length ? proficient.map(([k, n]) => {
        const on = chosen.includes(k);
        return `<label class="choice-option"><input type="checkbox" data-expertise="${k}" ${on ? "checked" : ""} ${!on && chosen.length >= data.expertise ? "disabled" : ""}><span>${esc(n)}</span></label>`;
      }).join("") : "<span class='muted'>Escolha perícias com proficiência primeiro.</span>"}</div></div>`);
  }
  (data.optFeatures || []).forEach((prog) => {
    const types = new Set(prog.featureType);
    const lvl = Number(character.level);
    const opts = manifest().filter((x) =>
      normType(x.type) === "optionalfeature" && !hb(x) &&
      ((x.__rec || recordsForEntity(x)[0])?.featureType || []).some((t) => types.has(t)) &&
      matchesEdition(x, character.edition, true) &&
      prereqLevel(x.__rec || recordsForEntity(x)[0] || {}) <= lvl
    ).sort((a, b) => String(a.name).localeCompare(String(b.name), "pt-BR"));
    const chosen = character.choiceSelections.optionalFeatures?.[prog.name] || [];
    const label = OFT_LABEL[prog.featureType[0]] || prog.name;
    sections.push(`<div class="auto-choice"><div class="auto-choice-head"><strong>${esc(label)}${prog.name && prog.name !== label ? ` (${esc(prog.name)})` : ""}</strong><span>Escolha ${prog.count}</span></div>
      <div class="choice-options scroll">${opts.length ? opts.map((x) => {
        const on = chosen.includes(x.id);
        const pr = prereqText(x.__rec || recordsForEntity(x)[0] || {});
        return `<label class="choice-option"><input type="checkbox" data-optfeat="${esc(prog.name)}" value="${esc(x.id)}" ${on ? "checked" : ""} ${!on && chosen.length >= prog.count ? "disabled" : ""}><span>${esc(x.name)}${pr ? ` <em class="pr">${esc(pr)}</em>` : ""}</span></label>`;
      }).join("") : "<span class='muted'>Nenhuma opção no banco para esta edição.</span>"}</div></div>`);
  });

  // --- Talentos ---
  const eligibleFeats = (categories) => {
    const lvl = Number(character.level);
    return featStubs().filter((e) => {
      if (hb(e) || /ability score improvement/i.test(e.name)) return false;
      if (!matchesEdition(e, character.edition, true)) return false;
      const r = featRec(e), cat = String(r.category || "").toUpperCase();
      if (prereqLevel(r) > lvl) return false;
      if (categories) return categories.includes(cat);
      if (cat === "O") return false;
      if (cat === "EB" && lvl < 19) return false;
      return true;
    }).sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
  };
  const featSelect = (attr, current, categories) =>
    `<select ${attr}><option value="">— escolher talento —</option>${eligibleFeats(categories).map((e) =>
      `<option value="${esc(e.id)}"${e.id === current ? " selected" : ""}>${esc(e.name)}${e.source ? ` (${esc(e.source)})` : ""}</option>`).join("")}</select>`;
  const featAbilPicker = (featId) => {
    const e = featId && manifest().find((x) => x.id === featId);
    const spec = e && featAbilityChoose(featRec(e));
    if (!spec || !spec.from.length) return "";
    const cur = character.choiceSelections?.featAbility?.[featId] || "";
    return `<label class="asi-pick"><span>talento +1</span><select data-feat-ability="${esc(featId)}"><option value="">—</option>${spec.from.map((k) => `<option value="${k}"${k === cur ? " selected" : ""}>${ABILITY_NAMES[k]}</option>`).join("")}</select></label>`;
  };
  const featGrantSection = (spec, title, sourceLabel, selAttr, curId) => {
    if (spec.fixed) {
      sections.push(`<div class="auto-choice"><div class="auto-choice-head"><strong>${esc(title)}</strong><span>Fixo</span></div>
        <p>${esc(spec.fixed.name)}${spec.fixed.source ? ` (${esc(spec.fixed.source)})` : ""} — ${esc(sourceLabel)}.</p>
        <div class="asi-picks">${featAbilPicker(spec.fixed.id)}</div></div>`);
    } else {
      sections.push(`<div class="auto-choice"><div class="auto-choice-head"><strong>${esc(title)}</strong><span>Escolha 1</span></div>
        <div class="asi-picks">${featSelect(selAttr, curId, spec.categories)}${featAbilPicker(curId)}</div></div>`);
    }
  };
  if (data.originSpec) featGrantSection(data.originSpec, `Talento de origem — ${titleOf(refs.background)}`, "concedido pelo background", "data-origin-feat", character.choiceSelections.originFeat || "");
  if (data.raceSpec) featGrantSection(data.raceSpec, `Talento da espécie — ${titleOf(refs.race)}`, "concedido pela espécie", "data-race-feat", character.choiceSelections.raceFeat || "");
  for (let i = 0; i < (data.asiCount || 0); i++) {
    const slot = character.choiceSelections.asi[i] || { mode: "" };
    const isAbil = slot.mode === "ability", isFeat = slot.mode === "feat";
    let inner = `<div class="asi-modes">
      <button type="button" class="asi-mode${isAbil ? " active" : ""}" data-asi-mode="${i}:ability">Atributo</button>
      <button type="button" class="asi-mode${isFeat ? " active" : ""}" data-asi-mode="${i}:feat">Talento</button></div>`;
    if (isAbil) {
      const s = [(slot.abil || [])[0] || "", (slot.abil || [])[1] || ""];
      const sel = (v, di) => `<select data-asi-abil="${i}:${di}"><option value="">—</option>${ABILITIES.map((k) => `<option value="${k}"${k === v ? " selected" : ""}>${ABILITY_NAMES[k]}</option>`).join("")}</select>`;
      inner += `<p class="muted">+1 em dois atributos — ou o mesmo atributo nos dois campos para +2.</p><div class="asi-picks"><label class="asi-pick"><span>+1</span>${sel(s[0], 0)}</label><label class="asi-pick"><span>+1</span>${sel(s[1], 1)}</label></div>`;
    } else if (isFeat) {
      inner += `<div class="asi-picks">${featSelect(`data-asi-feat="${i}"`, slot.feat || "", null)}${featAbilPicker(slot.feat)}</div>`;
    }
    sections.push(`<div class="auto-choice"><div class="auto-choice-head"><strong>Melhoria de atributo/talento nº ${i + 1}</strong><span>talento ou atributo</span></div>${inner}</div>`);
  }

  $("auto-status").textContent = sections.length ? "Escolhas disponíveis" : "Nenhuma escolha pendente";
  if (!sections.length) { box.innerHTML = `<div class="auto-empty">As escolhas automáticas aparecerão aqui quando a classe/background/espécie fornecerem opções no banco.</div>`; return; }
  box.innerHTML = sections.join("");
  box.querySelectorAll("[data-auto-choice]").forEach((i) => i.addEventListener("change", () => {
    const t = i.dataset.autoChoice, idx = Number(i.dataset.choiceIndex), v = i.dataset.choiceValue;
    character.choiceSelections[t] = character.choiceSelections[t] || [];
    const current = character.choiceSelections[t][idx] || [];
    toggleIn(current, v, i.checked);
    const limit = (t === "classSkills" ? data.classChoices : t === "backgroundSkills" ? data.backgroundChoices : data.raceChoices || [])[idx]?.count ?? current.length;
    if (current.length > limit) { current.pop(); i.checked = false; toast(`Você pode escolher apenas ${limit}.`); }
    character.choiceSelections[t][idx] = current;
    character.skillProficiencies = [...new Set([
      ...(character.manualSkillProficiencies || []), ...(character.auto?.classSkills || []), ...(character.auto?.backgroundSkills || []), ...(character.auto?.raceSkills || []),
      ...Object.values(character.choiceSelections.classSkills || {}).flat(),
      ...Object.values(character.choiceSelections.backgroundSkills || {}).flat(),
      ...Object.values(character.choiceSelections.raceSkills || {}).flat(),
    ])];
    saveCharacter(character); recalc();
  }));
  box.querySelectorAll("[data-mc-skill-choice]").forEach((i) => i.addEventListener("change", () => {
    const idx = Number(i.dataset.mcSkillChoice), v = i.dataset.choiceValue;
    character.choiceSelections.multiclassSkills = character.choiceSelections.multiclassSkills || {};
    const current = character.choiceSelections.multiclassSkills[idx] || [];
    toggleIn(current, v, i.checked);
    const limit = (data.mcSkillChoices || [])[idx]?.count ?? current.length;
    if (current.length > limit) { current.pop(); i.checked = false; toast(`Você pode escolher apenas ${limit}.`); }
    character.choiceSelections.multiclassSkills[idx] = current;
    saveCharacter(character); recalc();
  }));
  box.querySelectorAll("[data-ability-choice]").forEach((i) => i.addEventListener("change", () => {
    const idx = Number(i.dataset.abilityChoice);
    character.choiceSelections.abilityChoices = character.choiceSelections.abilityChoices || {};
    const cur = character.choiceSelections.abilityChoices[idx] || [];
    toggleIn(cur, i.value, i.checked);
    const limit = data.abilityChoices[idx]?.count ?? cur.length;
    if (cur.length > limit) { cur.pop(); i.checked = false; toast(`Você pode escolher apenas ${limit}.`); }
    character.choiceSelections.abilityChoices[idx] = cur;
    saveCharacter(character); recalc();
  }));
  box.querySelectorAll("[data-bg-ability-mode]").forEach((b) => b.addEventListener("click", () => {
    character.choiceSelections.bgAbilityMode = Number(b.dataset.bgAbilityMode);
    character.choiceSelections.bgAbility = [];
    saveCharacter(character); recalc();
  }));
  box.querySelectorAll("[data-bg-ability]").forEach((s) => s.addEventListener("change", () => {
    const i = Number(s.dataset.bgAbility);
    character.choiceSelections.bgAbility = character.choiceSelections.bgAbility || [];
    character.choiceSelections.bgAbility[i] = s.value || null;
    saveCharacter(character); recalc();
  }));
  box.querySelectorAll("[data-expertise]").forEach((i) => i.addEventListener("change", () => {
    character.skillExpertise = character.skillExpertise || [];
    toggleIn(character.skillExpertise, i.dataset.expertise, i.checked);
    if (character.skillExpertise.length > data.expertise) { character.skillExpertise.pop(); i.checked = false; toast(`Você pode escolher apenas ${data.expertise}.`); }
    saveCharacter(character); recalc();
  }));
  box.querySelectorAll("[data-optfeat]").forEach((i) => i.addEventListener("change", () => {
    const key = i.dataset.optfeat;
    character.choiceSelections.optionalFeatures = character.choiceSelections.optionalFeatures || {};
    const cur = character.choiceSelections.optionalFeatures[key] || [];
    toggleIn(cur, i.value, i.checked);
    const prog = (data.optFeatures || []).find((p) => p.name === key);
    if (prog && cur.length > prog.count) { cur.pop(); i.checked = false; toast(`Você pode escolher apenas ${prog.count}.`); }
    character.choiceSelections.optionalFeatures[key] = cur;
    saveCharacter(character); recalc();
  }));
  box.querySelectorAll("[data-origin-feat]").forEach((s) => s.addEventListener("change", () => {
    character.choiceSelections.originFeat = s.value || null;
    saveCharacter(character); recalc();
  }));
  box.querySelectorAll("[data-race-feat]").forEach((s) => s.addEventListener("change", () => {
    character.choiceSelections.raceFeat = s.value || null;
    saveCharacter(character); recalc();
  }));
  box.querySelectorAll("[data-asi-mode]").forEach((b) => b.addEventListener("click", () => {
    const [i, m] = b.dataset.asiMode.split(":");
    character.choiceSelections.asi[Number(i)] = { mode: m, abil: [], feat: "" };
    saveCharacter(character); recalc();
  }));
  box.querySelectorAll("[data-asi-abil]").forEach((s) => s.addEventListener("change", () => {
    const [i, di] = s.dataset.asiAbil.split(":").map(Number);
    const slot = character.choiceSelections.asi[i] || { mode: "ability", abil: [] };
    const abil = slot.abil ? slot.abil.slice() : [];
    abil[di] = s.value || "";
    character.choiceSelections.asi[i] = { mode: "ability", abil: abil.filter(Boolean) };
    saveCharacter(character); recalc();
  }));
  box.querySelectorAll("[data-asi-feat]").forEach((s) => s.addEventListener("change", () => {
    const i = Number(s.dataset.asiFeat);
    character.choiceSelections.asi[i] = { mode: "feat", feat: s.value || "", abil: [] };
    saveCharacter(character); recalc();
  }));
  box.querySelectorAll("[data-feat-ability]").forEach((s) => s.addEventListener("change", () => {
    character.choiceSelections.featAbility = character.choiceSelections.featAbility || {};
    character.choiceSelections.featAbility[s.dataset.featAbility] = s.value || "";
    saveCharacter(character); recalc();
  }));
}

// ------------------------------------------------------------
// Cálculos
// ------------------------------------------------------------
function classInfo() { return refs.class ? details.classRec || {} : {}; }
// Aumentos de atributo do background. Cobre o formato "One D&D" (2024),
// em que o background dá um bônus ponderado — +2/+1 OU +1/+1/+1 — a ser
// distribuído pelo jogador, e também o formato fixo simples (homebrew).
function bgAbilitySpec(br) {
  const blocks = Array.isArray(br?.ability) ? br.ability : [];
  if (!blocks.length) return null;
  const fixed = {};
  const modes = [];
  let from = [];
  for (const blk of blocks) {
    const w = blk?.choose?.weighted;
    if (w && Array.isArray(w.from)) {
      from = [...new Set([...from, ...w.from.map(abilityKey).filter(Boolean)])];
      modes.push((w.weights || []).slice().sort((x, y) => y - x));
    } else if (blk && typeof blk === "object") {
      for (const [k, v] of Object.entries(blk)) {
        const key = abilityKey(k);
        if (key && typeof v === "number") fixed[key] = (fixed[key] || 0) + v;
      }
    }
  }
  if (!modes.length && !Object.keys(fixed).length) return null;
  return { from, modes, fixed, hasChoice: modes.length > 0 };
}
// Detalha, fonte a fonte, de onde vem cada ponto de bônus de um atributo
// (espécie fixa/escolhida, background fixo/escolhido, melhorias de nível,
// talentos) — usado tanto para somar o total quanto pro popup "de onde vêm
// esses pontos" na ficha e no assistente guiado.
function abilityBonusBreakdown(a) {
  const parts = [];
  const raceName = refs.race ? titleOf(refs.race) : "Espécie";
  const bgName = refs.background ? titleOf(refs.background) : "Background";
  const rr = details.raceRec || {};
  let raceFixed = 0;
  for (const blk of rr.ability || []) if (blk && typeof blk[a] === "number") raceFixed += blk[a];
  if (raceFixed) parts.push({ label: raceName, value: raceFixed });
  let raceChoice = 0;
  for (const list of Object.values(character.choiceSelections?.abilityChoices || {})) if (Array.isArray(list) && list.includes(a)) raceChoice += 1;
  if (raceChoice) parts.push({ label: `${raceName} (escolha)`, value: raceChoice });
  const spec = bgAbilitySpec(details.backgroundRec || {});
  if (spec) {
    if (spec.fixed[a]) parts.push({ label: bgName, value: spec.fixed[a] });
    if (spec.hasChoice) {
      const modeIdx = Math.max(0, Math.min(Number(character.choiceSelections?.bgAbilityMode || 0), spec.modes.length - 1));
      const weights = spec.modes[modeIdx] || [];
      (character.choiceSelections?.bgAbility || []).forEach((k, i) => { if (k === a && weights[i]) parts.push({ label: `${bgName} (escolha)`, value: weights[i] }); });
    }
  }
  // Melhorias de atributo dos slots de ASI (+2 em um / +1 em dois)
  for (const slot of character.choiceSelections?.asi || []) {
    if (slot && slot.mode === "ability") {
      const n = (slot.abil || []).filter((k) => k === a).length;
      if (n) parts.push({ label: "Melhoria de atributo (ASI)", value: n });
    }
  }
  // Bônus de atributo dos talentos escolhidos (fixo ou de escolha)
  for (const e of chosenFeatEntities()) {
    const r = featRec(e);
    const fx = featFixedAbility(r);
    if (fx[a]) parts.push({ label: `Talento: ${e.name}`, value: fx[a] });
    const chooseSpec = featAbilityChoose(r);
    if (chooseSpec) {
      const picked = character.choiceSelections?.featAbility?.[e.id];
      if (picked === a) parts.push({ label: `Talento: ${e.name}`, value: 1 });
    }
  }
  return parts;
}
function abilityBonusTotal(a) { return abilityBonusBreakdown(a).reduce((n, p) => n + p.value, 0); }
function effScore(a) { return (Number(character.scores[a]) || 10) + abilityBonusTotal(a); }
function openAbilityDetail(a) {
  if (!ABILITIES.includes(a)) return;
  const base = Number(character.scores[a]) || 10;
  const eff = effScore(a);
  const baseLabel = character.abilityMode === "free" ? "Valor base (livre)" : "Point buy / rolagem";
  const parts = abilityBonusBreakdown(a);
  const rows = [{ label: baseLabel, value: base, plain: true }, ...parts];
  $("modal-content").innerHTML = `<div class="modal-title"><div><span class="eyebrow">ATRIBUTO</span><h2>${esc(ABILITY_NAMES[a])}</h2></div></div>
    <div class="modal-body">
      <p class="muted">De onde vêm os ${eff} pontos de ${ABILITY_NAMES[a]} deste personagem.</p>
      <div class="ability-breakdown">
        ${rows.map((r) => `<div class="ability-breakdown-row"><span>${esc(r.label)}</span><b>${r.plain ? r.value : fmt(r.value)}</b></div>`).join("")}
        <div class="ability-breakdown-row total"><span>Total efetivo</span><b>${eff}</b></div>
      </div>
      <p class="muted">Modificador: ${fmt(mod(eff))}</p>
    </div>`;
  $("modal").classList.remove("hidden");
}
// PV médios: 1º nível da classe primária sempre no máximo do dado de
// vida; todos os outros níveis (restante da primária + TODAS as
// classes de multiclasse) usam a média do respectivo dado + CON.
function inferHP() {
  const conMod = mod(effScore("con"));
  const primaryHd = Number(character.auto?.hitDice || hitDiceFrom(classInfo()) || 8) || 8;
  const primaryLevel = Math.max(1, Number(character.level) || 1);
  let hp = primaryHd + conMod;
  for (let i = 1; i < primaryLevel; i++) hp += hpAverage(primaryHd) + conMod;
  for (const m of details.multiclasses || []) {
    const hd = Number(hitDiceFrom(m.classRec) || 8) || 8;
    for (let i = 0; i < Math.max(0, Number(m.level) || 0); i++) hp += hpAverage(hd) + conMod;
  }
  return Math.max(1, hp);
}
function calc() {
  const lvl = totalLevel(), pb = proficiency(lvl);
  const init = mod(effScore("dex"));
  const passive = 10 + mod(effScore("wis")) + (character.skillProficiencies.includes("perception") ? pb : 0) + (character.skillExpertise.includes("perception") ? pb : 0);
  const hp = inferHP();
  const ac = Number(character.ac) || 10 + mod(effScore("dex"));
  const speed = character.speed || character.auto?.speed || "30 ft";
  const sa = character.spellAbility || spellAbilityFrom(classInfo());
  const dc = sa ? spellDc(pb, mod(effScore(sa))) : null;
  const atk = sa ? spellAttack(pb, mod(effScore(sa))) : null;
  return { lvl, pb, init, passive, hp, ac, speed, sa, dc, atk };
}
async function recalc() {
  if (!character) return;
  resolveMulticlassRefs();
  details.classRec = await firstRecord(refs.class);
  details.raceRec = await firstRecord(refs.race);
  details.subclassRec = await firstRecord(refs.subclass);
  details.backgroundRec = await firstRecord(refs.background);
  details.multiclasses = await Promise.all((refs.multiclasses || []).map(async (m) => ({
    classEntry: m.classEntry, subclassEntry: m.subclassEntry, level: m.level,
    classRec: m.classEntry ? await firstRecord(m.classEntry) : {},
    subclassRec: m.subclassEntry ? await firstRecord(m.subclassEntry) : {},
  })));
  await buildAutomation();
  const mcLabels = (refs.multiclasses || []).map((m) => m.classEntry ? `${titleOf(m.classEntry)}${m.subclassEntry ? " · " + titleOf(m.subclassEntry) : ""} ${m.level}` : null).filter(Boolean);
  const primaryLabel = refs.class ? `${titleOf(refs.class)}${refs.subclass ? " · " + titleOf(refs.subclass) : ""}${mcLabels.length ? " " + character.level : ""}` : null;
  $("head-class").textContent = [primaryLabel, ...mcLabels].filter(Boolean).join(" / ") || "—";
  $("head-background").textContent = refs.background ? titleOf(refs.background) : "—";
  $("head-race").textContent = refs.race ? titleOf(refs.race) : "—";
  const c = calc();
  renderAbilities();
  $("v-ac").textContent = c.ac; $("v-init").textContent = fmt(c.init); $("v-speed").textContent = c.speed; $("v-pb").textContent = fmt(c.pb);
  $("v-passive").textContent = c.passive; $("v-spell-dc").textContent = c.dc ?? "—"; $("v-spell-atk").textContent = c.atk != null ? fmt(c.atk) : "—";
  $("v-hp-max").textContent = c.hp;
  $("hp-current").value = character.hpCurrent == null ? c.hp : character.hpCurrent;
  $("hp-temp").value = character.hpTemp || 0;
  $("combat-ac").textContent = c.ac; $("combat-init").textContent = fmt(c.init); $("combat-speed").textContent = c.speed; $("combat-pb").textContent = fmt(c.pb);
  $("ac-input").value = character.ac ?? "";
  $("speed-input").value = character.speed || "30 ft";
  renderSaves(c); renderSkills(c); renderIdentity(); renderAttacks(); renderProficiencies(); renderDeath();
  const active = document.querySelector(".tab.active")?.dataset.tab;
  if (active === "features") renderFeatures();
  if (active === "spells") renderSpells();
  if (active === "equipment" && eqCat === "inventory") renderStartingEquipment();
}
function renderSaves(c) {
  $("save-list").innerHTML = ABILITIES.map((a) => {
    const ok = character.saveProficiencies.includes(a), v = mod(effScore(a)) + (ok ? c.pb : 0);
    return `<label class="check-row"><input type="checkbox" data-save="${a}" ${ok ? "checked" : ""}><span>${ABILITY_NAMES[a]}</span><b>${fmt(v)}</b></label>`;
  }).join("");
  $("save-list").querySelectorAll("[data-save]").forEach((i) => i.addEventListener("change", () => {
    character.manualSaveProficiencies = character.manualSaveProficiencies || [];
    if (!(character.auto?.classSaves || []).includes(i.dataset.save)) toggleIn(character.manualSaveProficiencies, i.dataset.save, i.checked);
    toggleIn(character.saveProficiencies, i.dataset.save, i.checked || (character.auto?.classSaves || []).includes(i.dataset.save));
    saveCharacter(character); recalc();
  }));
}
function renderSkills(c) {
  $("skill-list").innerHTML = SKILLS.map(([k, n, a]) => {
    const p = character.skillProficiencies.includes(k), ex = character.skillExpertise.includes(k);
    const v = mod(effScore(a)) + c.pb * (ex ? 2 : p ? 1 : 0);
    return `<label class="skill-row"><input type="checkbox" data-skill="${k}" ${p ? "checked" : ""}><span>${n}</span><b>${fmt(v)}</b>${ex ? '<small>EXP</small>' : ""}</label>`;
  }).join("");
  $("skill-list").querySelectorAll("[data-skill]").forEach((i) => i.addEventListener("change", () => {
    const k = i.dataset.skill;
    const auto = [...(character.auto?.classSkills || []), ...(character.auto?.backgroundSkills || []), ...Object.values(character.choiceSelections?.classSkills || {}).flat(), ...Object.values(character.choiceSelections?.backgroundSkills || {}).flat()];
    if (!auto.includes(k)) toggleIn(character.manualSkillProficiencies, k, i.checked);
    toggleIn(character.skillProficiencies, k, i.checked || auto.includes(k));
    saveCharacter(character); recalc();
  }));
}
function profLabel(x) {
  if (typeof x === "string") return inlineTags(x).replace(/\s*\|.*$/, "");
  if (x && typeof x === "object") return inlineTags(x.full || x.proficiency || x.name || "");
  return "";
}
// Armaduras/armas/ferramentas com proficiência — computado uma vez e
// reaproveitado pela aba "Atributos & Perícias" e pela ficha oficial em PDF.
function computeProficiencySummary() {
  const cr = details.classRec || {}, br = details.backgroundRec || {}, sp = cr.startingProficiencies || {};
  const cap = (s) => s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
  const toLabels = (arr) => (arr || []).map(profLabel).map(cap).filter(Boolean);
  let armor = toLabels(sp.armor);
  let weapons = toLabels(sp.weapons);
  let tools = [...toLabels(sp.tools), ...flatObjects(br.toolProficiencies || []).flatMap((o) => Object.keys(o).filter((k) => o[k] === true)).map(cap)].filter(Boolean);
  let armorRaw = (sp.armor || []).map((x) => String(x).toLowerCase());
  // Multiclasse: tabela reduzida do PHB (multiclassing.proficienciesGained
  // de cada classe adicional) — bem menor que a proficiência de nível 1.
  for (const m of details.multiclasses || []) {
    const g = m.classRec?.multiclassing?.proficienciesGained || {};
    armor = [...armor, ...toLabels(g.armor)];
    weapons = [...weapons, ...toLabels(g.weapons)];
    tools = [...tools, ...toLabels(g.tools)];
    armorRaw = [...armorRaw, ...(g.armor || []).map((x) => String(x).toLowerCase())];
  }
  armor = [...new Set(armor)]; weapons = [...new Set(weapons)]; tools = [...new Set(tools)]; armorRaw = [...new Set(armorRaw)];
  return { armor, weapons, tools, armorRaw, saves: character.auto?.classSaves || [] };
}
function renderProficiencies() {
  const { armor, weapons, tools, saves } = computeProficiencySummary();
  $("proficiency-editor").innerHTML = `
    <div class="identity-row"><span>Armaduras</span><strong>${armor.length ? esc(armor.join(", ")) : "—"}</strong></div>
    <div class="identity-row"><span>Armas</span><strong>${weapons.length ? esc(weapons.join(", ")) : "—"}</strong></div>
    <div class="identity-row"><span>Ferramentas</span><strong>${tools.length ? esc(tools.join(", ")) : "—"}</strong></div>
    <div class="identity-row"><span>Resistências</span><strong>${saves.map((a) => ABILITY_NAMES[a]).join(", ") || "—"}</strong></div>
    <p class="muted">As perícias com proficiência automática aparecem marcadas na aba Ficha e não podem ser desmarcadas.</p>`;
}
function renderIdentity() {
  const rows = [["Espécie", refs.race], ["Classe", refs.class], ["Subclasse", refs.subclass], ["Background", refs.background]];
  let html = rows.map(([k, e]) => `<div class="identity-row"><span>${k}</span><strong>${e ? esc(titleOf(e)) : "—"}</strong>${e ? sourceTag(e) : ""}</div>`).join("");
  (refs.multiclasses || []).forEach((m) => {
    if (!m.classEntry) return;
    html += `<div class="identity-row"><span>Multiclasse</span><strong>${esc(titleOf(m.classEntry))}${m.subclassEntry ? " · " + esc(titleOf(m.subclassEntry)) : ""} (nível ${m.level})</strong>${sourceTag(m.classEntry)}</div>`;
  });
  $("identity").innerHTML = html;
}
function renderAttacks() {
  const arr = character.attacks || [];
  $("attacks").innerHTML = arr.length ? arr.map((a, i) => `<div class="attack-row"><input data-a="name" data-i="${i}" value="${esc(a.name || "")}" placeholder="Nome"><input data-a="bonus" data-i="${i}" value="${esc(a.bonus || "")}" placeholder="Bônus"><input data-a="damage" data-i="${i}" value="${esc(a.damage || "")}" placeholder="Dano"><input data-a="notes" data-i="${i}" value="${esc(a.notes || "")}" placeholder="Notas"><button class="remove-btn no-print" data-remove-attack="${i}">×</button></div>`).join("") : `<div class="empty">Nenhum ataque adicionado.</div>`;
  $("attacks").querySelectorAll("[data-a]").forEach((i) => i.addEventListener("input", () => { character.attacks[Number(i.dataset.i)][i.dataset.a] = i.value; saveCharacter(character); }));
  $("attacks").querySelectorAll("[data-remove-attack]").forEach((b) => b.addEventListener("click", () => { character.attacks.splice(Number(b.dataset.removeAttack), 1); renderAttacks(); }));
}
async function renderFeatures() {
  const box = $("feature-list");
  box.innerHTML = `<div class="empty">Carregando características…</div>`;
  const groups = [];
  const mcLabel = (name) => (details.multiclasses || []).some((m) => m.classEntry) ? ` — ${esc(name)}` : "";
  if (refs.class) groups.push([`CLASSE${mcLabel(titleOf(refs.class))}`, await findClassFeatures(refs.class, Number(character.level))]);
  if (refs.subclass) groups.push([`SUBCLASSE${mcLabel(titleOf(refs.subclass))}`, await findSubclassFeatures(refs.subclass, Number(character.level))]);
  for (const m of details.multiclasses || []) {
    if (m.classEntry) groups.push([`CLASSE — ${esc(titleOf(m.classEntry))} (nível ${m.level})`, await findClassFeatures(m.classEntry, Number(m.level))]);
    if (m.subclassEntry) groups.push([`SUBCLASSE — ${esc(titleOf(m.subclassEntry))}`, await findSubclassFeatures(m.subclassEntry, Number(m.level))]);
  }
  if (refs.race) {
    const r = await firstRecord(refs.race);
    const f = Array.isArray(r?.entries) ? r.entries.filter((x) => x && x.name) : [];
    if (f.length) groups.push(["ESPÉCIE / RAÇA", f.map((x, i) => ({ name: x.name || `Traço ${i + 1}`, entries: x.entries || x }))]);
  }
  if (refs.background) {
    const r = await firstRecord(refs.background);
    const f = Array.isArray(r?.entries) ? r.entries.filter((x) => x && x.name && /feature|característica/i.test(x.name)) : [];
    if (f.length) groups.push(["BACKGROUND", f.map((x) => ({ name: x.name, entries: x.entries }))]);
  }
  // Talentos escolhidos (origem + melhorias)
  const featEnts = chosenFeatEntities();
  if (featEnts.length) {
    groups.push(["TALENTOS", featEnts.map((e) => { const r = featRec(e); return { name: e.name, level: r.source || "—", entries: r.entries }; })]);
  }
  // Características opcionais escolhidas (estilo de luta, metamagia, invocações…)
  const ofSel = character.choiceSelections?.optionalFeatures || {};
  const ofItems = Object.values(ofSel).flat().map((id) => manifest().find((x) => x.id === id)).filter(Boolean);
  if (ofItems.length) {
    groups.push(["OPÇÕES ESCOLHIDAS", ofItems.map((e) => {
      const r = recordsForEntity(e)[0] || {};
      const tl = OFT_LABEL[(r.featureType || [])[0]] || "";
      return { name: e.name, level: tl || "—", entries: r.entries };
    })]);
  }
  const lvlLabel = (v) => (v == null || v === "") ? "—" : (typeof v === "number" || /^\d/.test(String(v))) ? `Nível ${esc(v)}` : esc(v);
  box.innerHTML = groups.filter((g) => g[1]?.length).map(([name, arr]) =>
    `<section class="feature-group"><h3>${name}</h3>${arr.map((f) => `<article class="feature"><div><b>${esc(f.name || "Característica")}</b><span>${lvlLabel(f.level)}</span></div><div>${f.entries ? richText(f.entries) : "<p class='muted'>Sem texto no banco para esta característica.</p>"}</div></article>`).join("")}</section>`
  ).join("") || `<div class="empty">Escolha uma classe/espécie para carregar as características.</div>`;
}

// ------------------------------------------------------------
// Magias — recursos de conjuração (espaços, truques, preparadas)
// ------------------------------------------------------------
const CASTER_LABEL = { full: "Conjurador completo", "1/2": "Meio-conjurador", half: "Meio-conjurador", artificer: "Conjuração de artífice", "1/3": "Um terço de conjurador", third: "Um terço de conjurador", pact: "Magia de pacto" };
// Lê uma coluna nomeada da tabela da classe (classTableGroups) — cobre
// truques/preparadas do 2024 e homebrew, que não trazem fórmula.
function tableCol(rec, level, labelRe) {
  for (const g of rec?.classTableGroups || []) {
    const idx = (g.colLabels || []).findIndex((l) => labelRe.test(String(l)));
    if (idx < 0) continue;
    const row = (g.rows || [])[Math.min(level, (g.rows || []).length) - 1];
    if (Array.isArray(row)) {
      const v = row[idx];
      const n = typeof v === "number" ? v : parseInt(String(v).replace(/[^\d-]/g, ""), 10);
      if (Number.isFinite(n)) return n;
    }
  }
  return null;
}
function slotRowFromTable(rec, level) {
  for (const g of rec?.classTableGroups || []) {
    if (!Array.isArray(g.rowsSpellProgression)) continue;
    const row = g.rowsSpellProgression[Math.min(level, g.rowsSpellProgression.length) - 1];
    if (Array.isArray(row)) return row.slice(0, 9);
  }
  return null;
}
function preparedFromFormula(formula, level, abilMod) {
  const f = String(formula).toLowerCase();
  let base = level;
  if (/\/\s*2/.test(f)) base = Math.floor(level / 2);
  else if (/\/\s*3/.test(f)) base = Math.floor(level / 3);
  return Math.max(1, base + (abilMod || 0));
}
function spellcastingInfoFor(cr, sr, level) {
  cr = cr || {}; sr = sr || {};
  const src = (cr.casterProgression || cr.spellcastingAbility) ? cr
    : (sr.casterProgression || sr.spellcasting || sr.spellcastingAbility) ? sr : null;
  if (!src) return null;
  const prog = String(src.casterProgression || (src === sr ? "1/3" : "full")).toLowerCase();
  const abilKey = abilityKey(src.spellcastingAbility) || spellAbilityFrom(cr) || spellAbilityFrom(sr);
  const abilMod = abilKey ? mod(effScore(abilKey)) : 0;

  let slots = null, pact = null;
  if (prog === "pact") pact = pactSlots(level);
  else slots = slotRowFromTable(src, level) || casterSlots(prog, level);

  let cantrips = Array.isArray(src.cantripProgression) ? src.cantripProgression[Math.min(level, src.cantripProgression.length) - 1] : null;
  if (cantrips == null) cantrips = tableCol(src, level, /cantrip/i);

  // "spellsKnownProgression" = magias conhecidas (Feiticeiro/Bruxo 2014, Ranger).
  // NB: "spellsKnownProgressionFixed" NÃO é isso — é o nº de magias que o
  // Mago copia pro grimório por nível — então não entra aqui.
  let known = Array.isArray(src.spellsKnownProgression) ? src.spellsKnownProgression[Math.min(level, src.spellsKnownProgression.length) - 1] : null;
  let prepared = null;
  if (known == null) {
    // 2024: coluna "Prepared Spells" na tabela da classe (sem fórmula).
    const tp = tableCol(src, level, /prepared spells/i);
    if (tp != null) prepared = tp;
    else if (src.preparedSpells) prepared = preparedFromFormula(src.preparedSpells, level, abilMod);
    else { const tk = tableCol(src, level, /spells known/i); if (tk != null) known = tk; }
  }
  return {
    ability: abilKey, abilityMod: abilMod, progression: prog,
    label: CASTER_LABEL[prog] || "Conjurador",
    slots, pact, cantrips: cantrips ?? null, known: known ?? null, prepared: prepared ?? null,
  };
}
// Classes conjuradoras do personagem (primária + multiclasse), cada
// uma com seu próprio nível — usado tanto para a lista de magias
// quanto para os espaços combinados de multiclasse.
function spellcastingClasses() {
  const out = [];
  if (refs.class) out.push({ id: refs.class.id, classEntry: refs.class, subclassEntry: refs.subclass, cr: details.classRec, sr: details.subclassRec, level: Math.max(1, Number(character.level) || 1) });
  for (const m of details.multiclasses || []) {
    if (m.classEntry) out.push({ id: m.classEntry.id, classEntry: m.classEntry, subclassEntry: m.subclassEntry, cr: m.classRec, sr: m.subclassRec, level: Math.max(1, Number(m.level) || 1) });
  }
  return out;
}
// Espaços de magia combinados de multiclasse (PHB): soma o nível
// completo de conjuradores completos + metade (arredondado pra baixo)
// de meio-conjuradores + um terço de terço-conjuradores, e usa a
// tabela padrão de conjurador completo com esse total. Magia de Pacto
// (Bruxo) nunca entra nessa soma — ela é sempre um pool à parte.
function multiclassSpellcasting() {
  const classes = spellcastingClasses();
  const perClass = [];
  let casterLevel = 0;
  for (const c of classes) {
    const info = spellcastingInfoFor(c.cr, c.sr, c.level);
    if (!info) continue;
    perClass.push({ ...info, classLabel: titleOf(c.classEntry) });
    if (info.progression === "pact") continue;
    if (info.progression === "full") casterLevel += c.level;
    else if (info.progression === "1/2" || info.progression === "half") casterLevel += Math.floor(c.level / 2);
    else if (info.progression === "artificer") casterLevel += Math.ceil(c.level / 2);
    else if (info.progression === "1/3" || info.progression === "third") casterLevel += Math.floor(c.level / 3);
  }
  if (!perClass.length) return null;
  const multi = classes.length > 1;
  const nonPact = perClass.filter((p) => p.progression !== "pact");
  const slots = multi ? casterSlots("full", casterLevel) : (nonPact[0]?.slots || null);
  return { perClass, casterLevel, slots, multi };
}
function renderSpellResources(msi) {
  const box = $("spell-resources");
  if (!box) return;
  if (!msi) { box.innerHTML = ""; return; }
  const { perClass, slots, multi, casterLevel } = msi;
  const nonPact = perClass.filter((p) => p.progression !== "pact");
  const pactCasters = perClass.filter((p) => p.progression === "pact");
  const classCards = perClass.map((p) => {
    const pips = [];
    if (p.cantrips != null) pips.push(["Truques", p.cantrips]);
    if (p.prepared != null) pips.push(["Preparadas", p.prepared]);
    if (p.known != null) pips.push(["Conhecidas", p.known]);
    if (p.ability) { pips.push(["CD", spellDc(proficiency(totalLevel()), p.abilityMod)]); pips.push(["Ataque", fmt(spellAttack(proficiency(totalLevel()), p.abilityMod))]); }
    return `<div class="spell-res-class"><b>${esc(p.classLabel)}</b><span>${esc(p.label)}${p.ability ? ` · ${ABILITY_NAMES[p.ability]}` : ""}</span>${pips.length ? `<div class="spell-res-pips">${pips.map(([k, v]) => `<div><span>${esc(k)}</span><b>${v}</b></div>`).join("")}</div>` : ""}</div>`;
  }).join("");
  const slotBoxes = (slots || []).map((n, i) => n ? `<div class="slot-box"><span>${i + 1}º nível</span><b>${n}</b></div>` : "").join("");
  const pactBoxes = pactCasters.map((p) => p.pact ? `<div class="slot-box pact"><span>${esc(p.classLabel)} · Pacto ${p.pact.level}º</span><b>${p.pact.count}</b></div>` : "").join("");
  box.innerHTML = `<section class="paper-card spell-resources">
    <div class="spell-res-head"><h3>Recursos de conjuração</h3>${multi && nonPact.length ? `<span>Multiclasse · nível de conjurador combinado ${casterLevel}</span>` : ""}</div>
    ${classCards}
    ${slotBoxes || pactBoxes ? `<div class="slot-grid">${slotBoxes}${pactBoxes}</div>` : `<p class="muted">Sem espaços de magia neste nível.</p>`}
  </section>`;
}

// ------------------------------------------------------------
// Magias
// ------------------------------------------------------------
function spellLevel(sp) { return Number(sp.level ?? 0); }
function spellTime(sp) {
  const t = sp.time?.[0];
  if (!t) return "";
  return `${t.number || 1} ${t.unit || ""}`.trim();
}
async function renderSpells() {
  const box = $("spellbook"), c = calc(), ab = c.sa;
  $("spell-ability").textContent = ab ? ABILITY_NAMES[ab] : "—";
  $("spell-dc-big").textContent = c.dc ?? "—";
  $("spell-atk-big").textContent = c.atk != null ? fmt(c.atk) : "—";
  renderSpellResources(multiclassSpellcasting());
  const casters = spellcastingClasses().filter((cc) => spellcastingInfoFor(cc.cr, cc.sr, cc.level));
  const tabsBox = $("spellbook-tabs");
  if (!casters.length) {
    $("spell-count").textContent = "0";
    if (tabsBox) tabsBox.innerHTML = "";
    box.innerHTML = `<div class="paper-card empty">Escolha uma classe conjuradora para carregar a lista de magias.</div>`;
    return;
  }
  if (!spellBookClassId || !casters.some((cc) => cc.id === spellBookClassId)) spellBookClassId = casters[0].id;
  if (tabsBox) {
    tabsBox.innerHTML = casters.length > 1 ? casters.map((cc) => `<button class="${cc.id === spellBookClassId ? "active" : ""}" data-spellbook-class="${esc(cc.id)}">${esc(titleOf(cc.classEntry))}</button>`).join("") : "";
    tabsBox.querySelectorAll("[data-spellbook-class]").forEach((b) => b.addEventListener("click", () => { spellBookClassId = b.dataset.spellbookClass; renderSpells(); }));
  }
  const active = casters.find((cc) => cc.id === spellBookClassId);
  box.innerHTML = `<div class="paper-card loading">Carregando lista de magias de ${esc(titleOf(active.classEntry))}…</div>`;
  let spells = [];
  // Usa a edição da própria classe escolhida (permite classe 2014 numa
  // sessão 2024 via o "incluir legado" do seletor).
  const spellEd = editionOf(active.classEntry) === "both" ? character.edition : editionOf(active.classEntry);
  try { spells = await spellsForClass(active.classEntry, active.subclassEntry, spellEd); }
  catch (err) { console.error(err); box.innerHTML = `<div class="paper-card empty">Não foi possível carregar as magias.</div>`; return; }
  $("spell-count").textContent = spells.length;
  // Com subclasse escolhida, deixa explícito se cada magia vem da lista da
  // classe, é concedida pela subclasse (domínio/círculo/patrono…) ou as duas.
  const hasSubclass = !!active.subclassEntry;
  const spellOrigin = (s) => {
    if (!hasSubclass) return "";
    if (s._fromClass && s._fromSubclass) return `Classe + ${titleOf(active.subclassEntry)}`;
    if (s._fromSubclass) return titleOf(active.subclassEntry);
    if (s._fromClass) return titleOf(active.classEntry);
    return "";
  };
  const groups = Array.from({ length: 10 }, (_, i) => spells.filter((s) => spellLevel(s) === i));
  box.innerHTML = groups.map((arr, lvl) => arr.length ? `<section class="paper-card spell-level"><div class="spell-level-head"><h3>${lvl === 0 ? "Truques" : `${lvl}º nível`}</h3><span>${arr.length} magias</span></div><div class="spell-list">${arr.map((s) => {
    const key = `${s.name}|${s.source || ""}`;
    const checked = character.preparedSpells.includes(key);
    const origin = spellOrigin(s);
    const originCls = s._fromSubclass && s._fromClass ? "from-both" : s._fromSubclass ? "from-subclass" : "from-class";
    const originTag = origin ? ` · <b class="spell-origin ${originCls}">${esc(origin)}</b>` : "";
    return `<label class="spell-line"><input type="checkbox" data-spell="${esc(key)}" ${checked ? "checked" : ""}><span class="spell-dot">${checked ? "●" : "○"}</span><strong>${esc(s.name)}</strong><span class="spell-meta">${esc(s.source || "")}${s.school ? ` · ${esc(s.school)}` : ""}${spellTime(s) ? ` · ${esc(spellTime(s))}` : ""}${originTag}</span><button type="button" class="spell-info" data-spell-key="${esc(key)}">ⓘ</button></label>`;
  }).join("")}</div></section>` : "").join("") || `<div class="paper-card empty">Nenhuma magia foi associada a esta classe nesta edição.</div>`;
  box.querySelectorAll("[data-spell]").forEach((i) => i.addEventListener("change", () => {
    toggleIn(character.preparedSpells, i.dataset.spell, i.checked);
    saveCharacter(character);
    i.nextElementSibling.textContent = i.checked ? "●" : "○";
  }));
  box.querySelectorAll("[data-spell-key]").forEach((b) => b.addEventListener("click", () => {
    const [name, source] = b.dataset.spellKey.split("|");
    const e = manifest().find((x) => normType(x.type) === "spell" && x.name === name && (x.source || "") === source);
    if (e) openEntityModal(e);
  }));
}

// ------------------------------------------------------------
// Equipamento
// ------------------------------------------------------------
function itemKind(r) {
  const s = JSON.stringify(r || {}).toLowerCase();
  if (/"armor"|shield/.test(s)) return /shield/.test(s) ? "shields" : "armor";
  if (/"weapon"|weaponcategory|"m"\b|"r"\b/.test(s) && /weapon/.test(s)) return "weapons";
  if (r?.weaponCategory || r?.weapon) return "weapons";
  if (r?.armor) return "armor";
  return "gear";
}
function weaponFamily(name) {
  const s = String(name).toLowerCase();
  if (/sword|espada/.test(s)) return "sword";
  if (/bow|arco/.test(s)) return "bow";
  if (/hammer|martelo|maul/.test(s)) return "hammer";
  if (/axe|machado/.test(s)) return "axe";
  if (/mace|maça|maca|flail|morningstar/.test(s)) return "mace";
  if (/dagger|adaga/.test(s)) return "dagger";
  return "";
}
async function renderInventory() {
  const arr = character.inventory || [];
  $("inventory-list").innerHTML = arr.length ? arr.map((x, i) => `<div class="inventory-row"><div><strong>${esc(x.name)}</strong><small>${esc(x.meta || "")}</small></div><input type="number" min="0" value="${Number(x.qty) || 1}" data-qty="${i}"><button class="remove-btn no-print" data-remove-inv="${i}">×</button></div>`).join("") : `<div class="empty">Seu inventário está vazio. Abra uma categoria acima para adicionar itens.</div>`;
  $("inventory-list").querySelectorAll("[data-qty]").forEach((i) => i.addEventListener("input", () => { character.inventory[Number(i.dataset.qty)].qty = Number(i.value) || 0; saveCharacter(character); }));
  $("inventory-list").querySelectorAll("[data-remove-inv]").forEach((b) => b.addEventListener("click", () => { character.inventory.splice(Number(b.dataset.removeInv), 1); renderInventory(); }));
}
async function renderEquipmentCatalog() {
  const box = $("equipment-list"), q = $("equipment-search").value.trim().toLowerCase(), wf = $("weapon-filter").value;
  box.innerHTML = `<div class="empty">Carregando catálogo de itens…</div>`;
  await ensureCatalog("item");
  // Catálogo de referência: mostra oficial + homebrew independentemente do
  // seletor "Conteúdo" (que controla o construtor de personagem).
  let arr = manifest()
    .filter((e) => normType(e.type) === "item" && matchesEdition(e, character.edition, true))
    .map((e) => ({ e, r: e.__rec || {}, kind: itemKind(e.__rec), family: weaponFamily(e.name) }));
  if (eqCat !== "all" && eqCat !== "inventory") arr = arr.filter((x) => x.kind === eqCat);
  if (wf) arr = arr.filter((x) => x.family === wf);
  if (q) arr = arr.filter((x) => `${titleOf(x.e)} ${x.e.source || ""}`.toLowerCase().includes(q));
  arr = arr.slice(0, 300);
  box.innerHTML = arr.length ? arr.map((x) => `<article class="catalog-card"><div class="pick-top"><strong>${esc(titleOf(x.e))}</strong>${sourceTag(x.e)}</div><div class="pick-meta">${esc(labelMeta(x.e))} · ${typeLabel(x.kind)}</div><p>${esc(plain(descriptionOf(x.r, x.e)).slice(0, 160) || "Sem descrição.")}</p><div class="catalog-actions"><button data-add-item="${esc(x.e.id)}">+ Inventário</button><button data-info-item="${esc(x.e.id)}">ⓘ</button></div></article>`).join("") : `<div class="empty">Nenhum item encontrado.</div>`;
  box.querySelectorAll("[data-add-item]").forEach((b) => b.addEventListener("click", () => addInventory(b.dataset.addItem)));
  box.querySelectorAll("[data-info-item]").forEach((b) => b.addEventListener("click", () => { const e = manifest().find((x) => x.id === b.dataset.infoItem); if (e) openEntityModal(e); }));
}
function addInventory(id) {
  const e = manifest().find((x) => x.id === id);
  if (!e) return;
  const f = character.inventory.find((x) => x.id === id);
  if (f) f.qty = (f.qty || 1) + 1;
  else character.inventory.push({ id, name: titleOf(e), qty: 1, meta: labelMeta(e) });
  saveCharacter(character); renderInventory(); toast(`${titleOf(e)} adicionado.`);
}
async function equipmentTab() {
  $("inventory-panel").classList.toggle("hidden", eqCat !== "inventory");
  $("equipment-catalog").classList.toggle("hidden", eqCat === "inventory");
  $("starting-equipment").classList.toggle("hidden", eqCat !== "inventory" || !startingEquipGroups().length);
  if (eqCat !== "inventory") await renderEquipmentCatalog();
  else { renderStartingEquipment(); await renderInventory(); }
}

// ------------------------------------------------------------
// Equipamento inicial (classe + background) -> inventário
// ------------------------------------------------------------
const EQTYPE_LABEL = {
  weaponMartial: "uma arma marcial", weaponSimple: "uma arma simples",
  weaponMartialMelee: "uma arma marcial corpo a corpo", weaponMartialRanged: "uma arma marcial à distância",
  weaponSimpleMelee: "uma arma simples corpo a corpo", weaponSimpleRanged: "uma arma simples à distância",
  armorLight: "uma armadura leve", armorMedium: "uma armadura média", armorHeavy: "uma armadura pesada",
  setGaming: "um conjunto de jogos", instrumentMusical: "um instrumento musical", toolArtisan: "ferramentas de artesão",
};
function parseEquipEntry(x) {
  if (typeof x === "string") { const [n, s] = x.split("|"); return { kind: "item", name: n.trim(), ref: n.trim(), src: (s || "").trim().toLowerCase(), qty: 1 }; }
  if (!x || typeof x !== "object") return null;
  if (typeof x.value === "number") return { kind: "gold", cp: x.value };
  if (x.equipmentType) return { kind: "placeholder", name: EQTYPE_LABEL[x.equipmentType] || String(x.equipmentType), qty: x.quantity || 1 };
  if (x.item) {
    const [n, s] = String(x.item).split("|");
    const e = { kind: "item", name: (x.displayName || n).trim(), ref: n.trim(), src: (s || "").trim().toLowerCase(), qty: x.quantity || 1 };
    if (typeof x.containsValue === "number") e.cp = x.containsValue;
    return e;
  }
  if (x.special) return { kind: "special", name: String(x.special), qty: x.quantity || 1 };
  return null;
}
const normEquipList = (arr) => (Array.isArray(arr) ? arr : []).map(parseEquipEntry).filter(Boolean);
function equipGroupsFrom(se) {
  const groups = [];
  const handle = (g) => {
    if (Array.isArray(g)) { if (g.length) groups.push({ options: [], fixed: normEquipList(g) }); return; }
    if (!g || typeof g !== "object") return;
    const opts = Object.keys(g).filter((k) => /^[a-cA-C]$/.test(k)).map((L) => ({ letter: L.toUpperCase(), entries: normEquipList(g[L]) }));
    const fixed = normEquipList(g._ || []);
    if (opts.length || fixed.length) groups.push({ options: opts, fixed });
  };
  if (Array.isArray(se)) se.forEach(handle);
  else if (se && Array.isArray(se.defaultData)) se.defaultData.forEach(handle);
  return groups;
}
function startingEquipGroups() {
  const out = [];
  if (details.classRec?.startingEquipment) equipGroupsFrom(details.classRec.startingEquipment).forEach((g, i) => out.push({ ...g, src: "class", label: titleOf(refs.class), idx: i }));
  if (details.backgroundRec?.startingEquipment) equipGroupsFrom(details.backgroundRec.startingEquipment).forEach((g, i) => out.push({ ...g, src: "background", label: titleOf(refs.background), idx: i }));
  return out;
}
function equipEntryLabel(e) {
  if (e.kind === "gold") return `${(e.cp / 100).toLocaleString("pt-BR")} po`;
  const q = e.qty && e.qty > 1 ? `${e.qty}× ` : "";
  return q + e.name + (e.cp ? ` (+${(e.cp / 100).toLocaleString("pt-BR")} po)` : "");
}
function renderStartingEquipment() {
  const panel = $("starting-equipment"), body = $("starting-equipment-body");
  if (!panel || !body) return;
  const groups = startingEquipGroups();
  if (!groups.length) { panel.classList.add("hidden"); return; }
  const store = character.choiceSelections.startingEquip || {};
  body.innerHTML = groups.map((g) => {
    const key = `${g.src}:${g.idx}`;
    const chosen = store[key] || (g.options[0] && g.options[0].letter);
    const fixedHtml = g.fixed.length ? `<div class="eq-fixed">${g.fixed.map((e) => `<span>${esc(equipEntryLabel(e))}</span>`).join("")}</div>` : "";
    const optsHtml = g.options.length ? `<div class="eq-options">${g.options.map((o) => `<label class="eq-option${o.letter === chosen ? " on" : ""}"><input type="radio" name="eq-${esc(key)}" data-eq-choice="${esc(key)}" value="${esc(o.letter)}" ${o.letter === chosen ? "checked" : ""}><b>${esc(o.letter)}</b><span>${o.entries.map((e) => esc(equipEntryLabel(e))).join(", ") || "—"}</span></label>`).join("")}</div>` : "";
    return `<div class="eq-group"><div class="eq-group-head">${esc(g.label)}${g.options.length ? " — escolha uma opção" : ""}</div>${fixedHtml}${optsHtml}</div>`;
  }).join("") + `<div class="eq-actions"><button type="button" id="apply-starting-equip" class="add-btn">Adicionar ao inventário</button>${character.equipApplied ? '<span class="muted">Já adicionado uma vez.</span>' : ""}</div>`;
  body.querySelectorAll("[data-eq-choice]").forEach((r) => r.addEventListener("change", () => {
    character.choiceSelections.startingEquip = character.choiceSelections.startingEquip || {};
    character.choiceSelections.startingEquip[r.dataset.eqChoice] = r.value;
    saveCharacter(character); renderStartingEquipment();
  }));
  $("apply-starting-equip")?.addEventListener("click", applyStartingEquipment);
}
function applyStartingEquipment() {
  const groups = startingEquipGroups();
  const store = character.choiceSelections.startingEquip || {};
  let cp = 0, added = 0;
  const push = (e) => {
    if (e.kind === "gold") { cp += e.cp; return; }
    if (e.cp) cp += e.cp;
    if (e.kind === "item") {
      const key = (e.ref || e.name).toLowerCase();
      const hit = manifest().find((x) => normType(x.type) === "item" && x.name.toLowerCase() === key && (!e.src || String(x.source || "").toLowerCase() === e.src))
        || manifest().find((x) => normType(x.type) === "item" && x.name.toLowerCase() === key);
      if (hit) {
        const f = character.inventory.find((x) => x.id === hit.id);
        if (f) f.qty = (f.qty || 1) + (e.qty || 1);
        else character.inventory.push({ id: hit.id, name: titleOf(hit), qty: e.qty || 1, meta: labelMeta(hit) });
        added++; return;
      }
    }
    character.inventory.push({ name: e.name, qty: e.qty || 1, meta: e.kind === "placeholder" ? "à escolha" : "" });
    added++;
  };
  groups.forEach((g) => {
    g.fixed.forEach(push);
    if (g.options.length) {
      const letter = store[`${g.src}:${g.idx}`] || g.options[0].letter;
      (g.options.find((o) => o.letter === letter) || g.options[0]).entries.forEach(push);
    }
  });
  if (cp > 0) character.inventory.push({ name: `Moedas iniciais: ${(cp / 100).toLocaleString("pt-BR")} po`, qty: 1, meta: "" });
  character.equipApplied = true;
  saveCharacter(character);
  renderInventory(); renderStartingEquipment();
  toast(`${added} item(ns)${cp ? ` + ${(cp / 100).toLocaleString("pt-BR")} po` : ""} no inventário.`);
}

function renderDeath() {
  const d = character.deathSaves || { success: 0, failure: 0 };
  document.querySelectorAll("[data-death]").forEach((b) => {
    const k = b.dataset.death[0] === "s" ? "success" : "failure", i = Number(b.dataset.death[1]);
    b.textContent = i < d[k] ? "●" : "○";
    b.classList.toggle("on", i < d[k]);
    b.onclick = () => { d[k] = i < d[k] ? i : i + 1; if (d[k] > 3) d[k] = 0; character.deathSaves = d; saveCharacter(character); renderDeath(); };
  });
}

// ------------------------------------------------------------
// Codex — Raças & Classes (lore oficial + homebrew lado a lado)
// ------------------------------------------------------------
function codexTeaser(e, r) {
  const lore = loreOf(e);
  if (lore) return { text: stripLeadingName(plain(unwrapSelfSection(lore, e.name)), e.name).slice(0, 190), lore: true };
  let fallback = plain(descriptionOf(r, e)).slice(0, 190);
  if (!fallback) {
    // Sem prosa de lore: monta um resumo a partir dos fatos rápidos.
    const t = normType(e.type);
    const facts = t === "class" ? classQuickFacts(r) : t === "race" ? raceQuickFacts(r) : [];
    fallback = facts.map(([k, v]) => `${k}: ${v}`).join(" · ");
  }
  return { text: fallback, lore: false };
}
function codexCardHtml(e, r) {
  const t = normType(e.type);
  const teaser = codexTeaser(e, r);
  const sub = e.subraceOf ? `<div class="codex-subof">↳ Subespécie de ${esc(e.subraceOf.name)}</div>` : "";
  return `<article class="codex-card ${hb(e) ? "brew" : "official"}" data-codex-id="${esc(e.id)}">
    <div class="codex-card-top"><span class="codex-kind ${t}">${t === "race" ? "Raça" : "Classe"}</span>${sourceTag(e)}</div>
    <h3>${esc(titleOf(e))}</h3>
    ${sub}
    <p class="codex-teaser">${esc(teaser.text) || "Sem descrição disponível neste registro."}${teaser.text.length >= 190 ? "…" : ""}</p>
    ${!teaser.lore ? `<span class="codex-nolore">Sem lore estruturada · mostrando traços</span>` : ""}
    <button type="button" class="codex-open">Ler descrição completa →</button>
  </article>`;
}
async function renderCodex() {
  const grid = $("codex-grid"), status = $("codex-status");
  grid.innerHTML = `<div class="empty">Carregando raças e classes…</div>`;
  await Promise.all([ensureCatalog("race"), ensureCatalog("class")]);
  const q = codexState.query.trim().toLowerCase();
  const ed = character.edition;
  let arr = manifest().filter((e) => {
    const t = normType(e.type);
    if (t !== "race" && t !== "class") return false;
    if (codexState.type !== "all" && t !== codexState.type) return false;
    if (codexState.content === "official" && hb(e)) return false;
    if (codexState.content === "homebrew" && !hb(e)) return false;
    // Respeita a edição escolhida (2014/2024) e o "filtro de reprint"
    // do 5etools: sem isso, Mago PHB e Mago XPHB apareciam juntos.
    if (!matchesEdition(e, ed, codexState.legacy)) return false;
    if (q && !`${titleOf(e)} ${e.source || ""}`.toLowerCase().includes(q)) return false;
    return true;
  }).sort((a, b) =>
    Number(normType(a.type) !== "race") - Number(normType(b.type) !== "race") ||
    Number(hb(a)) - Number(hb(b)) ||
    String(a.name).localeCompare(String(b.name), "pt-BR"));
  const races = arr.filter((e) => normType(e.type) === "race").length;
  const classes = arr.length - races;
  const legacyCount = arr.filter((e) => !hb(e) && editionOf(e) === "2014" && ed === "2024").length;
  status.textContent = `${arr.length.toLocaleString("pt-BR")} resultados · ${races.toLocaleString("pt-BR")} raças/espécies · ${classes.toLocaleString("pt-BR")} classes · edição ${ed}` +
    (legacyCount ? ` (${legacyCount} de 2014 sem versão nova)` : "");
  arr = arr.slice(0, 240);
  if (!arr.length) { grid.innerHTML = `<div class="empty">Nenhuma raça ou classe encontrada com esses filtros.</div>`; return; }
  // Dados já estão carregados em memória (ensureCatalog acima) — sem
  // chamadas de rede aqui, então dá pra montar tudo síncrono.
  grid.innerHTML = arr.map((e) => codexCardHtml(e, recordsForEntity(e)[0])).join("");
  grid.querySelectorAll("[data-codex-id]").forEach((card) => {
    const open = () => { const e = manifest().find((x) => x.id === card.dataset.codexId); if (e) openCodexModal(e); };
    card.querySelector(".codex-open")?.addEventListener("click", open);
    card.addEventListener("click", (ev) => { if (ev.target.closest(".codex-open")) return; open(); });
  });
}

// ------------------------------------------------------------
// Compêndio
// ------------------------------------------------------------
async function renderCompendium() {
  const q = $("compendium-search").value.trim().toLowerCase(), t = $("compendium-type").value;
  if (t === "spell" || t === "item") { $("compendium-results").innerHTML = `<div class="empty">Carregando ${typeLabel(t).toLowerCase()}s…</div>`; await ensureCatalog(t); }
  let arr = manifest().filter((e) =>
    (t === "all" || normType(e.type) === t) &&
    matchesEdition(e, character.edition, true) &&
    (!q || `${titleOf(e)} ${e.source || ""}`.toLowerCase().includes(q))
  ).slice(0, 240);
  $("compendium-results").innerHTML = arr.map((e) => `<article class="catalog-card"><div class="pick-top"><strong>${esc(titleOf(e))}</strong>${sourceTag(e)}</div><div class="pick-meta">${esc(typeLabel(e.type))} · ${esc(labelMeta(e))}</div><div class="catalog-actions"><button data-comp-info="${esc(e.id)}">ⓘ Ver detalhes</button></div></article>`).join("") || `<div class="empty">Nenhum resultado.</div>`;
  $("compendium-results").querySelectorAll("[data-comp-info]").forEach((b) => b.addEventListener("click", () => { const e = manifest().find((x) => x.id === b.dataset.compInfo); if (e) openEntityModal(e); }));
}

// ------------------------------------------------------------
// Ciclo de vida
// ------------------------------------------------------------
function applyLoaded(c) {
  const f = fresh();
  character = {
    ...f, ...c,
    scores: { ...f.scores, ...(c?.scores || {}) },
    deathSaves: { ...f.deathSaves, ...(c?.deathSaves || {}) },
    inventory: Array.isArray(c?.inventory) ? c.inventory : [],
    preparedSpells: Array.isArray(c?.preparedSpells) ? c.preparedSpells : [],
    attacks: Array.isArray(c?.attacks) ? c.attacks : [],
    multiclasses: Array.isArray(c?.multiclasses)
      ? c.multiclasses.map((m) => ({ classId: m?.classId || "", subclassId: m?.subclassId || "", level: Math.max(1, Math.min(19, Number(m?.level) || 1)) }))
      : [],
    auto: { ...f.auto, ...(c?.auto || {}) },
    coins: { ...f.coins, ...(c?.coins || {}) },
    choiceSelections: { ...f.choiceSelections, ...(c?.choiceSelections || {}), abilityChoices: { ...f.choiceSelections.abilityChoices, ...(c?.choiceSelections?.abilityChoices || {}) } },
    manualSkillProficiencies: Array.isArray(c?.manualSkillProficiencies) ? c.manualSkillProficiencies : [],
  };
  $("edition").value = character.edition;
  $("content").value = character.content;
  $("name").value = character.name;
  $("level").value = character.level;
  $("xp").value = character.xp;
  $("alignment").value = character.alignment || "";
  $("languages").value = character.languages || "";
  $("appearance").value = character.appearance || "";
  $("backstory").value = character.backstory || "";
  $("inspiration").checked = !!character.inspiration;
  for (const k of ["cp", "pp", "pe", "po", "pl"]) $(`coin-${k}`).value = character.coins[k] || 0;
  refreshChoices();
}
// ------------------------------------------------------------
// Ficha oficial em PDF — recriação do layout de duas páginas da ficha
// oficial da WotC (2024) a partir do personagem atual, pra imprimir/gerar
// PDF em vez de imprimir cru a interface de trabalho.
// ------------------------------------------------------------
function offCheck(on) { return `<i class="off-check${on ? " on" : ""}"></i>`; }
function offPips(n, total) { return Array.from({ length: total }, (_, i) => `<i class="off-pip${i < n ? " on" : ""}"></i>`).join(""); }
function hitDiceLabel() {
  const parts = [`${Math.max(1, Number(character.level) || 1)}d${Number(character.auto?.hitDice || hitDiceFrom(classInfo()) || 8) || 8}`];
  for (const m of details.multiclasses || []) {
    if (!m.classEntry) continue;
    parts.push(`${Math.max(1, Number(m.level) || 1)}d${Number(hitDiceFrom(m.classRec) || 8) || 8}`);
  }
  return parts.join(" + ");
}
const OFF_SIZE = { T: "Minúsculo", S: "Pequeno", M: "Médio", L: "Grande", H: "Enorme", G: "Imenso" };
function offSizeLabel() {
  const rec = details.raceRec || {};
  const s = Array.isArray(rec.size) ? rec.size[0] : rec.size;
  return OFF_SIZE[s] || s || "—";
}
function offDistance(d) {
  if (!d) return "";
  if (d.type === "self") return "Pessoal";
  if (d.type === "touch") return "Toque";
  if (d.type === "feet") return `${d.amount} pés`;
  if (d.type === "miles") return `${d.amount} milhas`;
  return d.amount != null ? `${d.amount} ${d.type}` : "";
}
const OFF_SHAPE = { radius: "raio", sphere: "esfera", cube: "cubo", cone: "cone", line: "linha", hemisphere: "hemisfério" };
function offSpellRange(sp) {
  const r = sp?.range;
  if (!r) return "—";
  if (r.type === "point") return offDistance(r.distance) || "—";
  if (OFF_SHAPE[r.type]) return `${offDistance(r.distance)} (${OFF_SHAPE[r.type]})`;
  if (r.type === "special") return "Especial";
  return "—";
}
function offSpellFlags(sp) {
  return { c: (sp?.duration || []).some((d) => d?.concentration), r: !!sp?.meta?.ritual, m: !!sp?.components?.m };
}
// Uma "caixa" com título — a unidade visual repetida pela ficha oficial
// (retângulo com cantos arredondados e um rótulo em maiúsculas no topo).
function offBox(title, bodyHtml, cls = "") {
  return `<div class="off-box ${cls}"><div class="off-box-title">${esc(title)}</div><div class="off-box-body">${bodyHtml}</div></div>`;
}
function offAbilityBox(a) {
  const eff = effScore(a), m = mod(eff), pb = proficiency(totalLevel());
  const saveOn = character.saveProficiencies.includes(a);
  const skills = SKILLS.filter(([, , ab]) => ab === a);
  const rows = [{ label: "Salvaguarda", on: saveOn, v: m + (saveOn ? pb : 0), strong: true }]
    .concat(skills.map(([k, label]) => {
      const p = character.skillProficiencies.includes(k), ex = character.skillExpertise.includes(k);
      return { label, on: p || ex, v: m + pb * (ex ? 2 : p ? 1 : 0) };
    }));
  return `<div class="off-ability">
    <div class="off-ability-name">${esc(ABILITY_NAMES[a])}</div>
    <div class="off-ability-top">
      <div class="off-ability-score"><b>${eff}</b><span>VALOR</span></div>
      <div class="off-ability-mod"><b>${fmt(m)}</b><span>MOD.</span></div>
    </div>
    <div class="off-skill-list">${rows.map((r) => `<div class="off-skill-row${r.strong ? " strong" : ""}">${offCheck(r.on)}<span>${esc(r.label)}</span><b>${fmt(r.v)}</b></div>`).join("")}</div>
  </div>`;
}
function offFeatureLines(feats) {
  if (!feats || !feats.length) return `<p class="off-muted">—</p>`;
  return feats.map((f) => {
    const txt = plain(f.entries).trim();
    const short = txt.length > 240 ? txt.slice(0, 240).replace(/\s+\S*$/, "") + "…" : txt;
    return `<p><b>${esc(f.name || "Característica")}.</b> ${esc(short) || ""}</p>`;
  }).join("");
}
async function buildOfficialSheet() {
  const c = calc(), pb = c.pb;
  const classFeats = refs.class ? await findClassFeatures(refs.class, Number(character.level)).catch(() => []) : [];
  const subFeats = refs.subclass ? await findSubclassFeatures(refs.subclass, Number(character.level)).catch(() => []) : [];
  const mcClassFeats = (await Promise.all((details.multiclasses || []).map((m) => m.classEntry ? findClassFeatures(m.classEntry, Number(m.level)).catch(() => []) : Promise.resolve([])))).flat();
  const mcSubFeats = (await Promise.all((details.multiclasses || []).map((m) => m.subclassEntry ? findSubclassFeatures(m.subclassEntry, Number(m.level)).catch(() => []) : Promise.resolve([])))).flat();
  const raceRecFull = refs.race ? await firstRecord(refs.race) : null;
  const raceTraits = Array.isArray(raceRecFull?.entries) ? raceRecFull.entries.filter((x) => x && x.name).map((x) => ({ name: x.name, entries: x.entries || x })) : [];
  const feats = chosenFeatEntities().map((e) => ({ name: e.name, entries: featRec(e).entries }));
  const { weapons, tools, armorRaw } = computeProficiencySummary();
  const armorOn = (kind) => armorRaw.some((a) => a.includes(kind));

  const attacks = (character.attacks || []).slice();
  while (attacks.length < 6) attacks.push({ name: "", bonus: "", damage: "", notes: "" });

  const page1 = `<div class="off-page off-page1">
    <div class="off-header">
      <div class="off-box off-name">
        <div class="off-field"><b>${esc(character.name || "—")}</b><span>Nome do personagem</span></div>
        <div class="off-field-row">
          <div class="off-field"><b>${refs.background ? esc(titleOf(refs.background)) : "—"}</b><span>Origem</span></div>
          <div class="off-field"><b>${refs.race ? esc(titleOf(refs.race)) : "—"}</b><span>Espécie</span></div>
        </div>
        <div class="off-field-row">
          <div class="off-field"><b>${refs.class ? esc(titleOf(refs.class)) : "—"}</b><span>Classe</span></div>
          <div class="off-field"><b>${refs.subclass ? esc(titleOf(refs.subclass)) : "—"}</b><span>Subclasse</span></div>
        </div>
      </div>
      <div class="off-oval off-oval-level"><b>${character.level}</b><span>Nível</span><small>${character.xp || 0} PX</small></div>
      <div class="off-shield"><span>Classe de Armadura</span><b>${c.ac}</b></div>
      <div class="off-box off-hp">
        <div class="off-box-title">Pontos de Vida</div>
        <div class="off-hp-grid">
          <div><b>${character.hpCurrent == null ? c.hp : character.hpCurrent}</b><span>Atual</span></div>
          <div><b>${character.hpTemp || 0}</b><span>Temp.</span></div>
          <div><b>${c.hp}</b><span>Máx.</span></div>
        </div>
      </div>
      <div class="off-box off-hd"><div class="off-box-title">Dado de Vida</div><div class="off-box-body off-center"><b>${esc(hitDiceLabel())}</b></div></div>
      <div class="off-box off-death"><div class="off-box-title">Teste de Res. de Morte</div><div class="off-box-body">
        <div class="off-death-row"><span>Sucessos</span>${offPips(character.deathSaves?.success || 0, 3)}</div>
        <div class="off-death-row"><span>Falhas</span>${offPips(character.deathSaves?.failure || 0, 3)}</div>
      </div></div>
    </div>

    <div class="off-row2">
      <div class="off-col off-col-a">
        <div class="off-circle off-pb"><b>${fmt(pb)}</b><span>Bônus de<br>Proficiência</span></div>
        ${offAbilityBox("str")}${offAbilityBox("dex")}${offAbilityBox("con")}
        <div class="off-circle off-insp${character.inspiration ? " on" : ""}"><b>${character.inspiration ? "★" : "☆"}</b><span>Inspiração<br>Heróica</span></div>
      </div>
      <div class="off-col off-col-b">
        ${offAbilityBox("int")}${offAbilityBox("wis")}${offAbilityBox("cha")}
      </div>
      <div class="off-col off-col-c">
        <div class="off-ovals-row">
          <div class="off-oval"><span>Iniciativa</span><b>${fmt(c.init)}</b></div>
          <div class="off-oval"><span>Velocidade</span><b>${esc(c.speed)}</b></div>
          <div class="off-oval"><span>Tamanho</span><b>${esc(offSizeLabel())}</b></div>
          <div class="off-oval"><span>Perc. Passiva</span><b>${c.passive}</b></div>
        </div>
        ${offBox("Armas & Truques de Dano", `<table class="off-table"><thead><tr><th>Nome</th><th>Bônus/CD</th><th>Dano &amp; Tipo</th><th>Anotações</th></tr></thead><tbody>${attacks.map((a) => `<tr><td>${esc(a.name || "")}</td><td>${esc(a.bonus || "")}</td><td>${esc(a.damage || "")}</td><td>${esc(a.notes || "")}</td></tr>`).join("")}</tbody></table>`)}
        ${offBox("Características de Classe", offFeatureLines([...classFeats, ...subFeats, ...mcClassFeats, ...mcSubFeats]), "off-tall")}
      </div>
    </div>

    <div class="off-row3">
      ${offBox("Características Raciais", offFeatureLines(raceTraits))}
      ${offBox("Talentos", offFeatureLines(feats))}
    </div>

    <div class="off-row4">
      ${offBox("Equipamento, Treino & Proficiências", `
        <div class="off-training"><b>Treino de armadura</b> <span class="off-inline-check">${offCheck(armorOn("light"))} Leve</span> <span class="off-inline-check">${offCheck(armorOn("medium"))} Média</span> <span class="off-inline-check">${offCheck(armorOn("heavy"))} Pesada</span> <span class="off-inline-check">${offCheck(armorOn("shield"))} Escudos</span></div>
        <div class="off-training"><b>Armas</b> ${esc(weapons.join(", ") || "—")}</div>
        <div class="off-training"><b>Ferramentas</b> ${esc(tools.join(", ") || "—")}</div>
      `)}
    </div>
  </div>`;

  // --- Página 2: conjuração + notas de personagem ---
  const casters = spellcastingClasses().filter((cc) => spellcastingInfoFor(cc.cr, cc.sr, cc.level));
  const primaryCaster = casters.find((cc) => cc.id === spellBookClassId) || casters[0] || null;
  const msi = multiclassSpellcasting();
  const slots = msi?.slots || [];
  let preparedRows = [];
  if (primaryCaster) {
    const spellEd = editionOf(primaryCaster.classEntry) === "both" ? character.edition : editionOf(primaryCaster.classEntry);
    try {
      const all = await spellsForClass(primaryCaster.classEntry, primaryCaster.subclassEntry, spellEd);
      preparedRows = all.filter((s) => character.preparedSpells.includes(`${s.name}|${s.source || ""}`))
        .sort((x, y) => (x.level ?? 0) - (y.level ?? 0) || String(x.name).localeCompare(String(y.name), "pt-BR"));
    } catch (err) { console.error(err); }
  }
  const inv = character.inventory || [];

  const page2 = `<div class="off-page off-page2">
    <div class="off-spell-top">
      <div class="off-box off-spell-ability"><div class="off-box-title">Atributo de Conjuração</div><div class="off-box-body off-center"><b>${c.sa ? esc(ABILITY_NAMES[c.sa]) : "—"}</b></div></div>
      <div class="off-oval"><span>Modificador<br>de Conjuração</span><b>${c.sa ? fmt(mod(effScore(c.sa))) : "—"}</b></div>
      <div class="off-oval"><span>CD de Resistência<br>de Magia</span><b>${c.dc ?? "—"}</b></div>
      <div class="off-oval"><span>Bônus de Ataque<br>de Magia</span><b>${c.atk != null ? fmt(c.atk) : "—"}</b></div>
    </div>
    ${offBox("Espaços de Magia", `<div class="off-slots">${Array.from({ length: 9 }, (_, i) => `<div class="off-slot"><span>Nível ${i + 1}</span><b>${slots[i] || 0}</b></div>`).join("")}</div>`)}
    ${offBox("Truques & Magias Preparadas", `<table class="off-table off-spell-table"><thead><tr><th>Nv.</th><th>Nome</th><th>Tempo</th><th>Alcance</th><th>C/R/M</th><th>Anotações</th></tr></thead><tbody>${
      preparedRows.length ? preparedRows.map((s) => { const fl = offSpellFlags(s); return `<tr><td>${spellLevel(s) === 0 ? "T" : spellLevel(s)}</td><td>${esc(s.name)}</td><td>${esc(spellTime(s))}</td><td>${esc(offSpellRange(s))}</td><td>${fl.c ? "C " : ""}${fl.r ? "R " : ""}${fl.m ? "M" : ""}</td><td></td></tr>`; }).join("")
      : `<tr><td colspan="6" class="off-muted">Nenhuma magia marcada como preparada na aba "Magias".</td></tr>`
    }</tbody></table>`, "off-tall")}

    <div class="off-page2-side">
      ${offBox("Aparência", `<p>${esc(character.appearance || "")}</p>`, "off-tall")}
      ${offBox("História & Personalidade", `<p>${esc(character.backstory || "")}</p><div class="off-align"><b>Alinhamento</b> ${esc(character.alignment || "—")}</div>`, "off-tall")}
      ${offBox("Idiomas", `<p>${esc(character.languages || "—")}</p>`)}
      ${offBox("Equipamento", inv.length ? `<ul class="off-list">${inv.map((i) => `<li>${esc(i.name)}${i.qty > 1 ? ` ×${i.qty}` : ""}</li>`).join("")}</ul>` : `<p class="off-muted">Inventário vazio.</p>`, "off-tall")}
      ${offBox("Moedas", `<div class="off-coins">${["cp", "pp", "pe", "po", "pl"].map((k) => `<div><span>${k.toUpperCase()}</span><b>${character.coins?.[k] || 0}</b></div>`).join("")}</div>`)}
    </div>
  </div>`;

  $("official-sheet").innerHTML = page1 + page2;
}
async function openPdfPreview() {
  const modal = $("modal"), box = $("modal-content");
  box.innerHTML = `<div class="modal-title"><div><span class="eyebrow">PRÉ-VISUALIZAÇÃO</span><h2>Ficha pronta para PDF</h2><p class="muted">Layout da ficha oficial da WotC (2024). Use “Imprimir / PDF” para gerar o arquivo.</p></div><button type="button" class="preview-print" id="preview-print">Imprimir / PDF</button></div><div class="pdf-preview-host"><div class="loading">Montando ficha…</div></div>`;
  modal.classList.remove("hidden");
  await buildOfficialSheet();
  box.querySelector(".pdf-preview-host").innerHTML = $("official-sheet").innerHTML;
  $("preview-print").onclick = () => window.print();
}
// ------------------------------------------------------------
// Assistente guiado — alterna entre "modo livre" (choice-grid completo,
// comportamento original) e o passo a passo do `.wizard`.
// ------------------------------------------------------------
function setCreationMode(mode) {
  creationMode = mode === "guided" ? "guided" : "free";
  saveCreationMode(creationMode);
  document.querySelectorAll("#creation-mode-toggle [data-mode]").forEach((b) => b.classList.toggle("active", b.dataset.mode === creationMode));
  $("wizard")?.classList.toggle("hidden", creationMode !== "guided");
  $("free-mode-content")?.classList.toggle("hidden", creationMode === "guided");
  if (creationMode === "guided") { $("creator")?.classList.remove("collapsed"); renderWizardStep(); }
}
function renderWizardSteps() {
  const box = $("wizard-steps");
  if (!box) return;
  box.innerHTML = WIZARD_STEPS.map((s, i) => `<button type="button" class="wizard-step-chip${i === wizardIndex ? " active" : ""}${i < wizardIndex ? " done" : ""}" data-step-index="${i}">${i + 1}. ${esc(s.title)}</button>`).join("");
  box.querySelectorAll("[data-step-index]").forEach((b) => b.addEventListener("click", () => { wizardIndex = Number(b.dataset.stepIndex); renderWizardStep(); }));
}
async function renderWizardPickStep(step) {
  const body = $("wizard-body");
  if (!body) return;
  const current = refs[step.type];
  body.innerHTML = `<p class="wizard-hint">${esc(step.hint)}</p>
    <div class="wizard-current${current ? " picked" : ""}">${current ? `Selecionado: <strong>${esc(titleOf(current))}</strong> ${sourceTag(current)}` : "Nada selecionado ainda."}</div>
    <div class="picker-controls"><input id="wizard-search" placeholder="Pesquisar ${esc(typeLabel(step.type).toLowerCase())}…"></div>
    <div id="wizard-results" class="picker-grid"><div class="loading">Carregando catálogo…</div></div>`;
  try { await ensureCatalog(step.type); } catch (err) { console.error(err); }
  const render = () => {
    const q = $("wizard-search")?.value.trim() || "";
    paintPickResults($("wizard-results"), filteredPicker(step.type, q).slice(0, 120), async (e) => {
      pickerType = step.type;
      await selectRef(e);
      await renderWizardStep();
    });
  };
  $("wizard-search")?.addEventListener("input", render);
  render();
}
function renderWizardAbilitiesStep(step) {
  const body = $("wizard-body");
  if (!body) return;
  body.innerHTML = `<p class="wizard-hint">${esc(step.hint)}</p>
    <div id="wiz-ability-grid" class="ability-grid"></div>
    <div class="pointbuy-bar" id="wiz-pointbuy-bar">
      <label class="ability-mode-label">Modo<select id="wiz-ability-mode"><option value="pointbuy">Point buy (27)</option><option value="free">Valores livres</option></select></label>
      <strong id="wiz-pointbuy-remaining-wrap">Pontos restantes: <b id="wiz-pointbuy-remaining">27</b></strong>
      <button type="button" class="no-print" id="wiz-reset-pointbuy">Resetar 10/10/10/10/10/10</button>
    </div>
    <div id="wiz-ability-editor" class="ability-editor"></div>
    <p class="muted" id="wiz-ability-editor-hint"></p>`;
  paintAbilityEditor("wiz-");
}
function renderWizardReviewStep(step) {
  const body = $("wizard-body");
  if (!body) return;
  const rows = [["Espécie", refs.race], ["Classe", refs.class], ["Background", refs.background]];
  body.innerHTML = `<p class="wizard-hint">${esc(step.hint)}</p>
    <div class="wizard-review-grid">${rows.map(([label, e]) => `<div class="identity-row"><span>${esc(label)}</span><strong>${e ? esc(titleOf(e)) : "—"}</strong>${e ? sourceTag(e) : ""}</div>`).join("")}</div>
    <div class="two-input" style="margin-top:14px">
      <label>Nome do personagem<input id="wizard-name" value="${esc(character.name || "")}" placeholder="Nome do personagem"></label>
      <label>Nível<input id="wizard-level" type="number" min="1" max="20" value="${Number(character.level) || 1}"></label>
    </div>`;
  $("wizard-name").addEventListener("input", () => { character.name = $("wizard-name").value; $("name").value = character.name; saveCharacter(character); });
  $("wizard-level").addEventListener("input", () => {
    character.level = Math.max(1, Math.min(20, Number($("wizard-level").value) || 1));
    $("level").value = character.level; saveCharacter(character); recalc();
  });
}
async function renderWizardStep() {
  renderWizardSteps();
  const step = WIZARD_STEPS[wizardIndex];
  if ($("wizard-progress")) $("wizard-progress").textContent = `Passo ${wizardIndex + 1} de ${WIZARD_STEPS.length}`;
  if ($("wizard-back")) $("wizard-back").disabled = wizardIndex === 0;
  if ($("wizard-next")) $("wizard-next").textContent = wizardIndex === WIZARD_STEPS.length - 1 ? "Concluir →" : "Próximo →";
  if (step.type) await renderWizardPickStep(step);
  else if (step.key === "abilities") renderWizardAbilitiesStep(step);
  else if (step.key === "review") renderWizardReviewStep(step);
}
function finishWizard() {
  setCreationMode("free");
  $("creator")?.classList.add("collapsed");
  if ($("collapse-creator")) $("collapse-creator").textContent = "Expandir";
  toast("Personagem pronto! Ajuste os detalhes na ficha abaixo.");
  document.querySelector('.tab[data-tab="sheet"]')?.click();
  $("tabs")?.scrollIntoView({ behavior: "smooth", block: "start" });
}
function wizardNext() {
  const step = WIZARD_STEPS[wizardIndex];
  if (step.type === "race" && !refs.race) { toast("Escolha uma espécie antes de continuar."); return; }
  if (step.type === "class" && !refs.class) { toast("Escolha uma classe antes de continuar."); return; }
  if (wizardIndex < WIZARD_STEPS.length - 1) { wizardIndex++; renderWizardStep(); }
  else finishWizard();
}
function wizardBack() { if (wizardIndex > 0) { wizardIndex--; renderWizardStep(); } }

function setup() {
  $("edition").addEventListener("change", () => {
    character.edition = $("edition").value;
    character.classId = character.subclassId = character.raceId = character.backgroundId = "";
    character.multiclasses = [];
    refs = { class: null, subclass: null, race: null, background: null, multiclasses: [] };
    refreshChoices(); saveCharacter(character);
    const active = document.querySelector(".tab.active")?.dataset.tab;
    if (active === "codex") renderCodex();
    if (active === "compendium") renderCompendium();
  });
  $("content").addEventListener("change", () => { character.content = $("content").value; saveCharacter(character); refreshChoices(); });
  $("name").addEventListener("input", () => { character.name = $("name").value; saveCharacter(character); });
  $("level").addEventListener("input", () => {
    const extra = (character.multiclasses || []).reduce((n, m) => n + (Number(m.level) || 0), 0);
    character.level = Math.max(1, Math.min(20 - extra, Number($("level").value) || 1));
    saveCharacter(character); recalc();
  });
  $("add-multiclass")?.addEventListener("click", async () => {
    if (totalLevel() >= 20) { toast("O personagem já está no nível 20."); return; }
    character.multiclasses = character.multiclasses || [];
    character.multiclasses.push({ classId: "", subclassId: "", level: 1 });
    saveCharacter(character);
    resolveMulticlassRefs();
    renderMulticlasses();
  });
  $("xp").addEventListener("input", () => { character.xp = Number($("xp").value) || 0; saveCharacter(character); });
  $("alignment").addEventListener("change", () => { character.alignment = $("alignment").value; saveCharacter(character); });
  $("languages").addEventListener("input", () => { character.languages = $("languages").value; saveCharacter(character); });
  $("appearance").addEventListener("input", () => { character.appearance = $("appearance").value; saveCharacter(character); });
  $("backstory").addEventListener("input", () => { character.backstory = $("backstory").value; saveCharacter(character); });
  $("inspiration").addEventListener("change", () => { character.inspiration = $("inspiration").checked ? 1 : 0; saveCharacter(character); });
  for (const k of ["cp", "pp", "pe", "po", "pl"]) {
    $(`coin-${k}`).addEventListener("input", () => { character.coins[k] = Math.max(0, Number($(`coin-${k}`).value) || 0); saveCharacter(character); });
  }
  $("hp-current").addEventListener("input", () => { character.hpCurrent = Number($("hp-current").value) || 0; saveCharacter(character); });
  $("hp-temp").addEventListener("input", () => { character.hpTemp = Number($("hp-temp").value) || 0; saveCharacter(character); });
  $("ac-input").addEventListener("input", () => { character.ac = Number($("ac-input").value) || null; character.manualAc = $("ac-input").value !== ""; recalc(); });
  $("speed-input").addEventListener("input", () => { character.speed = $("speed-input").value || "30 ft"; character.manualSpeed = true; recalc(); });
  document.querySelectorAll(".change-choice").forEach((b) => b.addEventListener("click", () => openPicker(b.dataset.pick)));
  document.querySelectorAll(".tiny-info").forEach((b) => b.addEventListener("click", () => openInfo(b.dataset.info)));
  document.querySelectorAll(".tab").forEach((b) => b.addEventListener("click", async () => {
    document.querySelectorAll(".tab").forEach((x) => x.classList.remove("active"));
    b.classList.add("active");
    document.querySelectorAll(".tab-page").forEach((x) => x.classList.remove("active"));
    $(`tab-${b.dataset.tab}`).classList.add("active");
    if (b.dataset.tab === "equipment") await equipmentTab();
    if (b.dataset.tab === "spells") await renderSpells();
    if (b.dataset.tab === "features") await renderFeatures();
    if (b.dataset.tab === "codex") await renderCodex();
    if (b.dataset.tab === "compendium") await renderCompendium();
  }));
  $("codex-search")?.addEventListener("input", () => { codexState.query = $("codex-search").value; renderCodex(); });
  document.querySelectorAll("#codex-type [data-codextype]").forEach((b) => b.addEventListener("click", () => {
    document.querySelectorAll("#codex-type [data-codextype]").forEach((x) => x.classList.remove("active"));
    b.classList.add("active"); codexState.type = b.dataset.codextype; renderCodex();
  }));
  document.querySelectorAll("#codex-content [data-codexcontent]").forEach((b) => b.addEventListener("click", () => {
    document.querySelectorAll("#codex-content [data-codexcontent]").forEach((x) => x.classList.remove("active"));
    b.classList.add("active"); codexState.content = b.dataset.codexcontent; renderCodex();
  }));
  $("codex-legacy")?.addEventListener("change", () => { codexState.legacy = $("codex-legacy").checked; renderCodex(); });
  document.querySelectorAll("[data-eqcat]").forEach((b) => b.addEventListener("click", async () => {
    document.querySelectorAll("[data-eqcat]").forEach((x) => x.classList.remove("active"));
    b.classList.add("active"); eqCat = b.dataset.eqcat; await equipmentTab();
  }));
  $("equipment-search").addEventListener("input", () => { if (eqCat !== "inventory") renderEquipmentCatalog(); });
  $("weapon-filter").addEventListener("change", () => { if (eqCat !== "inventory") renderEquipmentCatalog(); });
  $("compendium-search").addEventListener("input", renderCompendium);
  $("compendium-type").addEventListener("change", renderCompendium);
  $("collapse-creator").addEventListener("click", () => {
    $("creator").classList.toggle("collapsed");
    $("collapse-creator").textContent = $("creator").classList.contains("collapsed") ? "Expandir" : "Recolher";
  });
  $("add-attack").addEventListener("click", () => { character.attacks.push({ name: "", bonus: "", damage: "", notes: "" }); renderAttacks(); });
  $("save-character").addEventListener("click", () => { saveCharacter(character); toast("Personagem salvo neste navegador."); });
  $("export-character").addEventListener("click", () => downloadCharacter(character));
  $("new-character").addEventListener("click", () => { if (confirm("Começar um novo personagem?")) { clearCharacter(); applyLoaded(fresh()); toast("Novo personagem."); } });
  $("print-character").addEventListener("click", async () => { await buildOfficialSheet(); window.print(); });
  $("preview-pdf").addEventListener("click", openPdfPreview);
  $("import-character").addEventListener("change", async (e) => { try { applyLoaded(await readCharacterFile(e.target.files[0])); toast("Personagem importado."); } catch { toast("Arquivo inválido."); } });
  $("modal-close").addEventListener("click", () => $("modal").classList.add("hidden"));
  $("modal").addEventListener("click", (e) => { if (e.target === $("modal")) $("modal").classList.add("hidden"); });
  const refresh = $("refresh-data");
  if (refresh) refresh.addEventListener("click", async () => {
    if (!confirm("Baixar novamente os dados do 5etools? O cache local será limpo.")) return;
    await clearCache();
    location.reload();
  });
  $("data-update-refresh")?.addEventListener("click", async () => {
    markDataUpdateSeen();
    await clearCache();
    location.reload();
  });
  $("data-update-dismiss")?.addEventListener("click", () => {
    markDataUpdateSeen();
    $("data-update-banner")?.classList.add("hidden");
  });

  document.querySelectorAll("#creation-mode-toggle [data-mode]").forEach((b) => b.addEventListener("click", () => setCreationMode(b.dataset.mode)));
  $("wizard-back")?.addEventListener("click", wizardBack);
  $("wizard-next")?.addEventListener("click", wizardNext);
  document.addEventListener("click", (e) => { const b = e.target.closest("[data-ability-detail]"); if (b) openAbilityDetail(b.dataset.abilityDetail); });

  $("theme-toggle")?.addEventListener("click", () => {
    const light = document.documentElement.getAttribute("data-theme") === "light";
    if (light) document.documentElement.removeAttribute("data-theme"); else document.documentElement.setAttribute("data-theme", "light");
    saveTheme(light ? "dark" : "light");
    updateThemeToggleLabel();
  });
  updateThemeToggleLabel();
}
function updateThemeToggleLabel() {
  const btn = $("theme-toggle");
  if (!btn) return;
  const light = document.documentElement.getAttribute("data-theme") === "light";
  btn.textContent = light ? "🌙 Escuro" : "☀️ Claro";
  btn.setAttribute("aria-pressed", light ? "true" : "false");
}

// ------------------------------------------------------------
// Aviso de "banco de dados atualizado"
// ------------------------------------------------------------
// O workflow .github/workflows/sync-data.yml roda todo dia às 05h
// (horário de Brasília) e baixa a versão mais recente dos JSONs do
// 5etools + homebrew. Comparamos data/version.json (generatedAt) com
// a última versão que este navegador já viu para saber se rolou uma
// sincronização nova desde a última visita.
function markDataUpdateSeen() {
  const v = $("data-update-banner")?.dataset.version;
  if (v) setSeenDataVersion(v);
}
async function checkDataUpdateNotice() {
  const version = await currentVersionInfo();
  if (!version || !version.generatedAt) return;
  const seen = getSeenDataVersion();
  if (!seen) { setSeenDataVersion(version.generatedAt); return; } // primeira visita: nada para "avisar"
  if (seen === version.generatedAt) return; // já é a versão que o usuário viu

  const banner = $("data-update-banner");
  if (!banner) return;
  banner.dataset.version = version.generatedAt;
  const date = new Date(version.generatedAt).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });
  const hbFiles = version.homebrew?.classFileCount ?? 0;
  const totalHb = version.totals?.homebrew ?? null;
  $("data-update-text").textContent =
    `Banco de dados atualizado em ${date} (sincronização diária do 5etools + homebrew)` +
    (hbFiles ? ` — ${hbFiles.toLocaleString("pt-BR")} arquivos de classes homebrew` : "") +
    (totalHb ? `, ${totalHb.toLocaleString("pt-BR")} itens homebrew ao todo` : "") +
    `. Clique em "Atualizar agora" para recarregar com os dados novos.`;
  banner.classList.remove("hidden");
}
async function start() {
  character = loadCharacter() || fresh();
  setup();
  // O modo "livre" (padrão) não depende do banco pra aparecer; o modo
  // "guiado" precisa de ensureCatalog(), então só liga a UI do assistente
  // depois que o banco terminar de carregar, abaixo.
  if (creationMode !== "guided") setCreationMode("free");
  try {
    await initDatabase((label, done, total) => {
      $("db-status").textContent = `${label}… ${done}/${total}`;
    });
    const s = stats();
    $("db-status").textContent = `Pronto · ${s.entities.toLocaleString("pt-BR")} registros carregados`;
    $("db-count").textContent = `${s.entities.toLocaleString("pt-BR")} registros · dados do 5etools (${character.edition})`;
    applyLoaded(character);
    if (creationMode === "guided") setCreationMode("guided");
    renderCompendium();
    checkDataUpdateNotice().catch((err) => console.warn("Aviso de atualização indisponível:", err));
  } catch (e) {
    console.error(e);
    $("db-status").textContent = "Erro ao carregar dados do 5etools";
    $("db-count").textContent = "Verifique sua conexão e tente “Atualizar dados”.";
    applyLoaded(character);
  }
}
start();
