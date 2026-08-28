import fs from "node:fs/promises";
import path from "node:path";
import { execFileSync } from "node:child_process";

const ROOT = process.cwd();
const WORK = path.join(ROOT, ".sync-work");
const OUT = path.join(ROOT, "data");

// ============================================================
// FONTES
// ============================================================

const SOURCES = [
  {
    key: "2024",
    url: "https://github.com/5etools-mirror-3/5etools-src.git",
    type: "official",
    edition: "2024",
  },
  {
    key: "2014",
    url: "https://github.com/5etools-mirror-3/5etools-2014-src.git",
    type: "official",
    edition: "2014",
  },
  {
    key: "homebrew",
    url: "https://github.com/TheGiddyLimit/homebrew.git",
    type: "homebrew",
    edition: "both",
  },
  {
    // Conteúdo de pré-lançamento (Unearthed Arcana e outros playtests) —
    // repositório irmão do homebrew, mesma estrutura de pastas. Fica
    // separado do homebrew (entity.prerelease em vez de entity.homebrew)
    // pra podermos rotular diferente na ficha ("Pré-lançamento").
    key: "prerelease",
    url: "https://github.com/TheGiddyLimit/unearthed-arcana.git",
    type: "prerelease",
    edition: "both",
  },
];

// ============================================================
// TIPOS QUE NOS INTERESSAM
// ============================================================

const TYPES = [
  "class",
  "subclass",
  "race",
  "subrace",
  "background",
  "spell",
  "feat",
  "item",
  "optionalfeature",
  "reward",
  "variantrule",
];

// Pastas do homebrew/prerelease que valem a pena vasculhar. Além de uma
// pasta por TYPE (class/, spell/...), esses repositórios têm uma pasta
// "collection/" com sourcebooks completos num único JSON (várias classes,
// magias, talentos etc. juntos — é onde ficam coisas como "Ryoko's Guide
// to the Yokai Realms" e "Vampire the Masquerade: Bound by Blood", que
// não tinham pasta própria e por isso nunca eram lidas).
const BREW_WALK_FOLDERS = [...TYPES, "collection"];

// ============================================================
// FUNÇÕES AUXILIARES
// ============================================================

async function removeDirectory(directory) {
  await fs.rm(directory, {
    recursive: true,
    force: true,
  });
}

async function makeDirectory(directory) {
  await fs.mkdir(directory, {
    recursive: true,
  });
}

function cloneRepository(url, destination) {
  console.log("");
  console.log("==================================================");
  console.log("Baixando:");
  console.log(url);
  console.log("==================================================");
  console.log("");

  execFileSync(
    "git",
    [
      "clone",
      "--depth",
      "1",
      url,
      destination,
    ],
    {
      stdio: "inherit",
    }
  );
}

async function walkDirectory(directory) {
  const result = [];

  let entries;

  try {
    entries = await fs.readdir(directory, {
      withFileTypes: true,
    });
  } catch {
    return result;
  }

  for (const entry of entries) {
    const fullPath = path.join(
      directory,
      entry.name
    );

    if (entry.isDirectory()) {
      const nested = await walkDirectory(fullPath);
      result.push(...nested);
      continue;
    }

    if (entry.isFile() && entry.name.endsWith(".json")) {
      result.push(fullPath);
    }
  }

  return result;
}

async function readJson(file) {
  try {
    const content = await fs.readFile(
      file,
      "utf8"
    );

    return JSON.parse(content);
  } catch {
    return null;
  }
}

function normalizeId(type, object, file) {
  const source =
    object?.source ||
    object?._meta?.sources?.[0] ||
    "UNKNOWN";

  const name =
    object?.name ||
    "UNKNOWN";

  return [
    type,
    source,
    name,
    file,
  ].join(":");
}

// ============================================================
// DETECTAR TIPOS DENTRO DOS JSONs
// ============================================================

