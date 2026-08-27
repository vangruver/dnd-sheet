import {initDatabase,getCatalog,filterEntities,loadEntity,stats,entitiesFromManifest} from "./database.js";
import {ABILITIES,ABILITY_NAMES,SKILLS,mod,fmt,proficiency,hpAverage,abilityKey,ruleFor} from "./rules.js";
import {saveCharacter,loadCharacter,clearCharacter,downloadCharacter,readCharacterFile} from "./storage.js";

const $=id=>document.getElementById(id);
let catalog=null, character=null;
const data={class:null,subclass:null,race:null,background:null};
const detail={class:null,subclass:null,race:null,background:null};

function fresh(){return{
 schema:3,name:"",level:1,xp:0,inspiration:0,edition:"2024",content:"all",
 classId:"",subclassId:"",raceId:"",backgroundId:"",
 scores:{str:10,dex:10,con:10,int:10,wis:10,cha:10},
 saveProficiencies:[],skillProficiencies:[],skillExpertise:[],
 hpCurrent:null,hpTemp:0,ac:null,speed:"",attacks:[],spells:[]
};}
function esc(v){return String(v??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[c]));}
function toast(t){const e=$("toast");e.textContent=t;e.classList.add("show");setTimeout(()=>e.classList.remove("show"),2200);}
function all(type){return filterEntities(type,character.edition,character.content)}
function byId(id){return entitiesFromManifest().find(x=>x.id===id)||null;}
function fill(sel,items,placeholder){
  sel.innerHTML=`<option value="">${placeholder}</option>`;
  for(const group of [{label:"Oficial",v:items.filter(x=>!x.homebrew)},{label:"Homebrew",v:items.filter(x=>x.homebrew)}]){
    if(!group.v.length)continue;
    const og=document.createElement("optgroup");og.label=group.label;
    group.v.forEach(x=>{const o=document.createElement("option");o.value=x.id;o.textContent=x.name;og.appendChild(o)});
    sel.appendChild(og);
  }
}
function classMatch(x,cls){
  if(!cls)return false;
  const a=String(x.className||x.class||x.classSource||"").toLowerCase(),b=String(cls.name||"").toLowerCase();
  return !a||a===b||a.includes(b)||b.includes(a);
}
async function refreshChoices(keep=true){
  const cl=all("class"),ra=all("race"),bg=all("background");
  fill($("class"),cl,"Selecione a classe…");fill($("race"),ra,"Selecione a espécie/raça…");fill($("background"),bg,"Selecione o background…");
  if(keep){
    $("class").value=cl.some(x=>x.id===character.classId)?character.classId:"";
    $("race").value=ra.some(x=>x.id===character.raceId)?character.raceId:"";
    $("background").value=bg.some(x=>x.id===character.backgroundId)?character.backgroundId:"";
  }
  await refreshSubclass(keep);
}
async function refreshSubclass(keep=true){
  data.class=byId(character.classId); detail.class=data.class?await loadEntity(data.class):null;
  let list=all("subclass");
  if(data.class)list=list.filter(x=>classMatch(x,data.class));
  fill($("subclass"),list,data.class?"Selecione a subclasse…":"Escolha a classe primeiro");
  if(keep&&list.some(x=>x.id===character.subclassId))$("subclass").value=character.subclassId;else character.subclassId="";
  data.subclass=byId(character.subclassId);detail.subclass=data.subclass?await loadEntity(data.subclass):null;
}
function extractFaces(c){return Number(c?.hd?.faces||c?.hitDie?.faces||c?.hitDie||8)||8}
function extractSpellAbility(c){
  const v=c?.spellcastingAbility||c?.spellcasting?.ability||c?.spellcasting?.abilityScore;
  return abilityKey(Array.isArray(v)?v[0]:v);
}
function findNamed(obj,keys){
  if(!obj||typeof obj!=="object")return null;
  for(const k of keys)if(obj[k]!=null)return obj[k];
  return null;
}
function calculate(){
  const cls=detail.class||data.class||{},pb=proficiency(character.level),faces=extractFaces(cls);
  const con=mod(character.scores.con),dex=mod(character.scores.dex);
  const hp=Math.max(1,faces+con+(character.level-1)*(hpAverage(faces)+con));
  const spellAbility=extractSpellAbility(cls),sm=spellAbility?mod(character.scores[spellAbility]):0;
  const rules=ruleFor(character.edition);
  const race=detail.race||data.race||{};
  const speed=findNamed(race,["speed","walk"])||character.speed||"—";
  return {pb,faces,hp,initiative:dex,ac:character.ac??10+dex,passive:10+skill("perception","wis"),spellAbility,
    spellDc:spellAbility?rules.spellDc(pb,sm):null,spellAttack:spellAbility?rules.spellAttack(pb,sm):null,speed};
}
function skill(id,a){
  const pb=proficiency(character.level);let v=mod(character.scores[a]);
  if(character.skillProficiencies.includes(id))v+=pb;
  if(character.skillExpertise.includes(id))v+=pb;
  return v;
}
function renderAbilities(){
  $("attributes").innerHTML=ABILITIES.map(a=>`<div class="ability"><h3>${ABILITY_NAMES[a]}</h3><input data-ab="${a}" type="number" min="1" max="30" value="${character.scores[a]}"><div class="mod">${fmt(mod(character.scores[a]))}</div></div>`).join("");
  document.querySelectorAll("[data-ab]").forEach(e=>e.oninput=()=>{character.scores[e.dataset.ab]=Number(e.value)||0;renderAll()});
}
function renderSaves(){
  const pb=proficiency(character.level);
  $("saves").innerHTML=ABILITIES.map(a=>`<label class="skill"><input type="checkbox" data-save="${a}" ${character.saveProficiencies.includes(a)?"checked":""}><span>${ABILITY_NAMES[a]}</span><strong class="value">${fmt(mod(character.scores[a])+(character.saveProficiencies.includes(a)?pb:0))}</strong></label>`).join("");
  document.querySelectorAll("[data-save]").forEach(e=>e.onchange=()=>{const a=e.dataset.save;character.saveProficiencies=e.checked?[...new Set([...character.saveProficiencies,a])]:character.saveProficiencies.filter(x=>x!==a);renderAll()});
}
function renderSkills(){
  $("skills").innerHTML=SKILLS.map(([id,n,a])=>`<label class="skill"><input type="checkbox" data-skill="${id}" ${character.skillProficiencies.includes(id)?"checked":""}><span>${n} <span class="ability-name">${a.toUpperCase()}</span></span><strong class="value">${fmt(skill(id,a))}</strong></label>`).join("");
  document.querySelectorAll("[data-skill]").forEach(e=>e.onchange=()=>{const id=e.dataset.skill;character.skillProficiencies=e.checked?[...new Set([...character.skillProficiencies,id])]:character.skillProficiencies.filter(x=>x!==id);renderAll()});
}
function renderCombat(){
  const c=calculate();$("pb").textContent=fmt(c.pb);$("hp").textContent=c.hp;$("hit-die").textContent=`d${c.faces}`;$("ac").textContent=c.ac;$("initiative").textContent=fmt(c.initiative);$("passive").textContent=c.passive;$("spell-dc").textContent=c.spellDc??"—";$("spell-attack").textContent=c.spellAttack==null?"—":fmt(c.spellAttack);$("speed").textContent=c.speed;
  $("hp-current").value=character.hpCurrent??c.hp;$("hp-temp").value=character.hpTemp??0;$("ac-input").value=character.ac??10+c.initiative;$("speed-input").value=character.speed||"";
}
function renderAttacks(){
  const a=character.attacks.length?character.attacks:[{name:"",bonus:"",damage:""}];
  $("attacks").innerHTML=a.map((x,i)=>`<div class="attack-row"><input data-an="${i}" value="${esc(x.name)}" placeholder="Ataque"><input data-abonus="${i}" value="${esc(x.bonus)}" placeholder="Bônus"><input data-adamage="${i}" value="${esc(x.damage)}" placeholder="Dano"><button data-ar="${i}">×</button></div>`).join("")+`<button id="add-attack">Adicionar ataque</button>`;
  document.querySelectorAll("[data-an],[data-abonus],[data-adamage]").forEach(e=>e.oninput=()=>{const i=Number(e.dataset.an??e.dataset.abonus??e.dataset.adamage);character.attacks[i]??={};if(e.dataset.an!==undefined)character.attacks[i].name=e.value;if(e.dataset.abonus!==undefined)character.attacks[i].bonus=e.value;if(e.dataset.adamage!==undefined)character.attacks[i].damage=e.value});
  $("add-attack").onclick=()=>{character.attacks.push({name:"",bonus:"",damage:""});renderAttacks()};
  document.querySelectorAll("[data-ar]").forEach(e=>e.onclick=()=>{character.attacks.splice(Number(e.dataset.ar),1);renderAttacks()});
}
function renderSpells(){
  const q=$("spell-search").value.toLowerCase(),lv=$("spell-level-filter").value;
  const list=all("spell").filter(x=>(!q||String(x.name).toLowerCase().includes(q))&&(lv==="all"||String(x.level??0)===lv)).slice(0,500);
  $("spells").innerHTML=list.length?list.map(x=>`<article class="spell"><h3>${esc(x.name)} ${x.homebrew?'<span class="hb">HOMEBREW</span>':""}</h3><small>${x.level===0?"Truque":`${x.level}º nível`} · ${esc(x.source||"")}</small></article>`).join(""):"<p class='muted'>Nenhuma magia encontrada.</p>";
}
function entriesText(v){
  const out=[];
  const walk=x=>{if(typeof x==="string")out.push(x);else if(Array.isArray(x))x.forEach(walk);else if(x&&typeof x==="object"){if(x.name)out.push(String(x.name));if(x.entries)walk(x.entries)}};
  walk(v);return out.slice(0,30).join(" · ");
}
function renderFeature(id,obj,label){
  const e=$(id);
  if(!obj){e.innerHTML=`<p class="muted">${label}: nada selecionado.</p>`;return}
  const desc=entriesText(obj.entries||obj.description||obj.features||obj.classFeatures||obj.subclassFeatures);
  e.innerHTML=`<article class="feature"><h3>${esc(obj.name||label)}</h3><p>${esc(desc||"Dados carregados do banco. Consulte a origem para detalhes completos.")}</p></article>`;
}
function renderDetails(){
  const vals=[data.race,data.class,data.subclass,data.background].filter(Boolean);
  $("selection-details").innerHTML=vals.length?vals.map(x=>`<p><strong>${esc(x.name)}</strong> <span class="muted">${x.homebrew?"· Homebrew":"· Oficial"} · ${esc(x.source||"")}</span></p>`).join(""):"<p>Escolha as opções acima.</p>";
  const s=stats();$("selection-note").textContent=`Banco: ${s.entities} entidades · ${s.official} oficiais · ${s.homebrew} Homebrew`;
}
function renderAll(){
  renderAbilities();renderSaves();renderSkills();renderCombat();renderAttacks();renderSpells();renderDetails();
  renderFeature("class-features",detail.class,"Classe");
  renderFeature("subclass-features",detail.subclass,"Subclasse");
  renderFeature("race-features",detail.race,"Espécie");
  renderFeature("background-features",detail.background,"Background");
}
async function selection(){
  character.classId=$("class").value;character.raceId=$("race").value;character.backgroundId=$("background").value;character.subclassId="";
  await refreshSubclass(false);
  data.race=byId(character.raceId);data.background=byId(character.backgroundId);
  detail.race=data.race?await loadEntity(data.race):null;detail.background=data.background?await loadEntity(data.background):null;
  renderAll();
}
async function syncUI(){
  $("edition").value=character.edition;$("content").value=character.content;$("name").value=character.name;$("level").value=character.level;$("xp").value=character.xp;$("inspiration").value=character.inspiration;
  await refreshChoices(true);
  data.race=byId(character.raceId);data.background=byId(character.backgroundId);
  detail.race=data.race?await loadEntity(data.race):null;detail.background=data.background?await loadEntity(data.background):null;
  renderAll();
}
function wire(){
  $("edition").onchange=async e=>{character.edition=e.target.value;character.classId=character.subclassId=character.raceId=character.backgroundId="";await refreshChoices(false);renderAll()};
  $("content").onchange=async e=>{character.content=e.target.value;await refreshChoices(true);renderAll()};
  $("class").onchange=selection;$("race").onchange=selection;$("background").onchange=selection;
  $("subclass").onchange=async e=>{character.subclassId=e.target.value;data.subclass=byId(character.subclassId);detail.subclass=data.subclass?await loadEntity(data.subclass):null;renderAll()};
  $("name").oninput=e=>character.name=e.target.value;$("level").oninput=e=>{character.level=Math.min(20,Math.max(1,Number(e.target.value)||1));renderAll()};
  $("xp").oninput=e=>character.xp=Number(e.target.value)||0;$("inspiration").oninput=e=>character.inspiration=Number(e.target.value)||0;
  $("hp-current").oninput=e=>character.hpCurrent=Number(e.target.value)||0;$("hp-temp").oninput=e=>character.hpTemp=Number(e.target.value)||0;
  $("ac-input").oninput=e=>{character.ac=Number(e.target.value)||0;renderCombat()};$("speed-input").oninput=e=>character.speed=e.target.value;
  $("spell-search").oninput=renderSpells;$("spell-level-filter").onchange=renderSpells;
  document.querySelectorAll(".tab").forEach(t=>t.onclick=()=>{document.querySelectorAll(".tab").forEach(x=>x.classList.remove("active"));document.querySelectorAll(".tab-panel").forEach(x=>x.classList.remove("active"));t.classList.add("active");$(`tab-${t.dataset.tab}`).classList.add("active")});
  $("save-character").onclick=()=>{saveCharacter(character);toast("Personagem salvo.")};
  $("export-character").onclick=()=>downloadCharacter(character);
  $("new-character").onclick=async()=>{if(confirm("Criar um novo personagem?")){clearCharacter();character=fresh();await syncUI();toast("Novo personagem.")}};
  $("import-character").onchange=async e=>{try{character={...fresh(),...(await readCharacterFile(e.target.files[0]))};character.scores={...fresh().scores,...character.scores};await syncUI();toast("Personagem importado.")}catch{toast("JSON inválido.")}e.target.value=""};
}
async function start(){
  try{
    catalog=await initDatabase();const s=stats();$("db-status").textContent=`Banco carregado · ${s.entities} entidades`;
    character=loadCharacter()||fresh();wire();await syncUI();
  }catch(err){console.error(err);$("db-status").textContent="ERRO ao carregar data/manifest.json";$("selection-note").textContent="Verifique se o GitHub Pages está servindo a pasta data/."}
}
start();
