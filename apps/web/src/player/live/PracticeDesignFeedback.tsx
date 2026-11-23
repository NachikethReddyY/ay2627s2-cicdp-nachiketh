import { useState } from "react";
import { ApiError, requestDesignFeedback, type DesignFeedback } from "../runPython";

type RequestState =
  | { status: "idle" | "loading" }
  | { status: "error"; message: string }
  | { status: "done"; feedback: DesignFeedback | null };

export default function PracticeDesignFeedback(input: Parameters<typeof requestDesignFeedback>[0]) {
  const [state, setState] = useState<RequestState>({ status: "idle" });

  const request = async () => {
    setState({ status: "loading" });
    try {
      const { feedback } = await requestDesignFeedback(input);
      setState({ status: "done", feedback });
    } catch (error) {
      setState({
        status: "error",
        message: error instanceof ApiError ? error.message : "Could not load design feedback. Try again.",
      });
    }
  };

  return (
    <section aria-labelledby="practice-design-feedback" className="mt-3 rounded-lg border border-[var(--line)] bg-[var(--pane2)] p-2.5">
      <h3 id="practice-design-feedback" className="wb-sec mb-1 h-[22px] p-0">AI design feedback</h3>
      {state.status === "done" ? (
        <div role="status" className="text-xs">
          {state.feedback ? (
            <>
              <div className="wb-mono font-semibold">Line {state.feedback.line}</div>
              <p className="m-0 mt-1 break-words">{state.feedback.note}</p>
            </>
          ) : <p className="m-0">No design suggestion is available for this submission.</p>}
        </div>
      ) : (
        <button type="button" className="wb-tb wb-outline" disabled={state.status === "loading"} onClick={() => void request()}>
          {state.status === "loading" ? "Reviewing…" : "Get design feedback"}
        </button>
      )}
      {state.status === "error" && <p role="alert" className="m-0 mt-1 text-xs">{state.message}</p>}
    </section>
  );
}
