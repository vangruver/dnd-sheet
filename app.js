(() => {
"use strict";

const DB = window.DND_DB || {};
const $ = (s) => document.querySelector(s);
const state = {
  ruleset: "2014",
  abilities: {Força:10, Destreza:10, Constituição:10, Inteligência:10, Sabedoria:10, Carisma:10},
  skills: {}, spells: {}, inventory: [], tab:"weapons"
};

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, c => ({
  "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"
}[c]));
const cssesc = (s) => (window.CSS && CSS.escape) ? CSS.escape(s) : String(s).replace(/["\\]/g,"\\$&");
const mod = (n) => Math.floor((Number(n || 10)-10)/2);
const prof = (lvl) => 2 + Math.floor((Number(lvl || 1)-1)/4);
const on = (el, event, fn) => { if (el) el.addEventListener(event, fn); };

function toast(msg){
  const t=$("#toast"); if(!t) return;
  t.textContent=msg; t.style.display="block";
  clearTimeout(window.__toastTimer);
  window.__toastTimer=setTimeout(()=>t.style.display="none",1800);
}

function getClass(){
  return DB.classes?.[$("#class")?.value] || null;
}

function save(){
  try {
    localStorage.setItem("dndSheetState", JSON.stringify(collect()));
    toast("Ficha salva.");
  } catch(e){ console.error(e); toast("Não foi possível salvar a ficha."); }
}

function collect(){
  const data={};
  document.querySelectorAll("[data-field]").forEach(e=>{
    if(e.id === "ruleset" || e.id === "class") data[e.dataset.field]=e.value;
    else data[e.dataset.field]=e.value;
  });
  data.abilities={};
  document.querySelectorAll(".ability input").forEach(e=>data.abilities[e.dataset.ability]=e.value);
  data.skills={};
  document.querySelectorAll(".skill input[type=checkbox]").forEach(e=>data.skills[e.dataset.skill]=e.checked);
  data.spells={};
  document.querySelectorAll(".spell input").forEach(e=>data.spells[e.dataset.spell]=e.checked);
  data.inventory=[...document.querySelectorAll(".inv-row")].map(r=>({
    qty:r.querySelector(".qty")?.value||"",
    name:r.querySelector(".iname")?.value||"",
    weight:r.querySelector(".weight")?.value||""
  }));
  data.ruleset=$("#ruleset")?.value || state.ruleset;
  data.class=$("#class")?.value || "";
  return data;
}

function loadSaved(){
  try{
    const d=JSON.parse(localStorage.getItem("dndSheetState")||"null");
    if(!d) return;
    state.ruleset=d.ruleset || "2014";
    if(d.abilities) Object.assign(state.abilities,d.abilities);
    if(d.skills) Object.assign(state.skills,d.skills);
    if(d.spells) Object.assign(state.spells,d.spells);
    if(Array.isArray(d.inventory)) state.inventory=d.inventory;
    document.querySelectorAll("[data-field]").forEach(e=>{
      if(d[e.dataset.field]!==undefined && e.id!=="class") e.value=d[e.dataset.field];
    });
    const rs=$("#ruleset"); if(rs) rs.value=state.ruleset;
    renderClasses(d.class || "");
    renderAbilities();
    renderSkills();
    renderClassDetails();
    renderSpells();
    renderInventory();
    updateDerived();
  }catch(e){ console.error("Falha ao carregar ficha:",e); }
}

function renderAbilities(){
  const box=$("#abilities"); if(!box) return;
  const abilities=DB.abilities || Object.keys(state.abilities);
  box.innerHTML=abilities.map(a=>`
    <div class="ability">
      <strong>${esc(a)}</strong>
      <input type="number" min="1" max="30" data-ability="${esc(a)}" value="${esc(state.abilities[a] ?? 10)}">
      <div class="mod" id="mod-${esc(a)}">+0</div>
    </div>`).join("");
  box.querySelectorAll(".ability input").forEach(e=>on(e,"input",()=>{
    state.abilities[e.dataset.ability]=e.value;
    updateDerived(); renderSkills();
  }));
}

function updateDerived(){
  const lvl=Number($("#level")?.value||1);
  (DB.abilities||Object.keys(state.abilities)).forEach(a=>{
    const e=$(`#mod-${cssesc(a)}`);
    if(!e) return;
    const m=mod(document.querySelector(`[data-ability="${cssesc(a)}"]`)?.value);
    e.textContent=m>=0?`+${m}`:`−${Math.abs(m)}`;
  });
  if($("#proficiency")) $("#proficiency").value=`+${prof(lvl)}`;
  const dex=mod(document.querySelector('[data-ability="Destreza"]')?.value);
  if($("#initiative")) $("#initiative").value=dex>=0?`+${dex}`:`−${Math.abs(dex)}`;
  const cls=getClass();
  if($("#speed") && cls) $("#speed").value=`${cls.speed*5} pés`;
  if($("#hitDice") && cls) $("#hitDice").value=`${$("#level")?.value||1}${cls.hitDie}`;
}

function renderRulesets(){
  const rs=$("#ruleset"); if(!rs) return;
  rs.innerHTML=`<option value="2014">D&D 5e — 2014</option><option value="2024">D&D 5e — 2024</option>`;
  rs.value=state.ruleset || "2014";
  on(rs,"change",()=>{
    state.ruleset=rs.value;
    const current=$("#class")?.value || "";
    renderClasses(current);
    renderClassDetails();
    renderSkills();
    renderSpells();
    renderEquipment();
    updateDerived();
    toast(`Regras ${rs.value} selecionadas.`);
  });
}

function renderClasses(preferred=""){
  const sel=$("#class"); if(!sel) return;
  const map=DB.rulesets?.[state.ruleset]?.classes || {};
  const names=Object.keys(map).length ? Object.keys(map) : Object.keys(DB.classes||{});
  sel.innerHTML='<option value="">Selecione...</option>'+names.map(c=>`<option value="${esc(c)}">${esc(c)}</option>`).join("");
  if(preferred && names.includes(preferred)) sel.value=preferred;
  on(sel,"change",renderClassDetails);
}

function renderClassDetails(){
  const box=$("#classInfo"), choices=$("#classChoices");
  const c=getClass();
  if(!box || !choices) return;
  if(!c){
    box.textContent="Selecione uma classe.";
    choices.innerHTML="";
    renderSkills();
    renderSpells();
    updateDerived();
    return;
  }
  box.innerHTML=`<strong>${esc($("#class").value)}</strong> — ${esc(c.desc || "Descrição indisponível.")}<br>
  <small>Dado de vida: ${esc(c.hitDie)} · Escolha ${esc(c.skills)} perícia(s) entre ${esc(c.skillOptions?.length||0)} disponíveis.</small>`;

  const opts=(c.skillOptions||[]).map(s=>`
    <label class="choice-option"><input type="checkbox" data-choice-skill="${esc(s)}" ${state.skills[s]?"checked":""}> ${esc(s)}</label>`).join("");
  choices.innerHTML=`<div class="choice-group">
    <h3>Perícias da classe</h3>
    <p class="hint">Marque até ${c.skills}. A escolha é aplicada automaticamente na ficha.</p>
    <div class="choice-options">${opts}</div>
  </div>`;

  choices.querySelectorAll("[data-choice-skill]").forEach(e=>on(e,"change",()=>{
    const chosen=[...choices.querySelectorAll("[data-choice-skill]:checked")];
    if(e.checked && chosen.length>c.skills){
      e.checked=false; toast(`Esta classe permite ${c.skills} escolha(s).`); return;
    }
    state.skills[e.dataset.choiceSkill]=e.checked;
    renderSkills();
    renderClassDetails();
  }));
  updateDerived();
  renderSpells();
}

function renderSkills(){
  const box=$("#skills"); if(!box) return;
  const cls=getClass();
  const allowed=cls?.skillOptions || Object.keys(DB.skills||{});
  const skills=Object.entries(DB.skills||{});
  box.innerHTML=skills.map(([s,a])=>{
    const ok=allowed.includes(s), checked=!!state.skills[s];
    const b=mod(document.querySelector(`[data-ability="${cssesc(a)}"]`)?.value)+(checked?prof($("#level")?.value):0);
    return `<div class="skill">
      <input type="checkbox" data-skill="${esc(s)}" ${checked?"checked":""} ${ok?"":"disabled"} title="${ok?"Proficiência":"Não disponível para esta classe"}">
      <div><strong>${esc(s)}</strong><div class="ability-name">${esc(a)}</div></div>
      <div class="bonus">${b>=0?"+":""}${b}</div>
    </div>`;
  }).join("") || "<p class='hint'>Nenhuma perícia disponível.</p>";
  box.querySelectorAll(".skill input").forEach(e=>on(e,"change",()=>{
    state.skills[e.dataset.skill]=e.checked;
    renderSkills();
    renderClassDetails();
  }));
}

function renderSpells(){
  const box=$("#spells"); if(!box) return;
  const cls=getClass();
  const spellcaster=!!cls?.spellcaster;
  const q=($("#spellSearch")?.value||"").toLowerCase().trim();
  const lev=$("#spellLevelFilter")?.value||"";
  const all=(DB.spells||[]).filter(s=>{
    const name=String(s[0]||"").toLowerCase(), desc=String(s[3]||"").toLowerCase();
    return (!q || name.includes(q)||desc.includes(q)) && (!lev || String(s[1])===lev);
  });
  if(!spellcaster){
    box.innerHTML="<p class='hint'>Selecione uma classe conjuradora para exibir a lista de magias.</p>";
    return;
  }
  box.innerHTML=all.map(s=>`
    <div class="spell">
      <input type="checkbox" data-spell="${esc(s[0])}" ${state.spells[s[0]]?"checked":""}>
      <div><strong>${esc(s[0])}</strong><small>${s[1]==="0"?"Truque":"Nível "+esc(s[1])} · ${esc(s[2]||"")}</small></div>
      <span class="spell-mark">○</span>
      <div class="desc">${esc(s[3]||"Descrição indisponível.")}</div>
    </div>`).join("") || "<p class='hint'>Nenhuma magia encontrada para este filtro.</p>";
  box.querySelectorAll(".spell input").forEach(e=>on(e,"change",()=>state.spells[e.dataset.spell]=e.checked));
}

function renderEquipment(){
  const box=$("#equipment"); if(!box) return;
  const key=state.tab;
  const arr=DB[key]||[];
  const filter=$("#equipmentCategory");
  if(filter){
    const cats=key==="weapons"
      ? ["Espadas","Arcos","Machados","Martelos","Bestas","Outras"]
      : key==="armor" ? ["Leves","Médias","Pesadas","Escudos"] : ["Aventura"];
    const old=filter.value;
    filter.innerHTML='<option value="">Todas</option>'+cats.map(c=>`<option value="${esc(c)}">${esc(c)}</option>`).join("");
    if(cats.includes(old)) filter.value=old;
  }
  const selected=filter?.value||"";
  const matches=(item)=>{
    if(!selected) return true;
    const n=String(item[0]).toLowerCase();
    if(key==="weapons"){
      if(selected==="Espadas") return /espada/.test(n);
      if(selected==="Arcos") return /arco/.test(n);
      if(selected==="Machados") return /machado/.test(n);
      if(selected==="Martelos") return /martelo|maça/.test(n);
      if(selected==="Bestas") return /besta/.test(n);
      return !/espada|arco|machado|martelo|maça|besta/.test(n);
    }
    if(key==="armor"){
      if(selected==="Leves") return item[1]==="Leve";
      if(selected==="Médias") return item[1]==="Média";
      if(selected==="Pesadas") return item[1]==="Pesada";
      if(selected==="Escudos") return item[1]==="Escudo";
    }
    return true;
  };
  box.innerHTML=`<div class="equipment-grid">${arr.filter(matches).map(x=>`
    <div class="equipment-item">
      <strong>${esc(x[0])}</strong>
      <small>${esc(x[1]||"")}${x[2]?" · "+esc(x[2]):""}${x[3]?" · "+esc(x[3]):""}</small>
      <button class="add-eq" data-name="${esc(x[0])}">Adicionar ao inventário</button>
    </div>`).join("")}</div>` || "<p class='hint'>Nenhum item encontrado.</p>";
  box.querySelectorAll(".add-eq").forEach(b=>on(b,"click",()=>{
    addInventory(b.dataset.name);
    toast("Item adicionado ao inventário.");
  }));
}

function addInventory(name="",qty="1",weight=""){
  state.inventory.push({qty,name,weight});
  renderInventory();
}

function renderInventory(){
  const box=$("#inventory"); if(!box) return;
  box.innerHTML=state.inventory.map((x,i)=>`
    <div class="inv-row">
      <input class="qty" value="${esc(x.qty)}" aria-label="Quantidade">
      <input class="iname" value="${esc(x.name)}" placeholder="Item">
      <input class="weight" value="${esc(x.weight)}" placeholder="Peso">
      <button data-del="${i}" title="Remover">×</button>
    </div>`).join("") || "<p class='hint'>Nenhum item no inventário.</p>";
  box.querySelectorAll(".inv-row input").forEach(e=>on(e,"input",()=>{
    const r=e.closest(".inv-row");
    const i=[...box.querySelectorAll(".inv-row")].indexOf(r);
    state.inventory[i]={qty:r.querySelector(".qty")?.value||"",name:r.querySelector(".iname")?.value||"",weight:r.querySelector(".weight")?.value||""};
  }));
  box.querySelectorAll("[data-del]").forEach(b=>on(b,"click",()=>{
    state.inventory.splice(Number(b.dataset.del),1); renderInventory();
  }));
}

function setup(){
  renderRulesets();
  renderClasses();
  renderAbilities();

  const level=$("#level");
  on(level,"input",()=>{renderSkills();updateDerived();renderClassDetails();});

  on($("#spellSearch"),"input",renderSpells);
  on($("#spellLevelFilter"),"change",renderSpells);
  on($("#equipmentCategory"),"change",renderEquipment);

  const sf=$("#spellLevelFilter");
  if(sf) sf.innerHTML='<option value="">Todos os níveis</option>'+
    Array.from({length:10},(_,i)=>`<option value="${i}">${i===0?"Truque":"Nível "+i}</option>`).join("");

  document.querySelectorAll("[data-tab]").forEach(b=>on(b,"click",()=>{
    document.querySelectorAll("[data-tab]").forEach(x=>x.classList.remove("active"));
    b.classList.add("active");
    state.tab=b.dataset.tab;
    renderEquipment();
  }));

  on($("#addInventory"),"click",()=>addInventory());
  on($("#saveBtn"),"click",save);
  on($("#clearBtn"),"click",()=>{
    if(confirm("Limpar a ficha?")){
      localStorage.removeItem("dndSheetState");
      location.reload();
    }
  });
  on($("#printBtn"),"click",()=>window.print());
  on($("#previewBtn"),"click",()=>{
    document.body.classList.toggle("pdf-preview");
    window.scrollTo({top:0,behavior:"smooth"});
    toast(document.body.classList.contains("pdf-preview") ? "Pré-visualização ativada." : "Pré-visualização desativada.");
  });

  loadSaved();
  // Garantia de renderização mesmo que não exista ficha salva.
  if(!$("#class")?.value) renderClassDetails();
  renderEquipment();
  updateDerived();

  const status=$("#dbStatus");
  if(status) status.textContent="✓ Banco local carregado";
}

if(document.readyState==="loading") document.addEventListener("DOMContentLoaded",setup,{once:true});
else setup();

})();