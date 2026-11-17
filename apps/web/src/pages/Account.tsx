import { Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { authClient } from "../lib/auth";
import { useApi } from "../lib/api";
import { trpc } from "../lib/trpc";
import { Logo } from "./landing/Logo";
import "./home.css";

export default function Account() {
  const { data } = authClient.useSession();
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);
  const { data: home, reload } = useApi("home", () => trpc.home.get.query());
  const optedIn = home?.leaderboard.optedIn ?? false;

  async function signOut() {
    setError(null);
    try {
      const { error } = await authClient.signOut();
      if (error) throw error;
      void navigate({ to: "/login" });
    } catch {
      setError("Sign out failed. Check your connection and try again.");
    }
  }

  async function setOptIn(next: boolean) {
    setError(null);
    try {
      await trpc.me.update.mutate({ leaderboardOptIn: next });
      reload();
    } catch {
      setError("Couldn't save your choice. Check your connection and try again.");
    }
  }

  return (
    <div className="lq lq-moon">
      <header className="lq-topbar">
        <Link to="/" className="lq-logo"><Logo /></Link>
        <nav className="lq-topnav" aria-label="Main">
          <Link to="/" className="lq-topnav-link">Home</Link>
          <Link to="/explore" className="lq-topnav-link">Explore</Link>
          <Link to="/account" className="lq-topnav-link" aria-current="page">Account</Link>
        </nav>
      </header>
      <main className="lq-wrap" style={{ maxWidth: 520 }}>
        <h1 className="lq-hero-title" style={{ marginBottom: 20 }}>Account</h1>
        <section className="lq-card" style={{ padding: 28, display: "flex", flexDirection: "column", gap: 20 }} aria-labelledby="account-h">
          <h2 id="account-h" style={{ fontSize: 16 }}>Signed in as</h2>
          <p className="lq-unit" style={{ fontSize: 16, color: "var(--tx)", wordBreak: "break-all" }}>{data?.user.email ?? "Not signed in"}</p>
          <div>
            <button type="button" onClick={() => void signOut()} className="lq-btn lq-btn-surface">Sign out</button>
          </div>
        </section>
        <section className="lq-card" style={{ padding: 28, display: "flex", flexDirection: "column", gap: 14, marginTop: 20 }} aria-labelledby="board-h">
          <h2 id="board-h" style={{ fontSize: 16 }}>Weekly XP leaderboard</h2>
          <p className="lq-unit">Your name and your XP from the last 7 days appear on the weekly leaderboard for everyone. On by default; turn it off to hide them.</p>
          <label style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 15, cursor: home ? "pointer" : "progress" }}>
            <input type="checkbox" checked={optedIn} disabled={!home} onChange={(e) => void setOptIn(e.target.checked)} />
            <span>Show me on the weekly XP leaderboard</span>
          </label>
        </section>
        {error && <p role="alert" style={{ color: "var(--bad)", fontSize: 14, marginTop: 16 }}>{error}</p>}
      </main>
    </div>
  );
}
