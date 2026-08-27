import {initDatabase,filterEntities,loadEntity,findClassFeatures,findSubclassFeatures,getRecordArrays,stats,manifestEntries,isHomebrew as hb} from "./database.js";
import {ABILITIES,ABILITY_NAMES,SKILLS,mod,fmt,proficiency,hpAverage,abilityKey,spellDc,spellAttack} from "./rules.js";
import {saveCharacter,loadCharacter,clearCharacter,downloadCharacter,readCharacterFile} from "./storage.js";

const $=id=>document.getElementById(id);
let character,refs={class:null,subclass:null,race:null,background:null},details={};
let pickerType=null,pickerFilter="all";

const fresh=()=>({schema:5,name:"",level:1,xp:0,inspiration:0,edition:"2024",content:"all",classId:"",subclassId:"",raceId:"",backgroundId:"",scores:{str:10,dex:10,con:10,int:10,wis:10,cha:10},saveProficiencies:[],skillProficiencies:[],skillExpertise:[],hpCurrent:null,hpTemp:0,ac:null,speed:"",attacks:[]});
const esc=v=>String(v??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[c]));
const toast=t=>{const e=$("toast");e.textContent=t;e.classList.add("show");clearTimeout(toast.t);toast.t=setTimeout(()=>e.classList.remove("show"),2200)};
const list=(t,q="")=>filterEntities(t,character.edition,character.content,q);
const byId=id=>manifestEntries().find(x=>x.id===id)||null;
const labelMeta=x=>`${hb(x)?"Homebrew":"Oficial"} · ${x?.edition||character.edition}${x?.source?" · "+x.source:""}`;
function sourceTag(x){return `<span class="tag ${hb(x)?"brew":"official"}">${hb(x)?"HOMEBREW":"OFICIAL"}${x?.source?` · ${esc(x.source)}`:""}</span>`}

function classMatches(x,c){
 if(!c)return false;
 const n=String(c.name||"").toLowerCase(),cn=String(x.className||x.class||"").toLowerCase();
 const cs=String(c.source||"").toLowerCase(),xs=String(x.classSource||"").toLowerCase();
 return (!cn||cn===n||cn.includes(n))&&(!cs||!xs||cs===xs);
}
function classInfo(){const j=details.class;return j?.class?.[0]||j?.class||j||{}}
function raceInfo(){const j=details.race;return j?.race?.[0]||j?.race||j||{}}
function richText(v){
 const out=[];
 const inline=s=>String(s).replace(/\{@(b|bold|i|italic|u|note|dc|dice|damage|hit|atk|chance|condition|skill|spell|item|race|class|creature|book|link)\s+([^}|]+)(?:\|[^}]*)?\}/gi,"$2").replace(/\{@[^}]+\}/g,"");
 const walk=x=>{
  if(x==null)return;
  if(typeof x==="string"){out.push(`<p>${esc(inline(x))}</p>`);return}
  if(Array.isArray(x)){out.push("<ul>");x.forEach(y=>{if(typeof y==="string")out.push(`<li>${esc(inline(y))}</li>`);else{out.push("<li>");walk(y);out.push("</li>")}});out.push("</ul>");return}
  if(typeof x!=="object")return;
  if(x.name&&x.entries){out.push(`<h3>${esc(inline(x.name))}</h3>`);walk(x.entries);return}
  if(x.type==="entries"&&x.name){out.push(`<h3>${esc(inline(x.name))}</h3>`);walk(x.entries);return}
  if(x.type==="list"||x.items){walk(x.items||x.entries);return}
  if(x.type==="item"){walk(x.entry||x.entries||x.name);return}
  if(x.type==="table"&&Array.isArray(x.rows)){out.push("<table><tbody>");if(x.colLabels)out.push("<tr>"+x.colLabels.map(h=>`<th>${esc(inline(h))}</th>`).join("")+"</tr>");x.rows.forEach(r=>out.push("<tr>"+r.map(c=>`<td>${esc(inline(typeof c==="string"?c:JSON.stringify(c)))}</td>`).join("")+"</tr>"));out.push("</tbody></table>");return}
  if(x.entries)walk(x.entries);else if(x.entry)walk(x.entry);else if(x.desc)walk(x.desc);
 };
 walk(v);return out.join("")||"<p class='muted'>Não há descrição estruturada disponível para este registro.</p>";
}
function plainText(v){const tmp=document.createElement("div");tmp.innerHTML=richText(v);return tmp.textContent.replace(/\s+/g," ").trim()}
async function recordFor(e){if(!e)return null;const j=await getRecordArrays(e);if(!j.length)return null;return j.find(r=>String(r.name||"").toLowerCase()===String(e.name||"").toLowerCase())||j[0]}
function descriptionOf(r,e){return r?.entries||r?.desc||r?.description||r?.fluff||r?.traits||r?.featureEntries||e?.description||""}

