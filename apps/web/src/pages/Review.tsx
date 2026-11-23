import { useState, type FormEvent } from "react";
import { Link, useParams } from "@tanstack/react-router";
import { usePostHog } from "@posthog/react";
import AnswerText from "../components/AnswerText";
import { Spinner } from "../components/Bits";
import { useApi } from "../lib/api";
import { trpc, type RouterOutputs } from "../lib/trpc";
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
    <form onSubmit={(event) => void submit(event)} className="space-y-4">
      <h1>Review {question.name}</h1>
      <fieldset disabled={saving || !!result} className="space-y-3">
        <legend className="mb-3 font-medium">{question.title}</legend>
        <p className="whitespace-pre-wrap">{question.prompt}</p>
        {Object.entries(question.beforeFiles).map(([file, code]) => (
          <div key={file}><p className="text-sm">{file}</p><pre className="overflow-auto text-sm">{code}</pre></div>
        ))}
        {question.kind === "mcq" ? question.options?.map((option, index) => (
          <label className="flex gap-2" key={index}>
            <input name="review" type="radio" checked={choice === index} onChange={() => setChoice(index)} />
            <AnswerText text={option} />
          </label>
        )) : <label className="flex flex-col">Your prediction<input required maxLength={200} value={text} onChange={(e) => setText(e.target.value)} /></label>}
      </fieldset>
      {failed && <p role="alert">Couldn't submit your prediction. Reload the review and try again.</p>}
      {result ? (
        <div role="status"><p>{result.correct ? "Correct!" : "Not quite."}</p><p>Answer <AnswerText text={result.solution} /></p></div>
      ) : <button type="submit" className="lq-btn lq-btn-ink" disabled={saving || (question.kind === "mcq" ? choice === null : !text.trim())}>Check</button>}
    </form>
  );
}

export default function Review() {
  const { slug } = useParams({ from: "/review/$slug" });
  const { data, error, loading } = useApi(`review:${slug}`, () => trpc.me.review.get.query({ slug }));
  return (
    <main className="lq lq-moon min-h-screen">
      <section className="lq-wrap max-w-2xl space-y-4">
        {loading ? <Spinner /> : data ? <Prediction key={data.token} question={data} slug={slug} /> : <p>{error ? "Couldn't load the review." : "No review is due for this course."}</p>}
        <Link to="/" className="lq-btn lq-btn-line">Back home</Link>
      </section>
    </main>
  );
}
