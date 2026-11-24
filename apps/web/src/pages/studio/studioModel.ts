export type Plan = {
  title: string;
  summary: string;
  sections: { goal: string; concepts: string[] }[];
};

export type Segment = { text: string; predict?: string | null };

export type Script = { segments: Segment[] };

export type Clip = { index: number; audio: string };

export type SpokenWord = { text: string; start: number; end: number };

export type Transcript = { text: string; words: SpokenWord[] };

export type SegmentTranscript = Transcript & { index: number };

export type TimedEdit = { segment: number; at: number; cueHeard: boolean; cue: string; predict: string | null; code: string; run?: boolean };

export type StudioRun = { plan?: Plan; script?: Script; clips?: Clip[]; transcripts?: SegmentTranscript[]; edits?: TimedEdit[] };
