export const ABILITIES=["str","dex","con","int","wis","cha"];
export const ABILITY_NAMES={str:"Força",dex:"Destreza",con:"Constituição",int:"Inteligência",wis:"Sabedoria",cha:"Carisma"};
export const SKILLS=[
["acrobatics","Acrobacia","dex"],["animalHandling","Adestrar Animais","wis"],["arcana","Arcanismo","int"],["athletics","Atletismo","str"],
["deception","Enganação","cha"],["history","História","int"],["insight","Intuição","wis"],["intimidation","Intimidação","cha"],
["investigation","Investigação","int"],["medicine","Medicina","wis"],["nature","Natureza","int"],["perception","Percepção","wis"],
["performance","Atuação","cha"],["persuasion","Persuasão","cha"],["religion","Religião","int"],["sleightOfHand","Prestidigitação","dex"],
["stealth","Furtividade","dex"],["survival","Sobrevivência","wis"]];
export function mod(score){return Math.floor((Number(score||0)-10)/2)}
export function fmt(n){n=Number(n||0);return n>=0?`+${n}`:`${n}`}
export function proficiency(level){return 2+Math.floor((Math.max(1,Number(level||1))-1)/4)}
export function hpAverage(faces){return Math.floor(Number(faces||8)/2)+1}
export function abilityKey(v){
 if(!v)return null; const s=String(v).toLowerCase().replace(/[^a-z]/g,"");
 return {strength:"str",str:"str",dexterity:"dex",dex:"dex",constitution:"con",con:"con",intelligence:"int",int:"int",wisdom:"wis",wis:"wis",charisma:"cha",cha:"cha"}[s]||null;
}
export function spellDc(pb,m){return 8+pb+m}
export function spellAttack(pb,m){return pb+m}
export function parseProgression(v,level){
 if(v==null)return null;
 if(Array.isArray(v))return v[Math.max(0,level-1)]??null;
 if(typeof v==="number")return v;
 if(typeof v==="string")return v.replaceAll("<$level$>",String(level));
 return null;
}