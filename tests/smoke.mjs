// Teste rápido da camada de dados — roda em Node 18+ (fetch nativo).
//   node tests/smoke.mjs
// Baixa alguns arquivos do 5etools e confere valores conhecidos.

const BASE = "https://raw.githubusercontent.com/5etools-mirror-3/5etools-src/main/data/";
let fails = 0;
const ok = (cond, msg) => { console.log(`${cond ? "OK  " : "FALHA"} — ${msg}`); if (!cond) fails++; };
const get = async (p) => (await fetch(BASE + p)).json();

const wiz = await get("class/class-wizard.json");
const phb = wiz.class.find((c) => c.source === "PHB");
const xphb = wiz.class.find((c) => c.source === "XPHB");
ok(phb?.hd?.faces === 6, "Mago PHB tem dado de vida d6");
ok(xphb?.hd?.faces === 6, "Mago XPHB tem dado de vida d6");
ok(JSON.stringify(phb?.proficiency) === '["int","wis"]', "Mago PHB: resistências INT/WIS");
ok(xphb?.edition === "one", 'Mago XPHB traz edition:"one"');
ok(Array.isArray(wiz.classFeature) && wiz.classFeature.some((f) => f.name === "Spellcasting"), "arquivo do Mago tem classFeature Spellcasting");

const fig = await get("class/class-fighter.json");
const figPhb = fig.class.find((c) => c.source === "PHB");
ok(JSON.stringify(figPhb?.proficiency) === '["str","con"]', "Guerreiro PHB: resistências STR/CON");

const races = await get("races.json");
ok(races.race.some((r) => r.name === "Dragonborn" && r.source === "PHB"), "races.json tem Draconato (PHB)");
ok(races.race.some((r) => r.name === "Aasimar" && r.source === "XPHB"), "races.json tem Aasimar (XPHB)");

const bg = await get("backgrounds.json");
const acolyteXphb = bg.background.find((b) => b.name === "Acolyte" && b.source === "XPHB");
ok(Array.isArray(acolyteXphb?.feats), "Acólito XPHB tem talento de origem");

const sources = await get("spells/sources.json");
let wizXphb = 0, wizPhb = 0;
for (const spells of Object.values(sources)) {
  for (const info of Object.values(spells)) {
    const refs = [].concat(info.class || []);
    if (refs.some((r) => r.name === "Wizard" && r.source === "XPHB")) wizXphb++;
    if (refs.some((r) => r.name === "Wizard" && r.source === "PHB")) wizPhb++;
  }
}
ok(wizXphb > 100, `Mago 2024 tem lista de magias não vazia (${wizXphb})`);
ok(wizPhb > 100, `Mago 2014 tem lista de magias não vazia (${wizPhb})`);

console.log(fails ? `\n${fails} verificação(ões) falharam.` : "\nTudo certo.");
process.exit(fails ? 1 : 0);
