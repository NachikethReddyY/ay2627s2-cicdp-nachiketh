import { useRef, useState } from "react";
import type { PublicGameProps, PublicQuiz } from "@learnquest/ui-catalog";
import type { ActiveGameApi } from "./api.ts";
import Shell, { tile } from "./Shell.tsx";
import type { Outcome } from "./model.ts";

export default function QuizGame({ p, kind, api }: { p: PublicGameProps; kind: PublicQuiz; api: ActiveGameApi }) {
  const maxLives = api.maxAttempts;
  const [confirmed, setConfirmed] = useState<number[]>([]);
  const [lives, setLives] = useState(api.remainingAttempts);
  const [outcome, setOutcome] = useState<Outcome>(api.remainingAttempts > 0 ? "play" : "lose");
  const [live, setLive] = useState("");
  const [busy, setBusy] = useState(false);
  const gen = useRef(0);
  const done = outcome === "win" || outcome === "lose";
  const index = Math.min(confirmed.length, kind.questions.length - 1);

  const answer = async (choice: number) => {
    if (done || busy) return;
    setBusy(true);
    const mine = gen.current;
    try {
      const r = await api.check({ kind: "quiz", answers: [...confirmed, choice] });
      if (mine !== gen.current) return;
      setLives(r.remainingAttempts);
      if (r.questionCorrect) {
        setConfirmed([...confirmed, choice]);
        if (r.complete) {
          setOutcome("win");
          setLive("You win! You answered every question correctly.");
        } else setLive("Correct. Next question.");
        return;
      }
      if (r.remainingAttempts === 0) {
        setOutcome("lose");
        setLive("No attempts left today.");
      } else setLive("Not quite. Try another answer.");
    } catch {
      if (mine === gen.current) setLive("Couldn't check your answer. Try again.");
    } finally {
      setBusy(false);
    }
  };

  const retry = () => {
    gen.current++;
    setConfirmed([]);
    setOutcome("play");
    setLive("Back at the first question.");
  };

  const question = kind.questions[index];
  return (
    <Shell {...p} onHint={api.hint} lives={lives} maxLives={maxLives} outcome={outcome} live={live} onRetry={retry} busy={busy}>
      <div role="group" aria-label={`Question ${index + 1} of ${kind.questions.length}`} className="flex min-w-0 flex-col gap-3">
        <p className="text-sm font-semibold text-[var(--mu)]">Question {index + 1} of {kind.questions.length}</p>
        <p className="break-words">{question.prompt}</p>
        <div className="flex flex-col items-start gap-2">
          {question.options.map((option, i) => (
            <button key={i} type="button" className={`${tile} min-h-11 max-w-full break-words px-4 py-2 text-left text-sm font-medium disabled:opacity-40`} disabled={done || busy} onClick={() => answer(i)}>{option}</button>
          ))}
        </div>
      </div>
    </Shell>
  );
}
