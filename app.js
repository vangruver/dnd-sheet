import {initDatabase,filterEntities,loadEntity,findClassFeatures,findSubclassFeatures,getRecordArrays,stats,manifestEntries,isHomebrew as hb,normType} from "./database.js";
import {ABILITIES,ABILITY_NAMES,SKILLS,mod,fmt,proficiency,hpAverage,abilityKey,spellDc,spellAttack} from "./rules.js";
import {saveCharacter,loadCharacter,clearCharacter,downloadCharacter,readCharacterFile} from "./storage.js";

const $=id=>document.getElementById(id);
let character, refs={class:null,subclass:null,race:null,background:null}, details={};
let pickerType=null, eqCat="inventory";

const fresh=()=>({schema:6,name:"",level:1,xp:0,inspiration:0,edition:"2024",content:"all",classId:"",subclassId:"",raceId:"",backgroundId:"",
scores:{str:10,dex:10,con:10,int:10,wis:10,cha:10},saveProficiencies:[],skillProficiencies:[],skillExpertise:[],
hpCurrent:null,hpTemp:0,ac:null,speed:"30 ft",attacks:[],inventory:[],preparedSpells:[],deathSaves:{success:0,failure:0}});
const esc=v=>String(v??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[c]));
const toast=t=>{const e=$("toast");e.textContent=t;e.classList.add("show");clearTimeout(toast.t);toast.t=setTimeout(()=>e.classList.remove("show"),2200)};
const manifest=()=>manifestEntries();
const list=(t,q="")=>filterEntities(t,character.edition,character.content,q);
const labelMeta=x=>`${hb(x)?"Homebrew":"Oficial"} · ${x?.edition||character.edition}${x?.source?" · "+x.source:""}`;
const sourceTag=x=>`<span class="tag ${hb(x)?"brew":"official"}">${hb(x)?"HOMEBREW":"OFICIAL"}${x?.source?` · ${esc(x.source)}`:""}</span>`;
const titleOf=x=>String(x?.name||"Sem nome");
const typeLabel=t=>({class:"Classe",subclass:"Subclasse",race:"Espécie/Raça",background:"Background",spell:"Magia",item:"Item",feat:"Talento",classFeature:"Característica",subclassFeature:"Característica"}[normType(t)]||t);

function richText(v){
 const out=[];
 const inline=s=>String(s).replace(/\{@(b|bold|i|italic|u|note|dc|dice|damage|hit|atk|chance|condition|skill|spell|item|race|class|creature|book|link)\s+([^}|]+)(?:\|[^}]*)?\}/gi,"$2").replace(/\{@[^}]+\}/g,"");
 const walk=x=>{if(x==null)return;if(typeof x==="string"){out.push(`<p>${esc(inline(x))}</p>`);return}
  if(Array.isArray(x)){out.push("<ul>");x.forEach(y=>{out.push("<li>");walk(y);out.push("</li>")});out.push("</ul>");return}
  if(typeof x!=="object")return;
  if(x.name&&x.entries){out.push(`<h3>${esc(inline(x.name))}</h3>`);walk(x.entries);return}
  if(x.type==="table"&&Array.isArray(x.rows)){out.push("<table><tbody>");if(x.colLabels)out.push("<tr>"+x.colLabels.map(h=>`<th>${esc(inline(h))}</th>`).join("")+"</tr>");x.rows.forEach(r=>out.push("<tr>"+r.map(c=>`<td>${esc(inline(typeof c==="string"?c:JSON.stringify(c)))}</td>`).join("")+"</tr>"));out.push("</tbody></table>");return}
  if(x.entries)walk(x.entries);else if(x.items)walk(x.items);else if(x.entry)walk(x.entry);else if(x.desc)walk(x.desc);
 };
 walk(v);return out.join("")||"<p class='muted'>Não há descrição estruturada disponível para este registro.</p>";
}
function plain(v){const d=document.createElement("div");d.innerHTML=richText(v);return d.textContent.replace(/\s+/g," ").trim()}
async function records(e){return e?getRecordArrays(e):[]}
async function firstRecord(e){const a=await records(e);return a.find(r=>String(r.name||"").toLowerCase()===String(e?.name||"").toLowerCase())||a[0]||null}
function descriptionOf(r,e){return r?.entries||r?.desc||r?.description||r?.fluff||r?.traits||r?.featureEntries||e?.description||""}
function classMatches(x,c){
 if(!c)return false;
 const n=String(c.name||"").toLowerCase(),cn=String(x.className||x.class||x.classNameText||"").toLowerCase();
 const cs=String(c.source||"").toLowerCase(),xs=String(x.classSource||"").toLowerCase();
 return (!cn||cn===n||cn.includes(n))&&(!cs||!xs||cs===xs);
}
function selectedText(type){return refs[type]?titleOf(refs[type]):"Escolher…"}

