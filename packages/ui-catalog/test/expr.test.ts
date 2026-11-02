import { test } from "node:test";
import assert from "node:assert/strict";
import fc from "fast-check";
import { evalExpr, parseExpr } from "../src/core/expr.ts";

const run = (src: string, vars: Record<string, number> = { x: 2 }) => {
  const r = parseExpr(src, Object.keys(vars));
  assert.ok(r.ok, src);
  return evalExpr(r.ast, vars);
};

test("precedence, unary minus and right-associative powers", () => {
  assert.equal(run("1 + 2 * 3"), 7);
  assert.equal(run("-x^2"), -4);
  assert.equal(run("2^3^2"), 512);
  assert.equal(run("2^-1"), 0.5);
  assert.equal(run("--x"), 2);
  assert.equal(run("(1+2)*x"), 6);
  assert.equal(run("10 - 4 - 3"), 3);
});

test("functions, fixed arity and slider names", () => {
  assert.equal(run("max(x, 5) + min(1, 2)"), 6);
  assert.equal(run("a * x + b", { x: 3, a: 2, b: 1 }), 7);
  assert.equal(run("abs(-2.5)"), 2.5);
  assert.ok(Math.abs(run("sin(0)")) < 1e-12);
});

test("undefined results are NaN, never thrown", () => {
  for (const s of ["1/0", "log(0)", "sqrt(-1)", "0/0", "exp(1000)", "(-8)^0.5"]) assert.ok(Number.isNaN(run(s)), s);
  const r = parseExpr("x + a", ["x", "a"]);
  assert.ok(r.ok);
  assert.ok(Number.isNaN(evalExpr(r.ast, { x: 1 })));
});

for (const [src, msg, pos] of [
  ["foo(x)", /unknown name "foo"/, 0],
  ["y + 1", /unknown name "y"/, 0],
  ['"abc"', /unexpected """/, 0],
  ["x.length", /expected digits|unexpected "\."/, 1],
  ["x = 1", /unexpected "="/, 2],
  ["constructor", /unknown name/, 0],
  ["sin", /needs/, 3],
  ["sin(x, 1)", /takes 1 argument/, 0],
  ["min(1)", /takes 2 arguments/, 0],
  ["1, 2", /unexpected ","/, 1],
  ["x(1)", /not a function/, 1],
  ["(1+2", /expected \)/, 4],
  ["", /end of expression/, 0],
  ["1 +", /end of expression/, 3],
  ["1e5", /unknown name "e5"|unexpected/, 1],
  ["x".repeat(81), /over 80/, 80],
  ["-".repeat(25) + "x", /deeper than 20/, 0],
  ["x+".repeat(39) + "x", /deeper than 20|more than 200|over 80/, 0],
] as const) {
  test(`rejects ${JSON.stringify(src.length > 30 ? src.slice(0, 30) + "..." : src)}`, () => {
    const r = parseExpr(src, ["x"]);
    assert.ok(!r.ok);
    assert.match(r.error, msg);
    assert.equal(r.pos, pos);
  });
}

test("nesting", () => {
  assert.ok(parseExpr("(".repeat(30) + "x" + ")".repeat(30), ["x"]).ok); // parentheses add no depth
  assert.ok(parseExpr("sin(".repeat(8) + "x" + ")".repeat(8), ["x"]).ok);
});

test("fuzz: parse never throws and accepted input always evaluates", () => {
  const alphabet = fc.stringMatching(/^[0-9a-z_ +\-*\/^(),."'=;\[\]{}$\\`]{0,90}$/);
  fc.assert(
    fc.property(fc.oneof(fc.string({ maxLength: 100 }), fc.string({ unit: "grapheme", maxLength: 100 }), alphabet), (s) => {
      const r = parseExpr(s, ["x", "a"]);
      if (r.ok) assert.equal(typeof evalExpr(r.ast, { x: 1.5, a: -2 }), "number");
      else assert.ok(Number.isInteger(r.pos) && r.pos >= 0);
    }),
    { numRuns: 2000 },
  );
  // grammar-shaped strings, so the accept path is exercised
  const piece = fc.constantFrom("x", "a", "1", "2.5", "+", "-", "*", "/", "^", "(", ")", ",", "sin(", "max(", "min(", "log(", " ");
  let accepted = 0;
  fc.assert(
    fc.property(fc.array(piece, { maxLength: 30 }), (parts) => {
      const r = parseExpr(parts.join(""), ["x", "a"]);
      if (r.ok) { accepted++; assert.equal(typeof evalExpr(r.ast, { x: 0, a: 1e308 }), "number"); }
    }),
    { numRuns: 5000 },
  );
  assert.ok(accepted > 0);
});
