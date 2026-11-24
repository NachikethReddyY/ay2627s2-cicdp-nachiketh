import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Locator, type Page } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import pg from "pg";
import { silentWav } from "../../apps/api/src/media/silent-wav.ts";

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

test("signs up, confirms and edits a public handle, and stays signed in on /lessons", async ({ page }) => {
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

  await page.goto("/lessons");
  await expect(page.getByText("Pick a lesson to start.")).toBeVisible();
  await page.reload();
  await expect(page).toHaveURL(/\/lessons$/);
  await expect(page.getByText("Pick a lesson to start.")).toBeVisible();
  await page.goto("/play");
  await expect(page.getByText("We couldn't find that page.")).toBeVisible();

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

function visualLineCount(text: Locator) {
  return text.evaluate((element) => {
    const range = document.createRange();
    range.selectNodeContents(element);
    return new Set(Array.from(range.getClientRects(), (rect) => rect.top)).size;
  });
}

test("a private generated Python prediction distinguishes multiline choices and reveals replay after an answer", async ({ page, browser }) => {
  const email = newEmail();
  const suffix = randomUUID().slice(0, 12);
  const stepId = randomUUID();
  const course = `python-foundations-${suffix}`;
  const lesson = `predict-what-python-prints-${suffix}`;
  const title = "Predict What Python Prints";
  const singleLine = "Hello, Leo Welcome to Python!";
  const multiline = "Hello, Leo\nWelcome to Python!";
  const spokenMultiline = "Hello, Leo new line Welcome to Python!";
  await page.emulateMedia({ colorScheme: "light" });
  await signUp(page, email, "/");
  await page.evaluate("localStorage.setItem('lq.theme', 'system')");
  const db = new pg.Client({ connectionString: process.env.E2E_DATABASE_URL });
  await db.connect();
  try {
    await db.query("BEGIN");
    const { rows: [world] } = await db.query(
      `INSERT INTO worlds (id, slug, title, visibility, origin, owner_id)
        SELECT gen_random_uuid()::text, $1, 'Python Foundations', 'private', 'ai', id FROM "user" WHERE email = $2 RETURNING id`, [course, email],
    );
    const { rows: [draft] } = await db.query(
      "INSERT INTO lessons (id, slug, title, world_id, source_kind, kind) VALUES (gen_random_uuid()::text, $1, $2, $3, 'ai', 'predict') RETURNING id",
      [lesson, title, world.id],
    );
    const { rows: [version] } = await db.query("INSERT INTO lesson_versions (id, lesson_id, version) VALUES (gen_random_uuid()::text, $1, 1) RETURNING id", [draft.id]);
    await db.query("UPDATE lessons SET current_version_id = $1 WHERE id = $2", [version.id, draft.id]);
    await db.query("INSERT INTO steps (id, lesson_version_id, idx, public, secret) VALUES ($1, $2, 0, $3, $4)", [
      stepId,
      version.id,
      { title: "Read two print calls", prompt: "What will the program print?", kind: "mcq", options: [singleLine, "Hello, Leo", multiline, "Welcome to Python!"] },
      {
        beforeFiles: { "main.py": 'name = "Leo"\n' },
        hunks: [{ id: "print", file: "main.py", oldStart: 2, lines: ['+print("Hello,", name)', '+print("Welcome to Python!")'] }],
        answer: 2,
        hints: [{ text: "Follow the assignment." }],
        explanations: { workedExample: "Each print call ends its output with a line break.", practice: "Try another name." },
      },
    ]);
    await db.query("COMMIT");
  } finally {
    await db.end();
  }

  const narration = "/predict-explanation.wav";
  const narrationRequests: unknown[] = [];
  await page.route("**/api/trpc/steps.narration", (route) => {
    narrationRequests.push(route.request().postDataJSON());
    return route.fulfill({ json: { result: { data: { url: narration } } } });
  });
  await page.route(`**${narration}`, (route) =>
    route.fulfill({ contentType: "audio/wav", body: Buffer.from(silentWav(2000)) }));
  await page.goto(`/courses/${course}`);
  const start = page.getByRole("link", { name: "Start", exact: true });
  const href = `/lessons?lesson=${lesson}&course=${course}`;
  await expect(start).toHaveAttribute("href", href);
  await start.click();
  const task = page.getByRole("region", { name: "Predict", exact: true });
  const code = page.locator(".monaco-editor .view-lines");
  await expect(task.getByRole("heading", { name: "Read two print calls" })).toBeVisible();
  await expect(page.locator(".wb")).toHaveAttribute("data-resolved", "light");
  await expect(code).toContainText('name = "Leo"');
  await expect(code).not.toContainText('print("Hello,", name)');
  await page.getByRole("textbox", { name: /Code replay, read only/ }).press("End");
  await page.keyboard.type("should_not_edit");
  await expect(code).not.toContainText("should_not_edit");
  await expect(page.getByRole("slider", { name: "Timeline" })).toHaveCount(0);
  const clip = page.locator('audio[aria-label="Explanation audio"]');
  await expect(clip).toHaveCount(0);
  expect(narrationRequests).toHaveLength(0);
  await expect(page.getByRole("button", { name: "Toggle terminal panel", exact: false })).toHaveCount(0);
  const editorBox = (await code.boundingBox())!;
  const taskBox = (await task.boundingBox())!;
  expect(editorBox.x + editorBox.width).toBeLessThanOrEqual(taskBox.x);

  const singleLineChoice = task.getByRole("radio", { name: singleLine, exact: true });
  const multilineChoice = task.getByRole("radio", { name: spokenMultiline, exact: true });
  const choices = task.locator("label");
  await expect(singleLineChoice).toBeVisible();
  await expect(multilineChoice).toBeVisible();
  await expect.poll(() => visualLineCount(choices.filter({ has: page.getByRole("radio", { name: singleLine, exact: true }) }).getByText(singleLine, { exact: true }))).toBe(1);
  await expect.poll(() => visualLineCount(choices.filter({ has: page.getByRole("radio", { name: spokenMultiline, exact: true }) }).getByText(singleLine, { exact: true }))).toBe(2);
  await expect(task.getByRole("radio", { checked: true })).toHaveCount(0);
  await expect(task.getByText("Answer:", { exact: false })).toHaveCount(0);
  const input = encodeURIComponent(JSON.stringify({ id: stepId }));
  const earlyReveal = await page.request.get(`/api/trpc/steps.reveal?input=${input}`);
  expect(earlyReveal.status()).toBe(409);

  await page.setViewportSize({ width: 375, height: 667 });
  await page.emulateMedia({ colorScheme: "dark" });
  await expect(page.locator(".wb")).toHaveAttribute("data-resolved", "dark");
  await expect(task.getByRole("button", { name: "Check" })).toBeVisible();
  expect(await page.evaluate("document.documentElement.scrollWidth")).toBe(375);
  await multilineChoice.check();
  await task.getByRole("button", { name: "Check" }).click();
  await expect(task.getByRole("heading", { name: "Correct!" })).toBeVisible();
  const answer = task.locator("code");
  await expect(answer).toMatchAriaSnapshot(`- code: ${spokenMultiline}`);
  await expect.poll(() => visualLineCount(answer.getByText(singleLine, { exact: true }))).toBe(2);
  await expect(clip).toHaveAttribute("src", narration);
  await expect.poll(() => clip.evaluate((el) => (el as unknown as { duration: number }).duration)).toBeGreaterThan(0);
  expect(narrationRequests).toHaveLength(1);
  await expect(page.getByRole("slider", { name: "Timeline" })).toBeVisible();
  await page.getByRole("button", { name: "Go to end of replay" }).click();
  await expect(code).toContainText('print("Hello,", name)');
  await task.getByRole("button", { name: "Finish lesson" }).click();
  await expect(task.getByRole("link", { name: "Back to course" })).toHaveAttribute("href", `/courses/${course}`);
  await expect(page.getByRole("slider", { name: "Timeline" })).toHaveCount(0);

  const other = await browser.newContext();
  try {
    const stranger = await other.newPage();
    await signUp(stranger, newEmail(), href);
    await expect(stranger.getByText("We couldn't find that lesson.")).toBeVisible();
    await expect(stranger.getByRole("region", { name: "Predict", exact: true })).toHaveCount(0);
  } finally {
    await other.close();
  }
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
  let ran = false;
  let submitted = false;
  let requestedFeedback = false;
  await page.route("**/api/sandbox/workspace-file", async (route) => {
    expect(route.request().method()).toBe("PUT");
    expect(route.request().postDataJSON()).toMatchObject({
      path: "workspaces/scrim-return-values/solution.js",
      content: expect.stringContaining("function double"),
    });
    await route.fulfill({ json: { ok: true } });
  });
  await page.routeWebSocket(/\/api\/sandbox\/shell/, (ws) => {
    ws.send(Buffer.from("sandbox ready\r\n"));
    ws.onMessage((message) => {
      if (typeof message === "string") return;
      if (message.toString() === `cd -- "$HOME"/'workspaces/scrim-return-values' && node solution.js\r`) ran = true;
      if (ran && message.includes(4)) ws.send(Buffer.from("Practice output\r\n"));
    });
  });
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
      expect(input.finding).toEqual({ ruleId: "prettier-format", line: 1, column: 1 });
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
      feedbackReceipt: "a".repeat(64),
      results: ["two", "five", "hidden-1", "hidden-2"].map((id, index) => ({
        id, name: id, stretch: false, visibility: index < 2 ? "sample" : "hidden", status: "pass",
      })),
    } });
  });
  await page.route("**/api/practice/design-feedback", async (route) => {
    const input = route.request().postDataJSON();
    expect(input).toMatchObject({ lessonId: "scrim-return-values", receipt: "a".repeat(64) });
    expect(input.code).toContain("function double");
    requestedFeedback = true;
    await route.fulfill({ json: { feedback: { line: 2, note: "This function handles two jobs. Where could you split it?" } } });
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
  await expect(page.getByRole("tree", { name: "Workspace files" }).getByRole("treeitem", { name: "solution.js" })).toHaveAttribute("aria-selected", "true");
  await expect(page.getByRole("button", { name: "Watch", exact: true })).toHaveCount(0);
  const navigatorTabs = page.getByRole("group", { name: "Navigator view" });
  const search = navigatorTabs.getByRole("button", { name: "Search", exact: true });
  await search.click();
  await expect(search).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("searchbox", { name: "Find in file" }).fill("DOUBLE");
  const result = page.getByRole("button", { name: "1 function double(n) {" });
  await result.click();
  await expect(page.getByRole("textbox", { name: "Your code. Press Escape to leave the editor." })).toBeFocused();
  await navigatorTabs.getByRole("button", { name: "Source control", exact: true }).click();
  await expect(page.getByText("Source control is unavailable in lesson workspaces.")).toBeVisible();
  await navigatorTabs.getByRole("button", { name: "Run and debug", exact: true }).click();
  await expect(page.getByText(/The debugger is unavailable/)).toBeVisible();
  await navigatorTabs.getByRole("button", { name: "Files", exact: true }).click();
  await expect(page.getByRole("tree", { name: "Workspace files" })).toBeVisible();

  await page.getByRole("button", { name: "Run", exact: true }).click();
  const terminalPanel = page.getByRole("region", { name: "Terminal panel" });
  const terminal = terminalPanel.locator(".wb-terminal");
  await expect.poll(() => ran).toBe(true);
  await expect(terminalPanel.getByRole("textbox", { name: "Standard input" })).toHaveCount(0);
  await expect(terminal.locator("textarea")).toBeFocused();
  await page.keyboard.type("2");
  await page.keyboard.press("Enter");
  await page.keyboard.press("Control+d");
  await expect(terminal).toContainText("Practice output");

  await page.getByRole("button", { name: "Lint", exact: true }).click();
  await expect(page.getByRole("button", { name: "Results", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("region", { name: "Style findings" }).getByText(/Prettier formatting suggestion/).first()).toBeVisible({ timeout: 10_000 });
  await expect(page.locator(".squiggly-warning").first()).toBeVisible();
  const problems = navigatorTabs.getByRole("button", { name: /^Problems \([1-9]\d*\)$/ });
  await problems.click();
  await expect(problems).toHaveAttribute("aria-pressed", "true");
  await navigatorTabs.getByRole("button", { name: "Files", exact: true }).click();
  const feedback = page.getByRole("region", { name: "AI design feedback" });
  await expect(feedback).toHaveCount(0);
  await page.getByRole("button", { name: "Ask Sloppy about line 1: prettier-format" }).click();
  const sloppy = page.getByRole("complementary", { name: "Sloppy AI" }).getByRole("region", { name: "AI learning guide" });
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
  const ai = page.getByRole("button", { name: "Sloppy AI", exact: true });
  await expect(ai).toHaveAttribute("aria-pressed", "true");
  await ai.click();
  await expect(sloppy).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Results", exact: true })).toHaveAttribute("aria-pressed", "true");
  await ai.click();
  await expect(sloppy.getByText("You traced the call. Now look at how the function ends.")).toBeVisible();
  await ai.click();
  await page.getByRole("button", { name: "Submit", exact: true }).click();
  await expect(page.getByText("Level complete! Every required test passed.", { exact: true })).toBeVisible();
  expect(submitted).toBe(true);
  await expect(feedback.getByRole("button", { name: "Get design feedback" })).toBeEnabled();
  expect(requestedFeedback).toBe(false);
  await feedback.getByRole("button", { name: "Get design feedback" }).click();
  await expect(feedback.getByRole("status")).toContainText("Line 2");
  await expect(feedback.getByRole("status")).toContainText("This function handles two jobs.");
  expect(requestedFeedback).toBe(true);

  await page.locator(".view-lines").first().click();
  await page.keyboard.type(" ");
  await expect(page.getByText("Level complete! Every required test passed.", { exact: true })).toHaveCount(0);
  await expect(feedback).toHaveCount(0);
  await expect(page.getByText(/Prettier formatting suggestion/)).toHaveCount(0);
  await expect(page.locator(".squiggly-warning")).toHaveCount(0);

  await test.step("narrated practice uses a project tree and runs the saved file in the terminal", async () => {
    const narratedPage = await page.context().newPage();
    try {
      await verifyNarratedPractice(narratedPage);
    } finally {
      await narratedPage.close();
    }
  });
});

async function verifyNarratedPractice(page: Page) {
  const vercel = JSON.parse(readFileSync(new URL("../../apps/web/vercel.json", import.meta.url), "utf8")) as {
    headers: { source: string; headers: { key: string; value: string }[] }[];
  };
  const policy = vercel.headers.find(({ source }) => source === "/(.*)")?.headers
    .find(({ key }) => key.toLowerCase() === "content-security-policy")?.value;
  if (!policy) throw new Error("The Vercel content security policy is missing.");
  await page.route(/\/(lessons|editor)\?lesson=practice-greeting$/, async (route) => {
    const response = await route.fetch();
    await route.fulfill({ response, headers: { ...response.headers(), "content-security-policy": policy } });
  });

  const title = "Print a greeting";
  const starter = 'console.log("hello practice");';
  const edited = "console.log(42);";
  const narration = "/practice-narration.wav";
  const shellInput: string[] = [];
  let folderCreated = false;
  await page.route("**/api/trpc/lessons.get?*", (route) => route.fulfill({
    json: [{ result: { data: {
      id: "practice-greeting",
      versionId: "v1",
      title,
      kind: "practice",
      part: { kind: "practice", language: "javascript", starterCode: starter, instructions: "Print a greeting.", tests: [{ id: "sample", name: "Sample", visibility: "sample", stretch: false, stdin: "42\n" }] },
      steps: [],
      media: [{ kind: "narration", stepId: null, segment: null, url: narration }],
    } } }],
  }));
  await page.route("**/api/trpc/lessons.write?*", (route) =>
    route.fulfill({ json: [{ result: { data: { ok: true } } }] }));
  await page.route(`**${narration}`, (route) =>
    route.fulfill({ contentType: "audio/wav", body: Buffer.from(silentWav(2000)) }));
  await page.route("**/api/sandbox/files?workspace=practice-greeting", (route) => route.fulfill({ json: {
    entries: [{ name: "notes", type: "dir", size: 0 }, ...(folderCreated ? [{ name: "examples", type: "dir", size: 0 }] : [])],
    truncated: false,
  } }));
  await page.route("**/api/sandbox/workspace-entry", async (route) => {
    expect(route.request().postDataJSON()).toEqual({ workspace: "practice-greeting", name: "examples", kind: "folder" });
    folderCreated = true;
    await route.fulfill({ status: 201, json: { ok: true } });
  });
  await page.route("**/api/sandbox/files?dir=notes&workspace=practice-greeting", (route) => route.fulfill({
    json: { entries: [{ name: "scratch.txt", type: "file", size: 0 }], truncated: false },
  }));
  let uploaded = false;
  await page.route("**/api/sandbox/workspace-file", async (route) => {
    expect(route.request().method()).toBe("PUT");
    expect(route.request().postDataJSON()).toEqual({ path: "workspaces/practice-greeting/solution.js", content: edited });
    uploaded = true;
    await route.fulfill({ json: { ok: true } });
  });
  await page.routeWebSocket(/\/api\/sandbox\/shell/, (ws) => {
    expect(new URL(ws.url()).searchParams.get("workspace")).toBe("practice-greeting");
    ws.onMessage((message) => {
      if (typeof message === "string") return;
      const input = message.toString();
      shellInput.push(input);
      if (input.includes("node solution.js")) {
        expect(uploaded).toBe(true);
        ws.send(Buffer.from(`$ ${input.trim()}\r\n42\r\n`));
      }
    });
    ws.send(Buffer.from("sandbox ready\r\n"));
  });
  const lessonPage = await page.goto("/lessons?lesson=practice-greeting");
  expect(lessonPage?.headers()["content-security-policy"]).toBe(policy);
  const watch = page.getByRole("button", { name: "Watch", exact: true });
  await watch.click();
  await expect(page.getByRole("group", { name: `Lesson video: ${title}` })).toBeVisible();

  await page.evaluate(() => {
    localStorage.setItem("lq.terminal", JSON.stringify({ open: true, height: 240 }));
    localStorage.setItem("lq.test-editor.code-window", JSON.stringify({ left: 32, top: 32, width: 1600, height: 1400 }));
  });
  const practicePage = await page.goto("/editor?lesson=practice-greeting");
  expect(practicePage?.headers()["content-security-policy"]).toBe(policy);
  await watch.click();
  const video = page.getByRole("group", { name: `Lesson video: ${title}` });
  await video.getByRole("button", { name: "Play video" }).click();
  await expect.poll(() => video.locator("video").evaluate((element) => (element as unknown as { currentTime: number }).currentTime)).toBeGreaterThan(0);

  const subheads = await Promise.all([
    page.locator(".wb-lesson-subhead").first().boundingBox(),
    page.getByRole("navigation", { name: "File path" }).boundingBox(),
    page.locator(".wb-lesson-subhead").last().boundingBox(),
  ]);
  expect(subheads.map((box) => box?.height)).toEqual([36, 36, 36]);
  expect(subheads[1]?.y).toBe(subheads[2]?.y);
  const navigatorRow = await page.getByRole("group", { name: "Navigator view" }).boundingBox();
  if (!navigatorRow || !subheads[0]) throw new Error("The navigator and workspace headers are not visible.");
  expect(navigatorRow.y + navigatorRow.height).toBeLessThanOrEqual(subheads[0].y);
  const files = page.getByRole("tree", { name: "Workspace files" });
  await files.getByRole("treeitem", { name: "notes" }).click();
  await expect(files.getByRole("treeitem", { name: "scratch.txt" })).toBeVisible();
  await expect(files.getByRole("treeitem", { name: "solution.js" })).toHaveCount(1);
  await files.getByRole("treeitem", { name: "solution.js" }).click();
  await expect(page.getByRole("textbox", { name: "Your code. Press Escape to leave the editor." })).toBeFocused();
  await page.keyboard.press("End");
  await page.keyboard.press("Shift+Home");
  await page.keyboard.insertText(edited);

  const panel = page.getByRole("region", { name: "Terminal panel" });
  const terminal = panel.locator(".wb-terminal");
  await expect(terminal).toContainText("sandbox ready");
  await page.getByRole("button", { name: "Run", exact: true }).click();
  await expect(terminal).toContainText("node solution.js");
  await expect(terminal).toContainText("42");
  await expect(panel.getByRole("button", { name: "Console", exact: true })).toHaveCount(0);
  await expect(terminal).not.toContainText("LQ_");
  expect(shellInput).toEqual(["\u0003", `cd -- "$HOME"/'workspaces/practice-greeting' && node solution.js\r`]);
  await expect(page.locator("footer").getByText("Ready", { exact: true })).toBeVisible();
  await expect(files.getByRole("treeitem", { name: "solution.js" })).toHaveAttribute("aria-selected", "true");

  await page.getByRole("button", { name: "New folder" }).click();
  await page.getByRole("textbox", { name: "Folder name" }).fill("examples");
  await page.getByRole("button", { name: "Create", exact: true }).click();
  await expect(files.getByRole("treeitem", { name: "examples" })).toBeVisible();

  const split = panel.getByRole("button", { name: "Split terminal view" });
  await split.click();
  await expect(panel.getByRole("group", { name: "Terminal sessions" }).getByRole("button", { name: "Terminal 2", exact: true })).toBeVisible();
  await expect(panel.locator(".wb-terminal:visible")).toHaveCount(2);
  await panel.getByRole("button", { name: "Close Terminal 2" }).click();
  await expect(panel.locator(".wb-terminal:visible")).toHaveCount(1);
  await panel.getByRole("button", { name: "Maximize terminal panel" }).click();
  await expect(panel.getByRole("button", { name: "Restore terminal panel" })).toBeVisible();
  await panel.getByRole("button", { name: "Close panel" }).click();
  await expect(panel).toBeHidden();
  await page.setViewportSize({ width: 1024, height: 768 });
  const resizer = page.getByRole("separator", { name: "Resize docs" });
  await resizer.focus();
  for (let i = 0; i < 12; i++) await resizer.press("ArrowRight");
  const window = page.locator(".wb-win");
  const tabs = page.getByRole("group", { name: "Side panel view" });
  await expect(tabs.getByRole("button")).toHaveText(["Task", "Results", "Docs"]);
  const bounds = await window.boundingBox();
  if (!bounds) throw new Error("The Workbench window is not visible.");
  for (const tab of await tabs.getByRole("button").all()) {
    const box = await tab.boundingBox();
    expect(box && box.x + box.width <= bounds.x + bounds.width).toBe(true);
    await expect(tab).toBeInViewport();
  }
  const dock = page.getByRole("group", { name: "Workbench dock" });
  const dockBounds = await dock.boundingBox();
  expect(dockBounds && bounds.y + bounds.height <= dockBounds.y).toBe(true);
  const dockTerminal = dock.getByRole("button", { name: "Toggle terminal", exact: true });
  await dockTerminal.click();
  await expect(panel).toBeVisible();
  await expect(dockTerminal).toHaveAttribute("aria-pressed", "true");
  await dockTerminal.click();
  await expect(panel).toBeHidden();
  await dock.getByRole("button", { name: "Open lesson docs" }).click();
  await expect(page.getByRole("textbox", { name: "Search docs" })).toBeVisible();
  await dock.getByRole("button", { name: "Open Sloppy AI" }).click();
  await expect(page.getByRole("textbox", { name: "Ask about this code" })).toBeVisible();
  await dock.getByRole("button", { name: "Open lesson task" }).click();
  await expect(tabs.getByRole("button", { name: "Task" })).toHaveAttribute("aria-pressed", "true");
  await dock.getByRole("button", { name: "Focus code editor" }).click();
  await expect(page.getByRole("textbox", { name: "Your code. Press Escape to leave the editor." })).toBeFocused();

  const explorer = page.getByRole("button", { name: "File explorer", exact: true });
  await explorer.click();
  await expect(files).toBeHidden();
  await explorer.click();
  await expect(files).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(dock).toBeHidden();
  await explorer.click();
  const drawer = page.getByRole("dialog", { name: "Files" });
  await drawer.getByRole("button", { name: "Search", exact: true }).click();
  await drawer.getByRole("searchbox", { name: "Find in file" }).fill("console");
  await drawer.getByRole("button", { name: /console\.log/ }).click();
  await expect(drawer).toBeHidden();
  await expect(page.getByRole("textbox", { name: "Your code. Press Escape to leave the editor." })).toBeFocused();
}

test("a scrim keeps later code hidden until its prediction and shows the updated replay", async ({ page }) => {
  await signUp(page, newEmail(), "/lessons?lesson=scrim-return-values&course=scrim-demo");
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
    expect(route.request().postDataJSON()).toEqual({ code: edited, language: "javascript", stdin: "" });
    return route.fulfill({ json: { id: runId } });
  });
  await page.route(`**/api/sandbox/run/${runId}?*`, (route) =>
    route.fulfill({ json: { output: "fork\n", next: 5, done: true } }));
  await page.goto("/lessons?lesson=watch-fork");
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
  ["/", (page) => page.getByRole("heading", { level: 1, name: "Learn to read and write code." })],
  ["/login", (page) => page.getByRole("heading", { name: "Sign in", exact: true })],
];
const SIGNED_IN_PAGES: [string, (page: Page) => Locator][] = [
  ["/lessons", (page) => page.getByText("Pick a lesson to start.")],
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

test("landing shows the framework with reduced motion and waits for a Scrim prediction", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  await page.getByRole("link", { name: "See how it works" }).click();
  await expect(page).toHaveURL(/#learning-modes$/);
  const modes = page.getByRole("region", { name: "We built a framework for teaching code." });
  await expect(modes.locator(".lp-story-list .lp-story-tile-label")).toHaveText([
    "Open pages", "Quizzes and scenarios", "Scrims", "Practice editors", "Summary pages", "Summary quizzes",
  ]);
  await expect(page.getByRole("link", { name: /Try the interactive Scrim/ })).toBeVisible();
  const scrim = page.getByRole("region", { name: "Try a Scrim" });
  await expect(scrim.getByText("return result;")).toHaveCount(0);
  await scrim.getByRole("button", { name: "undefined", exact: true }).click();
  await expect(scrim.getByRole("status")).toContainText("Correct.");
  await expect(scrim.getByText("return result;")).toBeVisible();
  await scrim.getByRole("button", { name: "Replay" }).click();
  await expect(scrim.getByText("return result;")).toHaveCount(0);
  await expect(scrim.getByRole("button", { name: "8", exact: true })).toBeFocused();
});

test("landing scroll expands each learning mode in order before showing all six", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/");
  const story = page.locator(".lp-story-scroll");
  await page.evaluate(() => document.fonts.ready);
  const at = (progress: number) => story.evaluate((stage, progress) => {
    const start = stage.getBoundingClientRect().top + window.scrollY;
    window.scrollTo({ top: start + progress * (stage.clientHeight - window.innerHeight), behavior: "instant" });
  }, progress);
  await expect(story.locator(".lp-story-difficulty")).toHaveCSS("opacity", "0");
  await at(.32);
  await expect(story.locator(".lp-story-framework")).toHaveCSS("opacity", "1");
  const cards = story.locator(".lp-story-tile-position");
  await at(.58);
  await expect(cards.last()).toHaveCSS("--detail", "0");
  const firstCard = cards.first();
  await at(.5965);
  await expect(firstCard).toHaveCSS("opacity", "1");
  await expect(cards.nth(1)).toHaveCSS("opacity", "0");
  await expect(firstCard.locator(".lp-story-tile-summary")).toHaveCSS("opacity", "0");
  await expect(firstCard.locator(".lp-story-expanded-layout")).toHaveCSS("opacity", "0");
  for (const [index, progress] of [.616, .668, .72, .772, .824, .876].entries()) {
    await at(progress);
    await expect(cards.nth(index)).toHaveCSS("--focus", "1");
    await expect(cards.nth((index + 1) % 6)).toHaveCSS("--focus", "0");
    const expanded = cards.nth(index).locator(":scope > .lp-story-tile");
    await expect(expanded).toHaveCSS("width", "1280px");
    await expect(expanded).toHaveCSS("height", "800px");
    await expect(expanded.locator(".lp-story-expanded-layout")).toHaveCSS("opacity", "1");
  }
  await at(.98);
  await expect(story.locator(".lp-story-pin")).toHaveCSS("background-color", "rgb(0, 0, 0)");
  for (const line of await story.locator(".lp-story-words, .lp-story-word").all()) {
    await expect(line).toHaveCSS("visibility", "hidden");
  }
  for (const card of await cards.all()) {
    await expect(card).toHaveCSS("--focus", "0");
    await expect(card).toHaveCSS("--detail", "1");
    await expect(card).toHaveCSS("opacity", "1");
  }
  await at(.32);
  await expect(story.locator(".lp-story-framework")).toHaveCSS("visibility", "visible");
});

test("axe: no serious or critical violations on signed-in pages", async ({ page }) => {
  await signUp(page, newEmail(), "/");
  for (const [path, ready] of SIGNED_IN_PAGES) {
    await test.step(path, () => expectNoSeriousA11yViolations(page, path, ready(page)));
  }
});

test("a step with no narration audio is spoken with browser speech on reveal", async ({ page }) => {
  await page.addInitScript(() => {
    const spoken: string[] = [];
    (globalThis as unknown as { __spoken: string[] }).__spoken = spoken;
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
        pause() {},
        resume() {},
      },
    });
  });
  await signUp(page, newEmail(), `/courses/${COURSE}`);
  await page.locator(`a.lesson-hit[href*="lesson=${LESSON}"]`).click();
  await page.locator(`a.lesson-pop-btn[href*="lesson=${LESSON}"]`).click();
  await expect(page.getByRole("button", { name: "Listen to explanation" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Stop narration" })).toHaveCount(0);
  await page.getByLabel(CORRECT_OPTION).check();
  await page.getByRole("button", { name: "Check" }).click();
  await expect(page.getByRole("heading", { name: "Correct!" })).toBeVisible();

  const stop = page.getByRole("button", { name: "Stop narration" });
  await expect(stop).toBeVisible();
  const spoken = () => page.evaluate(() => (globalThis as unknown as { __spoken: string[] }).__spoken.join(" "));
  const file = JSON.parse(readFileSync(new URL("../../worlds/codequest/lessons/lesson-1.json", import.meta.url), "utf8")) as {
    steps: { id: string; secret: { narration: string } }[];
  };
  const narration = file.steps.find((st) => st.id === FIRST_STEP_ID)!.secret.narration;
  const firstSentence = narration.match(/.+?[.!?](?=\s|$)/s)![0].trim();
  await expect.poll(spoken).toBe(firstSentence);

  await stop.click();
  await page.getByRole("button", { name: "Listen to explanation" }).click();
  await expect.poll(spoken).toBe(`${firstSentence} ${firstSentence}`);
});
