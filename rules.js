/* Reservado para regras derivadas. Mantido separado para facilitar futuras expansões. */
window.DND_RULES = {
  modifier(score){return Math.floor((Number(score||10)-10)/2)},
  proficiency(level){return 2+Math.floor((Number(level||1)-1)/4)}
};