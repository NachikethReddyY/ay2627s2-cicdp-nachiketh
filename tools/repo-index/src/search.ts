import { fromBlob, openDb, type Db } from "./db.ts";
import type { Embedder } from "./embed.ts";
import { assertSameProvider } from "./indexer.ts";

export type SearchHit = {
  path: string;
  symbol: string;
  kind: string;
  startLine: number;
  endLine: number;
  score: number;
  text: string;
};

export type RelatedFiles = { path: string; imports: string[]; importedBy: string[] };

const CANDIDATES_PER_RANKER = 30;
const RRF_K = 60;

type ChunkRow = {
  id: number;
  path: string;
  symbol: string;
  kind: string;
  start_line: number;
  end_line: number;
  text: string;
};

const CHUNK_COLUMNS = "id, path, symbol, kind, start_line, end_line, text";

function toHit(row: ChunkRow, score: number): SearchHit {
  return {
    path: row.path,
    symbol: row.symbol,
    kind: row.kind,
    startLine: row.start_line,
    endLine: row.end_line,
    score,
    text: row.text,
  };
}

function cosine(a: Float32Array, b: Float32Array): number {
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i += 1) {
    dot += a[i]! * b[i]!;
    normA += a[i]! * a[i]!;
    normB += b[i]! * b[i]!;
  }
  const denominator = Math.sqrt(normA) * Math.sqrt(normB);
  return denominator === 0 ? 0 : dot / denominator;
}

function semanticRanking(db: Db, queryVector: Float32Array): number[] {
  const rows = db.prepare("SELECT id, embedding FROM chunks").all() as Array<{ id: number; embedding: Uint8Array }>;
  return rows
    .map((row) => ({ id: row.id, score: cosine(queryVector, fromBlob(row.embedding)) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, CANDIDATES_PER_RANKER)
    .map((entry) => entry.id);
}

export function toFtsQuery(query: string): string {
  const tokens = query.match(/[A-Za-z0-9_]+/g) ?? [];
  return tokens.map((token) => `"${token}"`).join(" OR ");
}

function lexicalRanking(db: Db, query: string): number[] {
  const match = toFtsQuery(query);
  if (match === "") return [];
  const rows = db
    .prepare("SELECT rowid AS id FROM chunks_fts WHERE chunks_fts MATCH ? ORDER BY bm25(chunks_fts, 1.0, 5.0, 2.0) LIMIT ?")
    .all(match, CANDIDATES_PER_RANKER) as Array<{ id: number }>;
  return rows.map((row) => row.id);
}

export function fuseRankings(rankings: number[][], k: number): Array<{ id: number; score: number }> {
  const scores = new Map<number, number>();
  for (const ranking of rankings) {
    ranking.forEach((id, index) => scores.set(id, (scores.get(id) ?? 0) + 1 / (RRF_K + index + 1)));
  }
  return [...scores.entries()]
    .map(([id, score]) => ({ id, score }))
    .sort((a, b) => b.score - a.score)
    .slice(0, k);
}

function fetchChunks(db: Db, ids: number[]): Map<number, ChunkRow> {
  if (ids.length === 0) return new Map();
  const placeholders = ids.map(() => "?").join(",");
  const rows = db.prepare(`SELECT ${CHUNK_COLUMNS} FROM chunks WHERE id IN (${placeholders})`).all(...ids) as ChunkRow[];
  return new Map(rows.map((row) => [row.id, row]));
}

export async function searchCode(root: string, embedder: Embedder, query: string, k = 8): Promise<SearchHit[]> {
  const db = openDb(root);
  try {
    assertSameProvider(db, embedder);
    const [queryVector] = await embedder.embed([query]);
    const fused = fuseRankings([semanticRanking(db, queryVector!), lexicalRanking(db, query)], k);
    const rows = fetchChunks(db, fused.map((entry) => entry.id));
    return fused.flatMap((entry) => {
      const row = rows.get(entry.id);
      return row ? [toHit(row, entry.score)] : [];
    });
  } finally {
    db.close();
  }
}

export function findSymbol(root: string, name: string, limit = 50): SearchHit[] {
  const db = openDb(root);
  try {
    const exact = db.prepare(`SELECT ${CHUNK_COLUMNS} FROM chunks WHERE symbol = ? ORDER BY path, start_line LIMIT ?`).all(name, limit) as ChunkRow[];
    const prefix = db
      .prepare(
        `SELECT ${CHUNK_COLUMNS} FROM chunks WHERE symbol != ? AND substr(symbol, 1, length(?)) = ? ORDER BY path, start_line LIMIT ?`,
      )
      .all(name, name, name, limit) as ChunkRow[];
    return [...exact.map((row) => toHit(row, 1)), ...prefix.map((row) => toHit(row, 0.5))].slice(0, limit);
  } finally {
    db.close();
  }
}

export function relatedFiles(root: string, path: string): RelatedFiles {
  const db = openDb(root);
  try {
    const imports = db.prepare("SELECT to_path AS p FROM imports WHERE from_path = ? ORDER BY to_path").all(path) as Array<{ p: string }>;
    const importedBy = db.prepare("SELECT from_path AS p FROM imports WHERE to_path = ? ORDER BY from_path").all(path) as Array<{ p: string }>;
    return { path, imports: imports.map((row) => row.p), importedBy: importedBy.map((row) => row.p) };
  } finally {
    db.close();
  }
}
