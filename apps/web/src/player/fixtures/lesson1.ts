import type { StepInput } from "@learnquest/player-core";

// Synthetic lesson (ours, MIT). Each step's beforeFiles is the previous step's result.
const CART = "src/cart.js";
const TEST = "src/cart.test.js";

const SOURCE_SHA = "c01e6797afa12e0ae94a872ce7ef69f362b5b42e";

const cart1 = `export function addItem(cart, item) {
  return [...cart, item];
}
`;
const cart2 = `export function addItem(cart, item) {
  return [...cart, item];
}

export function cartTotal(cart) {
  return cart.reduce((sum, item) => sum + item.price, 0);
}
`;
const cart3 = `export function addItem(cart, item) {
  return [...cart, item];
}

export function cartTotal(cart, discount = 0) {
  const subtotal = cart.reduce((sum, item) => sum + item.price, 0);
  return subtotal * (1 - discount);
}
`;
const test1 = `import { cartTotal } from "./cart.js";

console.assert(cartTotal([]) === 0);
`;

type Hint = { text: string; eliminate?: number };

type StepBase = {
  id: string;
  title: string;
  prompt: string;
  input: StepInput;
  hints: Hint[];
  explanations: { workedExample: string; practice: string };
};

type McqStep = StepBase & { kind: "mcq"; options: string[]; answer: number; accepted?: never };
type ClozeStep = StepBase & { kind: "cloze"; answer: string; accepted: string[]; options?: never };
type Step = McqStep | ClozeStep;

const steps: Step[] = [
  {
    id: "s1",
    title: "Add a cartTotal function",
    prompt: "cartTotal(cart) is added next. How will it add up the prices?",
    kind: "mcq",
    options: [
      "A for loop that pushes each price into a new array",
      "reduce, with the sum starting at 0",
      "reduce, with no starting value",
      "Math.max over the prices",
    ],
    answer: 1,
    hints: [
      { text: "Look at addItem: this file prefers array methods to loops.", eliminate: 3 },
      { text: "An empty cart must total 0, not throw an error." },
    ],
    explanations: {
      workedExample:
        "Write cartTotal(cart), which adds up the price of every item in the cart. Notice how reduce starts from 0 so an empty cart totals 0.",
      practice: "Write cartCount(cart) that returns how many items are in the cart, using reduce.",
    },
    input: {
      beforeFiles: { [CART]: cart1, [TEST]: test1 },
      hunks: [
        {
          id: "h1",
          file: CART,
          oldStart: 3,
          lines: [
            " }",
            "+",
            "+export function cartTotal(cart) {",
            "+  return cart.reduce((sum, item) => sum + item.price, 0);",
            "+}",
          ],
        },
      ],
    },
  },
  {
    id: "s2",
    title: "Support a discount",
    prompt:
      "cartTotal gets a second, optional parameter for a discount. Type that parameter exactly as it will appear in the signature.",
    kind: "cloze",
    answer: "discount = 0",
    accepted: ["discount = 0", "discount=0"],
    hints: [
      { text: "Old callers pass only the cart, so the parameter must be optional." },
      { text: "Give it a default value that means no discount at all." },
    ],
    explanations: {
      workedExample:
        "Give cartTotal an optional discount between 0 and 1. Watch how the subtotal is computed first, then scaled by (1 - discount).",
      practice: "Add an optional taxRate parameter that defaults to no tax.",
    },
    input: {
      beforeFiles: { [CART]: cart2, [TEST]: test1 },
      hunks: [
        {
          id: "h2",
          file: CART,
          oldStart: 5,
          lines: [
            "-export function cartTotal(cart) {",
            "-  return cart.reduce((sum, item) => sum + item.price, 0);",
            "+export function cartTotal(cart, discount = 0) {",
            "+  const subtotal = cart.reduce((sum, item) => sum + item.price, 0);",
            "+  return subtotal * (1 - discount);",
            " }",
          ],
        },
      ],
    },
  },
  {
    id: "s3",
    title: "Test the total and the discount",
    prompt:
      "The test adds a check for a 50% discount on items priced 10 and 5. What value will it assert?",
    kind: "mcq",
    options: ["15", "7.5", "5", "2.5"],
    answer: 1,
    hints: [
      { text: "Work out the plain total first.", eliminate: 0 },
      { text: "Then multiply it by (1 - 0.5)." },
    ],
    explanations: {
      workedExample:
        "Add console.assert checks for a plain total and for a 50% discount, so the behaviour from the last two steps is pinned down.",
      practice: "Add an assertion for a 20% discount on the same items.",
    },
    input: {
      beforeFiles: { [CART]: cart3, [TEST]: test1 },
      hunks: [
        {
          id: "h3",
          file: TEST,
          oldStart: 3,
          lines: [
            " console.assert(cartTotal([]) === 0);",
            "+",
            "+const items = [{ price: 10 }, { price: 5 }];",
            "+console.assert(cartTotal(items) === 15);",
            "+console.assert(cartTotal(items, 0.5) === 7.5);",
          ],
        },
      ],
    },
  },
];

const source = {
  repo: "NachikethReddyY/LearnQuest",
  sha: SOURCE_SHA,
  path: "apps/web/src/player/fixtures/lesson1.ts",
};

export default {
  id: "lesson-1",
  title: "Build a shopping cart total",
  mode: "video" as "video" | "task",
  source,
  steps: steps.map((s, idx) => ({ ...s, idx })),
};
