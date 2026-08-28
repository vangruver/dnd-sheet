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
// PROCESSAR HOMEBREW
// ============================================================
//
// O Homebrew não usa:
//
// data/spell/...
//
// como o repositório principal.
//
// Ele possui:
//
// spell/
// subclass/
// race/
// background/
// etc.
//
// diretamente na raiz.
//
// Por isso ele é tratado separadamente.
// ============================================================

async function processHomebrewRepository(
  repository,
  sourceInfo
) {
  const entities = [];

  for (const type of TYPES) {
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
      `Homebrew / ${type}: ${files.length} arquivos`
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
            "homebrew",
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
          `Homebrew: ${relative} → ${extracted.length} entidades`
        );
      }
    }
  }

  return entities;
}

// ============================================================
// COPIAR ARQUIVO JSON PARA O NOSSO DATA/
// ============================================================

async function copyJsonFiles(
  repository,
  sourceInfo
) {
  const sourceRoot =
    sourceInfo.type === "homebrew"
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

    // Para Homebrew, só copiamos
    // os tipos que interessam.
    if (
      sourceInfo.type ===
      "homebrew"
    ) {
      const firstPart =
        relative.split(
          path.sep
        )[0];

      if (
        !TYPES.includes(
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
      source.type ===
      "homebrew"
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

  const homebrewClassFiles =
    Array.from(
      new Set(
        entities
          .filter(
            e =>
              e.homebrew &&
              (e.type === "class" ||
                e.type === "subclass")
          )
          .map(e => e.file)
      )
    ).sort();

  // Mesma lógica das classes, mas para raça/subespécie homebrew —
  // usado pela ficha para mostrar as descrições de raças homebrew
  // lado a lado com as oficiais (ver src/database.js -> loadRaces).
  const homebrewRaceFiles =
    Array.from(
      new Set(
        entities
          .filter(
            e =>
              e.homebrew &&
              (e.type === "race" ||
                e.type === "subrace")
          )
          .map(e => e.file)
      )
    ).sort();

  // Demais tipos homebrew (item, magia, talento, background, opção…),
  // agrupados por tipo de conteúdo que o arquivo contém — a ficha baixa
  // esses arquivos sob demanda (ver src/database.js).
  const homebrewFilesByType = {};

  for (
    const t
    of ["item", "spell", "feat", "background", "optionalfeature", "reward", "variantrule"]
  ) {
    homebrewFilesByType[t] =
      Array.from(
        new Set(
          entities
            .filter(e => e.homebrew && e.type === t)
            .map(e => e.file)
        )
      ).sort();
  }

  const version = {
    schema: 2,

    generatedAt:
      manifest.generatedAt,

    sources:
      repositoryInfo,

    totals:
      manifest.totals,

    homebrew: {
      classFiles:
        homebrewClassFiles,

      classFileCount:
        homebrewClassFiles.length,

      raceFiles:
        homebrewRaceFiles,

      raceFileCount:
        homebrewRaceFiles.length,

      filesByType:
        homebrewFilesByType,
    },
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

Não edite manualmente os arquivos deste diretório.
Eles serão substituídos na próxima sincronização.
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
