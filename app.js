import {ABILITIES,ABILITY_NAMES,SKILLS,fmt,mod} from "./rules.js";
export const $=id=>document.getElementById(id);
export function options(select,items,placeholder="Selecione…"){
 const groups={official:[],homebrew:[]};
 items.forEach(x=>(x.homebrew?groups.homebrew:groups.official).push(x));
 select.innerHTML=`<option value="">${placeholder}</option>`;
 for(const [label,key] of [["Oficial","official"],["Homebrew","homebrew"]]){
  if(!groups[key].length) continue;
  const g=document.createElement("optgroup");g.label=label;
  groups[key].forEach(x=>{const o=document.createElement("option");o.value=x.id;o.textContent=x.name;g.appendChild(o)});
  select.appendChild(g);
 }
}
export function renderAttributes(c,onChange){
 $("attributes").innerHTML=ABILITIES.map(a=>`<div class="ability"><h3>${ABILITY_NAMES[a]}</h3><input data-ability="${a}" type="number" value="${c.scores[a]}"><div class="mod" id="mod-${a}">${fmt(mod(c.scores[a]))}</div></div>`).join("");
 document.querySelectorAll("[data-ability]").forEach(el=>el.addEventListener("input",e=>onChange(e.target.dataset.ability,Number(e.target.value))));
}
export function renderSaves(c,pb,onChange){
 $("saves").innerHTML=ABILITIES.map(a=>`<label class="skill"><input type="checkbox" data-save="${a}" ${c.saveProficiencies.includes(a)?"checked":""}><span>${ABILITY_NAMES[a]}</span><strong class="value" id="save-${a}"></strong></label>`).join("");
 document.querySelectorAll("[data-save]").forEach(x=>x.addEventListener("change",e=>onChange(e.target.dataset.save,e.target.checked)));
}
export function renderSkills(c,pb,onChange){
 $("skills").innerHTML=SKILLS.map(([id,name,a])=>`<label class="skill"><input type="checkbox" data-skill="${id}" ${c.skillProficiencies.includes(id)?"checked":""}><span>${name} <span class="ability-name">${a.toUpperCase()}</span></span><strong class="value" id="skill-${id}"></strong></label>`).join("");
 document.querySelectorAll("[data-skill]").forEach(x=>x.addEventListener("change",e=>onChange(e.target.dataset.skill,e.target.checked)));
}
