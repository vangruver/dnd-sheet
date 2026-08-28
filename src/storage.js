const KEY = "dnd-ficha-auto-character-v1";

export function saveCharacter(c) { try { localStorage.setItem(KEY, JSON.stringify(c)); } catch { /* modo privado */ } }
export function loadCharacter() { try { const v = localStorage.getItem(KEY); return v ? JSON.parse(v) : null; } catch { return null; } }
export function clearCharacter() { try { localStorage.removeItem(KEY); } catch { /* ignore */ } }
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
