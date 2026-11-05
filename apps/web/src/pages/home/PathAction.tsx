import { useState } from "react";
import type { PathCardData } from "../../lib/api";
import { trpc } from "../../lib/trpc";

export default function PathAction({ p, onDone, label }: { p: PathCardData; onDone: () => void; label: string }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(false);
  return (
    <>
      <button
        type="button" disabled={busy} aria-label={`${label} ${p.title}`} className="lq-btn lq-btn-surface"
        style={{ minHeight: 44, fontSize: 17, padding: "0 18px" }}
        onClick={() => {
          setBusy(true);
          setErr(false);
          trpc.paths.enroll.mutate({ slug: p.slug }).then(onDone, () => setErr(true)).finally(() => setBusy(false));
        }}
      >
        {label}
      </button>
      {err && <p role="alert" style={{ marginTop: 4, fontWeight: 700, fontSize: 14 }}>Couldn't join. Try again.</p>}
    </>
  );
}
