const KEY = "dnd-sheet-character-v2";

export function saveCharacter(character) {
  localStorage.setItem(KEY, JSON.stringify(character));
}

export function loadCharacter() {
  try {
    const value = localStorage.getItem(KEY);
    return value ? JSON.parse(value) : null;
  } catch {
    return null;
  }
}

export function clearCharacter() {
  localStorage.removeItem(KEY);
}

export function downloadCharacter(character) {
  const blob = new Blob([JSON.stringify(character, null, 2)], {type:"application/json"});
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${(character.name || "personagem").replace(/[^a-z0-9-_]+/gi,"_")}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

export async function readCharacterFile(file) {
  return JSON.parse(await file.text());
}
