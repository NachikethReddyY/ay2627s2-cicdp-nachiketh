const WHITESPACE = new Set(
  "\t\n\v\f\r \u00a0\u1680\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200a\u2028\u2029\u202f\u205f\u3000\ufeff",
);
const IDENT_OR_NUMBER = /[A-Za-z_$][A-Za-z0-9_$]*|[0-9][A-Za-z0-9_.]*/y;
const QUOTES = new Set(['"', "'", "`"]);

type Scan = { tokens: string[]; nested: string[] };

export function scanTokens(src: string): Scan {
  const tokens: string[] = [];
  const nested: string[] = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    const lineStart = src.lastIndexOf("\n", i - 1) + 1;
    const lineIndent = src.slice(lineStart, i);
    if ((src.startsWith("```", i) || src.startsWith("~~~", i)) && /^ {0,3}$/.test(lineIndent)) {
      const marker = src.slice(i, i + 3);
      const close = src.indexOf(`\n${marker}`, i + 3);
      const end = close === -1 ? src.length : close;
      nested.push(src.slice(i + 3, end));
      i = close === -1 ? src.length : end + 4;
    } else if (WHITESPACE.has(c)) {
      i++;
    } else if (src.startsWith("//", i)) {
      const nl = src.indexOf("\n", i);
      const end = nl === -1 ? src.length : nl;
      nested.push(src.slice(i + 2, end));
      i = end;
    } else if (src.startsWith("/*", i)) {
      const close = src.indexOf("*/", i + 2);
      nested.push(src.slice(i + 2, close === -1 ? src.length : close));
      i = close === -1 ? src.length : close + 2;
    } else if (QUOTES.has(c) && !(c === "'" && i > 0 && /[A-Za-z0-9_$]/.test(src[i - 1]))) {
      let j = i + 1;
      while (j < src.length && src[j] !== c) j += src[j] === "\\" ? 2 : 1;
      tokens.push(src.slice(i, j + 1));
      nested.push(src.slice(i + 1, Math.min(j, src.length)));
      i = j + 1;
    } else {
      IDENT_OR_NUMBER.lastIndex = i;
      const m = IDENT_OR_NUMBER.exec(src);
      tokens.push(m ? m[0] : c);
      i += m ? m[0].length : 1;
    }
  }
  return { tokens, nested };
}

const foldAscii = (s: string) => s.startsWith('"') || s.startsWith("'") || s.startsWith("`") ? s : s.replace(/[A-Z]/g, (c) => c.toLowerCase());

const NUMBER_TOKEN = /^[0-9]/;
const TRAILING_DOTS = /\.+$/;

const sameToken = (token: string, wanted: string, prose: boolean) => token === wanted || (prose && NUMBER_TOKEN.test(token) && TRAILING_DOTS.test(token) && token.replace(TRAILING_DOTS, "") === wanted);

function hasRun(tokens: string[], run: string[], prose: boolean): boolean {
  for (let i = 0; i + run.length <= tokens.length; i++) {
    if (run.every((wanted, k) => sameToken(tokens[i + k], wanted, prose))) return true;
  }
  return false;
}

export function containsAnswer(text: string, answer: string, prose = true): boolean {
  const answerTokens = scanTokens(answer).tokens;
  const run = prose ? answerTokens.map(foldAscii) : answerTokens;
  if (run.length === 0) return false;
  const pending: { src: string; prose: boolean }[] = [{ src: text, prose }];
  for (let next = pending.pop(); next !== undefined; next = pending.pop()) {
    const { src, prose } = next;
    const { tokens, nested } = scanTokens(src);
    const comparable = prose ? tokens.map(foldAscii) : tokens;
    if (hasRun(comparable, run, prose)) return true;
    pending.push(...nested.map((nestedSrc) => ({ src: nestedSrc, prose: false })));
  }
  return false;
}
