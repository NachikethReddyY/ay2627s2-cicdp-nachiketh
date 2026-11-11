import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { useNavigate } from "@tanstack/react-router";
import { trpc } from "../../lib/trpc";
import { Pip } from "./art";
import { dismissJob, getJob, startGeneration, subscribeJob } from "./generationJob";

const chips = ["Python basics", "React hooks", "SQL joins", "Git"];

const aiErrors: Record<string, string> = {
  PRECONDITION_FAILED: "Pip's AI helper isn't switched on here yet.",
  TOO_MANY_REQUESTS: "You've sketched 5 paths today. Pip needs a nap, try again tomorrow!",
  BAD_REQUEST: "Pip only draws coding paths. Try a language, a tool or a project idea!",
  TIMEOUT: "Pip took too long sketching that path. Give it another go in a moment.",
};
const genericError = "Oops, Pip dropped the pencil. We couldn't generate that path. Check your connection and try again.";

export default function Generator() {
  const job = useSyncExternalStore(subscribeJob, getJob);
  const [q, setQ] = useState(() => ("prompt" in job ? job.prompt : ""));
  const [empty, setEmpty] = useState(false);
  const navigate = useNavigate();
  // Only a path this visit is waiting on opens by itself. One that finished while the learner was away waits for a click.
  const waiting = useRef(job.status === "running");
  const busy = job.status === "running";
  const err = job.status === "failed" ? (aiErrors[job.code ?? ""] ?? genericError) : null;

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
    if (busy) return;
    if (!q.trim()) {
      setEmpty(true);
      return;
    }
    run(q.trim());
  };

  const pose = <Pip src={busy ? "/img/pip-think.png" : err || empty ? "/img/pip-oops.png" : "/img/pip-wave.png"} size={220} />;

  return (
    <section className="lq-card lq-gen lq-bg-blue lq-rise d1" aria-labelledby="gen-h">
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <h2 id="gen-h" style={{ fontSize: 22, letterSpacing: ".06em" }}>Learn anything</h2>
        <span className="lq-sticker lq-bg-sun">AI</span>
      </div>
      <form onSubmit={submit}>
        <label htmlFor="gen-q">What do you want to learn to code?</label>
        <div className="lq-gen-row">
          <input
            id="gen-q" type="text" autoComplete="off" value={q} disabled={busy} aria-describedby="gen-status"
            onChange={(e) => {
              setQ(e.target.value);
              setEmpty(false);
              dismissJob(); // the learner is writing a new prompt, so the last outcome is no longer news
            }}
          />
          <button className="lq-btn lq-btn-sun" type="submit" disabled={busy} aria-busy={busy}>
            {busy && <svg className="lq-spin" width="22" height="22" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3a9 9 0 1 0 9 9" fill="none" stroke="#15121f" strokeWidth={3.5} strokeLinecap="round" /></svg>}
            Generate
          </button>
        </div>
      </form>
      <ul className="lq-chips" aria-label="Quick picks">
        {chips.map((c, i) => (
          <li key={c}>
            <button className="lq-chip" type="button" onClick={() => { setQ(c); setEmpty(false); }}>
              {c}
              {i === 0 && <span className="lq-sticker lq-bg-pink" style={{ fontSize: 11, padding: "4px 6px", marginLeft: 2 }}>HOT</span>}
            </button>
          </li>
        ))}
      </ul>
      <div id="gen-status" className="lq-status" aria-live="polite">
        {busy && (
          <p className="lq-msg load">
            <svg className="lq-sketch" width="64" height="28" viewBox="0 0 64 28" aria-hidden="true"><path d="M3 22c8-14 14-14 18-4s10 8 14-2 12-10 26 2" fill="none" stroke="#2257FF" strokeWidth={3.5} strokeLinecap="round" /></svg>
            Pip is sketching your path<span className="lq-blink" aria-hidden="true"><i>.</i><i>.</i><i>.</i></span>
          </p>
        )}
        {job.status === "done" && !waiting.current && (
          <div className="lq-msg load">
            <span style={{ flex: "1 1 260px" }}>Your path is ready.</span>
            <button className="lq-btn lq-btn-ink" type="button" onClick={() => { dismissJob(); void navigate({ to: "/courses/$slug", params: { slug: job.courseSlug } }); }} style={{ minHeight: 44, fontSize: 17, padding: "0 16px", boxShadow: "3px 3px 0 #15121f" }}>
              Open it
            </button>
          </div>
        )}
        {err && job.status === "failed" && (
          <div className="lq-msg err lq-shake" role="alert">
            <svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="10" fill="#FF7AB6" stroke="#15121F" strokeWidth={2.5} /><path d="M12 7v6M12 16.5v.5" stroke="#15121F" strokeWidth={3} strokeLinecap="round" /></svg>
            <span style={{ flex: "1 1 260px" }}>{err}</span>
            <button className="lq-btn lq-btn-ink" type="button" onClick={() => run(job.prompt)} style={{ minHeight: 44, fontSize: 17, padding: "0 16px", boxShadow: "3px 3px 0 #15121f" }}>
              <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 12a8 8 0 1 0 3-6.2M4 4v5h5" fill="none" stroke="currentColor" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round" /></svg>
              Retry
            </button>
          </div>
        )}
        {empty && <p className="lq-msg err lq-shake" role="alert">Type what you want to learn first, or tap a quick pick.</p>}
      </div>
      <div className="lq-gen-pip" aria-hidden="true">{pose}</div>
    </section>
  );
}