async function updateChoice(type){
 const e=refs[type], value=$(`choice-${type}-value`),meta=$(`choice-${type}-meta`),prev=$(`${type}-preview`),card=$(`choice-${type}`);
 if(!e){value.textContent=type==="subclass"?"Escolha a classe primeiro":"Escolher…";meta.textContent=type==="subclass"?"—":"Nenhuma opção selecionada";prev.textContent=type==="subclass"?"A lista será filtrada pela classe escolhida.":"Escolha uma opção para começar.";card.classList.remove("selected");return}
 value.textContent=titleOf(e);meta.textContent=labelMeta(e);card.classList.add("selected");
 const r=await firstRecord(e);prev.textContent=plain(descriptionOf(r,e)).slice(0,280)||"Sem descrição estruturada.";
}
async function refreshChoices(){
 refs.race=manifest().find(x=>x.id===character.raceId)||null;
 refs.class=manifest().find(x=>x.id===character.classId)||null;
 refs.subclass=manifest().find(x=>x.id===character.subclassId)||null;
 refs.background=manifest().find(x=>x.id===character.backgroundId)||null;
 for(const t of ["race","class","subclass","background"])await updateChoice(t);
 $("head-class").textContent=refs.class?`${titleOf(refs.class)}${refs.subclass?" · "+titleOf(refs.subclass):""}`:"—";
 $("head-background").textContent=titleOf(refs.background);
 $("head-race").textContent=titleOf(refs.race);
 await recalc();
}
function filteredPicker(type,q){
 if(type==="subclass"){
   if(!refs.class)return [];
   return manifest().filter(x=>normType(x.type)==="subclass"&&String(x.edition||"")===String(character.edition)&&(!character.content||character.content==="all"||(character.content==="official"&&!hb(x))||(character.content==="homebrew"&&hb(x)))&&classMatches(x,refs.class)&&(!q||titleOf(x).toLowerCase().includes(q.toLowerCase())));
 }
 return list(type,q);
}
async function openPicker(type){
 pickerType=type;
 if(type==="subclass"&&!refs.class){toast("Escolha a classe primeiro.");return}
 const modal=$("modal"),content=$("modal-content");
 content.innerHTML=`<div class="modal-title"><div><span class="eyebrow">ESCOLHER</span><h2>${typeLabel(type)}</h2></div></div>
 <div class="picker-controls"><input id="picker-search" placeholder="Pesquisar ${typeLabel(type).toLowerCase()}…"><div class="filter-pills"><button class="active" data-pfilter="all">Todos</button><button data-pfilter="official">Oficial</button><button data-pfilter="homebrew">Homebrew</button></div></div>
 <div id="picker-results" class="picker-grid"></div>`;
 modal.classList.remove("hidden");
 const render=()=>{const q=$("picker-search").value.trim();let arr=filteredPicker(type,q);const pf=content.querySelector(".filter-pills .active")?.dataset.pfilter||"all";if(pf==="official")arr=arr.filter(x=>!hb(x));if(pf==="homebrew")arr=arr.filter(x=>hb(x));renderPicker(arr.slice(0,160));};
 $("picker-search").addEventListener("input",render);
 content.querySelectorAll("[data-pfilter]").forEach(b=>b.addEventListener("click",()=>{content.querySelectorAll("[data-pfilter]").forEach(x=>x.classList.remove("active"));b.classList.add("active");render()}));
 render();setTimeout(()=>$("picker-search").focus(),50);
}
async function renderPicker(arr){
 const box=$("picker-results"); if(!arr.length){box.innerHTML=`<div class="empty">Nenhum resultado encontrado.</div>`;return}
 box.innerHTML=arr.map(x=>`<button class="pick-card" data-id="${esc(x.id)}"><div class="pick-top"><strong>${esc(titleOf(x))}</strong>${sourceTag(x)}</div><div class="pick-meta">${esc(labelMeta(x))}</div><div class="pick-desc" data-desc="${esc(x.id)}">Carregando descrição…</div></button>`).join("");
 for(const b of box.querySelectorAll(".pick-card")){const e=manifest().find(x=>x.id===b.dataset.id);firstRecord(e).then(r=>{const d=b.querySelector(".pick-desc");if(d)d.textContent=plain(descriptionOf(r,e)).slice(0,150)||"Sem descrição estruturada.";});b.addEventListener("click",async()=>{await selectRef(e);$("modal").classList.add("hidden")})}
}
async function selectRef(e){
 const t=pickerType;if(!e)return;
 character[`${t}Id`]=e.id;refs[t]=e;
 if(t==="class"){character.subclassId="";refs.subclass=null}
 await refreshChoices();
 saveCharacter(character);
 toast(`${titleOf(e)} selecionado.`);
}
function openInfo(type){const e=refs[type];if(!e){toast("Nada selecionado.");return}openEntityModal(e)}
async function openEntityModal(e){
 const r=await firstRecord(e),d=descriptionOf(r,e);
 $("modal-content").innerHTML=`<div class="modal-title"><div><span class="eyebrow">${esc(typeLabel(e.type))}</span><h2>${esc(titleOf(e))}</h2><div>${sourceTag(e)} <span class="tag edition">${esc(e.edition||character.edition)}</span></div></div></div><div class="modal-body">${richText(d)}</div>`;
 $("modal").classList.remove("hidden");
}

