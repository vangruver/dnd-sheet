// Configuração das URLs dos dados no GitHub (via jsDelivr CDN para evitar rate limits e problemas de CORS no GitHub Pages)
const DATA_SOURCES = {
  "2024": "https://cdn.jsdelivr.net/gh/5etools-mirror-3/5etools-src@main/data/",
  "2014": "https://cdn.jsdelivr.net/gh/5etools-mirror-3/5etools-2014-src@main/data/"
};

// Lista de perícias padrão do D&D 5e e seus atributos associados
const SKILLS = [
  { name: "Acrobacia (Acrobatics)", attr: "dex" },
  { name: "Adestrar Animais (Animal Handling)", attr: "wis" },
  { name: "Arcanismo (Arcana)", attr: "int" },
  { name: "Atletismo (Athletics)", attr: "str" },
  { name: "Atuação (Performance)", attr: "cha" },
  { name: "Blefar (Deception)", attr: "cha" },
  { name: "Furtividade (Stealth)", attr: "dex" },
  { name: "História (History)", attr: "int" },
  { name: "Intimidação (Intimidation)", attr: "cha" },
  { name: "Intuição (Insight)", attr: "wis" },
  { name: "Investigação (Investigation)", attr: "int" },
  { name: "Medicina (Medicine)", attr: "wis" },
  { name: "Natureza (Nature)", attr: "int" },
  { name: "Percepção (Perception)", attr: "wis" },
  { name: "Persuasão (Persuasion)", attr: "cha" },
  { name: "Prestidigitação (Sleight of Hand)", attr: "dex" },
  { name: "Religião (Religion)", attr: "int" },
  { name: "Sobrevivência (Survival)", attr: "wis" }
];

let rawData = {
  classes: [],
  races: [],
  backgrounds: []
};

// Inicialização
document.addEventListener("DOMContentLoaded", () => {
  renderSkills();
  bindEvents();
  loadEditionData("2024");
});

// Vincula todos os inputs e selects
function bindEvents() {
  document.getElementById("editionSelect").addEventListener("change", (e) => {
    loadEditionData(e.target.value);
  });

  // Atualização em cascata de atributos
  ["str", "dex", "con", "int", "wis", "cha"].forEach(attr => {
    document.getElementById(`attr-${attr}`).addEventListener("input", recalculateAll);
  });

  document.getElementById("charLevel").addEventListener("input", () => {
    updateProficiencyBonus();
    recalculateAll();
  });

  document.getElementById("charClass").addEventListener("change", onClassSelect);
  document.getElementById("charRace").addEventListener("change", onRaceSelect);
}

// Renderiza a lista de perícias
function renderSkills() {
  const container = document.getElementById("skillsContainer");
  container.innerHTML = "";

  SKILLS.forEach((skill, index) => {
    const div = document.createElement("div");
    div.className = "skill-item";
    div.innerHTML = `
      <input type="checkbox" id="skill-check-${index}" data-attr="${skill.attr}">
      <span class="skill-name">${skill.name}</span>
      <span class="skill-mod" id="skill-val-${index}">+0</span>
    `;
    div.querySelector("input").addEventListener("change", recalculateAll);
    container.appendChild(div);
  });
}

// Carrega os dados da edição selecionada
async function loadEditionData(edition) {
  const statusEl = document.getElementById("loadingStatus");
  statusEl.textContent = `Carregando dados (${edition})...`;
  statusEl.style.color = "var(--text-muted)";

  const baseUrl = DATA_SOURCES[edition] || DATA_SOURCES["2024"];

  try {
    const [classesRes, racesRes, bgRes] = await Promise.all([
      fetch(`${baseUrl}classes.json`).catch(() => fetch(`${baseUrl}class/index.json`)),
      fetch(`${baseUrl}races.json`),
      fetch(`${baseUrl}backgrounds.json`)
    ]);

    const classesData = await classesRes.json();
    const racesData = await racesRes.json();
    const bgData = await bgRes.json();

    rawData.classes = classesData.class || [];
    rawData.races = racesData.race || [];
    rawData.backgrounds = bgData.background || [];

    populateSelect("charClass", rawData.classes.map(c => ({ name: c.name, value: c.name })));
    populateSelect("charRace", rawData.races.map(r => ({ name: r.name, value: r.name })));
    populateSelect("charBackground", rawData.backgrounds.map(b => ({ name: b.name, value: b.name })));

    statusEl.textContent = `Online (${edition})`;
    statusEl.style.color = "#43d692";
  } catch (err) {
    console.error("Erro ao carregar dados do 5etools:", err);
    statusEl.textContent = "Erro ao carregar dados";
    statusEl.style.color = "#e0443e";
  }
}

