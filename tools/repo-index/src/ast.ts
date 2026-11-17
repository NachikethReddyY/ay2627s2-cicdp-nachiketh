import { parse } from "@babel/parser";

export type AstNode = {
  type: string;
  start: number;
  end: number;
  loc: { start: { line: number }; end: { line: number } };
  [key: string]: unknown;
};

const SCRIPT_EXTENSIONS = /\.(ts|tsx|mts|cts|js|jsx|mjs|cjs)$/;

export function isScriptPath(path: string): boolean {
  return SCRIPT_EXTENSIONS.test(path);
}

export function parseProgramBody(path: string, text: string): AstNode[] | null {
  try {
    const file = parse(text, {
      sourceType: "module",
      errorRecovery: true,
      allowReturnOutsideFunction: true,
      plugins: ["typescript", "jsx"],
    });
    return file.program.body as unknown as AstNode[];
  } catch {
    return null;
  }
}
