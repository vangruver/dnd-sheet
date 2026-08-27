window.DND_DB = {
  classes: {
    "Bárbaro": {hitDie:"d12", skills:2, skillOptions:["Adestramento de Animais","Atletismo","Intimidação","Natureza","Percepção","Sobrevivência"], speed:9, spellcaster:false, desc:"Combatente resistente que usa fúria e força bruta."},
    "Bardo": {hitDie:"d8", skills:3, skillOptions:["Acrobacia","Atuação","Enganação","Furtividade","Intuição","Intimidação","Percepção","Persuasão","Prestidigitação"], speed:9, spellcaster:true, desc:"Conjurador versátil que combina magia, música e perícias."},
    "Bruxo": {hitDie:"d8", skills:2, skillOptions:["Arcanismo","Enganação","História","Intimidação","Investigação","Natureza","Religião"], speed:9, spellcaster:true, desc:"Conjurador ligado a um patrono sobrenatural."},
    "Clérigo": {hitDie:"d8", skills:2, skillOptions:["História","Intuição","Medicina","Persuasão","Religião"], speed:9, spellcaster:true, allSpells:true, desc:"Conjurador divino. Sua lista de magias é determinada pela classe e domínio."},
    "Druida": {hitDie:"d8", skills:2, skillOptions:["Adestramento de Animais","Arcanismo","Intuição","Medicina","Natureza","Percepção","Religião","Sobrevivência"], speed:9, spellcaster:true, allSpells:true, desc:"Guardião da natureza com acesso amplo à magia druídica."},
    "Feiticeiro": {hitDie:"d6", skills:2, skillOptions:["Arcanismo","Enganação","Intimidação","Intuição","Persuasão","Religião"], speed:9, spellcaster:true, desc:"Conjurador cuja magia vem de uma origem inata."},
    "Guerreiro": {hitDie:"d10", skills:2, skillOptions:["Acrobacia","Adestramento de Animais","Atletismo","História","Intimidação","Intuição","Percepção","Sobrevivência"], speed:9, spellcaster:false, desc:"Especialista em combate e no uso de armas e armaduras."},
    "Ladino": {hitDie:"d8", skills:4, skillOptions:["Acrobacia","Atletismo","Atuação","Enganação","Furtividade","Intimidação","Intuição","Investigação","Percepção","Persuasão","Prestidigitação"], speed:9, spellcaster:false, desc:"Especialista em perícias, furtividade e ataques precisos."},
    "Mago": {hitDie:"d6", skills:2, skillOptions:["Arcanismo","História","Intuição","Investigação","Medicina","Religião"], speed:9, spellcaster:true, allSpells:true, desc:"Estudioso da magia com um grimório e grande variedade de magias."},
    "Monge": {hitDie:"d8", skills:2, skillOptions:["Acrobacia","Atletismo","História","Intuição","Religião","Furtividade"], speed:9, spellcaster:false, desc:"Combatente disciplinado que domina corpo e mente."},
    "Paladino": {hitDie:"d10", skills:2, skillOptions:["Atletismo","Intuição","Intimidação","Medicina","Persuasão","Religião"], speed:9, spellcaster:true, allSpells:true, desc:"Guerreiro sagrado com magia divina e grande resistência."},
    "Patrulheiro": {hitDie:"d10", skills:3, skillOptions:["Adestramento de Animais","Atletismo","Furtividade","Intuição","Investigação","Natureza","Percepção","Sobrevivência"], speed:9, spellcaster:true, allSpells:true, desc:"Explorador marcial especializado em sobrevivência e caça."}
  },
  abilities:["Força","Destreza","Constituição","Inteligência","Sabedoria","Carisma"],
  skills:{
    "Acrobacia":"Destreza","Arcanismo":"Inteligência","Atletismo":"Força","Atuação":"Carisma","Adestramento de Animais":"Sabedoria",
    "Enganação":"Carisma","Furtividade":"Destreza","História":"Inteligência","Intimidação":"Carisma","Intuição":"Sabedoria",
    "Investigação":"Inteligência","Medicina":"Sabedoria","Natureza":"Inteligência","Percepção":"Sabedoria","Persuasão":"Carisma",
    "Prestidigitação":"Destreza","Religião":"Inteligência","Sobrevivência":"Sabedoria"
  },
  spells:[
    ["Acudir","0","Evocação","Você estabiliza uma criatura moribunda a curta distância."],
    ["Amizade","0","Encantamento","Você melhora temporariamente a atitude de uma criatura em relação a você."],
    ["Mãos Mágicas","0","Conjuração","Uma mão espectral manipula objetos à distância."],
    ["Prestidigitação","0","Transmutação","Você cria pequenos efeitos mágicos inofensivos."],
    ["Raio de Fogo","0","Evocação","Você lança um raio de fogo contra um alvo."],
    ["Luz","0","Evocação","O objeto tocado passa a emitir luz."],
    ["Detectar Magia","1","Adivinhação","Você percebe a presença de magia e identifica sua aura."],
    ["Curar Ferimentos","1","Evocação","Uma criatura tocada recupera pontos de vida."],
    ["Mísseis Mágicos","1","Evocação","Projéteis de força atingem criaturas escolhidas."],
    ["Escudo","1","Abjuração","Uma barreira mágica aumenta sua defesa como reação."],
    ["Bênção","1","Encantamento","Até três criaturas recebem um bônus em jogadas relevantes."],
    ["Comando","1","Encantamento","Você dá uma ordem simples que o alvo tenta obedecer."],
    ["Armadura Arcana","1","Abjuração","Você reforça a defesa de uma criatura sem armadura."],
    ["Invisibilidade","2","Ilusão","Uma criatura fica invisível até a magia terminar."],
    ["Passo Nebuloso","2","Conjuração","Você se teleporta para um espaço desocupado visível."],
    ["Imobilizar Pessoa","2","Encantamento","Você paralisa um humanoide que falha no teste apropriado."],
    ["Restauração Menor","2","Abjuração","Você encerra certas condições prejudiciais."],
    ["Bola de Fogo","3","Evocação","Uma explosão de fogo causa dano em uma área."],
    ["Dissipar Magia","3","Abjuração","Você encerra magias ativas no alvo."],
    ["Reviver","3","Necromancia","Você devolve a vida a uma criatura que morreu recentemente."],
    ["Invisibilidade Maior","4","Ilusão","A criatura fica invisível por mais tempo."],
    ["Porta Dimensional","4","Conjuração","Você se teleporta para outro ponto dentro do alcance."],
    ["Curar Ferimentos em Massa","5","Evocação","Várias criaturas recuperam pontos de vida."],
    ["Reviver Mortos","5","Necromancia","Você devolve a vida a uma criatura morta."],
    ["Círculo de Teletransporte","5","Conjuração","Você cria uma passagem mágica para um círculo conhecido."],
    ["Cura Completa","6","Evocação","Uma criatura recupera grande quantidade de pontos de vida."],
    ["Desintegrar","6","Transmutação","Um feixe devastador causa enorme dano a um alvo."],
    ["Ressurreição","7","Necromancia","Você restaura a vida e o corpo de uma criatura morta."],
    ["Dominar Monstro","8","Encantamento","Você tenta controlar uma criatura."],
    ["Desejo","9","Conjuração","A mais poderosa e versátil das magias."],
    ["Chuva de Meteoros","9","Evocação","Meteoros atingem uma grande área causando dano devastador."]
  ],
  weapons:[
    ["Adaga","Acuidade, leve, arremesso","1d4","Perfurante"],["Espada curta","Acuidade, leve","1d6","Perfurante"],
    ["Espada longa","Versátil","1d8","Cortante"],["Espada grande","Pesada, duas mãos","2d6","Cortante"],
    ["Machado de mão","Leve, arremesso","1d6","Cortante"],["Machado grande","Pesada, duas mãos","1d12","Cortante"],
    ["Martelo de guerra","Versátil","1d8","Contundente"],["Maça","—","1d6","Contundente"],
    ["Arco curto","Munição, duas mãos","1d6","Perfurante"],["Arco longo","Pesada, duas mãos, alcance","1d8","Perfurante"],
    ["Besta leve","Munição, recarga, duas mãos","1d8","Perfurante"],["Lança","Arremesso, versátil","1d6","Perfurante"]
  ],
  armor:[
    ["Acolchoada","Leve","11 + DES","8"],["Couro","Leve","11 + DES","10"],["Couro batido","Leve","12 + DES","13"],
    ["Cota de malha","Média","16","55"],["Peitoral","Média","14 + DES","20"],["Meia-armadura","Média","15 + DES","40"],
    ["Cota de anéis","Pesada","14","40"],["Cota de malha","Pesada","16","55"],["Armadura de placas","Pesada","18","65"],
    ["Escudo","Escudo","+2","6"]
  ],
  gear:[
    ["Mochila","Contêiner para equipamento","2"],["Corda de cânhamo","Corda de 15 m","10"],["Tocha","Ilumina uma área","1"],
    ["Rações","Comida para uma pessoa","1"],["Cantil","Recipiente para água","1"],["Pederneira e isqueiro","Acender fogo","1"]
  ]
,
  rulesets: {
    "2014": {
      name: "D&D 5e — 2014",
      classes: {
        "Bárbaro": "Bárbaro","Bardo":"Bardo","Bruxo":"Bruxo","Clérigo":"Clérigo","Druida":"Druida",
        "Feiticeiro":"Feiticeiro","Guerreiro":"Guerreiro","Ladino":"Ladino","Mago":"Mago",
        "Monge":"Monge","Paladino":"Paladino","Patrulheiro":"Patrulheiro"
      }
    },
    "2024": {
      name: "D&D 5e — 2024",
      classes: {
        "Bárbaro":"Bárbaro","Bardo":"Bardo","Bruxo":"Bruxo","Clérigo":"Clérigo","Druida":"Druida",
        "Feiticeiro":"Feiticeiro","Guerreiro":"Guerreiro","Ladino":"Ladino","Mago":"Mago",
        "Monge":"Monge","Paladino":"Paladino","Patrulheiro":"Patrulheiro"
      }
    }
  }
};