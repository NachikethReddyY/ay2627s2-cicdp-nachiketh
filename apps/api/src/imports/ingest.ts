export type IngestFn = (
  input: { repo: string; sha: string },
  emit: (kind: string, data: unknown) => void,
) => Promise<{ lessonId: string }>;

export const defaultIngest: IngestFn = async () => {
  throw new Error("lesson ingest is not available yet (WP6)");
};