async function updateChoiceCard(type){
 const e=refs[type], val=$(`choice-${type}-value`),meta=$(`choice-${type}-meta`),desc=$(`${type}-preview`),card=$(`choice-${type}`);
 if(!e){val.textContent=type==="subclass"&&!refs.class?"Escolha a classe primeiro":"Escolher…";meta.textContent=type==="subclass"&&!refs.class?"—":"Nenhuma opção selecionada";desc.textContent=type==="subclass"&&!refs.class?"A lista será filtrada pela classe escolhida.":"Escolha uma opção para ver sua descrição.";card.classList.remove("selected");return}
 card.classList.add("selected");val.textContent=e.name||"Sem nome";meta.innerHTML=`${sourceTag(e)} <span>${esc(e.edition||character.edition)}${e.source?` · ${esc(e.source)}`:""}</span>`;
 desc.textContent="Carregando descrição…";
 try{const r=await recordFor(e),txt=plainText(descriptionOf(r,e));desc.textContent=txt?`${txt.slice(0,230)}${txt.length>230?"…":""}`:"Descrição não estruturada disponível. Clique em ⓘ para ver os dados."}
 catch{desc.textContent="Descrição indisponível."}
}
async function refreshSelectors(){
 refs.class=byId(character.classId);refs.race=byId(character.raceId);refs.background=byId(character.backgroundId);refs.subclass=byId(character.subclassId);
 if(refs.subclass&&!classMatches(refs.subclass,refs.class)){character.subclassId="";refs.subclass=null}
 details.class=refs.class?await loadEntity(refs.class):null;
 details.subclass=refs.subclass?await loadEntity(refs.subclass):null;
 details.race=refs.race?await loadEntity(refs.race):null;
 details.background=refs.background?await loadEntity(refs.background):null;
 await Promise.all(["race","class","subclass","background"].map(updateChoiceCard));
 renderHeader();renderDetails();renderSpellStats();
}
function ability(a){return mod(character.scores[a])}
function skill(id,a){let v=ability(a),p=proficiency(character.level);if(character.skillProficiencies.includes(id))v+=p;if(character.skillExpertise.includes(id))v+=p;return v}
function faces(){const c=classInfo();return Number(c.hd?.faces||c.hitDie?.faces||8)||8}
function spellAbility(){const c=classInfo();return abilityKey(c.spellcastingAbility||c.spellcasting?.ability)}
function calc(){
 const pb=proficiency(character.level),f=faces(),con=ability("con");
 const hp=Math.max(1,f+con+(character.level-1)*(hpAverage(f)+con)),sa=spellAbility(),sm=sa?ability(sa):0;
 const ri=raceInfo(),speed=character.speed||ri.speed||"30 ft";
 return {pb,f,hp,initiative:ability("dex"),ac:character.ac??10+ability("dex"),passive:10+skill("perception","wis"),speed,spellAbility:sa,spellDc:sa?spellDc(pb,sm):null,spellAttack:sa?spellAttack(pb,sm):null};
}
function renderHeader(){
 const c=refs.class,sc=refs.subclass,r=refs.race,b=refs.background;
 $("head-class").textContent=c?`${c.name}${sc?` · ${sc.name}`:""}`:"—";
 $("head-background").textContent=b?.name||"—";$("head-race").textContent=r?.name||"—";
 $("level").value=character.level;$("name").value=character.name;$("xp").value=character.xp;
}
function renderOverviewAbilities(){
 $("overview-abilities").innerHTML=ABILITIES.map(a=>`<div class="mini-ability"><span>${ABILITY_NAMES[a].slice(0,3).toUpperCase()}</span><strong>${character.scores[a]}</strong><em>${fmt(ability(a))}</em></div>`).join("");
}
function renderAbilities(){
 $("attributes").innerHTML=ABILITIES.map(a=>`<div class="ability"><h3>${ABILITY_NAMES[a]}</h3><input data-ab="${a}" type="number" min="1" max="30" value="${character.scores[a]}"><div class="mod">${fmt(ability(a))}</div></div>`).join("");
 document.querySelectorAll("[data-ab]").forEach(e=>e.oninput=()=>{character.scores[e.dataset.ab]=Number(e.value)||0;renderAbilities();renderOverviewAbilities();renderCombat();renderSaves();renderSkills()});
}
function renderSaves(){
 const p=proficiency(character.level);
 $("saves").innerHTML=ABILITIES.map(a=>`<label class="skill"><input data-save="${a}" type="checkbox" ${character.saveProficiencies.includes(a)?"checked":""}><span>${ABILITY_NAMES[a]}</span><strong>${fmt(ability(a)+(character.saveProficiencies.includes(a)?p:0))}</strong></label>`).join("");
 document.querySelectorAll("[data-save]").forEach(e=>e.onchange=()=>{const a=e.dataset.save;character.saveProficiencies=e.checked?[...new Set([...character.saveProficiencies,a])]:character.saveProficiencies.filter(x=>x!==a);renderSaves()});
}
function renderSkills(){
 $("skills").innerHTML=SKILLS.map(([id,n,a])=>`<label class="skill"><input data-skill="${id}" type="checkbox" ${character.skillProficiencies.includes(id)?"checked":""}><span>${n}<small>${a.toUpperCase()}</small></span><strong>${fmt(skill(id,a))}</strong></label>`).join("");
 document.querySelectorAll("[data-skill]").forEach(e=>e.onchange=()=>{const id=e.dataset.skill;character.skillProficiencies=e.checked?[...new Set([...character.skillProficiencies,id])]:character.skillProficiencies.filter(x=>x!==id);renderSkills();renderCombat()});
}
function renderCombat(){
 const c=calc();["pb"].forEach(id=>$(id).textContent=fmt(c.pb));$("hp").textContent=c.hp;$("hit-die").textContent=`d${c.f}`;$("ac").textContent=c.ac;$("initiative").textContent=fmt(c.initiative);$("passive").textContent=c.passive;$("speed").textContent=c.speed;$("spell-dc").textContent=c.spellDc??"—";$("spell-attack").textContent=c.spellAttack==null?"—":fmt(c.spellAttack);
 $("ac-combat").textContent=c.ac;$("initiative-combat").textContent=fmt(c.initiative);$("speed-combat").textContent=c.speed;
 $("hp-current").value=character.hpCurrent??c.hp;$("hp-temp").value=character.hpTemp;$("ac-input").value=c.ac;$("speed-input").value=character.speed||"";
}
function renderSpellStats(){
 const c=calc(),name=c.spellAbility?ABILITY_NAMES[c.spellAbility]:"—";
 $("spell-ability-name").textContent=name;$("spell-dc-2").textContent=c.spellDc??"—";$("spell-attack-2").textContent=c.spellAttack==null?"—":fmt(c.spellAttack);
}
function renderAttacks(){
 const a=character.attacks.length?character.attacks:[{name:"",bonus:"",damage:""}];
 $("attacks").innerHTML=a.map((x,i)=>`<div class="attack-row"><input data-ai="${i}" data-k="name" value="${esc(x.name)}" placeholder="Ataque"><input data-ai="${i}" data-k="bonus" value="${esc(x.bonus)}" placeholder="+0"><input data-ai="${i}" data-k="damage" value="${esc(x.damage)}" placeholder="Dano / tipo"><button data-del="${i}" title="Remover">×</button></div>`).join("")+`<button id="add-attack" class="outline-btn">+ Adicionar ataque</button>`;
 document.querySelectorAll("[data-ai]").forEach(e=>e.oninput=()=>{const i=+e.dataset.ai;character.attacks[i]??={};character.attacks[i][e.dataset.k]=e.value});
 document.querySelectorAll("[data-del]").forEach(e=>e.onclick=()=>{character.attacks.splice(+e.dataset.del,1);renderAttacks()});
 $("add-attack").onclick=()=>{character.attacks.push({name:"",bonus:"",damage:""});renderAttacks()};
}
function renderSpells(){
 const q=$("spell-search").value.toLowerCase(),lv=$("spell-level-filter").value;
 const l=list("spell",q).filter(x=>lv==="all"||String(x.level??0)===lv).slice(0,180);
 $("spells").innerHTML=l.length?l.map(x=>`<article class="spell-card" data-entity-id="${esc(x.id)}"><div class="spell-name">${esc(x.name)}</div><div class="spell-meta">${x.level===0?"Truque":`${x.level||0}º nível`} · ${esc(x.edition||character.edition)} · ${esc(x.source||"")}</div>${sourceTag(x)}</article>`).join(""):"<div class='empty'>Nenhuma magia encontrada.</div>";
 document.querySelectorAll("#spells [data-entity-id]").forEach(e=>e.onclick=()=>openEntity(byId(e.dataset.entityId)));
}
function featureText(f){return f?.entries||f?.desc||f?.description||""}
async function renderProgression(){
 const cf=refs.class?await findClassFeatures(refs.class,character.level):[],sf=refs.subclass?await findSubclassFeatures(refs.subclass,character.level):[];
 const map=new Map();[...cf.map(x=>({...x,__kind:"Classe"})),...sf.map(x=>({...x,__kind:"Subclasse"}))].forEach(f=>{const l=Number(f.level||1);if(!map.has(l))map.set(l,[]);map.get(l).push(f)});
 $("progression").innerHTML=Array.from({length:character.level},(_,i)=>i+1).map(l=>{const fs=map.get(l)||[];return `<div class="progress-card"><div class="level-num">${l}</div><div class="level-content"><h3>Nível ${l}${l===character.level?" · atual":""}</h3>${fs.length?fs.map(f=>`<div class="feature-level"><span class="feature-kind">${esc(f.__kind)}</span><div><strong>${esc(f.name||"Característica")}</strong>${plainText(featureText(f))?`<p>${esc(plainText(featureText(f)).slice(0,430))}${plainText(featureText(f)).length>430?"…":""}</p>`:""}</div></div>`).join(""):"<p class='muted'>Nenhuma característica estruturada encontrada.</p>"}</div></div>`}).join("");
 const c=classInfo(),prog=c.casterProgression||c.casterProgressionByLevel||c.spellcastingProgression;
 $("spell-progression").innerHTML=prog?`<p>Progressão de conjuração: <strong>${esc(String(prog))}</strong></p>`:"<p class='muted'>A classe selecionada não expõe uma progressão estruturada neste registro.</p>";
}
function renderDetails(){
 const vals=[refs.race,refs.class,refs.subclass,refs.background].filter(Boolean);
 $("selection-details").innerHTML=vals.map(x=>`<div class="detail-line"><strong>${esc(x.name)}</strong><div>${sourceTag(x)} <span>${esc(x.edition||character.edition)}${x.source?` · ${esc(x.source)}`:""}</span></div></div>`).join("")||"<p class='muted'>Escolha suas opções no construtor acima.</p>";
 const s=stats();$("selection-note").textContent=`${s.entities.toLocaleString("pt-BR")} registros · ${s.official.toLocaleString("pt-BR")} oficiais · ${s.homebrew.toLocaleString("pt-BR")} Homebrew`;
}
async function renderAll(){renderOverviewAbilities();renderAbilities();renderSaves();renderSkills();renderCombat();renderAttacks();renderSpells();renderDetails();renderSpellStats();await renderProgression()}

