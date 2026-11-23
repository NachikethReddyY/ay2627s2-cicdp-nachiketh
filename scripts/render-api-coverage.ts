import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const api = join(root, "apps/api");
const metrics = [
  { label: "Lines", hit: "LH", total: "LF" },
  { label: "Branches", hit: "BRH", total: "BRF" },
  { label: "Functions", hit: "FNH", total: "FNF" },
] as const;
type Scope = "api" | "shared" | "other";
type CoverageRecord = {
  path: string;
  scope: Scope;
  counts: Array<{ hit: number; total: number }>;
  executedLines: number[];
  uncoveredLines: number[];
  uncoveredBranches: number[];
  uncoveredFunctions: string[];
};
const scopes = [
  { id: "api", label: "API production" },
  { id: "shared", label: "Shared packages loaded by the API suite" },
  { id: "other", label: "Test support and other loaded files" },
] as const;

function readReport(file: string): CoverageRecord[] {
  return readFileSync(file, "utf8").split("end_of_record").flatMap((section) => {
    const entries = section.trim().split(/\r?\n/).map((line) => {
      const separator = line.indexOf(":");
      return [line.slice(0, separator), line.slice(separator + 1)] as const;
    });
    const fields = new Map(entries);
    const source = fields.get("SF");
    if (!source) return [];
    const path = relative(root, resolve(api, source));
    if (path.startsWith("..")) throw new Error(`Source is outside the repository: ${source}`);
    const scope = path.startsWith("apps/api/src/") ? "api" : path.startsWith("packages/") ? "shared" : "other";
    const counts = metrics.map(({ hit, total }) => {
      const found = Number(fields.get(total) ?? 0);
      const covered = Number(fields.get(hit) ?? 0);
      if (!Number.isSafeInteger(found) || !Number.isSafeInteger(covered) || covered < 0 || covered > found) {
        throw new Error(`Invalid coverage totals for ${source}`);
      }
      return { hit: covered, total: found };
    });
    const lines = entries.filter(([key]) => key === "DA").map(([, value]) => value.split(","));
    const executedLines = lines.filter(([, hits]) => Number(hits) > 0).map(([line]) => Number(line));
    const uncoveredLines = lines.filter(([, hits]) => hits === "0").map(([line]) => Number(line));
    const uncoveredBranches = entries.filter(([key]) => key === "BRDA")
      .map(([, value]) => value.split(","))
      .filter(([, , , hits]) => hits === "0" || hits === "-")
      .map(([line]) => Number(line));
    const functions = entries.filter(([key]) => key === "FN");
    const uncoveredFunctions = entries.filter(([key]) => key === "FNDA")
      .flatMap(([, value], index) => {
        if (!value.startsWith("0,")) return [];
        const [line, name] = functions[index][1].split(",", 2);
        return [name.startsWith("anonymous_") ? `line ${line}` : `${name} (line ${line})`];
      });
    return [{ path, scope, counts, executedLines, uncoveredLines, uncoveredBranches, uncoveredFunctions }];
  });
}

function totals(records: CoverageRecord[]) {
  return metrics.map((_, index) => ({
    hit: records.reduce((sum, record) => sum + record.counts[index].hit, 0),
    total: records.reduce((sum, record) => sum + record.counts[index].total, 0),
  }));
}

function distinctApiLines(records: CoverageRecord[]) {
  const found = new Set<string>();
  const hit = new Set<string>();
  for (const record of records.filter((item) => item.scope === "api")) {
    for (const line of record.uncoveredLines) found.add(`${record.path}:${line}`);
    for (const line of record.executedLines) {
      const key = `${record.path}:${line}`;
      found.add(key);
      hit.add(key);
    }
  }
  return { hit: hit.size, total: found.size };
}

function escape(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
}

function metric({ hit, total }: { hit: number; total: number }) {
  if (!total) return "—";
  const percent = (100 * hit / total).toFixed(2);
  return `${percent}% <small>(${hit}/${total})</small>`;
}

function metricCell(counts: Parameters<typeof metric>[0]) {
  return `<td>${metric(counts)}</td>`;
}

function lineRanges(lines: number[]) {
  const ranges: Array<{ start: number; end: number }> = [];
  for (const line of lines) {
    const last = ranges.at(-1);
    if (last && last.end + 1 === line) last.end = line;
    else ranges.push({ start: line, end: line });
  }
  return ranges.map(({ start, end }) => start === end ? String(start) : `${start}–${end}`).join(", ");
}

const [reportFile, outputFile, revision, baselineFile, baselineRevision] = process.argv.slice(2);
if (!reportFile || !outputFile || !revision || Boolean(baselineFile) !== Boolean(baselineRevision)) {
  throw new Error("Usage: node scripts/render-api-coverage.ts <report.lcov> <report.html> <source revision> [baseline.lcov baseline-revision]");
}

