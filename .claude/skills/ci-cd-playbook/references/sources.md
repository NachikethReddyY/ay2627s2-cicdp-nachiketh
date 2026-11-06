# Sources

Summaries and paraphrases only. Pages were read on 2026-11-06. Several are vendor pages that promote their own products, so product-specific advice was dropped and only tool-neutral practice kept.

| Source | What it contributed |
|---|---|
| Gatling, "CI/CD best practices" | Pipeline as a product; DORA metrics as levers; one release process for all environments; build once; versioned DB migrations; progressive delivery. |
| Graphite, CI/CD best practices guide | Fast builds; reuse workflows; gate deploys with `needs` and `environment`; review run time and cost. Its examples use old Node and action versions, so not copied. |
| JetBrains TeamCity, CI/CD best practices | Commit at least daily; team owns a red build; run the same scripts locally as CI; fastest tests first; refresh environments; never bypass the pipeline; monitor the pipeline itself. |
| Microsoft, CI/CD pipeline guide | Five stages; SAST plus dependency scanning early; 70 to 80% coverage suggestion; DORA benchmark bands; feature flags to limit rollback; phased adoption. |
| Harness, 12 CI/CD best practices | Merge about daily; fix red first; immutable artifact; shared templates; test impact analysis; pipeline as the only route to production; extra metrics (queue time, flakiness, approval wait). |
| Snowflake, understanding CI/CD pipelines | Start small and iterate; document the process; CI vs delivery vs deployment. |
| Vercel, what is a CI/CD pipeline | Gates per stage; build once, promote; test pyramid; blue-green and canary; automated rollback tied to health checks; scope credentials per stage; OWASP CI/CD Top 10 as a security checklist. |
| Vercel, introducing React best practices | Model for this skill's shape: impact-ranked index first, short rules, detail in reference files. |
| skills.sh, `mindrally/skills` `ci-cd-best-practices` | Only the opening was readable: automate everything, fail fast, build once deploy many, infrastructure as code, continuous improvement, security at every stage. The page truncated the rest. |
| skills.sh search page (`?q=ci+cd`) | Results are rendered client-side and came back empty; no skills were listed. |

Not consulted: GitHub's own "Security hardening for GitHub Actions" and the OWASP CI/CD Top 10. Check them before relying on fine details in rule 2.
