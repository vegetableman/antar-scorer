import utils from "./utils";

enum Tag {
  DIV = "div"
}

const score = (html: string, doc: Document): string => {
  // if no doc, default to the document.cloneNode
  if (!doc) {
    doc = <Document>document.cloneNode(true);
    (async () => {
      const { default: domify } = await import("domify");
      const fragment = domify(html, doc);
      doc.body.appendChild(fragment);
    })();
  }

  const page = doc.body;
  const pageCacheHtml = page.innerHTML;
  let articleByLine = false;

  while (true) {
    let elementsToScore = [];
    let node = doc.documentElement;

    while (node) {
      let matchString = node.className + " " + node.id;

      if (!utils.isProbablyVisible(node)) {
        continue;
      }

      if (!articleByLine) {
        articleByLine = utils.checkByline(node, matchString);
        if (articleByLine) continue;
      }

      if (!utils.isUnlikelyCandidate(node, matchString)) {
        continue;
      }

      if (!utils.isWithoutContentCandidate(node)) {
        continue;
      }

      if (utils.isDefaultScoreTag(node)) {
        elementsToScore.push(node);
      }

      if (node.tagName === Tag.DIV) {
        // Sites like http://mobile.slate.com encloses each paragraph with a DIV
        // element. DIVs with only a P element inside and no text content can be
        // safely converted into plain P elements to avoid confusing the scoring
        // algorithm with DIVs with are, in practice, paragraphs.
        if (
          utils.hasSingleTagInsideElement(node, "P") &&
          utils.getLinkDensity(node) < 0.25
        ) {
          elementsToScore.push(node.children[0]);
        } else if (!utils.hasChildBlockElement(node)) {
          elementsToScore.push(node);
        }
      }
      node = utils.getNextNode(node);
    }
  }

  return html;
};

export default { score };