const records = readReport(reportFile);
if (!records.length) throw new Error("LCOV has no source records");
const paths = new Set(records.map((record) => record.path));
const apiFiles = readdirSync(join(api, "src"), { recursive: true, withFileTypes: true })
  .filter((entry) => entry.isFile() && entry.name.endsWith(".ts"))
  .map((entry) => relative(root, join(entry.parentPath, entry.name)));
const missing = apiFiles.filter((file) => !paths.has(file)).sort();
const duplicates = [...paths].filter((path) => records.filter((record) => record.path === path).length > 1);
const baseline = baselineFile ? readReport(baselineFile) : [];
const groups = [...scopes.map(({ id, label }) => ({
  label,
  current: records.filter((record) => record.scope === id),
  before: baseline.filter((record) => record.scope === id),
})), { label: "Entire API test run", current: records, before: baseline }];
const headings = metrics.map(({ label }) => `<th scope="col">${label}</th>`).join("");
const summary = groups.map(({ label, current, before }) => {
  const cells = totals(current).map(metricCell).join("");
  const baselineRow = before.length
    ? `<tr><th scope="row">${label} <small>at ${escape(baselineRevision)}</small></th>${totals(before).map(metricCell).join("")}</tr>`
    : "";
  return `${baselineRow}<tr><th scope="row">${label}</th>${cells}</tr>`;
}).join("\n");
const apiGroup = groups[0];
const apiCurrent = totals(apiGroup.current);
const apiBaseline = totals(apiGroup.before);
const comparison = apiGroup.before.length ? `<figure aria-label="API production coverage before and after">
<figcaption>API production coverage</figcaption>
${metrics.map(({ label }, index) => {
  const before = apiBaseline[index];
  const after = apiCurrent[index];
  return `<div class="comparison">
  <span>${label}</span>
  <span>Baseline <meter min="0" max="${before.total}" value="${before.hit}" aria-label="${label}, baseline"></meter> ${metric(before)}</span>
  <span>Current <meter min="0" max="${after.total}" value="${after.hit}" aria-label="${label}, current"></meter> ${metric(after)}</span>
  </div>`;
}).join("\n")}
</figure>` : "";

const occurrence = new Map<string, number>();
const rows = records.sort((a, b) => a.path.localeCompare(b.path)).map((record) => {
  const count = (occurrence.get(record.path) ?? 0) + 1;
  occurrence.set(record.path, count);
  const duplicate = duplicates.includes(record.path) ? ` <small>(LCOV record ${count})</small>` : "";
  const lines = record.uncoveredLines.length ? escape(lineRanges(record.uncoveredLines)) : "—";
  const branchLines = [...new Set(record.uncoveredBranches)].sort((a, b) => a - b);
  const branches = branchLines.length ? `<p>Untaken branches at lines ${escape(lineRanges(branchLines))}.</p>` : "";
  const functions = record.uncoveredFunctions.length ? `<p>Uncalled functions at ${escape(record.uncoveredFunctions.join(", "))}.</p>` : "";
  const uncovered = branches || functions
    ? `<details><summary>${record.uncoveredLines.length ? lines : "Branch or function gaps"}</summary>${branches}${functions}</details>`
    : lines;
  const gaps = record.counts.some(({ hit, total }) => hit < total);
  return `<tr data-scope="${record.scope}" data-gaps="${gaps}"><th scope="row">${escape(record.path)}${duplicate}</th>${record.counts.map(metricCell).join("")}<td>${uncovered}</td></tr>`;
}).join("\n");

const duplicateNote = duplicates.length
  ? `<p>Node emitted repeated source paths for ${duplicates.map((path) => `<code>${escape(path)}</code>`).join(", ")}. The mastery concurrency tests load additional instances under distinct import URLs. Totals retain all native LCOV records. Node’s LCOV branch numbers are record-local, so the report does not merge branch hits from different instances.</p>`
  : "";
const missingNote = missing.length
  ? `<ul>${missing.map((path) => `<li><code>${escape(path)}</code></li>`).join("")}</ul>`
  : "<p>Every API TypeScript source file has an LCOV record.</p>";
const baselinePaths = new Set(baseline.map(({ path }) => path));
const newlyInstrumented = baseline.length
  ? apiFiles.filter((path) => paths.has(path) && !baselinePaths.has(path)).sort()
  : [];
const newNote = newlyInstrumented.length
  ? `<p>Newly instrumented since the baseline: ${newlyInstrumented.map((path) => `<code>${escape(path)}</code>`).join(", ")}.</p>`
  : "";
const distinctLines = distinctApiLines(records);
const baselineLines = baseline.length ? ` (baseline ${metric(distinctApiLines(baseline))})` : "";

