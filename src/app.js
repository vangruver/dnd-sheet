import {
  initDatabase, ensureCatalog, filterEntities, recordsForEntity, getRecordArrays,
  findClassFeatures, findSubclassFeatures, spellsForClass, stats,
  manifestEntries, isHomebrew as hb, normType, editionOf, currentVersionInfo,
  descriptionEntries, matchesEdition, isReprinted,
} from "./database.js";
import { clearCache } from "./store.js";
import { ABILITIES, ABILITY_NAMES, SKILLS, mod, fmt, proficiency, hpAverage, abilityKey, spellDc, spellAttack, casterSlots, pactSlots } from "./rules.js";
import { saveCharacter, loadCharacter, clearCharacter, downloadCharacter, readCharacterFile, getSeenDataVersion, setSeenDataVersion } from "./storage.js";

const $ = (id) => document.getElementById(id);
let character, refs = { class: null, subclass: null, race: null, background: null }, details = {};
let pickerType = null, eqCat = "inventory";
let codexState = { type: "all", content: "all", query: "", legacy: false };

const fresh = () => ({
  schema: 1, name: "", level: 1, xp: 0, inspiration: 0, edition: "2024", content: "official",
  classId: "", subclassId: "", raceId: "", backgroundId: "",
  scores: { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 },
  saveProficiencies: [], skillProficiencies: [], skillExpertise: [],
  hpCurrent: null, hpTemp: 0, ac: null, speed: "30 ft", attacks: [], inventory: [], preparedSpells: [], deathSaves: { success: 0, failure: 0 },
  auto: { classSkills: [], backgroundSkills: [], classSaves: [], fixedSkills: [], speed: null, hitDice: null, spellcastingAbility: null },
  choiceSelections: { classSkills: [], backgroundSkills: [], abilityChoices: {}, bgAbility: [], bgAbilityMode: 0 }, manualSkillProficiencies: [],
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
  for (const t of ["race", "class", "subclass", "background"]) await updateChoice(t);
  $("head-class").textContent = refs.class ? `${titleOf(refs.class)}${refs.subclass ? " · " + titleOf(refs.subclass) : ""}` : "—";
  $("head-background").textContent = refs.background ? titleOf(refs.background) : "—";
  $("head-race").textContent = refs.race ? titleOf(refs.race) : "—";
  await recalc();
}
function filteredPicker(type, q) {
  if (type === "subclass") {
    if (!refs.class) return [];
    const cn = String(refs.class.name).toLowerCase();
    return manifest().filter((x) =>
      normType(x.type) === "subclass" &&
      (editionOf(x) === "both" || editionOf(x) === String(character.edition)) &&
      String(x.className || "").toLowerCase() === cn &&
      (character.content === "all" || (character.content === "official" && !hb(x)) || (character.content === "homebrew" && hb(x))) &&
      (!q || titleOf(x).toLowerCase().includes(q.toLowerCase())));
  }
  return list(type, q);
}
async function openPicker(type) {
  pickerType = type;
  if (type === "subclass" && !refs.class) { toast("Escolha a classe primeiro."); return; }
  const modal = $("modal"), content = $("modal-content");
  content.innerHTML = `<div class="modal-title"><div><span class="eyebrow">ESCOLHER</span><h2>${typeLabel(type)}</h2></div></div><div class="loading">Carregando catálogo…</div>`;
  modal.classList.remove("hidden");
  try { await ensureCatalog(type); } catch (err) { console.error(err); }
  content.innerHTML = `<div class="modal-title"><div><span class="eyebrow">ESCOLHER</span><h2>${typeLabel(type)}</h2></div></div>
  <div class="picker-controls"><input id="picker-search" placeholder="Pesquisar ${typeLabel(type).toLowerCase()}…"><div class="filter-pills"><button class="active" data-pfilter="all">Todos</button><button data-pfilter="official">Oficial</button><button data-pfilter="homebrew">Homebrew</button></div></div>
  <div id="picker-results" class="picker-grid"></div>`;
  const render = () => {
    const q = $("picker-search").value.trim();
    let arr = filteredPicker(type, q);
    const pf = content.querySelector(".filter-pills .active")?.dataset.pfilter || "all";
    if (pf === "official") arr = arr.filter((x) => !hb(x));
    if (pf === "homebrew") arr = arr.filter((x) => hb(x));
    renderPicker(arr.slice(0, 200));
  };
  $("picker-search").addEventListener("input", render);
  content.querySelectorAll("[data-pfilter]").forEach((b) => b.addEventListener("click", () => {
    content.querySelectorAll("[data-pfilter]").forEach((x) => x.classList.remove("active"));
    b.classList.add("active"); render();
  }));
  render();
  setTimeout(() => $("picker-search")?.focus(), 50);
}
async function renderPicker(arr) {
  const box = $("picker-results");
  if (!box) return;
  if (!arr.length) { box.innerHTML = `<div class="empty">Nenhum resultado encontrado.</div>`; return; }
  box.innerHTML = arr.map((x) => `<button class="pick-card" data-id="${esc(x.id)}"><div class="pick-top"><strong>${esc(titleOf(x))}</strong>${sourceTag(x)}</div><div class="pick-meta">${esc(labelMeta(x))}</div><div class="pick-desc">…</div></button>`).join("");
  for (const b of box.querySelectorAll(".pick-card")) {
    const e = manifest().find((x) => x.id === b.dataset.id);
    firstRecord(e).then((r) => { const d = b.querySelector(".pick-desc"); if (d) d.textContent = teaserText(e, r, 160) || "Sem descrição estruturada."; });
    b.addEventListener("click", async () => { await selectRef(e); $("modal").classList.add("hidden"); });
  }
}
async function selectRef(e) {
  const t = pickerType;
  if (!e) return;
  character[`${t}Id`] = e.id;
  refs[t] = e;
  if (t === "class") { character.subclassId = ""; refs.subclass = null; character.choiceSelections.classSkills = []; }
  if (t === "background") character.choiceSelections.backgroundSkills = [];
  await refreshChoices();
  saveCharacter(character);
  toast(`${titleOf(e)} selecionado.`);
}
function openInfo(type) { const e = refs[type]; if (!e) { toast("Nada selecionado."); return; } openEntityModal(e); }

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
function renderAbilities() {
  // Mostra o valor EFETIVO (base do point buy + aumentos de espécie/background).
  $("ability-grid").innerHTML = ABILITIES.map((a) => {
    const base = Number(character.scores[a]) || 10, eff = effScore(a), bonus = eff - base;
    return `<div class="ability-box"><span>${ABILITY_NAMES[a]}</span><b>${eff}${bonus ? `<i>${fmt(bonus)}</i>` : ""}</b><em>${fmt(mod(eff))}</em></div>`;
  }).join("");
  const spent = pointBuyTotal(), remaining = 27 - spent;
  $("pointbuy-remaining").textContent = remaining;
  $("pointbuy-remaining").classList.toggle("over", remaining < 0);
  $("ability-editor").innerHTML = ABILITIES.map((a) => {
    const v = Number(character.scores[a]) || 10;
    return `<div class="ability-edit"><span>${ABILITY_NAMES[a]}</span><div class="ability-stepper"><button type="button" data-ability-dec="${a}" ${v <= 8 ? "disabled" : ""}>−</button><input data-ability="${a}" type="number" min="1" max="30" value="${v}"><button type="button" data-ability-inc="${a}" ${v >= 15 ? "disabled" : ""}>+</button></div><b>${fmt(mod(v))}</b><small>Custo ${pointCost(v)}</small></div>`;
  }).join("");
  $("ability-editor").querySelectorAll("[data-ability]").forEach((i) => i.addEventListener("change", () => {
    character.scores[i.dataset.ability] = Math.max(1, Math.min(30, Number(i.value) || 10));
    recalc(); saveCharacter(character);
  }));
  $("ability-editor").querySelectorAll("[data-ability-inc],[data-ability-dec]").forEach((b) => b.addEventListener("click", () => {
    const a = b.dataset.abilityInc || b.dataset.abilityDec, v = Number(character.scores[a]) || 10;
    const next = v + (b.dataset.abilityInc ? 1 : -1);
    if (next < 8 || next > 15) return;
    const delta = pointCost(next) - pointCost(v);
    if (delta > 27 - pointBuyTotal()) { toast("Você não tem pontos suficientes."); return; }
    character.scores[a] = next; recalc(); saveCharacter(character);
  }));
  const reset = $("reset-pointbuy");
  if (reset) reset.onclick = () => { ABILITIES.forEach((a) => (character.scores[a] = 10)); saveCharacter(character); recalc(); };
}

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
  flatObjects(v).forEach((o) => {
    const ch = o?.choose;
    if (!ch || !ch.from) return;
    const from = (Array.isArray(ch.from) ? ch.from : Object.keys(ch.from || {})).map(skillKey).filter(Boolean);
    if (from.length) out.push({ from: [...new Set(from)], count: Number(ch.count || ch.amount || 1) || 1 });
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
async function buildAutomation() {
  character.auto = character.auto || {};
  const cr = details.classRec || {}, rr = details.raceRec || {}, br = details.backgroundRec || {};
  const classProf = cr.startingProficiencies || cr;
  const bgProf = br.skillProficiencies ? br : (br.startingProficiencies || br);
  const classFixedSkills = fixedSkillsFrom(classProf);
  const bgFixedSkills = fixedSkillsFrom(br.skillProficiencies || bgProf);
  const classSaves = savesFrom(cr);
  const previousAuto = [...(character.auto?.classSkills || []), ...(character.auto?.backgroundSkills || [])];
  const previousChoices = [...Object.values(character.choiceSelections?.classSkills || {}).flat(), ...Object.values(character.choiceSelections?.backgroundSkills || {}).flat()];
  if (!Array.isArray(character.manualSkillProficiencies) || !character.manualSkillProficiencies.length) {
    character.manualSkillProficiencies = (character.skillProficiencies || []).filter((k) => !previousAuto.includes(k) && !previousChoices.includes(k));
  }
  character.auto.classSkills = classFixedSkills;
  character.auto.backgroundSkills = bgFixedSkills;
  character.auto.classSaves = classSaves;
  character.auto.speed = speedFrom(rr);
  character.auto.hitDice = hitDiceFrom(cr);
  character.auto.spellcastingAbility = spellAbilityFrom(cr);
  const fixedSkills = [...new Set([...classFixedSkills, ...bgFixedSkills])];
  character.skillProficiencies = [...new Set([
    ...(character.manualSkillProficiencies || []), ...fixedSkills,
    ...Object.values(character.choiceSelections?.classSkills || {}).flat(),
    ...Object.values(character.choiceSelections?.backgroundSkills || {}).flat(),
  ])];
  character.saveProficiencies = [...new Set([...classSaves, ...(character.manualSaveProficiencies || [])])];
  if (character.auto.speed && !character.manualSpeed) character.speed = character.auto.speed;
  if (character.auto.spellcastingAbility && !character.manualSpellAbility) character.spellAbility = character.auto.spellcastingAbility;

  // Especialização: nº de perícias vem das características "Expertise" da
  // classe até o nível atual (Ladino 1/6, Bardo 3/10 = 2 cada).
  let expertise = 0;
  if (refs.class) {
    const cf = await findClassFeatures(refs.class, Number(character.level)).catch(() => []);
    expertise = cf.filter((f) => /^expertise$/i.test(String(f.name || "").trim())).length * 2;
  }
  character.auto.expertiseSlots = expertise;
  // limpa especialização de perícias que não são mais proficiência
  character.skillExpertise = (character.skillExpertise || []).filter((k) => character.skillProficiencies.includes(k));

  renderAutoChoices({
    classChoices: skillChoicesFrom(classProf),
    backgroundChoices: skillChoicesFrom(br.skillProficiencies || bgProf),
    abilityChoices: abilityChoicesFrom(rr),
    bgAbility: bgAbilitySpec(br),
    expertise,
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
  $("auto-status").textContent = sections.length ? "Escolhas disponíveis" : "Nenhuma escolha pendente";
  if (!sections.length) { box.innerHTML = `<div class="auto-empty">As escolhas automáticas aparecerão aqui quando a classe/background/espécie fornecerem opções no banco.</div>`; return; }
  box.innerHTML = sections.join("");
  box.querySelectorAll("[data-auto-choice]").forEach((i) => i.addEventListener("change", () => {
    const t = i.dataset.autoChoice, idx = Number(i.dataset.choiceIndex), v = i.dataset.choiceValue;
    character.choiceSelections[t] = character.choiceSelections[t] || [];
    const current = character.choiceSelections[t][idx] || [];
    toggleIn(current, v, i.checked);
    const limit = t === "classSkills" ? data.classChoices[idx].count : data.backgroundChoices[idx].count;
    if (current.length > limit) { current.pop(); i.checked = false; toast(`Você pode escolher apenas ${limit}.`); }
    character.choiceSelections[t][idx] = current;
    character.skillProficiencies = [...new Set([
      ...(character.manualSkillProficiencies || []), ...(character.auto?.classSkills || []), ...(character.auto?.backgroundSkills || []),
      ...Object.values(character.choiceSelections.classSkills || {}).flat(),
      ...Object.values(character.choiceSelections.backgroundSkills || {}).flat(),
    ])];
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
function abilityBonusTotal(a) {
  let b = 0;
  const rr = details.raceRec || {};
  for (const blk of rr.ability || []) if (blk && typeof blk[a] === "number") b += blk[a];
  for (const list of Object.values(character.choiceSelections?.abilityChoices || {})) if (Array.isArray(list) && list.includes(a)) b += 1;
  const spec = bgAbilitySpec(details.backgroundRec || {});
  if (spec) {
    if (spec.fixed[a]) b += spec.fixed[a];
    if (spec.hasChoice) {
      const modeIdx = Math.max(0, Math.min(Number(character.choiceSelections?.bgAbilityMode || 0), spec.modes.length - 1));
      const weights = spec.modes[modeIdx] || [];
      (character.choiceSelections?.bgAbility || []).forEach((k, i) => { if (k === a && weights[i]) b += weights[i]; });
    }
  }
  return b;
}
function effScore(a) { return (Number(character.scores[a]) || 10) + abilityBonusTotal(a); }
function inferHP() {
  const c = classInfo();
  const hd = Number(character.auto?.hitDice || hitDiceFrom(c) || 8) || 8;
  const conMod = mod(effScore("con"));
  const first = hd + conMod;
  const perLevel = hpAverage(hd) + conMod;
  return Math.max(1, first + Math.max(0, Number(character.level) - 1) * perLevel);
}
function calc() {
  const lvl = Number(character.level) || 1, pb = proficiency(lvl);
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
  details.classRec = await firstRecord(refs.class);
  details.raceRec = await firstRecord(refs.race);
  details.subclassRec = await firstRecord(refs.subclass);
  details.backgroundRec = await firstRecord(refs.background);
  await buildAutomation();
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
function renderProficiencies() {
  const cr = details.classRec || {}, br = details.backgroundRec || {}, sp = cr.startingProficiencies || {};
  const cap = (s) => s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
  const armor = (sp.armor || []).map(profLabel).map(cap).filter(Boolean);
  const weapons = (sp.weapons || []).map(profLabel).map(cap).filter(Boolean);
  const tools = [...(sp.tools || []).map(profLabel), ...flatObjects(br.toolProficiencies || []).flatMap((o) => Object.keys(o).filter((k) => o[k] === true))].map(cap).filter(Boolean);
  $("proficiency-editor").innerHTML = `
    <div class="identity-row"><span>Armaduras</span><strong>${armor.length ? esc(armor.join(", ")) : "—"}</strong></div>
    <div class="identity-row"><span>Armas</span><strong>${weapons.length ? esc(weapons.join(", ")) : "—"}</strong></div>
    <div class="identity-row"><span>Ferramentas</span><strong>${tools.length ? esc(tools.join(", ")) : "—"}</strong></div>
    <div class="identity-row"><span>Resistências</span><strong>${(character.auto?.classSaves || []).map((a) => ABILITY_NAMES[a]).join(", ") || "—"}</strong></div>
    <p class="muted">As perícias com proficiência automática aparecem marcadas na aba Ficha e não podem ser desmarcadas.</p>`;
}
function renderIdentity() {
  const rows = [["Espécie", refs.race], ["Classe", refs.class], ["Subclasse", refs.subclass], ["Background", refs.background]];
  $("identity").innerHTML = rows.map(([k, e]) => `<div class="identity-row"><span>${k}</span><strong>${e ? esc(titleOf(e)) : "—"}</strong>${e ? sourceTag(e) : ""}</div>`).join("");
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
  if (refs.class) groups.push(["CLASSE", await findClassFeatures(refs.class, Number(character.level))]);
  if (refs.subclass) groups.push(["SUBCLASSE", await findSubclassFeatures(refs.subclass, Number(character.level))]);
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
  box.innerHTML = groups.filter((g) => g[1]?.length).map(([name, arr]) =>
    `<section class="feature-group"><h3>${name}</h3>${arr.map((f) => `<article class="feature"><div><b>${esc(f.name || "Característica")}</b><span>Nível ${esc(f.level || "—")}</span></div><div>${f.entries ? richText(f.entries) : "<p class='muted'>Sem texto no banco para esta característica.</p>"}</div></article>`).join("")}</section>`
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
function spellcastingInfo(level) {
  const cr = details.classRec || {}, sr = details.subclassRec || {};
  const src = (cr.casterProgression || cr.spellcastingAbility) ? cr
    : (sr.casterProgression || sr.spellcasting || sr.spellcastingAbility) ? sr : null;
  if (!src) return null;
  const prog = src.casterProgression || (src === sr ? "1/3" : "full");
  const abilKey = abilityKey(src.spellcastingAbility) || spellAbilityFrom(cr) || spellAbilityFrom(sr);
  const abilMod = abilKey ? mod(effScore(abilKey)) : 0;

  let slots = null, pact = null;
  if (String(prog).toLowerCase() === "pact") pact = pactSlots(level);
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
    ability: abilKey, abilityMod: abilMod,
    label: CASTER_LABEL[String(prog).toLowerCase()] || "Conjurador",
    slots, pact, cantrips: cantrips ?? null, known: known ?? null, prepared: prepared ?? null,
  };
}
function renderSpellResources(si) {
  const box = $("spell-resources");
  if (!box) return;
  if (!si) { box.innerHTML = ""; return; }
  const pips = [];
  if (si.cantrips != null) pips.push(["Truques", si.cantrips]);
  if (si.prepared != null) pips.push(["Magias preparadas", si.prepared]);
  if (si.known != null) pips.push(["Magias conhecidas", si.known]);
  const slotBoxes = (si.slots || []).map((n, i) => n ? `<div class="slot-box"><span>${i + 1}º nível</span><b>${n}</b></div>` : "").join("");
  const pactBox = si.pact ? `<div class="slot-box pact"><span>Pacto · ${si.pact.level}º nível</span><b>${si.pact.count}</b></div>` : "";
  box.innerHTML = `<section class="paper-card spell-resources">
    <div class="spell-res-head"><h3>Recursos de conjuração</h3><span>${esc(si.label)}${si.ability ? ` · ${ABILITY_NAMES[si.ability]}` : ""}</span></div>
    ${pips.length ? `<div class="spell-res-pips">${pips.map(([k, v]) => `<div><span>${esc(k)}</span><b>${v}</b></div>`).join("")}</div>` : ""}
    ${slotBoxes || pactBox ? `<div class="slot-grid">${slotBoxes}${pactBox}</div>` : `<p class="muted">Sem espaços de magia neste nível.</p>`}
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
  renderSpellResources(spellcastingInfo(c.lvl));
  if (!refs.class) { $("spell-count").textContent = "0"; box.innerHTML = `<div class="paper-card empty">Escolha uma classe para carregar a lista de magias.</div>`; return; }
  box.innerHTML = `<div class="paper-card loading">Carregando lista de magias de ${esc(titleOf(refs.class))}…</div>`;
  let spells = [];
  try { spells = await spellsForClass(refs.class, refs.subclass, character.edition); }
  catch (err) { console.error(err); box.innerHTML = `<div class="paper-card empty">Não foi possível carregar as magias.</div>`; return; }
  $("spell-count").textContent = spells.length;
  const groups = Array.from({ length: 10 }, (_, i) => spells.filter((s) => spellLevel(s) === i));
  box.innerHTML = groups.map((arr, lvl) => arr.length ? `<section class="paper-card spell-level"><div class="spell-level-head"><h3>${lvl === 0 ? "Truques" : `${lvl}º nível`}</h3><span>${arr.length} magias</span></div><div class="spell-list">${arr.map((s) => {
    const key = `${s.name}|${s.source || ""}`;
    const checked = character.preparedSpells.includes(key);
    return `<label class="spell-line"><input type="checkbox" data-spell="${esc(key)}" ${checked ? "checked" : ""}><span class="spell-dot">${checked ? "●" : "○"}</span><strong>${esc(s.name)}</strong><span class="spell-meta">${esc(s.source || "")}${s.school ? ` · ${esc(s.school)}` : ""}${spellTime(s) ? ` · ${esc(spellTime(s))}` : ""}</span><button type="button" class="spell-info" data-spell-key="${esc(key)}">ⓘ</button></label>`;
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
  let arr = list("item", "").map((e) => ({ e, r: e.__rec || {}, kind: itemKind(e.__rec), family: weaponFamily(e.name) }));
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
  if (eqCat !== "inventory") await renderEquipmentCatalog();
  else await renderInventory();
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
    auto: { ...f.auto, ...(c?.auto || {}) },
    choiceSelections: { ...f.choiceSelections, ...(c?.choiceSelections || {}), abilityChoices: { ...f.choiceSelections.abilityChoices, ...(c?.choiceSelections?.abilityChoices || {}) } },
    manualSkillProficiencies: Array.isArray(c?.manualSkillProficiencies) ? c.manualSkillProficiencies : [],
  };
  $("edition").value = character.edition;
  $("content").value = character.content;
  $("name").value = character.name;
  $("level").value = character.level;
  $("xp").value = character.xp;
  refreshChoices();
}
function openPdfPreview() {
  const modal = $("modal"), box = $("modal-content");
  const clone = document.querySelector(".sheet-shell").cloneNode(true);
  clone.querySelectorAll(".no-print").forEach((e) => e.remove());
  clone.querySelectorAll(".tab-page").forEach((e) => { e.classList.add("active"); e.style.display = "block"; });
  box.innerHTML = `<div class="modal-title"><div><span class="eyebrow">PRÉ-VISUALIZAÇÃO</span><h2>Ficha pronta para PDF</h2><p class="muted">Use “Imprimir / PDF” para gerar o arquivo.</p></div><button type="button" class="preview-print" id="preview-print">Imprimir / PDF</button></div><div class="pdf-preview-host"></div>`;
  box.querySelector(".pdf-preview-host").appendChild(clone);
  modal.classList.remove("hidden");
  $("preview-print").onclick = () => window.print();
}
function setup() {
  $("edition").addEventListener("change", () => {
    character.edition = $("edition").value;
    character.classId = character.subclassId = character.raceId = character.backgroundId = "";
    refs = { class: null, subclass: null, race: null, background: null };
    refreshChoices(); saveCharacter(character);
    const active = document.querySelector(".tab.active")?.dataset.tab;
    if (active === "codex") renderCodex();
    if (active === "compendium") renderCompendium();
  });
  $("content").addEventListener("change", () => { character.content = $("content").value; saveCharacter(character); refreshChoices(); });
  $("name").addEventListener("input", () => { character.name = $("name").value; saveCharacter(character); });
  $("level").addEventListener("input", () => { character.level = Math.max(1, Math.min(20, Number($("level").value) || 1)); saveCharacter(character); recalc(); });
  $("xp").addEventListener("input", () => { character.xp = Number($("xp").value) || 0; saveCharacter(character); });
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
  $("print-character").addEventListener("click", () => window.print());
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
  try {
    await initDatabase((label, done, total) => {
      $("db-status").textContent = `${label}… ${done}/${total}`;
    });
    const s = stats();
    $("db-status").textContent = `Pronto · ${s.entities.toLocaleString("pt-BR")} registros carregados`;
    $("db-count").textContent = `${s.entities.toLocaleString("pt-BR")} registros · dados do 5etools (${character.edition})`;
    applyLoaded(character);
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
