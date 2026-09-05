// ============================================================
// Idioma da INTERFACE — menus, abas e rótulos fixos da casca do app
// (cabeçalho, navegação, dashboard). NÃO traduz o conteúdo vindo do
// 5etools (magias, monstros, classes, descrições...) nem o texto gerado
// dinamicamente dentro de cada aba — só a moldura visível o tempo todo.
// Começa com português (padrão) + inglês; outros idiomas entram depois,
// um de cada vez, só adicionando outra chave em DICT.
// ============================================================
import { getSavedLang, saveLang, LANGS } from "./storage.js";

const DICT = {
  pt: {
    "app.title": "Ficha de Personagem",
    "menu.character": "Personagem",
    "menu.charactersBtn": "Meus Personagens",
    "menu.newCharacter": "Novo",
    "menu.templatesBtn": "Modelos",
    "menu.randomCharacter": "🎲 Personagem aleatório",
    "menu.randomCharacter.title": "Sorteia espécie, classe, subclasse, background, atributos e nome — pronto pra jogar",
    "save.character": "💾 Salvar",
    "save.character.title": "Salvar personagem",
    "menu.file": "Arquivo",
    "menu.exportJson": "Exportar JSON",
    "menu.importJson": "Importar JSON",
    "menu.shareLink": "🔗 Link somente-leitura",
    "menu.shareLink.title": "Gera um link somente-leitura com o personagem inteiro codificado nele — sem servidor, sem conta. Quem abrir vê a ficha (sem poder editar); o retrato e as notas de sessão não entram no link.",
    "menu.exportFoundry": "⇩ Exportar pro Foundry VTT",
    "menu.exportFoundry.title": "Baixa um Actor (Personagem) compatível com o sistema dnd5e do Foundry VTT — importe pela aba de Atores do seu mundo",
    "menu.printCharacter": "Imprimir direto",
    "menu.tools": "Ferramentas",
    "menu.discordSettings": "🔗 Discord",
    "menu.discordSettings.title": "Enviar as rolagens de dado pro Discord",
    "menu.roomSettings": "💬 Sala de rolagens",
    "menu.roomSettings.title": "Configurar a sala de rolagens compartilhada em tempo real com o grupo",
    "menu.mestreMode": "🐉 Ambiente do Mestre",
    "menu.mestreMode.title": "Ambiente do mestre: listas de monstros por aventura, bestiário oficial completo e criação de monstros — independe do personagem aberto",
    "menu.refreshData": "Atualizar dados do 5etools",
    "menu.prefs": "Ajustes",
    "prefs.edition": "Regras",
    "prefs.content": "Conteúdo",
    "prefs.content.official": "Apenas oficial",
    "prefs.content.all": "Oficial + Homebrew",
    "prefs.content.homebrew": "Apenas Homebrew",
    "prefs.skin": "Tema",
    "prefs.skin.title": "Visual da ficha na tela — a ficha em PDF sai sempre no papel da ficha oficial",
    "prefs.skin.noite": "Noite (escuro)",
    "prefs.skin.papel": "Papel Branco (claro)",
    "prefs.skin.pergaminho": "Pergaminho (igual ao PDF)",
    "prefs.skin.mesa": "Mesa (denso)",
    "prefs.lang": "Idioma",
    "previewPdf": "Ficha em PDF",
    "name.placeholder": "NOME DO PERSONAGEM",
    "name.label": "Nome do personagem",
    "head.classLevel": "Classe e nível",
    "head.background": "Background",
    "head.race": "Espécie",
    "head.level": "Nível",
    "head.xp": "XP",
    "dashboard.title": "QUICK VIEW · COMBATE",
    "dashboard.collapse": "Recolher",
    "dashboard.expand": "Expandir",
    "tab.build": "Construção",
    "tab.sheet": "Ficha",
    "tab.actions": "Ações",
    "tab.abilities": "Atributos & Talentos",
    "tab.spells": "Magias",
    "tab.features": "Características",
    "tab.equipment": "Equipamento",
    "tab.notes": "Notas",
    "tab.codex": "Raças & Classes",
    "tab.compendium": "Compêndio",
  },
  en: {
    "app.title": "Character Sheet",
    "menu.character": "Character",
    "menu.charactersBtn": "My Characters",
    "menu.newCharacter": "New",
    "menu.templatesBtn": "Templates",
    "menu.randomCharacter": "🎲 Random character",
    "menu.randomCharacter.title": "Rolls species, class, subclass, background, ability scores and name — ready to play",
    "save.character": "💾 Save",
    "save.character.title": "Save character",
    "menu.file": "File",
    "menu.exportJson": "Export JSON",
    "menu.importJson": "Import JSON",
    "menu.shareLink": "🔗 Read-only link",
    "menu.shareLink.title": "Generates a read-only link with the whole character encoded in it — no server, no account. Whoever opens it sees the sheet (without being able to edit it); the portrait and session notes are left out of the link.",
    "menu.exportFoundry": "⇩ Export to Foundry VTT",
    "menu.exportFoundry.title": "Downloads an Actor (Character) compatible with Foundry VTT's dnd5e system — import it from your world's Actors tab",
    "menu.printCharacter": "Print directly",
    "menu.tools": "Tools",
    "menu.discordSettings": "🔗 Discord",
    "menu.discordSettings.title": "Send dice rolls to Discord",
    "menu.roomSettings": "💬 Roll room",
    "menu.roomSettings.title": "Set up the shared real-time roll room with your group",
    "menu.mestreMode": "🐉 GM Environment",
    "menu.mestreMode.title": "GM environment: monster lists per adventure, the full official bestiary, and monster creation — independent of the character currently open",
    "menu.refreshData": "Refresh 5etools data",
    "menu.prefs": "Settings",
    "prefs.edition": "Rules",
    "prefs.content": "Content",
    "prefs.content.official": "Official only",
    "prefs.content.all": "Official + Homebrew",
    "prefs.content.homebrew": "Homebrew only",
    "prefs.skin": "Theme",
    "prefs.skin.title": "Sheet's on-screen look — the PDF sheet always uses the official sheet's paper style",
    "prefs.skin.noite": "Night (dark)",
    "prefs.skin.papel": "White Paper (light)",
    "prefs.skin.pergaminho": "Parchment (like the PDF)",
    "prefs.skin.mesa": "Table (dense)",
    "prefs.lang": "Language",
    "previewPdf": "Character sheet PDF",
    "name.placeholder": "CHARACTER NAME",
    "name.label": "Character name",
    "head.classLevel": "Class & level",
    "head.background": "Background",
    "head.race": "Species",
    "head.level": "Level",
    "head.xp": "XP",
    "dashboard.title": "QUICK VIEW · COMBAT",
    "dashboard.collapse": "Collapse",
    "dashboard.expand": "Expand",
    "tab.build": "Build",
    "tab.sheet": "Sheet",
    "tab.actions": "Actions",
    "tab.abilities": "Abilities & Feats",
    "tab.spells": "Spells",
    "tab.features": "Features",
    "tab.equipment": "Equipment",
    "tab.notes": "Notes",
    "tab.codex": "Species & Classes",
    "tab.compendium": "Compendium",
  },
};

let currentLang = getSavedLang();

export function getLang() { return currentLang; }

export function t(key) {
  return DICT[currentLang]?.[key] ?? DICT.pt[key] ?? key;
}

export function applyI18n() {
  document.documentElement.lang = currentLang === "en" ? "en" : "pt-BR";
  document.querySelectorAll("[data-i18n]").forEach((el) => { el.textContent = t(el.getAttribute("data-i18n")); });
  document.querySelectorAll("[data-i18n-title]").forEach((el) => { el.title = t(el.getAttribute("data-i18n-title")); });
  document.querySelectorAll("[data-i18n-placeholder]").forEach((el) => { el.placeholder = t(el.getAttribute("data-i18n-placeholder")); });
}

export function setLang(lang) {
  currentLang = LANGS.includes(lang) ? lang : "pt";
  saveLang(currentLang);
  applyI18n();
}
