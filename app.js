import { initDatabase, filterEntities, loadEntity, getEntityObjects } from "./database.js";
import { ABILITIES, ABILITY_NAMES, SKILLS, mod, fmt, proficiency, hpAverage, ruleFor } from "./rules.js";
import { saveCharacter, loadCharacter, clearCharacter, downloadCharacter, readCharacterFile } from "./storage.js";

const $ = id => document.getElementById(id);

let catalog;
let character;
const selected = { class:null, subclass:null, race:null, background:null };
const loaded = { class:null, subclass:null, race:null, background:null };

function defaultCharacter() {
  return {
    schema: 2, name:"", level:1, xp:0, inspiration:0,
    edition:"2024", content:"all",
    classId:"", subclassId:"", raceId:"", backgroundId:"",
    scores:{str:10,dex:10,con:10,int:10,wis:10,cha:10},
    saveProficiencies:[], skillProficiencies:[], skillExpertise:[],
    hpCurrent:null, hpTemp:0, ac:null, speed:"",
    attacks:[], spells:[]
  };
}

function toast(message) {
  const el = $("toast");
  el.textContent = message;
  el.classList.add("show");
  setTimeout(() => el.classList.remove("show"), 2200);
}

function fillSelect(select, entities, placeholder) {
  select.innerHTML = "";
  const first = document.createElement("option");
  first.value = "";
  first.textContent = placeholder;
  select.appendChild(first);

  const official = entities.filter(x => !x.homebrew);
  const homebrew = entities.filter(x => x.homebrew);

  for (const [label, group] of [["Oficial", official], ["Homebrew", homebrew]]) {
    if (!group.length) continue;
    const optgroup = document.createElement("optgroup");
    optgroup.label = label;
    for (const entity of group) {
      const option = document.createElement("option");
      option.value = entity.id;
      option.textContent = entity.name;
      optgroup.appendChild(option);
    }
    select.appendChild(optgroup);
  }
}

function entityById(id) {
  return catalog?.entities?.find(x => x.id === id) || null;
}

function resetDependentSelection() {
  character.subclassId = "";
  selected.subclass = null;
  loaded.subclass = null;
}

function classOptions() {
  return filterEntities("class", character.edition, character.content);
}
function raceOptions() {
  // 5eTools usa "race" para a estrutura clássica; espécies de 2024
  // também podem aparecer nesse tipo no banco sincronizado.
  return filterEntities("race", character.edition, character.content);
}
function backgroundOptions() {
  return filterEntities("background", character.edition, character.content);
}

async function refreshSelectors(preserve=true) {
  const classList = classOptions();
  const raceList = raceOptions();
  const backgroundList = backgroundOptions();

  fillSelect($("class"), classList, "Selecione a classe…");
  fillSelect($("race"), raceList, "Selecione a espécie/raça…");
  fillSelect($("background"), backgroundList, "Selecione o background…");

  if (preserve) {
    $("class").value = classList.some(x=>x.id===character.classId) ? character.classId : "";
    $("race").value = raceList.some(x=>x.id===character.raceId) ? character.raceId : "";
    $("background").value = backgroundList.some(x=>x.id===character.backgroundId) ? character.backgroundId : "";
  }

  await refreshSubclass(true);
}

async function refreshSubclass(preserve=true) {
  const cls = entityById(character.classId);
  selected.class = cls;
  loaded.class = cls ? await loadEntity(cls) : null;

  let list = filterEntities("subclass", character.edition, character.content);
  if (cls) {
    const className = cls.name.toLowerCase();
    list = list.filter(x => {
      const cn = String(x.className || "").toLowerCase();
      const cs = String(x.classSource || "").toLowerCase();
      return !cn || cn === className || cs === String(cls.source || "").toLowerCase();
    });
  } else {
    list = [];
  }

  fillSelect($("subclass"), list, cls ? "Selecione a subclasse…" : "Escolha a classe primeiro");
  if (preserve && list.some(x=>x.id===character.subclassId)) $("subclass").value = character.subclassId;
  else character.subclassId = "";
  selected.subclass = entityById(character.subclassId);
  loaded.subclass = selected.subclass ? await loadEntity(selected.subclass) : null;
}

