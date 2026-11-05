import { Link } from "@tanstack/react-router";
import type { HomeData } from "../../lib/api";
import { Arrow, Pip } from "./art";
import { pct } from "./pct";

export default function Continue({ c }: { c: NonNullable<HomeData["continue"]> }) {
  return (
    <section className="lq-card lq-hero lq-bg-pink lq-rise d2" aria-labelledby="hero-h" style={{ marginTop: 8 }}>
      <div className="lq-peek-top" style={{ right: 64 }} aria-hidden="true"><Pip src="/img/pip-cheer.png" size={104} /></div>
      <div>
        <div className="lq-eyebrow">
          <span className="lq-tag">{c.path.title}</span>
          <span style={{ font: "400 18px var(--font-display)", letterSpacing: ".04em" }}>Course {c.course.index + 1} of {c.course.count}</span>
        </div>
        <h2 id="hero-h" style={{ fontSize: 62, lineHeight: ".95" }}>{c.course.title}</h2>
        <p style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 18, font: "700 19px var(--font-body)" }}>
          <span className="lq-lvl"><span className="sr">Level </span>LV {c.lesson.level}</span>
          {c.lesson.title}
        </p>
        <div style={{ display: "flex", alignItems: "center", gap: 14, marginTop: 18, maxWidth: 460 }}>
          <div
            className="lq-meter lg f-sun" role="progressbar" aria-label="Lesson progress" aria-valuemin={0} aria-valuemax={c.lesson.total}
            aria-valuenow={c.lesson.done} style={{ flex: "1 1 auto" }}
          >
            <span style={{ width: `${pct(c.lesson.done, c.lesson.total)}%` }} />
          </div>
          <span style={{ font: "400 20px var(--font-display)", whiteSpace: "nowrap" }}>{c.lesson.done} / {c.lesson.total}</span>
        </div>
        <div style={{ position: "relative", display: "inline-block", marginTop: 26 }}>
          <Link to="/play" search={{ lesson: c.lesson.slug, course: c.course.slug }} className="lq-btn lq-btn-ink lq-btn-xl">Continue<Arrow /></Link>
        </div>
      </div>
      <div className="lq-code lq-tr2" aria-hidden="true">
        <span className="lq-sticker lq-bg-sun" style={{ position: "absolute", top: -16, left: 18 }}>PREDICT</span>
        <div><span className="k">for</span> i <span className="k">in</span> <span className="f">range</span>(<span className="n">3</span>):</div>
        <div>&#160;&#160;<span className="k">for</span> j <span className="k">in</span> <span className="f">range</span>(i):</div>
        <div>&#160;&#160;&#160;&#160;<span className="f">print</span>(i, j)</div>
        <div className="c"># what prints?</div>
        <div className="q">&gt; ? ? ?</div>
      </div>
    </section>
  );
}
