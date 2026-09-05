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

// ------------------------------------------------------------
// Dados (rolagens)
// ------------------------------------------------------------
export function rollDie(faces) { return 1 + Math.floor(Math.random() * Math.max(1, Number(faces) || 6)); }
export function rollDice(n, faces) {
  n = Math.max(1, Number(n) || 1);
  const rolls = Array.from({ length: n }, () => rollDie(faces));
  return { rolls, total: rolls.reduce((a, b) => a + b, 0) };
}
// Fórmulas de rolagem de atributo — o padrão é 4d6 descartando o menor,
// mas cada mesa pode preferir outra variante (mais direta, mais heroica...).
export const ABILITY_ROLL_FORMULAS = {
  "4d6dl1": {
    label: "4d6, descarta o menor (clássico)",
    roll: () => { const r = [rollDie(6), rollDie(6), rollDie(6), rollDie(6)].sort((a, b) => b - a); return r[0] + r[1] + r[2]; },
  },
  "3d6": { label: "3d6, direto (sem descarte, mais arriscado)", roll: () => rollDice(3, 6).total },
  "2d6+6": { label: "2d6+6 (mais equilibrado, sem valores baixos)", roll: () => rollDice(2, 6).total + 6 },
  "5d6dl2": {
    label: "5d6, descarta os dois menores (heroico)",
    roll: () => { const r = [rollDie(6), rollDie(6), rollDie(6), rollDie(6), rollDie(6)].sort((a, b) => b - a); return r[0] + r[1] + r[2]; },
  },
};
export function rollAbilityScore(formula) {
  return (ABILITY_ROLL_FORMULAS[formula] || ABILITY_ROLL_FORMULAS["4d6dl1"]).roll();
}

// ------------------------------------------------------------
// Arrays de atributo nomeados — alternativas ao point buy: valores fixos
// que o jogador distribui pelos seis atributos (cada valor usado uma vez).
// ------------------------------------------------------------
export const ABILITY_ARRAYS = {
  standard: { label: "Array Padrão", values: [15, 14, 13, 12, 10, 8] },
  heroic: { label: "Array Heroico", values: [16, 15, 14, 13, 12, 10] },
  epic: { label: "Array Épico", values: [18, 16, 14, 12, 10, 8] },
};
export const ABILITY_MODE_LABELS = {
  pointbuy: "Point buy (27)", standard: "Array Padrão (15,14,13,12,10,8)", heroic: "Array Heroico (16,15,14,13,12,10)",
  epic: "Array Épico (18,16,14,12,10,8)", roll: "Rolagem (4d6, descarta o menor)", free: "Valores livres",
};
// "2d6+3" -> { n, faces, bonus }. Aceita também só "1d8" ou "d10".
export function parseDiceExpr(expr) {
  const m = String(expr || "").match(/(\d*)d(\d+)\s*([+-]\s*\d+)?/i);
  if (!m) return null;
  return { n: Number(m[1] || 1), faces: Number(m[2]), bonus: m[3] ? Number(m[3].replace(/\s+/g, "")) : 0 };
}