function renderAttributes() {
  $("attributes").innerHTML = ABILITIES.map(a => `
    <div class="ability">
      <h3>${ABILITY_NAMES[a]}</h3>
      <input data-ability="${a}" type="number" min="1" max="30" value="${character.scores[a]}">
      <div class="mod">${fmt(mod(character.scores[a]))}</div>
    </div>
  `).join("");
  document.querySelectorAll("[data-ability]").forEach(input => {
    input.addEventListener("input", e => {
      character.scores[e.target.dataset.ability] = Number(e.target.value);
      renderAll();
    });
  });
}

function renderSaves() {
  const pb = proficiency(character.level);
  $("saves").innerHTML = ABILITIES.map(a => `
    <label class="skill">
      <input type="checkbox" data-save="${a}" ${character.saveProficiencies.includes(a)?"checked":""}>
      <span>${ABILITY_NAMES[a]}</span>
      <strong class="value">${fmt(mod(character.scores[a]) + (character.saveProficiencies.includes(a)?pb:0))}</strong>
    </label>
  `).join("");
  document.querySelectorAll("[data-save]").forEach(x => x.addEventListener("change", e => {
    const a=e.target.dataset.save;
    character.saveProficiencies = e.target.checked
      ? [...new Set([...character.saveProficiencies,a])]
      : character.saveProficiencies.filter(v=>v!==a);
    renderAll();
  }));
}

function skillBonus(id, ability) {
  const pb = proficiency(character.level);
  let value = mod(character.scores[ability]);
  if (character.skillProficiencies.includes(id)) value += pb;
  if (character.skillExpertise.includes(id)) value += pb;
  return value;
}

function renderSkills() {
  $("skills").innerHTML = SKILLS.map(([id,name,a]) => `
    <label class="skill">
      <input type="checkbox" data-skill="${id}" ${character.skillProficiencies.includes(id)?"checked":""}>
      <span>${name} <span class="ability-name">${a.toUpperCase()}</span></span>
      <strong class="value">${fmt(skillBonus(id,a))}</strong>
    </label>
  `).join("");
  document.querySelectorAll("[data-skill]").forEach(x => x.addEventListener("change", e => {
    const id=e.target.dataset.skill;
    character.skillProficiencies = e.target.checked
      ? [...new Set([...character.skillProficiencies,id])]
      : character.skillProficiencies.filter(v=>v!==id);
    renderAll();
  }));
}

function extractHitDie(cls) {
  return cls?.hd?.faces || 8;
}
function extractSpellAbility(cls) {
  const a = cls?.spellcastingAbility;
  return Array.isArray(a) ? a[0] : a;
}

function calculate() {
  const pb = proficiency(character.level);
  const cls = loaded.class || selected.class || {};
  const faces = extractHitDie(cls);
  const con = mod(character.scores.con);
  const dex = mod(character.scores.dex);
  const hpMax = Math.max(1, faces + con + (character.level-1)*(hpAverage(faces)+con));
  const spellAbility = extractSpellAbility(cls);
  const spellMod = spellAbility && character.scores[spellAbility] != null ? mod(character.scores[spellAbility]) : 0;
  const spell = spellAbility ? ruleFor(character.edition) : null;

  return {
    pb, hpMax, faces, initiative:dex,
    ac: character.ac ?? 10+dex,
    passive: 10+skillBonus("perception","wis"),
    spellAbility,
    spellDc: spell ? spell.spellDc(pb,spellMod) : null,
    spellAttack: spell ? spell.spellAttack(pb,spellMod) : null,
    speed: character.speed || selected.race?.speed || "—"
  };
}

function renderCombat() {
  const c = calculate();
  $("pb").textContent=fmt(c.pb);
  $("hp").textContent=c.hpMax;
  $("hit-die").textContent=`d${c.faces}`;
  $("ac").textContent=c.ac;
  $("initiative").textContent=fmt(c.initiative);
  $("passive").textContent=c.passive;
  $("spell-dc").textContent=c.spellDc ?? "—";
  $("spell-attack").textContent=c.spellAttack == null ? "—" : fmt(c.spellAttack);
  $("speed").textContent=c.speed;
  $("hp-current").value = character.hpCurrent ?? c.hpMax;
  $("hp-temp").value = character.hpTemp ?? 0;
  $("ac-input").value = character.ac ?? 10+c.initiative;
  $("speed-input").value = character.speed || "";
}

