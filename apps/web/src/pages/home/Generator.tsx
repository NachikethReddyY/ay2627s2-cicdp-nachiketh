import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { useNavigate } from "@tanstack/react-router";
import { trpc } from "../../lib/trpc";
import { dismissJob, getJob, getQueue, startGeneration, subscribeJob } from "./generationJob";
import { generatorError } from "./generatorErrors";

const chips = ["Python basics", "React hooks", "SQL joins", "Git"];

export default function Generator() {
  const job = useSyncExternalStore(subscribeJob, getJob);
  const queue = useSyncExternalStore(subscribeJob, getQueue);
  const [q, setQ] = useState(() => ("prompt" in job ? job.prompt : ""));
  const [empty, setEmpty] = useState(false);
  const navigate = useNavigate();
  const waiting = useRef(job.status === "running");
  const busy = job.status === "running";
  const err = job.status === "failed" ? generatorError(job.code) : null;

  useEffect(() => {
    if (job.status === "done" && waiting.current) {
      waiting.current = false;
      dismissJob();
      void navigate({ to: "/courses/$slug", params: { slug: job.courseSlug } });
    }
  }, [job, navigate]);

  const run = (prompt: string) => {
    waiting.current = true;
    void startGeneration(prompt, (p) => trpc.paths.generate.mutate({ prompt: p }));
  };

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!q.trim()) {
      setEmpty(true);
      return;
    }
    run(q.trim());
    setQ("");
  };

  return (
    <section className="lq-card lq-gen" aria-labelledby="gen-h">
      <h2 id="gen-h">Learn a programming concept</h2>
      <form onSubmit={submit}>
        <label htmlFor="gen-q">What do you want to learn to code?</label>
        <div className="lq-gen-row">
          <input
            id="gen-q" type="text" autoComplete="off" placeholder="e.g. loops, hooks, joins" value={q} aria-describedby="gen-status"
            onChange={(e) => {
              setQ(e.target.value);
              setEmpty(false);
              dismissJob();
            }}
          />
          <button className="lq-btn lq-btn-blue" type="submit" aria-busy={busy}>
            {busy && <svg className="lq-spin" width="20" height="20" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3a9 9 0 1 0 9 9" fill="none" stroke="currentColor" strokeWidth={3} strokeLinecap="round" /></svg>}
            {busy ? "Queue" : "Generate"}
          </button>
        </div>
      </form>
      <ul className="lq-chips" aria-label="Quick picks">
        {chips.map((c) => (
          <li key={c}>
            <button className="lq-chip" type="button" onClick={() => { setQ(c); setEmpty(false); }}>
              {c}
            </button>
          </li>
        ))}
      </ul>
      <div id="gen-status" className="lq-status" aria-live="polite">
        {busy && (
          <p className="lq-msg load">
            <svg className="lq-sketch" width="64" height="28" viewBox="0 0 64 28" aria-hidden="true"><path className="lq-msg-sketch" d="M3 22c8-14 14-14 18-4s10 8 14-2 12-10 26 2" fill="none" strokeWidth={3} strokeLinecap="round" /></svg>
            Generating your path<span className="lq-blink" aria-hidden="true"><i>.</i><i>.</i><i>.</i></span>
          </p>
        )}
        {queue.length > 0 && (
          <p className="lq-msg load">
            {queue.length === 1 ? "1 path queued" : `${queue.length} paths queued`}: {queue.join(", ")}
          </p>
        )}
        {job.status === "done" && !waiting.current && (
          <div className="lq-msg load">
            <span style={{ flex: "1 1 260px" }}>Your path is ready.</span>
            <button className="lq-btn lq-btn-blue" type="button" onClick={() => { dismissJob(); void navigate({ to: "/courses/$slug", params: { slug: job.courseSlug } }); }}>
              Open it
            </button>
          </div>
        )}
        {err && job.status === "failed" && (
          <div className="lq-msg err lq-shake" role="alert">
            <svg className="lq-msg-icon" width="22" height="22" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="10" fill="none" stroke="currentColor" strokeWidth={2} /><path d="M12 7v6M12 16.5v.5" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" /></svg>
            <span style={{ flex: "1 1 260px" }}>{err}</span>
            <button className="lq-btn lq-btn-blue" type="button" disabled={job.pending} onClick={() => run(job.prompt)}>
              <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 12a8 8 0 1 0 3-6.2M4 4v5h5" fill="none" stroke="currentColor" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round" /></svg>
              Retry
            </button>
          </div>
        )}
        {empty && <p className="lq-msg err lq-shake" role="alert">Type what you want to learn first, or tap a quick pick.</p>}
      </div>
    </section>
  );
}
