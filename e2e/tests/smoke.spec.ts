import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Locator, type Page } from "@playwright/test";
import { randomUUID } from "node:crypto";
import pg from "pg";

// Seeded by apps/api/src/db/seed.ts: course "codequest", lesson "lesson-1", whose first step is an MCQ.
const COURSE = "codequest";
const LESSON = "lesson-1";
const FIRST_STEP_ID = "s1";
const CORRECT_OPTION = "reduce, with the sum starting at 0";
const PASSWORD = "e2e-password-123";

const newEmail = () => `e2e-${randomUUID()}@example.test`;

if (!process.env.E2E_DATABASE_URL) {
  throw new Error("E2E_DATABASE_URL is required. Run the suite with `pnpm --filter @learnquest/e2e run ci`.");
}

async function signUp(page: Page, email: string, next: string) {
  await page.goto(`/login?redirect=${encodeURIComponent(next)}`);
  await page.getByRole("button", { name: "Create account", exact: true }).click();
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(PASSWORD);
  // The mode toggle sits inside the same form, so target the submit button by type.
  await page.locator('form button[type="submit"]').click();
  await page.waitForURL((url) => url.pathname === next);
}

test("signs up, lands on /play, and stays signed in after reload", async ({ page }) => {
  const email = newEmail();
  await signUp(page, email, "/play");
  await expect(page.getByText("Pick a lesson to start.")).toBeVisible();

  await page.reload();
  await expect(page).toHaveURL(/\/play$/);
  await expect(page.getByText("Pick a lesson to start.")).toBeVisible();

  const session = await page.request.get("/api/auth/get-session");
  expect(session.ok()).toBe(true);
  expect((await session.json()).user.email).toBe(email);
});

test("answers a seeded quiz step: feedback comes from the server and the attempt is saved", async ({ page }) => {
  const email = newEmail();
  await signUp(page, email, `/courses/${COURSE}`);
  await expect(page.getByRole("heading", { name: "Shopping Cart Basics" })).toBeVisible();

  // A mouse click on a lesson node opens its popover; the popover's button goes to the lesson.
  await page.locator(`a.lesson-hit[href*="lesson=${LESSON}"]`).click();
  await page.locator(`a.lesson-pop-btn[href*="lesson=${LESSON}"]`).click();
  await expect(page).toHaveURL(new RegExp(`lesson=${LESSON}`));
  const check = page.getByRole("button", { name: "Check" });
  await expect(check).toBeDisabled();
  // Predict before reveal: no answer is shown until the learner has submitted one.
  await expect(page.getByRole("heading", { name: "Correct!" })).toHaveCount(0);

  await page.getByLabel(CORRECT_OPTION).check();
  await check.click();
  await expect(page.getByRole("heading", { name: "Correct!" })).toBeVisible();

  const pool = new pg.Pool({ connectionString: process.env.E2E_DATABASE_URL });
  try {
    const { rows } = await pool.query<{ kind: string; correct: boolean; feedback: string }>(
      `select a.kind, a.correct, a.feedback #>> '{}' as feedback
         from attempts a
         join learners l on l.id = a.learner_id
         join "user" u on u.id = l.user_id
        where u.email = $1 and a.step_id = $2`,
      [email, FIRST_STEP_ID],
    );
    expect(rows).toEqual([{ kind: "mcq", correct: true, feedback: "Correct!" }]);
  } finally {
    await pool.end();
  }
});

// Each page is scanned only once its seeded content is on screen, so axe never reads a loading or error state.
// Signed-out pages first; the rest sit behind the session guard, so each gets its own account.
const SIGNED_OUT_PAGES: [string, (page: Page) => Locator][] = [
  ["/", (page) => page.getByRole("heading", { name: "Learn code by guessing first." })],
  ["/login", (page) => page.getByRole("heading", { name: "Sign in", exact: true })],
];
const SIGNED_IN_PAGES: [string, (page: Page) => Locator][] = [
  ["/play", (page) => page.getByText("Pick a lesson to start.")],
  [`/courses/${COURSE}`, (page) => page.getByRole("heading", { name: "Shopping Cart Basics" })],
  ["/explore", (page) => page.locator("h2.explore-col-h").first()],
];

async function expectNoSeriousA11yViolations(page: Page, path: string, ready: Locator) {
  await page.goto(path);
  // A lost session redirects to /login; scanning that page would pass the wrong check.
  expect(new URL(page.url()).pathname, `landed on ${page.url()}`).toBe(path);
  await expect(ready, `seeded content on ${path}`).toBeVisible();
  // A failed query keeps the URL and the heading, so the error text is checked on its own.
  await expect(page.getByText("Couldn't load", { exact: false })).toHaveCount(0);
  await page.waitForLoadState("networkidle");
  const { violations } = await new AxeBuilder({ page }).analyze();
  const blocking = violations.filter((v) => v.impact === "serious" || v.impact === "critical");
  expect(
    blocking.map((v) => ({ id: v.id, impact: v.impact, nodes: v.nodes.length, help: v.help })),
    `serious or critical axe violations on ${path}`,
  ).toEqual([]);
}

for (const [path, ready] of SIGNED_OUT_PAGES) {
  test(`axe: no serious or critical violations on ${path}`, async ({ page }) => {
    await expectNoSeriousA11yViolations(page, path, ready(page));
  });
}

for (const [path, ready] of SIGNED_IN_PAGES) {
  test(`axe: no serious or critical violations on ${path} (signed in)`, async ({ page }) => {
    await signUp(page, newEmail(), path);
    await expectNoSeriousA11yViolations(page, path, ready(page));
  });
}
