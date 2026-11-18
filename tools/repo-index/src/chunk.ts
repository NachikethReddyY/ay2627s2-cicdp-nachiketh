import { isScriptPath, parseProgramBody, type AstNode } from "./ast.ts";

export type Chunk = {
  symbol: string;
  kind: string;
  startLine: number;
  endLine: number;
  text: string;
};

const MAX_CHUNK_LINES = 120;
const WINDOW_LINES = 60;
const WINDOW_OVERLAP = 10;
const HEADER_SYMBOL = "(file header)";

type Span = { symbol: string; kind: string; startLine: number; endLine: number };

function withLocation(path: string, symbol: string, body: string): string {
  return `${path} :: ${symbol}\n${body}`;
}

function sliceLines(lines: string[], startLine: number, endLine: number): string {
  return lines.slice(startLine - 1, endLine).join("\n");
}

function spanChunks(path: string, lines: string[], span: Span): Chunk[] {
  const length = span.endLine - span.startLine + 1;
  if (length <= MAX_CHUNK_LINES) {
    return [
      {
        ...span,
        text: withLocation(path, span.symbol, sliceLines(lines, span.startLine, span.endLine)),
      },
    ];
  }
  const parts: Chunk[] = [];
  for (let start = span.startLine, part = 1; start <= span.endLine; start += MAX_CHUNK_LINES, part += 1) {
    const end = Math.min(start + MAX_CHUNK_LINES - 1, span.endLine);
    const symbol = `${span.symbol} (part ${part})`;
    parts.push({
      symbol,
      kind: span.kind,
      startLine: start,
      endLine: end,
      text: withLocation(path, symbol, sliceLines(lines, start, end)),
    });
  }
  return parts;
}

function windowChunks(path: string, lines: string[]): Chunk[] {
  const chunks: Chunk[] = [];
  const step = WINDOW_LINES - WINDOW_OVERLAP;
  for (let start = 1; start <= lines.length; start += step) {
    const end = Math.min(start + WINDOW_LINES - 1, lines.length);
    const symbol = `(lines ${start}-${end})`;
    chunks.push({
      symbol,
      kind: "window",
      startLine: start,
      endLine: end,
      text: withLocation(path, symbol, sliceLines(lines, start, end)),
    });
    if (end === lines.length) break;
  }
  return chunks;
}

function headerChunks(path: string, lines: string[], leftovers: Array<{ startLine: number; endLine: number }>): Chunk[] {
  if (leftovers.length === 0) return [];
  const body = leftovers.map((l) => sliceLines(lines, l.startLine, l.endLine)).join("\n");
  if (body.trim() === "") return [];
  const startLine = leftovers[0]!.startLine;
  const endLine = leftovers[leftovers.length - 1]!.endLine;
  const bodyLines = body.split("\n");
  if (bodyLines.length <= MAX_CHUNK_LINES) {
    return [{ symbol: HEADER_SYMBOL, kind: "header", startLine, endLine, text: withLocation(path, HEADER_SYMBOL, body) }];
  }
  const chunks: Chunk[] = [];
  for (let offset = 0, part = 1; offset < bodyLines.length; offset += MAX_CHUNK_LINES, part += 1) {
    const symbol = `${HEADER_SYMBOL} (part ${part})`;
    chunks.push({
      symbol,
      kind: "header",
      startLine,
      endLine,
      text: withLocation(path, symbol, bodyLines.slice(offset, offset + MAX_CHUNK_LINES).join("\n")),
    });
  }
  return chunks;
}

type Declaration = { symbol: string; kind: string };

function identifierName(node: unknown): string | null {
  const id = node as { type?: string; name?: string } | null;
  return id && id.type === "Identifier" && typeof id.name === "string" ? id.name : null;
}

function declarationOf(statement: AstNode): Declaration | null {
  const wrapped = statement.type.startsWith("Export") ? (statement.declaration as AstNode | null | undefined) : statement;
  if (!wrapped) return null;
  const byType: Record<string, string> = {
    FunctionDeclaration: "function",
    ClassDeclaration: "class",
    TSTypeAliasDeclaration: "type",
    TSInterfaceDeclaration: "interface",
    TSEnumDeclaration: "enum",
    TSDeclareFunction: "function",
  };
  const kind = byType[wrapped.type];
  if (kind) {
    const name = identifierName(wrapped.id);
    if (name) return { symbol: name, kind };
    if (statement.type === "ExportDefaultDeclaration") return { symbol: "default", kind };
    return null;
  }
  if (wrapped.type === "VariableDeclaration") {
    const declarations = wrapped.declarations as Array<{ id: unknown }>;
    const names = declarations.map((d) => identifierName(d.id)).filter((n): n is string => n !== null);
    if (names.length > 0) return { symbol: names.join(", "), kind: "const" };
  }
  return null;
}

