// Seam for the repo-to-lesson pipeline (plan WP6). It reads the commit, builds a draft lesson and returns its id.
// The lesson must be created with sourceKind "repo" and status "draft": drafts of that kind are hidden from learners.
export type IngestFn = (
  input: { repo: string; sha: string },
  emit: (kind: string, data: unknown) => void,
) => Promise<{ lessonId: string }>;

export const defaultIngest: IngestFn = async () => {
  throw new Error("lesson ingest is not available yet (WP6)");
};