function openModal(title,kicker,meta,body){
 $("modal-title").textContent=title||"Detalhes";$("modal-kicker").textContent=kicker||"COMPÊNDIO";$("modal-meta").innerHTML=meta||"";$("modal-body").innerHTML=body||"<p>Sem dados.</p>";$("modal").classList.add("open");$("modal").setAttribute("aria-hidden","false");
}
async function openEntity(e){
 if(!e)return;
 openModal(e.name,"DETALHES",`${sourceTag(e)} <span class="source-tag">Edição ${esc(e.edition||character.edition)}${e.source?` · ${esc(e.source)}`:""}</span>`,"<p>Carregando descrição…</p>");
 try{const r=await recordFor(e),info=r||e,body=descriptionOf(info,e);let extra=[];
 [["Tamanho","size"],["Deslocamento","speed"],["Raridade","rarity"],["Tipo","type"],["Escola","school"],["Alcance","range"],["Duração","duration"],["Tempo","time"],["Componentes","components"],["Pré-requisito","prerequisite"]].forEach(([lab,k])=>{if(info[k]!=null)extra.push(`<p><strong>${lab}:</strong> ${esc(Array.isArray(info[k])?info[k].join(", "):typeof info[k]==="object"?JSON.stringify(info[k]):info[k])}</p>`)});
 openModal(info.name||e.name,"DETALHES",`${sourceTag(e)} <span class="source-tag">Edição ${esc(e.edition||character.edition)}${e.source?` · ${esc(e.source)}`:""}</span>`,extra.join("")+richText(body));
 }catch(err){openModal(e.name,"DETALHES","",`<p>Não foi possível carregar a descrição.</p><p class="muted">${esc(err.message||err)}</p>`)}
}

