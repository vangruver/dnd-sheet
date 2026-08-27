const DB = window.DND_DB;
const state = {
  abilities: {Força:10, Destreza:10, Constituição:10, Inteligência:10, Sabedoria:10, Carisma:10},
  skills: {}, spells: {}, inventory: [], tab:"weapons"
};
const $ = s => document.querySelector(s);
const esc = s => String(s ?? "").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const mod = n => Math.floor((Number(n||10)-10)/2);
const prof = lvl => 2 + Math.floor((Number(lvl||1)-1)/4);
function toast(msg){const t=$("#toast");t.textContent=msg;t.style.display="block";setTimeout(()=>t.style.display="none",1800)}
function save(){localStorage.setItem("dndSheetState",JSON.stringify(collect()));toast("Ficha salva.");}
function collect(){
  const data={};
  document.querySelectorAll("[data-field]").forEach(e=>data[e.dataset.field]=e.value);
  data.abilities={}; document.querySelectorAll(".ability input").forEach(e=>data.abilities[e.dataset.ability]=e.value);
  data.skills={}; document.querySelectorAll(".skill input[type=checkbox]").forEach(e=>data.skills[e.dataset.skill]=e.checked);
  data.spells={}; document.querySelectorAll(".spell input").forEach(e=>data.spells[e.dataset.spell]=e.checked);
  data.inventory=[...document.querySelectorAll(".inv-row")].map(r=>({qty:r.querySelector(".qty")?.value||"",name:r.querySelector(".iname")?.value||"",weight:r.querySelector(".weight")?.value||""}));
  return data;
}
function loadSaved(){
  try{const d=JSON.parse(localStorage.getItem("dndSheetState")||"null");if(!d)return;
    document.querySelectorAll("[data-field]").forEach(e=>{if(d[e.dataset.field]!==undefined)e.value=d[e.dataset.field]});
    if(d.abilities) Object.entries(d.abilities).forEach(([a,v])=>{const e=document.querySelector(`[data-ability="${CSS.escape(a)}"]`);if(e)e.value=v});
    if(d.skills)Object.entries(d.skills).forEach(([s,v])=>{const e=document.querySelector(`[data-skill="${CSS.escape(s)}"]`);if(e)e.checked=v});
  }catch(e){localStorage.removeItem("dndSheetState")}
}
function renderAbilities(){
  $("#abilities").innerHTML=DB.abilities.map(a=>`<div class="ability"><strong>${a}</strong><input type="number" min="1" max="30" data-ability="${a}" value="${state.abilities[a]}"><div class="mod" id="mod-${a}">+0</div></div>`).join("");
  document.querySelectorAll(".ability input").forEach(e=>e.addEventListener("input",()=>{state.abilities[e.dataset.ability]=e.value;updateDerived()}));
}
function updateDerived(){
  const lvl=Number($("#level").value||1);
  DB.abilities.forEach(a=>{const e=$(`#mod-${a}`);if(e)e.textContent=(mod(document.querySelector(`[data-ability="${CSS.escape(a)}"]`)?.value)+"").replace("-","−").replace(/^0$/,"+0").replace(/^([0-9])$/,"+$1")});
  $("#proficiency").value="+"+prof(lvl);
  const dex=mod(document.querySelector('[data-ability="Destreza"]')?.value);
  $("#initiative").value=(dex>=0?"+":"")+dex;
  const cls=DB.classes[$("#class").value]; if(cls)$("#speed").value=(cls.speed*5)+" pés";
}
function renderClasses(){
  $("#class").innerHTML='<option value="">Selecione...</option>'+Object.keys(DB.classes).map(c=>`<option>${c}</option>`).join("");
  $("#class").addEventListener("change",renderClassDetails);
}
function renderClassDetails(){
  const c=DB.classes[$("#class").value];
  if(!c){$("#classInfo").textContent="Selecione uma classe.";$("#classChoices").innerHTML="";renderSkills();return}
  $("#classInfo").innerHTML=`<strong>${esc($("#class").value)}</strong> — ${esc(c.desc)}<br><small>Dado de vida: ${c.hitDie}. Perícias para escolher: ${c.skills}.</small>`;
  $("#hitDice").value=`${$("#level").value||1}${c.hitDie}`;
  renderSkills(); updateDerived(); renderSpells();
  const opts=c.skillOptions.map(s=>`<label><input type="checkbox" data-choice-skill="${esc(s)}"> ${esc(s)}</label>`).join("");
  $("#classChoices").innerHTML=`<div class="choice-group"><h3>Escolha ${c.skills} perícia(s)</h3><div class="choice-options">${opts}</div><small>Ao marcar, a perícia é aplicada imediatamente à ficha.</small></div>`;
  document.querySelectorAll("[data-choice-skill]").forEach(e=>e.addEventListener("change",()=>{
    const chosen=[...document.querySelectorAll("[data-choice-skill]:checked")];
    if(e.checked && chosen.length>c.skills){e.checked=false;toast(`Esta classe permite ${c.skills} escolha(s).`);return}
    const sk=e.dataset.choiceSkill; state.skills[sk]=e.checked; renderSkills();
    document.querySelectorAll(`[data-choice-skill="${CSS.escape(sk)}"]`).forEach(x=>x.checked=e.checked);
  }));
}
function renderSkills(){
  const cls=DB.classes[$("#class").value]; const allowed=cls?.skillOptions||Object.keys(DB.skills);
  $("#skills").innerHTML=Object.entries(DB.skills).map(([s,a])=>{
    const ok=allowed.includes(s), checked=!!state.skills[s], b=mod(document.querySelector(`[data-ability="${CSS.escape(a)}"]`)?.value)+ (checked?prof($("#level").value):0);
    return `<div class="skill"><input type="checkbox" data-skill="${esc(s)}" ${checked?"checked":""} ${ok?"":"disabled"} title="${ok?"Proficiência":"Não disponível para esta classe"}"><div><strong>${esc(s)}</strong><div class="ability-name">${esc(a)}</div></div><div class="bonus">${b>=0?"+":""}${b}</div></div>`
  }).join("");
  document.querySelectorAll(".skill input").forEach(e=>e.addEventListener("change",()=>{state.skills[e.dataset.skill]=e.checked;renderSkills()}));
}
function renderSpells(){
  const cls=DB.classes[$("#class").value]; const spellcaster=!!cls?.spellcaster;
  const q=($("#spellSearch").value||"").toLowerCase(), lev=$("#spellLevelFilter").value;
  const all=DB.spells.filter(s=>(!q||s[0].toLowerCase().includes(q)||s[3].toLowerCase().includes(q))&&(!lev||s[1]===lev));
  $("#spells").innerHTML=spellcaster ? all.map(s=>`<div class="spell"><input type="checkbox" data-spell="${esc(s[0])}" ${state.spells[s[0]]?"checked":""}><div><strong>${esc(s[0])}</strong><small>${s[1]==="0"?"Truque":"Nível "+s[1]} · ${esc(s[2])}</small></div><span>○</span><div class="desc">${esc(s[3])}</div></div>`).join("")||"<p>Nenhuma magia encontrada.</p>" : "<p>Esta classe não possui lista de magias nesta ficha.</p>";
  document.querySelectorAll(".spell input").forEach(e=>e.addEventListener("change",()=>state.spells[e.dataset.spell]=e.checked));
}
function renderEquipment(){
  const key=state.tab;
  const arr=DB[key]||[];
  $("#equipment").innerHTML=`<div class="equipment-grid">${arr.map(x=>`<div class="equipment-item"><strong>${esc(x[0])}</strong><small>${esc(x[1])}${x[2]?" · "+esc(x[2]):""}${x[3]?" · "+esc(x[3]):""}</small><button class="add-eq" data-name="${esc(x[0])}">Adicionar</button></div>`).join("")}</div>`;
  document.querySelectorAll(".add-eq").forEach(b=>b.addEventListener("click",()=>{addInventory(b.dataset.name);toast("Item adicionado ao inventário.")}));
}
function addInventory(name="",qty="1",weight=""){
  state.inventory.push({qty,name,weight}); renderInventory();
}
function renderInventory(){
  const saved=state.inventory;
  $("#inventory").innerHTML=saved.map((x,i)=>`<div class="inv-row"><input class="qty" value="${esc(x.qty)}"><input class="iname" value="${esc(x.name)}"><input class="weight" value="${esc(x.weight)}" placeholder="peso"><button data-del="${i}">×</button></div>`).join("")||"<p class='hint'>Nenhum item no inventário.</p>";
  document.querySelectorAll(".inv-row input").forEach((e,i)=>e.addEventListener("input",()=>{const r=e.closest(".inv-row");state.inventory[i]={qty:r.querySelector(".qty").value,name:r.querySelector(".iname").value,weight:r.querySelector(".weight").value}}));
  document.querySelectorAll("[data-del]").forEach(b=>b.addEventListener("click",()=>{state.inventory.splice(Number(b.dataset.del),1);renderInventory()}));
}
function init(){
  $("#level").addEventListener("input",()=>{renderSkills();updateDerived();});
  ["spellSearch","spellLevelFilter"].forEach(id=>$(id).addEventListener("input",renderSpells));
  DB.abilities.forEach(()=>{});
  $("#spellLevelFilter").innerHTML='<option value="">Todos os níveis</option>'+Array.from({length:10},(_,i)=>`<option value="${i}">${i===0?"Truque":"Nível "+i}</option>`).join("");
  renderAbilities();renderClasses();renderSkills();renderSpells();renderEquipment();renderInventory();loadSaved();renderClassDetails();updateDerived();
  document.querySelectorAll("[data-tab]").forEach(b=>b.addEventListener("click",()=>{document.querySelectorAll("[data-tab]").forEach(x=>x.classList.remove("active"));b.classList.add("active");state.tab=b.dataset.tab;renderEquipment()}));
  $("#addInventory").addEventListener("click",()=>addInventory());
  $("#saveBtn").addEventListener("click",save);
  $("#clearBtn").addEventListener("click",()=>{if(confirm("Limpar a ficha?")){localStorage.removeItem("dndSheetState");location.reload()}});
  $("#printBtn").addEventListener("click",()=>window.print());
  $("#previewBtn").addEventListener("click",()=>{document.body.classList.toggle("pdf-preview");window.scrollTo({top:0,behavior:"smooth"});toast("Modo de visualização da ficha ativado. Use Imprimir para gerar PDF.")});
  $("#dbStatus").textContent="✓ Banco local carregado";
}
document.addEventListener("DOMContentLoaded",init);