const checkBefore = "let total = 1;\nconsole.log(total);\n";
const checkStep = (title: string) => ({
  kind: "mcq" as const,
  title,
  prompt: "What does this program print after the change?",
  beforeFiles: { "main.js": checkBefore },
  hunks: [{ id: "h1", file: "main.js", oldStart: 1, lines: ["-let total = 1;", "+let total = 2;", " console.log(total);"] }],
  options: ["READ_ANSWER_OPTION_PRIVATE", "one", "undefined", "an error"],
  answer: 0,
  hints: [{ text: "Look at the value bound to the variable.", eliminate: 2 }],
  explanations: { workedExample: "The binding changes before the log call runs.", practice: "Change the value again." },
  concepts: [],
});
export const readSteps = [checkStep("Opening check"), checkStep("Closing check")];
export const withChecks = <T extends object>(part: T) => ({ ...part, steps: readSteps });
