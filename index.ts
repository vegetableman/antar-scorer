import utils from "./utils";

enum Tag {
  DIV = "div"
}

const scoreAttribute = "data-antar-score";
const str = String;
const num = Number;
const DEFAULT_N_TOP_CANDIDATES = 5;

const initializeScore = (node: HTMLElement): number => {
  let score = 0;
  switch (node.tagName) {
    case "DIV":
      score += 5;
      break;

    case "PRE":
    case "TD":
    case "BLOCKQUOTE":
      score += 3;
      break;

    case "ADDRESS":
    case "OL":
    case "UL":
    case "DL":
    case "DD":
    case "DT":
    case "LI":
    case "FORM":
      score -= 3;
      break;

    case "H1":
    case "H2":
    case "H3":
    case "H4":
    case "H5":
    case "H6":
    case "TH":
      score -= 5;
      break;
  }
  score += utils.getClassWeight(node);
  return score;
};

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
      if (!utils.isProbablyVisible(node) || utils.isUnlikelyTag(node)) {
        continue;
      }

      let matchString = node.className + " " + node.id;

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

    var candidates = [];
    utils.forEachNode(
      elementsToScore,
      (elementToScore: HTMLElement): void => {
        if (
          !elementToScore.parentNode ||
          typeof (<HTMLElement>elementToScore.parentNode).tagName ===
            "undefined"
        ) {
          return;
        }

        let innerText = utils.getInnerText(elementToScore);
        if (innerText.length < 25) return;

        // Exclude nodes with no ancestor.
        let ancestors = utils.getNodeAncestors(elementToScore, 3);
        if (!ancestors.length) return;

        let contentScore = 0;
        contentScore += 1;
        contentScore += innerText.split(",").length;
        contentScore += Math.min(Math.floor(innerText.length / 100), 3);

        utils.forEachNode(
          ancestors,
          (ancestor: HTMLElement, level: number): void => {
            if (
              !ancestor.tagName ||
              !ancestor.parentNode ||
              typeof (<HTMLElement>ancestor.parentNode).tagName === "undefined"
            )
              return;

            let dataScore = ancestor.dataset[scoreAttribute];

            if (typeof dataScore === "undefined") {
              ancestor.dataset[scoreAttribute] = str(initializeScore(ancestor));
              candidates.push(ancestor);
            }

            // Node score divider:
            // - parent:             1 (no division)
            // - grandparent:        2
            // - great grandparent+: ancestor level * 3
            let scoreDivider: number;
            if (level === 0) scoreDivider = 1;
            else if (level === 1) scoreDivider = 2;
            else scoreDivider = level * 3;

            dataScore = str(num(dataScore) + contentScore / scoreDivider);
            ancestor.dataset[scoreAttribute] = dataScore;
          }
        );
      }
    );

    // After we've calculated scores, loop through all of the possible
    // candidate nodes we found and find the one with the highest score.
    let topCandidates = [];
    for (let c = 0, cl = candidates.length; c < cl; c += 1) {
      let candidate = candidates[c];

      // Scale the final candidates score based on link density. Good content
      // should have a relatively small link density (5% or less) and be mostly
      // unaffected by this operation.
      let candidateScore =
        num(candidate.dataset[scoreAttribute]) *
        (1 - utils.getLinkDensity(candidate));

      candidate.dataset[scoreAttribute] = candidateScore;

      for (let t = 0; t < DEFAULT_N_TOP_CANDIDATES; t++) {
        let aTopCandidate = topCandidates[t];
        let aContentScore = num(aTopCandidate.dataset[scoreAttribute]);

        if (!aTopCandidate || candidateScore > aContentScore) {
          topCandidates.splice(t, 0, candidate);
          if (topCandidates.length > DEFAULT_N_TOP_CANDIDATES) {
            topCandidates.pop();
          }
          break;
        }
      }
    }

    let topCandidate = topCandidates[0] || null;
    let neededToCreateTopCandidate = false;
    let parentOfTopCandidate;

    // If we still have no top candidate, just use the body as a last resort.
    // We also have to copy the body node so it is something we can modify.
    if (topCandidate === null || topCandidate.tagName === "BODY") {
      // Move all of the page's children into topCandidate
      topCandidate = doc.createElement("DIV");
      neededToCreateTopCandidate = true;
      // Move everything (not just elements, also text nodes etc.) into the container
      // so we even include text directly in the body:
      var kids = page.childNodes;
      while (kids.length) {
        // this.log("Moving child out:", kids[0]);
        topCandidate.appendChild(kids[0]);
      }

      topCandidate.dataset[scoreAttribute] = initializeScore(topCandidate);
    } else if (topCandidate) {
      let alternativeCandidateAncestors = [];
      for (let i = 1; i < topCandidates.length; i++) {
        if (
          num(topCandidates[i].dataset[scoreAttribute]) /
            num(topCandidate.dataset[scoreAttribute]) >=
          0.75
        ) {
          alternativeCandidateAncestors.push(
            utils.getNodeAncestors(topCandidates[i])
          );
        }
      }

      const MINIMUM_TOPCANDIDATES = 3;
      if (alternativeCandidateAncestors.length >= MINIMUM_TOPCANDIDATES) {
        parentOfTopCandidate = topCandidate.parentNode;
        while (parentOfTopCandidate.tagName !== "BODY") {
          let listsContainingThisAncestor = 0;
          for (
            let ancestorIndex = 0;
            ancestorIndex < alternativeCandidateAncestors.length &&
            listsContainingThisAncestor < MINIMUM_TOPCANDIDATES;
            ancestorIndex++
          ) {
            listsContainingThisAncestor += num(
              alternativeCandidateAncestors[ancestorIndex].includes(
                parentOfTopCandidate
              )
            );
          }
          if (listsContainingThisAncestor >= MINIMUM_TOPCANDIDATES) {
            topCandidate = parentOfTopCandidate;
            break;
          }
          parentOfTopCandidate = parentOfTopCandidate.parentNode;
        }
      }
    }
  }

  return html;
};

export default { score };
