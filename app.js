/**
 * D&D 5e Character Sheet - 5etools GitHub Data Provider & Calculation Engine
 */

// 1. GERENCIADOR DE REQUISIÇÃO E CACHE DO 5ETOOLS
class FiveEToolsDataService {
  constructor() {
    // Espelho público de dados brutos do 5etools no GitHub
    this.baseUrl = 'https://raw.githubusercontent.com/5etools-mirror-3/5etools-src/main/data';
    this.cache = new Map();
  }

  async fetchJson(endpoint) {
    if (this.cache.has(endpoint)) {
      return this.cache.get(endpoint);
    }
    try {
      const response = await fetch(`${this.baseUrl}/${endpoint}`);
      if (!response.ok) {
        throw new Error(`Falha HTTP ao carregar ${endpoint}: ${response.status}`);
      }
      const data = await response.json();
      this.cache.set(endpoint, data);
      return data;
    } catch (err) {
      console.error(`Erro ao carregar dados do 5etools (${endpoint}):`, err);
      throw err;
    }
  }

  async getRaces() {
    const data = await this.fetchJson('races.json');
    return data.race || [];
  }

  async getBackgrounds() {
    const data = await this.fetchJson('backgrounds.json');
    return data.background || [];
  }

  async getClassesIndex() {
    // O 5etools organiza classes em data/class/index.json ou classes.json
    try {
      const data = await this.fetchJson('class/index.json');
      return data;
    } catch {
      return null;
    }
  }

  async getClassDetails(classFileName) {
    return await this.fetchJson(`class/${classFileName}`);
  }

  async getSpells() {
    const data = await this.fetchJson('spells/spells-phb.json');
    return data.spell || [];
  }
}

// 2. MODELO DE REGRAS E DADOS DA FICHA
const ABILITIES = ['str', 'dex', 'con', 'int', 'wis', 'cha'];
const ABILITY_LABELS = {
  str: 'FOR', dex: 'DES', con: 'CON',
  int: 'INT', wis: 'SAB', cha: 'CAR'
};

const SKILLS = [
  { key: 'acrobatics', name: 'Acrobacia', ability: 'dex' },
  { key: 'animal_handling', name: 'Adestramento', ability: 'wis' },
  { key: 'arcana', name: 'Arcanismo', ability: 'int' },
  { key: 'athletics', name: 'Atletismo', ability: 'str' },
  { key: 'deception', name: 'Enganação', ability: 'cha' },
  { key: 'history', name: 'História', ability: 'int' },
  { key: 'insight', name: 'Intuição', ability: 'wis' },
  { key: 'intimidation', name: 'Intimidação', ability: 'cha' },
  { key: 'investigation', name: 'Investigação', ability: 'int' },
  { key: 'medicine', name: 'Medicina', ability: 'wis' },
  { key: 'nature', name: 'Natureza', ability: 'int' },
  { key: 'perception', name: 'Percepção', ability: 'wis' },
  { key: 'performance', name: 'Atuação', ability: 'cha' },
  { key: 'persuasion', name: 'Persuasão', ability: 'cha' },
  { key: 'religion', name: 'Religião', ability: 'int' },
  { key: 'sleight_of_hand', name: 'Prestidigitação', ability: 'dex' },
  { key: 'stealth', name: 'Furtividade', ability: 'dex' },
  { key: 'survival', name: 'Sobrevivência', ability: 'wis' }
];

class DndCharacter {
  constructor() {
    this.name = '';
    this.level = 1;
    this.raceData = null;
    this.classData = null;
    this.backgroundData = null;

    this.scores = { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 };
    this.proficientSaves = new Set();
    this.proficientSkills = new Set();
    this.spellsList = [];
  }

  // Bônus de Proficiência baseado no nível (D&D 5e: +2 a +6)
  get proficiencyBonus() {
    return Math.floor((this.level - 1) / 4) + 2;
  }

  // Modificador de Atributo: Math.floor((score - 10) / 2)
  getModifier(ability) {
    const score = this.scores[ability] || 10;
    return Math.floor((score - 10) / 2);
  }

  formatMod(value) {
    return value >= 0 ? `+${value}` : `${value}`;
  }

