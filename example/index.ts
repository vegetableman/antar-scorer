import Readability from "./readability";
import scorer from "../index";
try {
  const result = scorer.score(document.body.innerHTML, document);
  console.log(result);
} catch (ex) {}

var documentClone = document.cloneNode(true);
var article = new Readability(<HTMLDocument>documentClone, {}).parse();
console.log(article);
