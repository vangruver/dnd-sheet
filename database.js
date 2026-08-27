const MANIFEST = "data/manifest.json";
let catalog = null;
const fileCache = new Map();

export async function initDatabase(){
  const r=await fetch(`${MANIFEST}?v=${Date.now()}`);
  if(!r.ok) throw new Error(`Não foi possível carregar o manifesto (${r.status})`);
  catalog=await r.json();
  return catalog;
}
export function getCatalog(){return catalog;}

function arr(v){return Array.isArray(v)?v:[];}
function normalizeType(e){
  const t=String(e.type||e.category||e.kind||"").toLowerCase();
  if(["classes","class"].includes(t)) return "class";
  if(["subclasses","subclass"].includes(t)) return "subclass";
  if(["races","race","species","specieses"].includes(t)) return "race";
  if(["backgrounds","background"].includes(t)) return "background";
  if(["spells","spell"].includes(t)) return "spell";
  if(["feats","feat"].includes(t)) return "feat";
  if(["items","item"].includes(t)) return "item";
  return t;
}
function normalizeEntity(e, inherited={}){
  return {...inherited,...e,type:normalizeType({...inherited,...e})};
}

export function entitiesFromManifest(){
  if(!catalog) return [];
  let raw = catalog.entities;
  if(Array.isArray(raw)) return raw.map(e=>normalizeEntity(e));
  if(raw && typeof raw==="object"){
    const out=[];
    for(const [type,value] of Object.entries(raw)){
      for(const e of arr(value)) if(e&&typeof e==="object") out.push(normalizeEntity(e,{type}));
    }
    return out;
  }
  // Fallbacks for alternative manifest shapes.
  const out=[];
  for(const type of ["classes","subclasses","races","species","backgrounds","spells","feats","items"]){
    for(const e of arr(catalog[type])) out.push(normalizeEntity(e,{type}));
  }
  return out;
}
export function filterEntities(type,edition,content="all"){
  return entitiesFromManifest().filter(e=>{
    if(normalizeType(e)!==type) return false;
    const ed=String(e.edition||e.rules||e.version||"").toLowerCase();
    if(ed && ed!=="both" && ed!=="all" && ed!==String(edition).toLowerCase() && !(edition==="2024"&&ed.includes("2024")) && !(edition==="2014"&&ed.includes("2014"))) return false;
    const hb=Boolean(e.homebrew||e.isHomebrew||e.sourceCategory==="homebrew");
    if(content==="official"&&hb)return false;
    if(content==="homebrew"&&!hb)return false;
    return true;
  }).sort((a,b)=>Number(Boolean(a.homebrew))-Number(Boolean(b.homebrew)) || String(a.name||"").localeCompare(String(b.name||""),"pt-BR"));
}
export async function loadEntity(entity){
  if(!entity)return null;
  if(entity.file){
    const file=String(entity.file).replace(/^\/+/,"");
    if(fileCache.has(file))return fileCache.get(file);
    const r=await fetch(`data/${file}`);
    if(r.ok){const j=await r.json();fileCache.set(file,j);return j;}
  }
  return entity;
}
export async function getEntityObjects(entity){
  const j=await loadEntity(entity);
  if(!j||typeof j!=="object")return[];
  const out=[];
  const walk=(v,key="")=>{
    if(Array.isArray(v)) for(const x of v) walk(x,key);
    else if(v&&typeof v==="object"){
      if(v.name) out.push({type:key,...v});
      for(const [k,x] of Object.entries(v)) if(typeof x==="object") walk(x,k);
    }
  };
  walk(j);
  return out;
}
export function stats(){
  const all=entitiesFromManifest();
  return {entities:all.length,official:all.filter(e=>!e.homebrew).length,homebrew:all.filter(e=>e.homebrew).length};
}
