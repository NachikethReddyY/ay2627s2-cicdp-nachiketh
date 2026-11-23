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

async function createAccount(page: Page, email: string) {
  await page.goto("/login");
  await page.getByRole("button", { name: "Create account", exact: true }).click();
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.locator('form button[type="submit"]').click();
  await expect(page).toHaveURL(/\/onboarding$/);
  await expect(page.getByRole("textbox", { name: "Public handle" })).toHaveValue(/^learner_[0-9a-f]{10}$/);
}

async function signUp(page: Page, email: string, next: string) {
  await createAccount(page, email);
  await page.getByRole("button", { name: "Continue to LearnSlop" }).click();
  await page.waitForURL((url) => url.pathname === "/");
  await page.goto(next);
}

async function checkAdminSpend(page: Page, email: string) {
  await page.goto("/admin");
  await expect(page.getByRole("heading", { name: "Admin access required" })).toBeVisible();

  const pool = new pg.Pool({ connectionString: process.env.E2E_DATABASE_URL });
  try {
    await pool.query('UPDATE learners SET is_admin = true WHERE user_id = (SELECT id FROM "user" WHERE email = $1)', [email]);
    await pool.query("INSERT INTO ai_call_spend (prompt_tokens, completion_tokens, estimated_usd) VALUES (42, 4, 0.0123)");
    await page.goto("/account");
    await page.getByRole("link", { name: "Admin", exact: true }).click();
    await expect(page.getByRole("heading", { name: "AI spend", exact: true })).toBeVisible();
    const month = page.getByRole("row", { name: /Month to date/ });
    await expect(month.getByRole("cell")).toHaveText(["1", "42", "4", "46", "$0.0123"]);
    await expect(page.getByRole("row", { name: /^\d{4}-\d{2}-\d{2}/ }).getByRole("cell")).toHaveText(["1", "42", "4", "46", "$0.0123"]);
  } finally {
    await pool.query('UPDATE learners SET is_admin = false WHERE user_id = (SELECT id FROM "user" WHERE email = $1)', [email]);
    await pool.query("DELETE FROM ai_call_spend WHERE prompt_tokens = 42 AND completion_tokens = 4 AND estimated_usd = 0.0123");
    await pool.end();
  }
}

test("signs up, confirms and edits a public handle, and stays signed in on /play", async ({ page }) => {
  const email = newEmail();
  await page.goto("/admin");
  await expect(page).toHaveURL(/\/login\?/);
  await createAccount(page, email);
  await page.goto("/");
  await expect(page).toHaveURL(/\/onboarding$/);
  await expect(page.getByText("Everyone can see your handle and XP on the weekly leaderboard.", { exact: false })).toBeVisible();
  const handle = `coder_${randomUUID().slice(0, 8)}`;
  const input = page.getByRole("textbox", { name: "Public handle" });
  const submit = page.getByRole("button", { name: "Continue to LearnSlop" });
  await input.fill("me@example.test");
  await submit.click();
  await expect(page.getByRole("alert")).toContainText("without an email");
  await input.fill(handle);
  await submit.click();
  await expect(page.getByRole("heading", { name: "Home", exact: true })).toBeAttached();
  await page.getByRole("link", { name: "Account settings" }).click();
  await expect(input).toHaveValue(handle);
  await expect(input).not.toBeEditable();
  await expect(page.getByText("You can change your handle again on", { exact: false })).toBeVisible();

  const pool = new pg.Pool({ connectionString: process.env.E2E_DATABASE_URL });
  try {
    await pool.query(`UPDATE learners SET handle_updated_at = now() - interval '31 days'
      WHERE user_id = (SELECT id FROM "user" WHERE email = $1)`, [email]);
  } finally {
    await pool.end();
  }
  await page.reload();
  const newHandle = `${handle}_js`;
  await input.fill(newHandle);
  await page.getByRole("button", { name: "Save handle" }).click();
  await expect(page.getByRole("status")).toHaveText("Public handle saved.");
  await page.reload();
  await expect(input).toHaveValue(newHandle);
  await page.goto("/onboarding");
  await expect(page).toHaveURL(/\/$/);

  await page.goto("/play");
  await expect(page.getByText("Pick a lesson to start.")).toBeVisible();
  await page.reload();
  await expect(page).toHaveURL(/\/play$/);
  await expect(page.getByText("Pick a lesson to start.")).toBeVisible();

  const session = await page.request.get("/api/auth/get-session");
  expect(session.ok()).toBe(true);
  expect((await session.json()).user.email).toBe(email);

  await test.step("AI spend is visible only to admins and shows aggregate totals", () => checkAdminSpend(page, email));

  await test.step("phone Home shows progress and offers Explore or one-click resume", async () => {
    await page.setViewportSize({ width: 375, height: 667 });
    await page.goto("/");
    const empty = page.getByRole("region", { name: "Find your first path" });
    await expect(empty.getByRole("link", { name: "Explore paths" })).toHaveAttribute("href", "/explore");
    const progress = page.getByRole("region", { name: "Your progress" });
    await expect(progress).toBeInViewport({ ratio: 1 });
    await expect(progress).toContainText("No path yet");
    await expectNoSeriousA11yViolations(page, "/", empty);

    await page.getByRole("button", { name: "Start JavaScript Foundations" }).click();
    await expect(progress).toContainText(/0 \/ \d+ lessons/);
    const attempt = await page.request.post("/api/trpc/steps.attempt", { data: {
      id: FIRST_STEP_ID,
      answer: { kind: "mcq", choice: 1 },
    } });
    expect(attempt.ok()).toBe(true);
    await page.reload();
    const resume = page.getByRole("link", { name: /^(Continue|Resume )/ }).and(page.locator('a[href*="lesson=lesson-1&"]'));
    await expect(resume).toHaveAttribute("href", /lesson=lesson-1/);
    await expect(resume).toBeInViewport({ ratio: 1 });
    await expect(progress.getByText("Total XP")).toBeInViewport();
    expect(await page.evaluate("document.documentElement.scrollWidth")).toBe(375);
    await expectNoSeriousA11yViolations(page, "/", resume);
    await resume.click();
    await expect(page).toHaveURL(/lesson=lesson-1/);
    await expect(page.getByText("Step 2 of 3", { exact: true })).toBeVisible();
  });
});