  getSaveBonus(ability) {
    const mod = this.getModifier(ability);
    return this.proficientSaves.has(ability) ? mod + this.proficiencyBonus : mod;
  }

  getSkillBonus(skillKey) {
    const skill = SKILLS.find(s => s.key === skillKey);
    if (!skill) return 0;
    const mod = this.getModifier(skill.ability);
    return this.proficientSkills.has(skillKey) ? mod + this.proficiencyBonus : mod;
  }

  calculateMaxHP() {
    if (!this.classData || !this.classData.hd) {
      return 10 + this.getModifier('con');
    }
    const hdFaces = this.classData.hd.faces || 8;
    const conMod = this.getModifier('con');
    const firstLevelHP = hdFaces + conMod;
    const avgHPPerLevel = Math.floor(hdFaces / 2) + 1 + conMod;
    
    return firstLevelHP + Math.max(0, this.level - 1) * Math.max(1, avgHPPerLevel);
  }
}

// 3. CONTROLADOR DE INTERFACE (UI)
class CharacterSheetApp {
  constructor() {
    this.service = new FiveEToolsDataService();
    this.character = new DndCharacter();
    this.allSpells = [];

    this.initElements();
    this.renderAbilityBoxes();
    this.renderSavesAndSkills();
    this.bindEvents();
    this.load5eToolsData();
  }

  initElements() {
    this.statusEl = document.getElementById('status-bar');
    this.raceSelect = document.getElementById('char-race');
    this.classSelect = document.getElementById('char-class');
    this.bgSelect = document.getElementById('char-background');
    this.levelInput = document.getElementById('char-level');
    this.profBonusInput = document.getElementById('prof-bonus');
    this.acInput = document.getElementById('armor-class');
    this.initiativeInput = document.getElementById('initiative');
    this.speedInput = document.getElementById('speed');
    this.hpMaxInput = document.getElementById('hp-max');
    this.hpCurrentInput = document.getElementById('hp-current');
    this.hitDiceInput = document.getElementById('hit-dice');
    this.spellAbilityEl = document.getElementById('spell-ability');
    this.spellDcEl = document.getElementById('spell-dc');
    this.spellAttackEl = document.getElementById('spell-attack');
    this.featuresListEl = document.getElementById('features-list');
    this.spellsContainerEl = document.getElementById('spells-container');
    this.spellSearchInput = document.getElementById('spell-search');
    this.spellLevelFilter = document.getElementById('spell-level-filter');
  }

  renderAbilityBoxes() {
    const container = document.getElementById('abilities-container');
    container.innerHTML = ABILITIES.map(ab => `
      <div class="ability-card">
        <label>${ABILITY_LABELS[ab]}</label>
        <div class="modifier" id="mod-${ab}">+0</div>
        <input type="number" id="score-${ab}" value="10" min="1" max="30">
      </div>
    `).join('');
  }

  renderSavesAndSkills() {
    const savesList = document.getElementById('saves-list');
    savesList.innerHTML = ABILITIES.map(ab => `
      <div class="save-row">
        <input type="checkbox" id="save-check-${ab}">
        <span class="save-bonus" id="save-val-${ab}">+0</span>
        <span>${ABILITY_LABELS[ab]}</span>
      </div>
    `).join('');

    const skillsList = document.getElementById('skills-list');
    skillsList.innerHTML = SKILLS.map(s => `
      <div class="skill-row">
        <input type="checkbox" id="skill-check-${s.key}">
        <span class="skill-bonus" id="skill-val-${s.key}">+0</span>
        <span>${s.name} <small style="color:#777">(${ABILITY_LABELS[s.ability]})</small></span>
      </div>
    `).join('');
  }