function populateSelect(elementId, items) {
  const select = document.getElementById(elementId);
  const currentValue = select.value;
  select.innerHTML = `<option value="">Selecione...</option>`;
  
  // Remove duplicados e ordena por nome
  const uniqueItems = Array.from(new Set(items.map(i => i.name)))
    .sort()
    .map(name => items.find(i => i.name === name));

  uniqueItems.forEach(item => {
    const opt = document.createElement("option");
    opt.value = item.value;
    opt.textContent = item.name;
    select.appendChild(opt);
  });

  if (currentValue) select.value = currentValue;
}

// Ações ao selecionar Classe
function onClassSelect() {
  const selectedName = document.getElementById("charClass").value;
  const cls = rawData.classes.find(c => c.name === selectedName);
  if (!cls) return;

  if (cls.hd) {
    document.getElementById("hitDie").value = `d${cls.hd.faces || 8}`;
  }

  updateHp();
  updateFeatures();
}

// Ações ao selecionar Raça
function onRaceSelect() {
  const selectedName = document.getElementById("charRace").value;
  const race = rawData.races.find(r => r.name === selectedName);
  if (!race) return;

  if (race.speed) {
    const speed = typeof race.speed === "object" ? race.speed.walk || 30 : race.speed;
    document.getElementById("charSpeed").value = `${speed} ft`;
  }

  updateFeatures();
}

// Atualização de bônus e modificadores
function getModifier(score) {
  return Math.floor((score - 10) / 2);
}

function formatMod(val) {
  return val >= 0 ? `+${val}` : `${val}`;
}

function updateProficiencyBonus() {
  const level = parseInt(document.getElementById("charLevel").value, 10) || 1;
  const prof = Math.ceil(1 + level / 4);
  document.getElementById("profBonus").value = formatMod(prof);
}

function updateHp() {
  const level = parseInt(document.getElementById("charLevel").value, 10) || 1;
  const conScore = parseInt(document.getElementById("attr-con").value, 10) || 10;
  const conMod = getModifier(conScore);
  const hitDieStr = document.getElementById("hitDie").value.replace("d", "");
  const hitDieVal = parseInt(hitDieStr, 10) || 8;

  // Cálculo padrão: Dado máximo no nível 1 + média nos níveis subsequentes
  const avgGain = Math.floor(hitDieVal / 2) + 1;
  const maxHp = (hitDieVal + conMod) + (level - 1) * (avgGain + conMod);
  document.getElementById("maxHp").value = Math.max(1, maxHp);
}

function recalculateAll() {
  const profStr = document.getElementById("profBonus").value;
  const profBonus = parseInt(profStr, 10) || 2;

  // Atualiza modificadores dos atributos
  const mods = {};
  ["str", "dex", "con", "int", "wis", "cha"].forEach(attr => {
    const score = parseInt(document.getElementById(`attr-${attr}`).value, 10) || 10;
    const mod = getModifier(score);
    mods[attr] = mod;
    document.getElementById(`mod-${attr}`).textContent = formatMod(mod);
  });

  // Iniciativa e CA básica
  document.getElementById("initiative").value = formatMod(mods.dex);
  document.getElementById("armorClass").value = 10 + mods.dex;

  // Atualiza Perícias
  SKILLS.forEach((skill, index) => {
    const isProf = document.getElementById(`skill-check-${index}`).checked;
    const total = mods[skill.attr] + (isProf ? profBonus : 0);
    document.getElementById(`skill-val-${index}`).textContent = formatMod(total);
  });

  // Percepção Passiva (10 + Mod Sabedoria + Proficiência se marcada)
  const perceptionIndex = SKILLS.findIndex(s => s.name.includes("Percepção"));
  const isPerceptionProf = perceptionIndex !== -1 && document.getElementById(`skill-check-${perceptionIndex}`).checked;
  const passivePerc = 10 + mods.wis + (isPerceptionProf ? profBonus : 0);
  document.getElementById("passivePerception").value = passivePerc;

  updateHp();
}

function updateFeatures() {
  const className = document.getElementById("charClass").value;
  const raceName = document.getElementById("charRace").value;
  const bgName = document.getElementById("charBackground").value;

  const display = document.getElementById("featuresDisplay");
  display.innerHTML = "";

  if (!className && !raceName && !bgName) {
    display.innerHTML = "<p>Selecione opções acima para carregar traços automáticos.</p>";
    return;
  }

  let html = "";
  if (className) html += `<p><strong>Classe Selecionada:</strong> ${className}</p>`;
  if (raceName) html += `<p><strong>Raça Selecionada:</strong> ${raceName}</p>`;
  if (bgName) html += `<p><strong>Antecedente Selecionado:</strong> ${bgName}</p>`;

  display.innerHTML = html;
}
