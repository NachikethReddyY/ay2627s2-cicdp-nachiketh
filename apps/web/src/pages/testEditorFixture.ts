// Sample lessons for the dev-only /test/editor page. Starter code only: no answers, no expected output checks.
import { filePaths, type TreeNode } from "../player/workbench/fileTree.ts";

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

/** The default fixture: the JavaScript lesson. */
export const TEST_LESSON: TestLesson = TEST_LESSONS.javascript;

/** Picks the lesson for a `?language=` value; anything unknown gives JavaScript. */
export function pickTestLesson(language: unknown): TestLesson {
  return typeof language === "string" && Object.hasOwn(TEST_LESSONS, language)
    ? TEST_LESSONS[language as TestLanguage]
    : TEST_LESSONS.javascript;
}

/** The navigator tree of Main.dc.html. The lesson's file takes the design's selected-row slot (trace-loop.ts). */
export const TREE_ROOT = "learnquest";
export const LESSON_DIR = `${TREE_ROOT}/packages/player-core/src`;

export function designTree(lessonFile: string): TreeNode[] {
  return [
    {
      name: TREE_ROOT,
      open: true,
      children: [
        {
          name: "apps",
          open: true,
          children: [
            { name: "api", children: [{ name: "server.ts" }] },
            { name: "web", children: [{ name: "main.tsx" }] },
          ],
        },
        {
          name: "packages",
          open: true,
          children: [
            {
              name: "player-core",
              open: true,
              children: [{ name: "src", open: true, children: [{ name: "index.ts" }, { name: "timeline.ts" }, { name: lessonFile, status: "M" }] }],
            },
            { name: "ui-catalog", children: [{ name: "index.ts" }] },
          ],
        },
        {
          name: "services",
          children: [
            { name: "engine", children: [{ name: "main.py" }] },
            { name: "sandbox", children: [{ name: "main.ts" }] },
          ],
        },
        { name: "docs", children: [{ name: "plan.md" }] },
        { name: "README.md" },
        { name: "AGENTS.md" },
        { name: "DESIGN.md" },
        { name: "package.json" },
      ],
    },
  ];
}

/** Every file of the design tree, as full paths. */
export const designFilePaths = (lessonFile: string) => filePaths(designTree(lessonFile));

/** Short stand-in text for the files that are not the lesson: a one-line comment, nothing from a real lesson. */
export function placeholderBody(path: string): string {
  const name = path.split("/").pop() ?? path;
  if (name.endsWith(".json")) return "{}\n";
  if (name.endsWith(".md")) return `# ${name}\n\nPlaceholder text for the test page.\n`;
  if (name.endsWith(".py")) return `# ${name}: placeholder for the test page.\n`;
  return `// ${name}: placeholder for the test page.\n`;
}

/** Monaco language for a tree file; the lesson file keeps the lesson's own. */
export function languageOf(path: string, lessonLanguage: TestLanguage): string {
  if (path.endsWith(".md")) return "markdown";
  if (path.endsWith(".json")) return "json";
  if (path.endsWith(".py")) return "python";
  if (path.endsWith(".html")) return "html";
  if (path.endsWith(".css")) return "css";
  if (/\.tsx?$/.test(path)) return "typescript";
  return lessonLanguage;
}
