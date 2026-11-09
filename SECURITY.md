# Security Policy

LearnSlop is an interactive programming learning tool. This document explains which versions receive security fixes and how to report a vulnerability.

## Supported versions

There are no releases yet. Only the `main` branch is supported. Fixes land on `main`; we do not backport them.

| Version | Supported |
| --- | --- |
| `main` | Yes |
| Any other branch, fork or tag | No |

## Reporting a vulnerability

Please report vulnerabilities privately. Do not open a public issue or pull request, and do not discuss the problem in public until it has been fixed.

The repository is [NachikethReddyY/ay2627s2-cicdp-nachiketh](https://github.com/NachikethReddyY/ay2627s2-cicdp-nachiketh) on GitHub. Use GitHub's private vulnerability reporting:

1. Open the repository's **Security** tab.
2. Choose **Report a vulnerability**.
3. Fill in the form and submit it.

No contact email is published in this repository. Please do not guess an address; use the GitHub form.

## What to include

A good report helps us reproduce and fix the problem quickly. Where you can, include:

- A short description of the issue and its impact.
- The affected component: `apps/api`, `apps/web`, `services/engine`, `services/sandbox`, or a shared package.
- The commit or date of `main` you tested against.
- Step-by-step instructions to reproduce it, or a proof of concept.
- Any logs, requests or screenshots that help. Remove real secrets and personal data first.
- Whether you believe the issue is already being exploited.

## What to expect

We aim to acknowledge reports as soon as practical and to keep you informed as we investigate and fix the issue. This is an intent, not a commitment: no response-time or fix-time SLA is promised. If a report is accepted, we will work on a fix on `main` and may credit you if you wish.

## Scope notes

These areas matter most for this project. Reports about them are especially welcome.

- **Authentication.** Sign-in and sessions use Better Auth. Bypasses, session fixation, privilege escalation or access to another learner's data are in scope.
- **Secrets.** Values such as `ENGINE_TOKEN`, `BETTER_AUTH_SECRET` and `LLM_API_KEY` must never be committed to the repository or shipped to the client. A leaked secret in the repo, its history, a build output or a client bundle is a vulnerability. If you find a real secret, report it privately and do not use it.
- **Answer keys.** Hints, expected output and answer keys are server-side only. Any path that sends them to the client before the learner has answered is a vulnerability.
- **Code execution.** Practice runs and terminals execute learner code in the sandbox (`services/sandbox`). Sandbox escapes or cross-learner access are in scope.
- **Engine access.** The Python engine is called by the API with a shared token. Unauthenticated access to the engine is in scope.

## Testing guidelines

Please test only against your own local or test instance, never against someone else's deployment. Do not access, change or delete data that is not yours, and do not run denial-of-service tests.
