import {
  initDatabase, ensureCatalog, filterEntities, recordsForEntity, getRecordArrays,
  findClassFeatures, findSubclassFeatures, spellsForClass, stats,
  manifestEntries, isHomebrew as hb, isPrerelease as pre, isExternal as ext, normType, editionOf, currentVersionInfo,
  descriptionEntries, matchesEdition, isReprinted,
  loadBestiaryIndex, loadBestiarySource, loadAllBestiary, loadLegendaryGroups,
} from "./database.js";
import { clearCache } from "./store.js";
import {
  ABILITIES, ABILITY_NAMES, SKILLS, mod, fmt, proficiency, hpAverage, abilityKey, spellDc, spellAttack, casterSlots, pactSlots,
  rollDie, rollDice, parseDiceExpr, rollAbilityScore, ABILITY_ARRAYS, ABILITY_MODE_LABELS, ABILITY_ROLL_FORMULAS, CLASS_RESOURCE_COLUMNS, CONDITIONS,
} from "./rules.js";
import {
  saveCharacter, loadCharacter, downloadCharacter, readCharacterFile, getSeenDataVersion, setSeenDataVersion,
  getSavedSkin, saveSkin, SKINS, getSavedCreationMode, saveCreationMode, getTemplates, saveTemplates,
  migrateLegacyCharacter, getActiveCharacterId, setActiveCharacterId, listCharacters, createCharacterSlot, deleteCharacterSlot, loadCharacterById, saveCharacterAs,
  getDiscordWebhook, saveDiscordWebhook,
  getRoomCode, saveRoomCode, getAppliedHeals, markHealApplied,
  getMonsterLists, saveMonsterLists, newMonsterListId, getActiveMonsterListId, setActiveMonsterListId,
} from "./storage.js";

const $ = (id) => document.getElementById(id);
let character, refs = { class: null, subclass: null, race: null, background: null, multiclasses: [] }, details = {};
let pickerType = null, eqCat = "inventory", pickerLegacy = true, spellBookClassId = null;
let codexState = { type: "all", content: "all", query: "", legacy: false };
let monsterState = { view: "roster", query: "", source: "", listId: "" };
let monsterBrowseCache = []; // monstros já baixados nesta sessão (por fonte selecionada, ou tudo se "carregar todas")
let monsterAllLoaded = false;
let monsterLegendaryGroups = [];
let currentModalMonster = null;      // monstro exibido no modal de stat block agora
let currentModalMonsterGroups = {};  // { trait:[], action:[], bonus:[], reaction:[], legendary:[] } já normalizados

// ------------------------------------------------------------
// Assistente guiado de criação — passo a passo (espécie → classe →
// background → atributos → revisão) como alternativa ao "modo livre"
// (todos os cards visíveis de uma vez, comportamento original).
// ------------------------------------------------------------
const WIZARD_STEPS = [
  { key: "race", type: "race", title: "Espécie", hint: "Escolha a espécie/raça do seu personagem — ela define deslocamento, traços e, em muitos casos, um bônus de atributo." },
  { key: "class", type: "class", title: "Classe", hint: "Escolha a classe — ela define dado de vida, testes de resistência com proficiência e a lista de magias disponível." },
  { key: "subclass", type: "subclass", title: "Subclasse", hint: "Escolha a subclasse (opcional neste passo, mas normalmente obrigatória a partir de certo nível) — ela concede características próprias e, em várias classes, magias extras.", optional: true },
  { key: "level", title: "Nível", hint: "Defina o nível do personagem — ele determina pontos de vida, bônus de proficiência, espaços de magia e quais características já foram desbloqueadas." },
  { key: "background", type: "background", title: "Background", hint: "Escolha um background — ele concede perícias, ferramentas e, na edição 2024, um talento de origem." },
  { key: "multiclass", title: "Multiclasse", hint: "Opcional: adicione outras classes ao personagem. Pule este passo se não for multiclassar.", optional: true },
  { key: "abilities", title: "Atributos", hint: "Distribua seus atributos. Bônus de espécie, background, talentos e melhorias entram automaticamente — clique no ⓘ de cada atributo pra ver de onde vêm." },
  { key: "talents", title: "Talentos", hint: "Escolha perícias, talento de origem/espécie, melhorias de atributo, especialização e as opções de característica de classe (estilo de combate, invocações, manobras…) liberadas pelo nível atual.", optional: true },
  { key: "equipment", title: "Equipamento", hint: "Confira o equipamento inicial concedido pela classe e pelo background." },
  { key: "review", title: "Revisão", hint: "Revise as escolhas e finalize. Dá pra ajustar tudo depois, a qualquer momento, no modo livre." },
];
let wizardIndex = 0;
let creationMode = getSavedCreationMode();

const fresh = () => ({
  schema: 1, name: "", avatar: null, level: 1, xp: 0, inspiration: 0, edition: "2024", content: "all", abilityMode: "pointbuy", abilityRollFormula: "4d6dl1",
  classId: "", subclassId: "", raceId: "", backgroundId: "",
  multiclasses: [], // classes adicionais: [{classId, subclassId, level}] — classId/subclassId acima são a classe primária
  scores: { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 },
  saveProficiencies: [], skillProficiencies: [], skillExpertise: [],
  hpCurrent: null, hpTemp: 0, ac: null, udChoice: null, speed: "30 ft", attacks: [], inventory: [], preparedSpells: [], extraSpells: [], deathSaves: { success: 0, failure: 0 }, equipApplied: false,
  alignment: "", languages: "", appearance: "", backstory: "", toolProficienciesManual: "", hpModifier: 0,
  sizeOverride: "", // "" = usa o tamanho da espécie escolhida; senão T/S/M/L/H/G
  coins: { cp: 0, pp: 0, pe: 0, po: 0, pl: 0 },
  hitDiceUsed: {}, resourceUsage: {}, spellSlotsUsed: Array(9).fill(0), pactSlotsUsed: 0,
  conditions: [], journal: [], buffs: [], extraFeats: [], companions: [], customFeatures: [],
  turnActions: { action: false, bonus: false, reaction: false }, concentration: null,
  rolledSet: null, arrayAssignment: {},
  auto: { classSkills: [], backgroundSkills: [], classSaves: [], fixedSkills: [], speed: null, hitDice: null, spellcastingAbility: null },
  choiceSelections: { classSkills: [], backgroundSkills: [], raceSkills: {}, abilityChoices: {}, bgAbility: [], bgAbilityMode: 0, optionalFeatures: {}, asi: [], originFeat: null, raceFeat: null, featAbility: {}, startingEquip: {}, traitPicks: {} }, manualSkillProficiencies: [],
});
const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[c]));
const toast = (t) => { const e = $("toast"); e.textContent = t; e.classList.add("show"); clearTimeout(toast.t); toast.t = setTimeout(() => e.classList.remove("show"), 2400); };
const manifest = () => manifestEntries();
const list = (t, q = "") => filterEntities(t, character.edition, character.content, q);
const editionLabel = (x) => (editionOf(x) === "both" ? "2014/2024" : editionOf(x));
// Externo (ver isExternal em database.js) é tratado como homebrew:true na
// camada de dados — pra visibilidade/filtro ele é homebrew — mas ganha
// etiqueta própria aqui ("Externo"), daí o check vir antes de hb(x).
const contentLabel = (x) => ext(x) ? "Externo" : hb(x) ? "Homebrew" : pre(x) ? "Pré-lançamento" : "Oficial";
const labelMeta = (x) => `${contentLabel(x)} · ${editionLabel(x)}${x?.source ? " · " + x.source : ""}`;
const sourceTag = (x) => `<span class="tag ${ext(x) ? "external" : hb(x) ? "brew" : pre(x) ? "prerelease" : "official"}">${contentLabel(x).toUpperCase()}${x?.source ? ` · ${esc(x.source)}` : ""}</span>`;
const titleOf = (x) => String(x?.name || "Sem nome");
const typeLabel = (t) => ({ class: "Classe", subclass: "Subclasse", race: "Espécie/Raça", background: "Background", spell: "Magia", item: "Item", feat: "Talento", optionalfeature: "Opção", classFeature: "Característica", subclassFeature: "Característica" }[normType(t)] || t);

// ------------------------------------------------------------
// Link somente-leitura compartilhável — comprime o personagem (gzip
// nativo do navegador, com um modo sem compressão de reserva pros poucos
// navegadores sem CompressionStream) em base64url no hash da URL
// (#share=gz:<dados>). Sem servidor: quem abre roda o MESMO app, e como a
// automação (classe/raça/magias) já vem do 5etools ao vivo, o link só
// precisa guardar as escolhas — nada calculado embutido. O retrato (imagem
// pesada em base64) e as notas de sessão (privadas, podem ser longas)
// ficam de fora de propósito.
// ------------------------------------------------------------
let viewOnlyMode = false;
function base64UrlEncode(bytes) {
  let bin = "";
  bytes.forEach((b) => { bin += String.fromCharCode(b); });
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function base64UrlDecode(str) {
  const b64 = str.replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(b64 + (b64.length % 4 ? "=".repeat(4 - (b64.length % 4)) : ""));
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}
async function gzipEncode(text) {
  const bytes = new TextEncoder().encode(text);
  if (typeof CompressionStream === "undefined") return `raw:${base64UrlEncode(bytes)}`;
  const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream("gzip"));
  return `gz:${base64UrlEncode(new Uint8Array(await new Response(stream).arrayBuffer()))}`;
}
async function gzipDecode(payload) {
  const sep = payload.indexOf(":");
  const mode = payload.slice(0, sep), bytes = base64UrlDecode(payload.slice(sep + 1));
  if (mode === "raw") return new TextDecoder().decode(bytes);
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("gzip"));
  return new TextDecoder().decode(await new Response(stream).arrayBuffer());
}
const SHARE_EXCLUDE_KEYS = ["avatar", "journal"];
function shareSnapshot(c) {
  const out = { ...c };
  for (const k of SHARE_EXCLUDE_KEYS) delete out[k];
  return out;
}
async function buildShareUrl() {
  const payload = await gzipEncode(JSON.stringify(shareSnapshot(character)));
  const url = new URL(location.href);
  url.hash = `share=${payload}`;
  return url.toString();
}
async function decodeShareHash(hash) {
  const m = /^#?share=(.+)$/.exec(hash);
  if (!m) return null;
  try { return JSON.parse(await gzipDecode(decodeURIComponent(m[1]))); }
  catch (err) { console.error("Link somente-leitura inválido ou corrompido:", err); return null; }
}
// Lista branca de controles que continuam ativos em modo visualização —
// só busca/filtro (não mexem no personagem) e navegação entre abas.
const VIEW_ONLY_SAFE_IDS = new Set([
  "skin-select", "equipment-search", "weapon-filter", "compendium-search", "compendium-type",
  "codex-search", "preview-pdf", "print-character", "dashboard-toggle", "view-only-copy",
]);
// Trava tudo que existe no DOM agora — chamada de novo a cada troca de aba
// (ver setup()) porque várias abas só renderizam seu conteúdo (com
// checkboxes/botões novos) na hora do clique, depois do bloqueio inicial.
function lockViewOnlyControls() {
  if (!viewOnlyMode) return;
  document.querySelectorAll("main input, main textarea, main select").forEach((el) => { if (!VIEW_ONLY_SAFE_IDS.has(el.id)) el.disabled = true; });
  document.querySelectorAll("main button").forEach((el) => {
    if (el.classList.contains("tab") || VIEW_ONLY_SAFE_IDS.has(el.id) || el.hasAttribute("data-codextype") || el.hasAttribute("data-codexcontent")) return;
    el.disabled = true;
  });
}
function enterViewOnlyMode() {
  viewOnlyMode = true;
  document.body.classList.add("view-only");
  document.querySelector('.tab[data-tab="build"]')?.classList.add("hidden");
  $("creator")?.classList.add("hidden");
  $("auto-panel")?.classList.add("hidden");
  ["characters-btn", "new-character", "save-character", "templates-btn", "random-character", "import-character", "edition", "content", "share-link-btn"]
    .forEach((id) => { const el = $(id); if (el) el.disabled = true; });
  lockViewOnlyControls();
  const banner = $("view-only-banner");
  if (banner) {
    banner.classList.remove("hidden");
    $("view-only-text").textContent = `📖 Modo visualização — esta é a ficha de ${character.name || "um personagem"}, aberta por um link somente-leitura. Nada é salvo neste navegador enquanto estiver assim.`;
  }
}

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
// Classes já usadas (primária + outras linhas de multiclasse). Compara
// pelo NOME, não pelo id: "Bárbaro (PHB)" e "Bárbaro (XPHB)" são o mesmo
// bicho em fontes diferentes, e a lista mostrava as duas como se fossem
// classes distintas pra multiclassar.
function usedMulticlassNames(excludeIndex) {
  const set = new Set();
  const nameOf = (id) => String(manifest().find((x) => x.id === id)?.name || "").toLowerCase();
  if (character.classId) set.add(nameOf(character.classId));
  (character.multiclasses || []).forEach((m, i) => { if (i !== excludeIndex && m.classId) set.add(nameOf(m.classId)); });
  set.delete("");
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
  renderAllMulticlasses();
  await recalc();
}
// Pré-lançamento (Unearthed Arcana etc.) conta como "não oficial" pro
// seletor Oficial/Homebrew — não é fã-feito, mas também não é conteúdo
// publicado, então some junto com o homebrew quando "Apenas oficial"
// está selecionado, e aparece com "Oficial + Homebrew" ou "Apenas Homebrew".
const isNonOfficial = (x) => hb(x) || pre(x);
const pickerContentOk = (x) => character.content === "all" || (character.content === "official" && !isNonOfficial(x)) || (character.content === "homebrew" && isNonOfficial(x));
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
// Rótulo de uma opção de <select> de classe/subclasse: nome + a SIGLA da
// fonte de onde ela vem (PHB, XPHB, TCE, DnDWiki…) + a edição quando ela
// não é a da sessão. Sem a sigla, listas com o mesmo nome repetido (uma
// classe reimpressa em 2024, ou duas versões homebrew do mesmo conceito)
// ficavam indistinguíveis — escolher virava chute.
function entryOptionLabel(x) {
  const bits = [];
  if (x?.source) bits.push(String(x.source));
  const ed = editionOf(x);
  if (ed !== "both" && ed !== String(character.edition)) bits.push(ed);
  if (ext(x)) bits.push("externo");
  else if (pre(x)) bits.push("pré-lançamento");
  return `${titleOf(x)}${bits.length ? ` — ${bits.join(" · ")}` : ""}`;
}
// Agrupa as opções em Oficial / Pré-lançamento / Homebrew, pra ficar
// óbvio de onde cada linha vem antes mesmo de ler a sigla.
function groupedEntryOptions(arr, selectedId) {
  const groups = [["Oficial", (x) => !hb(x) && !pre(x)], ["Pré-lançamento (UA)", (x) => pre(x) && !hb(x)], ["Homebrew", (x) => hb(x)]];
  return groups.map(([label, test]) => {
    const items = arr.filter(test);
    if (!items.length) return "";
    const opts = items.map((x) =>
      `<option value="${esc(x.id)}"${x.id === selectedId ? " selected" : ""} title="${esc(labelMeta(x))}">${esc(entryOptionLabel(x))}</option>`).join("");
    return `<optgroup label="${esc(label)} (${items.length})">${opts}</optgroup>`;
  }).join("");
}
function multiclassClassCandidates(excludeIndex, selectedId) {
  const used = usedMulticlassNames(excludeIndex);
  return manifest().filter((x) =>
    normType(x.type) === "class" && matchesEdition(x, character.edition, true) && pickerContentOk(x) &&
    (x.id === selectedId || !used.has(String(x.name || "").toLowerCase())));
}
function multiclassSubclassCandidates(classEntry) {
  if (!classEntry) return [];
  const cn = String(classEntry.name).toLowerCase();
  return manifest().filter((x) =>
    normType(x.type) === "subclass" && matchesEdition(x, character.edition, true) &&
    String(x.className || "").toLowerCase() === cn && pickerContentOk(x));
}
const sortEntries = (arr) => arr.slice().sort((a, b) => Number(hb(a)) - Number(hb(b)) || String(a.name).localeCompare(String(b.name), "pt-BR") || String(a.source || "").localeCompare(String(b.source || "")));
function classSelectOptions(selectedId, excludeIndex) {
  return `<option value="">Selecionar classe…</option>` + groupedEntryOptions(sortEntries(multiclassClassCandidates(excludeIndex, selectedId)), selectedId);
}
function subclassSelectOptions(classEntry, selectedId) {
  if (!classEntry) return `<option value="">Escolha a classe primeiro</option>`;
  return `<option value="">Sem subclasse ainda</option>` + groupedEntryOptions(sortEntries(multiclassSubclassCandidates(classEntry)), selectedId);
}
// Popup com busca + filtro Oficial/Homebrew pra escolher classe/subclasse de
// multiclasse — o mesmo padrão da tela de criação (openPicker), útil quando
// o banco tem muitas opções e o <select> nativo vira uma lista enorme pra rolar.
async function openMulticlassPicker(kind, i) {
  const row = character.multiclasses?.[i];
  if (!row) return;
  const classEntry = manifest().find((x) => x.id === row.classId) || null;
  if (kind === "subclass" && !classEntry) { toast("Escolha a classe primeiro."); return; }
  const modal = $("modal"), content = $("modal-content");
  const title = kind === "class" ? "Classe adicional" : "Subclasse adicional";
  content.innerHTML = `<div class="modal-title"><div><span class="eyebrow">MULTICLASSE</span><h2>${esc(title)}</h2></div></div><div class="loading">Carregando catálogo…</div>`;
  modal.classList.remove("hidden");
  try { await ensureCatalog(kind); } catch (err) { console.error(err); }
  content.innerHTML = `<div class="modal-title"><div><span class="eyebrow">MULTICLASSE</span><h2>${esc(title)}</h2></div></div>
  <div class="picker-controls"><input id="picker-search" placeholder="Pesquisar ${esc(title.toLowerCase())}…"><div class="filter-pills"><button class="active" data-pfilter="all">Todos</button><button data-pfilter="official">Oficial</button><button data-pfilter="homebrew">Homebrew</button></div></div>
  <div id="picker-results" class="picker-grid"></div>`;
  const render = () => {
    const q = $("picker-search").value.trim().toLowerCase();
    let arr = kind === "class" ? multiclassClassCandidates(i, row.classId) : multiclassSubclassCandidates(classEntry);
    if (q) arr = arr.filter((x) => titleOf(x).toLowerCase().includes(q));
    const pf = content.querySelector(".filter-pills .active")?.dataset.pfilter || "all";
    if (pf === "official") arr = arr.filter((x) => !hb(x));
    if (pf === "homebrew") arr = arr.filter((x) => hb(x));
    paintPickResults($("picker-results"), sortEntries(arr).slice(0, 300), async (e) => {
      if (kind === "class") { row.classId = e.id; row.subclassId = ""; } else { row.subclassId = e.id; }
      saveCharacter(character);
      await refreshChoices();
      modal.classList.add("hidden");
    });
  };
  $("picker-search").addEventListener("input", render);
  content.querySelectorAll("[data-pfilter]").forEach((b) => b.addEventListener("click", () => {
    content.querySelectorAll("[data-pfilter]").forEach((x) => x.classList.remove("active"));
    b.classList.add("active"); render();
  }));
  render();
  setTimeout(() => $("picker-search")?.focus(), 50);
}
function renderMulticlasses(boxId) {
  const box = $(boxId || "multiclass-list");
  if (!box) return;
  const rows = character.multiclasses || [];
  if (!rows.length) { box.innerHTML = `<p class="muted">Nenhuma classe adicional. Use "+ Adicionar classe" para multiclassar.</p>`; return; }
  box.innerHTML = rows.map((m, i) => {
    const classEntry = manifest().find((x) => x.id === m.classId) || null;
    const rec = classEntry ? recordsForEntity(classEntry)[0] : null;
    const warn = classEntry && !meetsMulticlassRequirement(rec) ? `<div class="multiclass-warn">Requer ${esc(multiclassRequirementText(rec))} para multiclassar.</div>` : "";
    return `<div class="multiclass-row" data-mc-row="${i}">
      <div class="mc-field"><select data-mc-class="${i}" aria-label="Classe adicional">${classSelectOptions(m.classId, i)}</select><button type="button" class="no-print" data-mc-class-search="${i}" title="Pesquisar e filtrar classe">🔍</button></div>
      <div class="mc-field"><select data-mc-subclass="${i}" aria-label="Subclasse adicional" ${classEntry ? "" : "disabled"}>${subclassSelectOptions(classEntry, m.subclassId)}</select><button type="button" class="no-print" data-mc-subclass-search="${i}" title="Pesquisar e filtrar subclasse" ${classEntry ? "" : "disabled"}>🔍</button></div>
      <input type="number" min="1" max="19" value="${Number(m.level) || 1}" data-mc-level="${i}" aria-label="Nível">
      <button type="button" class="remove-btn no-print" data-mc-remove="${i}" title="Remover classe">×</button>
      ${warn}
    </div>`;
  }).join("");
  box.querySelectorAll("[data-mc-class-search]").forEach((b) => b.addEventListener("click", () => openMulticlassPicker("class", Number(b.dataset.mcClassSearch))));
  box.querySelectorAll("[data-mc-subclass-search]").forEach((b) => b.addEventListener("click", () => openMulticlassPicker("subclass", Number(b.dataset.mcSubclassSearch))));
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
    renderAllMulticlasses();
  }));
  box.querySelectorAll("[data-mc-remove]").forEach((b) => b.addEventListener("click", async () => {
    const i = Number(b.dataset.mcRemove);
    character.multiclasses.splice(i, 1);
    saveCharacter(character);
    await refreshChoices();
  }));
}
// Passo de multiclasse do assistente reaproveita a MESMA renderização do
// modo livre (dois containers independentes com os mesmos dados) — sem
// isso, mudar a multiclasse em um dos dois lugares deixava o outro
// desatualizado até a próxima ação.
function renderAllMulticlasses() { renderMulticlasses("multiclass-list"); renderMulticlasses("wizard-multiclass-list"); }

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
    (codexState.content === "all" || (codexState.content === "official" && !isNonOfficial(x)) || (codexState.content === "homebrew" && isNonOfficial(x))))
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
    const feats = await findClassFeatures(e, 20).catch(() => []);
    if (feats.length) extra += `<h3 class="codex-divider">O que cada nível dá</h3>${featuresListHtml(feats)}`;
    else if (!hasLore) extra += `<p class="muted">Sem texto narrativo no banco para esta classe.</p>`;
    const subs = subclassesOf(e);
    if (subs.length) extra += `<h3 class="codex-divider">Subclasses (${subs.length})</h3><div class="codex-chip-row">${subs.map((s) => `<button class="codex-chip" data-codex-id="${esc(s.id)}">${esc(titleOf(s))} ${sourceTag(s)}</button>`).join("")}</div>`;
  } else if (t === "subclass") {
    const feats = await findSubclassFeatures(e, 20).catch(() => []);
    if (feats.length) extra += `<h3 class="codex-divider">O que cada nível dá</h3>${featuresListHtml(feats)}`;
    else if (!hasLore) extra += `<p class="muted">Sem texto no banco para esta subclasse.</p>`;
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
// Métodos de geração de atributos:
//  - pointbuy: 27 pontos, custo 8–15 (regra padrão)
//  - standard / heroic / epic: array fixo (ABILITY_ARRAYS) — cada valor
//    usado em exatamente um atributo, atribuído por dropdown
//  - roll: rola 6 valores (4d6, descarta o menor) no próprio site e
//    distribui do mesmo jeito que um array fixo
//  - free: valor livre digitado (1–30)
const ABILITY_MODE_HINTS = {
  pointbuy: "Use +/− para distribuir pontos (custo padrão 8–15). Ajustes de espécie/background entram automaticamente quando o banco os estrutura.",
  free: "Digite qualquer valor de 1 a 30. Ajustes de espécie/background continuam entrando automaticamente.",
  roll: "Clique em \"Rolar atributos\" pra gerar 6 valores (4d6, descarta o menor) e distribua cada um num atributo abaixo.",
  standard: "Distribua os valores do array padrão pelos seis atributos — cada valor só pode ser usado uma vez.",
  heroic: "Distribua os valores do array heroico pelos seis atributos — cada valor só pode ser usado uma vez.",
  epic: "Distribua os valores do array épico pelos seis atributos — cada valor só pode ser usado uma vez.",
};
function arraySourceFor(mode) { return ABILITY_ARRAYS[mode]?.values || null; }
function paintAbilityEditor(ns) {
  const el = (id) => document.getElementById(ns + id);
  const grid = el("ability-grid"), editor = el("ability-editor");
  if (!grid && !editor) return;
  const mode = character.abilityMode || "pointbuy";
  const free = mode === "free";
  const pointbuy = mode === "pointbuy";
  const preset = arraySourceFor(mode);
  const isRoll = mode === "roll";
  const isSlotted = !!preset || isRoll; // array fixo ou rolado: atribuição por slot
  const lo = free ? 1 : 8, hi = free ? 30 : 15;
  // Mostra o valor EFETIVO (base do point buy/array/rolagem + aumentos de espécie/background/talentos).
  if (grid) {
    // Botão de resistência dentro do próprio box do atributo (só na ficha de
    // jogo, não no passo do assistente) — evita ter que rolar até o card
    // separado "Testes de Resistência" só pra rolar um salvamento comum.
    // A caixa de resistências continua existindo pra marcar proficiência.
    const pb = proficiency(totalLevel());
    grid.innerHTML = ABILITIES.map((a) => {
      const base = Number(character.scores[a]) || 10, eff = effScore(a), bonus = eff - base;
      const info = bonus ? `<button type="button" class="ability-info-btn" data-ability-detail="${a}" title="Ver de onde vêm esses pontos">ⓘ</button>` : "";
      let saveBtn = "";
      if (!ns) {
        const ok = character.saveProficiencies.includes(a), sv = mod(eff) + (ok ? pb : 0);
        const formula = `Resistência de ${ABILITY_NAMES[a]}: ${fmt(mod(eff))}${ok ? ` + proficiência ${fmt(pb)}` : ""} = ${fmt(sv)} · ${D20_MODE_TITLE}`;
        saveBtn = `<button type="button" class="ability-save-btn no-print${ok ? " prof" : ""}" data-save-roll-quick="${a}" title="${esc(formula)}">🛡 ${fmt(sv)}</button>`;
      }
      return `<div class="ability-box"><span>${ABILITY_NAMES[a]}</span><b>${eff}${bonus ? `<i>${fmt(bonus)}</i>` : ""}</b><em>${fmt(mod(eff))}</em>${info}${saveBtn}</div>`;
    }).join("");
    if (!ns) grid.querySelectorAll("[data-save-roll-quick]").forEach((b) => b.addEventListener("click", (e) => {
      const a = b.dataset.saveRollQuick, ok = character.saveProficiencies.includes(a), bonus = mod(effScore(a)) + (ok ? proficiency(totalLevel()) : 0);
      const { rolls, roll, mode } = d20WithMode(e), total = roll + bonus;
      toast(`Resistência de ${ABILITY_NAMES[a]}: ${d20RollPlain(rolls, roll, mode)} ${fmt(bonus)} = ${total}`);
      broadcastRoll(`Resistência de ${ABILITY_NAMES[a]}`, `${d20RollPlain(rolls, roll, mode)} ${fmt(bonus)}`, total, { type: "resistencia" });
    }));
  }
  if (!editor) return;
  const spent = pointBuyTotal(), remaining = 27 - spent;
  const remEl = el("pointbuy-remaining");
  if (remEl) { remEl.textContent = remaining; remEl.classList.toggle("over", remaining < 0); }
  if (el("ability-mode")) el("ability-mode").value = mode;
  el("pointbuy-remaining-wrap")?.classList.toggle("hidden", !pointbuy);
  el("reset-pointbuy")?.classList.toggle("hidden", !pointbuy);
  if (el("ability-editor-hint")) el("ability-editor-hint").textContent = ABILITY_MODE_HINTS[mode] || ABILITY_MODE_HINTS.pointbuy;

  const extraBox = el("ability-mode-extra");
  if (extraBox) {
    if (preset) {
      extraBox.innerHTML = `<span class="array-hint">Valores: <b>${preset.join(", ")}</b></span>`;
    } else if (isRoll) {
      const rolled = character.rolledSet;
      const formula = character.abilityRollFormula || "4d6dl1";
      const formulaOpts = Object.entries(ABILITY_ROLL_FORMULAS).map(([k, f]) => `<option value="${k}"${k === formula ? " selected" : ""}>${esc(f.label)}</option>`).join("");
      extraBox.innerHTML = `<label class="ability-mode-label">Fórmula<select id="${ns}roll-formula">${formulaOpts}</select></label>
        <span class="array-hint">${rolled ? `Rolado: <b>${rolled.join(", ")}</b>` : "Ainda não rolado."}</span><button type="button" class="no-print" id="${ns}roll-abilities">🎲 ${rolled ? "Rolar de novo" : "Rolar atributos"}</button>`;
      el("roll-formula")?.addEventListener("change", (e) => {
        character.abilityRollFormula = e.target.value in ABILITY_ROLL_FORMULAS ? e.target.value : "4d6dl1";
        saveCharacter(character);
      });
      el("roll-abilities")?.addEventListener("click", () => {
        character.rolledSet = Array.from({ length: 6 }, () => rollAbilityScore(character.abilityRollFormula));
        character.arrayAssignment = {};
        ABILITIES.forEach((a) => (character.scores[a] = 10));
        saveCharacter(character); recalc();
        toast(`Rolado (${ABILITY_ROLL_FORMULAS[character.abilityRollFormula]?.label || ""}): ${character.rolledSet.join(", ")}`);
      });
    } else {
      extraBox.innerHTML = "";
    }
  }

  if (isSlotted) {
    const source = preset || character.rolledSet || [];
    character.arrayAssignment = character.arrayAssignment || {};
    if (!source.length) {
      editor.innerHTML = `<p class="muted">Clique em "Rolar atributos" acima pra gerar valores e distribuí-los.</p>`;
      return;
    }
    const usedIdx = new Set(ABILITIES.map((a) => character.arrayAssignment[a]).filter((v) => v != null));
    editor.innerHTML = ABILITIES.map((a) => {
      const curIdx = character.arrayAssignment[a] != null ? character.arrayAssignment[a] : "";
      const opts = source.map((v, i) => (usedIdx.has(i) && i !== curIdx) ? "" : `<option value="${i}" ${i === curIdx ? "selected" : ""}>${v}</option>`).join("");
      return `<div class="ability-edit array-mode"><span>${ABILITY_NAMES[a]}</span><select data-array-assign="${a}"><option value="">—</option>${opts}</select><b>${fmt(mod(Number(character.scores[a]) || 10))}</b></div>`;
    }).join("");
    editor.querySelectorAll("[data-array-assign]").forEach((s) => s.addEventListener("change", () => {
      const a = s.dataset.arrayAssign;
      const idx = s.value === "" ? null : Number(s.value);
      character.arrayAssignment[a] = idx;
      character.scores[a] = idx != null ? source[idx] : 10;
      saveCharacter(character); recalc();
    }));
    return;
  }

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
    if (pointbuy) {
      const delta = pointCost(next) - pointCost(v);
      if (delta > 27 - pointBuyTotal()) { toast("Você não tem pontos suficientes."); return; }
    }
    character.scores[a] = next; recalc(); saveCharacter(character);
  }));
  const reset = el("reset-pointbuy");
  if (reset) reset.onclick = () => { ABILITIES.forEach((a) => (character.scores[a] = 10)); saveCharacter(character); recalc(); };
  const modeSel = el("ability-mode");
  if (modeSel) modeSel.onchange = () => {
    character.abilityMode = modeSel.value in ABILITY_MODE_LABELS ? modeSel.value : "pointbuy";
    if (arraySourceFor(character.abilityMode) || character.abilityMode === "roll") {
      character.arrayAssignment = {};
      ABILITIES.forEach((a) => (character.scores[a] = 10));
    }
    saveCharacter(character); recalc();
  };
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
// Detecta "Unarmored Defense" (Bárbaro: CON, Monge: SAB, e variantes
// homebrew com outro atributo) numa lista de características de classe,
// lendo o próprio texto da característica em vez de fixar por nome de
// classe — funciona pra qualquer classe oficial ou homebrew que conceda
// o traço com esse nome.
//
// Devolve TODAS as variantes encontradas (um multiclasse Monge/Bárbaro
// tem duas), cada uma com o atributo, se ela permite escudo e de qual
// classe veio. Pelas regras você não soma as duas: escolhe uma — quem
// escolhe é pickUnarmoredDefense(), pegando a de maior CA no momento.
function detectUnarmoredDefense(feats, sourceLabel) {
  const out = [];
  for (const f of feats || []) {
    if (!/^unarmored defense$/i.test(String(f.name || "").trim())) continue;
    const text = plain(f.entries).toLowerCase();
    const ability = /constitution modifier/.test(text) ? "con"
      : /wisdom modifier/.test(text) ? "wis"
      : /intelligence modifier/.test(text) ? "int"
      : /charisma modifier/.test(text) ? "cha" : null;
    if (!ability) continue;
    // Monge: "while you are wearing no armor and not wielding a shield".
    // Bárbaro: "you can use a shield and still gain this benefit".
    const shieldOk = !/\bnot (?:wielding|using|carrying|holding) a shield\b/.test(text);
    out.push({ ability, shieldOk, label: sourceLabel || f.className || "Classe" });
  }
  return out;
}
// Escolhe qual Unarmored Defense usar: descarta as que não valem com o
// escudo equipado e, entre as que sobram, fica com a que dá a MAIOR CA
// com os atributos atuais (antes a ficha pegava sempre a primeira da
// lista, então um Monge/Bárbaro com SAB baixa ficava com a pior).
function pickUnarmoredDefense(hasShield) {
  const usable = (character?.auto?.unarmoredDefenseOptions || []).filter((o) => o.shieldOk || !hasShield);
  // Preferência manual (select "Defesa desarmada") vence, desde que a
  // variante escolhida ainda seja válida com o que está equipado.
  const forced = usable.find((o) => o.ability === character?.udChoice);
  const chosen = forced || usable.reduce((best, o) =>
    (!best || mod(effScore(o.ability)) > mod(effScore(best.ability))) ? o : best, null);
  return chosen ? { ...chosen, value: mod(effScore(chosen.ability)), manual: !!forced } : null;
}
// Proficiência de armadura/escudo concedida por uma característica de
// classe/subclasse ALÉM da proficiência inicial (nível 1) — comum em
// subclasses que "destravam" armadura média/pesada/escudo num nível
// mais alto (ex.: Disciple of Fortification, College of Swords). Lê o
// texto da característica em vez de depender de um campo estruturado,
// já que esse tipo de concessão quase nunca vem como startingProficiencies.
function detectProficiencyGrants(feats) {
  const gained = new Set();
  for (const f of feats || []) {
    const text = plain(f.entries).toLowerCase();
    for (const sentence of text.split(/(?<=[.;])\s+/)) {
      if (!/proficien/.test(sentence)) continue;
      if (/\b(not|aren't|isn't|don't|lose|losing)\b[^.;]{0,25}proficien/.test(sentence)) continue;
      // "medium and heavy armour and shields" — os tamanhos vêm listados
      // juntos antes de "armor/armour" aparecer uma única vez na frase,
      // então cada tamanho é checado solto (não "medium armor" grudado).
      if (/\bshields?\b/.test(sentence)) gained.add("shield");
      if (/\barmo(u)?r\b/.test(sentence)) {
        if (/\blight\b/.test(sentence)) gained.add("light");
        if (/\bmedium\b/.test(sentence)) gained.add("medium");
        if (/\bheavy\b/.test(sentence)) gained.add("heavy");
      }
    }
  }
  return gained;
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
// Talentos elegíveis pro nível/edição/conteúdo atuais — usado tanto pelo
// select do painel de automação quanto pelo gerador de personagem aleatório.
function eligibleFeats(categories) {
  const lvl = Number(character.level);
  return featStubs().filter((e) => {
    if (/ability score improvement/i.test(e.name)) return false;
    if (!pickerContentOk(e)) return false;
    if (!matchesEdition(e, character.edition, true)) return false;
    const r = featRec(e), cat = String(r.category || "").toUpperCase();
    if (prereqLevel(r) > lvl) return false;
    // Homebrew normalmente não marca "category" (O/G/EB/FS...) como o
    // oficial — sem isso, ficava de fora tanto da lista livre quanto de
    // qualquer categoria específica exigida (origem/espécie).
    if (categories) return hb(e) || categories.includes(cat);
    if (cat === "O") return false;
    if (cat === "EB" && lvl < 19) return false;
    return true;
  }).sort((a, b) => Number(hb(a)) - Number(hb(b)) || a.name.localeCompare(b.name, "pt-BR"));
}
// Alguns rascunhos de Unearthed Arcana (2022/2023) e classes homebrew não
// nomeiam a característica "Ability Score Improvement" — chamam-na só de
// "Feat" ("You gain the Ability Score Improvement Feat or another Feat of
// your choice"), mas o efeito é o mesmo slot de melhoria/talento.
function isAsiFeatureName(name) {
  const n = String(name || "").trim();
  return /ability score improvement/i.test(n) || /^feat$/i.test(n);
}
function asiSlotCount(classFeatures) {
  return (classFeatures || []).filter((f) => isAsiFeatureName(f.name)).length;
}
function chosenFeatEntities() {
  const out = [];
  for (const id of [character.choiceSelections?.originFeat, character.choiceSelections?.raceFeat]) {
    if (id) { const e = manifest().find((x) => x.id === id); if (e) out.push(e); }
  }
  for (const slot of character.choiceSelections?.asi || []) {
    if (slot && slot.mode === "feat" && slot.feat) { const e = manifest().find((x) => x.id === slot.feat); if (e) out.push(e); }
  }
  for (const id of character.extraFeats || []) {
    const e = manifest().find((x) => x.id === id); if (e) out.push(e);
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
  // Deformações do Lefou marcadas como escolhidas (ver LEFOU_DEFORMATION_BONUSES)
  // entram junto com as perícias fixas da raça, como se a própria raça as
  // concedesse — assim ficam corretamente marcadas como automáticas (não
  // "manuais") no restante da automação de perícias.
  const deformationBonuses = lefouDeformationBonuses(rr);
  const raceFixedSkills = [...new Set([...fixedSkillsFrom(rr.skillProficiencies), ...deformationBonuses.skills])];
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
  // Membranous Hands/Rigid Fingers (Lefou): a deslocamento adicional (natação/
  // escalada) igual ao deslocamento normal vira uma nota anexada ao mesmo
  // campo de deslocamento automático — não existe um campo separado por tipo
  // de deslocamento nesta ficha (nem pra raças oficiais com a mesma forma de
  // traço, como natação/escalada do Tritão), então seguimos o padrão já usado.
  if (deformationBonuses.speedTypes.length && character.auto.speed) {
    const m = String(character.auto.speed).match(/^(\d+)\s*(.*)$/);
    if (m) {
      const [, num, unit] = m;
      const extra = deformationBonuses.speedTypes.map((t) => `${t} ${num}${unit ? ` ${unit}` : ""}`).join(", ");
      character.auto.speed = `${character.auto.speed} (${extra})`;
    }
  }
  character.auto.acBonus = deformationBonuses.ac;
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
  const subFeats = refs.subclass ? await findSubclassFeatures(refs.subclass, Number(character.level)).catch(() => []) : [];
  const mcClassFeats = await Promise.all((details.multiclasses || []).map((m) =>
    m.classEntry ? findClassFeatures(m.classEntry, Number(m.level)).catch(() => []) : Promise.resolve([])));

  // Unarmored Defense (Bárbaro/Monge e variantes homebrew): usado como CA
  // padrão quando não há CA manual definida (ver calc()). Junta a classe
  // primária, a subclasse e cada classe de multiclasse; qual delas vale
  // é decidido em calc() por pickUnarmoredDefense (a de maior CA).
  const udOptions = [
    ...detectUnarmoredDefense(classFeats, refs.class ? titleOf(refs.class) : "Classe"),
    ...detectUnarmoredDefense(subFeats, refs.subclass ? titleOf(refs.subclass) : "Subclasse"),
    ...mcClassFeats.flatMap((fs, i) => detectUnarmoredDefense(fs, titleOf((details.multiclasses || [])[i]?.classEntry) || "Multiclasse")),
  ];
  // Mesmo atributo vindo de duas classes é uma opção só (não soma).
  const udSeen = new Map();
  for (const o of udOptions) {
    const prev = udSeen.get(o.ability);
    if (!prev) udSeen.set(o.ability, o);
    else if (o.shieldOk && !prev.shieldOk) udSeen.set(o.ability, o); // a versão mais permissiva vence
  }
  character.auto.unarmoredDefenseOptions = [...udSeen.values()];
  character.auto.unarmoredDefense = character.auto.unarmoredDefenseOptions[0]?.ability || null;
  // Armadura/escudo concedido por característica (não startingProficiencies)
  // — ex. subclasse que destrava armadura média/pesada num nível mais alto.
  character.auto.armorGrants = [...detectProficiencyGrants([...classFeats, ...subFeats, ...mcClassFeats.flat()])];

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

  const autoChoiceData = {
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
  };
  renderAutoChoices(autoChoiceData);
  return autoChoiceData;
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
      normType(x.type) === "optionalfeature" && pickerContentOk(x) &&
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
  const featSelect = (attr, current, categories) =>
    `<select ${attr}><option value="">— escolher talento —</option>${eligibleFeats(categories).map((e) =>
      `<option value="${esc(e.id)}"${e.id === current ? " selected" : ""}>${esc(e.name)}${e.source ? ` (${esc(e.source)})` : ""}${hb(e) ? " · Homebrew" : ""}</option>`).join("")}</select>`;
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
  // Modificadores temporários (buffs/debuffs) aplicados manualmente
  for (const buff of character.buffs || []) {
    if ((buff.abilities || []).includes(a) && buff.value) parts.push({ label: `Buff: ${buff.label || "Modificador"}`, value: buff.value });
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
  // Modificador manual de PV máximo — pra talentos/traços que dão PV extra
  // fora da conta padrão de dado de vida + CON (ex.: Robusto/Tough, que dá
  // +2 por nível; o jogador mantém esse total, já que o "por nível" varia
  // por fonte e homebrew demais pra automatizar aqui).
  hp += Number(character.hpModifier) || 0;
  return Math.max(1, hp);
}
// ------------------------------------------------------------
// Armadura equipada — lê o item real do inventário (tipo LA/MA/HA/S do
// 5etools) pra CA parar de depender só do Unarmored Defense ou do
// campo manual. "equipped" é um booleano no próprio item do inventário.
// ------------------------------------------------------------
function invItemRecord(x) {
  if (!x?.id) return null;
  const e = manifest().find((m) => m.id === x.id);
  return e ? (recordsForEntity(e)[0] || null) : null;
}
function armorTypeOf(r) {
  if (!r) return null;
  // Alguns registros trazem o tipo como "HA|XPHB" (sigla + fonte).
  const type = String(r.type || "").split("|")[0];
  if (type === "S" || /^shield$/i.test(String(r.name || "").trim())) return "shield";
  if (r.armor && type === "LA") return "light";
  if (r.armor && type === "MA") return "medium";
  if (r.armor && type === "HA") return "heavy";
  return null;
}
function equippedArmorInfo() {
  let bodyArmor = null, shield = null;
  for (const x of character.inventory || []) {
    if (!x.equipped) continue;
    const r = invItemRecord(x), at = armorTypeOf(r);
    if (!at) continue;
    if (at === "shield") { if (!shield) shield = { name: x.name, ac: Number(r.ac) || 2 }; }
    else if (!bodyArmor) bodyArmor = { name: x.name, type: at, ac: Number(r.ac) || 10, strength: r.strength ? Number(String(r.strength).replace(/\D/g, "")) || null : null, stealth: !!r.stealth };
  }
  return { bodyArmor, shield };
}
function calc() {
  const lvl = totalLevel(), pb = proficiency(lvl);
  const dexMod = mod(effScore("dex"));
  const init = dexMod;
  const passive = 10 + mod(effScore("wis")) + (character.skillProficiencies.includes("perception") ? pb : 0) + (character.skillExpertise.includes("perception") ? pb : 0);
  const hp = inferHP();
  const equippedArmor = equippedArmorInfo();
  // Unarmored Defense só entra sem armadura de corpo, e a variante usada
  // é a de maior CA entre as que o escudo equipado permite.
  const udInfo = equippedArmor.bodyArmor ? null : pickUnarmoredDefense(!!equippedArmor.shield);
  const ud = udInfo?.ability || null;
  let acAuto;
  if (equippedArmor.bodyArmor) {
    const dexPart = equippedArmor.bodyArmor.type === "light" ? dexMod : equippedArmor.bodyArmor.type === "medium" ? Math.min(2, dexMod) : 0;
    acAuto = equippedArmor.bodyArmor.ac + dexPart;
  } else {
    acAuto = 10 + dexMod + (ud ? mod(effScore(ud)) : 0);
  }
  if (equippedArmor.shield) acAuto += equippedArmor.shield.ac;
  acAuto += character.auto?.acBonus || 0; // Carapace (Lefou) e bônus fixos de CA equivalentes
  const ac = Number(character.ac) || acAuto;
  const speed = character.speed || character.auto?.speed || "30 ft";
  const sa = character.spellAbility || spellAbilityFrom(classInfo());
  const dc = sa ? spellDc(pb, mod(effScore(sa))) : null;
  const atk = sa ? spellAttack(pb, mod(effScore(sa))) : null;
  return { lvl, pb, init, passive, hp, ac, acAuto, acBonus: character.auto?.acBonus || 0, ud, udInfo, equippedArmor, speed, sa, dc, atk };
}
function acAutoTitle(c) {
  if (character.ac) return "";
  const eq = c.equippedArmor || {};
  const shieldPart = eq.shield ? ` + ${eq.shield.name} ${fmt(eq.shield.ac)}` : "";
  const bonusPart = c.acBonus ? ` + ${c.acBonus} (Deformações)` : "";
  if (eq.bodyArmor) {
    const dexMod = mod(effScore("dex"));
    const dexPart = eq.bodyArmor.type === "light" ? dexMod : eq.bodyArmor.type === "medium" ? Math.min(2, dexMod) : 0;
    const dexLabel = eq.bodyArmor.type === "heavy" ? "" : ` + DES ${fmt(dexPart)}${eq.bodyArmor.type === "medium" ? " (máx. +2)" : ""}`;
    return `${eq.bodyArmor.name}: ${eq.bodyArmor.ac}${dexLabel}${shieldPart}${bonusPart} = ${c.ac}. Defina uma CA manual pra sobrescrever.`;
  }
  if (c.ud) {
    // Com mais de uma variante (Monge/Bárbaro), diz qual foi escolhida e
    // por quê — e lista as descartadas, pra não parecer bug.
    const all = character.auto?.unarmoredDefenseOptions || [];
    const others = all.filter((o) => o.ability !== c.ud)
      .map((o) => `${ABILITY_NAMES[o.ability]} ${fmt(mod(effScore(o.ability)))}${eq.shield && !o.shieldOk ? " — não vale com escudo" : ""} (${o.label})`);
    const chosen = c.udInfo?.label ? ` — ${c.udInfo.label}` : "";
    const altPart = others.length ? ` Outra opção de Unarmored Defense: ${others.join("; ")} (você usa só uma, a ficha pega a melhor).` : "";
    return `Sem armadura: 10 + DES ${fmt(mod(effScore("dex")))} + ${ABILITY_NAMES[c.ud]} ${fmt(mod(effScore(c.ud)))} (Unarmored Defense${chosen})${shieldPart}${bonusPart} = ${c.ac}.${altPart} Defina uma CA manual pra sobrescrever.`;
  }
  if (eq.shield || c.acBonus) return `10 + DES ${fmt(mod(effScore("dex")))}${shieldPart}${bonusPart} = ${c.ac}. Defina uma CA manual pra sobrescrever.`;
  return "";
}
async function recalc() {
  if (!character) return;
  if ((character.inventory || []).some((x) => x.equipped)) { try { await ensureCatalog("item"); } catch (err) { console.warn("Catálogo de itens indisponível:", err); } }
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
  // Mantém o campo de nível do cabeçalho sincronizado mesmo quando o nível
  // muda por outro controle (ex.: o seletor rápido no painel/dashboard).
  if (document.activeElement !== $("level")) $("level").value = character.level;
  const c = calc();
  renderAbilities();
  const acTitle = acAutoTitle(c);
  $("v-ac").textContent = c.ac; $("v-ac").title = acTitle; $("v-init").textContent = fmt(c.init); $("v-speed").textContent = c.speed; $("v-pb").textContent = fmt(c.pb);
  $("v-size").textContent = offSizeLabel();
  $("v-passive").textContent = c.passive; $("v-spell-dc").textContent = c.dc ?? "—"; $("v-spell-atk").textContent = c.atk != null ? fmt(c.atk) : "—";
  $("v-hp-max").textContent = c.hp;
  $("hp-current").value = character.hpCurrent == null ? c.hp : character.hpCurrent;
  $("hp-temp").value = character.hpTemp || 0;
  $("hp-modifier-input").value = character.hpModifier || "";
  $("ac-input").value = character.ac ?? "";
  $("ac-input").placeholder = c.equippedArmor?.bodyArmor ? `Auto: ${c.acAuto} (${c.equippedArmor.bodyArmor.name})` : c.ud ? `Auto: ${c.acAuto} (Unarmored Defense · ${ABILITY_NAMES[c.ud]}${c.udInfo?.label ? ` — ${c.udInfo.label}` : ""})` : `Auto: ${c.acAuto}`;
  $("speed-input").value = character.speed || "30 ft";
  renderUnarmoredDefense(c);
  renderSaves(c); renderSkills(c); renderIdentity(); renderAttacks(); renderProficiencies(); renderDeath(c);
  renderHitDiceTracker(); renderClassResources(); renderConditions(); renderBuffs(); renderExtraFeats(); renderDashboard();
  const active = document.querySelector(".tab.active")?.dataset.tab;
  if (active === "features") { renderCustomFeatures(); renderFeatures(); }
  if (active === "spells") renderSpells();
  if (active === "equipment" && eqCat === "inventory") { renderStartingEquipment(); renderCarryCapacity(); }
}
// Quando o personagem tem mais de uma Defesa sem Armadura (clássico
// Monge/Bárbaro), mostra qual está valendo e deixa trocar na mão — a
// regra manda escolher uma, e o padrão da ficha é a de maior CA.
function renderUnarmoredDefense(c) {
  const box = $("ud-note");
  if (!box) return;
  const opts = character.auto?.unarmoredDefenseOptions || [];
  if (!opts.length || c.equippedArmor?.bodyArmor) { box.innerHTML = ""; box.classList.add("hidden"); return; }
  box.classList.remove("hidden");
  const hasShield = !!c.equippedArmor?.shield;
  const line = (o) => `${ABILITY_NAMES[o.ability]} ${fmt(mod(effScore(o.ability)))} — ${o.label}${hasShield && !o.shieldOk ? " (não vale com escudo)" : ""}`;
  if (opts.length === 1) {
    const o = opts[0];
    box.innerHTML = hasShield && !o.shieldOk
      ? `<span class="ud-label">Defesa sem Armadura</span><span class="ud-off">${esc(line(o))} — desativada pelo escudo equipado.</span>`
      : `<span class="ud-label">Defesa sem Armadura</span><span>${esc(line(o))}</span>`;
    return;
  }
  box.innerHTML = `<span class="ud-label">Defesa sem Armadura</span>
    <select id="ud-choice" title="Você usa apenas uma Defesa sem Armadura; a ficha escolhe sozinha a de maior CA.">
      <option value="">Automático (maior CA)</option>
      ${opts.map((o) => `<option value="${o.ability}"${character.udChoice === o.ability ? " selected" : ""}${hasShield && !o.shieldOk ? " disabled" : ""}>${esc(line(o))}</option>`).join("")}
    </select>
    <span class="ud-active">Usando: <b>${c.ud ? esc(`${ABILITY_NAMES[c.ud]} ${fmt(mod(effScore(c.ud)))}`) : "—"}</b>${c.udInfo?.label ? ` (${esc(c.udInfo.label)})` : ""}</span>`;
  $("ud-choice")?.addEventListener("change", (e) => {
    character.udChoice = e.target.value || null;
    saveCharacter(character); recalc();
  });
}
function renderSaves(c) {
  $("save-list").innerHTML = ABILITIES.map((a) => {
    const ok = character.saveProficiencies.includes(a), am = mod(effScore(a)), v = am + (ok ? c.pb : 0);
    const formula = `${ABILITY_NAMES[a]} ${fmt(am)}${ok ? ` + proficiência ${fmt(c.pb)}` : ""} = ${fmt(v)}`;
    return `<div class="check-row"><label title="${esc(formula)}"><input type="checkbox" data-save="${a}" ${ok ? "checked" : ""}><span>${ABILITY_NAMES[a]}</span></label><button type="button" class="roll-badge" data-save-roll="${a}" title="${esc(formula)}">${fmt(v)}</button></div>`;
  }).join("");
  $("save-list").querySelectorAll("[data-save]").forEach((i) => i.addEventListener("change", () => {
    character.manualSaveProficiencies = character.manualSaveProficiencies || [];
    if (!(character.auto?.classSaves || []).includes(i.dataset.save)) toggleIn(character.manualSaveProficiencies, i.dataset.save, i.checked);
    toggleIn(character.saveProficiencies, i.dataset.save, i.checked || (character.auto?.classSaves || []).includes(i.dataset.save));
    saveCharacter(character); recalc();
  }));
  $("save-list").querySelectorAll("[data-save-roll]").forEach((b) => { b.title = D20_MODE_TITLE; b.addEventListener("click", (e) => {
    const a = b.dataset.saveRoll, ok = character.saveProficiencies.includes(a), bonus = mod(effScore(a)) + (ok ? c.pb : 0);
    const { rolls, roll, mode } = d20WithMode(e), total = roll + bonus;
    toast(`Resistência de ${ABILITY_NAMES[a]}: ${d20RollPlain(rolls, roll, mode)} ${fmt(bonus)} = ${total}`);
    broadcastRoll(`Resistência de ${ABILITY_NAMES[a]}`, `${d20RollPlain(rolls, roll, mode)} ${fmt(bonus)}`, total, { type: "resistencia" });
  }); });
}
function renderSkills(c) {
  $("skill-list").innerHTML = SKILLS.map(([k, n, a]) => {
    const p = character.skillProficiencies.includes(k), ex = character.skillExpertise.includes(k);
    const am = mod(effScore(a)), v = am + c.pb * (ex ? 2 : p ? 1 : 0);
    const formula = `${ABILITY_NAMES[a]} ${fmt(am)}${ex ? ` + especialização (2× prof. ${fmt(c.pb)})` : p ? ` + proficiência ${fmt(c.pb)}` : ""} = ${fmt(v)}`;
    return `<div class="skill-row"><label title="${esc(formula)}"><input type="checkbox" data-skill="${k}" ${p ? "checked" : ""}><span>${n}</span></label><button type="button" class="roll-badge" data-skill-roll="${k}" title="${esc(formula)}">${fmt(v)}</button>${ex ? '<small>EXP</small>' : ""}</div>`;
  }).join("");
  $("skill-list").querySelectorAll("[data-skill]").forEach((i) => i.addEventListener("change", () => {
    const k = i.dataset.skill;
    const auto = [...(character.auto?.classSkills || []), ...(character.auto?.backgroundSkills || []), ...Object.values(character.choiceSelections?.classSkills || {}).flat(), ...Object.values(character.choiceSelections?.backgroundSkills || {}).flat()];
    if (!auto.includes(k)) toggleIn(character.manualSkillProficiencies, k, i.checked);
    toggleIn(character.skillProficiencies, k, i.checked || auto.includes(k));
    saveCharacter(character); recalc();
  }));
  $("skill-list").querySelectorAll("[data-skill-roll]").forEach((b) => { b.title = D20_MODE_TITLE; b.addEventListener("click", (e) => {
    const k = b.dataset.skillRoll, [, n, a] = SKILLS.find((s) => s[0] === k);
    const p = character.skillProficiencies.includes(k), ex = character.skillExpertise.includes(k);
    const bonus = mod(effScore(a)) + c.pb * (ex ? 2 : p ? 1 : 0);
    const { rolls, roll, mode } = d20WithMode(e), total = roll + bonus;
    toast(`${n}: ${d20RollPlain(rolls, roll, mode)} ${fmt(bonus)} = ${total}`);
    broadcastRoll(n, `${d20RollPlain(rolls, roll, mode)} ${fmt(bonus)}`, total, { type: "pericia" });
  }); });
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
  const armorGrants = character.auto?.armorGrants || [];
  let armor = [...toLabels(sp.armor), ...toLabels(armorGrants)];
  let weapons = toLabels(sp.weapons);
  let tools = [...toLabels(sp.tools), ...flatObjects(br.toolProficiencies || []).flatMap((o) => Object.keys(o).filter((k) => o[k] === true)).map(cap)].filter(Boolean);
  let armorRaw = [...(sp.armor || []), ...armorGrants].map((x) => String(x).toLowerCase());
  // Multiclasse: tabela reduzida do PHB (multiclassing.proficienciesGained
  // de cada classe adicional) — bem menor que a proficiência de nível 1.
  for (const m of details.multiclasses || []) {
    const g = m.classRec?.multiclassing?.proficienciesGained || {};
    armor = [...armor, ...toLabels(g.armor)];
    weapons = [...weapons, ...toLabels(g.weapons)];
    tools = [...tools, ...toLabels(g.tools)];
    armorRaw = [...armorRaw, ...(g.armor || []).map((x) => String(x).toLowerCase())];
  }
  // Ferramentas/instrumentos que o banco não resolve sozinho (ex.: "um
  // instrumento musical à sua escolha") — o jogador preenche à mão e elas
  // entram na mesma lista exibida como Ferramentas.
  const manualTools = String(character.toolProficienciesManual || "").split(/[,;]/).map((s) => s.trim()).filter(Boolean);
  tools = [...tools, ...manualTools];
  armor = [...new Set(armor)]; weapons = [...new Set(weapons)]; tools = [...new Set(tools)]; armorRaw = [...new Set(armorRaw)];
  return { armor, weapons, tools, armorRaw, saves: character.auto?.classSaves || [] };
}
// Redimensiona/comprime a imagem escolhida (câmera do celular facilmente
// manda 4000×3000+) pra um quadrado de até 320px em JPEG, evitando inchar o
// localStorage — o personagem inteiro, com o retrato, precisa caber lá.
function resizeAvatar(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error);
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error("invalid image"));
      img.onload = () => {
        const size = 320;
        const side = Math.min(img.naturalWidth, img.naturalHeight) || 1;
        const sx = (img.naturalWidth - side) / 2, sy = (img.naturalHeight - side) / 2;
        const canvas = document.createElement("canvas");
        canvas.width = size; canvas.height = size;
        canvas.getContext("2d").drawImage(img, sx, sy, side, side, 0, 0, size, size);
        resolve(canvas.toDataURL("image/jpeg", 0.82));
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}
function renderAvatar() {
  const has = !!character.avatar;
  $("avatar-img").src = character.avatar || "";
  $("avatar-img").classList.toggle("hidden", !has);
  $("avatar-placeholder").classList.toggle("hidden", has);
  $("avatar-remove").classList.toggle("hidden", !has);
}
function renderProficiencies() {
  const { armor, weapons, tools, saves } = computeProficiencySummary();
  $("proficiency-editor").innerHTML = `
    <div class="identity-row"><span>Armaduras</span><strong>${armor.length ? esc(armor.join(", ")) : "—"}</strong></div>
    <div class="identity-row"><span>Armas</span><strong>${weapons.length ? esc(weapons.join(", ")) : "—"}</strong></div>
    <div class="identity-row"><span>Ferramentas</span><strong>${tools.length ? esc(tools.join(", ")) : "—"}</strong></div>
    <div class="identity-row"><span>Resistências</span><strong>${saves.map((a) => ABILITY_NAMES[a]).join(", ") || "—"}</strong></div>
    <div class="identity-row no-print"><span>+ Ferramenta/instrumento</span><input id="tools-manual" value="${esc(character.toolProficienciesManual || "")}" placeholder="Ex.: Ferramentas de ferreiro, Alaúde" title="Proficiências de ferramenta/instrumento que o banco não preenche sozinho (ex.: escolha livre de instrumento musical) — some à lista de Ferramentas acima"></div>
    <p class="muted">As perícias com proficiência automática aparecem marcadas na aba Ficha e não podem ser desmarcadas.</p>`;
  // Só re-renderiza no "change" (ao sair do campo) pra recalcular a linha
  // "Ferramentas" acima sem perder o foco/cursor a cada letra digitada.
  $("tools-manual").addEventListener("input", (e) => { character.toolProficienciesManual = e.target.value; saveCharacter(character); });
  $("tools-manual").addEventListener("change", () => renderProficiencies());
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
// ------------------------------------------------------------
// Rolagens de d20 com vantagem/desvantagem — qualquer botão de rolar
// d20 (ataque, resistência, perícia, testes de monstro) aceita segurar
// Shift (vantagem) ou Ctrl (desvantagem) no clique; os dois juntos se
// cancelam, como na regra. Cada botão que usa isso ganha um title
// explicando o atalho.
// ------------------------------------------------------------
function d20WithMode(e) {
  const adv = !!e?.shiftKey, dis = !!e?.ctrlKey;
  if (adv !== dis) {
    const rolls = [rollDie(20), rollDie(20)];
    const roll = adv ? Math.max(...rolls) : Math.min(...rolls);
    return { rolls, roll, mode: adv ? "adv" : "dis" };
  }
  const roll = rollDie(20);
  return { rolls: [roll], roll, mode: "normal" };
}
function d20RollHtml(rolls, roll, mode, cls = "") {
  const picked = `<b class="${cls}">${roll}</b>`;
  if (mode === "normal") return `d20 (${picked})`;
  const label = mode === "adv" ? "vantagem" : "desvantagem";
  return `2d20 ${label} (${rolls.map((r) => r === roll ? picked : r).join(", ")})`;
}
function d20RollPlain(rolls, roll, mode) {
  if (mode === "normal") return `d20 (${roll})`;
  return `2d20 ${mode === "adv" ? "vantagem" : "desvantagem"} [${rolls.join(", ")}] → ${roll}`;
}
const D20_MODE_TITLE = "Clique: normal · Shift: vantagem · Ctrl: desvantagem";
// Dano crítico (segurar Shift ao clicar): dobra a quantidade de dados
// rolados, sem dobrar o bônus fixo — regra padrão de crítico do 5e.
function rollDamageWithMode(n, faces, e) {
  const crit = !!e?.shiftKey;
  const { rolls, total } = rollDice(crit ? n * 2 : n, faces);
  return { rolls, total, crit };
}
const DAMAGE_MODE_TITLE = "Clique: normal · Shift: dano crítico (dobra os dados)";
// ------------------------------------------------------------
// Ataques — cálculo automático (atributo + proficiência + item)
// ------------------------------------------------------------
const ATTACK_ABILITY_LABEL = { str: "Força (corpo a corpo)", dex: "Destreza (à distância/leve)", spell: "Conjuração", manual: "Manual" };
// Tipos de dano padrão do 5e (regra 2014/2024), pra virar dropdown em vez de
// texto livre digitado junto com a rolagem de dano.
const DAMAGE_TYPES = ["Ácido", "Contundente", "Cortante", "Fogo", "Força", "Frio", "Necrótico", "Perfurante", "Psíquico", "Radiante", "Relâmpago", "Trovejante", "Veneno"];
function parseBonusText(s) { const n = parseInt(String(s ?? "").replace(/[^\d-]/g, ""), 10); return Number.isFinite(n) ? n : 0; }
// Ataques antigos guardavam o dano como um texto livre único (ex.: "1d8+1
// esmagamento"). Agora cada ataque tem uma lista de "partes" de dano
// (dado + bônus + tipo em campos separados, como no Foundry) — útil pra
// armas/magias com mais de um tipo de dano na mesma rolagem (ex.: espada
// flamejante: 1d8 cortante + 1d6 fogo). attackDamageParts() devolve sempre
// pelo menos uma parte (migrando o texto livre antigo na primeira leitura,
// já persistido por normalizeCharacter — ver ali) pra a UI ter o que
// desenhar mesmo num ataque recém-criado.
function attackDamageParts(a) {
  if (Array.isArray(a.damageParts) && a.damageParts.length) return a.damageParts;
  return [{ dice: "", bonus: 0, type: "" }];
}
function migrateDamageParts(a) {
  if (Array.isArray(a?.damageParts) && a.damageParts.length) return a.damageParts;
  const text = String(a?.damage ?? "").trim();
  if (!text) return [{ dice: "", bonus: 0, type: "" }];
  const parsed = parseDiceExpr(text);
  const stripDiacritics = (s) => s.normalize("NFD").replace(/\p{M}/gu, "");
  const plainText = stripDiacritics(text);
  const type = DAMAGE_TYPES.find((t) => new RegExp(stripDiacritics(t), "i").test(plainText));
  return [{ dice: parsed ? `${parsed.n}d${parsed.faces}` : "", bonus: parsed ? parsed.bonus : 0, type: type || "" }];
}
function damagePartText(p) {
  const dice = String(p?.dice || "").trim();
  const bonus = Number(p?.bonus) || 0;
  const txt = `${dice}${bonus ? fmt(bonus) : ""}`.trim();
  if (!txt) return "";
  return `${txt}${p?.type ? " " + p.type.toLowerCase() : ""}`;
}
function attackDamageSummary(a) {
  return attackDamageParts(a).map(damagePartText).filter(Boolean).join(" + ") || "—";
}
function attackAbilityMod(a) {
  const m = a.abilityMode || "str";
  if (m === "dex") return mod(effScore("dex"));
  if (m === "spell") { const sa = character.spellAbility || spellAbilityFrom(classInfo()); return sa ? mod(effScore(sa)) : 0; }
  if (m === "manual") return null;
  return mod(effScore("str"));
}
function computeAttackBonus(a) {
  if ((a.abilityMode || "str") === "manual") return parseBonusText(a.bonus);
  return (attackAbilityMod(a) || 0) + (a.proficient ? proficiency(totalLevel()) : 0) + (Number(a.itemBonus) || 0);
}
// CD de resistência do ataque, pra armas/magias que exigem um teste de
// resistência do alvo em vez de uma rolagem de ataque (ex.: sopro de
// dragão, algumas magias de dano). No modo manual o campo de bônus já
// guarda a CD final digitada à mão, em vez de um bônus somado a 8.
function attackDc(a) {
  if ((a.abilityMode || "str") === "manual") return parseBonusText(a.bonus);
  return 8 + computeAttackBonus(a);
}
function attackTotalLabel(a) {
  return a.rollType === "save" ? `CD ${attackDc(a)}` : fmt(computeAttackBonus(a));
}
let attackRollMessages = {};
function damageTypeSelectHtml(attr, current) {
  return `<select ${attr} title="Tipo de dano"><option value=""${current ? "" : " selected"}>Tipo de dano —</option>${DAMAGE_TYPES.map((t) =>
    `<option value="${esc(t)}"${t === current ? " selected" : ""}>${esc(t)}</option>`).join("")}</select>`;
}
function attackDamagePartsHtml(i, parts) {
  return `<div class="attack-damage-parts no-print">
    ${parts.map((p, pi) => `<div class="dmg-part-row">
      <input data-dmg-dice="${i}:${pi}" value="${esc(p.dice || "")}" placeholder="Dado (ex.: 1d8)" title="Expressão de dado, ex.: 1d8 ou 2d6">
      <input type="number" data-dmg-bonus="${i}:${pi}" value="${Number(p.bonus) || 0}" title="Bônus fixo somado a esta parte do dano (além do atributo/item, que já entram na 1ª parte)">
      ${damageTypeSelectHtml(`data-dmg-type="${i}:${pi}"`, p.type || "")}
      ${parts.length > 1 ? `<button type="button" class="remove-btn" data-dmg-remove="${i}:${pi}" title="Remover esta parte do dano">×</button>` : `<span></span>`}
    </div>`).join("")}
    <button type="button" class="add-dmg-part" data-add-dmg="${i}">+ Tipo de dano extra (ex.: arma flamejante)</button>
  </div>`;
}
function renderAttacks() {
  const arr = character.attacks || [];
  $("attacks").innerHTML = arr.length ? arr.map((a, i) => {
    const manual = (a.abilityMode || "str") === "manual";
    const isSave = a.rollType === "save";
    // Ataque já configurado não precisa mostrar os campos de edição toda
    // vez — "fechar edição" esconde tudo que não é preciso durante o jogo
    // (fica só nome/dano/bônus/notas/rolagem), sem apagar nada.
    const collapsed = !!a.collapsed;
    return `<div class="attack-card${collapsed ? " collapsed" : ""}" data-attack-idx="${i}">
      <div class="attack-card-top">
        <input data-a="name" data-i="${i}" value="${esc(a.name || "")}" placeholder="Nome (ex.: Espada Longa)">
        <div class="attack-total dmg-summary" data-attack-dmg-summary="${i}" title="Dano — edite as partes abaixo">${esc(attackDamageSummary(a))}</div>
        <div class="attack-total" data-attack-total="${i}" title="${isSave ? "CD de resistência calculada (8 + atributo + proficiência + bônus de item)" : "Bônus de ataque calculado (atributo + proficiência + bônus de item)"}">${esc(attackTotalLabel(a))}</div>
        <input data-a="notes" data-i="${i}" value="${esc(a.notes || "")}" placeholder="Notas">
        <button class="remove-btn no-print" data-remove-attack="${i}" title="Remover ataque">×</button>
      </div>
      <div class="attack-card-controls no-print">
        <select data-a-rolltype="${i}" title="Ataque: rolagem de d20 contra a CA. CD de Resistência: o alvo é quem rola (ex.: sopro de dragão, magias de dano com resistência)">
          <option value="attack"${isSave ? "" : " selected"}>🎯 Ataque</option>
          <option value="save"${isSave ? " selected" : ""}>🛡 CD de Resistência</option>
        </select>
        <select data-a-mode="${i}" title="Atributo usado no bônus/CD e na 1ª parte do dano">${Object.entries(ATTACK_ABILITY_LABEL).map(([k, l]) => `<option value="${k}"${(a.abilityMode || "str") === k ? " selected" : ""}>${esc(l)}</option>`).join("")}</select>
        <label title="Soma a proficiência (metade dos ataques costuma ser proficiente)"><input type="checkbox" data-a-prof="${i}" ${a.proficient ? "checked" : ""}> Proficiente</label>
        <input type="number" data-a-item="${i}" value="${Number(a.itemBonus) || 0}" placeholder="Bônus item" title="Bônus de item mágico (ex.: +1), somado no ataque/CD e na 1ª parte do dano">
        <input data-a="bonus" data-i="${i}" value="${esc(a.bonus || "")}" placeholder="${manual && isSave ? "CD manual" : "Bônus manual"}" title="${manual ? (isSave ? "CD final digitada à mão (modo Manual)" : "Bônus de ataque digitado à mão (modo Manual)") : "Só é usado no modo Manual — escolha \"Manual\" no campo de atributo ao lado pra habilitar"}" ${manual ? "" : "disabled"}>
        <input data-a="range" data-i="${i}" value="${esc(a.range || "")}" placeholder="Distância (ex.: 9m/18m)" title="Alcance da arma/magia (curto/longo, se houver)">
      </div>
      ${attackDamagePartsHtml(i, attackDamageParts(a))}
      <div class="attack-roll-row no-print">
        ${isSave ? "" : `<button type="button" data-roll-attack="${i}" title="${D20_MODE_TITLE}">🎲 Rolar Ataque</button>`}
        <button type="button" data-roll-damage="${i}" title="${DAMAGE_MODE_TITLE}">🎲 Rolar Dano</button>
        <button type="button" class="toggle-edit-btn" data-toggle-edit="${i}" title="${collapsed ? "Reabrir os campos de edição deste ataque" : "Esconder os campos de edição — os dados continuam salvos"}">${collapsed ? "✎ Editar" : "✓ Concluir edição"}</button>
        <span class="attack-roll-result" id="attack-result-${i}">${attackRollMessages[i] || ""}</span>
      </div>
    </div>`;
  }).join("") : `<div class="empty">Nenhum ataque adicionado.</div>`;
  // Reconstruir o innerHTML inteiro a cada tecla digitada destrói e recria
  // o próprio campo focado (perde o foco/cursor a cada letra) e junto todo
  // o resto do card, inclusive a checkbox "Proficiente" — por isso ela
  // parecia "desmarcar sozinha" ao digitar. Só "bonus" (manual) afeta o
  // total exibido, então só ele precisa atualizar algo após o input — e
  // atualiza só o <div class="attack-total">, sem re-renderizar a lista.
  const updateAttackTotal = (idx) => {
    const el = $("attacks").querySelector(`[data-attack-total="${idx}"]`);
    if (el) el.textContent = attackTotalLabel(character.attacks[idx]);
  };
  const updateDamageSummary = (idx) => {
    const el = $("attacks").querySelector(`[data-attack-dmg-summary="${idx}"]`);
    if (el) el.textContent = attackDamageSummary(character.attacks[idx]);
  };
  $("attacks").querySelectorAll("[data-a]").forEach((i) => i.addEventListener("input", () => {
    const idx = Number(i.dataset.i);
    character.attacks[idx][i.dataset.a] = i.value;
    saveCharacter(character);
    if (i.dataset.a === "bonus") updateAttackTotal(idx);
  }));
  $("attacks").querySelectorAll("[data-a-rolltype]").forEach((s) => s.addEventListener("change", () => {
    character.attacks[Number(s.dataset.aRolltype)].rollType = s.value; saveCharacter(character); renderAttacks();
  }));
  $("attacks").querySelectorAll("[data-a-mode]").forEach((s) => s.addEventListener("change", () => {
    character.attacks[Number(s.dataset.aMode)].abilityMode = s.value; saveCharacter(character); renderAttacks();
  }));
  $("attacks").querySelectorAll("[data-a-prof]").forEach((c) => c.addEventListener("change", () => {
    character.attacks[Number(c.dataset.aProf)].proficient = c.checked; saveCharacter(character); renderAttacks();
  }));
  $("attacks").querySelectorAll("[data-a-item]").forEach((n) => n.addEventListener("input", () => {
    const idx = Number(n.dataset.aItem);
    character.attacks[idx].itemBonus = Number(n.value) || 0;
    saveCharacter(character);
    updateAttackTotal(idx);
  }));
  $("attacks").querySelectorAll("[data-remove-attack]").forEach((b) => b.addEventListener("click", () => {
    delete attackRollMessages[Number(b.dataset.removeAttack)];
    character.attacks.splice(Number(b.dataset.removeAttack), 1); saveCharacter(character); renderAttacks();
  }));
  $("attacks").querySelectorAll("[data-toggle-edit]").forEach((b) => b.addEventListener("click", () => {
    const idx = Number(b.dataset.toggleEdit);
    character.attacks[idx].collapsed = !character.attacks[idx].collapsed;
    saveCharacter(character); renderAttacks();
  }));
  $("attacks").querySelectorAll("[data-dmg-dice]").forEach((n) => n.addEventListener("input", () => {
    const [i, pi] = n.dataset.dmgDice.split(":").map(Number);
    attackDamageParts(character.attacks[i])[pi].dice = n.value;
    character.attacks[i].damageParts = attackDamageParts(character.attacks[i]);
    saveCharacter(character);
    updateDamageSummary(i);
  }));
  $("attacks").querySelectorAll("[data-dmg-bonus]").forEach((n) => n.addEventListener("input", () => {
    const [i, pi] = n.dataset.dmgBonus.split(":").map(Number);
    attackDamageParts(character.attacks[i])[pi].bonus = Number(n.value) || 0;
    character.attacks[i].damageParts = attackDamageParts(character.attacks[i]);
    saveCharacter(character);
    updateDamageSummary(i);
  }));
  $("attacks").querySelectorAll("[data-dmg-type]").forEach((s) => s.addEventListener("change", () => {
    const [i, pi] = s.dataset.dmgType.split(":").map(Number);
    attackDamageParts(character.attacks[i])[pi].type = s.value;
    character.attacks[i].damageParts = attackDamageParts(character.attacks[i]);
    saveCharacter(character);
    updateDamageSummary(i);
  }));
  $("attacks").querySelectorAll("[data-dmg-remove]").forEach((b) => b.addEventListener("click", () => {
    const [i, pi] = b.dataset.dmgRemove.split(":").map(Number);
    const parts = attackDamageParts(character.attacks[i]);
    parts.splice(pi, 1);
    character.attacks[i].damageParts = parts.length ? parts : [{ dice: "", bonus: 0, type: "" }];
    saveCharacter(character); renderAttacks();
  }));
  $("attacks").querySelectorAll("[data-add-dmg]").forEach((b) => b.addEventListener("click", () => {
    const i = Number(b.dataset.addDmg);
    const parts = attackDamageParts(character.attacks[i]);
    parts.push({ dice: "", bonus: 0, type: "" });
    character.attacks[i].damageParts = parts;
    saveCharacter(character); renderAttacks();
  }));
  $("attacks").querySelectorAll("[data-roll-attack]").forEach((b) => b.addEventListener("click", (e) => {
    const i = Number(b.dataset.rollAttack), a = character.attacks[i];
    const { rolls, roll, mode } = d20WithMode(e);
    const bonus = computeAttackBonus(a), total = roll + bonus;
    const cls = roll === 20 ? "crit" : roll === 1 ? "fumble" : "";
    const note = roll === 20 ? " — CRÍTICO!" : roll === 1 ? " — falha crítica" : "";
    attackRollMessages[i] = `${d20RollHtml(rolls, roll, mode, cls)} ${fmt(bonus)} = <b>${total}</b>${note}`;
    $(`attack-result-${i}`).innerHTML = attackRollMessages[i];
    broadcastRoll(`Ataque — ${a.name || "arma sem nome"}`, `${d20RollPlain(rolls, roll, mode)} ${fmt(bonus)}`, total, { type: "ataque", note });
  }));
  $("attacks").querySelectorAll("[data-roll-damage]").forEach((b) => b.addEventListener("click", (e) => {
    const i = Number(b.dataset.rollDamage), a = character.attacks[i];
    const parts = attackDamageParts(a).filter((p) => parseDiceExpr(p.dice));
    if (!parts.length) { toast('Preencha um dado de dano, ex.: "1d8".'); return; }
    const crit = !!e.shiftKey;
    let total = 0;
    const segs = parts.map((p, pi) => {
      const parsed = parseDiceExpr(p.dice);
      const { rolls, total: diceTotal } = rollDice(crit ? parsed.n * 2 : parsed.n, parsed.faces);
      let extra = (Number(p.bonus) || 0) + (parsed.bonus || 0);
      if (pi === 0 && (a.abilityMode || "str") !== "manual") extra += (attackAbilityMod(a) || 0) + (Number(a.itemBonus) || 0);
      const segTotal = diceTotal + extra;
      total += segTotal;
      return `${rolls.length}d${parsed.faces} (${rolls.join("+")}) ${fmt(extra)}${p.type ? " " + esc(p.type.toLowerCase()) : ""} = ${segTotal}`;
    });
    const note = crit ? " — CRÍTICO" : "";
    attackRollMessages[i] = `${segs.join(" + ")} = <b>${total}</b>${note}`;
    $(`attack-result-${i}`).innerHTML = attackRollMessages[i];
    broadcastRoll(`Dano — ${a.name || "arma sem nome"}`, segs.join(" + "), total, { type: "dano", note });
  }));
}
// Algumas raças/classes homebrew concedem uma escolha narrativa dentro do
// próprio texto do traço — uma lista embutida ("Deformações" do Lefou,
// invocações/dons variados de outras raças homebrew) sem usar o esquema
// estruturado (feats/optionalfeatureProgression) que o resto da automação
// entende. Em vez de travar nessas raças, detecta genericamente qualquer
// lista (`type: "list"`) dentro do traço e deixa o jogador marcar quais já
// escolheu — sem limite fixo (o texto da própria característica costuma
// dizer o máximo), inclusive marcando mais conforme o personagem evolui.
function findEntryList(entries) {
  const arr = Array.isArray(entries) ? entries : (entries != null ? [entries] : []);
  for (const e of arr) {
    if (!e || typeof e !== "object") continue;
    if (e.type === "list" && Array.isArray(e.items) && e.items.some((it) => it && typeof it === "object" && it.name)) return e;
    if (Array.isArray(e.entries)) { const found = findEntryList(e.entries); if (found) return found; }
  }
  return null;
}
function traitPickKey(sourceId, traitName) { return `${sourceId || ""}::${traitName}`; }
// As opções de uma trait-pick-list vêm direto do texto da fonte (ver
// findEntryList acima), sem id estável — só o nome mesmo. Toda vez que o
// banco é resincronizado (sync-data.mjs) ou alguém edita um homebrew à mão,
// pequenos ajustes de texto (pontuação, "(requires Xº nível)", maiúsculas)
// mudam o nome exato e desmarcam escolhas que já estavam salvas na ficha.
// Comparar por um nome normalizado (sem parênteses/pontuação/caixa) deixa
// esses reajustes cosméticos não quebrarem fichas existentes.
function normalizeTraitPickName(name) {
  return String(name || "")
    .replace(/\([^)]*\)/g, " ")
    .replace(/[.,;:!?]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}
// A maior parte das listas de escolha narrativa (ver findEntryList acima)
// fica só de olho — texto pra lembrete, sem efeito mecânico, do mesmo jeito
// que o app trata escolhas oficiais equivalentes (ex.: as opções de
// Celestial Revelation do Assimar 2024 também são só texto + checkbox por
// aqui). As Deformações do Lefou são a exceção: como o jogador pediu pra
// elas realmente mexerem na ficha, mapeamos as que têm efeito numérico
// simples (perícia, CA, deslocamento) pros campos automáticos de verdade —
// as situacionais (dano reativo, chance de anular crítico, braços extras
// etc.) continuam só descritivas, que nem qualquer outro traço homebrew.
const LEFOU_DEFORMATION_BONUSES = {
  "Insectoid Eyes.": { skills: ["perception"] },
  "Flexible Joints.": { skills: ["acrobatics"] },
  "Carapace.": { ac: 1 },
  "Membranous Hands.": { speedTypes: ["natação"] },
  "Rigid Fingers.": { speedTypes: ["escalada"] },
};
const LEFOU_DEFORMATION_BONUSES_BY_NORM = Object.fromEntries(
  Object.entries(LEFOU_DEFORMATION_BONUSES).map(([name, b]) => [normalizeTraitPickName(name), b])
);
function isLefouRace(rr) { return !!rr && String(rr.source || "").toLowerCase() === "lefou" && String(rr.name || "").toLowerCase() === "lefou"; }
function lefouDeformationPicks(rr) {
  if (!isLefouRace(rr)) return [];
  const key = traitPickKey(refs.race?.id, "Deformations");
  return character.choiceSelections?.traitPicks?.[key] || [];
}
function lefouDeformationBonuses(rr) {
  const picks = lefouDeformationPicks(rr);
  const skills = [], speedTypes = [];
  let ac = 0;
  for (const name of picks) {
    const b = LEFOU_DEFORMATION_BONUSES[name] || LEFOU_DEFORMATION_BONUSES_BY_NORM[normalizeTraitPickName(name)];
    if (!b) continue;
    if (b.skills) skills.push(...b.skills);
    if (b.speedTypes) speedTypes.push(...b.speedTypes);
    if (b.ac) ac += b.ac;
  }
  return { skills: [...new Set(skills)], speedTypes: [...new Set(speedTypes)], ac };
}
function traitPickListHtml(sourceId, traitName, list) {
  const key = traitPickKey(sourceId, traitName);
  const picked = character.choiceSelections?.traitPicks?.[key] || [];
  const pickedNorm = picked.map(normalizeTraitPickName);
  const items = list.items.filter((it) => it && typeof it === "object" && it.name);
  return `<div class="trait-pick-list" data-trait-pick-key="${esc(key)}">
    <p class="muted">Marque quais você já escolheu — dá pra marcar mais depois, conforme o personagem evolui (o texto acima diz o máximo permitido).</p>
    ${items.map((it) => {
      const on = pickedNorm.includes(normalizeTraitPickName(it.name));
      const desc = esc(inlineTags(plainOf(it.entry || it.entries || "")));
      return `<label class="trait-pick-option${on ? " on" : ""}"><input type="checkbox" data-trait-pick="${esc(key)}" data-trait-pick-value="${esc(it.name)}" ${on ? "checked" : ""}><span><strong>${esc(inlineTags(it.name))}</strong>${desc ? ` ${desc}` : ""}</span></label>`;
    }).join("")}
    ${picked.length ? `<div class="trait-pick-count">${picked.length} escolhida(s)</div>` : ""}
  </div>`;
}
// Traço/item homebrew cadastrado à mão — pra quando o mestre/jogador tem
// algo de casa que não está (ainda) no banco sincronizado. Fica só nesta
// ficha (não editando o banco), mas aparece junto das outras
// características (ver grupo "HOMEBREW / CASA" em renderFeatures) e sai
// também na ficha em PDF.
function renderCustomFeatures() {
  const box = $("custom-feature-list");
  if (!box) return;
  const list = character.customFeatures || [];
  box.innerHTML = list.length ? list.map((f) => `<article class="custom-feature-row" data-custom-feature-id="${esc(f.id)}">
      <div><b>${esc(f.name || "Sem nome")}</b>${(f.entries || []).map((t) => `<p>${esc(t)}</p>`).join("")}</div>
      <button type="button" class="remove-btn" data-remove-custom-feature="${esc(f.id)}" title="Remover">×</button>
    </article>`).join("") : `<p class="muted">Nenhum item homebrew cadastrado ainda.</p>`;
  box.querySelectorAll("[data-remove-custom-feature]").forEach((b) => b.addEventListener("click", () => {
    character.customFeatures = (character.customFeatures || []).filter((f) => f.id !== b.dataset.removeCustomFeature);
    saveCharacter(character); renderCustomFeatures(); renderFeatures();
  }));
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
    if (f.length) groups.push(["ESPÉCIE / RAÇA", f.map((x, i) => ({ name: x.name || `Traço ${i + 1}`, entries: x.entries || x, pickSource: refs.race?.id }))]);
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
  // Traços/itens homebrew cadastrados à mão (não vêm do banco sincronizado)
  // — mesma vitrine das características oficiais, só num grupo à parte.
  if (character.customFeatures?.length) {
    groups.push(["HOMEBREW / CASA", character.customFeatures.map((f) => ({ name: f.name, level: "Casa", entries: f.entries }))]);
  }
  const lvlLabel = (v) => (v == null || v === "") ? "—" : (typeof v === "number" || /^\d/.test(String(v))) ? `Nível ${esc(v)}` : esc(v);
  box.innerHTML = groups.filter((g) => g[1]?.length).map(([name, arr]) =>
    `<section class="feature-group"><h3>${name}</h3>${arr.map((f) => {
      const pickList = f.pickSource && f.entries ? findEntryList(f.entries) : null;
      const body = f.entries ? richText(f.entries) : "<p class='muted'>Sem texto no banco para esta característica.</p>";
      return `<article class="feature"><div><b>${esc(f.name || "Característica")}</b><span>${lvlLabel(f.level)}</span></div><div>${body}${pickList ? traitPickListHtml(f.pickSource, f.name, pickList) : ""}</div></article>`;
    }).join("")}</section>`
  ).join("") || `<div class="empty">Escolha uma classe/espécie para carregar as características.</div>`;
  box.querySelectorAll("[data-trait-pick]").forEach((i) => i.addEventListener("change", () => {
    const key = i.dataset.traitPick, v = i.dataset.traitPickValue;
    character.choiceSelections.traitPicks = character.choiceSelections.traitPicks || {};
    const cur = character.choiceSelections.traitPicks[key] || [];
    // Remove qualquer entrada equivalente pelo nome normalizado (ex.: uma
    // versão antiga do nome salva antes de um reajuste de texto na fonte)
    // antes de aplicar a marcação atual, pra não duplicar nem deixar lixo.
    const norm = normalizeTraitPickName(v);
    for (let idx = cur.length - 1; idx >= 0; idx--) {
      if (normalizeTraitPickName(cur[idx]) === norm) cur.splice(idx, 1);
    }
    if (i.checked) cur.push(v);
    character.choiceSelections.traitPicks[key] = cur;
    saveCharacter(character);
    // recalc() (não só renderFeatures()) porque algumas escolhas têm efeito
    // mecânico de verdade agora (ver LEFOU_DEFORMATION_BONUSES) — precisa
    // recalcular perícias/CA/deslocamento, não só re-renderizar a lista.
    recalc();
  }));
}

// ------------------------------------------------------------
// Magias — recursos de conjuração (espaços, truques, preparadas)
// ------------------------------------------------------------
const CASTER_LABEL = { full: "Conjurador completo", "1/2": "Meio-conjurador", half: "Meio-conjurador", artificer: "Conjuração de artífice", "1/3": "Um terço de conjurador", third: "Um terço de conjurador", pact: "Magia de pacto" };
// Lê uma coluna nomeada de um conjunto de "table groups" no formato do
// 5etools (colLabels + rows) — reaproveitado tanto pra tabela da classe
// (classTableGroups: truques/preparadas do 2024 e homebrew sem fórmula)
// quanto pra tabela da subclasse (subclassTableGroups: Dados de
// Superioridade do Combatente Mestre de Batalha etc.) pelo rastreador
// de recursos de classe.
function tableColGroups(groups, level, labelRe) {
  for (const g of groups || []) {
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
function tableCol(rec, level, labelRe) { return tableColGroups(rec?.classTableGroups, level, labelRe); }

// ------------------------------------------------------------
// Recursos de classe (Fúria, Pontos de Ki, Feitiçaria, Inspiração de
// Bardo, Canalizar Divindade, Dados de Superioridade, Forma Selvagem…)
// — detectados genericamente nas colunas da tabela da classe/subclasse
// (ver CLASS_RESOURCE_COLUMNS em rules.js), pra funcionar com qualquer
// classe oficial ou homebrew sem precisar de dados escritos à mão.
function classResourceSources() {
  const out = [];
  if (refs.class) out.push({ key: "primary", label: titleOf(refs.class), cr: details.classRec, sr: details.subclassRec, level: Math.max(1, Number(character.level) || 1) });
  (details.multiclasses || []).forEach((m, i) => {
    if (m.classEntry) out.push({ key: `mc${i}`, label: titleOf(m.classEntry), cr: m.classRec, sr: m.subclassRec, level: Math.max(1, Number(m.level) || 1) });
  });
  return out;
}
function computeClassResources() {
  const out = [];
  const seen = new Set();
  for (const src of classResourceSources()) {
    for (const def of CLASS_RESOURCE_COLUMNS) {
      let max = tableColGroups(src.cr?.classTableGroups, src.level, def.re);
      if (max == null) max = tableColGroups(src.sr?.subclassTableGroups, src.level, def.re);
      if (max == null || max <= 0) continue;
      const id = `${src.key}:${def.key}`;
      if (seen.has(id)) continue;
      seen.add(id);
      out.push({ id, key: def.key, label: def.label, classLabel: src.label, rest: def.rest, max, turnAction: def.turnAction });
    }
  }
  return out;
}
function resourceUsed(id) { return Math.max(0, Number(character.resourceUsage?.[id]) || 0); }
function setResourceUsed(id, n, max) { character.resourceUsage = character.resourceUsage || {}; character.resourceUsage[id] = Math.max(0, Math.min(max, n)); }
function renderClassResources() {
  const box = $("class-resources");
  if (!box) return;
  const list = computeClassResources();
  if (!list.length) { box.innerHTML = ""; return; }
  box.innerHTML = list.map((r) => {
    const used = Math.min(r.max, resourceUsed(r.id));
    const avail = r.max - used;
    const pips = Array.from({ length: r.max }, (_, i) => `<span class="resource-pip${i < used ? " used" : ""}" data-res-pip="${esc(r.id)}:${i}" title="${esc(r.label)} ${i + 1}"></span>`).join("");
    const restLabel = r.rest === "short" ? "descanso curto ou longo" : "descanso longo";
    return `<div class="resource-card"><div class="resource-head"><b>${esc(r.label)} — ${esc(r.classLabel)}</b><small>Recupera em ${restLabel}</small></div>
      <div class="resource-pips">${pips}</div>
      <div class="resource-actions">
        <button type="button" data-res-use="${esc(r.id)}" data-res-max="${r.max}">− Usar</button>
        <span class="resource-count${avail === 0 ? " zero" : ""}">${avail}/${r.max}</span>
        <button type="button" data-res-restore="${esc(r.id)}">+ Recuperar</button>
        <button type="button" class="reset-btn" data-res-reset="${esc(r.id)}">🔄 Reset</button>
      </div></div>`;
  }).join("");
  box.querySelectorAll("[data-res-pip]").forEach((p) => p.addEventListener("click", () => {
    const [id, idx] = p.dataset.resPip.split(":");
    const r = list.find((x) => x.id === id);
    const i = Number(idx), used = Math.min(r.max, resourceUsed(id));
    setResourceUsed(id, i < used ? i : i + 1, r.max);
    saveCharacter(character); renderClassResources(); renderDashboard();
  }));
  box.querySelectorAll("[data-res-use]").forEach((b) => b.addEventListener("click", () => {
    const id = b.dataset.resUse, max = Number(b.dataset.resMax) || 0;
    setResourceUsed(id, resourceUsed(id) + 1, max);
    saveCharacter(character); renderClassResources(); renderDashboard();
  }));
  box.querySelectorAll("[data-res-restore]").forEach((b) => b.addEventListener("click", () => {
    const id = b.dataset.resRestore, r = list.find((x) => x.id === id);
    setResourceUsed(id, resourceUsed(id) - 1, r.max);
    saveCharacter(character); renderClassResources(); renderDashboard();
  }));
  box.querySelectorAll("[data-res-reset]").forEach((b) => b.addEventListener("click", () => {
    setResourceUsed(b.dataset.resReset, 0, 999);
    saveCharacter(character); renderClassResources(); renderDashboard();
  }));
}
// Fontes de dado de vida (classe primária + cada classe de multiclasse),
// cada uma com seu próprio tipo de dado e nº de usos = nível da classe.
function hitDiceSources() {
  const out = [{ key: "primary", die: Number(character.auto?.hitDice || hitDiceFrom(classInfo()) || 8) || 8, count: Math.max(1, Number(character.level) || 1), label: refs.class ? titleOf(refs.class) : "Classe" }];
  (details.multiclasses || []).forEach((m, i) => {
    if (m.classEntry) out.push({ key: `mc${i}`, die: Number(hitDiceFrom(m.classRec) || 8) || 8, count: Math.max(1, Number(m.level) || 1), label: titleOf(m.classEntry) });
  });
  return out;
}
let hdRollMessages = {};
function renderHitDiceTracker() {
  const box = $("hit-dice-tracker");
  if (!box || !refs.class) { if (box) box.innerHTML = ""; return; }
  const sources = hitDiceSources();
  box.innerHTML = sources.map((s) => {
    const used = Math.min(s.count, Math.max(0, Number(character.hitDiceUsed?.[s.key]) || 0));
    const avail = s.count - used;
    const pips = Array.from({ length: s.count }, (_, i) => `<span class="resource-pip${i < used ? " used" : ""}" data-hd-pip="${s.key}:${i}" title="Dado de vida ${i + 1}"></span>`).join("");
    return `<div class="resource-card"><div class="resource-head"><b>Dados de Vida — ${esc(s.label)} (d${s.die})</b><small>${avail}/${s.count} disponíveis</small></div>
      <div class="resource-pips">${pips}</div>
      <div class="resource-actions">
        <button type="button" data-hd-dec="${s.key}">+ Recuperar</button>
        <button type="button" data-hd-use="${s.key}" data-hd-die="${s.die}">🎲 Usar dado de vida</button>
        <button type="button" class="reset-btn" data-hd-reset="${s.key}" data-hd-count="${s.count}">🔄 Descanso longo</button>
      </div>
      ${hdRollMessages[s.key] ? `<div class="hit-dice-roll-result">${hdRollMessages[s.key]}</div>` : ""}
    </div>`;
  }).join("");
  box.querySelectorAll("[data-hd-pip]").forEach((p) => p.addEventListener("click", () => {
    const [key, idx] = p.dataset.hdPip.split(":");
    const s = sources.find((x) => x.key === key);
    const i = Number(idx), used = Math.min(s.count, Math.max(0, Number(character.hitDiceUsed?.[key]) || 0));
    character.hitDiceUsed = character.hitDiceUsed || {};
    character.hitDiceUsed[key] = Math.max(0, Math.min(s.count, i < used ? i : i + 1));
    saveCharacter(character); renderHitDiceTracker(); renderDashboard();
  }));
  box.querySelectorAll("[data-hd-dec]").forEach((b) => b.addEventListener("click", () => {
    const key = b.dataset.hdDec;
    character.hitDiceUsed = character.hitDiceUsed || {};
    character.hitDiceUsed[key] = Math.max(0, (Number(character.hitDiceUsed[key]) || 0) - 1);
    saveCharacter(character); renderHitDiceTracker(); renderDashboard();
  }));
  box.querySelectorAll("[data-hd-reset]").forEach((b) => b.addEventListener("click", () => {
    const key = b.dataset.hdReset, count = Number(b.dataset.hdCount) || 1;
    const used = Math.max(0, Number(character.hitDiceUsed?.[key]) || 0);
    const recover = Math.max(1, Math.ceil(count / 2));
    character.hitDiceUsed[key] = Math.max(0, used - recover);
    saveCharacter(character); renderHitDiceTracker(); renderDashboard();
    toast(`Descanso longo: recupera até ${recover} dado(s) de vida gastos.`);
  }));
  box.querySelectorAll("[data-hd-use]").forEach((b) => b.addEventListener("click", () => {
    const key = b.dataset.hdUse, die = Number(b.dataset.hdDie) || 8;
    const s = sources.find((x) => x.key === key);
    const used = Math.max(0, Number(character.hitDiceUsed?.[key]) || 0);
    if (used >= s.count) { toast("Sem dados de vida disponíveis."); return; }
    const conMod = mod(effScore("con"));
    const roll = rollDie(die);
    const healed = Math.max(0, roll + conMod);
    character.hitDiceUsed = character.hitDiceUsed || {};
    character.hitDiceUsed[key] = used + 1;
    const maxHp = calc().hp;
    character.hpCurrent = Math.min(maxHp, (character.hpCurrent == null ? maxHp : character.hpCurrent) + healed);
    hdRollMessages[key] = `Rolou d${die}: <b>${roll}</b> + CON ${fmt(conMod)} = <b>${healed} PV recuperados</b> (repouso curto obrigatório).`;
    broadcastRoll("Dado de Vida", `d${die} (${roll}) + CON ${fmt(conMod)}`, `${healed} PV recuperados`, { type: "outro" });
    saveCharacter(character);
    recalc();
  }));
}

// ------------------------------------------------------------
// Condições de combate
// ------------------------------------------------------------
function renderConditions() {
  const box = $("conditions-list");
  if (!box) return;
  const list = character.conditions || [];
  if (!list.length) { box.innerHTML = `<div class="condition-empty">Nenhuma condição ativa.</div>`; return; }
  box.innerHTML = list.map((c) => {
    const def = CONDITIONS.find((x) => x.key === c.key);
    const durText = c.rounds == null ? "permanente" : `${c.rounds} rodada(s)`;
    return `<div class="condition-chip" title="${esc(def?.effect || "")}"><b>${esc(def?.label || c.key)}</b><span class="cond-duration">${esc(durText)}</span><button type="button" data-remove-condition="${esc(c.id)}" title="Remover">×</button></div>`;
  }).join("");
  box.querySelectorAll("[data-remove-condition]").forEach((b) => b.addEventListener("click", () => {
    character.conditions = (character.conditions || []).filter((c) => c.id !== b.dataset.removeCondition);
    saveCharacter(character); renderConditions(); renderDashboard();
  }));
}
function applyCondition(key) {
  const rounds = Number($("condition-duration")?.value) || null;
  character.conditions = character.conditions || [];
  character.conditions.push({ id: `cond-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, key, rounds: rounds && rounds > 0 ? rounds : null });
  saveCharacter(character);
  renderConditions(); renderDashboard();
  $("modal").classList.add("hidden");
  toast("Condição aplicada.");
}
function openConditionPicker() {
  $("modal-content").innerHTML = `<div class="modal-title"><div><span class="eyebrow">COMBATE</span><h2>Aplicar Condição</h2><p class="muted">Escolha a duração (em rodadas) e clique numa condição pra aplicá-la. Deixe em branco pra uma condição permanente (removida manualmente).</p></div></div>
    <div class="modal-body">
      <div class="condition-duration-row"><label>Duração (rodadas)<br><input id="condition-duration" type="number" min="1" placeholder="permanente"></label></div>
      <div class="condition-picker">${CONDITIONS.map((c) => `<button type="button" class="condition-option" data-pick-condition="${esc(c.key)}"><b>${esc(c.label)}</b><span>${esc(c.effect)}</span></button>`).join("")}</div>
    </div>`;
  $("modal").classList.remove("hidden");
  $("modal-content").querySelectorAll("[data-pick-condition]").forEach((b) => b.addEventListener("click", () => applyCondition(b.dataset.pickCondition)));
}
// Avança uma rodada de combate: decrementa a duração das condições e dos
// buffs temporários que têm duração em rodadas, removendo o que chega a 0.
function advanceRound() {
  let expired = 0;
  character.conditions = (character.conditions || []).filter((c) => {
    if (c.rounds == null) return true;
    c.rounds -= 1;
    if (c.rounds <= 0) { expired++; return false; }
    return true;
  });
  character.buffs = (character.buffs || []).filter((b) => {
    if (b.duration == null) return true;
    b.duration -= 1;
    if (b.duration <= 0) { expired++; return false; }
    return true;
  });
  character.turnActions = { action: false, bonus: false, reaction: false };
  saveCharacter(character);
  recalc();
  toast(expired ? `Rodada avançada. ${expired} efeito(s) expiraram. Ação/Bônus/Reação liberados.` : "Rodada avançada. Ação/Bônus/Reação liberados.");
}

// ------------------------------------------------------------
// Descanso curto/longo — restaura de uma vez os recursos que a regra
// de cada um permite, em vez de precisar zerar dado de vida, espaços
// de magia e recursos de classe um por um.
// ------------------------------------------------------------
function shortRest() {
  const resources = computeClassResources();
  resources.filter((r) => r.rest === "short").forEach((r) => setResourceUsed(r.id, 0, r.max));
  const pactActive = multiclassSpellcasting()?.perClass.some((p) => p.progression === "pact");
  if (pactActive) character.pactSlotsUsed = 0;
  saveCharacter(character);
  recalc();
  toast("Descanso curto: recursos de descanso curto (e espaços de Pacto, se houver) restaurados. Gaste dados de vida manualmente se quiser curar.");
}
function longRest() {
  const resources = computeClassResources();
  resources.forEach((r) => setResourceUsed(r.id, 0, r.max));
  character.spellSlotsUsed = Array(9).fill(0);
  character.pactSlotsUsed = 0;
  character.hitDiceUsed = character.hitDiceUsed || {};
  hitDiceSources().forEach((s) => {
    const used = Math.max(0, Number(character.hitDiceUsed[s.key]) || 0);
    const recover = Math.max(1, Math.ceil(s.count / 2));
    character.hitDiceUsed[s.key] = Math.max(0, used - recover);
  });
  character.hpCurrent = calc().hp;
  character.deathSaves = { success: 0, failure: 0 };
  hdRollMessages = {};
  saveCharacter(character);
  recalc();
  toast("Descanso longo: PV cheios, metade dos dados de vida, espaços de magia/pacto e recursos de classe restaurados.");
}

// ------------------------------------------------------------
// Rastreador de Ação / Ação Bônus / Reação — mesma lógica visual das
// condições, zerado automaticamente por "avançar rodada".
// ------------------------------------------------------------
const TURN_ACTION_DEFS = [["action", "Ação"], ["bonus", "Ação Bônus"], ["reaction", "Reação"]];
function renderTurnActions() {
  character.turnActions = character.turnActions || { action: false, bonus: false, reaction: false };
  const ta = character.turnActions;
  document.querySelectorAll("[data-turn-actions-slot]").forEach((box) => {
    box.innerHTML = TURN_ACTION_DEFS.map(([k, label]) => `<button type="button" class="turn-action-chip${ta[k] ? " used" : ""}" data-turn-action="${k}">
      <b>${label}</b><small>${ta[k] ? "Gasta" : "Disponível"}</small></button>`).join("");
    box.querySelectorAll("[data-turn-action]").forEach((b) => b.addEventListener("click", () => {
      const k = b.dataset.turnAction;
      character.turnActions[k] = !character.turnActions[k];
      saveCharacter(character); renderTurnActions();
    }));
  });
}

// ------------------------------------------------------------
// Aba "Ações" — junta ataques, recursos de classe, magias preparadas e
// características de classe/subclasse/talento num painel só, agrupado por
// Ação/Ação Bônus/Reação (como a aba "Actions" do D&D Beyond). Não introduz
// dado novo: cada item já existe em outra aba, isso é só uma lente por
// economia de ação sobre o que já está na ficha.
// ------------------------------------------------------------
function spellActionType(sp) {
  const u = String(sp?.time?.[0]?.unit || "").toLowerCase();
  return u === "action" || u === "bonus" || u === "reaction" ? u : null;
}
// Sem dado estruturado de economia de ação em características/talentos —
// procura o gatilho no próprio texto da regra (em inglês, como vem do
// 5etools). Heurística: cobre a maioria dos casos oficiais, mas não é
// garantida pra homebrew com fraseado diferente.
function featureActionType(text) {
  if (/\bas a reaction\b|\breaction to\b/i.test(text)) return "reaction";
  if (/\bas a bonus action\b|\bbonus action to\b/i.test(text)) return "bonus";
  if (/\bas an action\b/i.test(text)) return "action";
  return null;
}
async function computeActionsBoard() {
  const items = { action: [], bonus: [], reaction: [], special: [] };
  const push = (type, kind, name, detail) => (items[type] || items.special).push({ kind, name, detail });

  for (const a of character.attacks || []) {
    if (!a.name) continue;
    push("action", "attack", a.name, `${a.rollType === "save" ? `${attackTotalLabel(a)} de resistência` : `${attackTotalLabel(a)} para acertar`} · ${attackDamageSummary(a)}${a.range ? ` · ${a.range}` : ""}`);
  }

  for (const r of computeClassResources()) {
    const avail = r.max - resourceUsed(r.id);
    push(r.turnAction || "special", "resource", r.label, `${r.classLabel} · ${avail}/${r.max} disponível(is)`);
  }

  const casters = spellcastingClasses().filter((cc) => spellcastingInfoFor(cc.cr, cc.sr, cc.level));
  const seenSpell = new Set();
  for (const caster of casters) {
    const spellEd = editionOf(caster.classEntry) === "both" ? character.edition : editionOf(caster.classEntry);
    try {
      const all = await spellsForClass(caster.classEntry, caster.subclassEntry, spellEd);
      for (const sp of all) {
        const key = `${sp.name}|${sp.source || ""}`;
        if (seenSpell.has(key) || !character.preparedSpells.includes(key)) continue;
        const at = spellActionType(sp);
        if (!at) continue;
        seenSpell.add(key);
        push(at, "spell", sp.name, `Magia · Nv. ${spellLevel(sp) === 0 ? "Truque" : spellLevel(sp)}`);
      }
    } catch (err) { console.error(err); }
  }
  for (const ex of extraSpellRecords()) {
    const key = `${ex.name}|${ex.source || ""}`;
    if (seenSpell.has(key) || !character.preparedSpells.includes(key)) continue;
    const at = spellActionType(ex);
    if (!at) continue;
    seenSpell.add(key);
    push(at, "spell", ex.name, `Magia (avulsa) · Nv. ${spellLevel(ex) === 0 ? "Truque" : spellLevel(ex)}`);
  }

  const classFeats = refs.class ? await findClassFeatures(refs.class, Number(character.level)).catch(() => []) : [];
  const subFeats = refs.subclass ? await findSubclassFeatures(refs.subclass, Number(character.level)).catch(() => []) : [];
  const mcClassFeats = (await Promise.all((details.multiclasses || []).map((m) => m.classEntry ? findClassFeatures(m.classEntry, Number(m.level)).catch(() => []) : Promise.resolve([])))).flat();
  const mcSubFeats = (await Promise.all((details.multiclasses || []).map((m) => m.subclassEntry ? findSubclassFeatures(m.subclassEntry, Number(m.level)).catch(() => []) : Promise.resolve([])))).flat();
  const feats = chosenFeatEntities().map((e) => ({ name: e.name, entries: featRec(e).entries }));
  const seenFeat = new Set();
  for (const f of [...classFeats, ...subFeats, ...mcClassFeats, ...mcSubFeats, ...feats]) {
    if (!f?.name || seenFeat.has(f.name)) continue;
    const text = plain(f.entries || "");
    const at = featureActionType(text);
    if (!at) continue;
    seenFeat.add(f.name);
    push(at, "feature", f.name, text.length > 130 ? text.slice(0, 130) + "…" : text);
  }

  return items;
}
const ACTION_TAG_ICON = { attack: "⚔", resource: "●", spell: "✦", feature: "★" };
const ACTION_TAG_LABEL = { attack: "Ataque", resource: "Recurso", spell: "Magia", feature: "Característica" };
function actionsColumnHtml(title, hint, list) {
  return `<div class="actions-col"><div class="actions-col-head"><h3>${esc(title)}</h3><small>${esc(hint)}</small></div>${
    list.length
      ? list.map((it) => `<div class="action-item"><span class="action-item-icon" title="${esc(ACTION_TAG_LABEL[it.kind] || "")}">${ACTION_TAG_ICON[it.kind] || "•"}</span><div class="action-item-body"><b>${esc(it.name)}</b><small>${esc(it.detail)}</small></div></div>`).join("")
      : `<p class="muted action-empty">Nada aqui.</p>`
  }</div>`;
}
async function renderActionsBoard() {
  const box = $("actions-board");
  if (!box) return;
  const items = await computeActionsBoard();
  box.innerHTML =
    actionsColumnHtml("Ação", "Ataques, magias e características que consomem sua ação.", items.action) +
    actionsColumnHtml("Ação Bônus", "Recursos e magias rápidas — só uma por turno.", items.bonus) +
    actionsColumnHtml("Reação", "O que você pode fazer fora do seu turno.", items.reaction) +
    actionsColumnHtml("Especial / Fora de combate", "Não consome uma ação padrão — parte de outra ação, ou só vale em descanso.", items.special);
}

// ------------------------------------------------------------
// Concentração — badge com lembrete visual (fácil de esquecer em
// combate). Guarda só o nome da magia; não impõe regra nenhuma, é
// um lembrete.
// ------------------------------------------------------------
function renderConcentration() {
  document.querySelectorAll("[data-concentration-slot]").forEach((box) => {
    const c = character.concentration;
    box.classList.toggle("active", !!c);
    box.innerHTML = c
      ? `<span class="concentration-label">🎯 Concentrando em <b>${esc(c.name)}</b></span><button type="button" data-clear-concentration title="Parar de concentrar">Parar</button>`
      : `<button type="button" class="concentration-set-btn" data-open-concentration>🎯 Marcar concentração</button>`;
    box.querySelectorAll("[data-open-concentration]").forEach((b) => b.addEventListener("click", openConcentrationPicker));
    box.querySelectorAll("[data-clear-concentration]").forEach((b) => b.addEventListener("click", () => {
      character.concentration = null; saveCharacter(character); renderConcentration(); toast("Concentração encerrada.");
    }));
  });
}
function setConcentration(name) {
  name = String(name || "").trim();
  if (!name) return;
  character.concentration = { name };
  saveCharacter(character);
  renderConcentration();
  $("modal").classList.add("hidden");
  toast(`Concentrando em ${name}.`);
}
function openConcentrationPicker() {
  const prepared = [...new Set((character.preparedSpells || []).map((k) => k.split("|")[0]))].sort((a, b) => a.localeCompare(b, "pt-BR"));
  $("modal-content").innerHTML = `<div class="modal-title"><div><span class="eyebrow">COMBATE</span><h2>Concentração</h2><p class="muted">Sofrer dano exige um teste de Constituição (CD 10 ou metade do dano, o que for maior) pra manter a concentração — este badge é só um lembrete visual de qual magia está ativa.</p></div></div>
    <div class="modal-body">
      ${character.concentration ? `<button type="button" class="add-btn" data-clear-concentration style="margin-bottom:12px">Parar concentração atual (${esc(character.concentration.name)})</button>` : ""}
      ${prepared.length ? `<div class="condition-picker">${prepared.map((n) => `<button type="button" class="condition-option" data-set-concentration="${esc(n)}"><b>${esc(n)}</b></button>`).join("")}</div>` : `<p class="muted">Nenhuma magia preparada/conhecida marcada ainda — digite o nome manualmente abaixo.</p>`}
      <div class="condition-duration-row"><label>Ou digite o nome da magia<br><input id="concentration-custom" placeholder="Nome da magia"></label><button type="button" class="add-btn" id="concentration-custom-btn">Marcar</button></div>
    </div>`;
  $("modal").classList.remove("hidden");
  $("modal-content").querySelectorAll("[data-set-concentration]").forEach((b) => b.addEventListener("click", () => setConcentration(b.dataset.setConcentration)));
  $("modal-content").querySelectorAll("[data-clear-concentration]").forEach((b) => b.addEventListener("click", () => {
    character.concentration = null; saveCharacter(character); renderConcentration(); $("modal").classList.add("hidden"); toast("Concentração encerrada.");
  }));
  $("concentration-custom-btn")?.addEventListener("click", () => setConcentration($("concentration-custom").value));
  $("concentration-custom")?.addEventListener("keydown", (e) => { if (e.key === "Enter") setConcentration(e.target.value); });
}

// ------------------------------------------------------------
// Integração com Discord — cada rolagem vira uma mensagem num canal
// via webhook (cada jogador cola o link do PRÓPRIO servidor/canal em
// "🔗 Discord" no topo; sem webhook configurado, sendToDiscord não faz
// nada). Mensagem sempre traz quem rolou, o que foi rolado, o valor de
// cada dado e o total somado — nunca só o resultado final.
// ------------------------------------------------------------
function discordMessage(label, detail, total) {
  const name = (character?.name || "").trim() || "Personagem sem nome";
  return `🎲 **${name}** rolou **${label}**: ${detail} = **${total}**`;
}
function discordTurnMessage(name, round) {
  return `⚔️ Rodada **${round}** — é a vez de **${name}**!`;
}
async function sendToDiscord(text) {
  const url = getDiscordWebhook();
  if (!url) return;
  try {
    const res = await fetch(url, {
      method: "POST",
      mode: "cors",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: text.slice(0, 1900) }),
    });
    if (!res.ok) toast(`Discord recusou a rolagem (HTTP ${res.status}).`);
  } catch {
    toast("Não deu pra enviar a rolagem pro Discord — confira o link do webhook.");
  }
}
function renderDiscordSettings() {
  const url = getDiscordWebhook();
  $("modal-content").innerHTML = `<div class="modal-title"><div><span class="eyebrow">INTEGRAÇÃO</span><h2>Discord</h2><p class="muted">Cada rolagem (ataque, dano, dado de vida, teste de morte, rolador genérico) vira uma mensagem no canal do Discord que você configurar abaixo. Isso fica salvo neste navegador, não no personagem — então cada jogador configura o próprio link, podendo usar servidores diferentes ou o mesmo entre o grupo.</p></div></div>
    <div class="modal-body">
      <h3>Como criar o link do webhook</h3>
      <ol>
        <li>Abra o Discord (aplicativo ou navegador) e entre no <strong>servidor</strong> onde as rolagens devem aparecer.</li>
        <li>Ao lado do nome do <strong>canal</strong> desejado (ex.: #mesa, #rolagens), clique na engrenagem ⚙️ de "Editar Canal" (ou clique com o botão direito no canal → "Editar Canal").</li>
        <li>No menu à esquerda, clique em <strong>Integrações</strong>.</li>
        <li>Clique em <strong>Webhooks</strong> e depois em <strong>Novo Webhook</strong> (se já existir um, pode reaproveitar).</li>
        <li>Dê um nome pro webhook (ex.: "Rolagens de Dado") — é só o nome que vai aparecer nas mensagens, pode deixar o padrão também.</li>
        <li>Clique em <strong>Copiar link do Webhook</strong>. Não precisa clicar em Salvar de novo, copiar já basta.</li>
        <li>Volte aqui, cole o link no campo abaixo e clique em <strong>Salvar</strong>.</li>
        <li>Clique em <strong>Enviar teste</strong> — se tudo estiver certo, uma mensagem de teste aparece no canal do Discord em poucos segundos.</li>
      </ol>
      <p class="muted">⚠️ Esse link funciona como uma senha: quem tiver o link consegue postar mensagens naquele canal. Não compartilhe publicamente — cole só no seu próprio navegador.</p>
      <label>Link do webhook<br><input id="discord-webhook-input" placeholder="https://discord.com/api/webhooks/..." value="${esc(url)}" style="width:100%"></label>
      <div class="condition-duration-row" style="margin-top:12px">
        <button type="button" class="add-btn" id="discord-webhook-save">Salvar</button>
        <button type="button" id="discord-webhook-test">Enviar teste</button>
        ${url ? `<button type="button" id="discord-webhook-remove">Remover</button>` : ""}
      </div>
    </div>`;
  $("modal").classList.remove("hidden");
  $("discord-webhook-save")?.addEventListener("click", () => {
    saveDiscordWebhook($("discord-webhook-input").value.trim());
    toast("Webhook do Discord salvo.");
    renderDiscordSettings();
  });
  $("discord-webhook-test")?.addEventListener("click", async () => {
    const pending = $("discord-webhook-input").value.trim();
    if (pending) saveDiscordWebhook(pending);
    await sendToDiscord(discordMessage("um teste", "🎉", "funcionou!"));
    toast("Mensagem de teste enviada.");
  });
  $("discord-webhook-remove")?.addEventListener("click", () => {
    saveDiscordWebhook("");
    toast("Webhook removido.");
    renderDiscordSettings();
  });
}

// ------------------------------------------------------------
// Sala de rolagens — chat de rolagem em tempo real compartilhado entre
// os jogadores da mesma mesa, ponto-a-ponto via WebRTC (PeerJS). Nenhum
// serviço de terceiro guarda ou lê as rolagens — elas trafegam direto
// de navegador pra navegador; o servidor público do PeerJS só ajuda a
// "apresentar" os navegadores um ao outro no início da conexão. Um
// jogador (normalmente o mestre) cria a sala e vira o "anfitrião" —
// fica no centro, conectado com todo mundo, e repassa a rolagem de
// cada jogador pro resto do grupo. Os outros só "entram" com o mesmo
// código. Sem histórico pra quem entra atrasado, e se o anfitrião
// fechar a aba a sala cai — quem quiser continua criando outra.
// Rolagens de Cura (marcadas no rolador de dados genérico) ganham um
// botão "Aplicar cura" que soma o PV direto no personagem de quem
// clicar — cada jogador aplica só no próprio.
// ------------------------------------------------------------
let roomPeer = null;
let roomRole = null;              // "anfitriao" | "jogador" | null
let roomHostConns = new Map();    // anfitrião: peerId -> DataConnection dos jogadores
let roomClientConn = null;        // jogador: conexão única com o anfitrião
let roomRolls = [];
let myPeerId = null;
// Rastreador de iniciativa compartilhado da sala — o anfitrião (mestre) é a
// fonte da verdade: qualquer ação (entrar na iniciativa, avançar turno...)
// vira uma mensagem kind:"combat-action" enviada pro anfitrião, que aplica,
// recalcula e redistribui o estado inteiro (kind:"combat-state") pra todo
// mundo, inclusive quem enviou. Um jogador nunca aplica a ação localmente.
let roomCombat = { round: 1, currentId: null, list: [] };

function sanitizeRoomCode(code) {
  return "dndficha-" + String(code || "").trim().toLowerCase().replace(/[^a-z0-9-]+/g, "-").slice(0, 50);
}
function roomStatusText() {
  if (!roomRole) return "Sala não configurada — clique na engrenagem.";
  if (roomRole === "anfitriao") return `Anfitrião da sala — ${roomHostConns.size} jogador(es) conectado(s).`;
  return roomClientConn?.open ? "Conectado à sala." : "Conectando à sala…";
}
function leaveRoom() {
  try { roomPeer?.destroy(); } catch { /* ignore */ }
  roomPeer = null; roomRole = null; roomHostConns = new Map(); roomClientConn = null; myPeerId = null;
  roomCombat = { round: 1, currentId: null, list: [] };
  renderRoomChat();
}
function hostRoom(code) {
  if (typeof Peer === "undefined") { toast("Biblioteca da sala não carregou — confira sua conexão e recarregue a página."); return; }
  leaveRoom();
  roomRole = "anfitriao";
  roomPeer = new Peer(sanitizeRoomCode(code));
  roomPeer.on("open", (id) => { myPeerId = id; renderRoomChat(); });
  roomPeer.on("connection", (conn) => {
    roomHostConns.set(conn.peer, conn);
    conn.on("data", (msg) => {
      if (msg?.kind === "combat-action") { applyCombatAction(msg.action, msg.payload); return; }
      onRoomMessage(msg); relayToOthers(msg, conn.peer);
    });
    conn.on("close", () => {
      roomHostConns.delete(conn.peer);
      applyCombatAction("remove", { id: conn.peer }); // tira quem desconectou da iniciativa
      renderRoomChat();
    });
    conn.on("open", () => renderRoomChat());
  });
  roomPeer.on("error", (err) => {
    console.warn("Sala (anfitrião):", err);
    toast(err?.type === "unavailable-id" ? "Já existe uma sala aberta com esse código — escolha outro ou entre nela em vez de criar." : "A sala teve um problema de conexão — confira sua internet.");
    renderRoomChat();
  });
}
function joinRoom(code) {
  if (typeof Peer === "undefined") { toast("Biblioteca da sala não carregou — confira sua conexão e recarregue a página."); return; }
  leaveRoom();
  roomRole = "jogador";
  roomPeer = new Peer();
  roomPeer.on("open", () => {
    myPeerId = roomPeer.id;
    roomClientConn = roomPeer.connect(sanitizeRoomCode(code), { reliable: true });
    roomClientConn.on("data", (msg) => onRoomMessage(msg));
    roomClientConn.on("open", () => { toast("Entrou na sala."); renderRoomChat(); });
    roomClientConn.on("close", () => { toast("Desconectado da sala — o anfitrião pode ter fechado a aba."); renderRoomChat(); });
  });
  roomPeer.on("error", (err) => {
    console.warn("Sala (jogador):", err);
    toast(err?.type === "peer-unavailable" ? "Não achei uma sala aberta com esse código — confira com quem criou." : "A sala teve um problema de conexão — confira sua internet.");
    renderRoomChat();
  });
}
function relayToOthers(msg, exceptPeerId) {
  roomHostConns.forEach((conn, peerId) => { if (peerId !== exceptPeerId && conn.open) conn.send(msg); });
}
function onRoomMessage(msg) {
  if (msg?.kind === "combat-state") { roomCombat = msg.combat || roomCombat; renderCombatTracker(); return; }
  if (!msg?.id || roomRolls.some((r) => r.id === msg.id)) return;
  roomRolls.push(msg);
  roomRolls = roomRolls.slice(-50);
  renderRoomChat();
}
// Redimensiona uma foto pro chat da sala (lado maior até 480px, JPEG) —
// preserva a proporção (ao contrário do retrato, que corta em quadrado).
// GIF passa direto sem recomprimir (canvas mataria a animação), só com um
// teto de tamanho pra não travar o canal P2P — GIFs maiores, manda o link.
function resizeChatImage(file) {
  return new Promise((resolve, reject) => {
    if (file.type === "image/gif") {
      if (file.size > 700 * 1024) { reject(new Error("GIF grande demais pra enviar como arquivo (máx. 700KB) — cole o link dele na mensagem em vez disso.")); return; }
      const reader = new FileReader();
      reader.onerror = () => reject(reader.error);
      reader.onload = () => resolve(reader.result);
      reader.readAsDataURL(file);
      return;
    }
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error);
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error("Não deu pra ler essa imagem."));
      img.onload = () => {
        const maxSide = 480;
        const scale = Math.min(1, maxSide / Math.max(img.naturalWidth, img.naturalHeight));
        const w = Math.max(1, Math.round(img.naturalWidth * scale)), h = Math.max(1, Math.round(img.naturalHeight * scale));
        const canvas = document.createElement("canvas");
        canvas.width = w; canvas.height = h;
        canvas.getContext("2d").drawImage(img, 0, 0, w, h);
        resolve(canvas.toDataURL("image/jpeg", 0.75));
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}
const CHAT_IMAGE_URL_RE = /^https?:\/\/\S+\.(?:gif|png|jpe?g|webp)(?:\?\S*)?$/i;
// Deixa links clicáveis num texto que já passou por esc() — a URL escapada
// não tem "<"/">" então dá pra casar com regex sem risco de reabrir HTML.
function linkifyEscaped(text) {
  return text.replace(/((?:https?:\/\/)[^\s<]+)/gi, (u) => `<a href="${u}" target="_blank" rel="noopener noreferrer">${u}</a>`);
}
function pushRoomMessage(text, image) {
  if (!roomRole) { toast("Entre numa sala primeiro (⚙️)."); return; }
  const msg = {
    id: `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`,
    name: (character?.name || "").trim() || "Personagem sem nome",
    type: "chat", text: String(text || "").slice(0, 500), image: image || null, ts: Date.now(),
  };
  onRoomMessage(msg);
  if (roomRole === "anfitriao") relayToOthers(msg, null);
  else if (roomClientConn?.open) roomClientConn.send(msg);
}
async function sendRoomChatImage(file) {
  if (!file) return;
  if (!roomRole) { toast("Entre numa sala primeiro (⚙️)."); return; }
  try {
    const dataUrl = await resizeChatImage(file);
    pushRoomMessage("", dataUrl);
  } catch (err) {
    toast(err?.message || "Não deu pra enviar essa imagem.");
  }
}
function sendRoomChatText() {
  const input = $("room-chat-text-input");
  const text = input?.value.trim();
  if (!text) return;
  pushRoomMessage(text, null);
  input.value = "";
}
function pushRoomRoll(entry) {
  if (!roomRole) return;
  const msg = {
    id: `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`,
    name: entry.name || (character?.name || "").trim() || "Personagem sem nome",
    label: entry.label, detail: entry.detail, total: String(entry.total ?? ""),
    type: entry.type || "outro", amount: entry.amount ?? null, ts: Date.now(),
  };
  onRoomMessage(msg); // já aparece no próprio chat, sem depender de round-trip
  if (roomRole === "anfitriao") relayToOthers(msg, null);
  else if (roomClientConn?.open) roomClientConn.send(msg);
}
// Substitui os antigos sendToDiscord(discordMessage(...)) nos pontos de
// rolagem do personagem: manda pro Discord (se configurado) E pra sala
// (se conectado), sem duplicar a lógica de formatação em cada lugar.
function broadcastRoll(label, detail, total, opts = {}) {
  const note = opts.note || "";
  sendToDiscord(discordMessage(label, detail, total) + note);
  pushRoomRoll({ label, detail: detail + note, total, type: opts.type, amount: opts.amount ?? null });
}
function broadcastMonsterRoll(m, label, detail, total, opts = {}) {
  const note = opts.note || "";
  sendToDiscord(monsterDiscordMessage(m, label, detail, total) + note);
  pushRoomRoll({ name: `${(m?.name || "Monstro").trim()} (mestre)`, label, detail: detail + note, total, type: "mestre" });
}

function renderRoomChat() {
  const box = $("room-chat-list");
  if (!box) return;
  const status = $("room-chat-status");
  if (status) status.textContent = roomStatusText();
  renderCombatTracker();
  if (!roomRolls.length) { box.innerHTML = `<div class="empty">Nenhuma mensagem na sala ainda.</div>`; return; }
  const applied = getAppliedHeals();
  box.innerHTML = roomRolls.slice().reverse().map((r) => {
    const time = r.ts ? new Date(r.ts).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }) : "";
    if (r.type === "chat") {
      const trimmed = (r.text || "").trim();
      const autoImg = !r.image && CHAT_IMAGE_URL_RE.test(trimmed) ? trimmed : null;
      const bits = [];
      if (r.image) bits.push(`<img class="room-chat-image" src="${esc(r.image)}" alt="Imagem enviada na sala" loading="lazy">`);
      if (autoImg) bits.push(`<img class="room-chat-image" src="${esc(autoImg)}" alt="Imagem/GIF do link" loading="lazy">`);
      else if (r.text) bits.push(`<span class="room-chat-text">${linkifyEscaped(esc(r.text))}</span>`);
      return `<div class="room-chat-row room-chat-message">
        <div class="room-chat-meta"><b>${esc(r.name || "?")}</b><small>${time}</small></div>
        <div class="room-chat-body room-chat-body-msg">${bits.join("")}</div>
      </div>`;
    }
    const canHeal = r.type === "cura" && r.amount != null;
    const done = canHeal && applied.includes(r.id);
    return `<div class="room-chat-row${canHeal ? " room-chat-heal" : ""}">
      <div class="room-chat-meta"><b>${esc(r.name || "?")}</b><span>${esc(r.label || "")}</span><small>${time}</small></div>
      <div class="room-chat-body"><span class="room-chat-detail">${esc(r.detail || "")}</span><b class="room-chat-total">${esc(String(r.total ?? ""))}</b></div>
      ${canHeal ? `<button type="button" class="room-chat-heal-btn" data-heal-roll="${esc(r.id)}" ${done ? "disabled" : ""}>${done ? "✓ Cura aplicada" : `+ Aplicar cura (${esc(String(r.amount))} PV)`}</button>` : ""}
    </div>`;
  }).join("");
  box.querySelectorAll("[data-heal-roll]").forEach((b) => b.addEventListener("click", () => applyHealFromRoom(b.dataset.healRoll)));
}
function applyHealFromRoom(rollId) {
  const roll = roomRolls.find((r) => r.id === rollId);
  if (!roll || roll.amount == null || getAppliedHeals().includes(rollId)) return;
  if (!character) { toast("Abra um personagem primeiro."); return; }
  const maxHp = calc().hp;
  const before = character.hpCurrent == null ? maxHp : character.hpCurrent;
  const amount = Number(roll.amount) || 0;
  character.hpCurrent = Math.min(maxHp, before + amount);
  markHealApplied(rollId);
  saveCharacter(character);
  recalc();
  renderRoomChat();
  toast(`+${amount} PV de "${roll.label}" (${roll.name}) aplicado em ${character.name || "seu personagem"}.`);
}
function toggleRoomChat(force) {
  const panel = $("room-chat-panel");
  if (!panel) return;
  const show = force != null ? force : panel.classList.contains("hidden");
  panel.classList.toggle("hidden", !show);
  document.body.classList.toggle("room-chat-docked", show);
  if (show) renderRoomChat();
}

// ------------------------------------------------------------
// Rastreador de iniciativa da sala — mesma sala WebRTC do chat de
// rolagem, aba "Iniciativa". O anfitrião é sempre a autoridade: um
// jogador nunca aplica a própria ação, só a envia (kind:"combat-action")
// e espera o estado recalculado voltar (kind:"combat-state").
// ------------------------------------------------------------
function sortedCombatants() {
  return roomCombat.list.slice().sort((a, b) => (Number(b.init) || 0) - (Number(a.init) || 0) || String(a.name).localeCompare(String(b.name), "pt-BR"));
}
function announceRoomTurn() {
  const c = sortedCombatants().find((x) => x.id === roomCombat.currentId);
  if (c) sendToDiscord(discordTurnMessage(c.name, roomCombat.round));
}
function broadcastCombatState() {
  const msg = { kind: "combat-state", combat: roomCombat };
  roomHostConns.forEach((conn) => { if (conn.open) conn.send(msg); });
  renderCombatTracker();
}
// Só o anfitrião chama isto (direto, pra própria ação, ou ao receber uma
// combat-action de algum jogador conectado).
function applyCombatAction(action, payload = {}) {
  if (roomRole !== "anfitriao") return;
  const list = roomCombat.list;
  if (action === "join" || action === "update") {
    if (!payload.id) return;
    const entry = {
      id: payload.id,
      name: String(payload.name || "").trim() || "Sem nome",
      init: Number(payload.init) || 0,
      ac: Number(payload.ac) || 0,
      hpMax: Math.max(0, Number(payload.hpMax) || 0),
      hpCur: Number.isFinite(Number(payload.hpCur)) ? Number(payload.hpCur) : (Number(payload.hpMax) || 0),
      hpTemp: Math.max(0, Number(payload.hpTemp) || 0),
    };
    const idx = list.findIndex((c) => c.id === payload.id);
    if (idx >= 0) list[idx] = entry; else list.push(entry);
  } else if (action === "addManual") {
    list.push({
      id: `m-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`,
      name: String(payload.name || "").trim() || "Monstro",
      init: Number(payload.init) || 0, ac: Number(payload.ac) || 0,
      hpMax: Math.max(0, Number(payload.hpMax) || 0), hpCur: Math.max(0, Number(payload.hpMax) || 0), hpTemp: 0,
    });
  } else if (action === "remove") {
    const i = list.findIndex((c) => c.id === payload.id);
    if (i >= 0) list.splice(i, 1);
    if (roomCombat.currentId === payload.id) roomCombat.currentId = null;
  } else if (action === "start") {
    roomCombat.round = 1;
    roomCombat.currentId = sortedCombatants()[0]?.id ?? null;
    announceRoomTurn();
  } else if (action === "next") {
    const sorted = sortedCombatants();
    if (sorted.length) {
      const idx = sorted.findIndex((c) => c.id === roomCombat.currentId);
      const nextIdx = idx < 0 ? 0 : (idx + 1) % sorted.length;
      if (idx >= 0 && nextIdx === 0) roomCombat.round += 1;
      roomCombat.currentId = sorted[nextIdx].id;
      announceRoomTurn();
    }
  } else if (action === "prev") {
    const sorted = sortedCombatants();
    if (sorted.length) {
      const idx = sorted.findIndex((c) => c.id === roomCombat.currentId);
      const prevIdx = idx <= 0 ? sorted.length - 1 : idx - 1;
      if (idx === 0 && roomCombat.round > 1) roomCombat.round -= 1;
      roomCombat.currentId = sorted[prevIdx].id;
    }
  } else if (action === "clear") {
    roomCombat = { round: 1, currentId: null, list: [] };
  } else { return; }
  broadcastCombatState();
}
function sendCombatAction(action, payload) {
  if (!roomRole) { toast("Entre numa sala primeiro (⚙️)."); return; }
  if (roomRole === "anfitriao") applyCombatAction(action, payload);
  else if (roomClientConn?.open) roomClientConn.send({ kind: "combat-action", action, payload });
  else toast("Ainda conectando à sala…");
}
function renderCombatTracker() {
  const controls = $("room-combat-controls"), list = $("room-combat-list");
  if (!controls || !list) return;
  if (!roomRole) {
    controls.innerHTML = `<p class="muted">Entre numa sala (⚙️) pra usar o rastreador de iniciativa com o grupo.</p>`;
    list.innerHTML = "";
    return;
  }
  const isHost = roomRole === "anfitriao";
  const mine = roomCombat.list.find((c) => c.id === myPeerId);
  controls.innerHTML = `
    <div class="room-combat-self">
      <input id="combat-self-name" placeholder="Nome" value="${esc(mine?.name ?? (character?.name || ""))}">
      <div class="room-combat-self-row">
        <label>Inic.<input id="combat-self-init" type="number" value="${mine?.init ?? ""}"></label>
        <button type="button" id="combat-self-roll-init" title="Rolar iniciativa (d20 + Destreza)">🎲</button>
        <label>CA<input id="combat-self-ac" type="number" value="${mine?.ac ?? (character ? calc().ac : "")}"></label>
      </div>
      <div class="room-combat-self-row">
        <label>PV atual<input id="combat-self-hpcur" type="number" value="${mine?.hpCur ?? (character ? (character.hpCurrent ?? calc().hp) : "")}"></label>
        <label>PV máx<input id="combat-self-hpmax" type="number" value="${mine?.hpMax ?? (character ? calc().hp : "")}"></label>
      </div>
      <div class="room-combat-self-row">
        <button type="button" class="add-btn" id="combat-self-join">${mine ? "Atualizar" : "Entrar na iniciativa"}</button>
        ${mine ? `<button type="button" id="combat-self-leave">Sair</button>` : ""}
      </div>
    </div>
    ${isHost ? `
    <div class="room-combat-add">
      <input id="combat-add-name" placeholder="Nome (ex.: Goblin 1)">
      <input id="combat-add-init" type="number" placeholder="Inic.">
      <input id="combat-add-ac" type="number" placeholder="CA">
      <input id="combat-add-hp" type="number" placeholder="PV máx">
      <button type="button" class="add-btn" id="combat-add-btn">+ Adicionar</button>
    </div>
    <div class="room-combat-master">
      <button type="button" id="combat-start-btn">▶ Iniciar</button>
      <button type="button" id="combat-prev-btn">⏮</button>
      <button type="button" id="combat-next-btn">⏭ Próximo</button>
      <button type="button" id="combat-clear-btn">🗑 Encerrar</button>
      <b>Rodada ${roomCombat.round}</b>
    </div>` : `<p class="room-combat-round muted">Rodada ${roomCombat.round}</p>`}
  `;
  const sorted = sortedCombatants();
  list.innerHTML = sorted.length ? sorted.map((c) => {
    const pct = c.hpMax > 0 ? Math.max(0, Math.min(100, (c.hpCur / c.hpMax) * 100)) : 0;
    const isTurn = c.id === roomCombat.currentId;
    const canRemove = isHost || c.id === myPeerId;
    return `<div class="room-combat-row${isTurn ? " room-combat-turn" : ""}">
      <div class="room-combat-row-top"><b>${esc(c.name)}</b><span class="room-combat-init" title="Iniciativa">${c.init}</span>${canRemove ? `<button type="button" class="remove-btn" data-combat-remove="${esc(c.id)}" title="Remover">×</button>` : ""}</div>
      <div class="room-combat-row-bottom">
        <span>CA ${c.ac}</span>
        <div class="dash-hp-bar"><div class="dash-hp-fill ${hpBarClass(c.hpCur, c.hpMax)}" style="width:${pct}%"></div><div class="dash-hp-label">${c.hpCur} / ${c.hpMax}${c.hpTemp ? ` (+${c.hpTemp})` : ""}</div></div>
      </div>
    </div>`;
  }).join("") : `<div class="empty">Ninguém na iniciativa ainda.</div>`;

  $("combat-self-roll-init")?.addEventListener("click", () => {
    const dex = character ? mod(effScore("dex")) : 0;
    $("combat-self-init").value = rollDie(20) + dex;
  });
  $("combat-self-join")?.addEventListener("click", () => {
    sendCombatAction(mine ? "update" : "join", {
      id: myPeerId,
      name: $("combat-self-name").value,
      init: $("combat-self-init").value,
      ac: $("combat-self-ac").value,
      hpCur: $("combat-self-hpcur").value,
      hpMax: $("combat-self-hpmax").value,
      hpTemp: mine?.hpTemp || 0,
    });
  });
  $("combat-self-leave")?.addEventListener("click", () => sendCombatAction("remove", { id: myPeerId }));
  $("combat-add-btn")?.addEventListener("click", () => {
    const name = $("combat-add-name").value.trim();
    if (!name) { toast("Digite um nome primeiro."); return; }
    sendCombatAction("addManual", { name, init: $("combat-add-init").value, ac: $("combat-add-ac").value, hpMax: $("combat-add-hp").value });
    $("combat-add-name").value = ""; $("combat-add-init").value = ""; $("combat-add-ac").value = ""; $("combat-add-hp").value = "";
  });
  $("combat-start-btn")?.addEventListener("click", () => sendCombatAction("start", {}));
  $("combat-prev-btn")?.addEventListener("click", () => sendCombatAction("prev", {}));
  $("combat-next-btn")?.addEventListener("click", () => sendCombatAction("next", {}));
  $("combat-clear-btn")?.addEventListener("click", () => { if (confirm("Encerrar o combate e limpar a lista de iniciativa?")) sendCombatAction("clear", {}); });
  list.querySelectorAll("[data-combat-remove]").forEach((b) => b.addEventListener("click", () => sendCombatAction("remove", { id: b.dataset.combatRemove })));
}
function renderRoomSettings() {
  const code = getRoomCode();
  $("modal-content").innerHTML = `<div class="modal-title"><div><span class="eyebrow">INTEGRAÇÃO</span><h2>Sala de rolagens</h2><p class="muted">Conecta os navegadores da mesa direto um no outro por WebRTC — sem conta, sem token, sem nenhum serviço de terceiro guardando as rolagens. Um jogador (normalmente o mestre) <b>cria</b> a sala com um código; os outros <b>entram</b> com o mesmo código. Rolagens marcadas como <b>Cura</b> no rolador de dados genérico ganham um botão pra aplicar o PV recuperado direto no personagem de quem clicar. Isso fica salvo neste navegador, não no personagem.</p></div></div>
    <div class="modal-body">
      <p class="muted">Combine um código com o grupo (ex.: o nome da campanha). <strong>Só uma pessoa cria a sala</strong> — as outras entram com o mesmo código, no próprio navegador.</p>
      <label>Código da sala<br><input id="room-code-input" placeholder="ex.: mesa-de-sexta" value="${esc(code)}" style="width:100%"></label>
      <div class="condition-duration-row" style="margin-top:12px">
        <button type="button" class="add-btn" id="room-host-btn">Criar sala (virar anfitrião)</button>
        <button type="button" id="room-join-btn">Entrar na sala</button>
        ${roomRole ? `<button type="button" id="room-leave-btn">Sair da sala</button>` : ""}
      </div>
      <p class="muted" style="margin-top:10px">⚠️ Quem tiver o código consegue entrar na sala — combine algo que não seja óbvio se quiser evitar visitantes. O anfitrião precisa manter a aba da ficha aberta durante a sessão; se ele fechar ou recarregar a página, a sala cai e alguém precisa criar de novo.</p>
      <p class="muted" style="margin-top:6px">${esc(roomStatusText())}</p>
    </div>`;
  $("modal").classList.remove("hidden");
  $("room-host-btn")?.addEventListener("click", () => {
    const v = $("room-code-input").value.trim();
    if (!v) { toast("Digite um código de sala primeiro."); return; }
    saveRoomCode(v);
    hostRoom(v);
    toast("Criando sala…");
    renderRoomSettings();
    toggleRoomChat(true);
  });
  $("room-join-btn")?.addEventListener("click", () => {
    const v = $("room-code-input").value.trim();
    if (!v) { toast("Digite um código de sala primeiro."); return; }
    saveRoomCode(v);
    joinRoom(v);
    toast("Entrando na sala…");
    renderRoomSettings();
    toggleRoomChat(true);
  });
  $("room-leave-btn")?.addEventListener("click", () => {
    leaveRoom();
    toast("Saiu da sala.");
    renderRoomSettings();
  });
}

// ------------------------------------------------------------
// Rolador de dados genérico — expressão tipo "2d6+3" sempre à mão
// (botão flutuante), útil além dos rolamentos de ataque/dano/morte.
// Histórico é só da sessão atual (não é salvo com o personagem).
// ------------------------------------------------------------
let diceHistory = [];
function rollExpression(expr, type) {
  const parsed = parseDiceExpr(expr);
  if (!parsed || !parsed.faces) { toast("Expressão inválida. Use algo como 2d6+3, 1d20 ou d8."); return null; }
  const { n, faces, bonus } = parsed;
  const { rolls, total } = rollDice(n, faces);
  const result = total + bonus;
  diceHistory.unshift({ n, faces, bonus, rolls, result });
  diceHistory = diceHistory.slice(0, 12);
  renderDiceHistory();
  const t = type || $("dice-roll-type")?.value || "outro";
  broadcastRoll(`${n}d${faces}${bonus ? fmt(bonus) : ""}`, `[${rolls.join(", ")}]${bonus ? ` ${fmt(bonus)}` : ""}`, result, { type: t, amount: t === "cura" ? result : null });
  return result;
}
function renderDiceHistory() {
  const box = $("dice-history");
  if (!box) return;
  box.innerHTML = diceHistory.length ? diceHistory.map((h) => `<div class="dice-history-row"><span class="dice-history-expr">${h.n}d${h.faces}${h.bonus ? fmt(h.bonus) : ""}</span><span class="dice-history-rolls">[${h.rolls.join(", ")}]</span><b class="dice-history-total">${h.result}</b></div>`).join("")
    : `<div class="empty">Nenhuma rolagem ainda.</div>`;
}
function toggleDiceRoller(force) {
  const panel = $("dice-roller-panel");
  if (!panel) return;
  const show = force != null ? force : panel.classList.contains("hidden");
  panel.classList.toggle("hidden", !show);
  if (show) { renderDiceHistory(); $("dice-expr-input")?.focus(); }
}

// ------------------------------------------------------------
// Dashboard / Quick View — resumo de combate fixo no topo da ficha
// ------------------------------------------------------------
function hpBarClass(cur, max) {
  if (cur <= 0) return "critical";
  if (max > 0 && cur / max < 0.5) return "warn";
  return "ok";
}
function renderDashboard() {
  const box = $("dashboard-body");
  if (!box || !character) return;
  const c = calc();
  const maxHp = c.hp;
  const curHp = character.hpCurrent == null ? maxHp : Number(character.hpCurrent) || 0;
  const pct = Math.max(0, Math.min(100, maxHp > 0 ? (curHp / maxHp) * 100 : 0));
  const msi = multiclassSpellcasting();
  const slotsHtml = msi?.slots?.some(Boolean)
    ? `<div class="dash-pip-set"><span>Espaços de magia</span>${msi.slots.map((n, i) => n ? `<div class="dash-pip-row" title="${i + 1}º nível">${Array.from({ length: n }, (_, p) => `<span class="dash-pip${p < Math.min(n, Number(character.spellSlotsUsed?.[i]) || 0) ? " used" : ""}"></span>`).join("")}</div>` : "").join("")}</div>`
    : "";
  const hdSources = refs.class ? hitDiceSources() : [];
  const hdHtml = hdSources.map((s) => {
    const used = Math.min(s.count, Number(character.hitDiceUsed?.[s.key]) || 0);
    return `<div class="dash-pip-set"><span>Dados de vida — ${esc(s.label)} (d${s.die})</span><div class="dash-pip-row">${Array.from({ length: s.count }, (_, p) => `<span class="dash-pip${p < used ? " used" : ""}"></span>`).join("")}</div></div>`;
  }).join("");
  const resList = computeClassResources();
  const resHtml = resList.map((r) => {
    const used = Math.min(r.max, resourceUsed(r.id));
    return `<div class="dash-pip-set"><span>${esc(r.label)}</span><div class="dash-pip-row">${Array.from({ length: r.max }, (_, p) => `<span class="dash-pip${p < used ? " used" : ""}"></span>`).join("")}</div></div>`;
  }).join("");
  const condHtml = (character.conditions || []).length
    ? (character.conditions || []).map((cd) => { const def = CONDITIONS.find((x) => x.key === cd.key); return `<span class="condition-chip" title="${esc(def?.effect || "")}"><b>${esc(def?.label || cd.key)}</b>${cd.rounds != null ? `<span class="cond-duration">${cd.rounds}r</span>` : ""}</span>`; }).join("")
    : `<span class="dash-empty">Nenhuma condição ativa.</span>`;
  const classLabel = refs.class ? `${titleOf(refs.class)}${refs.subclass ? ` (${titleOf(refs.subclass)})` : ""}` : "Sem classe";
  const primaryHd = Number(character.auto?.hitDice || hitDiceFrom(classInfo()) || 8) || 8;
  box.innerHTML = `
    <div class="dash-top">
      <div class="dash-name">${esc(character.name || "Personagem sem nome")}<small>${esc(classLabel)} · ${refs.race ? esc(titleOf(refs.race)) : "sem espécie"}</small>
        <div class="dash-level-row no-print">
          <span class="dash-level-stepper" title="Nível da classe principal (multiclasses têm nível próprio — use o assistente)">
            <button type="button" id="dash-level-dec" ${Number(character.level) <= 1 ? "disabled" : ""} title="Baixar nível">−</button>
            <b>nível ${totalLevel()}</b>
            <button type="button" id="dash-level-inc" ${totalLevel() >= 20 ? "disabled" : ""} title="Subir de nível">+</button>
          </span>
          ${refs.class && Number(character.level) > 1 ? `<button type="button" id="dash-roll-hd" title="Rola 1d${primaryHd} pro dado de vida do nível mais recente (o 1º nível já usa o máximo do dado, sem rolagem) e ajusta o PV máximo pela diferença em relação à média já usada — pra quem prefere rolar em vez de pegar a média ao subir de nível">🎲 Rolar dado de vida</button>` : ""}
        </div>
      </div>
      <div class="dash-stats">
        <div class="dash-stat"><span>CA</span><b>${c.ac}</b></div>
        <div class="dash-stat"><span>Iniciativa</span><b>${fmt(c.init)}</b></div>
        <div class="dash-stat"><span>Prof.</span><b>${fmt(c.pb)}</b></div>
        <div class="dash-stat"><span>Desloc.</span><b>${esc(c.speed)}</b></div>
      </div>
    </div>
    <div class="dash-row">
      <div class="turn-actions" data-turn-actions-slot></div>
      <div class="concentration-badge" data-concentration-slot></div>
    </div>
    <div class="dash-hp">
      <div class="dash-hp-delta no-print" title="Dano — escreva um valor e confirme (Enter ou ✓) pra tirar dos PV atuais">
        <input type="number" min="0" inputmode="numeric" id="dash-hp-dmg" placeholder="dano">
        <button type="button" id="dash-hp-dmg-btn" title="Aplicar dano">✓</button>
      </div>
      <div class="dash-hp-bar"><div class="dash-hp-fill ${hpBarClass(curHp, maxHp)}" style="width:${pct}%"></div><div class="dash-hp-label">${curHp} / ${maxHp}${character.hpTemp ? ` (+${character.hpTemp} temp)` : ""}</div></div>
      <div class="dash-hp-delta no-print" title="Cura — escreva um valor e confirme (Enter ou ✓) pra somar aos PV atuais (não passa do máximo)">
        <input type="number" min="0" inputmode="numeric" id="dash-hp-heal" placeholder="cura">
        <button type="button" id="dash-hp-heal-btn" title="Aplicar cura">✓</button>
      </div>
      <input id="dash-hp-input" type="number" value="${curHp}" title="Editar PV atual diretamente (define o valor exato)">
    </div>
    ${(slotsHtml || hdHtml || resHtml) ? `<div class="dash-row">
      ${hdHtml ? `<div class="dash-group"><div class="dash-group-title">Dados de vida</div><div class="dash-pips">${hdHtml}</div></div>` : ""}
      ${slotsHtml ? `<div class="dash-group"><div class="dash-group-title">Espaços de magia</div><div class="dash-pips">${slotsHtml}</div></div>` : ""}
      ${resHtml ? `<div class="dash-group"><div class="dash-group-title">Recursos de classe</div><div class="dash-pips">${resHtml}</div></div>` : ""}
    </div>` : ""}
    <div class="dash-row"><div class="dash-group"><div class="dash-group-title">Condições ativas</div><div class="dash-conditions">${condHtml}</div></div></div>`;
  $("dash-hp-input")?.addEventListener("change", () => {
    character.hpCurrent = Number($("dash-hp-input").value) || 0;
    saveCharacter(character); recalc();
  });
  // Caixinhas de dano/cura ao lado da barra de PV — escreve um valor e
  // confirma (Enter ou o botão ✓) pra somar/subtrair dos PV atuais, sem
  // precisar calcular a conta na cabeça. Não mexe em PV temporário.
  const applyHpDelta = (inputId, sign) => {
    const input = $(inputId);
    const delta = Number(input.value);
    if (!input.value || !Number.isFinite(delta) || delta <= 0) { input.value = ""; return; }
    const max = calc().hp;
    const cur = character.hpCurrent == null ? max : Number(character.hpCurrent) || 0;
    character.hpCurrent = Math.max(0, Math.min(max, cur + sign * delta));
    input.value = "";
    saveCharacter(character); recalc();
  };
  $("dash-hp-dmg")?.addEventListener("keydown", (e) => { if (e.key === "Enter") applyHpDelta("dash-hp-dmg", -1); });
  $("dash-hp-dmg-btn")?.addEventListener("click", () => applyHpDelta("dash-hp-dmg", -1));
  $("dash-hp-heal")?.addEventListener("keydown", (e) => { if (e.key === "Enter") applyHpDelta("dash-hp-heal", 1); });
  $("dash-hp-heal-btn")?.addEventListener("click", () => applyHpDelta("dash-hp-heal", 1));
  // Nível direto no painel — antes só dava pra subir de nível passando pelo
  // assistente guiado, e no celular o campo de nível do cabeçalho some
  // (.small-box{display:none} no responsivo), então não tinha jeito rápido.
  // Só mexe no nível da classe principal (character.level); multiclasses
  // continuam geridas pelo passo próprio do assistente.
  $("dash-level-dec")?.addEventListener("click", () => {
    character.level = Math.max(1, (Number(character.level) || 1) - 1);
    saveCharacter(character); recalc();
  });
  $("dash-level-inc")?.addEventListener("click", () => {
    if (totalLevel() >= 20) { toast("O personagem já está no nível 20."); return; }
    character.level = Math.max(1, Math.min(20, (Number(character.level) || 1) + 1));
    saveCharacter(character); recalc();
    toast(`Nível ${totalLevel()}! Confira "Características" e o assistente pra escolhas novas (talento, magias etc.).`);
  });
  $("dash-roll-hd")?.addEventListener("click", () => {
    const hd = Number(character.auto?.hitDice || hitDiceFrom(classInfo()) || 8) || 8;
    const roll = rollDie(hd), avg = hpAverage(hd), delta = roll - avg;
    character.hpModifier = (Number(character.hpModifier) || 0) + delta;
    saveCharacter(character); recalc();
    const msg = `Dado de vida: d${hd} (${roll}) — média seria ${avg} → PV máximo ${delta >= 0 ? "+" : ""}${delta}`;
    toast(msg);
    broadcastRoll("Dado de vida (nível)", `d${hd} (${roll}) vs média ${avg}`, roll, { type: "outro", note: ` — PV máx ${delta >= 0 ? "+" : ""}${delta}` });
  });
  renderTurnActions(); renderConcentration();
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
  let prepared = null, preparedEstimated = false;
  if (known == null) {
    // 2024: coluna "Prepared Spells" na tabela da classe (sem fórmula).
    const tp = tableCol(src, level, /prepared spells/i);
    if (tp != null) prepared = tp;
    else if (src.preparedSpells) prepared = preparedFromFormula(src.preparedSpells, level, abilMod);
    else { const tk = tableCol(src, level, /spells known/i); if (tk != null) known = tk; }
    // Classes de 2014 (e homebrew nos mesmos moldes) não trazem número
    // nenhum: quem prepara magias usa a fórmula do PHB — modificador do
    // atributo + nível na classe (metade, arredondada pra baixo, nos meio
    // conjuradores), mínimo 1. Sem isso a ficha ficava sem responder
    // "quantas eu posso preparar hoje?", que é a pergunta do dia a dia.
    if (prepared == null && known == null && prog !== "pact" && (slots || []).some(Boolean)) {
      const div = prog === "full" ? 1 : 2;
      prepared = Math.max(1, Math.floor(level / div) + abilMod);
      preparedEstimated = true;
    }
  }
  return {
    ability: abilKey, abilityMod: abilMod, progression: prog,
    label: CASTER_LABEL[prog] || "Conjurador",
    slots, pact, cantrips: cantrips ?? null, known: known ?? null, prepared: prepared ?? null,
    preparedEstimated,
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
    if (p.prepared != null) pips.push([p.preparedEstimated ? "Preparadas (calculado)" : "Preparadas", p.prepared]);
    if (p.known != null) pips.push(["Conhecidas", p.known]);
    if (p.ability) { pips.push(["CD", spellDc(proficiency(totalLevel()), p.abilityMod)]); pips.push(["Ataque", fmt(spellAttack(proficiency(totalLevel()), p.abilityMod))]); }
    return `<div class="spell-res-class"><b>${esc(p.classLabel)}</b><span>${esc(p.label)}${p.ability ? ` · ${ABILITY_NAMES[p.ability]}` : ""}</span>${pips.length ? `<div class="spell-res-pips">${pips.map(([k, v]) => `<div><span>${esc(k)}</span><b>${v}</b></div>`).join("")}</div>` : ""}</div>`;
  }).join("");
  const slotPips = (n, i) => { const used = Math.min(n, Number(character.spellSlotsUsed?.[i]) || 0); return Array.from({ length: n }, (_, p) => `<span class="resource-pip${p < used ? " used" : ""}" data-slot-pip="${i}:${p}"></span>`).join(""); };
  const slotBoxes = (slots || []).map((n, i) => n ? `<div class="slot-box"><span>${i + 1}º nível</span><b>${n - Math.min(n, Number(character.spellSlotsUsed?.[i]) || 0)}/${n}</b><div class="resource-pips">${slotPips(n, i)}</div></div>` : "").join("");
  const pactPips = (n) => { const used = Math.min(n, Number(character.pactSlotsUsed) || 0); return Array.from({ length: n }, (_, p) => `<span class="resource-pip${p < used ? " used" : ""}" data-pact-pip="${p}"></span>`).join(""); };
  const pactBoxes = pactCasters.map((p) => p.pact ? `<div class="slot-box pact"><span>${esc(p.classLabel)} · Pacto ${p.pact.level}º</span><b>${p.pact.count - Math.min(p.pact.count, Number(character.pactSlotsUsed) || 0)}/${p.pact.count}</b><div class="resource-pips">${pactPips(p.pact.count)}</div></div>` : "").join("");
  box.innerHTML = `<section class="paper-card spell-resources">
    <div class="spell-res-head"><h3>Recursos de conjuração</h3>${multi && nonPact.length ? `<span>Multiclasse · nível de conjurador combinado ${casterLevel}</span>` : ""}</div>
    ${classCards}
    ${slotBoxes || pactBoxes ? `<div class="slot-grid">${slotBoxes}${pactBoxes}</div><div class="resource-actions no-print"><span class="muted">Clique nos quadrados pra marcar espaços usados.</span><button type="button" class="reset-btn" id="reset-spell-slots">🔄 Reset (descanso longo)</button></div>` : `<p class="muted">Sem espaços de magia neste nível.</p>`}
  </section>`;
  box.querySelectorAll("[data-slot-pip]").forEach((p) => p.addEventListener("click", () => {
    const [lvl, idx] = p.dataset.slotPip.split(":").map(Number);
    const n = slots[lvl] || 0;
    character.spellSlotsUsed = character.spellSlotsUsed || Array(9).fill(0);
    const used = Math.min(n, Number(character.spellSlotsUsed[lvl]) || 0);
    character.spellSlotsUsed[lvl] = Math.max(0, Math.min(n, idx < used ? idx : idx + 1));
    saveCharacter(character); renderSpellResources(msi); renderDashboard(); repaintSpellBook();
  }));
  box.querySelectorAll("[data-pact-pip]").forEach((p) => p.addEventListener("click", () => {
    const idx = Number(p.dataset.pactPip);
    const n = pactCasters[0]?.pact?.count || 0;
    const used = Math.min(n, Number(character.pactSlotsUsed) || 0);
    character.pactSlotsUsed = Math.max(0, Math.min(n, idx < used ? idx : idx + 1));
    saveCharacter(character); renderSpellResources(msi); renderDashboard(); repaintSpellBook();
  }));
  $("reset-spell-slots")?.addEventListener("click", () => {
    character.spellSlotsUsed = Array(9).fill(0);
    character.pactSlotsUsed = 0;
    saveCharacter(character); renderSpellResources(msi); renderDashboard(); repaintSpellBook();
    toast("Espaços de magia restaurados.");
  });
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
// Magias adicionadas manualmente pelo Compêndio (fora da lista da classe
// — magia de item mágico, dom de raça homebrew sem dado estruturado etc.).
// Guardadas por id do catálogo; sempre aparecem no grimório com uma
// etiqueta "Manual", independente de classe/subclasse conjuradora.
function extraSpellRecords() {
  return (character.extraSpells || []).map((id) => {
    const e = manifest().find((x) => x.id === id);
    if (!e) return null;
    const rec = recordsForEntity(e)[0] || e;
    return { ...rec, _extra: true, _extraId: id };
  }).filter(Boolean);
}
function spellListHtml(spells, hasSubclass, active, limits) {
  const spellOrigin = (s) => {
    if (s._extra) return "Manual";
    if (!hasSubclass) return "";
    if (s._fromClass && s._fromSubclass) return `Classe + ${titleOf(active.subclassEntry)}`;
    if (s._fromSubclass) return titleOf(active.subclassEntry);
    if (s._fromClass) return titleOf(active.classEntry);
    return "";
  };
  const groups = Array.from({ length: 10 }, (_, i) => spells.filter((s) => spellLevel(s) === i));
  const slots = limits?.slots || [];
  const pact = limits?.pact || null;
  return groups.map((arr, lvl) => arr.length ? `<section class="paper-card spell-level"><div class="spell-level-head"><h3>${lvl === 0 ? "Truques" : `${lvl}º nível`}</h3><span>${arr.length} na lista</span>${
    (() => {
      const marked = arr.filter((s) => character.preparedSpells.includes(`${s.name}|${s.source || ""}`)).length;
      const chips = [];
      if (lvl === 0) {
        if (limits?.cantrips != null) chips.push(`<span class="spell-level-chip${marked > limits.cantrips ? " over" : ""}">${marked}/${limits.cantrips} truques conhecidos</span>`);
        else if (marked) chips.push(`<span class="spell-level-chip">${marked} marcados</span>`);
      } else {
        chips.push(`<span class="spell-level-chip">${marked} marcada(s)</span>`);
        const n = slots[lvl - 1] || 0;
        if (n) {
          const used = Math.min(n, Number(character.spellSlotsUsed?.[lvl - 1]) || 0);
          chips.push(`<span class="spell-level-chip slots">${n - used}/${n} espaços de ${lvl}º</span>`);
        } else if (pact && pact.level === lvl) {
          const used = Math.min(pact.count, Number(character.pactSlotsUsed) || 0);
          chips.push(`<span class="spell-level-chip slots">${pact.count - used}/${pact.count} espaços de Pacto</span>`);
        } else {
          chips.push(`<span class="spell-level-chip none">ainda fora do seu alcance</span>`);
        }
      }
      return chips.join("");
    })()
  }</div><div class="spell-list">${arr.map((s) => {
    const key = `${s.name}|${s.source || ""}`;
    const checked = character.preparedSpells.includes(key);
    const origin = spellOrigin(s);
    const originCls = s._extra ? "from-extra" : s._fromSubclass && s._fromClass ? "from-both" : s._fromSubclass ? "from-subclass" : "from-class";
    const originTag = origin ? ` · <b class="spell-origin ${originCls}">${esc(origin)}</b>` : "";
    return `<label class="spell-line"><input type="checkbox" data-spell="${esc(key)}" ${checked ? "checked" : ""}><span class="spell-dot">${checked ? "●" : "○"}</span><strong>${esc(s.name)}</strong><span class="spell-meta">${esc(s.source || "")}${s.school ? ` · ${esc(s.school)}` : ""}${spellTime(s) ? ` · ${esc(spellTime(s))}` : ""}${originTag}</span><button type="button" class="spell-info" data-spell-key="${esc(key)}">ⓘ</button>${s._extra ? `<button type="button" class="remove-btn no-print" data-remove-extra-spell="${esc(s._extraId)}" title="Remover">×</button>` : ""}</label>`;
  }).join("")}</div></section>` : "").join("");
}
// Último grimório pintado (magias já carregadas + limites) — permite
// repintar os contadores de "preparadas/espaços" na hora em que uma
// magia é marcada, sem refazer o fetch da lista da classe.
let lastSpellPaint = null;
function repaintSpellBook() {
  if (!lastSpellPaint) return;
  const box = $("spellbook");
  if (!box) return;
  const { spells, limits, active, hasSubclass } = lastSpellPaint;
  const scroll = window.scrollY;
  box.innerHTML = (active ? renderPrepareBanner(spells, limits, active) : "")
    + (spellListHtml(spells, hasSubclass, active, limits) || `<div class="paper-card empty">Nenhuma magia.</div>`);
  wireSpellListEvents(box);
  window.scrollTo({ top: scroll });
}
function wireSpellListEvents(box) {
  box.querySelectorAll("[data-spell]").forEach((i) => i.addEventListener("change", () => {
    toggleIn(character.preparedSpells, i.dataset.spell, i.checked);
    saveCharacter(character);
    i.nextElementSibling.textContent = i.checked ? "●" : "○";
    repaintSpellBook();
  }));
  box.querySelectorAll("[data-spell-key]").forEach((b) => b.addEventListener("click", () => {
    const [name, source] = b.dataset.spellKey.split("|");
    const e = manifest().find((x) => normType(x.type) === "spell" && x.name === name && (x.source || "") === source);
    if (e) openEntityModal(e);
  }));
  box.querySelectorAll("[data-remove-extra-spell]").forEach((b) => b.addEventListener("click", () => {
    const id = b.dataset.removeExtraSpell;
    const e = manifest().find((x) => x.id === id);
    character.extraSpells = (character.extraSpells || []).filter((x) => x !== id);
    if (e) { const key = `${e.name}|${e.source || ""}`; character.preparedSpells = character.preparedSpells.filter((k) => k !== key); }
    saveCharacter(character); renderSpells();
  }));
}
// Faixa no topo do grimório: quantas magias/truques a classe deixa
// preparar (ou conhecer) neste nível, quantas já estão marcadas e até
// que nível de magia os espaços alcançam. Sem isso, a lista completa da
// classe não dizia quantas dela você pode de fato levar pro dia.
function renderPrepareBanner(spells, limits, active) {
  if (!limits) return "";
  const isPrepared = (s) => character.preparedSpells.includes(`${s.name}|${s.source || ""}`);
  const markedCantrips = spells.filter((s) => spellLevel(s) === 0 && isPrepared(s)).length;
  const markedSpells = spells.filter((s) => spellLevel(s) > 0 && isPrepared(s)).length;
  const maxSlotLevel = (limits.slots || []).reduce((m, n, i) => (n ? i + 1 : m), 0);
  const maxLevel = Math.max(maxSlotLevel, limits.pact?.level || 0);
  const cap = limits.prepared ?? limits.known ?? null;
  const capLabel = limits.prepared != null ? (limits.preparedEstimated ? "Preparadas (calculado)" : "Preparadas") : limits.known != null ? "Conhecidas" : "Marcadas";
  const capHint = limits.preparedEstimated
    ? `A tabela desta classe não traz a coluna de magias preparadas (é o caso de todas as classes de 2014), então o número vem da fórmula do PHB: ${ABILITY_NAMES[limits.ability] || "modificador"} ${fmt(limits.abilityMod || 0)} + ${limits.progression === "full" ? "nível na classe" : "metade do nível na classe"}.`
    : "";
  const pill = (label, value, cls = "") => `<div class="prep-pill ${cls}"><span>${esc(label)}</span><b>${esc(String(value))}</b></div>`;
  return `<section class="paper-card prepare-banner">
    <div class="prepare-head"><h3>Quanto você leva de ${esc(titleOf(active.classEntry))} no nível ${active.level}</h3>
      <span class="muted">Marque na lista abaixo — a lista mostra TODAS as magias que a classe pode aprender.</span></div>
    ${capHint ? `<p class="prepare-hint">${esc(capHint)}</p>` : ""}
    <div class="prepare-pills">
      ${limits.cantrips != null ? pill("Truques", `${markedCantrips}/${limits.cantrips}`, markedCantrips > limits.cantrips ? "over" : "") : ""}
      ${cap != null ? pill(capLabel, `${markedSpells}/${cap}`, markedSpells > cap ? "over" : "") : pill(capLabel, markedSpells)}
      ${maxLevel ? pill("Nível máx. de magia", `${maxLevel}º`) : ""}
      ${(limits.slots || []).map((n, i) => n ? pill(`${i + 1}º nível`, `${n - Math.min(n, Number(character.spellSlotsUsed?.[i]) || 0)}/${n} espaços`, "slot") : "").join("")}
      ${limits.pact ? pill(`Pacto ${limits.pact.level}º`, `${limits.pact.count - Math.min(limits.pact.count, Number(character.pactSlotsUsed) || 0)}/${limits.pact.count} espaços`, "slot pact") : ""}
    </div>
  </section>`;
}
async function renderSpells() {
  const box = $("spellbook"), c = calc(), ab = c.sa;
  $("spell-ability").textContent = ab ? ABILITY_NAMES[ab] : "—";
  if ($("spell-ability-override")) $("spell-ability-override").value = character.manualSpellAbility ? (character.spellAbility || "") : "";
  $("spell-dc-big").textContent = c.dc ?? "—";
  $("spell-atk-big").textContent = c.atk != null ? fmt(c.atk) : "—";
  const msi = multiclassSpellcasting();
  renderSpellResources(msi);
  const casters = spellcastingClasses().filter((cc) => spellcastingInfoFor(cc.cr, cc.sr, cc.level));
  const tabsBox = $("spellbook-tabs");
  if (!casters.length) {
    const extras = extraSpellRecords();
    $("spell-count").textContent = String(extras.length);
    if (tabsBox) tabsBox.innerHTML = "";
    if (!extras.length) { box.innerHTML = `<div class="paper-card empty">Escolha uma classe conjuradora para carregar a lista de magias — ou adicione magias avulsas pelo Compêndio.</div>`; return; }
    lastSpellPaint = { spells: extras, limits: null, active: null, hasSubclass: false };
    box.innerHTML = spellListHtml(extras, false, null, null) || `<div class="paper-card empty">Nenhuma magia.</div>`;
    wireSpellListEvents(box);
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
  // Magias avulsas adicionadas pelo Compêndio aparecem junto — só na aba
  // ativa (evita duplicar em cada classe de um multiclasse conjurador).
  for (const ex of extraSpellRecords()) {
    if (!spells.some((s) => s.name === ex.name && (s.source || "") === (ex.source || ""))) spells.push(ex);
  }
  $("spell-count").textContent = spells.length;
  // Com subclasse escolhida, deixa explícito se cada magia vem da lista da
  // classe, é concedida pela subclasse (domínio/círculo/patrono…) ou as duas.
  const hasSubclass = !!active.subclassEntry;
  // Limites da classe ATIVA (truques/preparadas/conhecidas) + os espaços
  // efetivos do personagem (combinados quando é multiclasse) — é o que
  // alimenta os contadores por nível no cabeçalho de cada bloco.
  const activeInfo = spellcastingInfoFor(active.cr, active.sr, active.level);
  const limits = {
    cantrips: activeInfo?.cantrips ?? null,
    prepared: activeInfo?.prepared ?? null,
    preparedEstimated: !!activeInfo?.preparedEstimated,
    known: activeInfo?.known ?? null,
    ability: activeInfo?.ability || null,
    abilityMod: activeInfo?.abilityMod || 0,
    progression: activeInfo?.progression || "",
    slots: msi?.slots || activeInfo?.slots || [],
    pact: activeInfo?.pact || msi?.perClass.find((p) => p.pact)?.pact || null,
  };
  lastSpellPaint = { spells, limits, active, hasSubclass };
  box.innerHTML = renderPrepareBanner(spells, limits, active)
    + (spellListHtml(spells, hasSubclass, active, limits) || `<div class="paper-card empty">Nenhuma magia foi associada a esta classe nesta edição.</div>`);
  wireSpellListEvents(box);
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
// Peso do item: usa o valor manual salvo (x.weight, em libras) quando a
// pessoa digitou um; senão cai pro peso do registro do compêndio (quando o
// item veio de lá, via x.id) — itens digitados à mão sem id ficam 0 até
// alguém preencher.
function itemWeight(x) {
  if (x.weight != null && x.weight !== "") { const w = Number(x.weight); if (!Number.isNaN(w)) return w; }
  return Number(invItemRecord(x)?.weight) || 0;
}
// Regra de carga do PHB: capacidade máxima = Força × 15; as faixas de
// sobrecarga (variante "Encumbrance") a Força × 5/× 10 já dão um aviso útil
// à mesa mesmo pra quem não usa a variante — moedas contam 50 por libra.
function carryingCapacity() {
  const str = Number(effScore("str")) || 10;
  const itemsWeight = (character.inventory || []).reduce((sum, x) => sum + itemWeight(x) * (Number(x.qty) || 1), 0);
  const coinsWeight = Object.values(character.coins || {}).reduce((s, n) => s + (Number(n) || 0), 0) / 50;
  const total = itemsWeight + coinsWeight;
  return { total, max: str * 15, encumbered: str * 5, heavily: str * 10, str };
}
function renderCarryCapacity() {
  const box = $("carry-summary");
  if (!box) return;
  const cc = carryingCapacity();
  const pct = cc.max > 0 ? Math.min(100, (cc.total / cc.max) * 100) : 0;
  let cls = "ok", label = "Carga normal";
  if (cc.total > cc.max) { cls = "critical"; label = "Acima da capacidade! Sem se mover (exceto arrastando)"; }
  else if (cc.total >= cc.heavily) { cls = "critical"; label = "Muito sobrecarregado (-20 pés, desvantagem em FOR/DES/CON)"; }
  else if (cc.total >= cc.encumbered) { cls = "warn"; label = "Sobrecarregado (-10 pés de deslocamento)"; }
  box.innerHTML = `
    <div class="carry-bar-row"><div class="dash-hp-bar"><div class="dash-hp-fill ${cls}" style="width:${pct}%"></div><div class="dash-hp-label">${cc.total.toLocaleString("pt-BR", { maximumFractionDigits: 1 })} / ${cc.max} lb</div></div></div>
    <p class="carry-note muted">${label} · capacidade = Força (${cc.str}) × 15. Sobrecarregado a partir de ${cc.encumbered} lb, muito sobrecarregado a partir de ${cc.heavily} lb (regra opcional de carga do PHB).</p>`;
}
async function renderInventory() {
  const arr = character.inventory || [];
  if (arr.some((x) => x.id)) { try { await ensureCatalog("item"); } catch (err) { console.warn("Catálogo de itens indisponível:", err); } }
  $("inventory-list").innerHTML = arr.length ? arr.map((x, i) => {
    const at = armorTypeOf(invItemRecord(x));
    const equipBtn = at ? `<button type="button" class="equip-btn${x.equipped ? " on" : ""}" data-equip-inv="${i}" title="${at === "shield" ? "Escudo" : `Armadura ${{ light: "leve", medium: "média", heavy: "pesada" }[at]}`}">${x.equipped ? "✓ Equipada" : "Equipar"}</button>` : "";
    return `<div class="inventory-row"><div><strong>${esc(x.name)}</strong><small>${esc(x.meta || "")}</small></div>${equipBtn}<input type="number" min="0" value="${Number(x.qty) || 1}" data-qty="${i}"><input type="number" min="0" step="0.1" value="${itemWeight(x) || ""}" placeholder="lb" title="Peso unitário (libras)" data-weight="${i}"><button class="remove-btn no-print" data-remove-inv="${i}">×</button></div>`;
  }).join("") : `<div class="empty">Seu inventário está vazio. Abra uma categoria acima para adicionar itens.</div>`;
  $("inventory-list").querySelectorAll("[data-qty]").forEach((i) => i.addEventListener("input", () => { character.inventory[Number(i.dataset.qty)].qty = Number(i.value) || 0; saveCharacter(character); renderCarryCapacity(); }));
  $("inventory-list").querySelectorAll("[data-weight]").forEach((i) => i.addEventListener("input", () => { character.inventory[Number(i.dataset.weight)].weight = i.value === "" ? null : Number(i.value) || 0; saveCharacter(character); renderCarryCapacity(); }));
  $("inventory-list").querySelectorAll("[data-remove-inv]").forEach((b) => b.addEventListener("click", () => { character.inventory.splice(Number(b.dataset.removeInv), 1); saveCharacter(character); renderInventory(); recalc(); }));
  $("inventory-list").querySelectorAll("[data-equip-inv]").forEach((b) => b.addEventListener("click", () => toggleEquip(Number(b.dataset.equipInv))));
  renderCarryCapacity();
}
// Equipar uma armadura de corpo/escudo desequipa automaticamente outro
// item do mesmo grupo (só dá pra vestir uma armadura e usar um escudo
// por vez) — sem isso a CA somaria peças incompatíveis.
function toggleEquip(idx) {
  const item = character.inventory?.[idx];
  const at = armorTypeOf(invItemRecord(item));
  if (!item || !at) return;
  const turningOn = !item.equipped;
  if (turningOn) {
    const group = at === "shield" ? "shield" : "body";
    character.inventory.forEach((x, i) => {
      if (i === idx || !x.equipped) return;
      const xat = armorTypeOf(invItemRecord(x));
      if ((xat === "shield" ? "shield" : xat ? "body" : null) === group) x.equipped = false;
    });
  }
  item.equipped = turningOn;
  saveCharacter(character);
  renderInventory();
  recalc();
  toast(turningOn ? `${item.name} equipada.` : `${item.name} desequipada.`);
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
// Adiciona um talento à lista de "Talentos Extras" — mesma ação usada
// pelo seletor dedicado (openExtraFeatPicker) e pelo botão "+ Adicionar à
// ficha" do Compêndio.
function addExtraFeat(id) {
  const e = manifest().find((x) => x.id === id);
  if (!e) return;
  character.extraFeats = character.extraFeats || [];
  if (character.extraFeats.includes(id)) { toast("Esse talento já foi adicionado."); return; }
  character.extraFeats.push(id);
  saveCharacter(character);
  renderExtraFeats(); recalc();
  toast(`${titleOf(e)} adicionado.`);
}
// Adiciona uma magia avulsa (fora da lista da classe) ao grimório — ela
// aparece marcada como preparada/conhecida com a etiqueta "Manual".
function addExtraSpell(id) {
  const e = manifest().find((x) => x.id === id);
  if (!e) return;
  character.extraSpells = character.extraSpells || [];
  if (character.extraSpells.includes(id)) { toast("Essa magia já foi adicionada."); return; }
  character.extraSpells.push(id);
  const key = `${e.name}|${e.source || ""}`;
  character.preparedSpells = character.preparedSpells || [];
  if (!character.preparedSpells.includes(key)) character.preparedSpells.push(key);
  saveCharacter(character);
  recalc();
  toast(`${titleOf(e)} adicionada.`);
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
function renderStartingEquipment(panelId, bodyId, btnId) {
  panelId = panelId || "starting-equipment"; bodyId = bodyId || "starting-equipment-body"; btnId = btnId || "apply-starting-equip";
  const panel = $(panelId), body = $(bodyId);
  if (!panel || !body) return;
  const groups = startingEquipGroups();
  if (!groups.length) { panel.classList.add("hidden"); body.innerHTML = `<p class="muted">Escolha uma classe e um background para ver o equipamento inicial.</p>`; return; }
  panel.classList.remove("hidden");
  const store = character.choiceSelections.startingEquip || {};
  body.innerHTML = groups.map((g) => {
    const key = `${g.src}:${g.idx}`;
    const chosen = store[key] || (g.options[0] && g.options[0].letter);
    const fixedHtml = g.fixed.length ? `<div class="eq-fixed">${g.fixed.map((e) => `<span>${esc(equipEntryLabel(e))}</span>`).join("")}</div>` : "";
    const optsHtml = g.options.length ? `<div class="eq-options">${g.options.map((o) => `<label class="eq-option${o.letter === chosen ? " on" : ""}"><input type="radio" name="eq-${esc(bodyId)}-${esc(key)}" data-eq-choice="${esc(key)}" value="${esc(o.letter)}" ${o.letter === chosen ? "checked" : ""}><b>${esc(o.letter)}</b><span>${o.entries.map((e) => esc(equipEntryLabel(e))).join(", ") || "—"}</span></label>`).join("")}</div>` : "";
    return `<div class="eq-group"><div class="eq-group-head">${esc(g.label)}${g.options.length ? " — escolha uma opção" : ""}</div>${fixedHtml}${optsHtml}</div>`;
  }).join("") + `<div class="eq-actions"><button type="button" id="${esc(btnId)}" class="add-btn">Adicionar ao inventário</button>${character.equipApplied ? '<span class="muted">Já adicionado uma vez.</span>' : ""}</div>`;
  body.querySelectorAll("[data-eq-choice]").forEach((r) => r.addEventListener("change", () => {
    character.choiceSelections.startingEquip = character.choiceSelections.startingEquip || {};
    character.choiceSelections.startingEquip[r.dataset.eqChoice] = r.value;
    saveCharacter(character); renderStartingEquipment(panelId, bodyId, btnId);
  }));
  $(btnId)?.addEventListener("click", () => applyStartingEquipment(panelId, bodyId, btnId));
}
function applyStartingEquipment(panelId, bodyId, btnId) {
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
  renderInventory(); renderStartingEquipment(panelId, bodyId, btnId);
  toast(`${added} item(ns)${cp ? ` + ${(cp / 100).toLocaleString("pt-BR")} po` : ""} no inventário.`);
}

// Só aparece quando os PV atuais chegam a 0 — regra 5e de "morrendo".
// Nat 20 = recupera 1 PV e volta à consciência; nat 1 = conta como 2
// falhas; 3 sucessos = estabilizado; 3 falhas = morto.
function renderDeath(c) {
  const box = $("death-panel");
  if (!box) return;
  const maxHp = c ? c.hp : calc().hp;
  const curHp = character.hpCurrent == null ? maxHp : Number(character.hpCurrent) || 0;
  if (curHp > 0) { box.className = ""; box.innerHTML = ""; return; }
  const d = character.deathSaves || { success: 0, failure: 0 };
  const stable = d.success >= 3, dead = d.failure >= 3;
  box.className = "death death-critical";
  const pipRow = (label, key, n) => `<div class="death-row"><span>${label}</span>${Array.from({ length: 3 }, (_, i) => `<button type="button" class="death-pip${i < n ? " on" : ""}" data-death="${key}${i}">${i < n ? "●" : "○"}</button>`).join("")}</div>`;
  box.innerHTML = `<div class="death-title">⚠️ Testes de Resistência contra a Morte</div>
    ${pipRow("Sucessos", "s", d.success)}
    ${pipRow("Falhas", "f", d.failure)}
    ${stable ? `<div class="death-status stable">ESTABILIZADO</div>` : dead ? `<div class="death-status dead">MORREU</div>` : ""}
    <div class="death-actions">
      ${!stable && !dead ? `<button type="button" id="death-roll">🎲 Rolar teste de morte</button>` : ""}
      ${stable ? `<button type="button" id="death-reset">🔄 Reset (estabilizado)</button>` : ""}
    </div>`;
  box.querySelectorAll("[data-death]").forEach((b) => b.addEventListener("click", () => {
    const k = b.dataset.death[0] === "s" ? "success" : "failure", i = Number(b.dataset.death[1]);
    d[k] = i < d[k] ? i : i + 1;
    character.deathSaves = d; saveCharacter(character); recalc();
  }));
  $("death-roll")?.addEventListener("click", () => {
    const roll = rollDie(20);
    let outcome;
    if (roll === 20) { d.success = 0; d.failure = 0; character.hpCurrent = 1; toast("Rolou 20 natural! Recupera 1 PV e volta à consciência."); outcome = "20 natural — recupera 1 PV e volta à consciência!"; }
    else if (roll === 1) { d.failure = Math.min(3, d.failure + 2); toast("Rolou 1 natural — conta como 2 falhas."); outcome = "1 natural — conta como 2 falhas"; }
    else if (roll >= 10) { d.success = Math.min(3, d.success + 1); toast(`Rolou ${roll} — sucesso (CD 10).`); outcome = "sucesso (CD 10)"; }
    else { d.failure = Math.min(3, d.failure + 1); toast(`Rolou ${roll} — falha (CD 10).`); outcome = "falha (CD 10)"; }
    character.deathSaves = d; saveCharacter(character); recalc();
    broadcastRoll("Teste de Resistência contra a Morte", `d20 (${roll})`, outcome, { type: "morte" });
  });
  $("death-reset")?.addEventListener("click", () => {
    character.deathSaves = { success: 0, failure: 0 };
    saveCharacter(character); recalc();
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
    if (codexState.content === "official" && isNonOfficial(e)) return false;
    if (codexState.content === "homebrew" && !isNonOfficial(e)) return false;
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
// Tipos "pesados" (magia/item/talento) só são carregados sob demanda —
// sem isso, filtrar o Compêndio por eles (ou por "Tudo") não achava nada.
const COMPENDIUM_LAZY_TYPES = ["spell", "item", "feat", "optionalfeature"];
// Tipos que dá pra jogar direto na ficha a partir do Compêndio (itens vão
// pro inventário, magias pro grimório como "avulsa", talentos pra lista
// de talentos extras).
const COMPENDIUM_ADDABLE = { spell: addExtraSpell, item: addInventory, feat: addExtraFeat };
async function renderCompendium() {
  const q = $("compendium-search").value.trim().toLowerCase(), t = $("compendium-type").value;
  const toLoad = t === "all" ? COMPENDIUM_LAZY_TYPES : COMPENDIUM_LAZY_TYPES.filter((x) => x === t);
  if (toLoad.length) {
    $("compendium-results").innerHTML = `<div class="empty">Carregando catálogo…</div>`;
    await Promise.all(toLoad.map((lt) => ensureCatalog(lt).catch((err) => console.warn(`Catálogo (${lt}) indisponível:`, err))));
  }
  let arr = manifest().filter((e) =>
    (t === "all" || normType(e.type) === t) &&
    matchesEdition(e, character.edition, true) &&
    (!q || `${titleOf(e)} ${e.source || ""}`.toLowerCase().includes(q))
  ).slice(0, 240);
  $("compendium-results").innerHTML = arr.map((e) => {
    const addable = COMPENDIUM_ADDABLE[normType(e.type)];
    return `<article class="catalog-card"><div class="pick-top"><strong>${esc(titleOf(e))}</strong>${sourceTag(e)}</div><div class="pick-meta">${esc(typeLabel(e.type))} · ${esc(labelMeta(e))}</div><div class="catalog-actions"><button data-comp-info="${esc(e.id)}">ⓘ Ver detalhes</button>${addable ? `<button class="add-btn" data-comp-add="${esc(e.id)}">+ Adicionar à ficha</button>` : ""}</div></article>`;
  }).join("") || `<div class="empty">Nenhum resultado.</div>`;
  $("compendium-results").querySelectorAll("[data-comp-info]").forEach((b) => b.addEventListener("click", () => { const e = manifest().find((x) => x.id === b.dataset.compInfo); if (e) openEntityModal(e); }));
  $("compendium-results").querySelectorAll("[data-comp-add]").forEach((b) => b.addEventListener("click", () => {
    const e = manifest().find((x) => x.id === b.dataset.compAdd);
    const fn = e && COMPENDIUM_ADDABLE[normType(e.type)];
    if (fn) fn(e.id);
  }));
}

// ------------------------------------------------------------
// Monstros (kit do mestre) — independente do personagem aberto na
// ficha. Duas fontes: o bestiário oficial do 5etools (baixado sob
// demanda, por livro/aventura — mesmo padrão de spellsForClass) e
// monstros criados na mão. Os dois formatos são normalizados na hora de
// desenhar o stat block (ver monsterAC/monsterHp/monsterSpeed/etc.), pra
// um único renderizador cobrir os dois casos. Cada botão de rolagem
// (ataque, dano, resistência/perícia, iniciativa, dado de vida) manda a
// rolagem pro Discord com sendToDiscord, do mesmo jeito que os ataques
// do personagem — só troca o nome de quem rolou.
// ------------------------------------------------------------
function crText(cr) {
  if (cr == null) return "—";
  if (typeof cr === "object") return crText(cr.cr) + (cr.lair ? ` (covil ${crText(cr.lair)})` : "");
  return String(cr);
}
function monsterTypeText(t) {
  if (t == null) return "";
  if (typeof t === "string") return t;
  const tags = Array.isArray(t.tags) ? t.tags.map((x) => (typeof x === "string" ? x : x.tag)).join(", ") : "";
  return `${t.type || ""}${tags ? ` (${tags})` : ""}`;
}
function monsterSizeText(s) {
  const MAP = { T: "Miúdo", S: "Pequeno", M: "Médio", L: "Grande", H: "Enorme", G: "Colossal" };
  const arr = Array.isArray(s) ? s : [s];
  return arr.filter(Boolean).map((x) => MAP[x] || x).join("/") || "—";
}
function monsterAbilityMod(m, key) { return mod(Number(m?.[key]) || 10); }
function monsterPassive(m) {
  if (m.passive != null) return m.passive;
  return 10 + monsterAbilityMod(m, "wis");
}
function monsterAC(m) {
  if (m.ac == null) return "—";
  if (Array.isArray(m.ac)) {
    return m.ac.map((a) => {
      if (typeof a === "number") return String(a);
      const src = a.from ? a.from.map((f) => esc(inlineTags(f))).join(", ") : a.condition ? esc(inlineTags(a.condition)) : "";
      return `${a.ac}${src ? ` (${src})` : ""}`;
    }).join(" / ");
  }
  return `${m.ac}${m.acNote ? ` (${esc(m.acNote)})` : ""}`;
}
function monsterHpAverage(m) {
  if (m.hp && typeof m.hp === "object" && m.hp.average != null) return m.hp.average;
  return null;
}
function monsterHp(m) {
  const avg = monsterHpAverage(m);
  const formula = m.hp?.formula;
  if (avg == null && !formula) return "—";
  return `${avg ?? "—"}${formula ? ` (${esc(formula)})` : ""}`;
}
const SPEED_LABELS = { walk: "", fly: "voo ", swim: "natação ", climb: "escalada ", burrow: "escavação " };
function monsterSpeed(m) {
  if (m.speed && typeof m.speed === "object") {
    const parts = Object.entries(m.speed)
      .filter(([k, v]) => v && k !== "canHover" && k !== "choose")
      .map(([k, v]) => `${SPEED_LABELS[k] ?? `${k} `}${typeof v === "object" ? v.number : v} pés`);
    return parts.join(", ") || "—";
  }
  return m.speedText || "—";
}
function monsterSenses(m) {
  const parts = [];
  if (Array.isArray(m.senses) && m.senses.length) parts.push(m.senses.map((s) => esc(inlineTags(s))).join(", "));
  else if (m.sensesText) parts.push(esc(m.sensesText));
  parts.push(`percepção passiva ${monsterPassive(m)}`);
  return parts.join(", ");
}
function monsterLanguages(m) {
  if (Array.isArray(m.languages) && m.languages.length) return m.languages.map((l) => esc(inlineTags(l))).join(", ");
  if (m.languagesText) return esc(m.languagesText);
  return "—";
}
function monsterAlignmentText(m) {
  if (typeof m.alignment === "string") return m.alignment;
  if (Array.isArray(m.alignment)) return m.alignment.map((a) => (typeof a === "string" ? a : a.alignment?.join?.("") || "")).join(" ou ");
  return m.alignmentText || "—";
}
// Extrai bônus de ataque ({@hit N}) e expressão de dano ({@damage NdM+B})
// de dentro do texto bruto (entries) de uma ação oficial do 5etools —
// usado só quando a ação não já traz toHit/damageExpr estruturados
// (caso dos monstros criados na mão, ver openMonsterCreateModal).
function extractRollablesFromEntries(entries) {
  const raw = JSON.stringify(entries ?? "");
  const hitM = raw.match(/\{@hit\s+(-?\d+)/i);
  const dmgM = raw.match(/\{@(?:damage|dice)\s+([^}|"\\]+)/i);
  return { toHit: hitM ? Number(hitM[1]) : null, damageExpr: dmgM ? dmgM[1].trim() : null };
}
function actionText(a) { return a.text != null ? esc(a.text) : esc(plainOf(a.entries)); }
function actionRollables(a) {
  if (a.toHit != null || a.damageExpr) return { toHit: a.toHit ?? null, damageExpr: a.damageExpr || null };
  return extractRollablesFromEntries(a.entries ?? a.headerEntries);
}
// Normaliza os grupos de ações do monstro (oficial ou criado na mão) num
// único formato { trait, action, bonus, reaction, legendary }. Se o
// monstro não tem ações lendárias próprias mas aponta pra um
// legendaryGroup (5etools compartilha o texto entre vários monstros da
// mesma "família", ex. todos os dragões), busca o grupo já carregado.
function normalizeMonsterGroups(m) {
  const groups = {
    trait: m.trait || [],
    action: m.action || [],
    bonus: m.bonus || [],
    reaction: m.reaction || [],
    legendary: m.legendary || [],
    spellcasting: m.spellcasting || [],
  };
  if (!groups.legendary.length && m.legendaryGroup) {
    const g = monsterLegendaryGroups.find((x) => String(x.name).toLowerCase() === String(m.legendaryGroup.name).toLowerCase() && String(x.source).toLowerCase() === String(m.legendaryGroup.source).toLowerCase());
    if (g?.legendary) groups.legendary = g.legendary;
  }
  return groups;
}
function monsterEntryHtml(a, idx, kind) {
  const name = a.name ? esc(inlineTags(a.name)) : "";
  const text = actionText(a);
  const { toHit, damageExpr } = actionRollables(a);
  const btns = [];
  if (toHit != null) btns.push(`<button type="button" class="mon-roll-btn" data-mon-attack="${idx}" data-mon-kind="${esc(kind)}">🎯 Ataque ${fmt(toHit)}</button>`);
  if (damageExpr) btns.push(`<button type="button" class="mon-roll-btn" data-mon-damage="${idx}" data-mon-kind="${esc(kind)}">💥 Dano ${esc(damageExpr)}</button>`);
  return `<div class="monster-action-row"><p>${name ? `<strong>${name}.</strong> ` : ""}${text}</p>${btns.length ? `<div class="monster-action-btns">${btns.join("")}</div>` : ""}</div>`;
}
function monsterEntryGroupHtml(list, kind) {
  if (!list?.length) return "";
  return list.map((a, i) => monsterEntryHtml(a, i, kind)).join("");
}
// Extrai o bônus numérico de um valor bruto de save/skill do 5etools
// ({@dc}, "+5", {special:"+5"}...) — null se não der pra converter.
function parseBonusNum(v) {
  const n = parseInt(String(typeof v === "object" ? v?.special || "" : v ?? "").replace(/[^-\d]/g, ""), 10);
  return Number.isNaN(n) ? null : n;
}
// Bônus de resistência/perícia do monstro: usa o valor listado no
// bloco (já inclui proficiência/expertise) quando existe, senão cai
// pro modificador puro do atributo — assim dá pra rolar qualquer
// resistência/perícia, proficiente ou não.
function monsterSaveBonus(m, ability) {
  const n = parseBonusNum(m.save?.[ability]);
  return n != null ? n : monsterAbilityMod(m, ability);
}
function monsterSkillBonus(m, key, ability) {
  const n = parseBonusNum(m.skill?.[key]);
  return n != null ? n : monsterAbilityMod(m, ability);
}
function allSavesButtonsHtml(m) {
  return ABILITIES.map((a) => {
    const proficient = parseBonusNum(m.save?.[a]) != null;
    const n = monsterSaveBonus(m, a);
    return `<button type="button" class="mon-roll-btn${proficient ? " mon-roll-prof" : ""}" data-mon-bonus-roll="${n}" data-mon-bonus-label="Resistência de ${esc(ABILITY_NAMES[a])}">${esc(ABILITY_NAMES[a].slice(0, 3))} ${fmt(n)}</button>`;
  }).join(" ");
}
function allSkillsButtonsHtml(m) {
  return SKILLS.map(([key, label, ability]) => {
    const proficient = parseBonusNum(m.skill?.[key]) != null;
    const n = monsterSkillBonus(m, key, ability);
    return `<button type="button" class="mon-roll-btn${proficient ? " mon-roll-prof" : ""}" data-mon-bonus-roll="${n}" data-mon-bonus-label="${esc(label)}">${esc(label)} ${fmt(n)}</button>`;
  }).join(" ");
}
function monsterSpellcastingHtml(m) {
  if (!Array.isArray(m.spellcasting) || !m.spellcasting.length) return "";
  return m.spellcasting.map((sc, idx) => {
    const name = sc.name ? esc(inlineTags(sc.name)) : "";
    const text = esc(plainOf(sc.headerEntries || sc.entries || ""));
    const { toHit } = actionRollables(sc);
    const btn = toHit != null ? `<div class="monster-action-btns"><button type="button" class="mon-roll-btn" data-mon-attack="${idx}" data-mon-kind="spellcasting">🎯 Ataque com magia ${fmt(toHit)}</button></div>` : "";
    return `<div class="monster-action-row"><p>${name ? `<strong>${name}.</strong> ` : ""}${text}</p>${btn}</div>`;
  }).join("");
}
function monsterCardTag(m) {
  const src = m.custom ? "Criado" : (m.source || "—");
  return `<span class="tag ${m.custom ? "brew" : "official"}">${m.custom ? "CRIADO" : "OFICIAL"} · ${esc(src)}</span>`;
}
async function renderMonsterStatblock(m) {
  if (m.legendaryGroup && !monsterLegendaryGroups.length) monsterLegendaryGroups = await loadLegendaryGroups().catch(() => []);
  currentModalMonster = m;
  currentModalMonsterGroups = normalizeMonsterGroups(m);
  const g = currentModalMonsterGroups;
  const hpFormula = m.hp?.formula;
  $("modal-content").innerHTML = `
    <div class="modal-title"><div><span class="eyebrow">${m.custom ? "MONSTRO CRIADO" : "BESTIÁRIO 5E"}</span><h2>${esc(m.name || "Monstro")}</h2><p class="muted">${esc(monsterSizeText(m.size))} · ${esc(monsterTypeText(m.type) || m.typeText || "—")}, ${esc(monsterAlignmentText(m))} — CD ${esc(crText(m.cr))}${m.source ? ` · ${esc(m.source)}` : ""}</p></div></div>
    <div class="modal-body monster-statblock">
      <div class="monster-top-stats">
        <div><span>CA</span><b>${monsterAC(m)}</b></div>
        <div><span>PV</span><b>${monsterHp(m)}</b>${hpFormula ? `<button type="button" class="mon-roll-btn" data-mon-hp-roll="1">🎲 Rolar PV</button>` : ""}</div>
        <div><span>Deslocamento</span><b>${esc(monsterSpeed(m))}</b></div>
        <div><span>Iniciativa</span><button type="button" class="mon-roll-btn" data-mon-bonus-roll="${monsterAbilityMod(m, "dex")}" data-mon-bonus-label="Iniciativa">🎲 d20 ${fmt(monsterAbilityMod(m, "dex"))}</button></div>
      </div>
      <div class="monster-ability-grid">
        ${ABILITIES.map((a) => `<div><span>${ABILITY_NAMES[a].slice(0, 3).toUpperCase()}</span><b>${Number(m[a]) || 10}</b><small>${fmt(monsterAbilityMod(m, a))}</small><button type="button" class="mon-roll-btn" data-mon-bonus-roll="${monsterAbilityMod(m, a)}" data-mon-bonus-label="Teste de ${esc(ABILITY_NAMES[a])}">🎲</button></div>`).join("")}
      </div>
      <p><b>Resistências</b>${m.savesText ? ` <span class="muted">(bloco original: ${esc(m.savesText)})</span>` : ""}</p><div class="monster-btn-wrap">${allSavesButtonsHtml(m)}</div>
      <p><b>Perícias</b>${m.skillsText ? ` <span class="muted">(bloco original: ${esc(m.skillsText)})</span>` : ""}</p><div class="monster-btn-wrap">${allSkillsButtonsHtml(m)}</div>
      ${m.resist ? `<p><b>Resistência a dano</b> ${esc((Array.isArray(m.resist) ? m.resist : [m.resist]).map((x) => typeof x === "string" ? x : plainOf(x)).join(", "))}</p>` : ""}
      ${m.immune ? `<p><b>Imunidade a dano</b> ${esc((Array.isArray(m.immune) ? m.immune : [m.immune]).map((x) => typeof x === "string" ? x : plainOf(x)).join(", "))}</p>` : ""}
      ${m.conditionImmune ? `<p><b>Imunidade a condição</b> ${esc(m.conditionImmune.join(", "))}</p>` : ""}
      <p><b>Sentidos</b> ${monsterSenses(m)}</p>
      <p><b>Idiomas</b> ${monsterLanguages(m)}</p>
      ${g.trait.length ? `<h3>Características</h3>${monsterEntryGroupHtml(g.trait, "trait")}` : ""}
      ${monsterSpellcastingHtml(m)}
      ${g.action.length ? `<h3>Ações</h3>${monsterEntryGroupHtml(g.action, "action")}` : ""}
      ${g.bonus.length ? `<h3>Ações Bônus</h3>${monsterEntryGroupHtml(g.bonus, "bonus")}` : ""}
      ${g.reaction.length ? `<h3>Reações</h3>${monsterEntryGroupHtml(g.reaction, "reaction")}` : ""}
      ${g.legendary.length ? `<h3>Ações Lendárias</h3>${monsterEntryGroupHtml(g.legendary, "legendary")}` : ""}
    </div>`;
  $("modal").classList.remove("hidden");
  wireMonsterModalRolls();
}
function wireMonsterModalRolls() {
  const box = $("modal-content");
  box.querySelectorAll("[data-mon-attack]").forEach((b) => { b.title = D20_MODE_TITLE; b.addEventListener("click", (e) => {
    const a = currentModalMonsterGroups[b.dataset.monKind]?.[Number(b.dataset.monAttack)];
    const { toHit } = a ? actionRollables(a) : {};
    if (toHit == null) return;
    const { rolls, roll, mode } = d20WithMode(e), total = roll + toHit;
    const note = roll === 20 ? " — CRÍTICO!" : roll === 1 ? " — falha crítica" : "";
    toast(`${a.name || "Ataque"}: ${d20RollPlain(rolls, roll, mode)} ${fmt(toHit)} = ${total}${note}`);
    broadcastMonsterRoll(currentModalMonster, `Ataque — ${a.name || "ação"}`, `${d20RollPlain(rolls, roll, mode)} ${fmt(toHit)}`, total, { note });
  }); });
  box.querySelectorAll("[data-mon-damage]").forEach((b) => { b.title = DAMAGE_MODE_TITLE; b.addEventListener("click", (e) => {
    const a = currentModalMonsterGroups[b.dataset.monKind]?.[Number(b.dataset.monDamage)];
    const { damageExpr } = a ? actionRollables(a) : {};
    const parsed = damageExpr && parseDiceExpr(damageExpr);
    if (!parsed) { toast("Expressão de dano inválida."); return; }
    const { rolls, total: diceTotal, crit } = rollDamageWithMode(parsed.n, parsed.faces, e);
    const total = diceTotal + (parsed.bonus || 0);
    const note = crit ? " — CRÍTICO" : "";
    toast(`${a.name || "Dano"}: ${rolls.length}d${parsed.faces} [${rolls.join(", ")}] ${fmt(parsed.bonus)} = ${total}${note}`);
    broadcastMonsterRoll(currentModalMonster, `Dano — ${a.name || "ação"}`, `${rolls.length}d${parsed.faces} [${rolls.join(", ")}] ${fmt(parsed.bonus)}`, total, { note });
  }); });
  box.querySelectorAll("[data-mon-bonus-roll]").forEach((b) => { b.title = D20_MODE_TITLE; b.addEventListener("click", (e) => {
    const bonus = Number(b.dataset.monBonusRoll) || 0, label = b.dataset.monBonusLabel || "Teste";
    const { rolls, roll, mode } = d20WithMode(e), total = roll + bonus;
    toast(`${label}: ${d20RollPlain(rolls, roll, mode)} ${fmt(bonus)} = ${total}`);
    broadcastMonsterRoll(currentModalMonster, label, `${d20RollPlain(rolls, roll, mode)} ${fmt(bonus)}`, total);
  }); });
  box.querySelector("[data-mon-hp-roll]")?.addEventListener("click", () => {
    const parsed = parseDiceExpr(currentModalMonster.hp?.formula || "");
    if (!parsed) { toast("Sem fórmula de dado de vida pra rolar."); return; }
    const { rolls, total: diceTotal } = rollDice(parsed.n, parsed.faces);
    const total = diceTotal + (parsed.bonus || 0);
    toast(`PV: ${parsed.n}d${parsed.faces} [${rolls.join(", ")}] ${fmt(parsed.bonus)} = ${total}`);
    broadcastMonsterRoll(currentModalMonster, "Pontos de Vida", `${parsed.n}d${parsed.faces} [${rolls.join(", ")}] ${fmt(parsed.bonus)}`, total);
  });
}
function monsterDiscordMessage(m, label, detail, total) {
  const name = (m?.name || "Monstro").trim();
  return `🐉 **${name}** (mestre) rolou **${label}**: ${detail} = **${total}**`;
}

// ------------------------------------------------------------
// Listas de monstros — o mestre pode ter várias (uma por aventura/
// campanha, ex. "Curse of Strahd", "Encontros aleatórios") em vez de
// uma pilha única. Toda operação de "adicionar" (individual ou em
// massa) vai pra LISTA ATIVA, escolhida no seletor da aba.
// ------------------------------------------------------------
function genMonsterEntryId() { return `mon-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`; }
// Garante que existe ao menos uma lista e que monsterState.listId aponta
// pra uma lista válida (cria a lista padrão / recupera a última ativa
// salva / cai pra primeira, nessa ordem) — chamado no início de toda
// renderização da aba, já que a lista pode ter sido apagada em outra aba.
function ensureMonsterListsState() {
  let lists = getMonsterLists();
  if (!lists.length) {
    lists = [{ id: newMonsterListId(), name: "Meus Monstros", monsters: [] }];
    saveMonsterLists(lists);
  }
  if (!monsterState.listId || !lists.some((l) => l.id === monsterState.listId)) {
    monsterState.listId = getActiveMonsterListId();
    if (!lists.some((l) => l.id === monsterState.listId)) monsterState.listId = lists[0].id;
    setActiveMonsterListId(monsterState.listId);
  }
  return lists;
}
function activeMonsterList(lists) {
  lists = lists || ensureMonsterListsState();
  return lists.find((l) => l.id === monsterState.listId) || lists[0];
}
function renderMonsterListSelect(lists) {
  lists = lists || ensureMonsterListsState();
  const sel = $("monster-list-select");
  if (!sel) return;
  sel.innerHTML = lists.map((l) => `<option value="${esc(l.id)}"${l.id === monsterState.listId ? " selected" : ""}>${esc(l.name)} (${l.monsters.length})</option>`).join("");
}
function openMonsterListNameModal(mode) {
  const lists = ensureMonsterListsState();
  const current = mode === "rename" ? activeMonsterList(lists) : null;
  $("modal-content").innerHTML = `<div class="modal-title"><div><span class="eyebrow">LISTA DE MONSTROS</span><h2>${mode === "rename" ? "Renomear lista" : "Nova lista"}</h2><p class="muted">${mode === "rename" ? "" : "Ex.: o nome de uma aventura — 'Curse of Strahd', 'Lost Mine of Phandelver' — pra depois jogar todos os monstros dela aqui dentro."}</p></div></div>
    <div class="modal-body">
      <label>Nome da lista<br><input id="ml-name" style="width:100%" value="${esc(current?.name || "")}" placeholder="Ex.: Curse of Strahd"></label>
      <div class="modal-actions"><button type="button" id="ml-cancel">Cancelar</button><button type="button" class="primary" id="ml-save">${mode === "rename" ? "Renomear" : "Criar"}</button></div>
    </div>`;
  $("modal").classList.remove("hidden");
  $("ml-name").focus();
  $("ml-cancel").addEventListener("click", () => $("modal").classList.add("hidden"));
  $("ml-save").addEventListener("click", () => {
    const name = $("ml-name").value.trim();
    if (!name) { toast("Dê um nome pra lista."); return; }
    const freshLists = ensureMonsterListsState();
    if (mode === "rename") {
      activeMonsterList(freshLists).name = name;
    } else {
      const nl = { id: newMonsterListId(), name, monsters: [] };
      freshLists.push(nl);
      monsterState.listId = nl.id;
      setActiveMonsterListId(nl.id);
    }
    saveMonsterLists(freshLists);
    $("modal").classList.add("hidden");
    renderMonsters();
  });
}
function deleteActiveMonsterList() {
  const lists = ensureMonsterListsState();
  const target = activeMonsterList(lists);
  if (!confirm(`Excluir a lista "${target.name}" e o(s) ${target.monsters.length} monstro(s) nela? Isso não afeta as outras listas.`)) return;
  const remaining = lists.filter((l) => l.id !== target.id);
  const finalLists = remaining.length ? remaining : [{ id: newMonsterListId(), name: "Meus Monstros", monsters: [] }];
  saveMonsterLists(finalLists);
  monsterState.listId = finalLists[0].id;
  setActiveMonsterListId(monsterState.listId);
  renderMonsters();
}
// Adiciona um monstro à lista ativa (ou à lista passada) — usado tanto
// pelo botão individual do bestiário/criação quanto pelo "adicionar
// todos desta fonte". Ignora duplicata (mesmo nome+fonte já na lista).
function addMonsterToList(m, lists, listId) {
  const target = lists.find((l) => l.id === listId) || lists[0];
  const exists = target.monsters.some((x) => x.name === m.name && (x.source || "") === (m.source || ""));
  if (exists) return false;
  target.monsters.push({ ...m, _id: genMonsterEntryId(), _addedAt: Date.now() });
  return true;
}
function addMonsterToRoster(m) {
  const lists = ensureMonsterListsState();
  const target = activeMonsterList(lists);
  const added = addMonsterToList(m, lists, target.id);
  saveMonsterLists(lists);
  toast(added ? `"${m.name}" adicionado a "${target.name}".` : `"${m.name}" já está em "${target.name}".`);
}
function removeMonsterFromRoster(id) {
  const lists = ensureMonsterListsState();
  const target = activeMonsterList(lists);
  target.monsters = target.monsters.filter((x) => x._id !== id);
  saveMonsterLists(lists);
  renderMonsters();
}

async function renderMonsterSourceOptions() {
  const sel = $("monster-source");
  if (sel.dataset.filled) return;
  try {
    const idx = await loadBestiaryIndex();
    const sources = Object.keys(idx).sort((a, b) => a.localeCompare(b));
    sel.insertAdjacentHTML("beforeend", sources.map((s) => `<option value="${esc(s)}">${esc(s)}</option>`).join(""));
    sel.dataset.filled = "1";
  } catch { /* fica só com "Todas" se o índice falhar */ }
}

function monsterResultCardHtml(m, opts = {}) {
  const cr = m.custom ? "" : ` · CD ${esc(crText(m.cr))}`;
  return `<article class="catalog-card">
    <div class="pick-top"><strong>${esc(m.name || "Sem nome")}</strong>${monsterCardTag(m)}</div>
    <div class="pick-meta">${esc(monsterTypeText(m.type) || m.typeText || "—")}${cr}</div>
    <div class="catalog-actions">
      <button data-mon-view="${esc(opts.viewKey)}">ⓘ Ver stat block</button>
      ${opts.addable ? `<button class="add-btn" data-mon-add="${esc(opts.viewKey)}">+ Adicionar à lista ativa</button>` : ""}
      ${opts.removable ? `<button data-mon-remove="${esc(m._id)}">🗑️ Remover</button>` : ""}
    </div>
  </article>`;
}

async function renderMonsters() {
  const lists = ensureMonsterListsState();
  renderMonsterListSelect(lists);
  $("monster-browse-toolbar").classList.toggle("hidden", monsterState.view !== "browse");
  const box = $("monster-results");
  if (monsterState.view === "roster") {
    const active = activeMonsterList(lists);
    const roster = active.monsters;
    box.innerHTML = roster.length
      ? roster.map((m) => monsterResultCardHtml(m, { viewKey: `roster:${m._id}`, removable: true })).join("")
      : `<div class="empty">A lista "${esc(active.name)}" ainda está vazia. Adicione um monstro do bestiário oficial (aba "Bestiário Oficial") ou clique em "+ Criar monstro".</div>`;
    box.querySelectorAll("[data-mon-view]").forEach((b) => b.addEventListener("click", () => {
      const id = b.dataset.monView.slice("roster:".length);
      const m = activeMonsterList(ensureMonsterListsState()).monsters.find((x) => x._id === id);
      if (m) renderMonsterStatblock(m);
    }));
    box.querySelectorAll("[data-mon-remove]").forEach((b) => b.addEventListener("click", () => {
      if (confirm("Remover este monstro da lista?")) removeMonsterFromRoster(b.dataset.monRemove);
    }));
    return;
  }
  // view === "browse"
  await renderMonsterSourceOptions();
  const q = $("monster-search").value.trim().toLowerCase();
  const src = $("monster-source").value;
  if (src && src !== monsterState.source) {
    monsterState.source = src;
    monsterAllLoaded = false;
    box.innerHTML = `<div class="empty">Carregando…</div>`;
    monsterBrowseCache = await loadBestiarySource(src).catch(() => []);
  } else if (!src && !monsterAllLoaded) {
    monsterState.source = "";
  }
  const addAllBtn = $("monster-add-all-source");
  if (addAllBtn) {
    addAllBtn.classList.toggle("hidden", !monsterState.source);
    if (monsterState.source) addAllBtn.textContent = `📦 Adicionar os ${monsterBrowseCache.length} monstros de "${monsterState.source}" à lista ativa`;
  }
  const pool = (monsterAllLoaded || monsterState.source) ? monsterBrowseCache : [];
  if (!pool.length) {
    box.innerHTML = `<div class="empty">Escolha um livro/aventura acima, ou clique em "Buscar em todas as fontes" pra pesquisar em tudo de uma vez.</div>`;
    return;
  }
  const filtered = (q ? pool.filter((m) => String(m.name).toLowerCase().includes(q)) : pool).slice(0, 240);
  box.innerHTML = filtered.length
    ? filtered.map((m) => monsterResultCardHtml(m, { viewKey: JSON.stringify([m.name, m.source]), addable: true })).join("")
    : `<div class="empty">Nenhum resultado.</div>`;
  box.querySelectorAll("[data-mon-view]").forEach((b) => b.addEventListener("click", () => {
    const [name, source] = JSON.parse(b.dataset.monView);
    const m = pool.find((x) => x.name === name && x.source === source);
    if (m) renderMonsterStatblock(m);
  }));
  box.querySelectorAll("[data-mon-add]").forEach((b) => b.addEventListener("click", () => {
    const [name, source] = JSON.parse(b.dataset.monAdd);
    const m = pool.find((x) => x.name === name && x.source === source);
    if (m) { addMonsterToRoster(m); renderMonsterListSelect(); }
  }));
}
// Joga TODOS os monstros da fonte/aventura atualmente selecionada
// (monsterBrowseCache inteiro, sem filtro de busca) na lista ativa de
// uma vez — é o "salvar todos os monstros de uma aventura numa lista".
function addAllSourceMonstersToActiveList() {
  if (!monsterState.source || !monsterBrowseCache.length) { toast("Escolha um livro/aventura primeiro."); return; }
  const lists = ensureMonsterListsState();
  const target = activeMonsterList(lists);
  if (!confirm(`Adicionar os ${monsterBrowseCache.length} monstros de "${monsterState.source}" à lista "${target.name}"?`)) return;
  let added = 0;
  monsterBrowseCache.forEach((m) => { if (addMonsterToList(m, lists, target.id)) added++; });
  saveMonsterLists(lists);
  const skipped = monsterBrowseCache.length - added;
  toast(`${added} monstro(s) adicionado(s) a "${target.name}"${skipped ? ` (${skipped} já estavam lá)` : ""}.`);
  renderMonsters();
}

// ------------------------------------------------------------
// Importar lista de monstros exportada do site 5etools.com (botão
// "Download JSON" de uma lista salva no bestiário — fileType
// "bestiary-sublist"). Cada item vem só como um hash "nome_sigla"
// (ex.: "axolotl_scoc" = Axolotl, fonte ScoC) — resolvemos contra o
// mesmo bestiário oficial já usado pra pesquisar/adicionar monstros
// individualmente. Itens de fontes de terceiros/homebrew (que a ficha
// não sincroniza) ficam de fora e são listados pro mestre adicionar
// à mão com "+ Criar monstro".
// ------------------------------------------------------------
function parseMonsterSublistItem(h) {
  const decoded = decodeURIComponent(String(h || ""));
  const idx = decoded.lastIndexOf("_");
  if (idx < 0) return null;
  return { name: decoded.slice(0, idx), sourceTag: decoded.slice(idx + 1) };
}
async function resolveBestiarySourceKey(tag) {
  const idx = await loadBestiaryIndex();
  return Object.keys(idx).find((k) => k.toLowerCase() === tag.toLowerCase()) || null;
}
async function importMonsterSublistFile(file) {
  let json;
  try { json = JSON.parse(await file.text()); }
  catch { toast("Arquivo inválido — não é um JSON."); return; }
  const items = Array.isArray(json?.items) ? json.items : null;
  if (!items) { toast('Arquivo não reconhecido. Exporte uma lista do 5etools ("bestiary-sublist").'); return; }
  const lists = ensureMonsterListsState();
  const target = activeMonsterList(lists);
  let added = 0, dup = 0;
  const notFound = [];
  const sourceKeyCache = new Map();
  for (const item of items) {
    const parsed = parseMonsterSublistItem(item?.h);
    if (!parsed) continue;
    if (!sourceKeyCache.has(parsed.sourceTag)) sourceKeyCache.set(parsed.sourceTag, await resolveBestiarySourceKey(parsed.sourceTag));
    const sourceKey = sourceKeyCache.get(parsed.sourceTag);
    const pool = sourceKey ? await loadBestiarySource(sourceKey) : [];
    const m = pool.find((x) => String(x.name).toLowerCase() === parsed.name.toLowerCase());
    if (!m) { notFound.push(parsed.name); continue; }
    if (addMonsterToList(m, lists, target.id)) added++; else dup++;
  }
  saveMonsterLists(lists);
  renderMonsters();
  openMonsterImportResultModal({ total: items.length, added, dup, notFound, listName: target.name });
}
function openMonsterImportResultModal({ total, added, dup, notFound, listName }) {
  $("modal-content").innerHTML = `<div class="modal-title"><div><span class="eyebrow">IMPORTAR LISTA</span><h2>Resultado da importação</h2></div></div>
    <div class="modal-body">
      <p>${added} de ${total} monstro(s) adicionado(s) a "<b>${esc(listName)}</b>".${dup ? ` ${dup} já estava(m) na lista.` : ""}</p>
      ${notFound.length ? `<p class="muted">${notFound.length} não encontrado(s) no bestiário oficial sincronizado (provavelmente de fonte de terceiros/homebrew não coberta por aqui) — adicione-os à mão com "+ Criar monstro" se precisar deles:</p><ul>${notFound.map((n) => `<li>${esc(n)}</li>`).join("")}</ul>` : ""}
      <div class="modal-actions"><button type="button" class="primary" id="mi-close">Fechar</button></div>
    </div>`;
  $("modal").classList.remove("hidden");
  $("mi-close").addEventListener("click", () => $("modal").classList.add("hidden"));
}
function openMonsterCreateModal() {
  $("modal-content").innerHTML = `<div class="modal-title"><div><span class="eyebrow">MONSTRO</span><h2>Criar monstro</h2><p class="muted">Só o essencial pra ter um stat block jogável, com botões de rolagem prontos. Ações/traços podem ficar sem bônus de ataque/dano estruturado — nesse caso o texto aparece, mas sem botão de rolar.</p></div></div>
    <div class="modal-body monster-create-form">
      <div class="two-input"><label>Nome<input id="mc-name" placeholder="Ex.: Guarda do Culto"></label><label>CD (desafio)<input id="mc-cr" placeholder="Ex.: 1/4, 1, 5"></label></div>
      <div class="two-input"><label>Tamanho
        <select id="mc-size"><option value="T">Miúdo</option><option value="S">Pequeno</option><option value="M" selected>Médio</option><option value="L">Grande</option><option value="H">Enorme</option><option value="G">Colossal</option></select>
      </label><label>Tipo<input id="mc-type" placeholder="Ex.: humanoide, morto-vivo, dragão"></label></div>
      <div class="two-input"><label>Alinhamento<input id="mc-alignment" placeholder="Ex.: Caótico e Mau"></label><label>Deslocamento<input id="mc-speed" placeholder="Ex.: 9 m, voo 18 m" value="9 m"></label></div>
      <div class="two-input"><label>CA<input id="mc-ac" type="number" value="12"></label><label>Nota da CA (opcional)<input id="mc-ac-note" placeholder="Ex.: armadura de couro"></label></div>
      <div class="two-input"><label>PV médio<input id="mc-hp" type="number" value="11"></label><label>Fórmula do dado de vida (opcional, ativa "Rolar PV")<input id="mc-hp-formula" placeholder="Ex.: 2d8+2"></label></div>
      <label class="buff-field">Atributos
        <div class="buff-abilities">${ABILITIES.map((a) => `<label>${ABILITY_NAMES[a]}<input type="number" id="mc-${a}" value="10" style="width:56px;margin-left:6px"></label>`).join("")}</div>
      </label>
      <div class="two-input"><label>Sentidos (opcional)<input id="mc-senses" placeholder="Ex.: visão no escuro 18 m"></label><label>Idiomas<input id="mc-languages" placeholder="Ex.: Comum, Infernal"></label></div>
      <div class="two-input"><label>Resistências (texto livre)<input id="mc-saves" placeholder="Ex.: Con +4"></label><label>Perícias (texto livre)<input id="mc-skills" placeholder="Ex.: Percepção +3, Furtividade +4"></label></div>
      <h3>Características</h3><div id="mc-traits"></div><button type="button" class="add-btn" id="mc-add-trait">+ Adicionar característica</button>
      <h3>Ações</h3><p class="muted">Bônus de ataque e dano são opcionais — se preenchidos, a ação ganha botão de rolagem.</p><div id="mc-actions"></div><button type="button" class="add-btn" id="mc-add-action">+ Adicionar ação</button>
      <div class="modal-actions"><button type="button" id="mc-cancel">Cancelar</button><button type="button" class="primary" id="mc-save">Criar</button></div>
    </div>`;
  $("modal").classList.remove("hidden");

  const traitRowHtml = (t = {}) => `<div class="monster-form-row" data-mc-trait-row>
    <input placeholder="Nome" data-mc-trait-name value="${esc(t.name || "")}">
    <textarea placeholder="Texto" rows="2" data-mc-trait-text>${esc(t.text || "")}</textarea>
    <button type="button" class="remove-btn" data-mc-remove-row>×</button>
  </div>`;
  const actionRowHtml = (a = {}) => `<div class="monster-form-row monster-form-action-row" data-mc-action-row>
    <input placeholder="Nome" data-mc-action-name value="${esc(a.name || "")}">
    <textarea placeholder="Texto" rows="2" data-mc-action-text>${esc(a.text || "")}</textarea>
    <div class="two-input"><input type="number" placeholder="Bônus de ataque (ex.: 4)" data-mc-action-tohit value="${a.toHit ?? ""}"><input placeholder="Dano (ex.: 1d6+2)" data-mc-action-dmg value="${esc(a.damageExpr || "")}"></div>
    <button type="button" class="remove-btn" data-mc-remove-row>×</button>
  </div>`;
  // Cada linha ganha o listener de remover na hora em que é criada (em vez
  // de um listener delegado no container do modal, que ficaria empilhando
  // um handler a mais cada vez que este modal for reaberto na mesma sessão).
  function addFormRow(container, html) {
    container.insertAdjacentHTML("beforeend", html);
    const row = container.lastElementChild;
    row.querySelector("[data-mc-remove-row]").addEventListener("click", () => row.remove());
  }
  addFormRow($("mc-traits"), traitRowHtml());
  addFormRow($("mc-actions"), actionRowHtml());
  $("mc-add-trait").addEventListener("click", () => addFormRow($("mc-traits"), traitRowHtml()));
  $("mc-add-action").addEventListener("click", () => addFormRow($("mc-actions"), actionRowHtml()));

  $("mc-cancel").addEventListener("click", () => $("modal").classList.add("hidden"));
  $("mc-save").addEventListener("click", () => {
    const name = $("mc-name").value.trim();
    if (!name) { toast("Dê um nome pro monstro."); return; }
    const hpAvg = Number($("mc-hp").value) || 1;
    const monster = {
      name, custom: true,
      cr: $("mc-cr").value.trim() || "—",
      size: [$("mc-size").value], type: undefined, typeText: $("mc-type").value.trim(),
      alignmentText: $("mc-alignment").value.trim(),
      speedText: $("mc-speed").value.trim(),
      ac: Number($("mc-ac").value) || 10, acNote: $("mc-ac-note").value.trim() || undefined,
      hp: { average: hpAvg, formula: $("mc-hp-formula").value.trim() || undefined },
      str: Number($("mc-str").value) || 10, dex: Number($("mc-dex").value) || 10, con: Number($("mc-con").value) || 10,
      int: Number($("mc-int").value) || 10, wis: Number($("mc-wis").value) || 10, cha: Number($("mc-cha").value) || 10,
      sensesText: $("mc-senses").value.trim() || undefined,
      languagesText: $("mc-languages").value.trim() || undefined,
      savesText: $("mc-saves").value.trim() || undefined,
      skillsText: $("mc-skills").value.trim() || undefined,
      trait: [...$("mc-traits").querySelectorAll("[data-mc-trait-row]")]
        .map((r) => ({ name: r.querySelector("[data-mc-trait-name]").value.trim(), text: r.querySelector("[data-mc-trait-text]").value.trim() }))
        .filter((t) => t.name || t.text),
      action: [...$("mc-actions").querySelectorAll("[data-mc-action-row]")]
        .map((r) => ({
          name: r.querySelector("[data-mc-action-name]").value.trim(),
          text: r.querySelector("[data-mc-action-text]").value.trim(),
          toHit: r.querySelector("[data-mc-action-tohit]").value !== "" ? Number(r.querySelector("[data-mc-action-tohit]").value) : null,
          damageExpr: r.querySelector("[data-mc-action-dmg]").value.trim() || null,
        }))
        .filter((a) => a.name || a.text),
    };
    addMonsterToRoster(monster);
    $("modal").classList.add("hidden");
    renderMonsters();
  });
}

// ------------------------------------------------------------
// Notas de sessão / journal
// ------------------------------------------------------------
function todayIso() { return new Date().toISOString().slice(0, 10); }
function renderJournal() {
  const box = $("journal-list");
  if (!box) return;
  const list = [...(character.journal || [])].sort((a, b) => String(b.date || "").localeCompare(String(a.date || "")) || String(b.id).localeCompare(String(a.id)));
  if (!list.length) { box.innerHTML = `<div class="journal-empty">Nenhuma nota ainda. Clique em "+ Nova sessão" pra começar.</div>`; return; }
  box.innerHTML = list.map((j) => `<article class="journal-entry" data-journal-id="${esc(j.id)}">
    <div class="journal-entry-head"><b>${esc(j.title || "Sessão")}</b><span>${esc(j.date || "")}</span></div>
    <div class="journal-entry-body">${esc(j.text || "")}</div>
    <div class="journal-entry-actions no-print"><button type="button" data-edit-journal="${esc(j.id)}">📝 Editar</button><button type="button" data-delete-journal="${esc(j.id)}">🗑️ Deletar</button></div>
  </article>`).join("");
  box.querySelectorAll("[data-edit-journal]").forEach((b) => b.addEventListener("click", () => openJournalModal(b.dataset.editJournal)));
  box.querySelectorAll("[data-delete-journal]").forEach((b) => b.addEventListener("click", () => {
    if (!confirm("Apagar esta nota de sessão?")) return;
    character.journal = (character.journal || []).filter((j) => j.id !== b.dataset.deleteJournal);
    saveCharacter(character); renderJournal();
  }));
}
function openJournalModal(id) {
  const existing = id ? (character.journal || []).find((j) => j.id === id) : null;
  $("modal-content").innerHTML = `<div class="modal-title"><div><span class="eyebrow">NOTAS DE SESSÃO</span><h2>${existing ? "Editar nota" : "Nova nota de sessão"}</h2></div></div>
    <div class="modal-body journal-edit">
      <input id="journal-title" value="${esc(existing?.title || "")}" placeholder="Título (ex.: Sessão 5)">
      <input id="journal-date" type="date" value="${esc(existing?.date || todayIso())}">
      <textarea id="journal-text" placeholder="O que aconteceu nesta sessão…">${esc(existing?.text || "")}</textarea>
      <div class="modal-actions"><button type="button" id="journal-cancel">Cancelar</button><button type="button" class="primary" id="journal-save">Salvar</button></div>
    </div>`;
  $("modal").classList.remove("hidden");
  $("journal-cancel").addEventListener("click", () => $("modal").classList.add("hidden"));
  $("journal-save").addEventListener("click", () => {
    const title = $("journal-title").value.trim(), date = $("journal-date").value, text = $("journal-text").value;
    if (existing) { existing.title = title; existing.date = date; existing.text = text; }
    else { character.journal = character.journal || []; character.journal.push({ id: `j-${Date.now()}`, title, date, text }); }
    saveCharacter(character); $("modal").classList.add("hidden"); renderJournal();
    toast("Nota salva.");
  });
}
function exportJournalText() {
  const list = [...(character.journal || [])].sort((a, b) => String(a.date || "").localeCompare(String(b.date || "")));
  if (!list.length) { toast("Nenhuma nota pra exportar."); return; }
  const text = list.map((j) => `${j.title || "Sessão"} (${j.date || ""})\n${"-".repeat(30)}\n${j.text || ""}\n`).join("\n");
  const blob = new Blob([text], { type: "text/plain" });
  const url = URL.createObjectURL(blob), a = document.createElement("a");
  a.href = url; a.download = `${(character.name || "personagem").replace(/[^a-z0-9-_]+/gi, "_")}_notas.txt`; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 500);
}

// ------------------------------------------------------------
// Companheiros e familiares — fichas curtas à parte (familiar de
// Bruxo/Feiticeiro/Mago, companheiro animal de Patrulheiro, montaria...):
// CA/PV/deslocamento próprios, ataques com rolagem (vão pra sala/Discord
// como os do personagem) e um campo de traços/notas livre. Não tenta
// detectar automaticamente qual classe dá qual companheiro — o jogador
// preenche à mão, porque a criatura em si varia (bicho escolhido, forma
// do familiar etc.).
// ------------------------------------------------------------
function companionDiscordMessage(comp, label, detail, total) {
  const name = (comp?.name || "Companheiro").trim();
  return `🐾 **${name}** (companheiro) rolou **${label}**: ${detail} = **${total}**`;
}
function broadcastCompanionRoll(comp, label, detail, total, opts = {}) {
  const note = opts.note || "";
  sendToDiscord(companionDiscordMessage(comp, label, detail, total) + note);
  pushRoomRoll({ name: `${(comp?.name || "Companheiro").trim()} (companheiro)`, label, detail: detail + note, total, type: opts.type || "outro" });
}
function renderCompanions() {
  const box = $("companion-list");
  if (!box) return;
  const list = character.companions || [];
  box.innerHTML = list.length ? list.map((comp) => {
    const hpMax = Math.max(0, Number(comp.hpMax) || 0);
    const hpCur = Number.isFinite(Number(comp.hpCur)) ? Number(comp.hpCur) : hpMax;
    const pct = hpMax > 0 ? Math.max(0, Math.min(100, (hpCur / hpMax) * 100)) : 0;
    const attacks = comp.attacks || [];
    return `<div class="companion-card" data-companion-id="${esc(comp.id)}">
      <div class="companion-card-top">
        <input data-c="name" data-id="${esc(comp.id)}" value="${esc(comp.name || "")}" placeholder="Nome (ex.: Coruja)">
        <input data-c="type" data-id="${esc(comp.id)}" value="${esc(comp.type || "")}" placeholder="Tipo (Familiar, Companheiro Animal, Montaria…)">
        <button type="button" class="remove-btn no-print" data-remove-companion="${esc(comp.id)}" title="Remover companheiro">×</button>
      </div>
      <div class="companion-card-stats">
        <label>CA<input type="number" data-c="ac" data-id="${esc(comp.id)}" value="${Number(comp.ac) || 0}"></label>
        <label>Deslocamento<input data-c="speed" data-id="${esc(comp.id)}" value="${esc(comp.speed || "")}" placeholder="9m, voo 18m"></label>
        <label>Fonte<input data-c="source" data-id="${esc(comp.id)}" value="${esc(comp.source || "")}" placeholder="ex.: Encontrar Familiar"></label>
      </div>
      <div class="companion-hp-row">
        <div class="dash-hp-bar"><div class="dash-hp-fill ${hpBarClass(hpCur, hpMax)}" style="width:${pct}%"></div><div class="dash-hp-label">${hpCur} / ${hpMax}${comp.hpTemp ? ` (+${comp.hpTemp} temp)` : ""}</div></div>
        <label>PV<input type="number" data-c="hpCur" data-id="${esc(comp.id)}" value="${hpCur}"></label>
        <label>/ Máx<input type="number" data-c="hpMax" data-id="${esc(comp.id)}" value="${hpMax}"></label>
        <label>Temp<input type="number" data-c="hpTemp" data-id="${esc(comp.id)}" value="${Number(comp.hpTemp) || 0}"></label>
      </div>
      <div class="companion-attacks">
        ${attacks.map((a, ai) => `<div class="companion-attack-row">
          <input data-ca="name" data-id="${esc(comp.id)}" data-ai="${ai}" value="${esc(a.name || "")}" placeholder="Ataque (ex.: Bicada)">
          <input data-ca="bonus" data-id="${esc(comp.id)}" data-ai="${ai}" value="${esc(a.bonus || "")}" placeholder="+5">
          <input data-ca="damage" data-id="${esc(comp.id)}" data-ai="${ai}" value="${esc(a.damage || "")}" placeholder="1d4 perfurante">
          <button type="button" data-roll-companion-attack="${ai}" data-id="${esc(comp.id)}" title="${D20_MODE_TITLE}">🎲 Ataque</button>
          <button type="button" data-roll-companion-damage="${ai}" data-id="${esc(comp.id)}" title="${DAMAGE_MODE_TITLE}">🎲 Dano</button>
          <button type="button" class="remove-btn no-print" data-remove-companion-attack="${ai}" data-id="${esc(comp.id)}" title="Remover ataque">×</button>
        </div>`).join("")}
        <div class="companion-attack-actions no-print"><button type="button" class="add-btn" data-add-companion-attack="${esc(comp.id)}">+ Ataque</button><span class="companion-attack-result" id="companion-attack-result-${esc(comp.id)}"></span></div>
      </div>
      <textarea data-c="notes" data-id="${esc(comp.id)}" placeholder="Traços, habilidades especiais, personalidade…">${esc(comp.notes || "")}</textarea>
    </div>`;
  }).join("") : `<div class="empty">Nenhum companheiro ainda. Clique em "+ Novo companheiro" pra adicionar um familiar, companheiro animal ou montaria.</div>`;

  const findComp = (id) => (character.companions || []).find((c) => c.id === id);
  // Só a barra de PV precisa refletir mudanças dos campos numéricos de PV —
  // atualiza direto no DOM em vez de re-renderizar tudo, senão o campo que
  // está sendo digitado perde o foco a cada tecla (mesmo problema do
  // renderAttacks, ver comentário lá).
  const updateCompanionHp = (comp) => {
    const card = box.querySelector(`[data-companion-id="${CSS.escape(comp.id)}"]`);
    if (!card) return;
    const hpMax = Math.max(0, Number(comp.hpMax) || 0);
    const hpCur = Number(comp.hpCur) || 0;
    const pct = hpMax > 0 ? Math.max(0, Math.min(100, (hpCur / hpMax) * 100)) : 0;
    const fill = card.querySelector(".dash-hp-fill");
    if (fill) { fill.className = `dash-hp-fill ${hpBarClass(hpCur, hpMax)}`; fill.style.width = `${pct}%`; }
    const label = card.querySelector(".dash-hp-label");
    if (label) label.textContent = `${hpCur} / ${hpMax}${comp.hpTemp ? ` (+${comp.hpTemp} temp)` : ""}`;
  };
  box.querySelectorAll("[data-c]").forEach((el) => el.addEventListener("input", () => {
    const comp = findComp(el.dataset.id);
    if (!comp) return;
    const field = el.dataset.c;
    const numeric = ["ac", "hpCur", "hpMax", "hpTemp"].includes(field);
    comp[field] = numeric ? Number(el.value) || 0 : el.value;
    saveCharacter(character);
    if (["hpCur", "hpMax", "hpTemp"].includes(field)) updateCompanionHp(comp);
  }));
  box.querySelectorAll("[data-remove-companion]").forEach((b) => b.addEventListener("click", () => {
    if (!confirm("Remover este companheiro?")) return;
    character.companions = (character.companions || []).filter((c) => c.id !== b.dataset.removeCompanion);
    saveCharacter(character); renderCompanions();
  }));
  box.querySelectorAll("[data-ca]").forEach((el) => el.addEventListener("input", () => {
    const comp = findComp(el.dataset.id);
    if (!comp) return;
    const a = (comp.attacks || [])[Number(el.dataset.ai)];
    if (!a) return;
    a[el.dataset.ca] = el.value;
    saveCharacter(character);
  }));
  box.querySelectorAll("[data-add-companion-attack]").forEach((b) => b.addEventListener("click", () => {
    const comp = findComp(b.dataset.addCompanionAttack);
    if (!comp) return;
    comp.attacks = comp.attacks || [];
    comp.attacks.push({ name: "", bonus: "", damage: "" });
    saveCharacter(character); renderCompanions();
  }));
  box.querySelectorAll("[data-remove-companion-attack]").forEach((b) => b.addEventListener("click", () => {
    const comp = findComp(b.dataset.id);
    if (!comp) return;
    comp.attacks.splice(Number(b.dataset.removeCompanionAttack), 1);
    saveCharacter(character); renderCompanions();
  }));
  box.querySelectorAll("[data-roll-companion-attack]").forEach((b) => b.addEventListener("click", (e) => {
    const comp = findComp(b.dataset.id), a = (comp?.attacks || [])[Number(b.dataset.rollCompanionAttack)];
    if (!comp || !a) return;
    const { rolls, roll, mode } = d20WithMode(e);
    const bonus = parseBonusText(a.bonus), total = roll + bonus;
    const cls = roll === 20 ? "crit" : roll === 1 ? "fumble" : "";
    const note = roll === 20 ? " — CRÍTICO!" : roll === 1 ? " — falha crítica" : "";
    $(`companion-attack-result-${comp.id}`).innerHTML = `${d20RollHtml(rolls, roll, mode, cls)} ${fmt(bonus)} = <b>${total}</b>${note}`;
    broadcastCompanionRoll(comp, `Ataque — ${a.name || "sem nome"}`, `${d20RollPlain(rolls, roll, mode)} ${fmt(bonus)}`, total, { type: "ataque", note });
  }));
  box.querySelectorAll("[data-roll-companion-damage]").forEach((b) => b.addEventListener("click", (e) => {
    const comp = findComp(b.dataset.id), a = (comp?.attacks || [])[Number(b.dataset.rollCompanionDamage)];
    if (!comp || !a) return;
    const parsed = parseDiceExpr(a.damage || "1d4");
    if (!parsed) { toast('Escreva o dano como "1d6" ou "2d4+1".'); return; }
    const { rolls, total: diceTotal, crit } = rollDamageWithMode(parsed.n, parsed.faces, e);
    const total = diceTotal + (parsed.bonus || 0);
    $(`companion-attack-result-${comp.id}`).innerHTML = `${crit ? "💥 crítico " : ""}[${rolls.join(", ")}]${parsed.bonus ? ` ${fmt(parsed.bonus)}` : ""} = <b>${total}</b>`;
    broadcastCompanionRoll(comp, `Dano — ${a.name || "sem nome"}`, `${crit ? "crítico " : ""}[${rolls.join(", ")}]${parsed.bonus ? ` ${fmt(parsed.bonus)}` : ""}`, total, { type: "dano" });
  }));
}
function addCompanion() {
  character.companions = character.companions || [];
  character.companions.push({ id: `comp-${Date.now()}`, name: "", type: "", source: "", ac: 10, speed: "9m", hpMax: 4, hpCur: 4, hpTemp: 0, attacks: [], notes: "" });
  saveCharacter(character);
  renderCompanions();
}

// ------------------------------------------------------------
// Modificadores temporários (buffs/debuffs) em massa
// ------------------------------------------------------------
function renderBuffs() {
  const box = $("buffs-list");
  if (!box) return;
  const list = character.buffs || [];
  if (!list.length) { box.innerHTML = `<div class="buffs-empty">Nenhum modificador ativo.</div>`; return; }
  box.innerHTML = list.map((b) => `<div class="buff-row" data-buff-id="${esc(b.id)}">
    <div><b>${esc(b.label || "Modificador")}</b><small>${(b.abilities || []).map((a) => ABILITY_NAMES[a]).join(", ") || "—"}</small></div>
    <div class="buff-value ${b.value >= 0 ? "pos" : "neg"}">${fmt(b.value)}</div>
    <div class="buff-duration">${b.duration == null ? "permanente" : `${b.duration} rodada(s)`}</div>
    <button type="button" class="remove-btn no-print" data-remove-buff="${esc(b.id)}" title="Remover">×</button>
  </div>`).join("");
  box.querySelectorAll("[data-remove-buff]").forEach((btn) => btn.addEventListener("click", () => {
    character.buffs = (character.buffs || []).filter((b) => b.id !== btn.dataset.removeBuff);
    saveCharacter(character); recalc();
  }));
}
function openBuffModal() {
  $("modal-content").innerHTML = `<div class="modal-title"><div><span class="eyebrow">FERRAMENTA</span><h2>Aplicar Modificador</h2><p class="muted">Útil pra buffs/debuffs temporários (poção, magia, exaustão…). Afeta os atributos escolhidos, e tudo que depende deles (modificador, perícias, salvamentos, CD) recalcula automaticamente.</p></div></div>
    <div class="modal-body">
      <label class="buff-field">Nome do efeito<input id="buff-label" type="text" placeholder="Ex.: Poção de Força do Gigante"></label>
      <label class="buff-field">Atributos afetados
        <div class="buff-abilities">${ABILITIES.map((a) => `<label><input type="checkbox" data-buff-ability="${a}"> ${ABILITY_NAMES[a]}</label>`).join("")}</div>
      </label>
      <label class="buff-field">Valor (use negativo pra debuff)<input id="buff-value" type="number" value="2"></label>
      <label class="buff-field">Duração em rodadas (vazio = permanente, até remover manualmente)<input id="buff-duration" type="number" min="1" placeholder="permanente"></label>
      <div class="modal-actions"><button type="button" id="buff-cancel">Cancelar</button><button type="button" class="primary" id="buff-apply">Aplicar</button></div>
    </div>`;
  $("modal").classList.remove("hidden");
  $("buff-cancel").addEventListener("click", () => $("modal").classList.add("hidden"));
  $("buff-apply").addEventListener("click", () => {
    const abilities = [...$("modal-content").querySelectorAll("[data-buff-ability]:checked")].map((c) => c.dataset.buffAbility);
    const value = Number($("buff-value").value) || 0;
    if (!abilities.length || !value) { toast("Escolha ao menos um atributo e um valor diferente de zero."); return; }
    const duration = Number($("buff-duration").value) || null;
    character.buffs = character.buffs || [];
    character.buffs.push({ id: `buff-${Date.now()}`, label: $("buff-label").value.trim() || "Modificador", abilities, value, duration: duration && duration > 0 ? duration : null });
    saveCharacter(character);
    $("modal").classList.add("hidden");
    recalc();
    toast("Modificador aplicado.");
  });
}

// ------------------------------------------------------------
// Talentos extras — escolha manual, além dos slots automáticos
// (origem do background, melhorias de nível 4/8/12/16/19...).
// ------------------------------------------------------------
function renderExtraFeats() {
  const box = $("extra-feats-list");
  if (!box) return;
  const list = character.extraFeats || [];
  if (!list.length) { box.innerHTML = `<p class="muted">Nenhum talento extra adicionado.</p>`; return; }
  box.innerHTML = list.map((id) => {
    const e = manifest().find((x) => x.id === id);
    if (!e) return "";
    const r = featRec(e);
    const spec = featAbilityChoose(r);
    const abilPicker = spec && spec.from.length
      ? `<select data-extra-feat-ability="${esc(id)}"><option value="">bônus de atributo —</option>${spec.from.map((k) => `<option value="${k}"${(character.choiceSelections?.featAbility?.[id] || "") === k ? " selected" : ""}>${ABILITY_NAMES[k]}</option>`).join("")}</select>`
      : "";
    return `<div class="identity-row"><span>Talento</span><strong>${esc(titleOf(e))}${hb(e) ? " · Homebrew" : ""}</strong>${abilPicker}<button type="button" class="remove-btn no-print" data-remove-extra-feat="${esc(id)}" title="Remover">×</button></div>`;
  }).join("");
  box.querySelectorAll("[data-remove-extra-feat]").forEach((b) => b.addEventListener("click", () => {
    character.extraFeats = (character.extraFeats || []).filter((id) => id !== b.dataset.removeExtraFeat);
    saveCharacter(character); renderExtraFeats(); recalc();
  }));
  box.querySelectorAll("[data-extra-feat-ability]").forEach((s) => s.addEventListener("change", () => {
    character.choiceSelections.featAbility = character.choiceSelections.featAbility || {};
    character.choiceSelections.featAbility[s.dataset.extraFeatAbility] = s.value || "";
    saveCharacter(character); recalc();
  }));
}
async function openExtraFeatPicker() {
  const modal = $("modal"), content = $("modal-content");
  content.innerHTML = `<div class="modal-title"><div><span class="eyebrow">TALENTOS</span><h2>Adicionar Talento</h2><p class="muted">Escolha qualquer talento do catálogo (oficial ou homebrew, conforme o seletor "Conteúdo" no topo).</p></div></div><div class="loading">Carregando catálogo…</div>`;
  modal.classList.remove("hidden");
  try { await ensureCatalog("feat"); } catch (err) { console.error(err); }
  content.innerHTML = `<div class="modal-title"><div><span class="eyebrow">TALENTOS</span><h2>Adicionar Talento</h2><p class="muted">Escolha qualquer talento do catálogo (oficial ou homebrew, conforme o seletor "Conteúdo" no topo).</p></div></div>
    <div class="picker-controls"><input id="picker-search" placeholder="Pesquisar talento…"></div>
    <div id="picker-results" class="picker-grid"></div>`;
  const render = () => {
    const q = $("picker-search").value.trim();
    const arr = filteredPicker("feat", q).filter((e) => !/ability score improvement/i.test(e.name));
    paintPickResults($("picker-results"), arr.slice(0, 200), (e) => {
      $("modal").classList.add("hidden");
      addExtraFeat(e.id);
    });
  };
  $("picker-search").addEventListener("input", render);
  render();
}

// ------------------------------------------------------------
// Templates de personagem — construções salvas pra reaproveitar
// ------------------------------------------------------------
function templateSnapshot() {
  return {
    edition: character.edition, content: character.content, abilityMode: character.abilityMode,
    classId: character.classId, subclassId: character.subclassId, raceId: character.raceId, backgroundId: character.backgroundId,
    multiclasses: character.multiclasses, scores: character.scores,
    choiceSelections: character.choiceSelections, manualSkillProficiencies: character.manualSkillProficiencies,
    skillExpertise: character.skillExpertise, level: character.level,
  };
}
function templateSummary(t) {
  const cls = manifest().find((x) => x.id === t.classId);
  const race = manifest().find((x) => x.id === t.raceId);
  return `${race ? titleOf(race) : "—"} · ${cls ? titleOf(cls) : "—"} · nível ${t.level || 1}`;
}
function openTemplatesModal() {
  const list = getTemplates();
  $("modal-content").innerHTML = `<div class="modal-title"><div><span class="eyebrow">MODELOS</span><h2>Meus Modelos</h2><p class="muted">Salve a construção atual (classe, subclasse, espécie, background, atributos e escolhas) como modelo reaproveitável — não inclui nome, PV atual nem inventário específico.</p></div></div>
    <div class="modal-body">
      <div class="template-grid" id="template-grid">${list.length ? list.map((t) => `<div class="template-card" data-template-id="${esc(t.id)}"><b>${esc(t.name)}</b><p>${esc(templateSummary(t))}</p><div class="template-card-actions"><button type="button" class="primary" data-use-template="${esc(t.id)}">Usar</button><button type="button" data-delete-template="${esc(t.id)}">Deletar</button></div></div>`).join("") : `<div class="template-empty">Nenhum modelo salvo ainda.</div>`}</div>
      <div class="template-save-row"><input id="template-name" placeholder="Nome do novo modelo (ex.: Guerreiro Básico)"><button type="button" class="primary" id="template-save">💾 Salvar como modelo</button></div>
    </div>`;
  $("modal").classList.remove("hidden");
  $("template-save").addEventListener("click", () => {
    const name = $("template-name").value.trim();
    if (!name) { toast("Dê um nome ao modelo."); return; }
    if (!refs.class && !refs.race) { toast("Escolha ao menos uma classe ou espécie antes de salvar."); return; }
    const arr = getTemplates();
    arr.push({ id: `tpl-${Date.now()}`, name, ...templateSnapshot() });
    saveTemplates(arr);
    toast(`Modelo "${name}" salvo.`);
    openTemplatesModal();
  });
  $("modal-content").querySelectorAll("[data-use-template]").forEach((b) => b.addEventListener("click", async () => {
    const t = getTemplates().find((x) => x.id === b.dataset.useTemplate);
    if (!t) return;
    const f = fresh();
    character = {
      ...character, ...f,
      name: character.name, hpCurrent: null, hpTemp: 0, inventory: [], attacks: character.attacks, preparedSpells: [],
      edition: t.edition, content: t.content, abilityMode: t.abilityMode,
      classId: t.classId, subclassId: t.subclassId, raceId: t.raceId, backgroundId: t.backgroundId,
      multiclasses: t.multiclasses || [], scores: { ...f.scores, ...(t.scores || {}) },
      choiceSelections: t.choiceSelections || f.choiceSelections, manualSkillProficiencies: t.manualSkillProficiencies || [],
      skillExpertise: t.skillExpertise || [], level: t.level || 1,
    };
    $("edition").value = character.edition; $("content").value = character.content; $("level").value = character.level;
    saveCharacter(character);
    $("modal").classList.add("hidden");
    await refreshChoices();
    toast(`Modelo "${t.name}" aplicado.`);
  }));
  $("modal-content").querySelectorAll("[data-delete-template]").forEach((b) => b.addEventListener("click", () => {
    if (!confirm("Apagar este modelo?")) return;
    saveTemplates(getTemplates().filter((x) => x.id !== b.dataset.deleteTemplate));
    openTemplatesModal();
  }));
}

// ------------------------------------------------------------
// Assistente de "Subir de Nível" — em vez de só recalcular tudo em
// silêncio quando o nível muda, mostra um resumo do que apareceu de
// novo nesse nível específico (características de classe/subclasse,
// ASI disponível, mudança nos espaços de magia), com atalho pras
// abas onde dá pra terminar a escolha. Só a classe primária por
// enquanto (o campo "Nível" do topo da ficha).
// ------------------------------------------------------------
async function openLevelUpModal(oldLevel, newLevel) {
  $("modal-content").innerHTML = `<div class="modal-title"><div><span class="eyebrow">SUBIU DE NÍVEL</span><h2>Nível ${oldLevel} → ${newLevel}</h2><p class="muted">Carregando o que há de novo…</p></div></div>`;
  $("modal").classList.remove("hidden");

  const newFeats = [];
  if (refs.class) {
    const feats = await findClassFeatures(refs.class, newLevel).catch(() => []);
    feats.filter((f) => f.level > oldLevel).forEach((f) => newFeats.push({ ...f, from: titleOf(refs.class) }));
  }
  if (refs.subclass) {
    const feats = await findSubclassFeatures(refs.subclass, newLevel).catch(() => []);
    feats.filter((f) => f.level > oldLevel).forEach((f) => newFeats.push({ ...f, from: titleOf(refs.subclass) }));
  }
  newFeats.sort((a, b) => a.level - b.level);

  const gotAsi = newFeats.some((f) => isAsiFeatureName(f.name));
  const infoNew = spellcastingInfoFor(details.classRec, details.subclassRec, newLevel);
  const infoOld = spellcastingInfoFor(details.classRec, details.subclassRec, oldLevel);
  const slotsChanged = !!infoNew && (
    (infoNew.slots || []).some((n, i) => (n || 0) > (infoOld?.slots?.[i] || 0)) ||
    (infoNew.pact && (!infoOld?.pact || infoNew.pact.count > infoOld.pact.count || infoNew.pact.level > infoOld.pact.level)) ||
    (infoNew.cantrips || 0) > (infoOld?.cantrips || 0)
  );

  const featsHtml = newFeats.length
    ? `<div class="lore-features">${newFeats.map((f) => `<article class="lore-feature"><div class="lore-feature-head"><b>${esc(f.name)}</b><span>Nível ${esc(f.level)} · ${esc(f.from)}</span></div>${f.entries ? richText(f.entries) : "<p class='muted'>Sem texto no banco para esta característica.</p>"}</article>`).join("")}</div>`
    : `<p class="muted">${refs.class ? "Nenhuma característica nova de classe/subclasse encontrada no banco pra este intervalo." : "Escolha uma classe pra ver as características ganhas em cada nível."}</p>`;

  $("modal-content").innerHTML = `<div class="modal-title"><div><span class="eyebrow">SUBIU DE NÍVEL</span><h2>Nível ${oldLevel} → ${newLevel}</h2><p class="muted">Resumo do que mudou — dá pra ajustar tudo depois, a qualquer momento, no modo livre.</p></div></div>
    <div class="modal-body">
      <div class="levelup-summary">
        <span class="levelup-chip">+${newLevel - oldLevel} dado(s) de vida</span>
        ${gotAsi ? `<button type="button" class="levelup-chip action" data-levelup-goto="build">⬆ Melhoria de atributo/talento disponível</button>` : ""}
        ${slotsChanged ? `<button type="button" class="levelup-chip action" data-levelup-goto="spells">✨ Espaços de magia mudaram</button>` : ""}
      </div>
      <h3 class="codex-divider">Novas características</h3>
      ${featsHtml}
    </div>`;
  $("modal-content").querySelectorAll("[data-levelup-goto]").forEach((b) => b.addEventListener("click", () => {
    $("modal").classList.add("hidden");
    document.querySelector(`.tab[data-tab="${b.dataset.levelupGoto}"]`)?.click();
  }));
}

// ------------------------------------------------------------
// Múltiplos personagens salvos — cada um vira um slot próprio no
// localStorage (ver storage.js); esta modal lista, alterna, duplica,
// renomeia e apaga os personagens salvos neste navegador.
// ------------------------------------------------------------
function openCharactersModal() {
  const list = listCharacters();
  const activeId = getActiveCharacterId();
  $("modal-content").innerHTML = `<div class="modal-title"><div><span class="eyebrow">PERSONAGENS</span><h2>Meus Personagens</h2><p class="muted">Salvos neste navegador. Alterne, duplique ou apague fichas — cada uma guarda seu próprio progresso.</p></div></div>
    <div class="modal-body">
      <button type="button" class="add-btn" id="char-new-btn">+ Novo personagem</button>
      <div class="char-list">
        ${list.length ? list.map((c) => `<div class="char-row${c.id === activeId ? " active" : ""}">
          <div class="char-row-info"><strong>${esc(c.name)}</strong><small>Nível ${c.level}${c.id === activeId ? " · aberto agora" : ""}</small></div>
          <div class="char-row-actions">
            ${c.id === activeId ? "" : `<button type="button" data-char-switch="${esc(c.id)}">Abrir</button>`}
            <button type="button" data-char-duplicate="${esc(c.id)}">Duplicar</button>
            <button type="button" class="remove-btn" data-char-delete="${esc(c.id)}" title="Apagar">×</button>
          </div>
        </div>`).join("") : `<p class="muted">Nenhum personagem salvo ainda.</p>`}
      </div>
    </div>`;
  $("modal").classList.remove("hidden");
  $("char-new-btn")?.addEventListener("click", () => { $("modal").classList.add("hidden"); createNewCharacter(); });
  $("modal-content").querySelectorAll("[data-char-switch]").forEach((b) => b.addEventListener("click", () => switchCharacter(b.dataset.charSwitch)));
  $("modal-content").querySelectorAll("[data-char-duplicate]").forEach((b) => b.addEventListener("click", () => duplicateCharacter(b.dataset.charDuplicate)));
  $("modal-content").querySelectorAll("[data-char-delete]").forEach((b) => b.addEventListener("click", () => deleteCharacterFlow(b.dataset.charDelete)));
}
function createNewCharacter() {
  const id = createCharacterSlot();
  setActiveCharacterId(id);
  attackRollMessages = {}; hdRollMessages = {};
  applyLoaded(fresh());
  saveCharacter(character); // salva já, pra aparecer na lista mesmo sem editar nada ainda
  toast('Novo personagem criado — o anterior continua salvo em "Meus Personagens".');
}
// ------------------------------------------------------------
// Personagem aleatório — sorteia espécie/classe/subclasse/background,
// atributos (rolados) e nome, resolve sozinho as escolhas automáticas
// (perícias, aumentos de atributo, talentos, características opcionais)
// e já aplica o equipamento inicial. Sai um personagem de nível 1 pronto
// pra jogar — 100% editável depois pelo modo livre normal.
// ------------------------------------------------------------
const RANDOM_NAME_SYLLABLES = {
  first: ["Ar", "Bel", "Cor", "Dra", "El", "Fen", "Gal", "Hal", "Ir", "Jor", "Kael", "Lor", "Mor", "Nyr", "Orin", "Pel", "Quen", "Ral", "Syl", "Thal", "Ul", "Vor", "Wyn", "Xan", "Yor", "Zel"],
  mid: ["a", "an", "ar", "el", "en", "ia", "in", "on", "or", "wen", "yn"],
  last: ["dor", "iel", "mir", "nor", "rick", "ric", "sten", "thas", "vane", "wyn", "yra", "zor", "an", "ea", "ion"],
};
function randomCharacterName() {
  const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
  let name = pick(RANDOM_NAME_SYLLABLES.first);
  if (Math.random() < 0.7) name += pick(RANDOM_NAME_SYLLABLES.mid);
  name += pick(RANDOM_NAME_SYLLABLES.last);
  return name;
}
function randomPick(arr, n) {
  const pool = (arr || []).slice();
  const out = [];
  for (let i = 0; i < n && pool.length; i++) out.push(pool.splice(Math.floor(Math.random() * pool.length), 1)[0]);
  return out;
}
// Preenche sozinho toda escolha pendente do painel de automação (mesmas
// chaves/formatos que os handlers de `renderAutoChoices` escrevem à mão)
// a partir dos dados que `buildAutomation()` calculou pro personagem atual.
function randomizeChoiceSelections(data) {
  character.choiceSelections.classSkills = data.classChoices.map((ch) => randomPick(ch.from, ch.count));
  character.choiceSelections.backgroundSkills = data.backgroundChoices.map((ch) => randomPick(ch.from, ch.count));
  character.choiceSelections.raceSkills = (data.raceChoices || []).map((ch) => randomPick(ch.from, ch.count));
  character.choiceSelections.multiclassSkills = (data.mcSkillChoices || []).map((ch) => (ch ? randomPick(ch.from, ch.count) : []));
  character.choiceSelections.abilityChoices = data.abilityChoices.map((ch) => randomPick(ch.from, ch.count));

  if (data.bgAbility?.hasChoice) {
    const modeIdx = Math.floor(Math.random() * data.bgAbility.modes.length);
    character.choiceSelections.bgAbilityMode = modeIdx;
    character.choiceSelections.bgAbility = randomPick(data.bgAbility.from, (data.bgAbility.modes[modeIdx] || []).length);
  }

  if (data.expertise > 0) {
    const proficient = SKILLS.filter(([k]) => character.skillProficiencies.includes(k)).map(([k]) => k);
    character.skillExpertise = randomPick(proficient, data.expertise);
  }

  character.choiceSelections.optionalFeatures = character.choiceSelections.optionalFeatures || {};
  (data.optFeatures || []).forEach((prog) => {
    const types = new Set(prog.featureType);
    const lvl = Number(character.level);
    const opts = manifest().filter((x) =>
      normType(x.type) === "optionalfeature" && pickerContentOk(x) &&
      ((x.__rec || recordsForEntity(x)[0])?.featureType || []).some((t) => types.has(t)) &&
      matchesEdition(x, character.edition, true) &&
      prereqLevel(x.__rec || recordsForEntity(x)[0] || {}) <= lvl);
    character.choiceSelections.optionalFeatures[prog.name] = randomPick(opts.map((x) => x.id), prog.count);
  });

  if (data.originSpec && !data.originSpec.fixed) {
    const opts = eligibleFeats(data.originSpec.categories);
    character.choiceSelections.originFeat = opts.length ? randomPick(opts, 1)[0].id : null;
  }
  if (data.raceSpec && !data.raceSpec.fixed) {
    const opts = eligibleFeats(data.raceSpec.categories);
    character.choiceSelections.raceFeat = opts.length ? randomPick(opts, 1)[0].id : null;
  }
  // Melhoria de atributo/talento (níveis 4/8/12…): por padrão sorteia
  // +1 em dois atributos distintos — simples e sempre válido, sem
  // precisar checar pré-requisito de talento pra cada slot.
  character.choiceSelections.asi = Array.from({ length: data.asiCount || 0 }, () => ({ mode: "ability", abil: randomPick(ABILITIES, 2) }));
}
// Atributo(s) principal(is) da classe/subclasse sorteada, pra jogar os
// valores mais altos nelas (ex.: Sabedoria alta pro Clérigo) em vez de
// distribuir tudo cego. `primaryAbility` é o campo padrão do 5etools —
// lista de blocos, cada bloco = alternativas equivalentes (ex.: Guerreiro
// FOR *ou* DES viram dois blocos de 1 atributo cada; Paladino FOR *e* CAR
// vira um bloco com os dois). Homebrew raramente traz esse campo — nesse
// caso cai pro atributo de conjuração e, por fim, pras resistências da
// classe (bom palpite: normalmente pelo menos uma delas é a principal).
function classAbilityPriority(classRec, subclassRec) {
  const out = [];
  const add = (k) => { const a = abilityKey(k); if (a && !out.includes(a)) out.push(a); };
  // Cada bloco de `primaryAbility` é um conjunto de alternativas EQUIVALENTES
  // (ex.: Guerreiro FOR *ou* DES viram dois blocos de 1 atributo cada).
  // Embaralha a ordem dos blocos — e dos atributos dentro de cada um, pro
  // caso "FOR e CAR" do Paladino — pra variar qual delas sai priorizada em
  // cada sorteio, em vez de sempre favorecer a mesma alternativa.
  const blocks = [];
  for (const rec of [classRec, subclassRec]) {
    for (const blk of rec?.primaryAbility || []) {
      const keys = Object.keys(blk || {}).map(abilityKey).filter(Boolean);
      if (keys.length) blocks.push(keys);
    }
  }
  randomPick(blocks, blocks.length).forEach((keys) => randomPick(keys, keys.length).forEach(add));
  if (!out.length) {
    const spellAbil = spellAbilityFrom(classRec) || spellAbilityFrom(subclassRec);
    if (spellAbil) add(spellAbil);
    savesFrom(classRec).forEach(add);
  }
  return out;
}
// Distribui `values` (6 números — rolados ou um array pré-definido) pelos
// atributos: os maiores valores vão pra `priority` (atributo principal da
// classe primeiro, depois Constituição — sempre útil pra PV/concentração)
// e o resto é sorteado nos atributos restantes.
function smartAbilityAssignment(values, priority) {
  const order = priority.filter((a) => ABILITIES.includes(a));
  if (!order.includes("con")) order.push("con");
  order.push(...randomPick(ABILITIES.filter((a) => !order.includes(a)), 6));
  const sorted = values.slice().sort((a, b) => b - a);
  const assignment = {};
  order.forEach((a, i) => { assignment[a] = i; });
  return { values: sorted, assignment };
}
// Duas chamadas concorrentes (clique duplo, ou abrir o modal de novo
// enquanto a anterior ainda está sorteando) mexeriam nas mesmas variáveis
// de módulo (`character`, `refs`, `details`) ao mesmo tempo e corrompiam o
// resultado — a segunda chamada não faz nada enquanto a primeira roda.
let randomizingCharacter = false;
async function randomizeCharacter(abilityGenMode = "roll") {
  if (randomizingCharacter) { toast("Já tem um sorteio em andamento — aguarde."); return; }
  randomizingCharacter = true;
  try {
    return await randomizeCharacterImpl(abilityGenMode);
  } finally {
    randomizingCharacter = false;
  }
}
async function randomizeCharacterImpl(abilityGenMode) {
  toast("Sorteando personagem…");
  await Promise.all(["race", "class", "background"].map((t) => ensureCatalog(t).catch((err) => console.warn("Catálogo indisponível:", err))));

  const edition = character.edition, content = character.content;
  const contentOk = (x) => content === "all" || (content === "official" && !isNonOfficial(x)) || (content === "homebrew" && isNonOfficial(x));
  const pool = (type) => manifest().filter((x) => normType(x.type) === normType(type) && matchesEdition(x, edition, true) && contentOk(x));
  const pickOne = (arr) => (arr.length ? arr[Math.floor(Math.random() * arr.length)] : null);

  const race = pickOne(pool("race"));
  const klass = pickOne(pool("class"));
  const background = pickOne(pool("background"));
  if (!race || !klass || !background) { toast("Banco de dados ainda carregando — tente de novo em instantes."); return; }
  const subPool = manifest().filter((x) => normType(x.type) === "subclass" && matchesEdition(x, edition, true) && contentOk(x) && String(x.className || "").toLowerCase() === String(klass.name).toLowerCase());
  const subclass = pickOne(subPool);
  const [classRec, subclassRec] = await Promise.all([firstRecord(klass), subclass ? firstRecord(subclass) : null]);

  const next = fresh();
  next.edition = edition; next.content = content;
  next.name = randomCharacterName();
  next.level = 1;
  next.raceId = race.id; next.classId = klass.id; next.subclassId = subclass?.id || ""; next.backgroundId = background.id;

  const isRoll = abilityGenMode === "roll";
  const rawValues = isRoll ? Array.from({ length: 6 }, () => rollAbilityScore()) : (ABILITY_ARRAYS[abilityGenMode]?.values || ABILITY_ARRAYS.standard.values);
  const priority = classAbilityPriority(classRec, subclassRec);
  const { values, assignment } = smartAbilityAssignment(rawValues, priority);
  next.abilityMode = isRoll ? "roll" : abilityGenMode;
  next.arrayAssignment = assignment;
  if (isRoll) next.rolledSet = values;
  ABILITIES.forEach((a) => { next.scores[a] = values[assignment[a]]; });

  attackRollMessages = {}; hdRollMessages = {};
  applyLoaded(next);
  await refreshChoices();

  const data = await buildAutomation();
  randomizeChoiceSelections(data);
  applyStartingEquipment();
  saveCharacter(character);
  await recalc();
  toast(`Personagem aleatório: ${titleOf(race)} · ${titleOf(klass)}${subclass ? " (" + titleOf(subclass) + ")" : ""} · ${titleOf(background)}. Dá pra ajustar tudo depois.`);
}
function openRandomCharacterModal() {
  $("modal-content").innerHTML = `<div class="modal-title"><div><span class="eyebrow">ALEATÓRIO</span><h2>Personagem Aleatório</h2><p class="muted">Sorteia espécie, classe, subclasse, background, perícias, talentos e equipamento inicial — os valores mais altos vão pro atributo principal da classe sorteada (ex.: Sabedoria alta pro Clérigo). Só falta escolher como gerar os atributos.</p></div></div>
    <div class="modal-body">
      <div class="template-grid">
        <div class="template-card"><b>🎲 Rolagem (4d6)</b><p>Rola 4d6 e descarta o menor, seis vezes — clássico, com variação de sorte.</p><div class="template-card-actions"><button type="button" class="primary" data-random-abil="roll">Sortear</button></div></div>
        <div class="template-card"><b>Array Padrão</b><p>15, 14, 13, 12, 10, 8 — equilibrado, sem excesso nem carência.</p><div class="template-card-actions"><button type="button" class="primary" data-random-abil="standard">Sortear</button></div></div>
        <div class="template-card"><b>Array Heroico</b><p>16, 15, 14, 13, 12, 10 — personagem já mais forte de cara.</p><div class="template-card-actions"><button type="button" class="primary" data-random-abil="heroic">Sortear</button></div></div>
        <div class="template-card"><b>Array Épico</b><p>18, 16, 14, 12, 10, 8 — bem concentrado no atributo principal.</p><div class="template-card-actions"><button type="button" class="primary" data-random-abil="epic">Sortear</button></div></div>
      </div>
    </div>`;
  $("modal").classList.remove("hidden");
  $("modal-content").querySelectorAll("[data-random-abil]").forEach((b) => b.addEventListener("click", () => {
    $("modal").classList.add("hidden");
    randomizeCharacter(b.dataset.randomAbil).catch((err) => { console.error(err); toast("Não deu pra sortear um personagem agora."); });
  }));
}
function switchCharacter(id) {
  if (id === getActiveCharacterId()) { $("modal").classList.add("hidden"); return; }
  setActiveCharacterId(id);
  attackRollMessages = {}; hdRollMessages = {};
  applyLoaded(loadCharacterById(id) || fresh());
  $("modal").classList.add("hidden");
  toast("Personagem carregado.");
}
function duplicateCharacter(id) {
  const src = loadCharacterById(id);
  if (!src) return;
  const newId = createCharacterSlot();
  saveCharacterAs(newId, { ...src, name: `${src.name || "Personagem"} (cópia)` });
  toast("Personagem duplicado.");
  openCharactersModal();
}
function deleteCharacterFlow(id) {
  const list = listCharacters();
  if (list.length <= 1) { toast("Mantenha ao menos um personagem — apague pelo botão \"Novo\" só depois de criar outro."); return; }
  const c = list.find((x) => x.id === id);
  if (!confirm(`Apagar "${c?.name || "este personagem"}" definitivamente? Essa ação não pode ser desfeita.`)) return;
  const wasActive = id === getActiveCharacterId();
  deleteCharacterSlot(id);
  if (wasActive) {
    const nextId = listCharacters()[0]?.id;
    if (nextId) { setActiveCharacterId(nextId); attackRollMessages = {}; hdRollMessages = {}; applyLoaded(loadCharacterById(nextId) || fresh()); }
  }
  openCharactersModal();
  toast("Personagem apagado.");
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
    // Ataques salvos antes do cálculo automático (só bônus/dano em texto
    // livre) continuam mostrando o texto digitado — viram modo "manual"
    // em vez de recalcular do zero e perder o que a pessoa já tinha escrito.
    // damageParts migra o texto livre de dano ("1d8+1 cortante") pros campos
    // separados (dado/bônus/tipo) na primeira vez que a ficha é aberta.
    attacks: Array.isArray(c?.attacks) ? c.attacks.map((a) => { const base = { abilityMode: a?.bonus && !a?.abilityMode ? "manual" : "str", proficient: false, itemBonus: 0, ...a }; base.damageParts = migrateDamageParts(base); return base; }) : [],
    multiclasses: Array.isArray(c?.multiclasses)
      ? c.multiclasses.map((m) => ({ classId: m?.classId || "", subclassId: m?.subclassId || "", level: Math.max(1, Math.min(19, Number(m?.level) || 1)) }))
      : [],
    auto: { ...f.auto, ...(c?.auto || {}) },
    coins: { ...f.coins, ...(c?.coins || {}) },
    choiceSelections: { ...f.choiceSelections, ...(c?.choiceSelections || {}), abilityChoices: { ...f.choiceSelections.abilityChoices, ...(c?.choiceSelections?.abilityChoices || {}) } },
    manualSkillProficiencies: Array.isArray(c?.manualSkillProficiencies) ? c.manualSkillProficiencies : [],
    hitDiceUsed: { ...(c?.hitDiceUsed || {}) },
    resourceUsage: { ...(c?.resourceUsage || {}) },
    spellSlotsUsed: Array.isArray(c?.spellSlotsUsed) ? Array.from({ length: 9 }, (_, i) => Number(c.spellSlotsUsed[i]) || 0) : Array(9).fill(0),
    pactSlotsUsed: Number(c?.pactSlotsUsed) || 0,
    conditions: Array.isArray(c?.conditions) ? c.conditions : [],
    journal: Array.isArray(c?.journal) ? c.journal : [],
    companions: Array.isArray(c?.companions) ? c.companions : [],
    buffs: Array.isArray(c?.buffs) ? c.buffs : [],
    extraFeats: Array.isArray(c?.extraFeats) ? c.extraFeats : [],
    customFeatures: Array.isArray(c?.customFeatures) ? c.customFeatures : [],
    rolledSet: Array.isArray(c?.rolledSet) ? c.rolledSet : null,
    arrayAssignment: { ...(c?.arrayAssignment || {}) },
    turnActions: { ...f.turnActions, ...(c?.turnActions || {}) },
    concentration: c?.concentration && c.concentration.name ? { name: String(c.concentration.name) } : null,
  };
  $("edition").value = character.edition;
  $("content").value = character.content;
  $("name").value = character.name;
  renderAvatar();
  $("level").value = character.level;
  $("xp").value = character.xp;
  $("alignment").value = character.alignment || "";
  $("size-override").value = character.sizeOverride || "";
  $("languages").value = character.languages || "";
  $("appearance").value = character.appearance || "";
  $("backstory").value = character.backstory || "";
  $("inspiration").checked = !!character.inspiration;
  for (const k of ["cp", "pp", "pe", "po", "pl"]) $(`coin-${k}`).value = character.coins[k] || 0;
  // Personagem em branco (slot novo, ou nada escolhido ainda): abre direto
  // na aba "Construção" em vez da "Ficha" vazia. Um personagem já montado
  // não força troca de aba — respeita onde a pessoa estava navegando.
  if (!viewOnlyMode && !character.classId && !character.raceId && !character.backgroundId && !(character.multiclasses || []).length) {
    document.querySelector('.tab[data-tab="build"]')?.click();
  }
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
// Resumo "Classe N" da classe primária + cada multiclasse — o campo
// "Classe" da ficha oficial só mostrava a classe primária, sem os
// níveis de multiclasse (o nível total do oval "Nível" já soma tudo
// via totalLevel(), mas sem isto não dava pra ver de onde vinha).
function classLevelSummary() {
  const primary = refs.class ? `${titleOf(refs.class)} ${Math.max(1, Number(character.level) || 1)}` : null;
  const mc = (details.multiclasses || []).filter((m) => m.classEntry).map((m) => `${titleOf(m.classEntry)} ${Math.max(1, Number(m.level) || 1)}`);
  return [primary, ...mc].filter(Boolean).join(" + ") || "—";
}
const OFF_SIZE = { T: "Minúsculo", S: "Pequeno", M: "Médio", L: "Grande", H: "Enorme", G: "Imenso" };
function effectiveSizeCode() {
  if (character.sizeOverride) return character.sizeOverride;
  const rec = details.raceRec || {};
  // Raças com opção de tamanho (ex.: Lefou, "Small or Medium") vinham sempre
  // no primeiro código do array — que é "S" na maioria das fontes — mesmo
  // quando o padrão da raça é Médio. Preferimos "M" quando ele é uma opção.
  return Array.isArray(rec.size) ? (rec.size.includes("M") ? "M" : rec.size[0]) : rec.size;
}
function offSizeLabel() {
  const s = effectiveSizeCode();
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
function offFeatureLines(feats, limit = 240) {
  if (!feats || !feats.length) return `<p class="off-muted">—</p>`;
  return feats.map((f) => {
    const txt = plain(f.entries).trim();
    const short = txt.length > limit ? txt.slice(0, limit).replace(/\s+\S*$/, "") + "…" : txt;
    return `<p><b>${esc(f.name || "Característica")}.</b> ${esc(short) || ""}</p>`;
  }).join("");
}
// Referência rápida da 1ª página: só os nomes (o texto completo das
// características de classe/subclasse foi pra sua própria página —
// ver buildOfficialSheet — porque truncado em 240 caracteres cortava
// bem a parte que mais importa de ler à mesa).
function offFeatureNames(feats) {
  if (!feats || !feats.length) return `<p class="off-muted">—</p>`;
  return `<p class="off-feature-names">${feats.map((f) => esc(f.name || "Característica")).join(" · ")}</p>`;
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
          <div class="off-field"><b>${esc(classLevelSummary())}</b><span>Classe${(details.multiclasses || []).some((m) => m.classEntry) ? " (multiclasse)" : ""}</span></div>
          <div class="off-field"><b>${refs.subclass ? esc(titleOf(refs.subclass)) : "—"}</b><span>Subclasse</span></div>
        </div>
      </div>
      <div class="off-oval off-oval-level"><b>${totalLevel()}</b><span>Nível</span><small>${character.xp || 0} PX</small></div>
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
        ${offBox("Armas & Truques de Dano", `<table class="off-table"><thead><tr><th>Nome</th><th>Bônus/CD</th><th>Dano &amp; Tipo</th><th>Distância</th><th>Anotações</th></tr></thead><tbody>${attacks.map((a) => `<tr><td>${esc(a.name || "")}</td><td>${esc(a.name ? attackTotalLabel(a) : "")}</td><td>${esc(a.name ? attackDamageSummary(a) : "")}</td><td>${esc(a.range || "")}</td><td>${esc(a.notes || "")}</td></tr>`).join("")}</tbody></table>`)}
        ${offBox("Características de Classe", offFeatureNames([...classFeats, ...subFeats, ...mcClassFeats, ...mcSubFeats]) + `<p class="off-muted off-feature-note">Texto completo na próxima página.</p>`)}
      </div>
    </div>

    <div class="off-row3">
      ${offBox("Características Raciais", offFeatureLines(raceTraits, 500))}
      ${offBox("Talentos", offFeatureLines(feats, 500))}
      ${character.customFeatures?.length ? offBox("Homebrew / Casa", offFeatureLines(character.customFeatures, 500)) : ""}
    </div>
  </div>`;

  // --- Página 2: conjuração + notas de personagem ---
  // Junta as magias marcadas em TODAS as classes conjuradoras do
  // personagem (não só a aba selecionada por último em "Magias") — num
  // multiclasse com duas classes conjuradoras, marcar magias na segunda
  // aba não pode fazer a primeira sumir da ficha impressa.
  const casters = spellcastingClasses().filter((cc) => spellcastingInfoFor(cc.cr, cc.sr, cc.level));
  const msi = multiclassSpellcasting();
  const slots = msi?.slots || [];
  const multiCaster = casters.length > 1;
  // A ficha impressa traz a lista COMPLETA de magias que o personagem pode
  // aprender (a lista da classe + subclasse + as avulsas do Compêndio), com
  // as preparadas marcadas — e não só as marcadas, que era o comportamento
  // antigo: quem prepara magias todo dia precisa do cardápio inteiro em mãos.
  const seenSpell = new Set();
  let spellRows = [];
  for (const caster of casters) {
    const spellEd = editionOf(caster.classEntry) === "both" ? character.edition : editionOf(caster.classEntry);
    try {
      const all = await spellsForClass(caster.classEntry, caster.subclassEntry, spellEd);
      for (const sp of all) {
        const key = `${sp.name}|${sp.source || ""}`;
        if (seenSpell.has(key)) continue;
        seenSpell.add(key);
        spellRows.push({ ...sp, _classLabel: titleOf(caster.classEntry), _prepared: character.preparedSpells.includes(key) });
      }
    } catch (err) { console.error(err); }
  }
  for (const ex of extraSpellRecords()) {
    const key = `${ex.name}|${ex.source || ""}`;
    if (seenSpell.has(key)) continue;
    seenSpell.add(key);
    spellRows.push({ ...ex, _classLabel: "Avulsa", _prepared: character.preparedSpells.includes(key) });
  }
  spellRows.sort((x, y) => (x.level ?? 0) - (y.level ?? 0) || String(x.name).localeCompare(String(y.name), "pt-BR"));
  const preparedCount = spellRows.filter((s) => s._prepared && spellLevel(s) > 0).length;
  const cantripCount = spellRows.filter((s) => s._prepared && spellLevel(s) === 0).length;
  // Limites de preparação por classe conjuradora (truques/preparadas/
  // conhecidas vindos da tabela da própria classe no nível dela).
  const casterLimits = casters.map((caster) => {
    const info = spellcastingInfoFor(caster.cr, caster.sr, caster.level);
    return { label: titleOf(caster.classEntry), level: caster.level, info };
  }).filter((x) => x.info);
  const inv = character.inventory || [];
  const cc = carryingCapacity();
  const pactInfo = (msi?.perClass || []).find((x) => x.pact)?.pact || null;
  const pactBoxHtml = pactInfo
    ? `<div class="off-slot off-slot-pact"><span>Pacto ${pactInfo.level}º</span><b>${pactInfo.count}</b><div class="off-slot-pips">${Array.from({ length: pactInfo.count }, (_, k) => `<i class="${k < Math.min(pactInfo.count, Number(character.pactSlotsUsed) || 0) ? "on" : ""}"></i>`).join("")}</div></div>`
    : "";

  // --- Página das Características de Classe ---
  // O texto completo de características de classe/subclasse (às vezes
  // vários parágrafos) não cabia na 1ª página sem truncar em 240
  // caracteres — cortando bem a parte mais importante de ler à mesa.
  // A 1ª página agora só lista os nomes; o texto inteiro mora aqui.
  const allClassFeats = [...classFeats, ...subFeats, ...mcClassFeats, ...mcSubFeats];
  const pageFeatures = allClassFeats.length ? `<div class="off-page off-page-features">
    <div class="off-page-title"><h2>${esc(character.name || "Personagem")}</h2><span>Características de Classe</span></div>
    ${offBox(`Classe${refs.class ? ` — ${esc(titleOf(refs.class))}` : ""}`, offFeatureLines(classFeats, Infinity))}
    ${subFeats.length ? offBox(`Subclasse${refs.subclass ? ` — ${esc(titleOf(refs.subclass))}` : ""}`, offFeatureLines(subFeats, Infinity)) : ""}
    ${mcClassFeats.length ? offBox("Multiclasse", offFeatureLines(mcClassFeats, Infinity)) : ""}
    ${mcSubFeats.length ? offBox("Subclasse (Multiclasse)", offFeatureLines(mcSubFeats, Infinity)) : ""}
  </div>` : "";

  // --- Página 2: detalhes do personagem ---
  // A ficha oficial separa "quem é o personagem" da parte de combate:
  // aparência, história, idiomas, equipamento, moedas e treino/
  // proficiências ficam numa página própria, e conjuração vai pra
  // seguinte. Treino & Proficiências morava na 1ª página — tirado de
  // lá pra abrir espaço, e faz mais sentido aqui do lado do Equipamento.
  const page2 = `<div class="off-page off-page-detail">
    <div class="off-page-title"><h2>${esc(character.name || "Personagem")}</h2><span>Detalhes do personagem</span></div>
    <div class="off-detail-grid">
      ${character.avatar ? offBox("Retrato", `<img class="off-avatar" src="${character.avatar}" alt="Retrato de ${esc(character.name || "personagem")}">`, "off-tall") : ""}
      ${offBox("Aparência", `<p>${esc(character.appearance || "")}</p>`, "off-tall")}
      ${offBox("História &amp; Personalidade", `<p>${esc(character.backstory || "")}</p><div class="off-align"><b>Alinhamento</b> ${esc(character.alignment || "—")}</div>`, "off-tall")}
      ${offBox("Idiomas", `<p>${esc(character.languages || "—")}</p>`)}
      ${offBox("Moedas", `<div class="off-coins">${["cp", "pp", "pe", "po", "pl"].map((k) => `<div><span>${k.toUpperCase()}</span><b>${character.coins?.[k] || 0}</b></div>`).join("")}</div>`)}
      ${offBox("Treino &amp; Proficiências", `
        <div class="off-training"><b>Treino de armadura</b> <span class="off-inline-check">${offCheck(armorOn("light"))} Leve</span> <span class="off-inline-check">${offCheck(armorOn("medium"))} Média</span> <span class="off-inline-check">${offCheck(armorOn("heavy"))} Pesada</span> <span class="off-inline-check">${offCheck(armorOn("shield"))} Escudos</span></div>
        <div class="off-training"><b>Armas</b> ${esc(weapons.join(", ") || "—")}</div>
        <div class="off-training"><b>Ferramentas</b> ${esc(tools.join(", ") || "—")}</div>
      `, "off-span2")}
      ${offBox("Equipamento", (inv.length ? `<ul class="off-list">${inv.map((i) => `<li>${esc(i.name)}${i.qty > 1 ? ` ×${i.qty}` : ""}${i.equipped ? " (equipado)" : ""}</li>`).join("")}</ul>` : `<p class="off-muted">Inventário vazio.</p>`) + `<p class="off-muted off-carry">Peso total: ${cc.total.toLocaleString("pt-BR", { maximumFractionDigits: 1 })} lb · Capacidade: ${cc.max} lb (Força × 15)</p>`, "off-tall off-span2")}
    </div>
  </div>`;

  // --- Página 3: conjuração ---
  const page3 = casterLimits.length || spellRows.length ? `<div class="off-page off-page2">
    <div class="off-page-title"><h2>${esc(character.name || "Personagem")}</h2><span>Conjuração</span></div>
    <div class="off-spell-top">
      <div class="off-box off-spell-ability"><div class="off-box-title">Atributo de Conjuração</div><div class="off-box-body off-center"><b>${c.sa ? esc(ABILITY_NAMES[c.sa]) : "—"}</b></div></div>
      <div class="off-oval"><span>Modificador<br>de Conjuração</span><b>${c.sa ? fmt(mod(effScore(c.sa))) : "—"}</b></div>
      <div class="off-oval"><span>CD de Resistência<br>de Magia</span><b>${c.dc ?? "—"}</b></div>
      <div class="off-oval"><span>Bônus de Ataque<br>de Magia</span><b>${c.atk != null ? fmt(c.atk) : "—"}</b></div>
    </div>
    ${offBox("Espaços de Magia", `<div class="off-slots">${Array.from({ length: 9 }, (_, i) => {
      const total = slots[i] || 0;
      const used = Math.min(total, Number(character.spellSlotsUsed?.[i]) || 0);
      return `<div class="off-slot${total ? "" : " off-slot-empty"}"><span>Nível ${i + 1}</span><b>${total}</b>${total ? `<div class="off-slot-pips">${Array.from({ length: total }, (_, k) => `<i class="${k < used ? "on" : ""}"></i>`).join("")}</div>` : ""}</div>`;
    }).join("")}${pactBoxHtml}</div>`)}
    ${offBox("Preparação de Magias", `<table class="off-table off-prep-table"><thead><tr><th>Classe</th><th>Nv.</th><th>Progressão</th><th>Truques</th><th>Magias preparadas / conhecidas</th><th>Nível máx.</th></tr></thead><tbody>${
      casterLimits.map(({ label, level, info }) => {
        const cap = info.prepared != null ? `${info.prepared} preparadas${info.preparedEstimated ? " (mod. + nível)" : ""}` : info.known != null ? `${info.known} conhecidas` : "à vontade (grimório/lista completa)";
        const maxLvl = Math.max((info.slots || slots || []).reduce((m, n, i) => (n ? i + 1 : m), 0), info.pact?.level || 0);
        return `<tr><td>${esc(label)}</td><td>${level}</td><td>${esc(info.label)}</td><td>${info.cantrips ?? "—"}</td><td>${esc(cap)}</td><td>${maxLvl ? `${maxLvl}º` : "—"}</td></tr>`;
      }).join("") || `<tr><td colspan="6" class="off-muted">Sem conjuração.</td></tr>`
    }</tbody></table><p class="off-prep-now">Marcadas nesta ficha: <b>${cantripCount}</b> truque(s) e <b>${preparedCount}</b> magia(s).</p>`)}
    ${offBox("Magias Preparadas / Conhecidas (as marcadas na ficha)", `<table class="off-table off-spell-table"><thead><tr><th>Nv.</th><th>Nome</th><th>Tempo</th><th>Alcance</th><th>C/R/M</th>${multiCaster ? "<th>Classe</th>" : "<th>Anotações</th>"}</tr></thead><tbody>${
      spellRows.some((s) => s._prepared) ? spellRows.filter((s) => s._prepared).map((s) => { const fl = offSpellFlags(s); return `<tr><td>${spellLevel(s) === 0 ? "T" : spellLevel(s)}</td><td>${esc(s.name)}</td><td>${esc(spellTime(s))}</td><td>${esc(offSpellRange(s))}</td><td>${fl.c ? "C " : ""}${fl.r ? "R " : ""}${fl.m ? "M" : ""}</td><td>${multiCaster ? esc(s._classLabel) : ""}</td></tr>`; }).join("")
      : `<tr><td colspan="6" class="off-muted">Nenhuma magia marcada como preparada na aba "Magias" — o repertório completo está na página seguinte.</td></tr>`
    }</tbody></table>`, "off-tall")}

  </div>` : "";

  // --- Página 4: repertório completo ---
  // Tudo que a classe (e a subclasse) pode aprender, marcado ou não, em
  // colunas por nível de magia. É a página que a pessoa consulta quando
  // vai preparar magias no dia seguinte, então precisa do cardápio todo.
  const spellsByLevel = Array.from({ length: 10 }, (_, i) => spellRows.filter((s) => spellLevel(s) === i));
  const repMaxLevel = Math.max((slots || []).reduce((m, n, i) => (n ? i + 1 : m), 0), pactInfo?.level || 0);
  const levelBlock = (arr, lvl) => {
    if (!arr.length) return "";
    const marked = arr.filter((s) => s._prepared).length;
    const total = lvl === 0 ? null : (slots[lvl - 1] || 0);
    const pactHere = pactInfo && pactInfo.level === lvl ? pactInfo.count : 0;
    // Acima do nível de magia que os espaços alcançam, a magia está na
    // lista da classe mas ainda não dá pra lançar — fica na página, em
    // cinza, pra servir de plano dos próximos níveis.
    const locked = lvl > repMaxLevel;
    const slotLabel = lvl === 0 ? "" : total ? ` · ${total} espaço(s)` : pactHere ? ` · ${pactHere} espaço(s) de Pacto` : " · ainda fora do seu alcance";
    return `<div class="off-rep-block${locked ? " off-rep-locked" : ""}">
      <div class="off-rep-head">${lvl === 0 ? "Truques" : `${lvl}º nível`} <small>${arr.length} magia(s) · ${marked} marcada(s)${slotLabel}</small></div>
      <ul class="off-rep-list">${arr.map((s) => {
        const fl = offSpellFlags(s);
        const tags = [fl.c ? "C" : "", fl.r ? "R" : "", fl.m ? "M" : ""].filter(Boolean).join("");
        return `<li class="${s._prepared ? "on" : ""}"><i>${s._prepared ? "●" : "○"}</i><span>${esc(s.name)}</span>${tags ? `<em>${tags}</em>` : ""}</li>`;
      }).join("")}</ul>
    </div>`;
  };
  const page4 = spellRows.length ? `<div class="off-page off-page3">
    <div class="off-rep-title">
      <h2>Repertório completo${refs.class ? ` — ${esc(titleOf(refs.class))}` : ""}</h2>
      <p>Todas as ${spellRows.length} magias que ${esc(character.name || "o personagem")} pode aprender neste nível — as marcadas (●) estão preparadas/conhecidas. C = concentração · R = ritual · M = componente material.</p>
      <div class="off-rep-limits">${casterLimits.map(({ label, level, info }) => {
        const cap = info.prepared != null ? `${info.prepared} preparadas` : info.known != null ? `${info.known} conhecidas` : "lista completa";

        return `<span><b>${esc(label)} ${level}</b> · ${info.cantrips != null ? `${info.cantrips} truques · ` : ""}${esc(cap)}</span>`;
      }).join("")}</div>
    </div>
    <div class="off-rep-cols">${spellsByLevel.map(levelBlock).join("")}</div>
  </div>` : "";

  $("official-sheet").innerHTML = page1 + pageFeatures + page2 + page3 + page4;
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
  if (creationMode === "guided") renderWizardStep();
  else restoreAutoPanelPosition();
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
  if (step.type === "subclass" && !refs.class) {
    body.innerHTML = `<p class="wizard-hint">${esc(step.hint)}</p><div class="wizard-current">Escolha uma classe no passo anterior antes de escolher a subclasse. Você pode pular este passo e escolher depois, no modo livre.</div>`;
    return;
  }
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
function renderWizardLevelStep(step) {
  const body = $("wizard-body");
  if (!body) return;
  const lvl = Math.max(1, Number(character.level) || 1);
  const pb = proficiency(lvl);
  const hd = Number(character.auto?.hitDice || hitDiceFrom(classInfo()) || 8) || 8;
  const spellInfo = refs.class ? spellcastingInfoFor(details.classRec, details.subclassRec, lvl) : null;
  body.innerHTML = `<p class="wizard-hint">${esc(step.hint)}</p>
    <div class="wizard-level-box">
      <input id="wizard-level-input" type="number" min="1" max="20" value="${lvl}">
      <div class="wizard-level-summary">
        <div>Pontos de vida: <b>d${hd}${lvl > 1 ? ` + ${lvl - 1}× média` : ""} + modificador de Constituição por nível</b></div>
        <div>Bônus de proficiência: <b>${fmt(pb)}</b></div>
        ${spellInfo ? `<div>Conjuração: <b>${esc(spellInfo.label)}${spellInfo.slots ? ` · espaços até ${spellInfo.slots.filter(Boolean).length}º nível` : spellInfo.pact ? ` · ${spellInfo.pact.count} espaços de Pacto (${spellInfo.pact.level}º nível)` : ""}</b></div>` : ""}
      </div>
    </div>
    <p class="muted" style="margin-top:10px">As características desbloqueadas até este nível aparecem na aba "Características" depois de concluir o assistente.</p>`;
  $("wizard-level-input").addEventListener("input", () => {
    character.level = Math.max(1, Math.min(20, Number($("wizard-level-input").value) || 1));
    $("level").value = character.level;
    saveCharacter(character); recalc();
    renderWizardLevelStep(step);
  });
}
function renderWizardMulticlassStep(step) {
  const body = $("wizard-body");
  if (!body) return;
  body.innerHTML = `<p class="wizard-hint">${esc(step.hint)}</p>
    <div class="multiclass-head"><div><span>Classes adicionais</span><small>Cada classe extra tem seu próprio nível e subclasse.</small></div>
    <button class="add-btn" type="button" id="wizard-add-multiclass">+ Adicionar classe</button></div>
    <div id="wizard-multiclass-list" class="multiclass-list"></div>`;
  renderAllMulticlasses();
  $("wizard-add-multiclass").addEventListener("click", async () => {
    if (totalLevel() >= 20) { toast("O personagem já está no nível 20."); return; }
    character.multiclasses = character.multiclasses || [];
    character.multiclasses.push({ classId: "", subclassId: "", level: 1 });
    saveCharacter(character);
    resolveMulticlassRefs();
    renderAllMulticlasses();
  });
}
function renderWizardEquipmentStep(step) {
  const body = $("wizard-body");
  if (!body) return;
  body.innerHTML = `<p class="wizard-hint">${esc(step.hint)}</p><div id="wizard-starting-equipment"><div id="wizard-starting-equipment-body"></div></div>`;
  renderStartingEquipment("wizard-starting-equipment", "wizard-starting-equipment-body", "wizard-apply-starting-equip");
}
function renderWizardAbilitiesStep(step) {
  const body = $("wizard-body");
  if (!body) return;
  body.innerHTML = `<p class="wizard-hint">${esc(step.hint)}</p>
    <div id="wiz-ability-grid" class="ability-grid"></div>
    <div class="pointbuy-bar" id="wiz-pointbuy-bar">
      <label class="ability-mode-label">Modo<select id="wiz-ability-mode">
        <option value="pointbuy">Point buy (27 pontos)</option>
        <option value="standard">Array Padrão (15,14,13,12,10,8)</option>
        <option value="heroic">Array Heroico (16,15,14,13,12,10)</option>
        <option value="epic">Array Épico (18,16,14,12,10,8)</option>
        <option value="roll">Rolagem (4d6, descarta o menor)</option>
        <option value="free">Valores livres</option>
      </select></label>
      <strong id="wiz-pointbuy-remaining-wrap">Pontos restantes: <b id="wiz-pointbuy-remaining">27</b></strong>
      <button type="button" class="no-print" id="wiz-reset-pointbuy">Resetar 10/10/10/10/10/10</button>
      <span id="wiz-ability-mode-extra" class="ability-mode-extra"></span>
    </div>
    <div id="wiz-ability-editor" class="ability-editor"></div>
    <p class="muted" id="wiz-ability-editor-hint"></p>`;
  paintAbilityEditor("wiz-");
}
// O painel "AUTOMAÇÃO DA FICHA" (#auto-panel) é o único lugar que
// concentra escolhas de talento/perícia/ASI/opções de classe — vive fora
// do wizard (visível também no modo livre, dentro da aba "Construção").
// Em vez de duplicar toda a lógica de renderAutoChoices() dentro do passo
// do wizard, reaproveita o próprio elemento: move-o pra dentro do corpo
// do wizard nesse passo e devolve pro lugar original (logo após #creator,
// dentro de #tab-build) em qualquer outro passo.
function restoreAutoPanelPosition() {
  const panel = $("auto-panel"), creator = $("creator");
  if (panel && creator && panel.previousElementSibling !== creator) creator.parentNode.insertBefore(panel, creator.nextSibling);
}
function renderWizardTalentsStep(step) {
  const body = $("wizard-body");
  if (!body) return;
  body.innerHTML = `<p class="wizard-hint">${esc(step.hint)}</p><div id="wizard-talents-slot"></div>`;
  const panel = $("auto-panel");
  if (panel) $("wizard-talents-slot").appendChild(panel);
}
function renderWizardReviewStep(step) {
  const body = $("wizard-body");
  if (!body) return;
  const rows = [["Espécie", refs.race], ["Classe", refs.class], ["Subclasse", refs.subclass], ["Background", refs.background]];
  const mcLine = (refs.multiclasses || []).filter((m) => m.classEntry).map((m) => `${titleOf(m.classEntry)} (nível ${m.level})`).join(", ");
  const c = calc();
  body.innerHTML = `<p class="wizard-hint">${esc(step.hint)}</p>
    <div class="wizard-review-grid">${rows.map(([label, e]) => `<div class="identity-row"><span>${esc(label)}</span><strong>${e ? esc(titleOf(e)) : "—"}</strong>${e ? sourceTag(e) : ""}</div>`).join("")}
    ${mcLine ? `<div class="identity-row"><span>Multiclasse</span><strong>${esc(mcLine)}</strong></div>` : ""}</div>
    <div class="two-input" style="margin-top:14px">
      <label>Nome do personagem<input id="wizard-name" value="${esc(character.name || "")}" placeholder="Nome do personagem"></label>
      <label>Nível<input id="wizard-level" type="number" min="1" max="20" value="${Number(character.level) || 1}"></label>
    </div>
    <div class="combat-big" style="margin-top:14px"><div><span>PV</span><b>${c.hp}</b></div><div><span>CA</span><b>${c.ac}</b></div><div><span>Prof.</span><b>${fmt(c.pb)}</b></div><div><span>Iniciativa</span><b>${fmt(c.init)}</b></div></div>`;
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
  if ($("wizard-next")) {
    const isLast = wizardIndex === WIZARD_STEPS.length - 1;
    const skippable = step.optional && (step.type ? !refs[step.type] : step.key === "multiclass" && !(character.multiclasses || []).length);
    $("wizard-next").textContent = isLast ? "Concluir →" : skippable ? "Pular →" : "Próximo →";
  }
  if (step.key !== "talents") restoreAutoPanelPosition();
  if (step.type) await renderWizardPickStep(step);
  else if (step.key === "level") renderWizardLevelStep(step);
  else if (step.key === "multiclass") renderWizardMulticlassStep(step);
  else if (step.key === "abilities") renderWizardAbilitiesStep(step);
  else if (step.key === "talents") renderWizardTalentsStep(step);
  else if (step.key === "equipment") renderWizardEquipmentStep(step);
  else if (step.key === "review") renderWizardReviewStep(step);
}
function finishWizard() {
  setCreationMode("free");
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

// ------------------------------------------------------------
// Exportar pro Foundry VTT (sistema dnd5e)
// ------------------------------------------------------------
// Diferente do Discord (webhook público, sem servidor), o Foundry não tem
// nenhuma forma de aceitar dados de um site externo sem que o próprio
// mestre instale algo no servidor dele — então em vez de uma integração ao
// vivo, isso gera um Actor "character" no formato que o sistema dnd5e
// entende, pra importar pela aba de Atores do mundo Foundry (botão
// "Importar Dados" no diretório de Atores, ou arrastar o .json pra lá).
//
// Ficamos deliberadamente conservadores nos campos mais sensíveis a versão
// do dnd5e (raça/background como Item por referência, damage.parts
// estruturado, progressão de magia da classe): preferimos um Actor que
// sempre importa sem erro, com os números certos (atributos, PV, CA,
// perícias, deslocamento, magias conhecidas) e o texto completo de cada
// característica/magia, a arriscar um campo com formato errado travando
// a importação inteira numa versão do Foundry que não teste aqui.
function downloadJson(obj, filename) {
  const blob = new Blob([JSON.stringify(obj, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob), a = document.createElement("a");
  a.href = url; a.download = filename; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 500);
}
const FOUNDRY_SKILL_KEY = {
  acrobatics: "acr", animalHandling: "ani", arcana: "arc", athletics: "ath", deception: "dec",
  history: "his", insight: "ins", intimidation: "itm", investigation: "inv", medicine: "med",
  nature: "nat", perception: "prc", performance: "prf", persuasion: "per", religion: "rel",
  sleightOfHand: "slt", stealth: "ste", survival: "sur",
};
const FOUNDRY_SIZE_KEY = { T: "tiny", S: "sm", M: "med", L: "lg", H: "huge", G: "grg" };
const FOUNDRY_SCHOOL_KEY = { A: "abj", C: "con", D: "div", EN: "enc", EV: "evo", I: "ill", N: "nec", T: "trs" };
function foundryFeatItem(name, entries) {
  return { name: name || "Característica", type: "feat", img: "icons/svg/book.svg", system: { description: { value: richText(entries) || "" } } };
}
function foundrySpellItem(rec) {
  return {
    name: rec.name, type: "spell", img: "icons/svg/daze.svg",
    system: {
      description: { value: richText(rec.entries) || "" },
      level: Number(rec.level) || 0,
      school: FOUNDRY_SCHOOL_KEY[String(rec.school || "").toUpperCase()] || "",
      source: { book: rec.source || "" },
    },
  };
}
function foundryInventoryItem(x, rec) {
  const at = armorTypeOf(rec);
  if (at) {
    return {
      name: x.name, type: "equipment", img: "icons/svg/shield.svg",
      system: {
        description: { value: x.meta || "" }, quantity: Number(x.qty) || 1, equipped: !!x.equipped,
        armor: { value: Number(rec?.ac) || (at === "shield" ? 2 : 10), type: at },
      },
    };
  }
  return { name: x.name, type: "loot", img: "icons/svg/item-bag.svg", system: { description: { value: x.meta || "" }, quantity: Number(x.qty) || 1 } };
}
function foundryWeaponAbility(a) {
  if (a.abilityMode === "dex") return "dex";
  if (a.abilityMode === "spell") return abilityKey(character.spellAbility) || "";
  if (a.abilityMode === "manual") return "";
  return "str";
}
function foundryWeaponItem(a) {
  const dmgSummary = attackDamageSummary(a);
  const descLines = [dmgSummary && dmgSummary !== "—" ? `Dano: ${esc(dmgSummary)}` : "", a.range ? `Distância: ${esc(a.range)}` : ""].filter(Boolean);
  return {
    name: a.name || "Ataque", type: "weapon", img: "icons/svg/sword.svg",
    system: {
      description: { value: descLines.join("<br>") },
      proficient: a.proficient ? 1 : 0,
      ability: foundryWeaponAbility(a),
    },
  };
}
async function buildFoundryActor() {
  const c = calc();
  const level = totalLevel();
  const raceRec = details.raceRec || {};
  const sizeCode = effectiveSizeCode();

  const abilities = {};
  for (const a of ABILITIES) abilities[a] = { value: effScore(a), proficient: character.saveProficiencies.includes(a) ? 1 : 0 };

  const skills = {};
  for (const [key] of SKILLS) {
    const fk = FOUNDRY_SKILL_KEY[key];
    if (fk) skills[fk] = { value: character.skillExpertise.includes(key) ? 2 : character.skillProficiencies.includes(key) ? 1 : 0 };
  }

  const speedMatch = String(c.speed || "").match(/^(\d+)/);
  const movement = { walk: speedMatch ? Number(speedMatch[1]) : 30, units: "ft" };
  const speedExtra = String(c.speed || "").match(/\(([^)]+)\)/)?.[1] || "";
  if (/nata[cç][aã]o|swim/i.test(speedExtra)) movement.swim = movement.walk;
  if (/escalada|climb/i.test(speedExtra)) movement.climb = movement.walk;

  const senses = { units: "ft" };
  if (raceRec.darkvision) senses.darkvision = Number(raceRec.darkvision) || 0;

  const classLabel = refs.class ? titleOf(refs.class) : "";
  const subclassLabel = refs.subclass ? titleOf(refs.subclass) : "";
  const raceLabel = refs.race ? titleOf(refs.race) : "";
  const bgLabel = refs.background ? titleOf(refs.background) : "";
  const mcLabels = (details.multiclasses || []).map((m) => m.classEntry ? `${titleOf(m.classEntry)} ${m.level}` : null).filter(Boolean);
  const biography = `<p><strong>Importado da Ficha de D&D 5e automatizada.</strong></p>` +
    `<p>${esc(raceLabel)} · ${esc(classLabel)}${subclassLabel ? ` (${esc(subclassLabel)})` : ""} nível ${level}` +
    `${mcLabels.length ? ` + ${mcLabels.map(esc).join(", ")}` : ""} · Antecedente: ${esc(bgLabel)}</p>`;

  const items = [];
  if (refs.class) (await findClassFeatures(refs.class, level).catch(() => [])).forEach((f) => items.push(foundryFeatItem(`${f.name} (${classLabel})`, f.entries)));
  for (const m of details.multiclasses || []) {
    if (!m.classEntry) continue;
    (await findClassFeatures(m.classEntry, m.level).catch(() => [])).forEach((f) => items.push(foundryFeatItem(`${f.name} (${titleOf(m.classEntry)})`, f.entries)));
  }
  if (refs.subclass) (await findSubclassFeatures(refs.subclass, level).catch(() => [])).forEach((f) => items.push(foundryFeatItem(`${f.name} (${subclassLabel})`, f.entries)));
  if (refs.race) {
    const r = await firstRecord(refs.race);
    (Array.isArray(r?.entries) ? r.entries.filter((x) => x?.name) : []).forEach((x) => items.push(foundryFeatItem(`${x.name} (${raceLabel})`, x.entries || x)));
  }
  if (refs.background) {
    const r = await firstRecord(refs.background);
    (Array.isArray(r?.entries) ? r.entries.filter((x) => x?.name) : []).forEach((x) => items.push(foundryFeatItem(`${x.name} (${bgLabel})`, x.entries)));
  }

  const spellSeen = new Set();
  for (const cc of spellcastingClasses()) {
    if (!spellcastingInfoFor(cc.cr, cc.sr, cc.level)) continue;
    const spellEd = editionOf(cc.classEntry) === "both" ? character.edition : editionOf(cc.classEntry);
    for (const rec of await spellsForClass(cc.classEntry, cc.subclassEntry, spellEd).catch(() => [])) {
      const key = `${rec.name}|${rec.source}`;
      if (spellSeen.has(key)) continue;
      spellSeen.add(key);
      items.push(foundrySpellItem(rec));
    }
  }
  for (const rec of extraSpellRecords()) {
    const key = `${rec.name}|${rec.source}`;
    if (spellSeen.has(key)) continue;
    spellSeen.add(key);
    items.push(foundrySpellItem(rec));
  }

  for (const a of character.attacks || []) items.push(foundryWeaponItem(a));
  for (const x of character.inventory || []) items.push(foundryInventoryItem(x, invItemRecord(x)));

  return {
    name: character.name || "Personagem sem nome",
    type: "character",
    img: "icons/svg/mystery-man.svg",
    system: {
      abilities,
      attributes: {
        hp: { value: character.hpCurrent == null ? c.hp : character.hpCurrent, max: c.hp, temp: character.hpTemp || 0 },
        ac: { flat: c.ac, calc: "flat" },
        movement,
        senses,
        spellcasting: c.sa || "",
        death: { success: character.deathSaves?.success || 0, failure: character.deathSaves?.failure || 0 },
      },
      details: { level, biography: { value: biography } },
      traits: { size: FOUNDRY_SIZE_KEY[sizeCode] || "med" },
      skills,
      currency: { pp: 0, gp: 0, ep: 0, sp: 0, cp: 0 },
    },
    items,
  };
}

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
  $("avatar-block").addEventListener("click", (e) => { if (e.target.id !== "avatar-remove") $("avatar-input").click(); });
  $("avatar-input").addEventListener("change", async (e) => {
    const file = e.target.files[0];
    e.target.value = "";
    if (!file) return;
    try { character.avatar = await resizeAvatar(file); saveCharacter(character); renderAvatar(); }
    catch { toast("Não deu pra ler essa imagem."); }
  });
  $("avatar-remove").addEventListener("click", (e) => {
    e.stopPropagation();
    character.avatar = null;
    saveCharacter(character); renderAvatar();
  });
  $("level").addEventListener("input", async () => {
    const extra = (character.multiclasses || []).reduce((n, m) => n + (Number(m.level) || 0), 0);
    const oldLevel = Math.max(1, Number(character.level) || 1);
    character.level = Math.max(1, Math.min(20 - extra, Number($("level").value) || 1));
    saveCharacter(character);
    await recalc();
    if (character.level > oldLevel) openLevelUpModal(oldLevel, character.level);
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
  $("size-override").addEventListener("change", () => { character.sizeOverride = $("size-override").value; saveCharacter(character); recalc(); });
  $("languages").addEventListener("input", () => { character.languages = $("languages").value; saveCharacter(character); });
  $("appearance").addEventListener("input", () => { character.appearance = $("appearance").value; saveCharacter(character); });
  $("backstory").addEventListener("input", () => { character.backstory = $("backstory").value; saveCharacter(character); });
  $("inspiration").addEventListener("change", () => { character.inspiration = $("inspiration").checked ? 1 : 0; saveCharacter(character); });
  for (const k of ["cp", "pp", "pe", "po", "pl"]) {
    $(`coin-${k}`).addEventListener("input", () => { character.coins[k] = Math.max(0, Number($(`coin-${k}`).value) || 0); saveCharacter(character); renderCarryCapacity(); });
  }
  $("hp-current").addEventListener("input", () => { character.hpCurrent = Number($("hp-current").value) || 0; saveCharacter(character); renderDeath(calc()); renderDashboard(); });
  $("hp-temp").addEventListener("input", () => { character.hpTemp = Number($("hp-temp").value) || 0; saveCharacter(character); renderDashboard(); });
  $("hp-modifier-input").addEventListener("input", () => { character.hpModifier = Number($("hp-modifier-input").value) || 0; saveCharacter(character); recalc(); });
  $("ac-input").addEventListener("input", () => { character.ac = Number($("ac-input").value) || null; character.manualAc = $("ac-input").value !== ""; recalc(); });
  $("speed-input").addEventListener("input", () => { character.speed = $("speed-input").value || "30 ft"; character.manualSpeed = true; recalc(); });
  $("spell-ability-override")?.addEventListener("change", () => {
    const v = $("spell-ability-override").value;
    character.manualSpellAbility = !!v;
    character.spellAbility = v || character.auto?.spellcastingAbility || null;
    saveCharacter(character); recalc();
  });
  document.querySelectorAll(".change-choice").forEach((b) => b.addEventListener("click", () => openPicker(b.dataset.pick)));
  document.querySelectorAll(".tiny-info").forEach((b) => b.addEventListener("click", () => openInfo(b.dataset.info)));
  document.querySelectorAll(".tab").forEach((b) => b.addEventListener("click", async () => {
    document.querySelectorAll(".tab").forEach((x) => x.classList.remove("active"));
    b.classList.add("active");
    document.querySelectorAll(".tab-page").forEach((x) => x.classList.remove("active"));
    $(`tab-${b.dataset.tab}`).classList.add("active");
    if (b.dataset.tab === "actions") await renderActionsBoard();
    if (b.dataset.tab === "equipment") await equipmentTab();
    if (b.dataset.tab === "spells") await renderSpells();
    if (b.dataset.tab === "features") { renderCustomFeatures(); await renderFeatures(); }
    if (b.dataset.tab === "notes") { renderJournal(); renderCompanions(); }
    if (b.dataset.tab === "codex") await renderCodex();
    if (b.dataset.tab === "compendium") await renderCompendium();
    lockViewOnlyControls();
  }));
  $("mestre-mode-btn")?.addEventListener("click", async () => {
    document.querySelector(".sheet-shell").classList.add("hidden");
    $("mestre-shell").classList.remove("hidden");
    await renderMonsters();
  });
  $("mestre-exit-btn")?.addEventListener("click", () => {
    $("mestre-shell").classList.add("hidden");
    document.querySelector(".sheet-shell").classList.remove("hidden");
  });
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
  document.querySelectorAll("#monster-view-tabs [data-monview]").forEach((b) => b.addEventListener("click", () => {
    document.querySelectorAll("#monster-view-tabs [data-monview]").forEach((x) => x.classList.remove("active"));
    b.classList.add("active"); monsterState.view = b.dataset.monview; renderMonsters();
  }));
  $("monster-search")?.addEventListener("input", () => { if (monsterState.view === "browse") renderMonsters(); });
  $("monster-source")?.addEventListener("change", () => { if (monsterState.view === "browse") renderMonsters(); });
  $("monster-load-all")?.addEventListener("click", async () => {
    $("monster-load-status").textContent = "Carregando…";
    monsterBrowseCache = await loadAllBestiary((done, total) => { $("monster-load-status").textContent = `Carregando… ${done}/${total}`; }).catch(() => []);
    monsterLegendaryGroups = await loadLegendaryGroups().catch(() => []);
    monsterAllLoaded = true;
    $("monster-load-status").textContent = `${monsterBrowseCache.length.toLocaleString("pt-BR")} monstros carregados.`;
    renderMonsters();
  });
  $("monster-create-btn")?.addEventListener("click", openMonsterCreateModal);
  $("monster-list-select")?.addEventListener("change", () => {
    monsterState.listId = $("monster-list-select").value;
    setActiveMonsterListId(monsterState.listId);
    renderMonsters();
  });
  $("monster-list-new")?.addEventListener("click", () => openMonsterListNameModal("create"));
  $("monster-list-rename")?.addEventListener("click", () => openMonsterListNameModal("rename"));
  $("monster-list-delete")?.addEventListener("click", deleteActiveMonsterList);
  $("monster-add-all-source")?.addEventListener("click", addAllSourceMonstersToActiveList);
  $("monster-import-btn")?.addEventListener("click", () => $("monster-import-input").click());
  $("monster-import-input")?.addEventListener("change", async (e) => {
    const file = e.target.files[0];
    e.target.value = "";
    if (file) await importMonsterSublistFile(file);
  });
  $("add-attack").addEventListener("click", () => { character.attacks.push({ name: "", bonus: "", range: "", notes: "", abilityMode: "str", rollType: "attack", proficient: true, itemBonus: 0, damageParts: [{ dice: "", bonus: 0, type: "" }] }); saveCharacter(character); renderAttacks(); });
  $("add-custom-feature").addEventListener("click", () => {
    const name = $("custom-feature-name").value.trim();
    const text = $("custom-feature-text").value.trim();
    if (!name) { toast("Dê um nome pro item/traço."); return; }
    character.customFeatures = character.customFeatures || [];
    character.customFeatures.push({ id: `cf-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`, name, entries: text ? [text] : [] });
    $("custom-feature-name").value = ""; $("custom-feature-text").value = "";
    saveCharacter(character); renderCustomFeatures(); renderFeatures();
    toast("Item homebrew adicionado.");
  });
  $("add-condition")?.addEventListener("click", openConditionPicker);
  $("next-round")?.addEventListener("click", advanceRound);
  $("short-rest-btn")?.addEventListener("click", () => { if (confirm("Fazer um descanso curto? Restaura os recursos que recuperam em descanso curto (e espaços de Pacto, se houver).")) shortRest(); });
  $("long-rest-btn")?.addEventListener("click", () => { if (confirm("Fazer um descanso longo? Restaura PV, metade dos dados de vida, espaços de magia/pacto e todos os recursos de classe.")) longRest(); });
  $("dice-roller-fab")?.addEventListener("click", () => toggleDiceRoller());
  $("dice-roller-close")?.addEventListener("click", () => toggleDiceRoller(false));
  $("dice-roll-btn")?.addEventListener("click", () => rollExpression($("dice-expr-input").value.trim() || "1d20"));
  $("dice-expr-input")?.addEventListener("keydown", (e) => { if (e.key === "Enter") rollExpression(e.target.value.trim() || "1d20"); });
  document.querySelectorAll("[data-dice-quick]").forEach((b) => b.addEventListener("click", () => {
    $("dice-expr-input").value = `1d${b.dataset.diceQuick}`;
    rollExpression($("dice-expr-input").value);
  }));
  $("add-buff")?.addEventListener("click", openBuffModal);
  $("add-extra-feat")?.addEventListener("click", openExtraFeatPicker);
  $("add-journal")?.addEventListener("click", () => openJournalModal(null));
  $("export-journal")?.addEventListener("click", exportJournalText);
  $("add-companion")?.addEventListener("click", addCompanion);
  $("templates-btn")?.addEventListener("click", openTemplatesModal);
  $("feature-search")?.addEventListener("input", () => {
    const q = $("feature-search").value.trim().toLowerCase();
    document.querySelectorAll("#feature-list .feature").forEach((el) => {
      el.classList.toggle("hidden", !!q && !el.textContent.toLowerCase().includes(q));
    });
    document.querySelectorAll("#feature-list .feature-group").forEach((g) => {
      g.classList.toggle("hidden", !!q && ![...g.querySelectorAll(".feature")].some((f) => !f.classList.contains("hidden")));
    });
  });
  $("dashboard-toggle")?.addEventListener("click", () => {
    $("dashboard").classList.toggle("collapsed");
    $("dashboard-toggle").textContent = $("dashboard").classList.contains("collapsed") ? "Expandir" : "Recolher";
  });
  $("save-character").addEventListener("click", () => { saveCharacter(character); toast("Personagem salvo neste navegador."); });
  $("export-character").addEventListener("click", () => downloadCharacter(character));
  $("share-link-btn")?.addEventListener("click", async () => {
    try {
      const url = await buildShareUrl();
      await navigator.clipboard.writeText(url);
      const big = url.length > 6000 ? " Ficou um link grande — pode não passar em apps de mensagem com limite de caracteres (ex.: Discord)." : "";
      toast(`Link somente-leitura copiado!${big}`);
    } catch (err) {
      console.error(err);
      toast("Não deu pra gerar o link — seu navegador pode não suportar compressão nativa.");
    }
  });
  $("view-only-copy")?.addEventListener("click", () => {
    const id = createCharacterSlot();
    saveCharacterAs(id, character);
    setActiveCharacterId(id);
    location.hash = "";
    location.reload();
  });
  $("export-foundry")?.addEventListener("click", async () => {
    try { downloadJson(await buildFoundryActor(), `${(character.name || "personagem").replace(/[^a-z0-9-_]+/gi, "_")}_foundry.json`); }
    catch (err) { console.error(err); toast("Não foi possível gerar o arquivo pro Foundry."); }
  });
  $("new-character").addEventListener("click", createNewCharacter);
  $("random-character")?.addEventListener("click", openRandomCharacterModal);
  $("characters-btn")?.addEventListener("click", openCharactersModal);
  $("print-character").addEventListener("click", async () => { await buildOfficialSheet(); window.print(); });
  $("preview-pdf").addEventListener("click", openPdfPreview);
  $("import-character").addEventListener("change", async (e) => { try { attackRollMessages = {}; hdRollMessages = {}; applyLoaded(await readCharacterFile(e.target.files[0])); toast("Personagem importado."); } catch { toast("Arquivo inválido."); } });
  $("modal-close").addEventListener("click", () => $("modal").classList.add("hidden"));
  $("modal").addEventListener("click", (e) => { if (e.target === $("modal")) $("modal").classList.add("hidden"); });
  $("discord-settings")?.addEventListener("click", renderDiscordSettings);
  $("room-settings")?.addEventListener("click", renderRoomSettings);
  $("room-chat-fab")?.addEventListener("click", () => toggleRoomChat());
  $("room-chat-close")?.addEventListener("click", () => toggleRoomChat(false));
  $("room-chat-settings-btn")?.addEventListener("click", renderRoomSettings);
  document.querySelectorAll("#room-chat-tabs [data-roomtab]").forEach((b) => b.addEventListener("click", () => {
    document.querySelectorAll("#room-chat-tabs [data-roomtab]").forEach((x) => x.classList.remove("active"));
    b.classList.add("active");
    const combat = b.dataset.roomtab === "combat";
    $("room-chat-list").classList.toggle("hidden", combat);
    $("room-chat-compose").classList.toggle("hidden", combat);
    $("room-combat-panel").classList.toggle("hidden", !combat);
    if (combat) renderCombatTracker();
  }));
  $("room-chat-send-btn")?.addEventListener("click", sendRoomChatText);
  $("room-chat-text-input")?.addEventListener("keydown", (e) => { if (e.key === "Enter") sendRoomChatText(); });
  $("room-chat-text-input")?.addEventListener("paste", (e) => {
    const imgItem = Array.from(e.clipboardData?.items || []).find((it) => it.type?.startsWith("image/"));
    if (!imgItem) return;
    e.preventDefault();
    sendRoomChatImage(imgItem.getAsFile());
  });
  $("room-chat-image-btn")?.addEventListener("click", () => $("room-chat-image-input")?.click());
  $("room-chat-image-input")?.addEventListener("change", (e) => {
    const file = e.target.files[0]; e.target.value = "";
    sendRoomChatImage(file);
  });
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

  // Menus da barra do topo: um aberto por vez, e clicar fora fecha.
  const menus = [...document.querySelectorAll(".appbar .menu")];
  for (const m of menus) {
    m.addEventListener("toggle", () => { if (m.open) menus.forEach((o) => { if (o !== m) o.open = false; }); });
    m.querySelector(".menu-body")?.addEventListener("click", (e) => { if (e.target.closest("button")) m.open = false; });
  }
  document.addEventListener("click", (e) => { if (!e.target.closest(".appbar .menu")) menus.forEach((m) => { m.open = false; }); });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") menus.forEach((m) => { m.open = false; }); });

  $("skin-select")?.addEventListener("change", (e) => applySkin(e.target.value));
  applySkin(getSavedSkin());
}
// Cor da barra do navegador no celular por tema — sem isso o topo do
// aparelho continua preto num tema claro.
const SKIN_THEME_COLOR = { noite: "#0f1012", papel: "#ffffff", pergaminho: "#e7ddc6", mesa: "#141518" };
function applySkin(skin) {
  const v = SKINS.includes(skin) ? skin : "noite";
  document.documentElement.setAttribute("data-skin", v);
  document.documentElement.removeAttribute("data-theme"); // resquício do antigo botão claro/escuro
  saveSkin(v);
  const sel = $("skin-select");
  if (sel && sel.value !== v) sel.value = v;
  const meta = $("meta-theme-color");
  if (meta) meta.setAttribute("content", SKIN_THEME_COLOR[v]);
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
async function loadDatabaseAndApply() {
  try {
    await initDatabase((label, done, total) => {
      $("db-status").textContent = `${label}… ${done}/${total}`;
    });
    const s = stats();
    $("db-status").textContent = `Pronto · ${s.entities.toLocaleString("pt-BR")} registros carregados`;
    $("db-count").textContent = `${s.entities.toLocaleString("pt-BR")} registros · dados do 5etools (${character.edition})`;
    applyLoaded(character);
    return true;
  } catch (e) {
    console.error(e);
    $("db-status").textContent = "Erro ao carregar dados do 5etools";
    $("db-count").textContent = "Verifique sua conexão e tente “Atualizar dados”.";
    applyLoaded(character);
    return false;
  }
}
async function start() {
  // Link somente-leitura (#share=...): não toca no localStorage nem em
  // slot nenhum — carrega o personagem embutido no link, direto na
  // memória, e trava a edição depois que a ficha terminar de montar.
  const sharedData = location.hash.startsWith("#share=")
    ? await decodeShareHash(location.hash).catch((err) => { console.error("Link somente-leitura inválido:", err); return null; })
    : null;
  if (sharedData) {
    character = { ...fresh(), ...shareSnapshot(sharedData) };
    setup();
    renderRoomChat();
    setCreationMode("free");
    await loadDatabaseAndApply();
    renderCompendium();
    enterViewOnlyMode();
    return;
  }
  migrateLegacyCharacter();
  if (!getActiveCharacterId()) setActiveCharacterId(createCharacterSlot());
  character = loadCharacter() || fresh();
  if (!loadCharacterById(getActiveCharacterId())) saveCharacter(character); // slot novo: já aparece em "Meus Personagens" mesmo sem editar nada
  setup();
  renderRoomChat(); // sem estado de sala pra restaurar (WebRTC não sobrevive a um recarregamento) — só mostra o painel vazio
  // O modo "livre" (padrão) não depende do banco pra aparecer; o modo
  // "guiado" precisa de ensureCatalog(), então só liga a UI do assistente
  // depois que o banco terminar de carregar, abaixo.
  if (creationMode !== "guided") setCreationMode("free");
  const ok = await loadDatabaseAndApply();
  if (ok) {
    if (creationMode === "guided") setCreationMode("guided");
    renderCompendium();
    checkDataUpdateNotice().catch((err) => console.warn("Aviso de atualização indisponível:", err));
  }
}
start();
