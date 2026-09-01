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
  - **lista de magias completa** da classe, por nível, via `spells/sources.json`, com
    quantos truques/magias dá pra preparar naquele nível e quantos espaços de cada nível
    o personagem tem (nas classes de 2014, que não trazem esse número na tabela, ele vem
    da fórmula do PHB: modificador do atributo + nível na classe);
  - **Defesa sem Armadura** de todas as classes do personagem: num Monge/Bárbaro a ficha
    usa a de **maior CA** (e desconsidera a do Monge quando há escudo equipado), com um
    seletor pra fixar outra na mão.
- **Point buy** 27 pontos, atributos editáveis, especialização.
- **Compêndio** e **catálogo de equipamento** pesquisáveis (itens e magias carregam sob demanda).
- **Aba "Raças & Classes"**: galeria com a descrição narrativa completa (lore) de cada raça/espécie
  e classe — texto oficial do 5etools (`fluff-races.json` / `class/fluff-class-*.json`) e, para
  homebrew, o `raceFluff`/`classFluff` do próprio arquivo — com busca, filtro por tipo e por
  Oficial/Homebrew, fatos rápidos (dado de vida, atributo primário, deslocamento, tamanho...) e a
  lista de subclasses/subespécies. Quando o registro não tem lore estruturada, mostra os traços
  mecânicos com um aviso.
- **Múltiplos personagens salvos**: botão **"Meus Personagens"** lista todas as fichas salvas neste navegador — cria, alterna, duplica e apaga cada uma independente, sem perder o progresso das outras.
- **Retrato do personagem**: clique no quadro ao lado do nome pra subir uma foto (redimensionada/comprimida no navegador antes de salvar) — aparece no topo da ficha e na página de detalhes do PDF.
- **Aba "Ações"**: reúne ataques, magias preparadas com tempo de conjuração instantâneo, recursos de classe (Fúria, Ki, Canalizar Divindade...) e características de classe/talento com gatilho de ação, agrupados por **Ação / Ação Bônus / Reação / Especial** — a visão de "o que eu posso fazer agora" na mesa, sem ficar trocando de aba.
- **Capacidade de carga**: peso por item de inventário (puxado do compêndio, editável) somado às moedas, com barra colorida contra a capacidade máxima (Força × 15) e aviso de sobrecarga — aparece na aba Equipamento e na ficha em PDF.
- **Link somente-leitura**: menu **Arquivo → 🔗 Link somente-leitura** comprime o personagem inteiro (gzip nativo do navegador) no próprio link — sem servidor, sem conta. Quem abre vê a ficha travada pra edição, com a opção de salvar uma cópia editável no próprio navegador. O retrato e as notas de sessão ficam de fora pra não inchar o link.
- **Quatro temas visuais** (barra do topo → **Ajustes → Tema**), salvos no navegador:
  **Noite** (escuro, padrão), **Papel Branco** (claro e silencioso), **Pergaminho**
  (o mesmo papel da ficha impressa — a tela fica igual ao PDF) e **Mesa** (denso, pra
  ficha aberta durante a sessão). O tema é só aparência: não muda personagem, magias
  marcadas nem o arquivo gerado.
- **Importar / exportar** o personagem em JSON e **Ficha em PDF** (via impressão do navegador),
  em quatro páginas no formato da ficha oficial: ficha de combate → detalhes do personagem →
  conjuração (espaços, quantas magias dá pra preparar por classe e as marcadas) →
  **repertório completo**, com todas as magias que a classe pode aprender e ● nas preparadas.
- **Exportar pro Foundry VTT**: botão **"⇩ Foundry"** baixa um Actor no formato do sistema dnd5e (atributos,
  PV, CA, perícias, deslocamento, magias conhecidas e as características até o nível atual como itens) —
  importe pela aba de Atores do seu mundo Foundry. É uma exportação pontual, sem servidor: diferente do
  Discord (webhook público), o Foundry não tem como receber dados de um site externo sem o mestre instalar
  algo no próprio servidor dele, então isso não manda rolagens ao vivo — só o retrato do personagem.
- **Assistente guiado completo**: espécie → classe → subclasse → nível → background → multiclasse
  (opcional) → atributos → equipamento inicial → revisão, com "voltar" e passos opcionais puláveis.
- **Aba "Construção"** própria pras escolhas de espécie/classe/subclasse/background/multiclasse e o
  painel de automação — fica fora da aba "Ficha" pra não poluir a tela de quem já montou o
  personagem e só quer jogar. Um personagem em branco abre direto nela; um já montado abre na Ficha.
- **Assistente de "Subir de Nível"**: ao aumentar o nível da classe primária, um resumo mostra o que
  apareceu de novo naquele nível específico — características de classe/subclasse, se abriu uma
  melhoria de atributo/talento (ASI) e se os espaços de magia mudaram — com atalho pras abas
  relevantes.
- **Dashboard "Quick View"** fixo no topo da ficha: PV com barra colorida (verde/amarelo/vermelho),
  CA, iniciativa, proficiência, espaços de magia, dados de vida, recursos de classe e condições
  ativas de relance — recolhível.
- **Rastreador de recursos de combate**: dados de vida (com botão "usar" que rola o dado + CON e
  cura automaticamente), espaços de magia/pacto (clique pra marcar usado), e recursos de classe
  detectados automaticamente na tabela da classe/subclasse (Fúria, Pontos de Ki, Pontos de
  Feitiçaria, Inspiração de Bardo, Canalizar Divindade, Dados de Superioridade, Forma Selvagem
  etc.) — funciona com qualquer classe oficial ou homebrew, sem dado extra.