function chunkScript(path: string, text: string): Chunk[] | null {
  const body = parseProgramBody(path, text);
  if (!body) return null;
  const lines = text.split("\n");
  const chunks: Chunk[] = [];
  const leftovers: Array<{ startLine: number; endLine: number }> = [];
  for (const statement of body) {
    const range = { startLine: statement.loc.start.line, endLine: statement.loc.end.line };
    const declaration = declarationOf(statement);
    if (declaration) chunks.push(...spanChunks(path, lines, { ...declaration, ...range }));
    else leftovers.push(range);
  }
  const all = [...headerChunks(path, lines, leftovers), ...chunks];
  return all.sort((a, b) => a.startLine - b.startLine);
}

function chunkMarkdown(path: string, text: string): Chunk[] {
  const lines = text.split("\n");
  const starts: Array<{ line: number; title: string }> = [];
  let fenced = false;
  lines.forEach((line, index) => {
    if (/^\s*(```|~~~)/.test(line)) fenced = !fenced;
    const heading = !fenced ? /^#{1,6}\s+(.+?)\s*#*\s*$/.exec(line) : null;
    if (heading) starts.push({ line: index + 1, title: heading[1]! });
  });
  const sections: Span[] = [];
  const firstHeading = starts[0]?.line ?? lines.length + 1;
  if (firstHeading > 1) sections.push({ symbol: "(intro)", kind: "section", startLine: 1, endLine: firstHeading - 1 });
  starts.forEach((start, index) => {
    const endLine = (starts[index + 1]?.line ?? lines.length + 1) - 1;
    sections.push({ symbol: start.title, kind: "section", startLine: start.line, endLine });
  });
  return sections
    .filter((s) => sliceLines(lines, s.startLine, s.endLine).trim() !== "")
    .flatMap((s) => spanChunks(path, lines, s));
}

const PYTHON_DEF = /^(?:async\s+def|def|class)\s+(\w+)/;

function pythonBlockEnd(lines: string[], from: number): number {
  let end = from;
  for (let j = from + 1; j < lines.length; j += 1) {
    const line = lines[j]!;
    if (line.trim() === "") continue;
    if (/^\s/.test(line) || /^[)\]}]/.test(line)) end = j;
    else break;
  }
  return end;
}

function chunkPython(path: string, text: string): Chunk[] {
  const lines = text.split("\n");
  const chunks: Chunk[] = [];
  const leftovers: Array<{ startLine: number; endLine: number }> = [];
  let decoratorStart: number | null = null;
  let index = 0;
  while (index < lines.length) {
    const line = lines[index]!;
    if (/^@/.test(line)) {
      decoratorStart ??= index;
      index += 1;
      continue;
    }
    const definition = PYTHON_DEF.exec(line);
    if (definition) {
      const start = decoratorStart ?? index;
      const end = pythonBlockEnd(lines, index);
      const kind = line.startsWith("class") ? "class" : "function";
      chunks.push(...spanChunks(path, lines, { symbol: definition[1]!, kind, startLine: start + 1, endLine: end + 1 }));
      decoratorStart = null;
      index = end + 1;
      continue;
    }
    if (decoratorStart !== null) {
      leftovers.push({ startLine: decoratorStart + 1, endLine: index + 1 });
      decoratorStart = null;
    } else {
      leftovers.push({ startLine: index + 1, endLine: index + 1 });
    }
    index += 1;
  }
  const merged = mergeAdjacent(leftovers);
  return [...headerChunks(path, lines, merged), ...chunks].sort((a, b) => a.startLine - b.startLine);
}

function mergeAdjacent(ranges: Array<{ startLine: number; endLine: number }>): Array<{ startLine: number; endLine: number }> {
  const merged: Array<{ startLine: number; endLine: number }> = [];
  for (const range of ranges) {
    const last = merged[merged.length - 1];
    if (last && range.startLine <= last.endLine + 1) last.endLine = Math.max(last.endLine, range.endLine);
    else merged.push({ ...range });
  }
  return merged;
}

export function chunkFile(path: string, text: string): Chunk[] {
  if (text.trim() === "") return [];
  if (isScriptPath(path)) {
    const chunks = chunkScript(path, text);
    if (chunks) return chunks;
  }
  if (/\.(md|mdx)$/i.test(path)) return chunkMarkdown(path, text);
  if (/\.py$/.test(path)) return chunkPython(path, text);
  return windowChunks(path, text.split("\n"));
}
