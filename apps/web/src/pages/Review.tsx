import { useState, type FormEvent } from "react";
import { Link, useParams } from "@tanstack/react-router";
import { usePostHog } from "@posthog/react";
import { ArrowLeft } from "lucide-react";
import AnswerText from "../components/AnswerText";
import { Spinner } from "../components/Bits";
import { useApi } from "../lib/api";
import { trpc, type RouterOutputs } from "../lib/trpc";
import { FOCUS } from "../player/ui";
import "./home.css";

type Question = NonNullable<RouterOutputs["me"]["review"]["get"]>;

function Prediction({ slug, question }: { slug: string; question: Question }) {
  const [choice, setChoice] = useState<number | null>(null);
  const [text, setText] = useState("");
  const [result, setResult] = useState<RouterOutputs["me"]["review"]["submit"]>();
  const [saving, setSaving] = useState(false);
  const [failed, setFailed] = useState(false);
  const posthog = usePostHog();

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving || result) return;
    const answer = question.kind === "mcq"
      ? choice === null ? null : { kind: "mcq" as const, choice }
      : { kind: "cloze" as const, text };
    if (!answer) return;
    setSaving(true);
    setFailed(false);
    try {
      const submission = await trpc.me.review.submit.mutate({ slug, token: question.token, answer });
      setResult(submission);
      posthog?.capture("review_answer_submitted", { answer_correct: submission.correct });
    } catch {
      setFailed(true);
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={(event) => void submit(event)} className="lq-card min-w-0 space-y-5 p-5 sm:p-8">
      <header className="space-y-2">
        <h1 className="text-2xl sm:text-3xl">Review {question.name}</h1>
        <p className="text-sm text-[var(--mu)]">Try a prediction from an earlier lesson.</p>
      </header>
      <h2 className="text-lg">{question.title}</h2>
      <fieldset disabled={saving || !!result} className="min-w-0 space-y-3">
        <legend className="mb-3 whitespace-pre-wrap">{question.prompt}</legend>
        {Object.entries(question.beforeFiles).map(([file, code]) => (
          <figure key={file} className="rounded-xl border border-[var(--line)] bg-[var(--code)]">
            <figcaption className="break-all border-b border-[var(--line)] px-4 py-2 font-mono text-xs text-[var(--mu)]">{file}</figcaption>
            <pre tabIndex={0} className={`overflow-x-auto p-4 font-mono text-sm ${FOCUS}`}><code>{code}</code></pre>
          </figure>
        ))}
        {question.kind === "mcq" ? question.options?.map((option, index) => (
          <label className="opt flex min-h-11 items-start gap-3 px-4 py-2.5 text-sm has-[:enabled]:cursor-pointer has-[:checked]:border-[var(--ac)] has-[:checked]:bg-[var(--sel)] has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-[var(--focus)]" key={index}>
            <input name="review" type="radio" className="mt-1 shrink-0 accent-[var(--ac)]" checked={choice === index} onChange={() => setChoice(index)} />
            <AnswerText text={option} />
          </label>
        )) : (
          <label className="flex flex-col gap-2 text-sm font-medium">
            Your prediction
            <input required maxLength={200} autoComplete="off" spellCheck={false} value={text} onChange={(e) => setText(e.target.value)}
              className={`min-h-11 rounded-xl border border-[var(--line)] bg-[var(--code)] px-3 font-mono ${FOCUS}`} />
          </label>
        )}
      </fieldset>
      {failed && <p role="alert" className="lq-msg err">Couldn't submit your prediction. Reload the review and try again.</p>}
      {result ? (
        <div role="status" className={`lq-msg ${result.correct ? "ok" : "err"}`}>
          <p className="font-semibold">{result.correct ? "Correct!" : "Not quite."}</p>
          <p>Answer: <AnswerText text={result.solution} /></p>
        </div>
      ) : (
        <button type="submit" className={`lq-btn lq-btn-ink ${FOCUS}`} disabled={saving || (question.kind === "mcq" ? choice === null : !text.trim())}>
          {saving ? "Checking…" : "Check"}
        </button>
      )}
    </form>
  );
}

export default function Review() {
  const { slug } = useParams({ from: "/review/$slug" });
  const { data, error, loading } = useApi(`review:${slug}`, () => trpc.me.review.get.query({ slug }));
  return (
    <main className="lq lq-moon">
      <div className="mx-auto grid max-w-2xl gap-4 px-4 py-6 sm:px-6 sm:py-10">
        <div className="flex items-center justify-between gap-3">
          <Link to="/" className={`lq-navlink inline-flex min-h-11 items-center gap-2 rounded-md text-sm font-medium text-[var(--mu)] hover:text-[var(--tx)] ${FOCUS}`}>
            <ArrowLeft size={16} aria-hidden="true" />Back home
          </Link>
          <p className="text-sm font-medium text-[var(--mu)]">Spaced review</p>
        </div>
        {loading ? <Spinner /> : data ? <Prediction key={data.token} question={data} slug={slug} /> : (
          <section className="lq-card space-y-2 p-5 sm:p-8">
            <h1 className="text-2xl">{error ? "Couldn't load the review." : "No review is due for this course."}</h1>
          </section>
        )}
      </div>
    </main>
  );
}
