window.DND_STORAGE = {
  save(data){localStorage.setItem("dndSheetState", JSON.stringify(data))},
  load(){try{return JSON.parse(localStorage.getItem("dndSheetState")||"null")}catch{return null}},
  clear(){localStorage.removeItem("dndSheetState")}
};