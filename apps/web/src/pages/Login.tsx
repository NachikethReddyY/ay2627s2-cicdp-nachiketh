import { useState, type FormEvent } from "react";
import { authClient } from "../lib/auth";
import { safeRedirect } from "../lib/redirect";

const field =
  "w-full rounded-xl border-[3px] border-ink bg-white px-4 py-3 font-semibold outline-none transition placeholder:text-ink/60 focus:-translate-y-0.5 focus:bg-sun/30 focus:shadow-[0_4px_0_var(--color-ink)]";

type Mode = "in" | "up";

export default function Login() {
  const [mode, setMode] = useState<Mode>("in");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const { data } = authClient.useSession();

  async function run(action: Mode) {
    setBusy(true);
    setError(null);
    const name = email.split("@")[0] || "Learner";
    try {
      const result =
        action === "in"
          ? await authClient.signIn.email({ email, password })
          : await authClient.signUp.email({ email, password, name });
      if (result.error) setError(result.error.message ?? "Something went wrong. Try again.");
      else location.assign(safeRedirect(new URLSearchParams(location.search).get("redirect")));
    } catch {
      setError("Can't reach the server. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    void run(mode);
  }

  async function signOut() {
    setError(null);
    try {
      const { error } = await authClient.signOut();
      if (error) throw error;
      location.reload();
    } catch {
      setError("Sign out failed. Check your connection and try again.");
    }
  }

  const isIn = mode === "in";

  return (
    <div className="relative isolate min-h-screen overflow-hidden bg-paper">
      {/* Background blobs sit in two opposite corners, so they frame the page instead of scattering across it */}
      <div aria-hidden="true" className="pointer-events-none absolute -left-24 -top-24 -z-10 size-[28rem] rounded-full bg-mint/60" />
      <div aria-hidden="true" className="pointer-events-none absolute -bottom-32 -right-24 -z-10 size-[30rem] rounded-full bg-pink/40" />

      <header className="mx-auto flex max-w-6xl items-center justify-between px-6 py-5">
        <a href="/" className="font-display text-3xl font-black tracking-tight">
          Learn<span className="text-blue">Slop</span>
        </a>
        <a href="/" className="pill bg-white px-4 py-2 text-sm">Back to home</a>
      </header>

      <main className={`mx-auto grid min-h-[calc(100vh-6rem)] max-w-6xl items-center gap-12 px-6 pb-16 ${data ? "" : "lg:grid-cols-[1fr_1fr]"}`}>
        {!data && (
        <section className="rise hidden lg:block">
          <h1 className="font-display text-6xl font-black leading-[0.98] tracking-tight">
            {isIn ? (
              <>
                Pick up where <span className="text-blue">you left off</span>.
              </>
            ) : (
              <>
                Start your <span className="text-blue">journey</span> today.
              </>
            )}
          </h1>
          <p className="mt-6 text-lg font-semibold text-ink/70">
            Your quest log is waiting. Progress saves as you go. Predict first, then watch.
          </p>
        </section>
        )}

        <div className="rise relative mx-auto w-full max-w-md">
          {data && (
            <div className="chunk mb-8 space-y-3 bg-mint p-4 text-center">
              <p className="font-bold">Signed in as {data.user.email}</p>
              <div className="flex flex-wrap justify-center gap-3">
                <a href="/play" className="btn !px-5 !py-2">Continue to play</a>
                <button
                  type="button"
                  onClick={() => void signOut()}
                  className="pill bg-white px-4 py-2 text-sm"
                >
                  Sign out
                </button>
              </div>
              {error && (
                <p role="alert" className="text-sm font-bold">
                  {error}
                </p>
              )}
            </div>
          )}
          {!data && (
          <>
          <span className="pill relative z-10 -mb-4 mx-auto block w-fit bg-pink px-4 py-1 text-sm">
            {isIn ? "welcome back!" : "new here? hi!"}
          </span>

          <form onSubmit={onSubmit} className="chunk relative space-y-6 bg-white p-8">
            <div className="text-center">
              <h2 className="font-display text-4xl font-black tracking-tight">{isIn ? "Sign in" : "Create account"}</h2>
              <p className="mt-2 font-semibold text-ink/60">
                {isIn ? "Good to see you again." : "Takes ten seconds. Guess away."}
              </p>
            </div>

            <div role="group" aria-label="Account action" className="grid grid-cols-2 gap-2 rounded-full border-[3px] border-ink bg-paper p-1">
              {(
                [
                  ["in", "Sign in"],
                  ["up", "Create account"],
                ] as const
              ).map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  aria-pressed={mode === value}
                  onClick={() => {
                    setMode(value);
                    setError(null);
                  }}
                  className={`rounded-full px-4 py-2 text-sm font-extrabold transition ${
                    mode === value ? "bg-sun shadow-[0_3px_0_var(--color-ink)]" : "text-ink/50 hover:bg-sun/40 hover:text-ink"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>

            <div className="space-y-2">
              <label htmlFor="email" className="block text-sm font-extrabold">Email</label>
              <input
                id="email"
                type="email"
                autoComplete="email"
                placeholder="you@example.com"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className={field}
              />
            </div>

            <div className="space-y-2">
              <label htmlFor="password" className="block text-sm font-extrabold">Password</label>
              <input
                id="password"
                type="password"
                autoComplete={isIn ? "current-password" : "new-password"}
                placeholder="At least 8 characters"
                required
                minLength={8}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className={field}
              />
            </div>

            {error && (
              <p role="alert" className="shake rounded-lg border-[3px] border-ink bg-pink px-3 py-2 text-sm font-bold">
                {error}
              </p>
            )}

            <button
              type="submit"
              disabled={busy}
              className="btn ring w-full text-lg disabled:opacity-60"
            >
              {busy ? "One sec…" : isIn ? "Sign in" : "Create account"}
            </button>
          </form>

          {/* Pip peeks over the card's bottom-right corner, next to the main button */}
          <img
            src="/img/pip-wave.png"
            alt="Pip waving hello"
            className="pointer-events-none absolute -bottom-12 -right-16 hidden w-32 select-none lg:block"
          />
          </>
          )}
        </div>
      </main>
    </div>
  );
}