- **Condições de combate**: aplicar/remover as 15 condições da 5e com efeito descrito, duração em
  rodadas e botão "avançar rodada" que expira condições e modificadores temporários automaticamente.
- **Ataques com cálculo automático**: escolha Força/Destreza/Conjuração/Manual + proficiência +
  bônus de item, com botões para rolar ataque e dano (crítico/falha crítica destacados).
- **Testes de resistência contra a morte**: só aparece com PV ≤ 0; botão de rolagem com as regras
  de 20 natural (recupera 1 PV) e 1 natural (2 falhas), e status "estabilizado"/"morreu".
- **Modificadores temporários (buffs/debuffs)**: aplique um ajuste a um ou mais atributos com
  duração em rodadas ou permanente — recalcula modificador, perícias, salvamentos e CD na hora.
- **Notas de sessão**: anotações datadas por sessão, com editar/apagar e exportação em texto.
- **Companheiros & familiares**: fichas curtas à parte pra familiar, companheiro animal, montaria
  ou qualquer criatura ligada ao personagem — CA, PV com barra própria e ataques com rolagem (que
  também aparecem na sala de rolagens/Discord como os do personagem principal).
- **Sala de rolagens** (⚙️/💬 no canto): navegadores da mesa conectados ponto-a-ponto por WebRTC
  (PeerJS, sem servidor próprio) — rolagens de todo mundo aparecem num chat compartilhado, com
  botão pra aplicar cura direto no PV de quem clicar. A mesma sala tem uma aba de
  **rastreador de iniciativa**: cada jogador entra com nome/iniciativa/CA/PV (ou rola a iniciativa
  ali mesmo), o anfitrião pode adicionar monstros/NPCs à mão e controlar rodada/turno — todo mundo
  vê a ordem e o turno atual em tempo real.
- **Modelos de personagem**: salve a construção atual (classe/subclasse/espécie/background/
  atributos/escolhas) como modelo reaproveitável pra criar personagens novos rapidamente.
- **Cache offline**: os JSON baixados ficam em IndexedDB por 7 dias; botão **"Atualizar dados"** recarrega tudo.
- **Instalável (PWA)**: `manifest.json` + service worker cacheiam a casca do app (HTML/JS/CSS/ícones), então dá pra "instalar" a ficha no celular/desktop e abrir offline direto como um app — sem afetar o cache dos dados do 5etools, que continua na camada acima.
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

## Instalar no celular

A ficha é um **PWA**: não vai pra loja de aplicativos, você instala direto do navegador e
ela vira um ícone na tela inicial, abre em tela cheia (sem barra de endereço) e funciona
offline. Precisa ser a URL publicada em **HTTPS** (`https://<usuário>.github.io/<repo>/`) —
por `file://` ou HTTP puro o service worker não registra e o botão de instalar não aparece.

**Android (Chrome / Edge / Samsung Internet)**

1. Abra a URL do site no navegador.
2. Espere carregar uma vez (é o que registra o service worker e cacheia a casca do app).
3. Toque no menu **⋮** → **Instalar app** / **Adicionar à tela inicial** — em muitos casos o
   próprio Chrome mostra um banner de instalação no rodapé.
4. Confirme. O ícone aparece na tela inicial como qualquer outro app.

**iPhone / iPad (precisa ser o Safari)**

1. Abra a URL **no Safari** — Chrome e Firefox no iOS não instalam PWA.
2. Toque no botão **Compartilhar** (quadrado com a seta pra cima).
3. Role a lista e toque em **Adicionar à Tela de Início** → **Adicionar**.

**Primeiro uso e offline**

Depois de instalar, abra o app uma vez **com internet** e toque em **"Atualizar dados"**: o
service worker só cacheia HTML/JS/CSS/ícones, enquanto os dados do 5etools ficam num cache
próprio em IndexedDB (7 dias). Sem esse primeiro carregamento a ficha abre offline, mas sem
raças/classes/magias. Os personagens ficam salvos no armazenamento do próprio navegador —
apagar os dados do site ou desinstalar o app apaga as fichas junto, então exporte antes.

**Atualizações**: o service worker é *network-first*, então basta abrir o app com internet
que ele já pega a versão nova. Se algo travar numa versão antiga, feche e reabra o app com
conexão, ou desinstale e instale de novo.

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
| `src/storage.js` | personagens em `localStorage` (múltiplos slots + ativo), importar/exportar, versão de dados já vista |
| `sync-data.mjs` | baixa 5etools (2014/2024) + homebrew e gera `data/raw/` + `data/manifest.json` + `data/version.json` |
| `data/version.json` | gerado pelo `sync-data.mjs`; lista os arquivos de classe/subclasse e de raça/subespécie homebrew, além da data da última sincronização |

## Limitações conhecidas (v1)

- Herança `_copy`/`_mod` do 5etools é resolvida de forma parcial.
- Renderização das tags `{@...}` cobre as mais comuns; tags raras aparecem como texto simples.
- Equipamento inicial da classe/background é mostrado como texto, não adicionado automaticamente ao inventário.
- Escolhas como ancestralidade dracônica, estilo de luta e talentos ainda não têm seletor dedicado.
