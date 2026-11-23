import { Logo } from "./landing/Logo";
import HandleForm, { type HandleProfile } from "./HandleForm";
import "./home.css";

export default function Onboarding({ profile, next }: { profile: HandleProfile; next: string }) {
  return (
    <div className="lq lq-moon">
      <header className="lq-topbar">
        <div className="lq-logo"><Logo /></div>
      </header>
      <main className="mx-auto w-full max-w-[520px] px-5 py-12 sm:py-20">
        <section className="lq-card grid gap-5 p-6 sm:p-8" aria-labelledby="onboarding-heading">
          <h1 id="onboarding-heading" className="text-3xl">Choose your public handle</h1>
          <HandleForm profile={profile} onContinue={() => location.replace(next)} />
        </section>
      </main>
    </div>
  );
}
