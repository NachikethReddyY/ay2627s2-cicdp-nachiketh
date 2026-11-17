import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { authClient } from "../lib/auth";

const nav = "pill min-h-9 px-4 text-sm font-medium text-[var(--mu)] hover:bg-[var(--hov)] hover:text-[var(--tx)]";
const on = "pill min-h-9 border-transparent bg-[var(--sel)] px-4 text-sm font-medium text-[var(--acT)]";

export default function TopNav({ streak, xp }: { streak?: number; xp?: number }) {
  const { data } = authClient.useSession();
  const [signOutFailed, setSignOutFailed] = useState(false);
  const signOut = async () => {
    setSignOutFailed(false);
    try {
      const { error } = await authClient.signOut();
      if (error) throw error;
      location.assign("/");
    } catch {
      setSignOutFailed(true);
    }
  };
  return (
    <header className="sticky top-2 z-10 mx-auto max-w-6xl px-4 pt-2 sm:px-6">
     <div className="flex flex-wrap items-center justify-between gap-3 rounded-[26px] border border-[var(--glass-line)] bg-[var(--glass)] py-1.5 pr-2 pl-4 shadow-[var(--lift-sm)] backdrop-blur-xl backdrop-saturate-150">
      <Link to="/" className="rounded-lg text-lg font-semibold tracking-tight">
        Learn<span className="text-[var(--acT)]">Slop</span>
      </Link>
      <nav aria-label="Main" className="flex flex-wrap items-center gap-1.5 sm:gap-2">
        <Link to="/" className={nav} activeOptions={{ exact: true }} activeProps={{ className: on }}>Home</Link>
        <Link to="/explore" className={nav} activeProps={{ className: on }}>Explore</Link>
        {streak !== undefined && <span className="pill min-h-9 bg-pink px-3 text-sm tabular-nums" title="Day streak">🔥 {streak}</span>}
        {xp !== undefined && <span className="pill min-h-9 bg-mint px-3 text-sm tabular-nums" title="Total XP">{xp} XP</span>}
        <button
          type="button"
          aria-label={`Sign out${data ? ` ${data.user.email}` : ""}`}
          onClick={() => void signOut()}
          className="pill grid size-9 place-items-center border-transparent bg-blue text-sm text-[var(--on-ac)]"
        >
          {(data?.user.name || data?.user.email || "?")[0].toUpperCase()}
        </button>
      </nav>
      {signOutFailed && <p role="alert" className="w-full text-right text-sm font-medium text-[var(--bad)]">Couldn't sign out. Check your connection and try again.</p>}
     </div>
    </header>
  );
}