writeFileSync(outputFile, `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>LearnSlop API coverage</title>
<style>
:root{color-scheme:light dark;font:15px/1.5 system-ui}
body{max-width:72rem;margin:2rem auto;padding:0 1rem}h1,h2{line-height:1.2}
p{max-width:52rem}small{color:GrayText}table{border-collapse:collapse;width:100%;font-variant-numeric:tabular-nums}
th,td{text-align:left;padding:.45rem .6rem;border-bottom:1px solid color-mix(in srgb,currentColor 20%,transparent);vertical-align:top}
td:not(:last-child){white-space:nowrap}tbody th{font-weight:400;overflow-wrap:anywhere}
.scroll{overflow:auto}fieldset{border:0;padding:0;margin:1rem 0;display:flex;align-items:center;gap:1rem;flex-wrap:wrap}
input,select{font:inherit;padding:.3rem}label{display:inline-flex;gap:.4rem;align-items:center}
summary{cursor:pointer}details p{margin:.35rem 0}pre{overflow:auto}
figure{margin:1rem 0}figcaption{font-weight:600;margin-bottom:.35rem}
.comparison{display:grid;grid-template-columns:6rem repeat(2,minmax(11rem,1fr));gap:.35rem;max-width:48rem}
.comparison span{display:flex;align-items:center;gap:.35rem;flex-wrap:wrap}
meter{width:clamp(3rem,12vw,7rem)}
@media(max-width:36rem){.comparison{grid-template-columns:1fr 1fr;margin-bottom:.5rem}.comparison span:first-child{grid-column:1/-1}}
</style>
</head>
<body><main>
<h1>LearnSlop API coverage</h1>
<p>Measured source revision <code>${escape(revision)}</code></p>
<p>${apiFiles.length - missing.length}/${apiFiles.length} API TypeScript files instrumented. The API suite emitted ${records.length} LCOV records across ${paths.size} distinct files.</p>
<p>Distinct API production lines covered at least once: <strong>${metric(distinctLines)}</strong>${baselineLines}.</p>
${comparison}
<div class="scroll"><table aria-label="Coverage by scope"><thead><tr><th scope="col">Scope</th>${headings}</tr></thead><tbody>
${summary}
</tbody></table></div>
<p>Shared package coverage reflects only code loaded by the API suite. The TypeScript inventory excludes SQL migrations and the sandbox shell startup scripts <code>learner-bashrc</code> and <code>learner-zshrc</code>. A dash indicates zero instrumented items for that metric.</p>
${duplicateNote}
<h2>API TypeScript files without a coverage record</h2>
${missingNote}
${newNote}
<h2>Source files</h2>
<p>Expand an uncovered line entry to see the reported branch and function locations for that record.</p>
<fieldset aria-label="Coverage filters">
<label>File <input type="search" id="filter"></label>
<label>Scope <select id="scope"><option value="">All files</option>${scopes.map(({ id, label }) => `<option value="${id}">${label}</option>`).join("")}</select></label>
<label><input type="checkbox" id="gaps"> Show only files with gaps</label>
</fieldset>
<p id="matches" role="status"></p>
<div class="scroll"><table aria-label="Coverage by source file"><thead><tr><th scope="col">Source file</th>${headings}<th scope="col">Uncovered lines</th></tr></thead><tbody id="files">
${rows}
</tbody></table></div>
<h2>Regenerate</h2>
<p>From the repository root, set <code>TEST_DATABASE_URL</code> to a local test database on a role that can create isolated databases, then run these commands with Node 22.</p>
<pre>mkdir -p .coverage
POSTHOG_API_KEY= POSTHOG_PROJECT_TOKEN= POSTHOG_HOST= \\
  ISOLATE_API_TEST_DATABASES=true API_COVERAGE_FILE="$PWD/.coverage/learnslop-api.lcov" pnpm --filter @learnquest/api test
node scripts/render-api-coverage.ts .coverage/learnslop-api.lcov .coverage/learnslop-api.html "$(git rev-parse HEAD)"</pre>
</main>
<script>
const search = document.querySelector("#filter");
const scope = document.querySelector("#scope");
const gaps = document.querySelector("#gaps");
const matches = document.querySelector("#matches");
const rows = [...document.querySelectorAll("#files tr")];
function filter() {
  const query = search.value.trim().toLowerCase();
  let shown = 0;
  for (const row of rows) {
    row.hidden = !row.cells[0].textContent.toLowerCase().includes(query)
      || (scope.value && row.dataset.scope !== scope.value)
      || (gaps.checked && row.dataset.gaps !== "true");
    if (!row.hidden) shown++;
  }
  matches.textContent = shown + " of " + rows.length + " coverage records";
}
for (const control of [search, scope, gaps]) control.addEventListener("input", filter);
filter();
</script>
</body>
</html>
`);
