/*
 * Copyright (c) 2010 Arc90 Inc
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

/*
 * This code is heavily based on Arc90's readability.js (1.7.1) script
 * available at: http://code.google.com/p/arc90labs-readability
 */

enum NODE_TYPE {
  ELEMENT_NODE = 1,
  TEXT_NODE = 3
}

const DATA_ATTR = "antarScore";

const DEFAULT_TAGS_TO_SCORE = "section,h2,h3,h4,h5,h6,p,td,pre"
  .toUpperCase()
  .split(",");

const REGEXPS = {
  // NOTE: These two regular expressions are duplicated in
  // Readability-readerable.js. Please keep both copies in sync.
  unlikelyCandidates: /-ad-|ai2html|banner|breadcrumbs|combx|comment|community|cover-wrap|disqus|extra|foot|gdpr|header|legends|menu|related|remark|replies|rss|shoutbox|sidebar|skyscraper|social|sponsor|supplemental|ad-break|agegate|pagination|pager|popup|yom-remote/i,
  okMaybeItsACandidate: /and|article|body|column|main|shadow/i,

  positive: /article|body|content|entry|hentry|h-entry|main|page|pagination|post|text|blog|story/i,
  negative: /hidden|^hid$| hid$| hid |^hid |banner|combx|comment|com-|contact|foot|footer|footnote|gdpr|masthead|media|meta|outbrain|promo|related|scroll|share|shoutbox|sidebar|skyscraper|sponsor|shopping|tags|tool|widget/i,
  extraneous: /print|archive|comment|discuss|e[\-]?mail|share|reply|all|login|sign|single|utility/i,
  byline: /byline|author|dateline|writtenby|p-author/i,
  replaceFonts: /<(\/?)font[^>]*>/gi,
  normalize: /\s{2,}/g,
  videos: /\/\/(www\.)?((dailymotion|youtube|youtube-nocookie|player\.vimeo|v\.qq)\.com|(archive|upload\.wikimedia)\.org|player\.twitch\.tv)/i,
  nextLink: /(next|weiter|continue|>([^\|]|$)|»([^\|]|$))/i,
  prevLink: /(prev|earl|old|new|<|«)/i,
  whitespace: /^\s*$/,
  hasContent: /\S$/,
  unlikelyTags: /script|noscript|select|br|style|footer|aside|link|h1|embed|object|svg|iframe|input|textarea|button|img/,
  conditionalTags: /fieldset|form|table|ul/
};

const DIV_TO_P_ELEMS = [
  "A",
  "BLOCKQUOTE",
  "DL",
  "DIV",
  "IMG",
  "OL",
  "P",
  "PRE",
  "TABLE",
  "UL",
  "SELECT"
];

const PHRASING_ELEMS = [
  // "CANVAS", "IFRAME", "SVG", "VIDEO",
  "ABBR",
  "AUDIO",
  "B",
  "BDO",
  "BR",
  "BUTTON",
  "CITE",
  "CODE",
  "DATA",
  "DATALIST",
  "DFN",
  "EM",
  "EMBED",
  "I",
  "IMG",
  "INPUT",
  "KBD",
  "LABEL",
  "MARK",
  "MATH",
  "METER",
  "NOSCRIPT",
  "OBJECT",
  "OUTPUT",
  "PROGRESS",
  "Q",
  "RUBY",
  "SAMP",
  "SCRIPT",
  "SELECT",
  "SMALL",
  "SPAN",
  "STRONG",
  "SUB",
  "SUP",
  "TEXTAREA",
  "TIME",
  "VAR",
  "WBR"
];