function renderAbilities(){
 $("ability-grid").innerHTML=ABILITIES.map(a=>`<div class="ability-box"><span>${ABILITY_NAMES[a]}</span><b>${character.scores[a]}</b><em>${fmt(mod(character.scores[a]))}</em></div>`).join("");
 $("ability-editor").innerHTML=ABILITIES.map(a=>`<label class="ability-edit"><span>${ABILITY_NAMES[a]}</span><input data-ability="${a}" type="number" min="1" max="30" value="${character.scores[a]}"><b>${fmt(mod(character.scores[a]))}</b></label>`).join("");
 $("ability-editor").querySelectorAll("input").forEach(i=>i.addEventListener("input",()=>{character.scores[i.dataset.ability]=Number(i.value)||10;recalc()}));
}
function chosenAbility(cls){
 const c=classInfo();
 const candidates=[c.spellcastingAbility,c.spellcastingAbilityKey,c.spellcasting?.ability,c.spellcasting?.abilityKey,c.spellcastingAbilityId];
 for(const v of candidates){const k=abilityKey(v);if(k)return k}
 const txt=JSON.stringify(c).toLowerCase();
 for(const k of ABILITIES)if(txt.includes(`"${k}"`))return k;
 return null;
}
function classInfo(){return refs.class?details.classRec||{}:{}}
function raceInfo(){return refs.race?details.raceRec||{}:{}}
function inferHP(){
 const c=classInfo(),hd=Number(c.hitDice||c.hd?.faces||c.hd?.number||0)||8;
 const base=hpAverage(hd)+(Number(character.scores.con)-10>>1);
 const extra=Math.max(0,Number(character.level)-1)*(Math.floor(hd/2)+1+mod(character.scores.con));
 return Math.max(1,base+extra);
}
function calc(){
 const lvl=Number(character.level)||1,pb=proficiency(lvl);
 const init=mod(character.scores.dex),passive=10+mod(character.scores.wis)+(character.skillProficiencies.includes("perception")?pb:0)+(character.skillExpertise.includes("perception")?pb:0);
 const hp=inferHP(), ac=Number(character.ac)||10+mod(character.scores.dex),speed=character.speed||"30 ft";
 const sa=chosenAbility(refs.class);const dc=sa?spellDc(pb,mod(character.scores[sa])):null,atk=sa?spellAttack(pb,mod(character.scores[sa])):null;
 return {lvl,pb,init,passive,hp,ac,speed,sa,dc,atk}
}
async function recalc(){
 if(!character)return;
 details.classRec=await firstRecord(refs.class);details.raceRec=await firstRecord(refs.race);details.subclassRec=await firstRecord(refs.subclass);details.backgroundRec=await firstRecord(refs.background);
 const c=calc();renderAbilities();
 $("v-ac").textContent=c.ac;$("v-init").textContent=fmt(c.init);$("v-speed").textContent=c.speed;$("v-pb").textContent=fmt(c.pb);$("v-passive").textContent=c.passive;
 $("v-spell-dc").textContent=c.dc??"—";$("v-spell-atk").textContent=c.atk!=null?fmt(c.atk):"—";$("v-hp-max").textContent=c.hp;
 $("hp-current").value=character.hpCurrent==null?c.hp:character.hpCurrent;$("hp-temp").value=character.hpTemp||0;
 $("combat-ac").textContent=c.ac;$("combat-init").textContent=fmt(c.init);$("combat-speed").textContent=c.speed;$("combat-pb").textContent=fmt(c.pb);
 $("ac-input").value=character.ac??"";$("speed-input").value=character.speed||"30 ft";
 renderSaves(c);renderSkills(c);renderIdentity();renderAttacks();renderFeatures();renderSpells();renderInventory();renderProficiencies();renderDeath();
}
function renderSaves(c){
 $("save-list").innerHTML=ABILITIES.map(a=>{const ok=character.saveProficiencies.includes(a),v=mod(character.scores[a])+(ok?c.pb:0);return `<label class="check-row"><input type="checkbox" data-save="${a}" ${ok?"checked":""}><span>${ABILITY_NAMES[a]}</span><b>${fmt(v)}</b></label>`}).join("");
 $("save-list").querySelectorAll("[data-save]").forEach(i=>i.addEventListener("change",()=>{toggleIn(character.saveProficiencies,i.dataset.save,i.checked);recalc()}));
}
function renderSkills(c){
 $("skill-list").innerHTML=SKILLS.map(([k,n,a])=>{const p=character.skillProficiencies.includes(k),ex=character.skillExpertise.includes(k),v=mod(character.scores[a])+c.pb*(ex?2:p?1:0);return `<label class="skill-row"><input type="checkbox" data-skill="${k}" ${p?"checked":""}><span>${n}</span><b>${fmt(v)}</b>${ex?'<small>EXP</small>':""}</label>`}).join("");
 $("skill-list").querySelectorAll("[data-skill]").forEach(i=>i.addEventListener("change",()=>{toggleIn(character.skillProficiencies,i.dataset.skill,i.checked);recalc()}));
}
function renderProficiencies(){$("proficiency-editor").innerHTML=`<p class="muted">Marque testes e perícias na ficha. Especialização pode ser aplicada pelo botão de detalhes quando adicionarmos escolhas específicas do banco.</p>`}
function toggleIn(a,v,on){const i=a.indexOf(v);if(on&&i<0)a.push(v);if(!on&&i>=0)a.splice(i,1)}
function renderIdentity(){
 const rows=[["Espécie",refs.race],["Classe",refs.class],["Subclasse",refs.subclass],["Background",refs.background]];
 $("identity").innerHTML=rows.map(([k,e])=>`<div class="identity-row"><span>${k}</span><strong>${e?esc(titleOf(e)):"—"}</strong>${e?sourceTag(e):""}</div>`).join("");
}
function renderAttacks(){
 const arr=character.attacks||[];
 $("attacks").innerHTML=(arr.length?arr.map((a,i)=>`<div class="attack-row"><input data-a="name" data-i="${i}" value="${esc(a.name||"")}"><input data-a="bonus" data-i="${i}" value="${esc(a.bonus||"")}"><input data-a="damage" data-i="${i}" value="${esc(a.damage||"")}"><input data-a="notes" data-i="${i}" value="${esc(a.notes||"")}"><button class="remove-btn no-print" data-remove-attack="${i}">×</button></div>`).join(""):`<div class="empty">Nenhum ataque adicionado.</div>`);
 $("attacks").querySelectorAll("[data-a]").forEach(i=>i.addEventListener("input",()=>{character.attacks[Number(i.dataset.i)][i.dataset.a]=i.value;saveCharacter(character)}));
 $("attacks").querySelectorAll("[data-remove-attack]").forEach(b=>b.addEventListener("click",()=>{character.attacks.splice(Number(b.dataset.removeAttack),1);renderAttacks()}));
}
async function renderFeatures(){
 const box=$("feature-list");box.innerHTML=`<div class="empty">Carregando características…</div>`;
 let groups=[];
 if(refs.class)groups.push(["CLASSE",await findClassFeatures(refs.class,Number(character.level))]);
 if(refs.subclass)groups.push(["SUBCLASSE",await findSubclassFeatures(refs.subclass,Number(character.level))]);
 if(refs.race){const r=await firstRecord(refs.race);const f=(r?.traits||r?.entries||r?.features||[]);if(f.length)groups.push(["ESPÉCIE / RAÇA",Array.isArray(f)?f.map((x,i)=>({name:x.name||`Característica ${i+1}`,entries:x.entries||x})):[]])}
 box.innerHTML=groups.filter(g=>g[1]?.length).map(([name,arr])=>`<section class="feature-group"><h3>${name}</h3>${arr.map(f=>`<article class="feature"><div><b>${esc(f.name||"Característica")}</b><span>Nível ${esc(f.level||"—")}</span></div><div>${richText(f.entries||f.desc||f.description)}</div></article>`).join("")}</section>`).join("")||`<div class="empty">Escolha uma classe/espécie para carregar as características.</div>`;
}

