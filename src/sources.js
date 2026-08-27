// ============================================================
// Fontes de dados do 5etools
// ------------------------------------------------------------
// A ficha lê os JSON oficiais direto do GitHub em tempo de
// execução. Nada de dados é versionado neste repositório.
// ============================================================

// Repositório único que cobre 2014 + 2024.
export const REPO = "5etools-mirror-3/5etools-src";
export const BRANCH = "main";

// Base primária (raw.githubusercontent) e alternativa (jsDelivr).
// Ambas enviam CORS liberado e são servidas por CDN.
export const DATA_BASES = [
  `https://raw.githubusercontent.com/${REPO}/${BRANCH}/data/`,
  `https://cdn.jsdelivr.net/gh/${REPO}@${BRANCH}/data/`,
];

// ------------------------------------------------------------
// Banco "local" — este mesmo repositório.
// ------------------------------------------------------------
// O workflow .github/workflows/sync-data.yml roda todo dia às
// 05h (horário de Brasília) e regrava data/raw/homebrew/... e
// data/version.json com o material do TheGiddyLimit/homebrew
// (classes/subclasses homebrew, entre outros). A ficha lê esses
// arquivos direto do próprio site publicado — funciona tanto no
// GitHub Pages quanto rodando localmente via `python -m http.server`,
// já que "data/" fica ao lado do index.html.
export const LOCAL_DATA_BASE = new URL("data/", document.baseURI).href;

// ------------------------------------------------------------
// Siglas de fonte que pertencem à edição de 2024 ("One D&D").
// Qualquer sigla fora desta lista é tratada como 2014, a menos
// que o próprio registro traga edition: "one" / "classic".
// ------------------------------------------------------------
export const SOURCES_2024 = new Set([
  "XPHB", // Player's Handbook (2024)
  "XDMG", // Dungeon Master's Guide (2024)
  "XMM",  // Monster Manual (2025)
  "XGE",  // (mantido em 2014 na prática — ver observação abaixo)
]);
// Observação: XGE/TCE são materiais de 2014. Mantemos apenas os
// três núcleos "X..." de 2024 aqui; o filtro fino usa o campo
// `edition` do registro quando presente.
SOURCES_2024.delete("XGE");

export function normalizeEditionTag(tag) {
  const t = String(tag || "").toLowerCase();
  if (t === "one" || t === "2024") return "2024";
  if (t === "classic" || t === "legacy" || t === "2014") return "2014";
  return null;
}

// Deriva "2014" | "2024" de um registro do 5etools.
export function editionOf(rec) {
  if (!rec) return "2014";
  const tag = normalizeEditionTag(rec.edition);
  if (tag) return tag;
  const src = String(rec.source || rec.classSource || rec.sourceId || "").toUpperCase();
  return SOURCES_2024.has(src) ? "2024" : "2014";
}

// A entidade combina com a edição escolhida?
export function editionMatches(rec, edition) {
  return editionOf(rec) === String(edition);
}
