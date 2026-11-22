import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Locator, type Page } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import pg from "pg";

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
  await page.goto("/login");
  await page.getByRole("button", { name: "Create account", exact: true }).click();
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.locator('form button[type="submit"]').click();
  await page.waitForURL((url) => url.pathname === "/");
  await page.goto(next);
}

test("signs up, lands on home, and stays signed in on /play after reload", async ({ page }) => {
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

  await page.locator(`a.lesson-hit[href*="lesson=${LESSON}"]`).click();
  await page.locator(`a.lesson-pop-btn[href*="lesson=${LESSON}"]`).click();
  await expect(page).toHaveURL(new RegExp(`lesson=${LESSON}`));
  const check = page.getByRole("button", { name: "Check" });
  await expect(check).toBeDisabled();
  await expect(page.getByRole("heading", { name: "Correct!" })).toHaveCount(0);

  await page.getByLabel(CORRECT_OPTION).check();
  await check.click();
  await expect(page.getByRole("heading", { name: "Correct!" })).toBeVisible();

  const pool = new pg.Pool({ connectionString: process.env.E2E_DATABASE_URL });
  try {
    const { rows } = await pool.query<{ kind: string; correct: boolean; response: null; feedback: null }>(
      `select a.kind, a.correct, a.response, a.feedback
         from attempts a
         join learners l on l.id = a.learner_id
         join "user" u on u.id = l.user_id
        where u.email = $1 and a.step_id = $2`,
      [email, FIRST_STEP_ID],
    );
    expect(rows).toEqual([{ kind: "mcq", correct: true, response: null, feedback: null }]);
  } finally {
    await pool.end();
  }
});

test("opens a scrim's lab at /editor with its starter code and no hidden answers", async ({ page }) => {
  await signUp(page, newEmail(), "/");
  const lesson = page.waitForResponse((res) => res.url().includes("lessons.get") && res.ok());
  await page.goto("/editor?lesson=scrim-return-values");
  const body = await (await lesson).text();
  expect(body).toContain("hidden case 1");
  expect(body).not.toContain("-14");
  await expect(page.getByText("Write double(n) so it returns n times 2.").first()).toBeVisible();
  await expect(page.getByRole("button", { name: "Submit" })).toBeEnabled();
  await expect(page.locator(".view-lines").first()).toContainText("function double(n)");
});

test("a scrim keeps later code hidden until its prediction and shows the updated replay", async ({ page }) => {
  await signUp(page, newEmail(), "/play?lesson=scrim-return-values&course=scrim-demo");
  await expect(page.getByRole("heading", { name: "What a function gives back" })).toBeVisible();
  await page.getByRole("button", { name: "Next part" }).click();
  await expect(page.getByRole("region", { name: "Predict" })).toBeVisible();
  await expect(page.locator(".view-lines").first()).not.toContainText("return a + b");
  await page.getByLabel("undefined, because nothing is returned").check();
  await page.getByRole("button", { name: "Check", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Correct!" })).toBeVisible();
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.getByRole("region", { name: "Predict" })).toHaveCount(0);
  await page.getByRole("button", { name: "Next part" }).click();
  await page.getByRole("button", { name: "Next part" }).click();
  await expect(page.locator(".view-lines").first()).toContainText("return a + b");
});

test("a lesson with no lab says so at /editor", async ({ page }) => {
  await signUp(page, newEmail(), `/editor?lesson=${LESSON}`);
  await expect(page.getByText("so it has no lab", { exact: false })).toBeVisible();
});

const SIGNED_OUT_PAGES: [string, (page: Page) => Locator][] = [
  ["/", (page) => page.getByRole("heading", { level: 1, name: /Guess the next line/ })],
  ["/login", (page) => page.getByRole("heading", { name: "Sign in", exact: true })],
];
const SIGNED_IN_PAGES: [string, (page: Page) => Locator][] = [
  ["/play", (page) => page.getByText("Pick a lesson to start.")],
  ["/editor", (page) => page.getByText("Pick a lesson to open its lab.")],
  [`/courses/${COURSE}`, (page) => page.getByRole("heading", { name: "Shopping Cart Basics" })],
  ["/explore", (page) => page.locator("ul.explore-list h2").first()],
];

async function expectNoSeriousA11yViolations(page: Page, path: string, ready: Locator) {
  await page.goto(path);
  expect(new URL(page.url()).pathname, `landed on ${page.url()}`).toBe(path);
  await expect(ready, `seeded content on ${path}`).toBeVisible();
  await expect(page.getByText("Couldn't load", { exact: false })).toHaveCount(0);
  await page.waitForLoadState("networkidle");
  const { violations } = await new AxeBuilder({ page }).analyze();
  const blocking = violations.filter((v) => v.impact === "serious" || v.impact === "critical");
  expect(
    blocking.map((v) => ({
      id: v.id,
      impact: v.impact,
      help: v.help,
      nodes: v.nodes.map((node) => ({ target: node.target, html: node.html, failureSummary: node.failureSummary })),
    })),
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

test("a step with no narration audio is spoken with browser speech on reveal", async ({ page }) => {
  await page.addInitScript(() => {
    const spoken: string[] = [];
    const calls: string[] = [];
    (globalThis as unknown as { __spoken: string[]; __calls: string[] }).__spoken = spoken;
    (globalThis as unknown as { __calls: string[] }).__calls = calls;
    class FakeUtterance {
      volume = 1;
      onend: (() => void) | null = null;
      onerror: (() => void) | null = null;
      text: string;
      constructor(text: string) {
        this.text = text;
      }
    }
    Object.defineProperty(globalThis, "SpeechSynthesisUtterance", { value: FakeUtterance, configurable: true });
    Object.defineProperty(globalThis, "speechSynthesis", {
      configurable: true,
      value: {
        speak: (u: { text: string }) => spoken.push(u.text),
        cancel() {},
        pause: () => calls.push("pause"),
        resume: () => calls.push("resume"),
      },
    });
  });
  await signUp(page, newEmail(), `/courses/${COURSE}`);
  await page.locator(`a.lesson-hit[href*="lesson=${LESSON}"]`).click();
  await page.locator(`a.lesson-pop-btn[href*="lesson=${LESSON}"]`).click();
  await expect(page.getByRole("button", { name: "Mute" })).toHaveCount(0);
  await page.getByLabel(CORRECT_OPTION).check();
  await page.getByRole("button", { name: "Check" }).click();
  await expect(page.getByRole("heading", { name: "Correct!" })).toBeVisible();

  await expect(page.getByRole("button", { name: "Mute" })).toBeVisible();
  const spoken = () => page.evaluate(() => (globalThis as unknown as { __spoken: string[] }).__spoken.join(" "));
  const file = JSON.parse(readFileSync(new URL("../../worlds/codequest/lessons/lesson-1.json", import.meta.url), "utf8")) as {
    steps: { id: string; secret: { narration: string } }[];
  };
  const narration = file.steps.find((st) => st.id === FIRST_STEP_ID)!.secret.narration;
  const firstSentence = narration.match(/.+?[.!?](?=\s|$)/s)![0].trim();
  await expect.poll(spoken).toBe(firstSentence);

  await expect(page.getByRole("button", { name: "Pause" })).toBeVisible();
  const lastToggle = () =>
    page.evaluate(() => (globalThis as unknown as { __calls: string[] }).__calls.at(-1));
  await expect.poll(lastToggle).toBe("resume");
});
