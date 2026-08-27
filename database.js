const MANIFEST = "data/manifest.json";
let catalog = null;
const fileCache = new Map();

export async function initDatabase() {
  const response = await fetch(`${MANIFEST}?v=${Date.now()}`);
  if (!response.ok) throw new Error(`Banco indisponível (${response.status})`);
  catalog = await response.json();
  return catalog;
}

export function getCatalog() {
  return catalog;
}

export function filterEntities(type, edition, content = "all") {
  if (!catalog?.entities) return [];
  return catalog.entities
    .filter(entity => {
      if (entity.type !== type) return false;
      if (entity.edition && entity.edition !== edition && entity.edition !== "both") return false;
      if (content === "official" && entity.homebrew) return false;
      if (content === "homebrew" && !entity.homebrew) return false;
      return true;
    })
    .sort((a,b) => (a.homebrew - b.homebrew) || a.name.localeCompare(b.name, "pt-BR"));
}

export async function loadEntity(entity) {
  if (!entity?.file) return entity;
  if (fileCache.has(entity.file)) return fileCache.get(entity.file);
  const response = await fetch(`data/${entity.file}`);
  if (!response.ok) return entity;
  const json = await response.json();
  fileCache.set(entity.file, json);
  return json;
}

export async function getEntityObjects(entity) {
  const json = await loadEntity(entity);
  if (!json || typeof json !== "object") return [];
  const values = [];
  for (const [key, value] of Object.entries(json)) {
    if (Array.isArray(value)) {
      for (const obj of value) {
        if (obj && typeof obj === "object" && obj.name) values.push({type:key, ...obj});
      }
    }
  }
  return values;
}
