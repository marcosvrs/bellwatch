export interface HtmlElement {
  readonly tag: string;
  readonly attributes: Readonly<Record<string, string>>;
  readonly children: (HtmlElement | string)[];
  readonly parent?: HtmlElement;
}

const VOID_TAGS: Readonly<Record<string, true>> = {
  area: true,
  base: true,
  br: true,
  col: true,
  embed: true,
  hr: true,
  img: true,
  input: true,
  link: true,
  meta: true,
  param: true,
  source: true,
  track: true,
  wbr: true,
};

const decodeHtml = (value: string): string =>
  value.replace(
    /&(?:#(?:x[\da-f]+|\d+)|nbsp|amp|lt|gt|quot|apos|euro);/gi,
    (entity) => {
      const normalized = entity.toLowerCase();
      if (normalized === "&nbsp;") { return " "; }
      if (normalized === "&amp;") { return "&"; }
      if (normalized === "&lt;") { return "<"; }
      if (normalized === "&gt;") { return ">"; }
      if (normalized === "&quot;") { return '"'; }
      if (normalized === "&apos;") { return "'"; }
      if (normalized === "&euro;") { return "€"; }
      const digits = normalized.startsWith("&#x")
        ? Number.parseInt(normalized.slice(3, -1), 16)
        : Number.parseInt(normalized.slice(2, -1), 10);
      return Number.isInteger(digits) && digits > 0 && digits <= 0x10ffff
        ? String.fromCodePoint(digits)
        : entity;
    },
  );

const parseAttributes = (source: string): Record<string, string> => {
  const attributes: Record<string, string> = {};
  const pattern = /([^\s"'<>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
  for (const match of source.matchAll(pattern)) {
    const name = match[1]?.toLowerCase();
    if (name === undefined || Object.hasOwn(attributes, name)) { continue; }
    attributes[name] = decodeHtml(match[2] ?? match[3] ?? match[4] ?? "");
  }
  return attributes;
};

export const parseHtml = (html: string): HtmlElement => {
  const root: HtmlElement = { tag: "#root", attributes: {}, children: [] };
  const stack: HtmlElement[] = [root];
  let rawTag: string | undefined;
  const tokens = html.matchAll(/<!--[\s\S]*?-->|<![^>]*>|<\/?[a-zA-Z][^>]*>|[^<]+|</g);
  for (const match of tokens) {
    const token = match[0];
    if (rawTag !== undefined) {
      if (token.toLowerCase().startsWith(`</${rawTag}`)) { rawTag = undefined; }
      continue;
    }
    if (!token.startsWith("<") || token.startsWith("<!--") || token.startsWith("<!")) {
      stack.at(-1)?.children.push(decodeHtml(token));
      continue;
    }
    if (token.startsWith("</")) {
      const name = /^<\/\s*([a-zA-Z][\w:-]*)/.exec(token)?.[1]?.toLowerCase();
      if (name === undefined) { continue; }
      const index = stack.findLastIndex((element) => element.tag === name);
      if (index > 0) { stack.length = index; }
      continue;
    }
    const matchTag = /^<\s*([a-zA-Z][\w:-]*)\b([\s\S]*?)\/?\s*>$/.exec(token);
    const name = matchTag?.[1]?.toLowerCase();
    if (name === undefined) { continue; }
    const parent = stack.at(-1);
    const element: HtmlElement = {
      tag: name,
      attributes: parseAttributes(matchTag?.[2] ?? ""),
      children: [],
      ...(parent === undefined ? {} : { parent }),
    };
    parent?.children.push(element);
    if (name === "script" || name === "style") {
      rawTag = name;
    } else if (VOID_TAGS[name] !== true && !/\/\s*>$/.test(token)) {
      stack.push(element);
    }
  }
  return root;
};

export function* descendants(element: HtmlElement): Generator<HtmlElement> {
  for (const child of element.children) {
    if (typeof child !== "string") {
      yield child;
      yield* descendants(child);
    }
  }
}

export const elementText = (element: HtmlElement): string => {
  let text = "";
  for (const child of element.children) {
    text += typeof child === "string" ? child : elementText(child);
    text += " ";
  }
  return text.replace(/\s+/g, " ").trim();
};

export const attribute = (element: HtmlElement, name: string): string | undefined => {
  const value = element.attributes[name];
  return value === undefined || value.trim() === "" ? undefined : value.trim();
};

export const normalize = (value: string): string =>
  value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[’‘]/g, "'")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .toLowerCase();

export const firstElementText = (
  root: HtmlElement,
  predicate: (element: HtmlElement) => boolean,
): string | undefined => {
  for (const element of descendants(root)) {
    if (predicate(element)) {
      const value = attribute(element, "content") ?? elementText(element);
      if (value !== "") { return value; }
    }
  }
  return undefined;
};