function openPicker(type){
 pickerType=type;pickerFilter="all";
 $("picker-title").textContent={race:"Escolher espécie / raça",class:"Escolher classe",subclass:"Escolher subclasse",background:"Escolher background"}[type];
 $("picker-kicker").textContent=type==="subclass"&&!refs.class?"CLASSE NECESSÁRIA":"COMPÊNDIO";
 $("picker-search").value="";
 document.querySelectorAll("#picker-filters button").forEach(b=>b.classList.toggle("active",b.dataset.filter==="all"));
 $("picker").classList.add("open");$("picker").setAttribute("aria-hidden","false");renderPicker();
 setTimeout(()=>$("picker-search").focus(),50);
}
function renderPicker(){
 const q=$("picker-search").value.toLowerCase().trim();
 let items=list(pickerType,q);
 if(pickerType==="subclass")items=items.filter(x=>classMatches(x,refs.class));
 if(pickerFilter==="official")items=items.filter(x=>!hb(x));
 if(pickerFilter==="homebrew")items=items.filter(hb);
 items=items.slice(0,240);
 $("picker-count").textContent=`${items.length}${items.length===240?"+":""} opções encontradas`;
 $("picker-results").innerHTML=items.length?items.map(x=>`<button class="pick-card" data-pick-id="${esc(x.id)}">
   <div class="pick-top"><strong>${esc(x.name||"Sem nome")}</strong>${sourceTag(x)}</div>
   <div class="pick-meta">${esc(x.edition||character.edition)}${x.source?` · ${esc(x.source)}`:""}</div>
   <div class="pick-desc" data-desc-for="${esc(x.id)}">Clique para selecionar · ⓘ abre detalhes</div>
 </button>`).join(""):`<div class="empty picker-empty">Nenhuma opção encontrada. Tente outro filtro ou pesquisa.</div>`;
 document.querySelectorAll(".pick-card").forEach(btn=>btn.onclick=async()=>{
   const e=byId(btn.dataset.pickId);if(!e)return;
   character[`${pickerType}Id`]=e.id;
   if(pickerType==="class")character.subclassId="";
   closePicker();await refreshSelectors();await renderAll();toast(`${e.name} selecionado.`);
 });
}
function closePicker(){$("picker").classList.remove("open");$("picker").setAttribute("aria-hidden","true");pickerType=null}