  bindEvents() {
    // Nível
    this.levelInput.addEventListener('input', () => {
      this.character.level = parseInt(this.levelInput.value) || 1;
      this.updateAllCalculations();
    });

    // Modificação manual de Atributos
    ABILITIES.forEach(ab => {
      document.getElementById(`score-${ab}`).addEventListener('input', (e) => {
        this.character.scores[ab] = parseInt(e.target.value) || 10;
        this.updateAllCalculations();
      });

      document.getElementById(`save-check-${ab}`).addEventListener('change', (e) => {
        if (e.target.checked) this.character.proficientSaves.add(ab);
        else this.character.proficientSaves.delete(ab);
        this.updateAllCalculations();
      });
    });

    // Checkboxes de perícias
    SKILLS.forEach(s => {
      document.getElementById(`skill-check-${s.key}`).addEventListener('change', (e) => {
        if (e.target.checked) this.character.proficientSkills.add(s.key);
        else this.character.proficientSkills.delete(s.key);
        this.updateAllCalculations();
      });
    });

    // Seleção de Raça
    this.raceSelect.addEventListener('change', () => this.handleRaceChange());

    // Seleção de Classe
    this.classSelect.addEventListener('change', () => this.handleClassChange());

    // Filtros de Magia
    this.spellSearchInput.addEventListener('input', () => this.filterSpells());
    this.spellLevelFilter.addEventListener('change', () => this.filterSpells());
  }

  async load5eToolsData() {
    try {
      this.statusEl.textContent = 'Carregando banco de dados 5etools...';

      // Carregar Raças, Classes e Magias em paralelo
      const [races, classIndex, spells, backgrounds] = await Promise.all([
        this.service.getRaces(),
        this.service.getClassesIndex(),
        this.service.getSpells(),
        this.service.getBackgrounds()
      ]);

      this.allSpells = spells;

      // Popular Raças (apenas do Player's Handbook/principais)
      this.racesData = races.filter(r => r.source === 'PHB' || !r._isBaseRace);
      this.raceSelect.innerHTML = '<option value="">-- Selecione uma Raça --</option>' +
        this.racesData.map((r, i) => `<option value="${i}">${r.name} (${r.source})</option>`).join('');

      // Popular Classes
      this.classIndexData = classIndex;
      if (classIndex) {
        const classNames = Object.keys(classIndex);
        this.classSelect.innerHTML = '<option value="">-- Selecione uma Classe --</option>' +
          classNames.map(c => `<option value="${classIndex[c]}">${c.charAt(0).toUpperCase() + c.slice(1)}</option>`).join('');
      }

      // Popular Antecedentes
      this.backgroundsData = backgrounds.filter(b => b.source === 'PHB');
      this.bgSelect.innerHTML = '<option value="">-- Selecione um Antecedente --</option>' +
        this.backgroundsData.map((b, i) => `<option value="${i}">${b.name}</option>`).join('');

      this.statusEl.textContent = 'Dados do 5etools carregados com sucesso!';
      this.statusEl.style.backgroundColor = '#22543d';
    } catch (err) {
      this.statusEl.textContent = 'Erro ao conectar ao GitHub do 5etools. Verifique a conexão.';
      this.statusEl.style.backgroundColor = '#742a2a';
    }
  }

  handleRaceChange() {
    const index = this.raceSelect.value;
    if (index === '') return;
    const race = this.racesData[index];
    this.character.raceData = race;

    // Velocidade
    const speed = race.speed ? (typeof race.speed === 'object' ? race.speed.walk : race.speed) : 30;
    this.speedInput.value = `${speed} ft`;

    this.renderFeatures();
    this.updateAllCalculations();
  }

  async handleClassChange() {
    const fileName = this.classSelect.value;
    if (!fileName) return;

    this.statusEl.textContent = 'Carregando detalhes da classe...';
    try {
      const fullClassData = await this.service.getClassDetails(fileName);
      const mainClass = fullClassData.class ? fullClassData.class[0] : null;
      this.character.classData = mainClass;

      if (mainClass) {
        // Salvaguardas automáticas da classe
        this.character.proficientSaves.clear();
        if (mainClass.proficiency) {
          mainClass.proficiency.forEach(p => {
            const abKey = p.toLowerCase();
            this.character.proficientSaves.add(abKey);
            const checkEl = document.getElementById(`save-check-${abKey}`);
            if (checkEl) checkEl.checked = true;
          });
        }

        // Dados de vida
        if (mainClass.hd) {
          this.hitDiceInput.value = `${this.character.level}d${mainClass.hd.faces}`;
        }
      }

      this.statusEl.textContent = 'Classe atualizada!';
      this.renderFeatures();
      this.filterSpells();
      this.updateAllCalculations();
    } catch (err) {
      this.statusEl.textContent = 'Erro ao buscar detalhes da classe.';
    }
  }

