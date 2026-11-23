import { feedbackLimits } from "@learnquest/product-limits";
import { Link } from "@tanstack/react-router";
import { useCallback, useRef, useState, type FormEvent } from "react";
import { categories, type FeedbackCategory } from "./feedback-config";
import { Logo } from "./landing/Logo";
import "./landing.css";
import "./feedback.css";

const field = "lp-feedback-field min-h-11 w-full px-3 py-2 font-normal";
const errorMessage = "Could not send your feedback. Please try again.";
const focusHeading = (node: HTMLHeadingElement | null) => node?.focus();

function readScreenshot(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const data = reader.result;
      if (typeof data !== "string") {
        reject(new Error("Could not read the screenshot."));
        return;
      }
      resolve(data.slice(data.indexOf(",") + 1));
    };
    reader.onerror = () => reject(new Error("Could not read the screenshot."));
    reader.readAsDataURL(file);
  });
}

export default function Feedback() {
  const [category, setCategory] = useState<FeedbackCategory | "">("");
  const [step, setStep] = useState<"kind" | "details" | "sent">("kind");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [fileSelected, setFileSelected] = useState(false);
  const awaiting = useRef(false);
  const submissionId = useRef<string>(undefined);
  const nameInput = useRef<HTMLInputElement>(null);
  const screenshotInput = useRef<HTMLInputElement>(null);
  const goingBack = useRef(false);
  const categoryLabel = category && categories[category];
  const nameRef = useCallback((node: HTMLInputElement | null) => {
    nameInput.current = node;
    if (step === "kind" && node && goingBack.current) {
      goingBack.current = false;
      node.focus();
    }
  }, [step]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!category || awaiting.current) return;
    if (step === "kind") {
      setStep("details");
      return;
    }

    const form = new FormData(event.currentTarget);
    const file = form.get("screenshot");
    if (file instanceof File && file.size > feedbackLimits.screenshotBytes) {
      setMessage("Choose a screenshot up to 2 MB.");
      return;
    }

    awaiting.current = true;
    setBusy(true);
    setMessage("");
    try {
      submissionId.current ??= crypto.randomUUID();
      const screenshot = file instanceof File && file.name ? await readScreenshot(file) : undefined;
      const response = await fetch("/api/feedback", {
        method: "POST",
        credentials: "omit",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          id: submissionId.current,
          name: nameInput.current?.value,
          category,
          email: form.get("email"),
          details: form.get("details"),
          ...(category === "bug" ? { location: form.get("location"), screenshot } : {}),
        }),
      });
      const body = await response.json().catch(() => null) as { id?: string; error?: { message?: string } } | null;
      if (!response.ok) {
        setMessage(response.status === 429
          ? "Please wait a minute and try again."
          : (body?.error?.message ?? errorMessage));
        if (response.status === 409) submissionId.current = undefined;
        return;
      }
      if (body?.id !== submissionId.current) {
        setMessage(errorMessage);
        return;
      }
      setStep("sent");
    } catch {
      setMessage(errorMessage);
    } finally {
      awaiting.current = false;
      setBusy(false);
    }
  }

  return (
    <div className="lp">
      <a href="#feedback-main" className="lp-skip">Skip to content</a>
      <header className="lp-nav">
        <Link to="/" className="lp-logo" aria-label="LearnSlop home"><Logo /></Link>
      </header>
      <main id="feedback-main" tabIndex={-1} className="mx-auto grid max-w-xl gap-6 px-4 py-8 sm:gap-8 sm:px-6 sm:py-14">
        <h1 id="feedback-title" className="lp-h1">Send feedback</h1>
        <section className="lp-feedback-card grid gap-5 p-5 sm:p-8" aria-labelledby="feedback-title">
          {step === "sent" ? (
            <div className="grid gap-5" role="status">
              <h2 className="text-xl font-semibold tracking-tight" tabIndex={-1} ref={focusHeading}>Thanks for your feedback</h2>
              <p className="text-[var(--mu)]">We’ll follow up by email.</p>
              <Link to="/" className="lp-ghost justify-self-start">Back to LearnSlop</Link>
            </div>
          ) : (
            <form className="grid gap-5" onSubmit={(event) => void submit(event)} onChange={() => {
              submissionId.current = undefined;
              setMessage("");
            }}>
              <fieldset hidden={step !== "kind"} disabled={step !== "kind"} className={step === "kind" ? "grid gap-5" : "hidden"}>
                <label className="grid gap-2 font-medium">
                  Who are you?
                  <input ref={nameRef} name="name" autoComplete="nickname" placeholder="Name or handle" pattern={String.raw`.*\S.*`} maxLength={feedbackLimits.name} required className={field} />
                </label>
                <fieldset className="grid gap-2">
                  <legend className="mb-2 font-medium">What kind of feedback is this?</legend>
                  {Object.entries(categories).map(([value, label]) => (
                    <label key={value} className="lp-feedback-choice flex min-h-11 cursor-pointer items-center gap-3 px-3 py-2">
                      <input type="radio" name="category" value={value} required checked={value === category} onChange={() => {
                        setCategory(value as FeedbackCategory);
                        setFileSelected(false);
                      }} className="accent-[var(--ac)]" />
                      {label}
                    </label>
                  ))}
                </fieldset>
                <button type="submit" className="lp-btn justify-self-start">Continue</button>
              </fieldset>

              {category && (
                <fieldset hidden={step !== "details"} disabled={step !== "details" || busy} className={step === "details" ? "grid min-w-0 gap-5" : "hidden"}>
                  <h2 className="text-xl font-semibold tracking-tight" tabIndex={-1} ref={step === "details" ? focusHeading : undefined}>{categoryLabel}</h2>
                  {category === "bug" && (
                    <label className="grid gap-2 font-medium">
                      Where did you encounter the bug?
                      <input name="location" placeholder="Page, lesson, or URL" maxLength={feedbackLimits.location} required className={field} />
                    </label>
                  )}
                  <label className="grid gap-2 font-medium">
                    {category === "bug" ? "How can we reproduce it?" : "Tell us more"}
                    <textarea key={category} name="details" rows={5} maxLength={feedbackLimits.details} required className={field} />
                  </label>
                  {category === "bug" && (
                    <div className="grid gap-2">
                      <label className="grid gap-2 font-medium">
                        Screenshot (optional)
                        <input ref={screenshotInput} type="file" name="screenshot" accept="image/png,image/jpeg,image/webp" aria-describedby="screenshot-help" className={field} onChange={(event) => setFileSelected(Boolean(event.currentTarget.files?.length))} />
                      </label>
                      <p id="screenshot-help" className="text-sm text-[var(--mu)]">One PNG, JPEG, or WebP up to 2 MB. Crop out passwords and other sensitive information.</p>
                      {fileSelected && (
                        <button type="button" className="lp-ghost justify-self-start" onClick={() => {
                          const input = screenshotInput.current;
                          if (!input) return;
                          input.value = "";
                          input.focus();
                          submissionId.current = undefined;
                          setFileSelected(false);
                          setMessage("");
                        }}>Remove screenshot</button>
                      )}
                    </div>
                  )}
                  <label className="grid gap-2 font-medium">
                    Reply email
                    <input type="email" name="email" autoComplete="email" maxLength={feedbackLimits.email} required className={field} />
                  </label>
                  <p className="text-sm text-[var(--mu)]">Your feedback and contact details are visible to the LearnSlop support team.</p>
                  <div className="flex flex-wrap gap-3">
                    <button type="button" className="lp-ghost" onClick={() => { goingBack.current = true; setMessage(""); setStep("kind"); }}>Back</button>
                    <button type="submit" className="lp-btn">{busy ? "Sending…" : "Send feedback"}</button>
                  </div>
                </fieldset>
              )}
              {message && <p role="alert" className="text-[var(--bad)]">{message}</p>}
            </form>
          )}
        </section>
      </main>
    </div>
  );
}
