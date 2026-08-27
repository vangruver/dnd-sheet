const KEY="dnd-sheet-character-v3";
export function saveCharacter(c){localStorage.setItem(KEY,JSON.stringify(c));}
export function loadCharacter(){try{const v=localStorage.getItem(KEY);return v?JSON.parse(v):null}catch{return null}}
export function clearCharacter(){localStorage.removeItem(KEY)}
export function downloadCharacter(c){
  const blob=new Blob([JSON.stringify(c,null,2)],{type:"application/json"});
  const url=URL.createObjectURL(blob),a=document.createElement("a");
  a.href=url;a.download=`${(c.name||"personagem").replace(/[^a-z0-9-_]+/gi,"_")}.json`;a.click();
  setTimeout(()=>URL.revokeObjectURL(url),500);
}
export async function readCharacterFile(file){return JSON.parse(await file.text())}
