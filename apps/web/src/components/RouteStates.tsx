import { useEffect } from "react";
import { Link, type ErrorComponentProps } from "@tanstack/react-router";
import { isChunkError, reloadOnce } from "../lib/chunkReload";

const shell = "grid min-h-screen place-items-center p-6";
const card = "chunk flex max-w-md items-center gap-4 p-5";

export function NotFound() {
  return (
    <div className={`lq ${shell}`}>
      <div className={card}>
        <div className="font-medium">
          <p>We couldn't find that page.</p>
          <Link to="/" className="btn mt-3 inline-block">Back home</Link>
        </div>
      </div>
    </div>
  );
}

export function RouteError({ error, reset }: ErrorComponentProps) {
  const stale = isChunkError(error);
  useEffect(() => {
    if (stale) reloadOnce();
  }, [stale]);
  return (
    <div className={`lq ${shell}`}>
      <div className={card}>
        <div role="alert" className="font-medium">
          <p>{stale ? "LearnSlop was updated. Reload to get the latest version." : "Something went wrong loading this page."}</p>
          <div className="mt-3 flex gap-2">
            <button type="button" className="btn" onClick={() => (stale ? location.reload() : reset())}>{stale ? "Reload" : "Try again"}</button>
            <a href="/" className="pill px-4 py-2 text-sm">Home</a>
          </div>
        </div>
      </div>
    </div>
  );
}
