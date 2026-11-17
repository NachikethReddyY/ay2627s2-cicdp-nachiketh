import { useEffect, useRef, useState, type FormEvent, type PointerEvent as ReactPointerEvent } from "react";
import { AlertCircle, X } from "lucide-react";
import { authClient } from "../lib/auth";
import { Breadcrumb, BreadcrumbItem, BreadcrumbLink, BreadcrumbList, BreadcrumbPage, BreadcrumbSeparator } from "../components/ui/breadcrumb";
import { Logo } from "./landing/Logo";
import "./landing.css";

const field =
  "w-full rounded-[var(--r-md)] bg-black/60 px-4 py-3 text-[16px] text-[var(--tx)] shadow-[var(--ring)] outline-none transition-shadow placeholder:text-[var(--faint)] focus:shadow-[0_0_0_1px_var(--acH)]";

type Mode = "in" | "up";

const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Checked here rather than by the browser, so the problem shows in the same toast as server errors.
function checkForm(email: string, password: string): string | null {
  if (!EMAIL_SHAPE.test(email.trim())) return "Enter an email address like name@example.com.";
  if (password.length < 8) return "Use at least 8 characters for your password.";
  return null;
}

// Turn an auth error into a message the learner can act on. Unknown errors fall back to a per-mode line.
function describeAuthError(error: { status?: number; message?: string }, action: Mode): string {
  if (error.status === 429) return "Too many attempts. Wait a minute, then try again.";
  if (error.status !== undefined && error.status >= 500) return "The server had a problem. Try again in a moment.";
  if (action === "up" && /already|exists/i.test(error.message ?? "")) return "An account with this email already exists. Try signing in instead.";
  if (action === "in" && (error.status === 401 || error.status === 403)) return "That email and password don't match. Check them and try again.";
  return action === "in" ? "Couldn't sign you in. Check your details and try again." : "Couldn't create your account. Check your details and try again.";
}