function extractObjectsFromJson(
  json,
  sourceInfo,
  relativeFile
) {
  const entities = [];

  if (!json || typeof json !== "object") {
    return entities;
  }

  for (const type of TYPES) {
    let array = null;

    // Formato normal do 5eTools:
    //
    // {
    //   "spell": [...]
    // }
    //
    if (Array.isArray(json[type])) {
      array = json[type];
    }

    // Algumas estruturas podem utilizar plural.
    if (
      !array &&
      Array.isArray(json[`${type}s`])
    ) {
      array = json[`${type}s`];
    }

    // "item" também aparece como "baseitem" (itens mundanos, sem magia) —
    // mesmo formato do catálogo oficial. Sem isso, um arquivo que só
    // tivesse "baseitem" (sem "item") não era detectado como tendo
    // conteúdo do tipo item.
    if (
      !array &&
      type === "item" &&
      Array.isArray(json.baseitem)
    ) {
      array = json.baseitem;
    }

    if (!array) {
      continue;
    }

    for (const object of array) {
      if (
        !object ||
        typeof object !== "object" ||
        !object.name
      ) {
        continue;
      }

      entities.push({
        id: normalizeId(
          type,
          object,
          relativeFile
        ),

        type,

        name: object.name,

        source:
          object.source ||
          object._meta?.sources?.[0] ||
          "",

        homebrew:
          sourceInfo.type === "homebrew",

        prerelease:
          sourceInfo.type === "prerelease",

        external:
          sourceInfo.type === "external",

        edition:
          sourceInfo.edition,

        file:
          relativeFile,

        classes:
          extractClasses(object),

        className:
          object.className ||
          null,

        classSource:
          object.classSource ||
          null,

        hd:
          object.hd ||
          null,

        spellcastingAbility:
          object.spellcastingAbility ||
          null,
      });
    }
  }

  return entities;
}

// ============================================================
// EXTRAIR CLASSES ASSOCIADAS À MAGIA
// ============================================================

function extractClasses(object) {
  const result = [];

  if (
    Array.isArray(object?.classes)
  ) {
    for (const classObject of object.classes) {
      if (typeof classObject === "string") {
        result.push(classObject);
      } else if (
        classObject &&
        typeof classObject === "object" &&
        classObject.name
      ) {
        result.push(classObject.name);
      }
    }
  }

  if (
    object?.classes?.fromClassList &&
    Array.isArray(
      object.classes.fromClassList
    )
  ) {
    for (
      const classObject
      of object.classes.fromClassList
    ) {
      if (
        classObject &&
        typeof classObject === "object" &&
        classObject.name
      ) {
        result.push(classObject.name);
      }
    }
  }

  return [
    ...new Set(result),
  ];
}

// ============================================================
// PROCESSAR REPOSITÓRIO OFICIAL
// ============================================================

async function processOfficialRepository(
  repository,
  sourceInfo
) {
  const dataDirectory =
    path.join(repository, "data");

  const files =
    await walkDirectory(
      dataDirectory
    );

  console.log("");
  console.log(
    `Encontrados ${files.length} JSONs em ${sourceInfo.key}.`
  );
  console.log("");

  const entities = [];

  for (const file of files) {
    const json =
      await readJson(file);

    if (!json) {
      continue;
    }

    const relative =
      path.relative(
        dataDirectory,
        file
      );

    const target =
      path
        .join(
          "raw",
          sourceInfo.key,
          relative
        )
        .replaceAll(
          path.sep,
          "/"
        );

    const extracted =
      extractObjectsFromJson(
        json,
        sourceInfo,
        target
      );

    entities.push(
      ...extracted
    );

    if (extracted.length > 0) {
      console.log(
        `${sourceInfo.key}: ${relative} → ${extracted.length} entidades`
      );
    }
  }

  return entities;
}

// ============================================================
// PROCESSAR HOMEBREW / PRERELEASE
// ============================================================
//
// Nenhum dos dois usa "data/spell/..." como o repositório oficial —
// ambos têm as pastas (spell/, subclass/, race/, background/... e
// "collection/", com sourcebooks completos num único JSON) direto na
// raiz. Por isso são tratados separadamente do repositório oficial,
// mas com a MESMA função (mesma estrutura nos dois repositórios).
// ============================================================

async function processHomebrewRepository(
  repository,
  sourceInfo
) {
  const entities = [];
  const label = sourceInfo.type === "prerelease" ? "Prerelease" : "Homebrew";

  for (const type of BREW_WALK_FOLDERS) {
    const directory =
      path.join(
        repository,
        type
      );

    let exists = true;

    try {
      await fs.access(directory);
    } catch {
      exists = false;
    }

    if (!exists) {
      continue;
    }

    const files =
      await walkDirectory(
        directory
      );

    console.log("");
    console.log(
      `${label} / ${type}: ${files.length} arquivos`
    );

    for (const file of files) {
      const json =
        await readJson(file);

      if (!json) {
        continue;
      }

      const relative =
        path.relative(
          repository,
          file
        );

      const target =
        path
          .join(
            "raw",
            sourceInfo.key,
            relative
          )
          .replaceAll(
            path.sep,
            "/"
          );

      const extracted =
        extractObjectsFromJson(
          json,
          sourceInfo,
          target
        );

      entities.push(
        ...extracted
      );

      if (
        extracted.length > 0
      ) {
        console.log(
          `${label}: ${relative} → ${extracted.length} entidades`
        );
      }
    }
  }

  return entities;
}