// ------------------------------------------------------------
// Recursos de classe lidos genericamente das colunas da tabela da
// classe (classTableGroups) — cobre Fúria, Pontos de Ki, Pontos de
// Feitiçaria, Inspiração de Bardo, Canalizar Divindade, Dados de
// Superioridade, Forma Selvagem etc. sem precisar de dados por classe
// escritos à mão: qualquer classe (oficial ou homebrew) cuja tabela
// tenha uma coluna com um desses nomes ganha o rastreador automaticamente.
// turnAction: o que esse recurso custa pra usar num turno de combate — usado
// pela aba "Ações" pra agrupar por Ação/Ação Bônus/Reação. "special" cobre o
// que não é um gasto de ação padrão (parte de outra ação, ou só fora de
// combate, como a Recuperação Arcana no descanso curto).
export const CLASS_RESOURCE_COLUMNS = [
  { key: "rage", re: /^rage/i, label: "Fúria", rest: "long", die: null, turnAction: "bonus" },
  { key: "ki", re: /^(ki|focus) points?/i, label: "Pontos de Ki / Foco", rest: "short", die: null, turnAction: "bonus" },
  { key: "sorcery", re: /^sorcery points?/i, label: "Pontos de Feitiçaria", rest: "long", die: null, turnAction: "bonus" },
  { key: "bardic", re: /^bardic inspiration/i, label: "Inspiração de Bardo", rest: "long", die: null, turnAction: "bonus" },
  { key: "channelDivinity", re: /^channel divinity/i, label: "Canalizar Divindade", rest: "short", die: null, turnAction: "action" },
  { key: "superiority", re: /^superiority dice/i, label: "Dados de Superioridade", rest: "short", die: null, turnAction: "special" },
  { key: "wildShape", re: /^wild shape/i, label: "Forma Selvagem", rest: "short", die: null, turnAction: "action" },
  { key: "arcaneRecovery", re: /^arcane recovery/i, label: "Recuperação Arcana", rest: "long", die: null, turnAction: "special" },
  { key: "secondWind", re: /^second wind/i, label: "Retomar o Fôlego", rest: "short", die: null, turnAction: "bonus" },
];

// ------------------------------------------------------------
// Condições de combate (regras 5e) — usadas pelo rastreador de
// condições do modo combate.
// ------------------------------------------------------------
export const CONDITIONS = [
  { key: "blinded", label: "Cego", effect: "Falha automaticamente em testes que exigem visão; ataques contra você têm vantagem; seus ataques têm desvantagem." },
  { key: "charmed", label: "Encantado", effect: "Não pode atacar quem o encantou nem alvejá-lo com magias/efeitos prejudiciais; quem o encantou tem vantagem em testes sociais." },
  { key: "deafened", label: "Surdo", effect: "Falha automaticamente em testes que exigem audição." },
  { key: "exhaustion", label: "Exaustão", effect: "Níveis acumulativos: cada nível dá -2 em testes de D20, reduz deslocamento e outros efeitos crescentes (ver regra completa)." },
  { key: "frightened", label: "Amedrontado", effect: "Desvantagem em testes de habilidade e ataques enquanto a fonte do medo estiver à vista; não pode se aproximar voluntariamente dela." },
  { key: "grappled", label: "Agarrado", effect: "Deslocamento reduzido a 0; termina se quem agarrou for incapacitado ou você for afastado." },
  { key: "incapacitated", label: "Incapacitado", effect: "Não pode realizar ações nem reações." },
  { key: "invisible", label: "Invisível", effect: "Considerado fortemente obscurecido; ataques contra você têm desvantagem; seus ataques têm vantagem." },
  { key: "paralyzed", label: "Paralisado", effect: "Incapacitado, não pode se mover nem falar; falha automaticamente em salvamentos de FOR/DES; ataques contra você têm vantagem e acertos a 1,5m são críticos automáticos." },
  { key: "petrified", label: "Petrificado", effect: "Transformado em substância sólida inanimada; incapacitado, não pode se mover/falar; resistência a todo dano; imune a veneno e doença." },
  { key: "poisoned", label: "Envenenado", effect: "Desvantagem em testes de ataque e testes de habilidade." },
  { key: "prone", label: "Caído", effect: "Só pode se mover rastejando (ou usa metade do deslocamento pra ficar em pé); desvantagem em ataques; ataques corpo a corpo contra você têm vantagem, ataques à distância têm desvantagem." },
  { key: "restrained", label: "Contido", effect: "Deslocamento 0; desvantagem em ataques e em salvamentos de DES; ataques contra você têm vantagem." },
  { key: "stunned", label: "Atordoado", effect: "Incapacitado, não pode se mover, fala confusa; falha automaticamente em salvamentos de FOR/DES; ataques contra você têm vantagem." },
  { key: "unconscious", label: "Inconsciente", effect: "Incapacitado, não pode se mover/falar, larga o que segura, cai caído; falha automaticamente em salvamentos de FOR/DES; ataques contra você têm vantagem e acertos a 1,5m são críticos automáticos." },
];
