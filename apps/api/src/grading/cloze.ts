// Single-pass tokenizer: strings are kept whole so 'a' and "a" stay different.
// shortcut: not a real TypeScript scanner (no regex/template nesting, no unicode identifiers), enough for one-token answers; upgrade if cloze answers grow to expressions.
const IDENT_OR_NUMBER = /[A-Za-z_$][\w$]*|\d[\w.]*/y;

function tokenize(src: string): string[] {
  const out: string[] = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (/\s/.test(c)) {
      i++;
    } else if (src.startsWith("//", i)) {
      const nl = src.indexOf("\n", i);
      i = nl === -1 ? src.length : nl;
    } else if (src.startsWith("/*", i)) {
      const end = src.indexOf("*/", i + 2);
      i = end === -1 ? src.length : end + 2;
    } else if (c === '"' || c === "'" || c === "`") {
      let j = i + 1;
      while (j < src.length && src[j] !== c) j += src[j] === "\\" ? 2 : 1;
      out.push(src.slice(i, j + 1));
      i = j + 1;
    } else {
      IDENT_OR_NUMBER.lastIndex = i;
      const m = IDENT_OR_NUMBER.exec(src);
      if (m) {
        out.push(m[0]);
        i += m[0].length;
      } else {
        out.push(c);
        i++;
      }
    }
  }
  return out;
}

export function gradeCloze(text: string, answer: string, accepted: string[]): boolean {
  const got = JSON.stringify(tokenize(text));
  if (got === "[]") return false;
  return [answer, ...accepted].some((a) => JSON.stringify(tokenize(a)) === got);
}
