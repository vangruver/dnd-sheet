# Ficha de D&D 5e automatizada

Ficha de personagem que **lê os dados oficiais do 5etools direto do GitHub**, em tempo de
execução, e preenche sozinha o máximo possível a partir de **classe + espécie + background + nível**.
Roda 100% no navegador — publicável no **GitHub Pages** sem back-end.

## O que ela faz

- **Duas edições**: alterne entre **2014** e **2024**. As listas de classes, subclasses,
  espécies, backgrounds e magias são filtradas pela edição escolhida.
- **Automação da ficha** a partir do banco do 5etools:
  - dado de vida e **PV máximos** por nível;
  - **testes de resistência** da classe;
  - **perícias** fixas + as escolhas de perícia da classe/background (painel "Automação");
  - **deslocamento**, tamanho, visão no escuro e traços da espécie;
  - **atributo de conjuração**, CD de magia e bônus de ataque mágico;
  - **características** de classe/subclasse/espécie/background até o nível atual;
  - **lista de magias completa** da classe, por nível, via `spells/sources.json`.
- **Point buy** 27 pontos, atributos editáveis, especialização.
- **Compêndio** e **catálogo de equipamento** pesquisáveis (itens e magias carregam sob demanda).
- **Aba "Raças & Classes"**: galeria com a descrição narrativa completa (lore) de cada raça/espécie
  e classe — texto oficial do 5etools (`fluff-races.json` / `class/fluff-class-*.json`) e, para
  homebrew, o `raceFluff`/`classFluff` do próprio arquivo — com busca, filtro por tipo e por
  Oficial/Homebrew, fatos rápidos (dado de vida, atributo primário, deslocamento, tamanho...) e a
  lista de subclasses/subespécies. Quando o registro não tem lore estruturada, mostra os traços
  mecânicos com um aviso.
- **Importar / exportar** o personagem em JSON e **Ficha em PDF** (via impressão do navegador).
- **Cache offline**: os JSON baixados ficam em IndexedDB por 7 dias; botão **"Atualizar dados"** recarrega tudo.
- **Classes, subclasses e raças/subespécies homebrew** (`TheGiddyLimit/homebrew`) aparecem lado a
  lado com o conteúdo oficial — use o seletor **Conteúdo** (Oficial / Oficial + Homebrew / Apenas
  Homebrew) no topo da página.
- **Sincronização diária**: um workflow do GitHub Actions baixa a versão mais nova dos JSONs do 5etools
  e do homebrew todo dia às 05h (horário de Brasília) e as grava em `data/`. Quando há uma sincronização
  nova desde a sua última visita, um aviso aparece no topo da página de montar ficha, com um botão para
  atualizar na hora.

## Fonte dos dados

- **Oficial (2014/2024)**: `https://raw.githubusercontent.com/5etools-mirror-3/5etools-src` (com
  alternativa em `cdn.jsdelivr.net`), lido direto do navegador, em tempo de execução. Nenhum dado
  oficial é copiado para este repositório — apenas o código da ficha.
- **Homebrew**: `https://github.com/TheGiddyLimit/homebrew`. Diferente do oficial, o homebrew *é*
  baixado e normalizado neste repositório (pasta `data/raw/homebrew/`) pelo script `sync-data.mjs`,
  rodado automaticamente todo dia às 05h (horário de Brasília) pelo workflow
  [`.github/workflows/sync-data.yml`](.github/workflows/sync-data.yml). A ficha lê esses arquivos do
  próprio site publicado (`data/version.json` lista os arquivos de classe/subclasse homebrew
  disponíveis) — por isso o homebrew não depende de CORS de um repositório de terceiros.

## Publicar no GitHub Pages

1. Crie um repositório e suba estes arquivos na branch `main`.
2. Em **Settings → Pages → Build and deployment**, selecione **GitHub Actions**.
3. O workflow [`.github/workflows/pages.yml`](.github/workflows/pages.yml) publica a cada push.
4. Abra a URL `https://<usuário>.github.io/<repo>/`.

O arquivo `.nojekyll` garante que a pasta `src/` seja servida sem processamento do Jekyll.

## Rodar localmente

```bash
python -m http.server 8000
# abra http://localhost:8000
```

Precisa ser servido por HTTP (os módulos ES não carregam via `file://`).

## Teste rápido da camada de dados

```bash
node tests/smoke.mjs
```

Baixa alguns arquivos do 5etools e confere valores conhecidos (dado de vida do Mago,
resistências do Guerreiro, listas de magia não vazias em 2014 e 2024).

## Estrutura

| Arquivo | Papel |
|---|---|
| `index.html` / `assets/style.css` | interface e tema "papel" |
| `src/sources.js` | repositório-fonte e heurística de edição |
| `src/store.js` | download + cache em IndexedDB + fila de requisições |
| `src/database.js` | catálogos, características, lista de magias, consultas |
| `src/rules.js` | atributos, perícias, fórmulas 5e |
| `src/app.js` | interface, automação da ficha, abas, aviso de banco atualizado |
| `src/storage.js` | personagem em `localStorage`, importar/exportar, versão de dados já vista |
| `sync-data.mjs` | baixa 5etools (2014/2024) + homebrew e gera `data/raw/` + `data/manifest.json` + `data/version.json` |
| `data/version.json` | gerado pelo `sync-data.mjs`; lista os arquivos de classe/subclasse e de raça/subespécie homebrew, além da data da última sincronização |

## Limitações conhecidas (v1)

- Herança `_copy`/`_mod` do 5etools é resolvida de forma parcial.
- Renderização das tags `{@...}` cobre as mais comuns; tags raras aparecem como texto simples.
- Equipamento inicial da classe/background é mostrado como texto, não adicionado automaticamente ao inventário.
- Escolhas como ancestralidade dracônica, estilo de luta e talentos ainda não têm seletor dedicado.
