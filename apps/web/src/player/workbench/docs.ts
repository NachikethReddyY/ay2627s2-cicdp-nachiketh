// Starter language reference for the Docs panel and the palette's docs mode. Hand-written and generic:
// nothing here may be a lesson's answer or expected output.

export type DocSource = "JavaScript docs" | "TypeScript docs" | "Python docs";

export type Doc = {
  id: string;
  title: string;
  src: DocSource;
  tags: string;
  snippet: string;
  syntax: string;
  example: string;
  detail: string;
  /** Ids of related entries. */
  see: string[];
  /** Identifiers a hover matches (`for`, `push`). */
  words: string[];
};

export type DocLanguage = "javascript" | "typescript" | "python";

export const DOCS: Doc[] = [
  {
    id: "for",
    title: "for loop",
    src: "JavaScript docs",
    tags: "loop iterate repeat i++ counter",
    snippet: "Repeats a block of code while a condition is true.",
    syntax: "for (initialization; condition; update) {\n  statement\n}",
    example: "for (let i = 0; i < 4; i++) {\n  console.log(i);\n}",
    detail:
      "The initialization runs once before the loop starts. The condition is checked before each pass, and the update runs after each pass. If the condition is false at the start, the body never runs.",
    see: ["while", "let", "push"],
    words: ["for"],
  },
  {
    id: "while",
    title: "while loop",
    src: "JavaScript docs",
    tags: "loop repeat condition until",
    snippet: "Repeats a block of code for as long as a condition stays true.",
    syntax: "while (condition) {\n  statement\n}",
    example: "let n = 3;\nwhile (n > 0) {\n  console.log(n);\n  n--;\n}",
    detail:
      "The condition is checked before every pass, so the body may never run. Something inside the loop has to change what the condition sees, or the loop never ends.",
    see: ["for", "if"],
    words: ["while"],
  },
  {
    id: "let",
    title: "let and const",
    src: "JavaScript docs",
    tags: "variables declare assign reassign",
    snippet: "Declare variables. let can be reassigned, const cannot.",
    syntax: "let name = value;\nconst name = value;",
    example: "let count = 0;\nconst limit = 4;",
    detail:
      "Both are scoped to the block they are declared in. const needs a value when declared and cannot be reassigned, but an object it holds can still be changed.",
    see: ["for", "if"],
    words: ["let", "const"],
  },
  {
    id: "if",
    title: "if...else",
    src: "JavaScript docs",
    tags: "conditionals branch condition",
    snippet: "Runs a block only when a condition is true, with an optional else branch.",
    syntax: "if (condition) {\n  ...\n} else {\n  ...\n}",
    example: 'if (age >= 18) {\n  console.log("adult");\n} else {\n  console.log("minor");\n}',
    detail:
      "The condition is converted to true or false first. Values such as 0, an empty string, null and undefined count as false.",
    see: ["let", "fn"],
    words: ["if", "else"],
  },
  {
    id: "fn",
    title: "Functions",
    src: "JavaScript docs",
    tags: "function return parameters call",
    snippet: "A named block of code that takes inputs and can return a value.",
    syntax: "function name(params) {\n  return value;\n}",
    example: "function add(a, b) {\n  return a + b;\n}",
    detail: "Arguments are matched to parameters by position. A function with no return statement returns undefined.",
    see: ["if", "let", "log"],
    words: ["function", "return"],
  },
  {
    id: "push",
    title: "Array.prototype.push",
    src: "JavaScript docs",
    tags: "array add append",
    snippet: "Adds items to the end of an array.",
    syntax: "array.push(item1, item2)",
    example: 'const names = ["Ada"];\nnames.push("Grace");',
    detail: "Changes the array in place and returns its new length.",
    see: ["map", "for"],
    words: ["push"],
  },
  {
    id: "map",
    title: "Array.prototype.map",
    src: "JavaScript docs",
    tags: "array transform callback new list",
    snippet: "Builds a new array by calling a function on every item.",
    syntax: "array.map((item, index) => newItem)",
    example: "const doubled = [4, 5].map((n) => n * 2);",
    detail:
      "The original array is left alone. The new array has the same length, with each item replaced by what the callback returned.",
    see: ["push", "fn"],
    words: ["map"],
  },
  {
    id: "log",
    title: "console.log",
    src: "JavaScript docs",
    tags: "print output debug display",
    snippet: "Prints values to the console.",
    syntax: "console.log(value1, value2)",
    example: 'const name = "Ada";\nconsole.log("Hello", name);',
    detail:
      "Several values are printed on one line, separated by spaces. It returns undefined and does not change the values it prints.",
    see: ["fn", "let"],
    words: ["console"],
  },
  {
    id: "record",
    title: "Record<K, V>",
    src: "TypeScript docs",
    tags: "type object map utility",
    snippet: "An object type whose keys are K and whose values are V.",
    syntax: "Record<Keys, Value>",
    example: "type Ages = Record<string, number>;",
    detail: "Record<string, number> describes an object with any string keys whose values are all numbers.",
    see: ["let", "fn"],
    words: ["Record"],
  },
  {
    id: "py-for",
    title: "for loop (Python)",
    src: "Python docs",
    tags: "loop iterate repeat range",
    snippet: "Repeats a block once for each item in a sequence.",
    syntax: "for item in sequence:\n    statement",
    example: "for i in range(4):\n    print(i)",
    detail:
      "range(4) gives 0, 1, 2 and 3. The block is the indented lines under the colon. Any list, string or other iterable works as the sequence.",
    see: ["py-if", "print"],
    words: ["for", "range"],
  },
  {
    id: "py-if",
    title: "if / elif / else (Python)",
    src: "Python docs",
    tags: "conditionals branch condition",
    snippet: "Runs a block only when a condition is true.",
    syntax: "if condition:\n    ...\nelif other:\n    ...\nelse:\n    ...",
    example: 'if age >= 18:\n    print("adult")\nelse:\n    print("minor")',
    detail:
      "Indentation marks the block. Only the first branch whose condition is true runs. 0, an empty string, None and an empty list count as false.",
    see: ["py-for", "py-def"],
    words: ["if", "elif", "else"],
  },
  {
    id: "py-def",
    title: "def (Python functions)",
    src: "Python docs",
    tags: "function return parameters call define",
    snippet: "Defines a function that takes inputs and can return a value.",
    syntax: "def name(params):\n    return value",
    example: "def add(a, b):\n    return a + b",
    detail: "Arguments are matched to parameters by position or by name. A function with no return statement returns None.",
    see: ["py-if", "print"],
    words: ["def", "return"],
  },
  {
    id: "print",
    title: "print",
    src: "Python docs",
    tags: "output display debug console",
    snippet: "Prints values to the screen.",
    syntax: "print(value1, value2, sep=' ', end='\\n')",
    example: 'name = "Ada"\nprint("Hello", name)',
    detail:
      "Several values are printed on one line, separated by sep. It ends the line with end, which is a newline unless you change it.",
    see: ["input", "py-def"],
    words: ["print"],
  },
  {
    id: "input",
    title: "input",
    src: "Python docs",
    tags: "read keyboard user text prompt",
    snippet: "Reads a line of text from the user.",
    syntax: "input(prompt)",
    example: 'name = input("Your name? ")\nprint("Hi", name)',
    detail: "It always returns a string. Convert it with int() or float() when you need a number.",
    see: ["print", "py-def"],
    words: ["input"],
  },
];

/** Docs whose title, tags or snippet contain `q` (case-insensitive). A blank query gives nothing. */
export function searchDocs(q: string, docs: Doc[] = DOCS): Doc[] {
  const needle = q.trim().toLowerCase();
  if (!needle) return [];
  return docs.filter((d) => `${d.title} ${d.tags} ${d.snippet}`.toLowerCase().includes(needle));
}

const BY_LANGUAGE: Record<DocLanguage, DocSource[]> = {
  javascript: ["JavaScript docs", "TypeScript docs"],
  typescript: ["JavaScript docs", "TypeScript docs"],
  python: ["Python docs"],
};

/** The entry a hover on `word` should show, for the file's language. */
export function docForWord(word: string, language: DocLanguage): Doc | undefined {
  const sources = BY_LANGUAGE[language];
  return DOCS.find((d) => sources.includes(d.src) && d.words.includes(word));
}
