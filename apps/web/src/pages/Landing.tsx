import PredictDemo from "../components/PredictDemo";

const concepts = [
  ["Loops", "bg-sun"],
  ["Functions", "bg-pink"],
  ["Async", "bg-lilac"],
  ["State", "bg-mint"],
  ["Testing", "bg-sun"],
  ["Refactoring", "bg-pink"],
];

const loop = [
  ["Predict", "Pause a real commit. Say what the next change does.", "bg-sun", "-rotate-2", "predict"],
  ["Hint", "Stuck? Hints come one rung at a time. Never the answer.", "bg-pink", "rotate-1", "hint"],
  ["Reveal", "Watch the change replay in the editor, with narration.", "bg-lilac", "-rotate-1", "reveal"],
  ["Adapt", "A learner model picks your next step, and tells you why.", "bg-mint", "rotate-2", "adapt"],
];

export default function Landing() {
  return (
    <div className="overflow-x-hidden">
      <header className="mx-auto flex max-w-6xl items-center justify-between px-6 py-5">
        <a href="/" className="font-display text-3xl font-black tracking-tight">
          Learn<span className="text-blue">Slop</span>
        </a>
        <nav className="flex items-center gap-3 text-sm font-extrabold">
          <a href="#loop" className="pill hidden bg-white px-5 py-2 sm:block">How it works</a>
          <a href="/login" className="pill bg-white px-5 py-2">Sign in</a>
          <a href="/login" className="btn !px-5 !py-2">Try it</a>
        </nav>
      </header>

      <main>
        <section className="mx-auto grid max-w-6xl items-center gap-12 px-6 pb-20 pt-8 lg:grid-cols-[1.1fr_1fr]">
          <div>
            <h1 className="font-display text-6xl font-black leading-[0.98] tracking-tight md:text-7xl">
              Learn code by <span className="text-blue underline decoration-sun decoration-[10px] underline-offset-[10px]">guessing</span> first.
            </h1>
            <p className="mt-8 max-w-md text-xl font-semibold text-ink/75">
              Real commits, turned into bite-sized quests. You predict the change, then watch it happen. The more you
              learn, the smarter the next step.
            </p>
            <div className="mt-9 flex flex-wrap items-center gap-4">
              <a href="/play" className="btn !px-6 !py-2.5 text-base">Play a step</a>
              <span className="pill bg-white px-5 py-2 text-sm">Lessons landing soon</span>
            </div>
          </div>

          <div id="try" className="relative mx-auto w-full max-w-xl scroll-mt-6 lg:max-w-none">
            <span className="float absolute right-3 top-[5rem] z-10 sm:-right-3 pill bg-pink px-4 py-1 text-sm" style={{ "--r": "6deg" } as React.CSSProperties}>
              try me!
            </span>
            <PredictDemo />
          </div>
        </section>

        <section aria-label="Concepts" className="border-y-[3px] border-ink bg-sun py-5">
          <ul className="mx-auto flex max-w-6xl flex-wrap justify-center gap-3 px-6">
            {concepts.map(([name, bg]) => (
              <li key={name} className={`pill px-5 py-1.5 text-sm ${bg === "bg-sun" ? "bg-white" : bg}`}>
                {name}
              </li>
            ))}
          </ul>
        </section>

        <section id="loop" className="mx-auto max-w-6xl px-6 py-24">
          <h2 className="font-display text-5xl font-black tracking-tight">Four moves. Repeat.</h2>
          <ol className="mt-12 grid grid-cols-2 gap-4 sm:gap-8 lg:grid-cols-4">
            {loop.map(([title, body, bg, tilt, img], i) => (
              <li key={title} className={`chunk ${bg} ${tilt} p-3 sm:p-6 transition-transform hover:rotate-0`}>
                <img src={`/img/${img}.png`} alt="" className="mb-2 aspect-square w-full object-contain" />
                <span className="font-display text-4xl font-black sm:text-5xl">{i + 1}</span>
                <h3 className="mt-2 text-2xl font-black">{title}</h3>
                <p className="mt-2 text-sm font-semibold sm:text-base">{body}</p>
              </li>
            ))}
          </ol>
        </section>

        <section className="mx-auto max-w-6xl px-6 pb-24">
          <h2 className="font-display text-4xl font-black tracking-tight md:text-5xl">Why not just watch a tutorial?</h2>
          <div className="mt-10 grid gap-8 md:grid-cols-2">
            <div className="chunk bg-white p-6">
              <p className="font-display text-2xl font-black text-ink/50">Watching</p>
              <ul className="mt-4 space-y-3 font-semibold text-ink/60">
                <li><span className="mr-2 font-black text-pink">&#10005;</span>It all makes sense while it plays</li>
                <li><span className="mr-2 font-black text-pink">&#10005;</span>Nothing tells you what you missed</li>
                <li><span className="mr-2 font-black text-pink">&#10005;</span>Same video for everyone</li>
              </ul>
            </div>
            <div className="chunk bg-mint p-6">
              <p className="font-display text-2xl font-black">Predicting first</p>
              <ul className="mt-4 space-y-3 font-bold">
                <li><span className="mr-2 font-black text-green-deep">&#10003;</span>You commit to a guess before the answer</li>
                <li><span className="mr-2 font-black text-green-deep">&#10003;</span>Misses show exactly what to review</li>
                <li><span className="mr-2 font-black text-green-deep">&#10003;</span>The next step adapts to what you know</li>
              </ul>
            </div>
          </div>
        </section>

        <section className="mx-auto grid max-w-6xl items-center gap-12 px-6 pb-24 md:grid-cols-2">
          <div>
            <img src="/img/mastery.png" alt="Pip watering three plants of different heights" className="mb-6 w-full" />
          <div className="chunk bg-white p-6">
            <p className="mb-4 font-extrabold">Your mastery map</p>
            {[["Loops", 72, "bg-sun"], ["Functions", 45, "bg-pink"], ["Async", 18, "bg-lilac"]].map(([n, v, c]) => (
              <div key={n as string} className="mb-3 flex items-center gap-3">
                <span className="w-24 text-sm font-extrabold">{n}</span>
                <div className="track h-5 flex-1">
                  <div className={`h-full ${c}`} style={{ width: `${v}%` }} />
                </div>
              </div>
            ))}
            <p className="mt-4 rounded-lg bg-mint px-3 py-2 text-sm font-bold">Next up: Async. It is your lowest unlocked concept.</p>
          </div>
          </div>
          <div>
            <h2 className="font-display text-5xl font-black tracking-tight">It learns you back.</h2>
            <p className="mt-5 text-lg font-semibold text-ink/75">
              Every first attempt updates a model of what you know. Hints help, but they do not earn mastery, so
              watching never counts as learning. Each recommendation shows its reason.
            </p>
            <p className="mt-4 text-sm font-bold text-ink/60">Replays are reconstructed from a diff, never recorded.</p>
          </div>
        </section>

        <section className="border-t-[3px] border-ink bg-blue py-24 text-center text-white">
          <img src="/img/finale.png" alt="Pip leaping with confetti" className="mx-auto mb-6 w-full max-w-xl px-6" />
          <h2 className="mx-auto max-w-2xl px-6 font-display text-5xl font-black tracking-tight">Ready to take a guess?</h2>
          <a href="/play" className="btn mt-8 text-lg">Play a step</a>
        </section>
      </main>

      <footer className="bg-ink py-8 text-center text-sm font-bold text-paper/70">LearnSlop · a CICDP course project</footer>
    </div>
  );
}
