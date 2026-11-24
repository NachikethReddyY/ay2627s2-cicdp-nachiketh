import { useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { usePostHog } from "@posthog/react";
import { authClient } from "./auth";

export function useSignOut() {
  const posthog = usePostHog();
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);
  const [signingOut, setSigningOut] = useState(false);

  async function signOut() {
    if (signingOut) return;
    setError(null);
    setSigningOut(true);
    try {
      const result = await authClient.signOut();
      if (result.error) throw result.error;
      posthog?.reset();
      await navigate({ to: "/login" });
    } catch {
      setError("Sign out failed. Check your connection and try again.");
    } finally {
      setSigningOut(false);
    }
  }

  return { signOut, signingOut, error };
}
