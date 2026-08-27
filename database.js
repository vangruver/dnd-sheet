const BASE=new URL("./",import.meta.url);
const MANIFEST=new URL("data/manifest.json",BASE).href;
let catalog=null,entriesCache=null;
const fileCache=new Map(),recordCache=new Map();

export async function initDatabase(){
 const r=await fetch(MANIFEST,{cache:"no-store"});
 if(!r.ok)throw new Error(`Manifesto ${r.status} — ${MANIFEST}`);
 catalog=await r.json(); entriesCache=null; return catalog;
}
export const getCatalog=()=>catalog;
const typeMap={classes:"class",class:"class",subclasses:"subclass",subclass:"subclass",races:"race",race:"race",species:"race",
 backgrounds:"background",background:"background",spells:"spell",spell:"spell",feats:"feat",feat:"feat",items:"item",item:"item",
 classfeature:"classFeature",classfeatures:"classFeature",subclassfeature:"subclassFeature",subclassfeatures:"subclassFeature"};
export const normType=t=>typeMap[String(t||"").toLowerCase()]||String(t||"");
function flattenManifest(){
 if(!catalog)return [];
 const out=[],seen=new Set();
 const add=(x,inherited={})=>{
  if(!x)return;
  if(Array.isArray(x)){x.forEach(v=>add(v,inherited));return}
  if(typeof x!=="object")return;
  if(x.file||x.path||x.url||x.id||x.name){
   const e={...inherited,...x}; e.type=normType(e.type||e.category||e.kind);
   e.id=e.id||`${e.type}:${e.name||e.file||e.path}`;
   if(!seen.has(e.id)){seen.add(e.id);out.push(e)}
  }
  for(const [k,v] of Object.entries(x)){
   if(["file","path","url"].includes(k))continue;
   if(v&&typeof v==="object")add(v,{...inherited,...(typeMap[String(k).toLowerCase()]?{type:normType(k)}:{})});
  }
 };
 if(catalog.entities)add(catalog.entities);
 for(const k of ["classes","subclasses","races","species","backgrounds","spells","feats","items","files"])if(catalog[k])add(catalog[k],{type:normType(k)});
 return out;
}
export function manifestEntries(){return entriesCache||(entriesCache=flattenManifest())}
export function isHomebrew(x){return !!(x?.homebrew||x?.isHomebrew||x?.brew||x?.sourceCategory==="homebrew"||x?._isBrew)}
export function editionOf(x){return String(x?.edition||x?.rules||x?.version||"").toLowerCase()}
function editionOK(x,edition){
 const e=editionOf(x); if(!e)return true;
 if(e==="classic"||e==="legacy")return edition==="2014";
 if(e==="one"||e==="2024")return edition==="2024";
 if(e==="both"||e==="all")return true;
 return e.includes(String(edition).toLowerCase());
}
export function filterEntities(type,edition,content="all",query=""){
 const q=String(query||"").trim().toLowerCase();
 return manifestEntries().filter(x=>{
  if(normType(x.type)!==type||!editionOK(x,edition))return false;
  const hb=isHomebrew(x); if(content==="official"&&hb)return false;if(content==="homebrew"&&!hb)return false;
  return !q||String(x.name||"").toLowerCase().includes(q)||String(x.source||"").toLowerCase().includes(q);
 }).sort((a,b)=>Number(isHomebrew(a))-Number(isHomebrew(b))||String(a.name||"").localeCompare(String(b.name||""),"pt-BR"));
}
async function loadFile(e){
 const f=e?.file||e?.path||e?.url;if(!f)return e;
 const key=String(f).replace(/^\.?\//,"");if(fileCache.has(key))return fileCache.get(key);
 const url=/^https?:\/\//i.test(key)?key:new URL(`data/${key}`,BASE).href;
 const r=await fetch(url);if(!r.ok)return e;const j=await r.json();fileCache.set(key,j);return j;
}
export async function loadEntity(e){
 if(!e)return null;if(recordCache.has(e.id))return recordCache.get(e.id);
 const j=await loadFile(e);recordCache.set(e.id,j);return j;
}
function arrays(j){
 if(!j||typeof j!=="object")return [];
 const out=[];for(const [k,v] of Object.entries(j))if(Array.isArray(v))v.forEach(x=>{if(x&&typeof x==="object")out.push({...x,__type:normType(k)})});
 return out;
}
export async function recordsForEntity(e){
 const j=await loadEntity(e),arr=arrays(j);
 if(!arr.length&&j&&typeof j==="object")return [{...j,__type:normType(e.type)}];
 return arr.map(x=>({...x,homebrew:isHomebrew(x)||isHomebrew(e),source:x.source||e.source,edition:x.edition||e.edition}));
}
function sameText(a,b){return String(a||"").toLowerCase().trim()===String(b||"").toLowerCase().trim()}
function featureEntriesFor(type,owner,level){
 const all=manifestEntries().filter(x=>normType(x.type)===type&&editionOf(x)===editionOf(owner));
 return all.filter(x=>{
  const cn=String(x.className||x.class||x.classNameText||"").toLowerCase();
  const on=String(owner.name||"").toLowerCase();
  const cs=String(x.classSource||"").toLowerCase(), os=String(owner.source||"").toLowerCase();
  const sn=String(x.subclassShortName||x.subclassName||x.subclass||"").toLowerCase();
  const osn=String(owner.name||"").toLowerCase();
  if(type==="classFeature")return (!cn||cn===on||cn.includes(on))&&(!cs||!os||cs===os);
  return (!sn||sn===osn||sn.includes(osn));
 }).filter(x=>Number(x.level||x.levels?.[0]||0)<=level);
}
export async function findClassFeatures(cls,level){
 const refs=featureEntriesFor("classFeature",cls,level),out=[];
 for(const ref of refs){const rec=await recordsForEntity(ref);for(const f of rec)if(normType(f.__type)==="classFeature"&&Number(f.level||0)<=level)out.push({...f,__manifest:ref})}
 return dedupeFeatures(out);
}
export async function findSubclassFeatures(sub,level){
 if(!sub)return [];
 const refs=featureEntriesFor("subclassFeature",sub,level),out=[];
 for(const ref of refs){const rec=await recordsForEntity(ref);for(const f of rec)if(normType(f.__type)==="subclassFeature"&&Number(f.level||0)<=level)out.push({...f,__manifest:ref})}
 return dedupeFeatures(out);
}
function dedupeFeatures(a){const m=new Map();a.forEach(x=>m.set(`${x.name}|${x.level}|${x.source}`,x));return [...m.values()].sort((a,b)=>Number(a.level||0)-Number(b.level||0))}
export async function getRecordArrays(e){return recordsForEntity(e)}
export function stats(){const a=manifestEntries();return {entities:a.length,official:a.filter(x=>!isHomebrew(x)).length,homebrew:a.filter(isHomebrew).length}}
