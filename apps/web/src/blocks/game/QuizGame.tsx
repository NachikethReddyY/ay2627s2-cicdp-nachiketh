import { useRef, useState } from "react";
import type { PublicGameProps, PublicQuiz } from "@learnquest/ui-catalog";
import type { GameApi } from "./api.ts";
import Shell, { btn } from "./Shell.tsx";
import type { Outcome } from "./model.ts";

export default function QuizGame({ p, kind, api }: { p: PublicGameProps; kind: PublicQuiz; api: GameApi }) {
  const maxLives = p.shell.lives;
  // The choices the server has already marked right; the next question is always the one after them.
  const [confirmed, setConfirmed] = useState<number[]>([]);
  const [lives, setLives] = useState(maxLives);
  const [outcome, setOutcome] = useState<Outcome>("play");
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
      if (r.questionResults?.[confirmed.length]) {
        setConfirmed([...confirmed, choice]);
        if (r.complete) {
          setOutcome("win");
          setLive("You win! You answered every question correctly.");
        } else setLive("Correct. Next question.");
        return;
      }
      const left = lives === undefined ? undefined : lives - 1;
      if (left !== undefined) setLives(left);
      if (left !== undefined && left <= 0) {
        setOutcome("lose");
        setLive("Game over, no lives left. Try again.");
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
    setLives(maxLives);
    setOutcome("play");
    setLive("Back at the first question.");
  };

  const question = kind.questions[index]!;
  return (
    <Shell {...p} onHint={api.hint} lives={lives} maxLives={maxLives} outcome={outcome} live={live} onRetry={retry} busy={busy}>
      <div role="group" aria-label={`Question ${index + 1} of ${kind.questions.length}`} className="flex min-w-0 flex-col gap-3">
        <p className="text-sm font-extrabold">Question {index + 1} of {kind.questions.length}</p>
        <p className="break-words">{question.prompt}</p>
        <div className="flex flex-col items-start gap-2">
          {question.options.map((option, i) => (
            <button key={i} type="button" className={btn} disabled={done || busy} onClick={() => answer(i)}>{option}</button>
          ))}
        </div>
      </div>
    </Shell>
  );
}
