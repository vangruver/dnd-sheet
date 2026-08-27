const MANIFEST="data/manifest.json";
let catalog=null; const cache=new Map(), entityCache=new Map();

export async function initDatabase(){const r=await fetch(`${MANIFEST}?v=${Date.now()}`);if(!r.ok)throw Error(`Manifesto ${r.status}`);catalog=await r.json();return catalog}
export function getCatalog(){return catalog}
const A=v=>Array.isArray(v)?v:[];
const normType=t=>{t=String(t||"").toLowerCase();return {classes:"class",class:"class",subclasses:"subclass",subclass:"subclass",races:"race",race:"race",species:"race",backgrounds:"background",background:"background",spells:"spell",spell:"spell",feats:"feat",feat:"feat",items:"item",item:"item",classfeature:"classFeature",subclassfeature:"subclassFeature"}[t]||t};

function flattenManifest(){
  if(!catalog)return [];
  const out=[];
  const add=(x,inherited={})=>{
    if(!x)return;
    if(Array.isArray(x)){x.forEach(v=>add(v,inherited));return}
    if(typeof x!=="object")return;
    if(x.file||x.path||x.url||x.id||x.name){
      const e={...inherited,...x}; if(e.type)e.type=normType(e.type);
      if(e.file||e.path||e.url||e.id||e.name)out.push(e);
    }
    for(const [k,v] of Object.entries(x)){
      if(["file","path","url"].includes(k))continue;
      if(typeof v==="object")add(v,{...inherited,...(["class","classes","subclass","subclasses","race","races","species","background","backgrounds","spell","spells","feat","feats","item","items"].includes(k)?{type:normType(k)}:{})});
    }
  };
  if(Array.isArray(catalog.entities))add(catalog.entities);
  else if(catalog.entities)add(catalog.entities);
  for(const k of ["classes","subclasses","races","species","backgrounds","spells","feats","items","files"])if(catalog[k])add(catalog[k],{type:normType(k)});
  return out;
}
function normalize(e,inherited={}){const x={...inherited,...e};x.type=normType(x.type||x.category||x.kind);x.id=x.id||`${x.type}:${x.name||x.file||x.path||Math.random()}`;return x}
export function manifestEntries(){return flattenManifest().map(x=>normalize(x))}
async function loadFile(e){
  const f=e?.file||e?.path||e?.url;if(!f)return e;
  const key=String(f).replace(/^\.?\//,"");if(cache.has(key))return cache.get(key);
  const url=/^https?:\/\//i.test(key)?key:`data/${key}`;
  const r=await fetch(url);if(!r.ok)return e;const j=await r.json();cache.set(key,j);return j;
}
function sourceIsHomebrew(x){return !!(x.homebrew||x.isHomebrew||x.brew||x.sourceCategory==="homebrew"||x._isBrew)}
function editionOf(x){return String(x.edition||x.rules||x.version||"").toLowerCase()}
function editionOK(x,edition){
  const e=editionOf(x);if(!e)return true;
  if(e==="classic"||e==="legacy")return edition==="2014";
  if(e==="one"||e==="2024")return edition==="2024";
  if(e==="both"||e==="all")return true;
  return e.includes(edition);
}
export function filterEntities(type,edition,content="all"){
  return manifestEntries().filter(x=>{
    if(normType(x.type)!==type)return false;
    if(!editionOK(x,edition))return false;
    const hb=sourceIsHomebrew(x);
    if(content==="official"&&hb)return false;if(content==="homebrew"&&!hb)return false;return true;
  }).sort((a,b)=>Number(sourceIsHomebrew(a))-Number(sourceIsHomebrew(b))||String(a.name||"").localeCompare(String(b.name||""),"pt-BR"));
}
export async function loadEntity(e){
  if(!e)return null;if(entityCache.has(e.id))return entityCache.get(e.id);
  const j=await loadFile(e);entityCache.set(e.id,j);return j;
}
function arrays(j){
  if(!j||typeof j!=="object")return [];
  const out=[];for(const [k,v] of Object.entries(j))if(Array.isArray(v))v.forEach(x=>{if(x&&typeof x==="object")out.push({...x,__type:normType(k)})});
  return out;
}
export async function recordsForEntity(e){
  const j=await loadEntity(e);const arr=arrays(j);
  if(!arr.length&&j&&typeof j==="object")return [{...j,__type:normType(e.type)}];
  return arr.map(x=>({...x,homebrew:sourceIsHomebrew(x)||sourceIsHomebrew(e),source:x.source||e.source,edition:x.edition||e.edition}));
}
export async function findClassFeatures(cls,level){
  const rec=await recordsForEntity(cls);return rec.filter(x=>x.__type==="classFeature"&&Number(x.level||0)<=level).sort((a,b)=>Number(a.level||0)-Number(b.level||0));
}
export async function findSubclassFeatures(sub,level){
  const rec=await recordsForEntity(sub);return rec.filter(x=>x.__type==="subclassFeature"&&Number(x.level||0)<=level).sort((a,b)=>Number(a.level||0)-Number(b.level||0));
}
export async function getRecordArrays(e){return recordsForEntity(e)}
export function stats(){const all=manifestEntries();return {entities:all.length,official:all.filter(x=>!sourceIsHomebrew(x)).length,homebrew:all.filter(sourceIsHomebrew).length}}
