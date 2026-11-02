// Safe expression grammar for `chart` function plots. Hand-written recursive descent; no eval, no Function.
//   expr  = term (("+" | "-") term)*
//   term  = unary (("*" | "/") unary)*
//   unary = "-" unary | power
//   power = atom ("^" unary)?            right-associative; binds tighter than unary minus, so -x^2 = -(x^2)
//   atom  = number | name | fn "(" expr ("," expr)* ")" | "(" expr ")"

export const MAX_EXPR_LEN = 80;
export const MAX_EXPR_DEPTH = 20;
export const MAX_EXPR_NODES = 200;

/** Allowed functions and their fixed arity. */
export const FUNCTIONS = { sin: 1, cos: 1, tan: 1, sqrt: 1, abs: 1, exp: 1, log: 1, min: 2, max: 2 } as const;
type Fn = keyof typeof FUNCTIONS;

export type Ast =
  | { t: "num"; v: number }
  | { t: "var"; name: string }
  | { t: "neg"; a: Ast }
  | { t: "bin"; op: "+" | "-" | "*" | "/" | "^"; a: Ast; b: Ast }
  | { t: "call"; fn: Fn; args: Ast[] };

export type ParseExprResult = { ok: true; ast: Ast } | { ok: false; error: string; pos: number };

class Fail extends Error {
  pos: number;
  constructor(message: string, pos: number) {
    super(message);
    this.pos = pos;
  }
}

const isFn = (s: string): s is Fn => Object.hasOwn(FUNCTIONS, s);

/** `vars` is the allow-list of variable names (e.g. "x" plus the slider ids). Never throws. */
export function parseExpr(src: string, vars: readonly string[]): ParseExprResult {
  try {
    if (typeof src !== "string") throw new Fail("expression must be text", 0);
    if (src.length > MAX_EXPR_LEN) throw new Fail(`expression is over ${MAX_EXPR_LEN} characters`, MAX_EXPR_LEN);
    let i = 0;
    let nodes = 0;
    const ws = () => { while (src[i] === " ") i++; };
    const peek = () => (ws(), src[i]);
    const node = <T extends Ast>(n: T): T => {
      if (++nodes > MAX_EXPR_NODES) throw new Fail(`expression has more than ${MAX_EXPR_NODES} parts`, i);
      return n;
    };
    const depth = (a: Ast): number =>
      a.t === "neg" ? 1 + depth(a.a) : a.t === "bin" ? 1 + Math.max(depth(a.a), depth(a.b)) : a.t === "call" ? 1 + Math.max(0, ...a.args.map(depth)) : 1;
    const bin = (op: "+" | "-" | "*" | "/" | "^", a: Ast, b: Ast) => node({ t: "bin", op, a, b });

    const expr = (): Ast => {
      let a = term();
      for (let c = peek(); c === "+" || c === "-"; c = peek()) { i++; a = bin(c, a, term()); }
      return a;
    };
    const term = (): Ast => {
      let a = unary();
      for (let c = peek(); c === "*" || c === "/"; c = peek()) { i++; a = bin(c, a, unary()); }
      return a;
    };
    const unary = (): Ast => {
      if (peek() === "-") { i++; return node({ t: "neg", a: unary() }); }
      const a = atom();
      if (peek() === "^") { i++; return bin("^", a, unary()); }
      return a;
    };
    const atom = (): Ast => {
      const c = peek();
      if (c === undefined) throw new Fail("unexpected end of expression", i);
      if (c === "(") {
        i++;
        const a = expr();
        if (peek() !== ")") throw new Fail("expected )", i);
        i++;
        return a;
      }
      const start = i;
      if (/[0-9]/.test(c)) {
        while (/[0-9]/.test(src[i] ?? "")) i++;
        if (src[i] === ".") { i++; if (!/[0-9]/.test(src[i] ?? "")) throw new Fail("expected digits after .", i); while (/[0-9]/.test(src[i] ?? "")) i++; }
        return node({ t: "num", v: Number(src.slice(start, i)) });
      }
      if (/[a-z_]/.test(c)) {
        while (/[a-z0-9_]/.test(src[i] ?? "")) i++;
        const name = src.slice(start, i);
        if (isFn(name)) {
          if (peek() !== "(") throw new Fail(`${name} needs ( )`, i);
          i++;
          const args = [expr()];
          while (peek() === ",") { i++; args.push(expr()); }
          if (args.length !== FUNCTIONS[name]) throw new Fail(`${name} takes ${FUNCTIONS[name]} argument${FUNCTIONS[name] > 1 ? "s" : ""}`, start);
          if (peek() !== ")") throw new Fail("expected )", i);
          i++;
          return node({ t: "call", fn: name, args });
        }
        if (!vars.includes(name)) throw new Fail(`unknown name "${name}"`, start);
        if (peek() === "(") throw new Fail(`"${name}" is not a function`, i);
        return node({ t: "var", name });
      }
      throw new Fail(`unexpected "${c}"`, i);
    };

    const ast = expr();
    if (peek() !== undefined) throw new Fail(`unexpected "${src[i]}"`, i);
    if (depth(ast) > MAX_EXPR_DEPTH) throw new Fail(`expression is nested deeper than ${MAX_EXPR_DEPTH}`, 0);
    return { ok: true, ast };
  } catch (e) {
    // shortcut: a RangeError from absurd nesting is also reported as a parse error, with position 0
    return e instanceof Fail ? { ok: false, error: e.message, pos: e.pos } : { ok: false, error: "expression is too complex", pos: 0 };
  }
}

/** Evaluates with `vars`; an unknown variable or any non-finite result (divide by zero, log(0), sqrt(-1)) is NaN. Never throws. */
export function evalExpr(ast: Ast, vars: Readonly<Record<string, number>>): number {
  const go = (a: Ast): number => {
    switch (a.t) {
      case "num": return a.v;
      case "var": return Object.hasOwn(vars, a.name) ? Number(vars[a.name]) : NaN;
      case "neg": return -go(a.a);
      case "bin": {
        const x = go(a.a), y = go(a.b);
        return a.op === "+" ? x + y : a.op === "-" ? x - y : a.op === "*" ? x * y : a.op === "/" ? x / y : x ** y;
      }
      case "call": {
        const [x = NaN, y = NaN] = a.args.map(go);
        switch (a.fn) {
          case "sin": return Math.sin(x);
          case "cos": return Math.cos(x);
          case "tan": return Math.tan(x);
          case "sqrt": return Math.sqrt(x);
          case "abs": return Math.abs(x);
          case "exp": return Math.exp(x);
          case "log": return Math.log(x);
          case "min": return Math.min(x, y);
          case "max": return Math.max(x, y);
        }
      }
    }
  };
  const r = go(ast);
  return Number.isFinite(r) ? r : NaN;
}
