// ------------------------------------------------------------
// Múltiplos personagens salvos
// ------------------------------------------------------------
// Cada personagem vira uma chave própria (dnd-ficha-auto-char-<id>);
// um índice (lista de ids) mantém a ordem e uma chave à parte guarda
// qual é o personagem "ativo" no momento. saveCharacter()/loadCharacter()
// continuam com a MESMA assinatura de antes (sem id) — elas só passaram
// a ler/escrever sempre no slot ativo, então todo o resto do app.js que
// já chamava saveCharacter(character) em dezenas de lugares não precisou
// mudar nada.
const LEGACY_KEY = "dnd-ficha-auto-character-v1"; // formato antigo, um personagem só
const CHAR_PREFIX = "dnd-ficha-auto-char-";
const INDEX_KEY = "dnd-ficha-auto-char-index";
const ACTIVE_KEY = "dnd-ficha-auto-active-char";

const charKey = (id) => CHAR_PREFIX + id;
function genId() { return `c${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`; }
function readIndex() { try { const v = localStorage.getItem(INDEX_KEY); const arr = v ? JSON.parse(v) : []; return Array.isArray(arr) ? arr : []; } catch { return []; } }
function writeIndex(ids) { try { localStorage.setItem(INDEX_KEY, JSON.stringify(ids)); } catch { /* modo privado */ } }

let activeId = null;
export function getActiveCharacterId() {
  if (activeId) return activeId;
  try { activeId = localStorage.getItem(ACTIVE_KEY); } catch { activeId = null; }
  return activeId;
}
export function setActiveCharacterId(id) {
  activeId = id;
  try { localStorage.setItem(ACTIVE_KEY, id); } catch { /* modo privado */ }
}

// Personagem único salvo antes desta versão (sem lista) — migra pra um
// slot próprio na primeira visita e vira o personagem ativo.
export function migrateLegacyCharacter() {
  if (readIndex().length) return;
  let legacy = null;
  try { const v = localStorage.getItem(LEGACY_KEY); legacy = v ? JSON.parse(v) : null; } catch { legacy = null; }
  if (!legacy) return;
  const id = genId();
  legacy._updatedAt = Date.now();
  try { localStorage.setItem(charKey(id), JSON.stringify(legacy)); } catch { return; }
  writeIndex([id]);
  setActiveCharacterId(id);
  try { localStorage.removeItem(LEGACY_KEY); } catch { /* ignore */ }
}

export function loadCharacterById(id) {
  try { const v = localStorage.getItem(charKey(id)); return v ? JSON.parse(v) : null; } catch { return null; }
}
export function saveCharacterAs(id, c) {
  try {
    c._updatedAt = Date.now();
    localStorage.setItem(charKey(id), JSON.stringify(c));
  } catch { return; /* modo privado / quota: não mexe no índice */ }
  const idx = readIndex();
  if (!idx.includes(id)) writeIndex([...idx, id]);
}
// Cria um slot vazio (sem personagem ainda) e devolve o id — quem chama
// decide o que salvar nele (normalmente fresh() logo em seguida).
export function createCharacterSlot() {
  const id = genId();
  writeIndex([...readIndex(), id]);
  return id;
}
export function deleteCharacterSlot(id) {
  try { localStorage.removeItem(charKey(id)); } catch { /* ignore */ }
  writeIndex(readIndex().filter((x) => x !== id));
  if (getActiveCharacterId() === id) setActiveCharacterId("");
}
// Lista pra UI "Meus Personagens" — nome/nível/classe vêm de dentro do
// próprio JSON de cada personagem (sem duplicar num índice à parte).
export function listCharacters() {
  return readIndex()
    .map((id) => {
      const c = loadCharacterById(id);
      if (!c) return null;
      return { id, name: c.name || "Personagem sem nome", level: Number(c.level) || 1, updatedAt: c._updatedAt || 0 };
    })
    .filter(Boolean)
    .sort((a, b) => b.updatedAt - a.updatedAt);
}

export function saveCharacter(c) {
  const id = getActiveCharacterId();
  if (!id) return;
  saveCharacterAs(id, c);
}
export function loadCharacter() {
  const id = getActiveCharacterId();
  return id ? loadCharacterById(id) : null;
}
export function downloadCharacter(c) {
  const blob = new Blob([JSON.stringify(c, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob), a = document.createElement("a");
  a.href = url;
  a.download = `${(c.name || "personagem").replace(/[^a-z0-9-_]+/gi, "_")}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 500);
}
export async function readCharacterFile(file) { return JSON.parse(await file.text()); }

// Última versão do banco (data/version.json → generatedAt) que o
// usuário já viu, usada para mostrar o aviso de "banco atualizado"
// só quando há de fato uma sincronização nova desde a última visita.
const VERSION_KEY = "dnd-ficha-auto-data-version-seen";
export function getSeenDataVersion() { try { return localStorage.getItem(VERSION_KEY); } catch { return null; } }
export function setSeenDataVersion(v) { try { if (v) localStorage.setItem(VERSION_KEY, v); } catch { /* modo privado */ } }

// Preferências de interface (tema claro/escuro e modo de criação guiado/livre)
// — não fazem parte do personagem, ficam soltas no navegador.
const THEME_KEY = "dnd-ficha-auto-theme";
export function getSavedTheme() { try { return localStorage.getItem(THEME_KEY); } catch { return null; } }
export function saveTheme(v) { try { localStorage.setItem(THEME_KEY, v); } catch { /* modo privado */ } }

const CREATION_MODE_KEY = "dnd-ficha-auto-creation-mode";
export function getSavedCreationMode() { try { return localStorage.getItem(CREATION_MODE_KEY) || "free"; } catch { return "free"; } }
export function saveCreationMode(v) { try { localStorage.setItem(CREATION_MODE_KEY, v); } catch { /* modo privado */ } }

// Modelos de personagem (templates) — construções reaproveitáveis
// (classe/subclasse/espécie/background/atributos/escolhas), guardadas à
// parte do personagem atual, neste navegador.
const TEMPLATES_KEY = "dnd-ficha-auto-templates-v1";
export function getTemplates() { try { const v = localStorage.getItem(TEMPLATES_KEY); return v ? JSON.parse(v) : []; } catch { return []; } }
export function saveTemplates(arr) { try { localStorage.setItem(TEMPLATES_KEY, JSON.stringify(arr || [])); } catch { /* modo privado */ } }

// Webhook do Discord pra onde as rolagens de dado são enviadas — fica
// preso a este navegador (não ao personagem nem sincronizado), já que
// cada jogador cola o link do PRÓPRIO canal/servidor. Ver sendToDiscord
// em app.js.
const DISCORD_WEBHOOK_KEY = "dnd-ficha-auto-discord-webhook";
export function getDiscordWebhook() { try { return localStorage.getItem(DISCORD_WEBHOOK_KEY) || ""; } catch { return ""; } }
export function saveDiscordWebhook(url) {
  try { url ? localStorage.setItem(DISCORD_WEBHOOK_KEY, url) : localStorage.removeItem(DISCORD_WEBHOOK_KEY); }
  catch { /* modo privado */ }
}