function spellOwnerMatch(spell,c,sub){
 const classes=spell?.classes;
 const cn=String(c?.name||"").toLowerCase(), cs=String(c?.source||"").toLowerCase();
 if(classes){
  const text=JSON.stringify(classes).toLowerCase();
  if(text.includes(cn) && (!cs||text.includes(cs)))return true;
 }
 const arr=[spell.className,spell.class,spell.classNameText].filter(Boolean).map(String).join(" ").toLowerCase();
 if(arr&&(arr.includes(cn)))return true;
 if(sub){
  const sn=String(sub.name||"").toLowerCase(), st=JSON.stringify(spell?.classes||spell?.subclasses||{}).toLowerCase();
  if(sn&&st.includes(sn))return true;
 }
 return false;
}
function spellLevel(sp){return Number(sp.level??sp.spellLevel??0)}
async function allSpellsForClass(){
 if(!refs.class)return [];
 const candidates=list("spell","");
 const out=[];
 for(const e of candidates.slice(0,12000)){
  const rs=await records(e);
  for(const r of rs){
   if(spellOwnerMatch(r,refs.class,refs.subclass)||spellOwnerMatch(e,refs.class,refs.subclass)){out.push({...r,__manifest:e});break}
  }
 }
 const seen=new Set();return out.filter(s=>{const k=`${s.name}|${s.source||""}`;if(seen.has(k))return false;seen.add(k);return true}).sort((a,b)=>spellLevel(a)-spellLevel(b)||String(a.name).localeCompare(String(b.name),"pt-BR"));
}
async function renderSpells(){
 const box=$("spellbook"),c=calc(),ab=c.sa;$("spell-ability").textContent=ab?ABILITY_NAMES[ab]:"—";$("spell-dc-big").textContent=c.dc??"—";$("spell-atk-big").textContent=c.atk!=null?fmt(c.atk):"—";
 if(!refs.class){$("spell-count").textContent="0";box.innerHTML=`<div class="paper-card empty">Escolha uma classe para carregar a lista de magias.</div>`;return}
 box.innerHTML=`<div class="paper-card loading">Carregando lista de magias de ${esc(titleOf(refs.class))}…</div>`;
 const spells=await allSpellsForClass();$("spell-count").textContent=spells.length;
 const groups=Array.from({length:10},(_,i)=>spells.filter(s=>spellLevel(s)===i));
 box.innerHTML=groups.map((arr,lvl)=>arr.length?`<section class="paper-card spell-level"><div class="spell-level-head"><h3>${lvl===0?"Truques":`${lvl}º nível`}</h3><span>${arr.length} magias</span></div><div class="spell-list">${arr.map((s,i)=>{const key=`${s.name}|${s.source||s.__manifest?.source||""}`;const checked=character.preparedSpells.includes(key);return `<label class="spell-line"><input type="checkbox" data-spell="${esc(key)}" ${checked?"checked":""}><span class="spell-dot">${checked?"●":"○"}</span><strong>${esc(s.name)}</strong><span class="spell-meta">${sourceTag(s.__manifest||s)} ${s.school?` · ${esc(s.school)}`:""} ${s.time?` · ${esc(s.time)}`:""}</span><button type="button" class="spell-info" data-spell-info="${esc(s.__manifest?.id||"")}">ⓘ</button></label>`}).join("")}</div></section>`:"").join("")||`<div class="paper-card empty">Nenhuma magia foi associada a esta classe pelo formato do banco.</div>`;
 box.querySelectorAll("[data-spell]").forEach(i=>i.addEventListener("change",()=>{toggleIn(character.preparedSpells,i.dataset.spell,i.checked);saveCharacter(character);i.nextElementSibling.textContent=i.checked?"●":"○"}));
 box.querySelectorAll("[data-spell-info]").forEach(b=>b.addEventListener("click",()=>{const e=manifest().find(x=>x.id===b.dataset.spellInfo);if(e)openEntityModal(e)}));
}

