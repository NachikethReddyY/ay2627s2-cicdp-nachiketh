import { chunkFile, type Chunk } from "./chunk.ts";
import { getMeta, inTransaction, openDb, setMeta, toBlob, type Db } from "./db.ts";
import { embedInBatches, splitWords, type Embedder } from "./embed.ts";
import { extractImports } from "./imports.ts";
import { currentHead, scanRepo, type ScannedFile } from "./repo.ts";

export type IndexSummary = {
  filesSeen: number;
  changed: number;
  removed: number;
  chunks: number;
  ms: number;
};

export type IndexStatus = {
  files: number;
  chunks: number;
  provider: string | null;
  model: string | null;
  indexedAt: string | null;
  stale: boolean;
};

export class ProviderMismatchError extends Error {}

function expandIdentifiers(text: string): string {
  const words = text.match(/[A-Za-z_][A-Za-z0-9_]*/g) ?? [];
  const parts = words.filter((word) => /[a-z][A-Z]|_/.test(word)).flatMap((word) => splitWords(word));
  return `${text}\n${parts.join(" ")}`;
}

function count(db: Db, table: string): number {
  return (db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n;
}

function storedHashes(db: Db): Map<string, string> {
  const rows = db.prepare("SELECT path, sha256 FROM files").all() as Array<{ path: string; sha256: string }>;
  return new Map(rows.map((row) => [row.path, row.sha256]));
}

function dropPath(db: Db, path: string): void {
  db.prepare("DELETE FROM chunks_fts WHERE rowid IN (SELECT id FROM chunks WHERE path = ?)").run(path);
  db.prepare("DELETE FROM chunks WHERE path = ?").run(path);
  db.prepare("DELETE FROM imports WHERE from_path = ?").run(path);
  db.prepare("DELETE FROM files WHERE path = ?").run(path);
}

function dropRemovedPath(db: Db, path: string): void {
  dropPath(db, path);
  db.prepare("DELETE FROM imports WHERE to_path = ?").run(path);
}

function wipe(db: Db): void {
  for (const table of ["chunks_fts", "chunks", "imports", "files"]) db.exec(`DELETE FROM ${table}`);
}

type PendingFile = { file: ScannedFile; chunks: Chunk[]; imports: string[] };

function insertFile(db: Db, pending: PendingFile, vectors: Float32Array[], indexedAt: string): void {
  const insertChunk = db.prepare(
    "INSERT INTO chunks (path, symbol, kind, start_line, end_line, text, embedding) VALUES (?, ?, ?, ?, ?, ?, ?)",
  );
  const insertFts = db.prepare("INSERT INTO chunks_fts (rowid, text, symbol, path) VALUES (?, ?, ?, ?)");
  pending.chunks.forEach((chunk, index) => {
    const result = insertChunk.run(
      pending.file.path,
      chunk.symbol,
      chunk.kind,
      chunk.startLine,
      chunk.endLine,
      chunk.text,
      toBlob(vectors[index]!),
    );
    insertFts.run(Number(result.lastInsertRowid), expandIdentifiers(chunk.text), expandIdentifiers(chunk.symbol), pending.file.path);
  });
  const insertImport = db.prepare("INSERT OR IGNORE INTO imports (from_path, to_path) VALUES (?, ?)");
  for (const target of pending.imports) insertImport.run(pending.file.path, target);
  db.prepare("INSERT INTO files (path, sha256, indexed_at) VALUES (?, ?, ?)").run(pending.file.path, pending.file.sha256, indexedAt);
}

export function providerKey(embedder: Embedder): string {
  return `${embedder.provider}:${embedder.model}`;
}

export function assertSameProvider(db: Db, embedder: Embedder): void {
  const stored = getMeta(db, "provider_key");
  if (stored !== null && stored !== providerKey(embedder)) {
    throw new ProviderMismatchError(`index was built with ${stored}, current provider is ${providerKey(embedder)}; run index --full`);
  }
}

export async function indexRepo(root: string, embedder: Embedder, options: { full?: boolean } = {}): Promise<IndexSummary> {
  const startedAt = Date.now();
  const db = openDb(root);
  try {
    const providerChanged = getMeta(db, "provider_key") !== null && getMeta(db, "provider_key") !== providerKey(embedder);
    if (options.full || providerChanged) inTransaction(db, () => wipe(db));

    const scanned = scanRepo(root);
    const known = new Set(scanned.map((file) => file.path));
    const stored = storedHashes(db);
    const removed = [...stored.keys()].filter((path) => !known.has(path));
    const changedFiles = scanned.filter((file) => stored.get(file.path) !== file.sha256);

    const pending: PendingFile[] = changedFiles.map((file) => ({
      file,
      chunks: chunkFile(file.path, file.text),
      imports: extractImports(file.path, file.text, known),
    }));
    const vectors = await embedInBatches(
      embedder,
      pending.flatMap((p) => p.chunks.map((chunk) => chunk.text)),
    );

    const indexedAt = new Date().toISOString();
    inTransaction(db, () => {
      for (const path of removed) dropRemovedPath(db, path);
      let cursor = 0;
      for (const item of pending) {
        dropPath(db, item.file.path);
        const slice = vectors.slice(cursor, cursor + item.chunks.length);
        cursor += item.chunks.length;
        insertFile(db, item, slice, indexedAt);
      }
      setMeta(db, "provider_key", providerKey(embedder));
      setMeta(db, "provider", embedder.provider);
      setMeta(db, "model", embedder.model);
      setMeta(db, "dimensions", String(embedder.dimensions));
      setMeta(db, "indexed_at", indexedAt);
      setMeta(db, "head", currentHead(root));
    });

    return {
      filesSeen: scanned.length,
      changed: changedFiles.length,
      removed: removed.length,
      chunks: count(db, "chunks"),
      ms: Date.now() - startedAt,
    };
  } finally {
    db.close();
  }
}

export function indexStatus(root: string): IndexStatus {
  const db = openDb(root);
  try {
    const stored = storedHashes(db);
    const scanned = scanRepo(root);
    const known = new Set(scanned.map((file) => file.path));
    const hashesDiffer =
      scanned.some((file) => stored.get(file.path) !== file.sha256) || [...stored.keys()].some((path) => !known.has(path));
    const headDiffers = getMeta(db, "head") !== currentHead(root);
    return {
      files: count(db, "files"),
      chunks: count(db, "chunks"),
      provider: getMeta(db, "provider"),
      model: getMeta(db, "model"),
      indexedAt: getMeta(db, "indexed_at"),
      stale: getMeta(db, "indexed_at") === null || hashesDiffer || headDiffers,
    };
  } finally {
    db.close();
  }
}