test("a wrong prediction updates Continue to show a review and its reason", async ({ page }) => {
  const email = newEmail();
  await signUp(page, email, "/");
  await page.getByRole("button", { name: "Start JavaScript Foundations" }).click();
  const card = page.getByRole("region").filter({ hasText: "Up next" });
  await expect(card.getByRole("link", { name: "Continue" })).toBeVisible();
  await expect(card).toContainText("Pre-test");
  const writes: string[] = [];
  page.on("request", (request) => {
    if (request.url().includes("/api/trpc/lessons.write")) writes.push(request.url());
  });
  await card.getByRole("link", { name: "Continue" }).click();
  await expect(page).toHaveURL(/lesson=codequest-pretest/);
  await page.getByRole("radio", { name: "4", exact: true }).check();
  expect(writes).toEqual([]);
  await page.getByRole("button", { name: "Check" }).click();
  await expect(page.getByRole("heading", { name: "Correct!" })).toBeVisible();
  await page.goto("/");
  await expect(page.getByRole("row", { name: /functions Correct/ })).toBeVisible();

  await page.goto(`/courses/${COURSE}`);
  await expect(page.getByRole("heading", { name: "Shopping Cart Basics" })).toBeVisible();
  await page.locator(`a.lesson-hit[href*="lesson=${LESSON}"]`).click();
  await page.locator(`a.lesson-pop-btn[href*="lesson=${LESSON}"]`).click();
  await expect(page).toHaveURL(new RegExp(`lesson=${LESSON}`));
  await expect(page.getByRole("button", { name: "Check" })).toBeDisabled();
  await page.getByText("A for loop that pushes each price into a new array", { exact: true }).click();
  await page.getByRole("button", { name: "Check" }).click();
  await expect(page.getByText("Not quite. Take a hint to try again.", { exact: true })).toBeVisible();

  await page.goto("/");
  await expect(card.getByRole("link", { name: "Review" })).toBeVisible();
  await expect(card.locator(".lq-hero-reason")).toContainText(/is at \d+%\. Review this concept/);
  await expect(page.getByRole("heading", { name: "What you know" })).toBeVisible();

  await card.getByRole("link", { name: "Review" }).click();
  await page.getByRole("button", { name: "Hint", exact: true }).click();
  await page.getByRole("radio", { name: CORRECT_OPTION, exact: true }).check();
  await page.getByRole("button", { name: "Check" }).click();
  await expect(page.getByRole("heading", { name: "Correct!" })).toBeVisible();
  await page.goto("/");
  await expect(card.getByRole("link", { name: "Review" })).toHaveAttribute("href", "/review/codequest");
  await card.getByRole("link", { name: "Review" }).click();
  await expect(page.getByRole("heading", { name: "Review array reduce" })).toBeVisible();
  await expect(page.getByRole("status")).toHaveCount(0);
  await page.getByRole("radio", { name: CORRECT_OPTION, exact: true }).check();
  await page.getByRole("button", { name: "Check" }).click();
  await expect(page.getByRole("status")).toContainText("Correct!");

  const pool = new pg.Pool({ connectionString: process.env.E2E_DATABASE_URL });
  try {
    const { rows } = await pool.query<{ observed: boolean; correct: boolean; hints_used: number }>(
      `select a.observed, a.correct, a.hints_used
         from attempts a
         join learners l on l.id = a.learner_id
         join "user" u on u.id = l.user_id
        where u.email = $1 and a.step_id = $2
        order by a.created_at`,
      [email, FIRST_STEP_ID],
    );
    expect(rows).toEqual([
      { observed: true, correct: false, hints_used: 0 },
      { observed: false, correct: true, hints_used: 1 },
    ]);
  } finally {
    await pool.end();
  }
});