function renderAttacks() {
  const attacks = character.attacks.length ? character.attacks : [
    {name:"Ataque", bonus:"", damage:""}
  ];
  $("attacks").innerHTML = attacks.map((a,i)=>`
    <div class="attack-row">
      <input data-attack-name="${i}" value="${escapeHtml(a.name||"")}" placeholder="Ataque">
      <input data-attack-bonus="${i}" value="${escapeHtml(a.bonus||"")}" placeholder="Bônus">
      <input data-attack-damage="${i}" value="${escapeHtml(a.damage||"")}" placeholder="Dano">
      <button type="button" data-attack-remove="${i}">×</button>
    </div>
  `).join("") + `<button type="button" id="add-attack">Adicionar ataque</button>`;
  document.querySelectorAll("[data-attack-name],[data-attack-bonus],[data-attack-damage]").forEach(input=>{
    input.addEventListener("input",e=>{
      const i=Number(e.target.dataset.attackName ?? e.target.dataset.attackBonus ?? e.target.dataset.attackDamage);
      if (!character.attacks[i]) character.attacks[i]={name:"",bonus:"",damage:""};
      if (e.target.dataset.attackName!==undefined) character.attacks[i].name=e.target.value;
      if (e.target.dataset.attackBonus!==undefined) character.attacks[i].bonus=e.target.value;
      if (e.target.dataset.attackDamage!==undefined) character.attacks[i].damage=e.target.value;
    });
  });
  $("add-attack").addEventListener("click",()=>{character.attacks.push({name:"",bonus:"",damage:""});renderAttacks();});
  document.querySelectorAll("[data-attack-remove]").forEach(b=>b.addEventListener("click",()=>{
    character.attacks.splice(Number(b.dataset.attackRemove),1); renderAttacks();
  }));
}

function renderSpells() {
  const query = $("spell-search").value.trim().toLowerCase();
  const level = $("spell-level-filter").value;
  const spells = filterEntities("spell", character.edition, character.content)
    .filter(s => !query || s.name.toLowerCase().includes(query))
    .filter(s => level==="all" || String(s.level ?? 0)===level)
    .slice(0,500);

  $("spells").innerHTML = spells.length ? spells.map(s=>`
    <article class="spell">
      <h3>${escapeHtml(s.name)} ${s.homebrew?'<span class="hb">HOMEBREW</span>':''}</h3>
      <small>${s.level===0?"Truque":`${s.level}º nível`} · ${escapeHtml(s.source||"")}</small>
    </article>
  `).join("") : `<p class="muted">Nenhuma magia encontrada.</p>`;
}

function textFromEntries(entries) {
  if (!Array.isArray(entries)) return "";
  return entries.map(x => typeof x==="string" ? x : x?.name || "").filter(Boolean).join(", ");
}

function renderFeatureList(id, data) {
  const container=$(id);
  if (!data) { container.innerHTML='<p class="muted">Nenhuma seleção.</p>'; return; }
  const features = Array.isArray(data.classFeatures) ? data.classFeatures
    : Array.isArray(data.subclassFeatures) ? data.subclassFeatures
    : Array.isArray(data.entries) ? data.entries : [];
  const text = textFromEntries(features);
  container.innerHTML = `
    <article class="feature">
      <h3>${escapeHtml(data.name || "Selecionado")}</h3>
      <p>${escapeHtml(text || data.source || "Dados carregados do banco.")}</p>
    </article>`;
}

function renderDetails() {
  const parts = [selected.race, selected.class, selected.subclass, selected.background].filter(Boolean);
  $("selection-details").innerHTML = parts.length
    ? parts.map(x=>`<p><strong>${escapeHtml(x.name)}</strong> <span class="muted">${x.homebrew?"· Homebrew":"· Oficial"} · ${escapeHtml(x.source||"")}</span></p>`).join("")
    : "<p>Escolha as opções acima.</p>";
  $("selection-note").textContent = `${catalog?.totals?.entities ?? 0} entidades no banco · ${catalog?.totals?.official ?? 0} oficiais · ${catalog?.totals?.homebrew ?? 0} Homebrew`;
}

function renderFeatures() {
  renderFeatureList("class-features", loaded.class);
  renderFeatureList("subclass-features", loaded.subclass);
  renderFeatureList("race-features", loaded.race);
  renderFeatureList("background-features", loaded.background);
}

function renderAll() {
  renderAttributes();
  renderSaves();
  renderSkills();
  renderCombat();
  renderAttacks();
  renderSpells();
  renderDetails();
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, c => ({
    "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"
  }[c]));
}