// ============================================================
// COPIAR ARQUIVO JSON PARA O NOSSO DATA/
// ============================================================

function isBrewLike(sourceInfo) {
  return sourceInfo.type === "homebrew" || sourceInfo.type === "prerelease";
}

// ============================================================
// CONTEÚDO EXTERNO (adicionado manualmente, fora do GitHub)
// ------------------------------------------------------------
// data/raw/external/ guarda conversões que não vêm de nenhum dos 4
// repositórios acima (ex.: um PDF de homebrew convertido pra JSON sob
// pedido do usuário). Como main() apaga TODO o diretório data/ antes de
// reconstruí-lo a partir dos clones git, esta pasta precisa ser copiada
// pra fora (snapshotExternalContent) ANTES da limpeza e devolvida ao
// lugar (restoreExternalContent) depois — senão sumiria a cada
// sincronização, já que não existe em nenhum repositório remoto.
// Mesma estrutura de pastas do homebrew/prerelease (uma por TYPE +
// "collection/"), processada pela mesma processHomebrewRepository.
// ============================================================

const EXTERNAL_KEY = "external";
const EXTERNAL_DIR_REL = path.join("raw", EXTERNAL_KEY);

async function snapshotExternalContent() {
  const directory = path.join(OUT, EXTERNAL_DIR_REL);
  const files = await walkDirectory(directory);
  const snapshot = [];

  for (const file of files) {
    const relative = path.relative(OUT, file);
    const content = await fs.readFile(file, "utf8");
    snapshot.push({ relative, content });
  }

  return snapshot;
}

async function restoreExternalContent(snapshot) {
  for (const { relative, content } of snapshot) {
    const destination = path.join(OUT, relative);
    await makeDirectory(path.dirname(destination));
    await fs.writeFile(destination, content, "utf8");
  }
}

async function copyJsonFiles(
  repository,
  sourceInfo
) {
  const sourceRoot =
    isBrewLike(sourceInfo)
      ? repository
      : path.join(
          repository,
          "data"
        );

  const files =
    await walkDirectory(
      sourceRoot
    );

  for (const file of files) {
    const relative =
      path.relative(
        sourceRoot,
        file
      );

    // Para Homebrew/Prerelease, só copiamos as pastas que interessam
    // (uma por tipo + "collection/", ver BREW_WALK_FOLDERS) — os dois
    // repositórios também têm pastas de aventura/monstro/etc. que esta
    // ficha não usa.
    if (
      isBrewLike(sourceInfo)
    ) {
      const firstPart =
        relative.split(
          path.sep
        )[0];

      if (
        !BREW_WALK_FOLDERS.includes(
          firstPart
        )
      ) {
        continue;
      }
    }

    const destination =
      path.join(
        OUT,
        "raw",
        sourceInfo.key,
        relative
      );

    await makeDirectory(
      path.dirname(
        destination
      )
    );

    await fs.copyFile(
      file,
      destination
    );
  }
}

// ============================================================
// EXECUÇÃO PRINCIPAL
// ============================================================

