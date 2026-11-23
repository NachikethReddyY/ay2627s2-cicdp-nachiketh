import { useState, type FormEvent } from "react";
import { TRPCClientError } from "@trpc/client";
import { usePostHog } from "@posthog/react";
import { trpc, type RouterOutputs } from "../lib/trpc";

export type HandleProfile = RouterOutputs["me"]["handle"]["profile"];

const changeDate = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" });

export default function HandleForm({ profile, onContinue }: { profile: HandleProfile; onContinue?: () => void }) {
  const [current, setCurrent] = useState(profile);
  const [handle, setHandle] = useState(profile.handle);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const posthog = usePostHog();
  const { nextChangeAt } = current;
  const locked = !onContinue && nextChangeAt !== null;

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || locked) return;
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      const updated = await trpc.me.handle.save.mutate({ handle });
      if (onContinue) {
        posthog?.capture("onboarding_completed");
        onContinue();
      }
      else {
        setCurrent(updated);
        setHandle(updated.handle);
        setSaved(true);
      }
    } catch (err) {
      const code = err instanceof TRPCClientError ? err.data?.code : undefined;
      setError(err instanceof TRPCClientError && (code === "BAD_REQUEST" || code === "CONFLICT" || code === "TOO_MANY_REQUESTS")
        ? err.message
        : "Couldn't save your handle. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="grid gap-4" onSubmit={submit} noValidate>
      <p id="handle-visibility" className="text-sm text-[var(--mu)]">
        Everyone can see your handle and XP on the weekly leaderboard. Leaderboard participation is always on.
      </p>
      <div className="grid gap-2">
        <label htmlFor="public-handle" className="text-sm font-medium">Public handle</label>
        <input
          id="public-handle"
          className="min-h-11 w-full rounded-xl border border-[var(--line-strong)] bg-[var(--code)] px-3 font-mono text-base text-[var(--tx)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--acT)]"
          autoCapitalize="none"
          autoComplete="off"
          spellCheck={false}
          value={handle}
          readOnly={busy || locked}
          aria-invalid={error ? true : undefined}
          aria-describedby={`handle-visibility handle-rules${error ? " handle-error" : ""}`}
          onChange={(event) => { setHandle(event.target.value); setError(null); setSaved(false); }}
        />
        <p id="handle-rules" className="text-sm text-[var(--mu)]">
          {locked ? `You can change your handle again on ${changeDate.format(nextChangeAt)}.` : "Use 3 to 20 letters, numbers, or underscores. You can change your handle once every 30 days."}
        </p>
      </div>
      {error && <p id="handle-error" role="alert" className="text-sm text-[var(--bad)]">{error}</p>}
      {saved && <p role="status" className="text-sm">Public handle saved.</p>}
      {!locked && <div><button type="submit" className="lq-btn lq-btn-blue" disabled={busy}>
        {busy ? "Saving…" : onContinue ? "Continue to LearnSlop" : "Save handle"}
      </button></div>}
    </form>
  );
}
