import { useState } from "react";
import type { GameProps, QuizProps } from "@learnquest/ui-catalog";
import Shell, { btn } from "./Shell.tsx";
import type { Outcome } from "./model.ts";

export default function QuizGame({ p, kind, onComplete }: { p: GameProps; kind: QuizProps; onComplete?: () => void | Promise<unknown> }) {
  const maxLives = p.shell.lives;
  const [index, setIndex] = useState(0);
  const [lives, setLives] = useState(maxLives);
  const [outcome, setOutcome] = useState<Outcome>("play");
  const [live, setLive] = useState("");
  const done = outcome === "win" || outcome === "lose";

  const answer = (choice: number) => {
    if (done) return;
    if (choice === kind.questions[index]!.answer) {
      if (index + 1 === kind.questions.length) {
        setOutcome("win");
        setLive("You win! You answered every question correctly.");
      } else {
        setIndex(index + 1);
        setLive("Correct. Next question.");
      }
      return;
    }
    const left = lives === undefined ? undefined : lives - 1;
    if (left !== undefined) setLives(left);
    if (left !== undefined && left <= 0) {
      setOutcome("lose");
      setLive("Game over, no lives left. Try again.");
    } else setLive("Not quite. Try another answer.");
  };

  const retry = () => {
    setIndex(0);
    setLives(maxLives);
    setOutcome("play");
    setLive("Back at the first question.");
  };

  const question = kind.questions[index]!;
  return (
    <Shell {...p} lives={lives} maxLives={maxLives} outcome={outcome} live={live} onRetry={retry} onComplete={onComplete}>
      <div role="group" aria-label={`Question ${index + 1} of ${kind.questions.length}`} className="flex min-w-0 flex-col gap-3">
        <p className="text-sm font-extrabold">Question {index + 1} of {kind.questions.length}</p>
        <p className="break-words">{question.prompt}</p>
        <div className="flex flex-col items-start gap-2">
          {question.options.map((option, i) => (
            <button key={i} type="button" className={btn} disabled={done} onClick={() => answer(i)}>{option}</button>
          ))}
        </div>
      </div>
    </Shell>
  );
}
