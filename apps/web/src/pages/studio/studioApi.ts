import type { Clip, Plan, Script, Segment, SegmentTranscript, TimedEdit, Transcript } from "./studioModel.ts";

async function post<T>(stage: string, body: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`/api/studio/${stage}`, {
      method: "POST",
      credentials: "include",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch {
    throw new Error("Couldn't reach the API. Check that it is running.");
  }
  const json = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
  if (!res.ok) throw new Error(json?.error?.message ?? `The ${stage} stage failed (${res.status})`);
  return json as T;
}

export const studioApi = {
  plan: (topic: string, sourceUrl: string) => post<{ plan: Plan }>("plan", { topic, sourceUrl }),
  script: (plan: Plan) => post<{ script: Script }>("script", { plan }),
  audio: (segments: Segment[]) =>
    post<{ clips: Clip[] }>("audio", { segments: segments.map(({ text }) => ({ text })) }),
  transcribe: (clip: Clip) => post<{ transcript: Transcript }>("transcribe", { audio: clip.audio }),
  edits: (plan: Plan, segments: Segment[], transcripts: SegmentTranscript[]) =>
    post<{ edits: TimedEdit[] }>("edits", {
      plan,
      segments: segments.map(({ text }) => ({ text })),
      transcripts: transcripts.map(({ words }) => ({ words })),
    }),
};
