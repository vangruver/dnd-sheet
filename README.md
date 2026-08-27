export const ABILITIES=["str","dex","con","int","wis","cha"];
export const ABILITY_NAMES={str:"Força",dex:"Destreza",con:"Constituição",int:"Inteligência",wis:"Sabedoria",cha:"Carisma"};
export const SKILLS=[
 ["acrobatics","Acrobacia","dex"],["animalHandling","Adestrar Animais","wis"],
 ["arcana","Arcanismo","int"],["athletics","Atletismo","str"],["deception","Enganação","cha"],
 ["history","História","int"],["insight","Intuição","wis"],["intimidation","Intimidação","cha"],
 ["investigation","Investigação","int"],["medicine","Medicina","wis"],["nature","Natureza","int"],
 ["perception","Percepção","wis"],["performance","Atuação","cha"],["persuasion","Persuasão","cha"],
 ["religion","Religião","int"],["sleightOfHand","Prestidigitação","dex"],["stealth","Furtividade","dex"],
 ["survival","Sobrevivência","wis"]
];
export const PROFICIENCY_BY_LEVEL=level=>Math.floor((Math.max(1,level)-1)/4)+2;
export const mod=score=>Math.floor((Number(score||10)-10)/2);
export const fmt=n=>n>=0?`+${n}`:`${n}`;

export const RULES={
  "2014":{
    defaultSpeed:30,
    hpAverage:faces=>Math.floor(faces/2)+1,
    spellDc:(pb,m)=>8+pb+m,
    spellAttack:(pb,m)=>pb+m
  },
  "2024":{
    defaultSpeed:30,
    hpAverage:faces=>Math.floor(faces/2)+1,
    spellDc:(pb,m)=>8+pb+m,
    spellAttack:(pb,m)=>pb+m
  }
};

export function getRule(edition){return RULES[edition]||RULES["2024"]}
