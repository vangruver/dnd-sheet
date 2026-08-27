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