async function main() {
  console.log("");
  console.log(
    "=================================================="
  );
  console.log(
    "      SINCRONIZAÇÃO DO BANCO D&D 5e"
  );
  console.log(
    "=================================================="
  );
  console.log("");

  // ----------------------------------------------------------
  // Limpar arquivos antigos
  // ----------------------------------------------------------

  console.log(
    "Limpando sincronização anterior..."
  );

  // Precisa vir ANTES de apagar OUT (abaixo) — é a única cópia do
  // conteúdo externo que existe, já que ele não mora em nenhum repositório
  // git (ver comentário em snapshotExternalContent).
  const externalSnapshot =
    await snapshotExternalContent();

  await removeDirectory(
    WORK
  );

  await removeDirectory(
    OUT
  );

  await makeDirectory(
    WORK
  );

  await makeDirectory(
    OUT
  );

  // ----------------------------------------------------------
  // Manifesto
  // ----------------------------------------------------------

  const allEntities = [];

  const repositoryInfo = [];

  // ----------------------------------------------------------
  // Processar cada fonte
  // ----------------------------------------------------------

  for (
    const source
    of SOURCES
  ) {
    const repository =
      path.join(
        WORK,
        source.key
      );

    cloneRepository(
      source.url,
      repository
    );

    // ----------------------------------------------
    // Guardar informações da fonte
    // ----------------------------------------------

    let commit = "";

    try {
      commit =
        execFileSync(
          "git",
          [
            "-C",
            repository,
            "rev-parse",
            "HEAD",
          ],
          {
            encoding: "utf8",
          }
        ).trim();
    } catch {
      commit = "";
    }

    repositoryInfo.push({
      key: source.key,
      url: source.url,
      type: source.type,
      edition: source.edition,
      commit,
    });

    // ----------------------------------------------
    // Processar dados
    // ----------------------------------------------

    let entities = [];

    if (
      isBrewLike(source)
    ) {
      entities =
        await processHomebrewRepository(
          repository,
          source
        );
    } else {
      entities =
        await processOfficialRepository(
          repository,
          source
        );
    }

    allEntities.push(
      ...entities
    );

    // ----------------------------------------------
    // Copiar JSONs
    // ----------------------------------------------

    console.log("");
    console.log(
      `Copiando JSONs de ${source.key}...`
    );

    await copyJsonFiles(
      repository,
      source
    );
  }

  // ----------------------------------------------------------
  // Restaurar conteúdo externo
  // ----------------------------------------------------------
  //
  // Devolve o snapshot capturado no início pro lugar (data/raw/external/)
  // e processa do mesmo jeito que homebrew/prerelease — sem "copiar" de
  // um clone git, já que os arquivos já estão no destino final.
  // ----------------------------------------------------------

  console.log("");
  console.log(
    "Restaurando conteúdo externo (data/raw/external)..."
  );

  await restoreExternalContent(
    externalSnapshot
  );

  const externalSourceInfo = {
    key: EXTERNAL_KEY,
    url: null,
    type: "external",
    edition: "both",
  };

  const externalEntities =
    await processHomebrewRepository(
      path.join(OUT, EXTERNAL_DIR_REL),
      externalSourceInfo
    );

  allEntities.push(
    ...externalEntities
  );

  repositoryInfo.push({
    key: externalSourceInfo.key,
    url: externalSourceInfo.url,
    type: externalSourceInfo.type,
    edition: externalSourceInfo.edition,
    commit: null,
  });

  // ----------------------------------------------------------
  // Remover duplicatas
  // ----------------------------------------------------------

  console.log("");
  console.log(
    "Removendo duplicatas..."
  );

  const unique =
    new Map();

  for (
    const entity
    of allEntities
  ) {
    const key =
      [
        entity.type,
        entity.name,
        entity.source,
        entity.homebrew,
        entity.edition,
        entity.file,
      ].join("|");

    if (
      !unique.has(key)
    ) {
      unique.set(
        key,
        entity
      );
    }
  }

  const entities =
    Array.from(
      unique.values()
    );

  // ----------------------------------------------------------
  // Ordenar
  // ----------------------------------------------------------

  entities.sort(
    (a, b) => {
      const typeCompare =
        a.type.localeCompare(
          b.type
        );

      if (
        typeCompare !== 0
      ) {
        return typeCompare;
      }

      return a.name.localeCompare(
        b.name
      );
    }
  );

  // ----------------------------------------------------------
  // Manifest
  // ----------------------------------------------------------

  const manifest = {
    schema: 3,

    generatedAt:
      new Date().toISOString(),

    sources:
      repositoryInfo,

    totals: {
      entities:
        entities.length,

      official:
        entities.filter(
          x => !x.homebrew
        ).length,

      homebrew:
        entities.filter(
          x => x.homebrew
        ).length,

      external:
        entities.filter(
          x => x.external
        ).length,
    },

    entities,
  };

  // ----------------------------------------------------------
  // Gravar manifest
  // ----------------------------------------------------------

  const manifestFile =
    path.join(
      OUT,
      "manifest.json"
    );

  await fs.writeFile(
    manifestFile,
    JSON.stringify(
      manifest,
      null,
      2
    ),
    "utf8"
  );

  // ----------------------------------------------------------
  // version.json — resumo leve para o navegador
  // ----------------------------------------------------------
  //
  // manifest.json tem todas as ~35 mil entidades e pesa vários MB —
  // pesado demais para baixar a cada carregamento da ficha só para
  // (1) saber quais arquivos trazem classe/subclasse homebrew e
  // (2) detectar se o banco foi atualizado desde a última visita.
  // version.json cobre só isso, então fica pequeno (dezenas de KB).
  // ----------------------------------------------------------

  // Monta o mesmo formato de índice (classFiles/raceFiles/filesByType)
  // pra homebrew e pra prerelease — flagKey é "homebrew" ou "prerelease",
  // o campo booleano que extractObjectsFromJson marcou em cada entidade.
  function buildBrewIndex(flagKey) {
    const classFiles =
      Array.from(
        new Set(
          entities
            .filter(
              e =>
                e[flagKey] &&
                (e.type === "class" ||
                  e.type === "subclass")
            )
            .map(e => e.file)
        )
      ).sort();

    const raceFiles =
      Array.from(
        new Set(
          entities
            .filter(
              e =>
                e[flagKey] &&
                (e.type === "race" ||
                  e.type === "subrace")
            )
            .map(e => e.file)
        )
      ).sort();

    const filesByType = {};

    for (
      const t
      of ["item", "spell", "feat", "background", "optionalfeature", "reward", "variantrule"]
    ) {
      filesByType[t] =
        Array.from(
          new Set(
            entities
              .filter(e => e[flagKey] && e.type === t)
              .map(e => e.file)
          )
        ).sort();
    }

    return { classFiles, classFileCount: classFiles.length, raceFiles, raceFileCount: raceFiles.length, filesByType };
  }

  const version = {
    schema: 3,

    generatedAt:
      manifest.generatedAt,

    sources:
      repositoryInfo,

    totals:
      manifest.totals,

    // Mesma lógica das classes, mas para raça/subespécie homebrew —
    // usado pela ficha para mostrar as descrições de raças homebrew
    // lado a lado com as oficiais (ver src/database.js -> loadRaces).
    // "collection/" (sourcebooks completos, ex.: Ryoko's Guide to the
    // Yokai Realms, Vampire the Masquerade: Bound by Blood) entra nos
    // mesmos índices — ver BREW_WALK_FOLDERS.
    homebrew: buildBrewIndex("homebrew"),

    // Conteúdo de pré-lançamento (Unearthed Arcana etc., ex.: o Psion
    // novo) — mesmo formato do homebrew, repositório separado.
    prerelease: buildBrewIndex("prerelease"),

    // Conteúdo externo (data/raw/external/, ver snapshotExternalContent
    // acima) — mesmo formato do homebrew; a ficha trata como homebrew pra
    // efeito de filtro/visibilidade, mas com etiqueta própria ("Externo")
    // pra deixar claro que não vem do TheGiddyLimit/homebrew.
    external: buildBrewIndex("external"),
  };

  const versionFile =
    path.join(
      OUT,
      "version.json"
    );

  await fs.writeFile(
    versionFile,
    JSON.stringify(
      version,
      null,
      2
    ),
    "utf8"
  );

  // ----------------------------------------------------------
  // Criar README do banco
  // ----------------------------------------------------------

  const databaseReadme = `
# Banco de dados D&D 5e

Este diretório é gerado automaticamente pelo GitHub Actions.

## Fontes

- 5eTools 2024
- 5eTools 2014
- Homebrew compatível com 5eTools

## Última atualização

${manifest.generatedAt}

## Entidades

Total: ${manifest.totals.entities}

Oficial: ${manifest.totals.official}

Homebrew: ${manifest.totals.homebrew}

Externo: ${manifest.totals.external}

Não edite manualmente os arquivos deste diretório — EXCETO raw/external/,
que é preservado a cada sincronização (ver snapshotExternalContent em
sync-data.mjs). Qualquer outro arquivo será substituído na próxima
sincronização.
`;

  await fs.writeFile(
    path.join(
      OUT,
      "README.md"
    ),
    databaseReadme.trim() + "\n",
    "utf8"
  );

  // ----------------------------------------------------------
  // Relatório final
  // ----------------------------------------------------------

  console.log("");
  console.log(
    "=================================================="
  );
  console.log(
    "             SINCRONIZAÇÃO CONCLUÍDA"
  );
  console.log(
    "=================================================="
  );

  console.log("");

  console.log(
    `Total de entidades: ${entities.length}`
  );

  console.log(
    `Oficiais: ${manifest.totals.official}`
  );

  console.log(
    `Homebrew: ${manifest.totals.homebrew}`
  );

  console.log(
    `Externo: ${manifest.totals.external}`
  );

  console.log("");

  console.log(
    "Arquivo criado:"
  );

  console.log(
    "data/manifest.json"
  );

  console.log(
    "data/version.json"
  );

  console.log("");

  console.log(
    "Fontes sincronizadas:"
  );

  for (
    const source
    of repositoryInfo
  ) {
    console.log(
      `- ${source.key} (${source.commit})`
    );
  }

  console.log("");

  console.log(
    "=================================================="
  );
}

main().catch(
  error => {
    console.error("");
    console.error(
      "!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!"
    );
    console.error(
      "ERRO DURANTE A SINCRONIZAÇÃO"
    );
    console.error(
      "!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!"
    );
    console.error("");

    console.error(
      error
    );

    console.error("");

    process.exit(1);
  }
);