test("practice workbench opens the scrim lab, runs code, lints, and submits", async ({ page }) => {
  await page.routeWebSocket(/\/api\/sandbox\/shell/, (ws) => ws.close({ code: 4503, reason: "Sandbox busy" }));
  let ran = false;
  let submitted = false;
  await page.route("**/api/sandbox/run", async (route) => {
    expect(route.request().postDataJSON().code).toContain("function double");
    ran = true;
    await route.fulfill({ json: { id: "run-1" } });
  });
  await page.route("**/api/sandbox/run/run-1?*", (route) => route.fulfill({ json: { output: "Practice output", next: 15, done: true } }));
  await page.route("**/api/practice/lint", (route) => route.fulfill({ json: {
    findings: [{ ruleId: "style-example", line: 1, column: 1, message: "Example style finding" }],
  } }));
  const cards = [
    { type: "hint", title: "Follow the value", body: "Trace `double` from the call site." },
    { type: "steps", title: "Trace a call", items: ["Choose a sample input.", "Follow the value back to the caller."] },
    { type: "question", text: "What value do you expect the caller to receive?" },
  ];
  let guideTurn = 0;
  await page.route("**/api/guide/chat", async (route) => {
    const input = route.request().postDataJSON();
    expect(input.lessonId).toEqual(expect.any(String));
    if (guideTurn++ === 0) {
      expect(input.finding).toEqual({ ruleId: "style-example", line: 1, column: 1 });
      await route.fulfill({ json: { guide: { message: "Start at the call site.", widgets: cards } } });
      return;
    }
    expect(input.messages).toContainEqual({ role: "assistant", content: "Start at the call site.", widgets: cards });
    expect(input.messages.at(-1)).toEqual({ role: "user", content: "I think nothing gets back to the caller. Why?" });
    await route.fulfill({ json: { guide: { message: "You traced the call. Now look at how the function ends.", widgets: [] } } });
  });
  await page.route("**/api/sandbox/check", async (route) => {
    const input = route.request().postDataJSON();
    expect(input).toMatchObject({ lessonId: "scrim-return-values", language: "javascript" });
    expect(input.code).toContain("function double");
    submitted = true;
    await route.fulfill({ json: {
      complete: true, points: 4, maxPoints: 4, required: { passed: 4, total: 4 },
      stretch: { passed: 0, total: 0 }, best: { points: 4, maxPoints: 4 }, attemptCount: 1,
      results: ["two", "five", "hidden-1", "hidden-2"].map((id, index) => ({
        id, name: id, stretch: false, visibility: index < 2 ? "sample" : "hidden", status: "pass",
      })),
    } });
  });
  await signUp(page, newEmail(), "/");
  await page.goto("/editor?lesson=scrim-return-values");
  await expect(page.getByRole("status")).toContainText("Finish the scrim predictions to unlock the lab.");
  await expect(page.getByRole("button", { name: "Submit" })).toHaveCount(0);
  await page.getByRole("link", { name: "Open the lesson" }).click();
  await page.getByRole("button", { name: "Next part" }).click();
  await page.getByLabel("undefined, because nothing is returned").check();
  await page.getByRole("button", { name: "Check", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Correct!" })).toBeVisible();
  const lesson = page.waitForResponse((res) => res.url().includes("lessons.get") && res.ok());
  await page.goto("/editor?lesson=scrim-return-values");
  const body = await (await lesson).text();
  expect(body).toContain("hidden case 1");
  expect(body).not.toContain(JSON.stringify("-14"));
  expect(body).not.toContain("expectedStdout");
  await expect(page.getByText("Write double(n) so it returns n times 2.").first()).toBeVisible();
  await expect(page.getByRole("button", { name: "Submit" })).toBeEnabled();
  await expect(page.locator(".view-lines").first()).toContainText("function double(n)");
  await expect(page.getByRole("button", { name: "Watch", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Source control", exact: true })).toHaveCount(0);

  await page.getByRole("button", { name: "Run", exact: true }).click();
  await expect(page.locator('pre[aria-label="Output"]')).toContainText("Practice output");
  expect(ran).toBe(true);

  await page.getByRole("button", { name: "Lint", exact: true }).click();
  await expect(page.getByRole("button", { name: "Results", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByText("Example style finding", { exact: true })).toBeVisible();
  await expect(page.locator(".squiggly-warning").first()).toBeVisible();
  await page.getByRole("button", { name: "Ask Sloppy about line 1: style-example" }).click();
  const sloppy = page.getByRole("region", { name: "AI learning guide" });
  await expect(sloppy.getByText("Follow the value", { exact: true })).toBeVisible();
  await expect(sloppy.getByText("Trace double from the call site.")).toBeVisible();
  await expect(sloppy.locator("code")).toHaveText("double");
  const steps = sloppy.getByRole("list");
  await expect(steps.getByRole("listitem")).toHaveText(["Choose a sample input.", "Follow the value back to the caller."]);
  await expect(steps).toHaveCSS("list-style-type", "decimal");
  await expect(sloppy.getByText("What value do you expect the caller to receive?")).toBeVisible();
  await sloppy.getByRole("textbox", { name: "Ask about this code" }).fill("I think nothing gets back to the caller. Why?");
  await sloppy.getByRole("button", { name: "Send" }).click();
  await expect(sloppy.getByText("You traced the call. Now look at how the function ends.")).toBeInViewport();
  await page.getByRole("button", { name: "Submit", exact: true }).click();
  await expect(page.getByText("Level complete! Every required test passed.", { exact: true })).toBeVisible();
  expect(submitted).toBe(true);

  await page.locator(".view-lines").first().click();
  await page.keyboard.type(" ");
  await expect(page.getByText("Level complete! Every required test passed.", { exact: true })).toHaveCount(0);
  await expect(page.locator(".squiggly-warning")).toHaveCount(0);
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

test("a lesson with no lab can open a temporary Watch workspace", async ({ page }) => {
  await signUp(page, newEmail(), `/editor?lesson=${LESSON}`);
  await expect(page.getByText("so it has no lab", { exact: false })).toBeVisible();
  await page.emulateMedia({ reducedMotion: "reduce" });
  const start = 'console.log("start");';
  const end = 'console.log("end");';
  const edited = 'console.log("fork");';
  await page.route("**/api/trpc/lessons.write?*", (route) =>
    route.fulfill({ json: [{ result: { data: { ok: true } } }] }));
  await page.route("**/api/trpc/lessons.get?*", (route) => route.fulfill({
    json: [{ result: { data: {
      id: "watch-fork",
      versionId: "v1",
      title: "Watch a log change",
      kind: "watch",
      part: {
        kind: "watch",
        beforeFiles: { "main.js": start, "notes.txt": "A note" },
        hunks: [{ id: "log", file: "main.js", oldStart: 1, lines: [`-${start}`, `+${end}`] }],
      },
      steps: [],
      completed: true,
      canUpgradeReadChecks: false,
      media: [],
    } } }],
  }));
  const runId = randomUUID();
  await page.route("**/api/sandbox/run", (route) => {
    expect(route.request().postDataJSON()).toEqual({ code: edited, language: "javascript" });
    return route.fulfill({ json: { id: runId } });
  });
  await page.route(`**/api/sandbox/run/${runId}?*`, (route) =>
    route.fulfill({ json: { output: "fork\n", next: 5, done: true } }));
  await page.goto("/play?lesson=watch-fork");
  await expect(page.locator(".monaco-editor .view-lines")).toContainText(end);
  const edit = page.getByRole("button", { name: "Edit from here" });
  await edit.click();
  const fork = page.getByRole("dialog", { name: "Replay workspace" });
  await expect(fork.locator(".view-lines")).toContainText(end);
  await fork.getByLabel("File", { exact: true }).selectOption("notes.txt");
  await expect(fork.getByRole("button", { name: "Run", exact: true })).toBeDisabled();
  await fork.getByLabel("File", { exact: true }).selectOption("main.js");
  await fork.locator(".view-lines").click();
  await page.keyboard.press("End");
  await page.keyboard.press("Shift+Home");
  await page.keyboard.insertText(edited);
  await expect(fork.locator(".view-lines")).toContainText(edited);
  await fork.getByRole("button", { name: "Run", exact: true }).click();
  await expect(fork.getByRole("region", { name: "Terminal" })).toContainText("fork");
  await fork.getByRole("button", { name: "Back to replay" }).click();
  await expect(fork).not.toBeVisible();
  await expect(edit).toBeFocused();
  await expect(page.getByRole("main").locator(".monaco-editor .view-lines")).toContainText(end);
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
