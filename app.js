const ABILITIES = ['str', 'dex', 'con', 'int', 'wis', 'cha'];
const ABILITY_LABELS = { str: 'FOR (STR)', dex: 'DES (DEX)', con: 'CON (CON)', int: 'INT (INT)', wis: 'SAB (WIS)', cha: 'CAR (CHA)' };
const SKILLS = [
  { key: 'acrobatics', name: 'Acrobacia', ability: 'dex' },
  { key: 'animal_handling', name: 'Adestrar Animais', ability: 'wis' },
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

class FiveEToolsDataService {
  constructor() {
    this.cache = new Map();
    // A correção está aqui: Utilizando CDN jsDelivr para ignorar o bloqueio CORS do navegador
    this.endpoints = {
      '2014': 'https://cdn.jsdelivr.net/gh/5etools-mirror-3/5etools-2014-src@main/data',
      '2024': 'https://cdn.jsdelivr.net/gh/5etools-mirror-3/5etools-src@main/data'
    };
    this.currentVersion = '2014';
  }
  
  setVersion(version) {
    this.currentVersion = version;
    this.cache.clear(); // Limpa cache antigo para forçar o download dos livros novos
  }
  
  get baseUrl() { return this.endpoints[this.currentVersion]; }

  async fetchJson(endpoint) {
    if (this.cache.has(endpoint)) return this.cache.get(endpoint);
    try {
      const response = await fetch(`${this.baseUrl}/${endpoint}`);
      if (!response.ok) throw new Error(`Falha HTTP ao carregar ${endpoint}: ${response.status}`);
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
    try { return await this.fetchJson('class/index.json'); }
    catch { return null; }
  }
  async getClassDetails(classFileName) {
    return await this.fetchJson(`class/${classFileName}`);
  }
}

class CharacterSheetApp {
  constructor() {
    this.service = new FiveEToolsDataService();
    this.scores = { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 };
    this.proficientSaves = new Set();
    this.proficientSkills = new Set();
    this.level = 1;
    this.classData = null;
    this.raceData = null;

    this.initUI();
    this.bindEvents();
    this.loadData();
  }

  initUI() {
    const attrContainer = document.getElementById('attributes-container');
    attrContainer.innerHTML = ABILITIES.map(ab => `
      <div class="attr-card">
        <label>${ABILITY_LABELS[ab]}</label>
        <input type="number" id="score-${ab}" value="10" min="1" max="30">
        <span class="attr-mod" id="mod-${ab}">+0</span>
      </div>
    `).join('');

    const savesList = document.getElementById('saves-list');
    savesList.innerHTML = ABILITIES.map(ab => `
      <div class="list-item">
        <label><input type="checkbox" id="save-check-${ab}"> ${ABILITY_LABELS[ab].split(' ')[0]}</label>
        <span class="mod" id="save-val-${ab}">+0</span>
      </div>
    `).join('');

    const skillsList = document.getElementById('skills-list');
    skillsList.innerHTML = SKILLS.map(s => `
      <div class="list-item">
        <label><input type="checkbox" id="skill-check-${s.key}"> ${s.name} <small style="color:#777">(${s.ability.toUpperCase()})</small></label>
        <span class="mod" id="skill-val-${s.key}">+0</span>
      </div>
    `).join('');
  }

  bindEvents() {
    document.getElementById('rules-version').addEventListener('change', (e) => {
      this.service.setVersion(e.target.value);
      this.loadData();
    });

    document.getElementById('char-level').addEventListener('input', (e) => {
      this.level = parseInt(e.target.value) || 1;
      this.updateCalculations();
    });

    document.getElementById('char-class').addEventListener('change', async (e) => {
      const fileName = e.target.value;
      if (!fileName) return;
      try {
        const data = await this.service.getClassDetails(fileName);
        this.classData = data.class ? data.class[0] : null;
        if (this.classData && this.classData.hd) {
          document.getElementById('hit-dice').value = `d${this.classData.hd.faces}`;
        }
        
        this.proficientSaves.clear();
        if (this.classData && this.classData.proficiency) {
          this.classData.proficiency.forEach(p => {
            this.proficientSaves.add(p.toLowerCase());
            const el = document.getElementById(`save-check-${p.toLowerCase()}`);
            if (el) el.checked = true;
          });
        }
        this.updateCalculations();
      } catch (err) {
        console.error(err);
      }
    });

    document.getElementById('char-race').addEventListener('change', (e) => {
      const idx = e.target.value;
      if (idx !== "") {
        this.raceData = this.racesList[idx];
        if (this.raceData && this.raceData.speed) {
          const spd = typeof this.raceData.speed === 'number' ? this.raceData.speed : (this.raceData.speed.walk || 30);
          document.getElementById('speed').value = `${spd} ft`;
        }
      }
    });

    ABILITIES.forEach(ab => {
      document.getElementById(`score-${ab}`).addEventListener('input', (e) => {
        this.scores[ab] = parseInt(e.target.value) || 10;
        this.updateCalculations();
      });
      document.getElementById(`save-check-${ab}`).addEventListener('change', (e) => {
        if(e.target.checked) this.proficientSaves.add(ab);
        else this.proficientSaves.delete(ab);
        this.updateCalculations();
      });
    });

    SKILLS.forEach(s => {
      document.getElementById(`skill-check-${s.key}`).addEventListener('change', (e) => {
        if(e.target.checked) this.proficientSkills.add(s.key);
        else this.proficientSkills.delete(s.key);
        this.updateCalculations();
      });
    });
  }

  async loadData() {
    const statusEl = document.getElementById('status-bar');
    statusEl.textContent = "Baixando livros da " + (this.service.currentVersion === '2024' ? 'Edição 2024' : 'Edição 2014') + "...";
    statusEl.className = "status-bar loading";

    try {
      const [races, classIndex, backgrounds] = await Promise.all([
        this.service.getRaces(),
        this.service.getClassesIndex(),
        this.service.getBackgrounds()
      ]);

      // Popula Raças
      this.racesList = races.filter(r => r.source === 'PHB' || r.source === 'XPHB' || !r._isBaseRace);
      const raceSelect = document.getElementById('char-race');
      raceSelect.innerHTML = '<option value="">Selecione uma raça...</option>' + 
        this.racesList.map((r, i) => `<option value="${i}">${r.name}</option>`).join('');

      // Popula Classes
      if (classIndex) {
        const classSelect = document.getElementById('char-class');
        classSelect.innerHTML = '<option value="">Selecione uma classe...</option>' + 
          Object.keys(classIndex).map(c => `<option value="${classIndex[c]}">${c.charAt(0).toUpperCase() + c.slice(1)}</option>`).join('');
      }

      // Popula Antecedentes
      const bgs = backgrounds.filter(b => b.source === 'PHB' || b.source === 'XPHB');
      const bgSelect = document.getElementById('char-background');
      bgSelect.innerHTML = '<option value="">Selecione um antecedente...</option>' + 
        bgs.map(b => `<option value="${b.name}">${b.name}</option>`).join('');

      statusEl.textContent = "✓ Dados Carregados e Sincronizados!";
      statusEl.className = "status-bar success";
      this.updateCalculations();

    } catch (err) {
      statusEl.textContent = "❌ Erro ao baixar dados do 5eTools.";
      statusEl.className = "status-bar error";
    }
  }

  updateCalculations() {
    const pb = Math.floor((this.level - 1) / 4) + 2;
    document.getElementById('prof-bonus').value = `+${pb}`;

    const getMod = score => Math.floor((score - 10) / 2);
    const formatMod = mod => mod >= 0 ? `+${mod}` : `${mod}`;

    ABILITIES.forEach(ab => {
      const mod = getMod(this.scores[ab]);
      document.getElementById(`mod-${ab}`).textContent = formatMod(mod);

      let saveTotal = mod;
      if (this.proficientSaves.has(ab)) saveTotal += pb;
      document.getElementById(`save-val-${ab}`).textContent = formatMod(saveTotal);
    });

    let percMod = 0;
    SKILLS.forEach(s => {
      const baseMod = getMod(this.scores[s.ability]);
      let skillTotal = baseMod;
      if (this.proficientSkills.has(s.key)) skillTotal += pb;
      document.getElementById(`skill-val-${s.key}`).textContent = formatMod(skillTotal);

      if (s.key === 'perception') percMod = skillTotal;
    });

    document.getElementById('passive-perception').value = 10 + percMod;
    
    const dexMod = getMod(this.scores.dex);
    document.getElementById('initiative').value = formatMod(dexMod);
    document.getElementById('armor-class').value = 10 + dexMod;

    const conMod = getMod(this.scores.con);
    if (this.classData && this.classData.hd) {
      const hd = this.classData.hd.faces || 8;
      const totalHp = (hd + conMod) + (this.level - 1) * (Math.floor(hd / 2) + 1 + conMod);
      document.getElementById('hp-max').value = Math.max(1, totalHp);
    }
  }
}

document.addEventListener('DOMContentLoaded', () => {
  new CharacterSheetApp();
});