function equipmentKind(e,r){
 const s=JSON.stringify({...e,...r}).toLowerCase();
 if(/armor|armadura|shield|escudo/.test(s))return /shield|escudo/.test(s)?"shields":"armor";
 if(/weapon|meleeweapon|rangedweapon|martial|simple weapon|weapon/.test(s))return "weapons";
 return "gear";
}
function weaponFamily(s){s=String(s).toLowerCase();if(/sword|espada/.test(s))return"sword";if(/bow|arco/.test(s))return"bow";if(/hammer|martelo/.test(s))return"hammer";if(/axe|machado/.test(s))return"axe";if(/mace|maça|maca/.test(s))return"mace";if(/dagger|adaga/.test(s))return"dagger";return""}
async function equipmentEntities(){
 const arr=list("item","");
 const out=[];
 for(const e of arr.slice(0,12000)){const r=await firstRecord(e);out.push({e,r,kind:equipmentKind(e,r),family:weaponFamily(JSON.stringify({...e,...r}))})}
 return out;
}
async function renderInventory(){
 const arr=character.inventory||[];
 $("inventory-list").innerHTML=arr.length?arr.map((x,i)=>`<div class="inventory-row"><div><strong>${esc(x.name)}</strong><small>${esc(x.meta||"")}</small></div><input type="number" min="0" value="${Number(x.qty)||1}" data-qty="${i}"><button class="remove-btn no-print" data-remove-inv="${i}">×</button></div>`).join(""):`<div class="empty">Seu inventário está vazio. Abra uma categoria acima para adicionar itens.</div>`;
 $("inventory-list").querySelectorAll("[data-qty]").forEach(i=>i.addEventListener("input",()=>{character.inventory[Number(i.dataset.qty)].qty=Number(i.value)||0;saveCharacter(character)}));
 $("inventory-list").querySelectorAll("[data-remove-inv]").forEach(b=>b.addEventListener("click",()=>{character.inventory.splice(Number(b.dataset.removeInv),1);renderInventory()}));
}
async function renderEquipmentCatalog(){
 const box=$("equipment-list"),q=$("equipment-search").value.trim().toLowerCase(),wf=$("weapon-filter").value;
 box.innerHTML=`<div class="empty">Carregando catálogo…</div>`;
 let arr=await equipmentEntities();
 if(eqCat!=="all"&&eqCat!=="inventory")arr=arr.filter(x=>x.kind===eqCat);
 if(wf)arr=arr.filter(x=>x.family===wf);
 if(q)arr=arr.filter(x=>`${titleOf(x.e)} ${JSON.stringify(x.r)} ${x.e.source||""}`.toLowerCase().includes(q));
 arr=arr.slice(0,240);
 box.innerHTML=arr.length?arr.map(x=>`<article class="catalog-card"><div class="pick-top"><strong>${esc(titleOf(x.e))}</strong>${sourceTag(x.e)}</div><div class="pick-meta">${esc(labelMeta(x.e))} · ${typeLabel(x.kind)}</div><p>${esc(plain(descriptionOf(x.r,x.e)).slice(0,180)||"Sem descrição.")}</p><div class="catalog-actions"><button data-add-item="${esc(x.e.id)}">+ Inventário</button><button data-info-item="${esc(x.e.id)}">ⓘ</button></div></article>`).join(""):`<div class="empty">Nenhum item encontrado.</div>`;
 box.querySelectorAll("[data-add-item]").forEach(b=>b.addEventListener("click",()=>addInventory(b.dataset.addItem)));
 box.querySelectorAll("[data-info-item]").forEach(b=>b.addEventListener("click",()=>{const e=manifest().find(x=>x.id===b.dataset.infoItem);if(e)openEntityModal(e)}));
}
function addInventory(id){const e=manifest().find(x=>x.id===id);if(!e)return;const f=character.inventory.find(x=>x.id===id);if(f)f.qty=(f.qty||1)+1;else character.inventory.push({id,name:titleOf(e),qty:1,meta:labelMeta(e)});saveCharacter(character);renderInventory();toast(`${titleOf(e)} adicionado.`)}
async function equipmentTab(){
 $("inventory-panel").classList.toggle("hidden",eqCat!=="inventory");$("equipment-catalog").classList.toggle("hidden",eqCat==="inventory");
 if(eqCat!=="inventory")await renderEquipmentCatalog();else await renderInventory();
}

