import utils from "./utils";
import isProbablyReaderable from "./readerable";

enum Tag {
  DIV = "div"
}

enum SCORES {
  EXEMPT_NODE = -9999,
  PHRASING_NODE = 1000
}

enum FLags {
  FLAG_STRIP_UNLIKELYS = 0x1,
  FLAG_WEIGHT_CLASSES = 0x2,
  FLAG_CLEAN_CONDITIONALLY = 0x4
}

class FlagAttempts {
  FLAG_STRIP_UNLIKELYS: number = FLags.FLAG_STRIP_UNLIKELYS;
  FLAG_WEIGHT_CLASSES: number = FLags.FLAG_WEIGHT_CLASSES;
  FLAG_CLEAN_CONDITIONALLY: number = FLags.FLAG_CLEAN_CONDITIONALLY;

  attempts: Array<{ articleContent: HTMLElement; textLength: number }> = [];

  flags =
    this.FLAG_STRIP_UNLIKELYS |
    this.FLAG_WEIGHT_CLASSES |
    this.FLAG_CLEAN_CONDITIONALLY;

  removeFlag(flag: number) {
    this.flags = this.flags & ~flag;
  }

  isFlagActive(flag: number): boolean {
    return (this.flags & flag) > 0;
  }
}

const DEFAULT_N_TOP_CANDIDATES = 5;
const DEFAULT_CHAR_THRESHOLD = 500;

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

  if (!isProbablyReaderable(doc)) {
    return;
  }

  let articleByLine = false;
  let attemptHandler = new FlagAttempts();
  let page = doc.body;
  let pageCacheHtml = page.innerHTML;

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
    if (attemptHandler.isFlagActive(FLags.FLAG_WEIGHT_CLASSES)) {
      score += utils.getClassWeight(node);
    }
    return score;
  };

  while (true) {
    let elementsToScore = [];
    let node = doc.documentElement;

    while (node) {
      let stripUnlikelyCandidates = attemptHandler.isFlagActive(
        FLags.FLAG_STRIP_UNLIKELYS
      );

      if (utils.getScore(node) === SCORES.EXEMPT_NODE) {
        return;
      }

      if (!utils.isProbablyVisible(node) || utils.isUnlikelyTag(node)) {
        utils.setScore(node, SCORES.EXEMPT_NODE);
        node = utils.getNextNode(node);
        continue;
      }

      let matchString = node.className + " " + node.id;

      if (!articleByLine) {
        articleByLine = utils.checkByline(node, matchString);
        if (articleByLine) {
          utils.setScore(node, SCORES.EXEMPT_NODE);
          node = utils.getNextNode(node);
          continue;
        }
      }

      if (!utils.isUnlikelyCandidate(node, matchString)) {
        utils.setScore(node, SCORES.EXEMPT_NODE);
        node = utils.getNextNode(node);
        continue;
      }

      if (stripUnlikelyCandidates && !utils.isWithoutContentCandidate(node)) {
        utils.setScore(node, SCORES.EXEMPT_NODE);
        node = utils.getNextNode(node);
        continue;
      }

      if (utils.isDefaultScoreTag(node)) {
        elementsToScore.push(node);
      }

      if (node.tagName === Tag.DIV) {
        let p = null;
        let childNode = node.firstChild;
        while (childNode) {
          if (utils.isPhrasingContent(<HTMLElement>childNode)) {
            if (p !== null) {
              utils.setScore(<HTMLElement>childNode, SCORES.PHRASING_NODE);
              elementsToScore.push(childNode);
            } else if (!utils.isWhitespace(<HTMLElement>childNode)) {
              p = {};
              utils.setScore(<HTMLElement>childNode, SCORES.PHRASING_NODE);
              elementsToScore.push(childNode);
            }
          } else if (p !== null) {
            p = null;
          }
          childNode = <HTMLElement>childNode.nextSibling;
        }

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

    let candidates = [];
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

            let dataScore = utils.getScore(ancestor);

            if (typeof dataScore === "undefined") {
              utils.setScore(ancestor, initializeScore(ancestor));
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

            dataScore = dataScore + contentScore / scoreDivider;
            utils.setScore(ancestor, dataScore);
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
        utils.getScore(candidate) * (1 - utils.getLinkDensity(candidate));
      utils.setScore(candidate, candidateScore);

      for (let t = 0; t < DEFAULT_N_TOP_CANDIDATES; t++) {
        let aTopCandidate = topCandidates[t];
        let aContentScore = utils.getScore(aTopCandidate);

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
      let kids = page.childNodes;
      while (kids.length) {
        // this.log("Moving child out:", kids[0]);
        topCandidate.appendChild(kids[0]);
      }

      utils.setScore(topCandidate, initializeScore(topCandidate));
    } else if (topCandidate) {
      let alternativeCandidateAncestors = [];
      for (let i = 1; i < topCandidates.length; i++) {
        if (
          utils.getScore(topCandidates[i]) / utils.getScore(topCandidate) >=
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
            listsContainingThisAncestor += Number(
              alternativeCandidateAncestors[ancestorIndex].includes(
                parentOfTopCandidate
              )
            );
            utils.getScore(alternativeCandidateAncestors[ancestorIndex]);
          }
          if (listsContainingThisAncestor >= MINIMUM_TOPCANDIDATES) {
            topCandidate = parentOfTopCandidate;
            break;
          }
          parentOfTopCandidate = parentOfTopCandidate.parentNode;
        }
      }

      if (!utils.getScore(topCandidate)) {
        utils.setScore(node, initializeScore(topCandidate));
      }

      // Because of our bonus system, parents of candidates might have scores
      // themselves. They get half of the node. There won't be nodes with higher
      // scores than our topCandidate, but if we see the score going *up* in the first
      // few steps up the tree, that's a decent sign that there might be more content
      // lurking in other places that we want to unify in. The sibling stuff
      // below does some of that - but only if we've looked high enough up the DOM
      // tree.
      parentOfTopCandidate = topCandidate.parentNode;
      let lastScore = utils.getScore(topCandidate);
      let scoreThreshold = lastScore / 3;
      while (parentOfTopCandidate.tagName !== "BODY") {
        if (!utils.getScore(parentOfTopCandidate)) {
          parentOfTopCandidate = parentOfTopCandidate.parentNode;
          continue;
        }
        let parentScore = utils.getScore(parentOfTopCandidate);
        if (parentScore < scoreThreshold) break;
        if (parentScore > lastScore) {
          // Alright! We found a better parent to use.
          topCandidate = parentOfTopCandidate;
          break;
        }
        lastScore = parentScore;
        parentOfTopCandidate = parentOfTopCandidate.parentNode;
      }

      // If the top candidate is the only child, use parent instead. This will help sibling
      // joining logic when adjacent content is actually located in parent's sibling node.
      parentOfTopCandidate = topCandidate.parentNode;
      while (
        parentOfTopCandidate.tagName != "BODY" &&
        parentOfTopCandidate.children.length == 1
      ) {
        topCandidate = parentOfTopCandidate;
        parentOfTopCandidate = topCandidate.parentNode;
      }
      if (!utils.getScore(topCandidate)) {
        utils.setScore(topCandidate, initializeScore(topCandidate));
      }
    }

    // Now that we have the top candidate, look through its siblings for content
    // that might also be related. Things like preambles, content split by ads
    // that we removed, etc.
    let articleContent = <HTMLElement>doc.createElement(Tag.DIV);

    let siblingScoreThreshold = Math.max(
      10,
      utils.getScore(topCandidate) * 0.2
    );
    // Keep potential top candidate's parent node to try to get text direction of it later.
    parentOfTopCandidate = topCandidate.parentNode;
    let siblings = parentOfTopCandidate.children;

    for (var s = 0, sl = siblings.length; s < sl; s++) {
      let sibling = siblings[s];
      let append = false;

      console.log(
        "Looking at sibling node:",
        sibling,
        sibling.readability ? "with score " + utils.getScore(topCandidate) : ""
      );
      console.log(
        "Sibling has score",
        sibling.readability ? utils.getScore(topCandidate) : "Unknown"
      );

      if (sibling === topCandidate) {
        append = true;
        utils.setScore(sibling, utils.getScore(topCandidate));
      } else {
        let contentBonus = 0;

        // Give a bonus if sibling nodes and top candidates have the example same classname
        if (
          sibling.className === topCandidate.className &&
          topCandidate.className !== ""
        ) {
          contentBonus += utils.getScore(topCandidate) * 0.2;
        }

        if (
          utils.getScore(sibling) &&
          utils.getScore(sibling) + contentBonus >= siblingScoreThreshold
        ) {
          append = true;
          utils.setScore(sibling, utils.getScore(sibling) + contentBonus);
        } else if (sibling.nodeName === "P") {
          let linkDensity = utils.getLinkDensity(sibling);
          let nodeContent = utils.getInnerText(sibling);
          let nodeLength = nodeContent.length;

          if (nodeLength > 80 && linkDensity < 0.25) {
            append = true;
            utils.setScore(sibling, nodeLength);
          } else if (
            nodeLength < 80 &&
            nodeLength > 0 &&
            linkDensity === 0 &&
            nodeContent.search(/\.( |$)/) !== -1
          ) {
            append = true;
            utils.setScore(sibling, nodeLength);
          }
        }
      }

      if (append) {
        console.log("Appending node:", sibling);
        articleContent.appendChild(sibling);
        // siblings is a reference to the children array, and
        // sibling is removed from the array when we call appendChild().
        // As a result, we must revisit this index since the nodes
        // have been shifted.
        s -= 1;
        sl -= 1;
      }
    }

    if (!neededToCreateTopCandidate) {
      let div = doc.createElement(Tag.DIV);
      let children = articleContent.childNodes;
      while (children.length) {
        div.appendChild(children[0]);
      }
      articleContent.appendChild(div);
    }

    let parseSuccessful = true;
    const textLength = utils.getInnerText(articleContent, true).length;

    if (textLength < DEFAULT_CHAR_THRESHOLD) {
      parseSuccessful = false;
      page.innerHTML = pageCacheHtml;

      attemptHandler.attempts.push({
        articleContent,
        textLength
      });

      if (attemptHandler.isFlagActive(FLags.FLAG_STRIP_UNLIKELYS)) {
        attemptHandler.removeFlag(FLags.FLAG_STRIP_UNLIKELYS);
      } else if (attemptHandler.isFlagActive(this.FLAG_WEIGHT_CLASSES)) {
        attemptHandler.removeFlag(this.FLAG_WEIGHT_CLASSES);
      } else if (attemptHandler.isFlagActive(this.FLAG_CLEAN_CONDITIONALLY)) {
        attemptHandler.removeFlag(this.FLAG_CLEAN_CONDITIONALLY);
      } else {
        // No luck after removing flags, just return the longest text we found during the different loops
        attemptHandler.attempts.sort((a, b) => {
          return b.textLength - a.textLength;
        });

        // But first check if we actually have something
        if (!attemptHandler.attempts[0].textLength) {
          return null;
        }

        articleContent = attemptHandler.attempts[0].articleContent;
        parseSuccessful = true;
      }
    }

    if (parseSuccessful) {
      return articleContent.innerHTML;
    }
  }
};

export default { score };
