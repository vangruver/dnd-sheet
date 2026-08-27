const CATALOG_URL="data/manifest.json";
let catalog=null;
const cache=new Map();

export async function initDatabase(){
  const r=await fetch(`${CATALOG_URL}?v=${Date.now()}`);
  if(!r.ok) throw new Error(`Banco indisponível (${r.status})`);
  catalog=await r.json();
  return catalog;
}
export function getCatalog(){return catalog}
export function filterEntities(type,edition,content){
  if(!catalog) return [];
  return (catalog.entities||[]).filter(x=>{
    if(x.type!==type) return false;
    if(x.edition && x.edition!==edition && x.edition!=="both") return false;
    if(content==="official" && x.homebrew) return false;
    if(content==="homebrew" && !x.homebrew) return false;
    return true;
  }).sort((a,b)=>(a.homebrew-b.homebrew)||a.name.localeCompare(b.name));
}
export async function loadEntity(entity){
  if(!entity?.file) return entity;
  const key=entity.file;
  if(cache.has(key)) return cache.get(key);
  const r=await fetch(`data/${key}`);
  if(!r.ok) return entity;
  const json=await r.json();
  cache.set(key,json);
  return json;
}