export default {
  isProbablyVisible: function(node: HTMLElement): boolean {
    return (
      (!node.style || node.style.display != "none") &&
      !node.hasAttribute("hidden")
    );
  },

  isValidByline: function(byline: string | any): boolean {
    if (typeof byline == "string" || byline instanceof String) {
      byline = byline.trim();
      return byline.length > 0 && byline.length < 100;
    }
    return false;
  },

  checkByline: function(node: HTMLElement, matchString: string): boolean {
    let rel: string;
    let itemprop: string;
    if (node.getAttribute !== undefined) {
      rel = node.getAttribute("rel");
      itemprop = node.getAttribute("itemprop");
    }

    if (
      (rel === "author" ||
        (itemprop && itemprop.indexOf("author") !== -1) ||
        REGEXPS.byline.test(matchString)) &&
      this.isValidByline(node.textContent)
    ) {
      return true;
    }

    return false;
  },

  someNode: function(nodeList: Array<HTMLElement>, fn: Function) {
    return Array.prototype.some.call(nodeList, fn, this);
  },

  forEachNode: function(nodeList: Array<HTMLElement>, fn: Function) {
    Array.prototype.forEach.call(nodeList, fn, this);
  },

  hasAncestorTag: function(
    node: HTMLElement,
    tagName: string,
    maxDepth: number,
    filterFn: Function
  ): boolean {
    maxDepth = maxDepth || 3;
    tagName = tagName.toUpperCase();
    let depth = 0;
    while (node.parentNode) {
      if (maxDepth > 0 && depth > maxDepth) return false;
      if (
        (<HTMLElement>node.parentNode).tagName === tagName &&
        (!filterFn || filterFn(node.parentNode))
      )
        return true;
      node = <HTMLElement>node.parentNode;
      depth++;
    }
    return false;
  },

  isUnlikelyCandidate: function(
    node: HTMLElement,
    matchString: string
  ): boolean {
    return (
      REGEXPS.unlikelyCandidates.test(matchString) &&
      !REGEXPS.okMaybeItsACandidate.test(matchString) &&
      !this.hasAncestorTag(node, "table") &&
      node.tagName !== "BODY" &&
      node.tagName !== "A"
    );
  },

  isElementWithoutContent: function(node: HTMLElement): boolean {
    return (
      node.nodeType === NODE_TYPE.ELEMENT_NODE &&
      node.textContent.trim().length == 0 &&
      (node.children.length == 0 ||
        node.children.length ==
          node.getElementsByTagName("br").length +
            node.getElementsByTagName("hr").length)
    );
  },

  isUnlikelyTag: function(node: HTMLElement): boolean {
    return REGEXPS.unlikelyTags.test(node.tagName.toLowerCase());
  },

  isUnlikelyConditionalTag: function(node: HTMLElement): boolean {
    return REGEXPS.conditionalTags.test(node.tagName.toLowerCase());
  },

  isWithoutContentCandidate: function(node: HTMLElement): boolean {
    return (
      (node.tagName === "DIV" ||
        node.tagName === "SECTION" ||
        node.tagName === "HEADER" ||
        node.tagName === "H1" ||
        node.tagName === "H2" ||
        node.tagName === "H3" ||
        node.tagName === "H4" ||
        node.tagName === "H5" ||
        node.tagName === "H6") &&
      this.isElementWithoutContent(node)
    );
  },

  isDefaultScoreTag: function(node: HTMLElement): boolean {
    return DEFAULT_TAGS_TO_SCORE.indexOf(node.tagName) !== -1;
  },

  getInnerText: function(node: HTMLElement, normalizeSpaces?: boolean): string {
    normalizeSpaces =
      typeof normalizeSpaces === "undefined" ? true : normalizeSpaces;
    let textContent = node.textContent.trim();

    if (normalizeSpaces) {
      return textContent.replace(REGEXPS.normalize, " ");
    }
    return textContent;
  },

  getLinkDensity: function(element: HTMLElement): number {
    let textLength = this.getInnerText(element).length;
    if (textLength === 0) return 0;

    let linkLength = 0;

    // XXX implement _reduceNodeList?
    this.forEachNode(element.getElementsByTagName("a"), function(
      linkNode: HTMLElement
    ) {
      linkLength += this.getInnerText(linkNode).length;
    });

    return linkLength / textLength;
  },

  setScore: function(node: HTMLElement, value: string | number): void {
    node.dataset[DATA_ATTR] = String(value);
  },

  getScore: function(node: HTMLElement): number {
    if (!node) return;
    const score = node.dataset[DATA_ATTR];
    return score ? Number(score) : undefined;
  },

  removeScore: function(node: HTMLElement): void {
    if (!!node.dataset[DATA_ATTR]) {
      delete node.dataset[DATA_ATTR];
    }
  },

  everyNode: function(nodeList: HTMLAllCollection, fn: Function): boolean {
    return Array.prototype.every.call(nodeList, fn, this);
  },

  isWhitespace: function(node: HTMLElement): boolean {
    return (
      (node.nodeType === NODE_TYPE.TEXT_NODE &&
        node.textContent.trim().length === 0) ||
      (node.nodeType === NODE_TYPE.ELEMENT_NODE && node.tagName === "BR")
    );
  },

  getParent: function(node: HTMLElement | any): HTMLElement {
    return node.parentNode || node.parentNodeRef;
  },

  isPhrasingContent: function(node: HTMLElement): boolean {
    return (
      node.nodeType === NODE_TYPE.TEXT_NODE ||
      PHRASING_ELEMS.indexOf(node.tagName) !== -1 ||
      ((node.tagName === "A" ||
        node.tagName === "DEL" ||
        node.tagName === "INS") &&
        this.everyNode(node.childNodes, this.isPhrasingContent))
    );
  },

  hasChildBlockElement: function(element: HTMLElement): boolean {
    return this.someNode(element.childNodes, (node: HTMLElement) => {
      return (
        DIV_TO_P_ELEMS.indexOf(node.tagName) !== -1 ||
        this.hasChildBlockElement(node)
      );
    });
  },

  getNextNode: function(
    node: HTMLElement,
    ignoreSelfAndKids: boolean = false
  ): HTMLElement {
    // First check for kids if those aren't being ignored
    if (!ignoreSelfAndKids && node.firstElementChild) {
      return <HTMLElement>node.firstElementChild;
    }
    // Then for siblings...
    if (node.nextElementSibling) {
      return <HTMLElement>node.nextElementSibling;
    }
    // And finally, move up the parent chain *and* find a sibling
    // (because this is depth-first traversal, we will have already
    // seen the parent nodes themselves).
    do {
      node = <HTMLElement>node.parentNode;
    } while (node && !node.nextElementSibling);
    return node && <HTMLElement>node.nextElementSibling;
  },

  hasSingleTagInsideElement: function(
    element: HTMLElement,
    tag: string
  ): boolean {
    // There should be exactly 1 element child with given tag
    if (element.children.length !== 1 || element.children[0].tagName !== tag) {
      return false;
    }

    // And there should be no text nodes with real content
    return !this.someNode(element.childNodes, function(node: HTMLElement) {
      return (
        node.nodeType === NODE_TYPE.TEXT_NODE &&
        REGEXPS.hasContent.test(node.textContent)
      );
    });
  },

  getNodeAncestors: function(node: HTMLElement | any, maxDepth: number = 0) {
    let i = 0,
      ancestors = [];
    while (node.parentNode || node.parentNodeRef) {
      ancestors.push(node.parentNode || node.parentNodeRef);
      if (maxDepth && ++i === maxDepth) break;
      node = <HTMLElement>(node.parentNode || node.parentNodeRef);
    }
    return ancestors;
  },

  getClassWeight: function(node: HTMLElement) {
    let weight = 0;

    // Look for a special classname
    if (typeof node.className === "string" && node.className !== "") {
      if (REGEXPS.negative.test(node.className)) weight -= 25;

      if (REGEXPS.positive.test(node.className)) weight += 25;
    }

    // Look for a special ID
    if (typeof node.id === "string" && node.id !== "") {
      if (REGEXPS.negative.test(node.id)) weight -= 25;

      if (REGEXPS.positive.test(node.id)) weight += 25;
    }

    return weight;
  }
};