  updateAllCalculations() {
    const pb = this.character.proficiencyBonus;
    this.profBonusInput.value = `+${pb}`;

    // Atualiza modificadores e caixas de atributos
    ABILITIES.forEach(ab => {
      const mod = this.character.getModifier(ab);
      document.getElementById(`mod-${ab}`).textContent = this.character.formatMod(mod);

      // Salvaguarda
      const saveVal = this.character.getSaveBonus(ab);
      document.getElementById(`save-val-${ab}`).textContent = this.character.formatMod(saveVal);
    });

    // Atualiza Perícias
    SKILLS.forEach(s => {
      const skillVal = this.character.getSkillBonus(s.key);
      document.getElementById(`skill-val-${s.key}`).textContent = this.character.formatMod(skillVal);
    });

    // Iniciativa (= Modificador de Destreza)
    const dexMod = this.character.getModifier('dex');
    this.initiativeInput.value = this.character.formatMod(dexMod);

    // HP Máximo e Atual
    const calculatedHp = this.character.calculateMaxHP();
    this.hpMaxInput.value = calculatedHp;
    this.hpCurrentInput.value = calculatedHp;

    // Estatísticas de Conjuração
    this.updateSpellcastingStats();
  }

  updateSpellcastingStats() {
    const cData = this.character.classData;
    if (!cData || !cData.spellcastingAbility) {
      this.spellAbilityEl.textContent = '-';
      this.spellDcEl.textContent = '-';
      this.spellAttackEl.textContent = '-';
      return;
    }

    const ability = cData.spellcastingAbility.toLowerCase();
    const mod = this.character.getModifier(ability);
    const pb = this.character.proficiencyBonus;

    this.spellAbilityEl.textContent = ABILITY_LABELS[ability] || ability.toUpperCase();
    this.spellDcEl.textContent = 8 + pb + mod;
    this.spellAttackEl.textContent = this.character.formatMod(pb + mod);
  }

  renderFeatures() {
    const features = [];
    if (this.character.raceData && this.character.raceData.entries) {
      features.push({ title: `Traços Raciais (${this.character.raceData.name})`, desc: 'Consulte os traços no 5etools.' });
    }
    if (this.character.classData) {
      features.push({ title: `Habilidades de Classe (${this.character.classData.name})`, desc: `Dado de Vida: d${this.character.classData.hd.faces}` });
    }

    if (features.length === 0) {
      this.featuresListEl.innerHTML = '<p class="placeholder-text">Nenhuma característica selecionada.</p>';
      return;
    }

    this.featuresListEl.innerHTML = features.map(f => `
      <div class="feature-item">
        <h4>${f.title}</h4>
        <p>${f.desc}</p>
      </div>
    `).join('');
  }

  filterSpells() {
    const query = this.spellSearchInput.value.toLowerCase();
    const level = this.spellLevelFilter.value;
    const className = this.character.classData ? this.character.classData.name.toLowerCase() : '';

    let filtered = this.allSpells.filter(spell => {
      const matchesQuery = spell.name.toLowerCase().includes(query);
      const matchesLevel = level === 'all' || spell.level === parseInt(level);
      return matchesQuery && matchesLevel;
    });

    if (filtered.length === 0) {
      this.spellsContainerEl.innerHTML = '<p class="placeholder-text">Nenhuma magia encontrada com esses filtros.</p>';
      return;
    }

    this.spellsContainerEl.innerHTML = filtered.slice(0, 30).map(s => `
      <div class="spell-item">
        <h4>${s.name} <small>(${s.level === 0 ? 'Truque' : s.level + 'º Círculo'} - ${s.school})</small></h4>
        <p><strong>Tempo:</strong> ${s.time ? s.time[0].number + ' ' + s.time[0].unit : '-'}</p>
      </div>
    `).join('');
  }
}

// Inicializa a aplicação ao carregar o DOM
document.addEventListener('DOMContentLoaded', () => {
  new CharacterSheetApp();
});
