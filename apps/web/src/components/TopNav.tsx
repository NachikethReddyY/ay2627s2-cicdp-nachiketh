import { Link } from "@tanstack/react-router";
import { authClient } from "../lib/auth";

const nav = "pill bg-white px-4 py-1.5 text-sm";

export default function TopNav({ streak, xp }: { streak?: number; xp?: number }) {
  const { data } = authClient.useSession();
  return (
    <header className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-4 py-4 sm:px-6">
      <Link to="/" className="font-display text-3xl font-black tracking-tight">
        Learn<span className="text-blue">Quest</span>
      </Link>
      <nav aria-label="Main" className="flex flex-wrap items-center gap-2 sm:gap-3">
        <Link to="/" className={nav} activeOptions={{ exact: true }} activeProps={{ className: "pill bg-sun px-4 py-1.5 text-sm" }}>Home</Link>
        <Link to="/explore" className={nav} activeProps={{ className: "pill bg-sun px-4 py-1.5 text-sm" }}>Explore</Link>
        {streak !== undefined && <span className="pill bg-pink px-3 py-1.5 text-sm" title="Day streak">🔥 {streak}</span>}
        {xp !== undefined && <span className="pill bg-mint px-3 py-1.5 text-sm" title="Total XP">{xp} XP</span>}
        <button
          type="button"
          aria-label={`Sign out${data ? ` ${data.user.email}` : ""}`}
          onClick={() => void authClient.signOut().finally(() => location.assign("/"))}
          className="pill grid size-9 place-items-center bg-lilac text-sm"
        >
          {(data?.user.name || data?.user.email || "?")[0].toUpperCase()}
        </button>
      </nav>
    </header>
  );
}
