import { Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { authClient } from "../lib/auth";
import { Logo } from "./landing/Logo";
import "./home.css";

export default function Account() {
  const { data } = authClient.useSession();
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);

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
        {error && <p role="alert" style={{ color: "var(--bad)", fontSize: 14, marginTop: 16 }}>{error}</p>}
      </main>
    </div>
  );
}
