import { parse } from "@babel/parser";

export function parseSource(file: string, text: string) {
  return parse(text, {
    sourceFilename: file,
    sourceType: "module",
    plugins: ["typescript", ...(file.endsWith("x") ? (["jsx"] as const) : [])],
    errorRecovery: true,
    allowReturnOutsideFunction: true,
  });
}
