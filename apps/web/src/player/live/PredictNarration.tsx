import { useCallback, useMemo, useState } from "react";
import { useApi } from "../../lib/api";
import { trpcUnbatched } from "../../lib/trpc";
import { createSpeaker, type Synth, type Utterance } from "../speech";

export default function PredictNarration({ stepId, url, text }: { stepId: string; url?: string; text: string }) {
  if (url) return <NarrationPlayer url={url} text={text} />;
  return <GeneratedNarration stepId={stepId} text={text} />;
}

function GeneratedNarration({ stepId, text }: { stepId: string; text: string }) {
  const { data, loading } = useApi(`predict-narration:${stepId}`, () =>
    trpcUnbatched.steps.narration.mutate({ id: stepId }, { signal: AbortSignal.timeout(20_000) }),
  );
  if (loading) return <p className="mt-4 text-sm text-[var(--mu)]" role="status">Preparing narration…</p>;
  return <NarrationPlayer url={data?.url ?? undefined} text={text} />;
}

function NarrationPlayer({ url, text }: { url?: string; text: string }) {
  const [failed, setFailed] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const speaker = useMemo(
    () => createSpeaker(window.speechSynthesis as Synth | undefined, (value) => new SpeechSynthesisUtterance(value) as Utterance),
    [],
  );
  const speak = useCallback(() => {
    if (!speaker) return;
    setSpeaking(true);
    speaker.speak(text, { volume: 0.6, muted: false, onDone: () => setSpeaking(false) });
  }, [speaker, text]);
  const attachSpeech = useCallback((button: HTMLButtonElement | null) => {
    if (!button) return;
    speak();
    return () => speaker?.cancel();
  }, [speak, speaker]);

  if (url && !failed) {
    return <audio className="mt-4 w-full" aria-label="Explanation audio" controls autoPlay src={url} onError={() => setFailed(true)} />;
  }
  if (!speaker || !text.trim()) return null;
  return (
    <button ref={attachSpeech} type="button" className="pill mt-4 min-h-9 px-4 text-sm" onClick={() => {
      if (!speaking) {
        speak();
        return;
      }
      speaker.cancel();
      setSpeaking(false);
    }}>{speaking ? "Stop narration" : "Listen to explanation"}</button>
  );
}