async function onSelectionChange() {
  character.classId=$("class").value;
  character.raceId=$("race").value;
  character.backgroundId=$("background").value;
  resetDependentSelection();
  await refreshSubclass(false);
  selected.race=entityById(character.raceId);
  selected.background=entityById(character.backgroundId);
  loaded.race=selected.race?await loadEntity(selected.race):null;
  loaded.background=selected.background?await loadEntity(selected.background):null;
  renderAll();
}

async function loadUIFromCharacter() {
  $("edition").value=character.edition;
  $("content").value=character.content;
  $("name").value=character.name;
  $("level").value=character.level;
  $("xp").value=character.xp;
  $("inspiration").value=character.inspiration;
  await refreshSelectors(true);
  selected.race=entityById(character.raceId);
  selected.background=entityById(character.backgroundId);
  loaded.race=selected.race?await loadEntity(selected.race):null;
  loaded.background=selected.background?await loadEntity(selected.background):null;
  renderAll();
}

function wire() {
  $("edition").addEventListener("change",async e=>{
    character.edition=e.target.value;
    character.classId=character.subclassId=character.raceId=character.backgroundId="";
    await refreshSelectors(false); renderAll();
  });
  $("content").addEventListener("change",async e=>{
    character.content=e.target.value;
    await refreshSelectors(true); renderAll();
  });
  $("class").addEventListener("change",onSelectionChange);
  $("race").addEventListener("change",onSelectionChange);
  $("background").addEventListener("change",onSelectionChange);
  $("subclass").addEventListener("change",async e=>{
    character.subclassId=e.target.value;
    selected.subclass=entityById(character.subclassId);
    loaded.subclass=selected.subclass?await loadEntity(selected.subclass):null;
    renderAll();
  });
  $("name").addEventListener("input",e=>character.name=e.target.value);
  $("level").addEventListener("input",e=>{character.level=Math.min(20,Math.max(1,Number(e.target.value)||1));renderAll();});
  $("xp").addEventListener("input",e=>character.xp=Number(e.target.value)||0);
  $("inspiration").addEventListener("input",e=>character.inspiration=Number(e.target.value)||0);
  $("hp-current").addEventListener("input",e=>character.hpCurrent=Number(e.target.value)||0);
  $("hp-temp").addEventListener("input",e=>character.hpTemp=Number(e.target.value)||0);
  $("ac-input").addEventListener("input",e=>{character.ac=Number(e.target.value)||0;renderCombat();});
  $("speed-input").addEventListener("input",e=>{character.speed=e.target.value;});
  $("spell-search").addEventListener("input",renderSpells);
  $("spell-level-filter").addEventListener("change",renderSpells);

  document.querySelectorAll(".tab").forEach(tab=>tab.addEventListener("click",()=>{
    document.querySelectorAll(".tab").forEach(t=>t.classList.remove("active"));
    document.querySelectorAll(".tab-panel").forEach(p=>p.classList.remove("active"));
    tab.classList.add("active");
    $(`tab-${tab.dataset.tab}`).classList.add("active");
  }));

  $("save-character").addEventListener("click",()=>{saveCharacter(character);toast("Personagem salvo neste navegador.");});
  $("export-character").addEventListener("click",()=>downloadCharacter(character));
  $("new-character").addEventListener("click",async()=>{
    if (!confirm("Criar um novo personagem?")) return;
    clearCharacter(); character=defaultCharacter(); await loadUIFromCharacter(); toast("Novo personagem criado.");
  });
  $("import-character").addEventListener("change",async e=>{
    try {
      character={...defaultCharacter(),...(await readCharacterFile(e.target.files[0]))};
      character.scores={...defaultCharacter().scores,...character.scores};
      await loadUIFromCharacter(); toast("Personagem importado.");
    } catch(err) { console.error(err); toast("Não foi possível importar o arquivo."); }
    e.target.value="";
  });
}

async function start() {
  try {
    catalog=await initDatabase();
    $("db-status").textContent=`Banco carregado · ${catalog.totals?.entities ?? catalog.entities?.length ?? 0} entidades`;
    character=loadCharacter() || defaultCharacter();
    wire();
    await loadUIFromCharacter();
  } catch (error) {
    console.error(error);
    $("db-status").textContent="ERRO: não foi possível carregar data/manifest.json";
    $("selection-note").textContent="Abra a página pelo GitHub Pages e confira se a pasta data/ existe.";
  }
}

start();