function renderDeath(){
 const d=character.deathSaves||{success:0,failure:0};document.querySelectorAll("[data-death]").forEach(b=>{const k=b.dataset.death[0]==="s"?"success":"failure",i=Number(b.dataset.death[1]);b.textContent=i<d[k]?"●":"○";b.classList.toggle("on",i<d[k]);b.onclick=()=>{d[k]=i<d[k]?i:i+1;if(d[k]>3)d[k]=0;character.deathSaves=d;saveCharacter(character);renderDeath()}});
}
function applyLoaded(c){character={...fresh(),...c,scores:{...fresh().scores,...(c?.scores||{})},deathSaves:{...fresh().deathSaves,...(c?.deathSaves||{})},inventory:Array.isArray(c?.inventory)?c.inventory:[],preparedSpells:Array.isArray(c?.preparedSpells)?c.preparedSpells:[]};$("edition").value=character.edition;$("content").value=character.content;$("name").value=character.name;$("level").value=character.level;$("xp").value=character.xp;refreshChoices()}
function setup(){
 $("edition").addEventListener("change",()=>{character.edition=$("edition").value;character.classId=character.subclassId=character.raceId=character.backgroundId="";refs={class:null,subclass:null,race:null,background:null};refreshChoices();saveCharacter(character)});
 $("content").addEventListener("change",()=>{character.content=$("content").value;saveCharacter(character)});
 $("name").addEventListener("input",()=>{character.name=$("name").value});
 $("level").addEventListener("input",()=>{character.level=Math.max(1,Math.min(20,Number($("level").value)||1));recalc()});
 $("xp").addEventListener("input",()=>character.xp=Number($("xp").value)||0);
 $("hp-current").addEventListener("input",()=>character.hpCurrent=Number($("hp-current").value)||0);
 $("hp-temp").addEventListener("input",()=>character.hpTemp=Number($("hp-temp").value)||0);
 $("ac-input").addEventListener("input",()=>{character.ac=Number($("ac-input").value)||null;recalc()});
 $("speed-input").addEventListener("input",()=>{character.speed=$("speed-input").value||"30 ft";recalc()});
 document.querySelectorAll(".change-choice").forEach(b=>b.addEventListener("click",()=>openPicker(b.dataset.pick)));
 document.querySelectorAll(".tiny-info").forEach(b=>b.addEventListener("click",()=>openInfo(b.dataset.info)));
 document.querySelectorAll(".tab").forEach(b=>b.addEventListener("click",async()=>{document.querySelectorAll(".tab").forEach(x=>x.classList.remove("active"));b.classList.add("active");document.querySelectorAll(".tab-page").forEach(x=>x.classList.remove("active"));$(`tab-${b.dataset.tab}`).classList.add("active");if(b.dataset.tab==="equipment")await equipmentTab();if(b.dataset.tab==="spells")await renderSpells();if(b.dataset.tab==="features")await renderFeatures()}));
 document.querySelectorAll("[data-eqcat]").forEach(b=>b.addEventListener("click",async()=>{document.querySelectorAll("[data-eqcat]").forEach(x=>x.classList.remove("active"));b.classList.add("active");eqCat=b.dataset.eqcat;await equipmentTab()}));
 $("equipment-search").addEventListener("input",()=>{if(eqCat!=="inventory")renderEquipmentCatalog()});$("weapon-filter").addEventListener("change",()=>{if(eqCat!=="inventory")renderEquipmentCatalog()});
 $("compendium-search").addEventListener("input",renderCompendium);$("compendium-type").addEventListener("change",renderCompendium);
 $("collapse-creator").addEventListener("click",()=>{$("creator").classList.toggle("collapsed");$("collapse-creator").textContent=$("creator").classList.contains("collapsed")?"Expandir":"Recolher"});
 $("add-attack").addEventListener("click",()=>{character.attacks.push({name:"",bonus:"",damage:"",notes:""});renderAttacks()});
 $("save-character").addEventListener("click",()=>{saveCharacter(character);toast("Personagem salvo neste navegador.")});
 $("export-character").addEventListener("click",()=>downloadCharacter(character));
 $("new-character").addEventListener("click",()=>{if(confirm("Começar um novo personagem?")){clearCharacter();applyLoaded(fresh());toast("Novo personagem.")}});
 $("print-character").addEventListener("click",()=>window.print());
 $("import-character").addEventListener("change",async e=>{try{applyLoaded(await readCharacterFile(e.target.files[0]));toast("Personagem importado.")}catch{toast("Arquivo inválido.")}});
 $("modal-close").addEventListener("click",()=>$("modal").classList.add("hidden"));$("modal").addEventListener("click",e=>{if(e.target===$("modal"))$("modal").classList.add("hidden")});
}
function renderCompendium(){
 const q=$("compendium-search").value.trim().toLowerCase(),t=$("compendium-type").value;
 let arr=manifest().filter(e=>(t==="all"||normType(e.type)===t)&&(!q||`${titleOf(e)} ${e.source||""}`.toLowerCase().includes(q))).slice(0,180);
 $("compendium-results").innerHTML=arr.map(e=>`<article class="catalog-card"><div class="pick-top"><strong>${esc(titleOf(e))}</strong>${sourceTag(e)}</div><div class="pick-meta">${esc(typeLabel(e.type))} · ${esc(labelMeta(e))}</div><div class="catalog-actions"><button data-comp-info="${esc(e.id)}">ⓘ Ver detalhes</button></div></article>`).join("")||`<div class="empty">Nenhum resultado.</div>`;
 $("compendium-results").querySelectorAll("[data-comp-info]").forEach(b=>b.addEventListener("click",()=>{const e=manifest().find(x=>x.id===b.dataset.compInfo);if(e)openEntityModal(e)}));
}
async function start(){
 character=loadCharacter()||fresh();setup();
 try{const c=await initDatabase();const s=stats();$("db-status").textContent=`Banco sincronizado · ${s.entities.toLocaleString("pt-BR")} registros`;$("db-count").textContent=`${s.entities.toLocaleString("pt-BR")} registros · ${s.official.toLocaleString("pt-BR")} oficiais · ${s.homebrew.toLocaleString("pt-BR")} Homebrew`;applyLoaded(character);renderCompendium()}
 catch(e){console.error(e);$("db-status").textContent="Erro ao carregar banco";$("db-count").textContent="Verifique a pasta data/ e o GitHub Pages";applyLoaded(character)}
}
start();