async function renderCompendium(){
 const q=$("compendium-search").value.toLowerCase(),t=$("compendium-type").value;
 const types=t==="all"?["class","subclass","race","background","feat","spell","item"]:[t];
 let items=[];for(const ty of types)items.push(...list(ty,q));
 items=items.sort((a,b)=>Number(hb(a))-Number(hb(b))||String(a.name).localeCompare(String(b.name),"pt-BR")).slice(0,150);
 $("compendium-results").innerHTML=items.length?items.map(x=>`<article class="entity-card" data-entity-id="${esc(x.id)}"><div class="card-top"><h3>${esc(x.name)}</h3>${sourceTag(x)}</div><div class="card-meta">${esc(x.type)} · ${esc(x.edition||character.edition)}${x.source?` · ${esc(x.source)}`:""}</div><p>Clique para abrir descrição e detalhes.</p></article>`).join(""):"<div class='empty'>Nenhum registro encontrado.</div>";
 document.querySelectorAll("#compendium-results [data-entity-id]").forEach(e=>e.onclick=()=>openEntity(byId(e.dataset.entityId)));
}

async function sync(){
 await refreshSelectors();renderHeader();$("edition").value=character.edition;$("content").value=character.content;await renderAll();
}
function wire(){
 $("edition").onchange=async e=>{character.edition=e.target.value;character.classId=character.subclassId=character.raceId=character.backgroundId="";await sync()};
 $("content").onchange=async e=>{character.content=e.target.value;await sync()};
 document.querySelectorAll("[data-pick]").forEach(b=>b.onclick=()=>openPicker(b.dataset.pick));
 document.querySelectorAll("[data-info]").forEach(b=>b.onclick=()=>openEntity(refs[b.dataset.info]));
 document.querySelectorAll("#picker-filters button").forEach(b=>b.onclick=()=>{pickerFilter=b.dataset.filter;document.querySelectorAll("#picker-filters button").forEach(x=>x.classList.toggle("active",x===b));renderPicker()});
 $("picker-search").oninput=renderPicker;
 document.querySelectorAll("[data-close-picker]").forEach(e=>e.onclick=closePicker);
 document.querySelectorAll("[data-close-modal]").forEach(e=>e.onclick=()=>{$("modal").classList.remove("open");$("modal").setAttribute("aria-hidden","true")});
 document.addEventListener("keydown",e=>{if(e.key==="Escape"){closePicker();$("modal").classList.remove("open");$("modal").setAttribute("aria-hidden","true")}});
 $("name").oninput=e=>{character.name=e.target.value;renderHeader()};
 $("level").oninput=async e=>{character.level=Math.max(1,Math.min(20,+e.target.value||1));await renderAll()};
 $("xp").oninput=e=>character.xp=+e.target.value||0;
 $("hp-current").oninput=e=>character.hpCurrent=+e.target.value||0;$("hp-temp").oninput=e=>character.hpTemp=+e.target.value||0;
 $("ac-input").oninput=e=>{character.ac=+e.target.value||0;renderCombat()};$("speed-input").oninput=e=>{character.speed=e.target.value;renderCombat()};
 $("spell-search").oninput=renderSpells;$("spell-level-filter").onchange=renderSpells;
 $("compendium-search").oninput=renderCompendium;$("compendium-type").onchange=renderCompendium;
 document.querySelectorAll(".tab").forEach(t=>t.onclick=()=>{document.querySelectorAll(".tab").forEach(x=>x.classList.remove("active"));document.querySelectorAll(".tab-panel").forEach(x=>x.classList.remove("active"));t.classList.add("active");$(`tab-${t.dataset.tab}`).classList.add("active");if(t.dataset.tab==="compendium")renderCompendium()});
 $("save-character").onclick=()=>{saveCharacter(character);toast("Personagem salvo.")};
 $("export-character").onclick=()=>downloadCharacter(character);
 $("new-character").onclick=async()=>{if(confirm("Criar novo personagem?")){clearCharacter();character=fresh();await sync();toast("Novo personagem.")}};
 $("import-character").onchange=async e=>{try{const imported=await readCharacterFile(e.target.files[0]);character={...fresh(),...imported,scores:{...fresh().scores,...(imported.scores||{})}};await sync();toast("Personagem importado.")}catch{toast("JSON inválido.")}e.target.value=""};
}
(async()=>{try{await initDatabase();const s=stats();$("db-status").textContent=`Banco carregado · ${s.entities.toLocaleString("pt-BR")} registros`;character=loadCharacter()||fresh();wire();await sync()}catch(e){console.error(e);$("db-status").textContent="Erro no banco";console.error(e)}})();