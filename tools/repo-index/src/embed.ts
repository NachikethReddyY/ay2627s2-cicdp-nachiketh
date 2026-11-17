import { join } from "node:path";
import { INDEX_DIR_NAME } from "./repo.ts";

export type Embedder = {
  provider: string;
  model: string;
  dimensions: number;
  embed(texts: string[]): Promise<Float32Array[]>;
};

export const EMBED_BATCH_SIZE = 32;
export const LOCAL_MODEL = "Xenova/bge-small-en-v1.5";
const FAKE_DIMENSIONS = 64;

export async function embedInBatches(embedder: Embedder, texts: string[], batchSize = EMBED_BATCH_SIZE): Promise<Float32Array[]> {
  const vectors: Float32Array[] = [];
  for (let start = 0; start < texts.length; start += batchSize) {
    vectors.push(...(await embedder.embed(texts.slice(start, start + batchSize))));
  }
  return vectors;
}

function normalize(vector: Float32Array): Float32Array {
  let sum = 0;
  for (const value of vector) sum += value * value;
  const norm = Math.sqrt(sum);
  if (norm === 0) return vector;
  return vector.map((value) => value / norm);
}

function fnv1a(word: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < word.length; i += 1) {
    hash ^= word.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash;
}

export function splitWords(text: string): string[] {
  return text
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((word) => word !== "");
}

export function createFakeEmbedder(): Embedder {
  return {
    provider: "fake",
    model: "hash-bow-64",
    dimensions: FAKE_DIMENSIONS,
    async embed(texts) {
      return texts.map((text) => {
        const vector = new Float32Array(FAKE_DIMENSIONS);
        for (const word of splitWords(text)) {
          const hash = fnv1a(word);
          vector[hash % FAKE_DIMENSIONS]! += (hash >>> 8) % 2 === 0 ? 1 : -1;
        }
        return normalize(vector);
      });
    },
  };
}

type FeatureExtractor = (
  texts: string[],
  options: { pooling: "mean"; normalize: boolean },
) => Promise<{ data: Float32Array; dims: number[] }>;

export function createLocalEmbedder(root: string): Embedder {
  let extractor: Promise<FeatureExtractor> | null = null;
  const load = (): Promise<FeatureExtractor> => {
    extractor ??= import("@huggingface/transformers").then(async (transformers) => {
      transformers.env.cacheDir = join(root, INDEX_DIR_NAME, "models");
      const pipe = await transformers.pipeline("feature-extraction", LOCAL_MODEL, { dtype: "q8" });
      return pipe as unknown as FeatureExtractor;
    });
    return extractor;
  };
  return {
    provider: "local",
    model: LOCAL_MODEL,
    dimensions: 384,
    async embed(texts) {
      const run = await load();
      const output = await run(texts, { pooling: "mean", normalize: true });
      const width = output.dims[output.dims.length - 1]!;
      this.dimensions = width;
      return texts.map((_, row) => output.data.slice(row * width, (row + 1) * width));
    },
  };
}

type EmbeddingsResponse = { data: Array<{ index: number; embedding: number[] }> };

export function createOpenAiEmbedder(env: NodeJS.ProcessEnv): Embedder {
  const baseUrl = (env.REPO_INDEX_BASE_URL ?? "https://api.openai.com/v1").replace(/\/+$/, "");
  const model = env.REPO_INDEX_MODEL;
  if (!model) throw new Error("REPO_INDEX_MODEL is required when REPO_INDEX_PROVIDER=openai");
  return {
    provider: "openai",
    model,
    dimensions: 0,
    async embed(texts) {
      const response = await fetch(`${baseUrl}/embeddings`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(env.REPO_INDEX_API_KEY ? { authorization: `Bearer ${env.REPO_INDEX_API_KEY}` } : {}),
        },
        body: JSON.stringify({ model, input: texts }),
      });
      if (!response.ok) throw new Error(`embeddings request failed: ${response.status} ${await response.text()}`);
      const body = (await response.json()) as EmbeddingsResponse;
      const vectors = [...body.data].sort((a, b) => a.index - b.index).map((item) => normalize(Float32Array.from(item.embedding)));
      this.dimensions = vectors[0]?.length ?? this.dimensions;
      return vectors;
    },
  };
}

export function createEmbedder(root: string, env: NodeJS.ProcessEnv = process.env): Embedder {
  const provider = env.REPO_INDEX_PROVIDER ?? "local";
  if (provider === "fake") return createFakeEmbedder();
  if (provider === "openai") return createOpenAiEmbedder(env);
  if (provider === "local") return createLocalEmbedder(root);
  throw new Error(`unknown REPO_INDEX_PROVIDER: ${provider}`);
}
