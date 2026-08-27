export const ABILITIES = ["str", "dex", "con", "int", "wis", "cha"];
export const ABILITY_NAMES = { str: "Força", dex: "Destreza", con: "Constituição", int: "Inteligência", wis: "Sabedoria", cha: "Carisma" };
export const SKILLS = [
  ["acrobatics", "Acrobacia", "dex"], ["animalHandling", "Adestrar Animais", "wis"], ["arcana", "Arcanismo", "int"], ["athletics", "Atletismo", "str"],
  ["deception", "Enganação", "cha"], ["history", "História", "int"], ["insight", "Intuição", "wis"], ["intimidation", "Intimidação", "cha"],
  ["investigation", "Investigação", "int"], ["medicine", "Medicina", "wis"], ["nature", "Natureza", "int"], ["perception", "Percepção", "wis"],
  ["performance", "Atuação", "cha"], ["persuasion", "Persuasão", "cha"], ["religion", "Religião", "int"], ["sleightOfHand", "Prestidigitação", "dex"],
  ["stealth", "Furtividade", "dex"], ["survival", "Sobrevivência", "wis"]];
export function mod(score) { return Math.floor((Number(score || 0) - 10) / 2); }
export function fmt(n) { n = Number(n || 0); return n >= 0 ? `+${n}` : `${n}`; }
export function proficiency(level) { return 2 + Math.floor((Math.max(1, Number(level || 1)) - 1) / 4); }
export function hpAverage(faces) { return Math.floor(Number(faces || 8) / 2) + 1; }
export function abilityKey(v) {
  if (!v) return null;
  const s = String(v).toLowerCase().replace(/[^a-z]/g, "");
  return { strength: "str", str: "str", dexterity: "dex", dex: "dex", constitution: "con", con: "con", intelligence: "int", int: "int", wisdom: "wis", wis: "wis", charisma: "cha", cha: "cha" }[s] || null;
}
export function spellDc(pb, m) { return 8 + pb + m; }
export function spellAttack(pb, m) { return pb + m; }

// ------------------------------------------------------------
// Espaços de magia (tabelas padrão 5e)
// ------------------------------------------------------------
// Conjurador completo: nível efetivo 1..20 -> [1º..9º].
const FULL_SLOTS = [
  [2, 0, 0, 0, 0, 0, 0, 0, 0], [3, 0, 0, 0, 0, 0, 0, 0, 0], [4, 2, 0, 0, 0, 0, 0, 0, 0],
  [4, 3, 0, 0, 0, 0, 0, 0, 0], [4, 3, 2, 0, 0, 0, 0, 0, 0], [4, 3, 3, 0, 0, 0, 0, 0, 0],
  [4, 3, 3, 1, 0, 0, 0, 0, 0], [4, 3, 3, 2, 0, 0, 0, 0, 0], [4, 3, 3, 3, 1, 0, 0, 0, 0],
  [4, 3, 3, 3, 2, 0, 0, 0, 0], [4, 3, 3, 3, 2, 1, 0, 0, 0], [4, 3, 3, 3, 2, 1, 0, 0, 0],
  [4, 3, 3, 3, 2, 1, 1, 0, 0], [4, 3, 3, 3, 2, 1, 1, 0, 0], [4, 3, 3, 3, 2, 1, 1, 1, 0],
  [4, 3, 3, 3, 2, 1, 1, 1, 0], [4, 3, 3, 3, 2, 1, 1, 1, 1], [4, 3, 3, 3, 3, 1, 1, 1, 1],
  [4, 3, 3, 3, 3, 2, 1, 1, 1], [4, 3, 3, 3, 3, 2, 2, 1, 1],
];
// Magia de Pacto (Bruxo): nível 1..20 -> { count, level }.
const PACT_SLOTS = [
  [1, 1], [2, 1], [2, 2], [2, 2], [2, 3], [2, 3], [2, 4], [2, 4], [2, 5], [2, 5],
  [3, 5], [3, 5], [3, 5], [3, 5], [3, 5], [3, 5], [4, 5], [4, 5], [4, 5], [4, 5],
];

function fullSlotsAt(effLevel) {
  const l = Math.max(0, Math.min(20, Math.floor(effLevel)));
  return l < 1 ? Array(9).fill(0) : FULL_SLOTS[l - 1].slice();
}
// progression: "full" | "1/2" | "artificer" | "1/3" | "pact" | "pact-full"
export function casterSlots(progression, level) {
  const p = String(progression || "").toLowerCase();
  level = Math.max(0, Number(level) || 0);
  if (p === "full") return fullSlotsAt(level);
  if (p === "1/2" || p === "half") return fullSlotsAt(level < 2 ? 0 : Math.floor(level / 2));
  if (p === "artificer") return fullSlotsAt(Math.ceil(level / 2));
  if (p === "1/3" || p === "third") return fullSlotsAt(level < 3 ? 0 : Math.floor(level / 3));
  return null;
}
export function pactSlots(level) {
  level = Math.max(1, Math.min(20, Number(level) || 1));
  const [count, slot] = PACT_SLOTS[level - 1];
  return { count, level: slot };
}
export function parseProgression(v, level) {
  if (v == null) return null;
  if (Array.isArray(v)) return v[Math.max(0, level - 1)] ?? null;
  if (typeof v === "number") return v;
  if (typeof v === "string") return v.replaceAll("<$level$>", String(level));
  return null;
}
