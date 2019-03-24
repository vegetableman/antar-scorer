import Readability from "./readability";
import scorer from "../index";
const result = scorer.score(document.body.innerHTML, document);
console.log(result);

var documentClone = document.cloneNode(true);
var article = new Readability(<HTMLDocument>documentClone, {}).parse();
console.log(article);
