const KEY="dnd-character-sheet-v1";
export function saveCharacter(c){localStorage.setItem(KEY,JSON.stringify(c));}
export function loadCharacter(){try{return JSON.parse(localStorage.getItem(KEY)||"null")}catch{return null}}
export function downloadCharacter(c){
 const blob=new Blob([JSON.stringify(c,null,2)],{type:"application/json"});
 const a=document.createElement("a");a.href=URL.createObjectURL(blob);a.download=(c.name||"personagem")+"-dnd.json";a.click();URL.revokeObjectURL(a.href);
}
export function readFile(file){return file.text().then(JSON.parse)}
