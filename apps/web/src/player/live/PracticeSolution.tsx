import { useState } from "react";
import { isNotFound, trpc } from "../../lib/trpc";
import type { Part } from "./types";

type Props = {
  lessonId: string;
  versionId: string;
  revision: string;
  solution: Extract<Part, { kind: "practice" }>["solution"];
  attemptCount: number;
};

export default function PracticeSolution({ lessonId, versionId, revision, solution, attemptCount }: Props) {
  const [code, setCode] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const remaining = solution ? Math.max(0, solution.unlockAt - Math.max(solution.attemptCount, attemptCount)) : 0;

  const reveal = async () => {
    setBusy(true);
    setError("");
    try {
      const result = await trpc.lessons.revealPracticeSolution.mutate({ id: lessonId, versionId, revision });
      setCode(result.code);
    } catch (cause) {
      setError(isNotFound(cause) ? "This exercise has no verified reference solution." : "Could not load the reference solution. Try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="mt-3" aria-labelledby="practice-solution">
      <h3 id="practice-solution" className="wb-sec h-[22px] p-0">Reference solution</h3>
      {!solution && <p className="m-0 text-xs text-[var(--mu)]">This exercise has no saved reference solution.</p>}
      {solution?.gated && <p className="m-0 text-xs text-[var(--mu)]">Finish the scrim predictions to unlock the reference solution.</p>}
      {!solution?.gated && remaining > 0 && (
        <p role="status" className="m-0 text-xs text-[var(--mu)]">
          Submit {remaining} more {remaining === 1 ? "attempt" : "attempts"} to unlock the reference solution.
        </p>
      )}
      {solution && !solution.gated && remaining === 0 && code === null && (
        <button type="button" className="wb-tb wb-outline" disabled={busy} onClick={() => void reveal()}>
          {busy ? "Loading…" : "Reveal solution"}
        </button>
      )}
      {error && <p role="alert" className="text-xs">{error}</p>}
      {code !== null && (
        <pre className="wb-mono overflow-auto rounded-lg border border-[var(--line)] bg-[var(--pane2)] px-2 py-1.5 text-xs">{code}</pre>
      )}
    </section>
  );
}
