import scorer from "../index";
const result = scorer.score(document.body.innerHTML, document);

// Compare with readability
// import Readability from "./readability";
// var documentClone = document.cloneNode(true);
// var article = new Readability(<HTMLDocument>documentClone, {}).parse();
