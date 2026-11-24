import { Link } from "@tanstack/react-router";
import { authClient } from "../lib/auth";
import { useSignOut } from "../lib/useSignOut";
import { Logo } from "./landing/Logo";
import HandleForm, { type HandleProfile } from "./HandleForm";
import "./home.css";

export default function Account({ profile }: { profile: HandleProfile }) {
  const { data, error: sessionError, isPending, refetch } = authClient.useSession();
  const { signOut, signingOut, error } = useSignOut();

  return (
    <div className="lq lq-moon">
      <header className="lq-topbar">
        <Link to="/" className="lq-logo"><Logo /></Link>
        <nav className="lq-topnav" aria-label="Main">
          <Link to="/" className="lq-topnav-link">Home</Link>
          <Link to="/explore" className="lq-topnav-link">Explore</Link>
          <Link to="/account" className="lq-topnav-link" aria-current="page">Account</Link>
          {profile.isAdmin && <Link to="/admin" className="lq-topnav-link">Admin</Link>}
        </nav>
      </header>
      <main className="lq-wrap" style={{ maxWidth: 520 }}>
        <h1 className="lq-hero-title" style={{ marginBottom: 20 }}>Account</h1>
        <section className="lq-card mb-5 grid gap-4 p-7" aria-labelledby="account-profile">
          <h2 id="account-profile" className="text-lg">Profile</h2>
          <HandleForm profile={profile} />
        </section>
        <section className="lq-card" style={{ padding: 28, display: "flex", flexDirection: "column", gap: 20 }} aria-labelledby="account-h">
          <h2 id="account-h" style={{ fontSize: 16 }}>Signed in as</h2>
          {sessionError ? (
            <div>
              <p role="alert">Couldn't load your account.</p>
              <button type="button" className="lq-btn lq-btn-surface" onClick={() => void refetch()} disabled={isPending}>Try again</button>
            </div>
          ) : (
            <>
              <p className="lq-unit" style={{ fontSize: 16, color: "var(--tx)", wordBreak: "break-all" }}>{isPending ? "Loading account…" : data?.user.email ?? "Not signed in"}</p>
              {data && <div><button type="button" onClick={() => void signOut()} className="lq-btn lq-btn-surface" disabled={signingOut}>{signingOut ? "Signing out…" : "Sign out"}</button></div>}
            </>
          )}
        </section>
        {error && <p role="alert" style={{ color: "var(--bad)", fontSize: 14, marginTop: 16 }}>{error}</p>}
      </main>
    </div>
  );
}
