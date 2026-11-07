// Sample lessons for the dev-only /test/editor page. Starter code only: no answers, no expected output checks.

export type TestLanguage = "javascript" | "typescript" | "python";

export type TestLesson = {
  title: string;
  fileName: string;
  language: TestLanguage;
  starter: string;
  instructions: string;
  files: { path: string; body: string }[];
  output: string;
};

const readme = (lang: string) => `# Sum a list\n\nPractice lesson (${lang}). This is sample text for the test page.\n`;

export const TEST_LESSONS: Record<TestLanguage, TestLesson> = {
  javascript: {
    title: "Sum a list",
    fileName: "sum.js",
    language: "javascript",
    starter: `// Return the total of every number in the list.\nfunction sum(numbers) {\n  // your code here\n}\n\nconsole.log(sum([1, 2, 3]));\n`,
    instructions:
      "Write `sum(numbers)` so it returns the total of every number in the list.\n\nAn empty list should give 0. Press **Run** to see what your code prints.",
    files: [
      { path: "sum.js", body: "" },
      { path: "README.md", body: readme("JavaScript") },
    ],
    output: "$ node sum.js\n(sample output: the test page does not run code)\n",
  },
  typescript: {
    title: "Sum a list",
    fileName: "sum.ts",
    language: "typescript",
    starter: `// Return the total of every number in the list.\nfunction sum(numbers: number[]): number {\n  // your code here\n  return 0;\n}\n\nconsole.log(sum([1, 2, 3]));\n`,
    instructions:
      "Write `sum(numbers)` so it returns the total of every number in the list.\n\nThe types are already there. Press **Run** to see what your code prints.",
    files: [
      { path: "sum.ts", body: "" },
      { path: "README.md", body: readme("TypeScript") },
    ],
    output: "$ npx tsx sum.ts\n(sample output: the test page does not run code)\n",
  },
  python: {
    title: "Sum a list",
    fileName: "sum.py",
    language: "python",
    starter: `# Return the total of every number in the list.\ndef total(numbers):\n    # your code here\n    pass\n\nprint(total([1, 2, 3]))\n`,
    instructions:
      "Write `total(numbers)` so it returns the total of every number in the list.\n\nTry it without the built-in `sum`. Press **Run** to see what your code prints.",
    files: [
      { path: "sum.py", body: "" },
      { path: "README.md", body: readme("Python") },
    ],
    output: "$ python sum.py\n(sample output: the test page does not run code)\n",
  },
};

/** Picks the lesson for a `?language=` value; anything unknown gives JavaScript. */
export function pickTestLesson(language: unknown): TestLesson {
  return typeof language === "string" && Object.hasOwn(TEST_LESSONS, language)
    ? TEST_LESSONS[language as TestLanguage]
    : TEST_LESSONS.javascript;
}

export type TestDoc = { id: string; title: string; src: string; snippet: string; syntax: string; example: string; detail: string; see: string[] };

/** General language reference for the Docs panel. Never a lesson's answer. */
export const TEST_DOCS: TestDoc[] = [
  {
    id: "for",
    title: "for loop",
    src: "JavaScript docs",
    snippet: "Repeats a block of code while a condition is true.",
    syntax: "for (initialization; condition; update) {\n  statement\n}",
    example: "for (let i = 0; i < 4; i++) {\n  console.log(i);\n}",
    detail:
      "The initialization runs once before the loop starts. The condition is checked before each pass, and the update runs after each pass. If the condition is false at the start, the body never runs.",
    see: ["let", "fn"],
  },
  {
    id: "let",
    title: "let and const",
    src: "JavaScript docs",
    snippet: "Declare variables. let can be reassigned, const cannot.",
    syntax: "let name = value;\nconst name = value;",
    example: "let count = 0;\nconst limit = 4;",
    detail:
      "Both are scoped to the block they are declared in. const needs a value when declared and cannot be reassigned, but an object it holds can still be changed.",
    see: ["for", "fn"],
  },
  {
    id: "fn",
    title: "Functions",
    src: "JavaScript docs",
    snippet: "A named block of code that takes inputs and can return a value.",
    syntax: "function name(params) {\n  return value;\n}",
    example: "function add(a, b) {\n  return a + b;\n}",
    detail: "Arguments are matched to parameters by position. A function with no return statement returns undefined.",
    see: ["for", "let"],
  },
];