export default function Login() {
  const [mode, setMode] = useState<Mode>("in");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const { data } = authClient.useSession();
  // Mode toggle drag state: thumb offset in px while sliding, and whether the thumb is pressed.
  const [dragX, setDragX] = useState<number | null>(null);
  const [pressing, setPressing] = useState(false);
  const drag = useRef<{ x: number; thumb: number; moved: boolean } | null>(null);

  // The toast clears itself after a few seconds, or when the learner dismisses it.
  useEffect(() => {
    if (!error) return;
    const timer = setTimeout(() => setError(null), 6000);
    return () => clearTimeout(timer);
  }, [error]);

  async function run(action: Mode) {
    setBusy(true);
    setError(null);
    const name = email.split("@")[0] || "Learner";
    try {
      const result =
        action === "in"
          ? await authClient.signIn.email({ email, password })
          : await authClient.signUp.email({ email, password, name });
      if (result.error) setError(describeAuthError(result.error, action));
      // Every successful sign-in lands on home. The guard's ?redirect= is ignored on purpose.
      else location.assign("/");
    } catch {
      setError("Can't reach the server. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    const problem = checkForm(email, password);
    if (problem) {
      setError(problem);
      return;
    }
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
  // The submit button stays inactive until both fields have a value.
  const ready = email.trim() !== "" && password !== "";

  // Taps go through the buttons' onClick. A drag past a small threshold captures the pointer and commits by release position.
  function onToggleDown(e: ReactPointerEvent<HTMLDivElement>) {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    drag.current = { x: e.clientX, thumb: (e.currentTarget.clientWidth - 8) / 2, moved: false };
    setPressing(true);
  }

  function onToggleMove(e: ReactPointerEvent<HTMLDivElement>) {
    const d = drag.current;
    if (!d) return;
    const dx = e.clientX - d.x;
    if (!d.moved) {
      if (Math.abs(dx) < 6) return;
      d.moved = true;
      e.currentTarget.setPointerCapture(e.pointerId);
    }
    const base = isIn ? 0 : d.thumb;
    setDragX(Math.max(0, Math.min(d.thumb, base + dx)) - base);
  }

  function onToggleUp() {
    const d = drag.current;
    drag.current = null;
    setPressing(false);
    if (d?.moved && dragX !== null) {
      const pos = (isIn ? 0 : d.thumb) + dragX;
      setMode(pos > d.thumb / 2 ? "up" : "in");
    }
    setDragX(null);
  }

  return (
    <div className="lp lp-signup">
      <header className="lp-nav !flex-col !items-start gap-4">
        <a href="/" className="lp-logo" aria-label="LearnSlop home">
          <Logo />
        </a>
        {!data && (
          <Breadcrumb className="inline-flex rounded-full bg-white/[0.14] px-4 py-1.5 text-[var(--mu)] shadow-[var(--ring)] backdrop-blur">
            <BreadcrumbList className="gap-2">
              <BreadcrumbItem>
                <BreadcrumbLink href="/" className="hover:text-[var(--tx)]">Home</BreadcrumbLink>
              </BreadcrumbItem>
              <BreadcrumbSeparator />
              <BreadcrumbItem>
                <BreadcrumbPage className="!text-[var(--tx)]">{isIn ? "Sign in" : "Create account"}</BreadcrumbPage>
              </BreadcrumbItem>
            </BreadcrumbList>
          </Breadcrumb>
        )}
      </header>

      <main className="mx-auto flex min-h-[calc(100dvh-140px)] w-full max-w-[520px] flex-col justify-center gap-6 px-6 pb-16">
        <div className="rise relative w-full">
          {data && (
            <div className="chunk space-y-6 p-8 text-center">
              <div className="mx-auto grid size-14 place-items-center rounded-full bg-[var(--ac)] text-xl font-semibold !text-white" aria-hidden="true">
                {data.user.email.charAt(0).toUpperCase()}
              </div>
              <div className="space-y-1">
                <p className="text-sm text-[var(--mu)]">Signed in as</p>
                <p className="break-all text-[15px] font-semibold text-[var(--tx)]">{data.user.email}</p>
              </div>
              <div className="space-y-3">
                <a href="/play" className="lp-btn !mt-0 w-full justify-center">Continue to play</a>
                <button type="button" onClick={() => void signOut()} className="min-h-11 w-full text-sm text-[var(--mu)] hover:text-[var(--tx)]">
                  Sign out
                </button>
              </div>
            </div>
          )}

          {!data && (
            <>
              <span className="relative z-10 -mb-4 mx-auto block w-fit rounded-full bg-[var(--ac)] px-4 py-1 text-sm font-medium !text-white shadow-[var(--lift-sm)]">
                {isIn ? "👋 welcome back!" : "✨ new here? hi!"}
              </span>

              <form onSubmit={onSubmit} noValidate className="chunk relative space-y-7 p-10">
                <div className="text-center">
                  <h1 className="text-[30px] font-semibold leading-tight tracking-[-0.04em]">{isIn ? "Sign in" : "Create account"}</h1>
                  <p className="!mt-2 text-[var(--mu)]">
                    {isIn ? "Good to see you again." : "Save your progress as you go."}
                  </p>
                </div>

                <div
                  role="group"
                  aria-label="Account action"
                  onPointerDown={onToggleDown}
                  onPointerMove={onToggleMove}
                  onPointerUp={onToggleUp}
                  onPointerCancel={onToggleUp}
                  className="relative !mt-3 mx-auto grid w-full max-w-[300px] touch-none select-none grid-cols-2 rounded-full bg-white/[0.06] p-1 shadow-[var(--ring)]"
                >
                  <span
                    aria-hidden="true"
                    style={dragX === null ? undefined : { translate: `${(isIn ? 0 : (drag.current?.thumb ?? 0)) + dragX}px 0` }}
                    className={`pointer-events-none absolute inset-y-1 left-1 w-[calc(50%-4px)] rounded-full bg-white/[0.16] shadow-[0_2px_8px_rgba(0,0,0,0.35)] backdrop-blur ${
                      dragX === null ? "transition-[translate,scale,background-color] duration-300 ease-out" : ""
                    } ${dragX === null && !isIn ? "translate-x-full" : ""} ${pressing ? "scale-x-[1.08] scale-y-[1.14] bg-white/[0.24]" : ""}`}
                  />
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
                      className={`relative z-10 min-h-8 whitespace-nowrap rounded-full px-3 text-sm font-medium transition-colors ${
                        mode === value ? "!text-white" : "!text-[var(--mu)] hover:!text-[var(--tx)]"
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>

                <div className="space-y-2">
                  <label htmlFor="email" className="block text-[13px] font-medium text-[var(--mu)]">Email</label>
                  <input
                    id="email"
                    type="email"
                    autoComplete="email"
                    placeholder="you@example.com"
                    required
                    aria-describedby={error ? "form-error" : undefined}
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className={field}
                  />
                </div>

                <div className="space-y-2">
                  <label htmlFor="password" className="block text-[13px] font-medium text-[var(--mu)]">Password</label>
                  <input
                    id="password"
                    type="password"
                    autoComplete={isIn ? "current-password" : "new-password"}
                    placeholder={isIn ? "Your password" : "At least 8 characters"}
                    required
                    minLength={8}
                    aria-describedby={error ? "form-error" : undefined}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className={field}
                  />
                </div>

                {/* The global .lp-btn:disabled dims the whole button. Keep the label at full contrast while busy, and show the inactive look until the fields are filled. */}
                <button
                  type="submit"
                  disabled={busy || !ready}
                  className={`lp-btn !mt-0 !opacity-100 w-full justify-center ${ready || busy ? "" : "!bg-white/[0.16] !text-[#d4d4d4]"}`}
                >
                  {busy ? "One sec…" : isIn ? "Sign in" : "Create account"}
                </button>
              </form>
            </>
          )}
        </div>
      </main>

      {error && (
        <div
          id="form-error"
          role="alert"
          className="rise fixed right-4 top-4 z-50 flex w-[min(380px,calc(100vw-2rem))] items-start gap-3 rounded-[var(--r-lg)] border border-[var(--glass-line)] border-l-4 border-l-[var(--bad)] bg-[var(--g2)] p-4 text-sm font-medium shadow-[var(--lift)]"
        >
          <AlertCircle size={18} strokeWidth={2.25} className="mt-0.5 shrink-0 text-[var(--bad)]" aria-hidden="true" />
          <span className="flex-1 text-[var(--tx)]">{error}</span>
          <button
            type="button"
            onClick={() => setError(null)}
            aria-label="Dismiss message"
            className="-m-1 rounded-full p-1 text-[var(--mu)] hover:text-[var(--tx)]"
          >
            <X size={16} strokeWidth={2.25} aria-hidden="true" />
          </button>
        </div>
      )}
    </div>
  );
}
