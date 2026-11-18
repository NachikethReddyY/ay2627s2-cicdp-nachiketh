import { Mark } from "../player/workbench/Toolbar";
import "./previewLoading.css";

type Props = {
  state: "starting" | "error";
  stage?: string;
  message?: string;
  onRetry(): void;
};

export function PreviewLoading({ state, stage, message, onRetry }: Props) {
  if (state === "error") {
    return (
      <div className="wb-preview-loading" role="alert">
        <div className="wb-preview-loading-card">
          <p className="wb-preview-loading-message">{message ?? "The browser preview failed to start"}</p>
          <button type="button" className="wb-preview-loading-retry" onClick={onRetry}>
            Retry preview
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="wb-preview-loading">
      <div className="wb-preview-loading-card">
        <div className="wb-preview-loading-mark">
          <span className="wb-preview-loading-ring" aria-hidden="true" />
          <Mark size={40} />
        </div>
        <p role="status" aria-live="polite" className="wb-preview-loading-stage">
          {stage ?? "Preparing the preview…"}
        </p>
        <div className="wb-preview-loading-bars" aria-hidden="true">
          <i />
          <i />
          <i />
        </div>
      </div>
    </div>
  );
}

export default PreviewLoading;
