import assert from "node:assert/strict";
import { test } from "node:test";
import fc from "fast-check";
import { formatFindings } from "../src/lint/format.ts";

const lines = fc.array(fc.string({ unit: fc.constantFrom("a", "b", "c", " ", "\t", "😀") }), { minLength: 1, maxLength: 12 });
const formatter = fc.constantFrom("Prettier", "Ruff");

test("identical lines produce no findings with any supported line ending", () => {
  fc.assert(fc.property(lines, formatter, (source, tool) => {
    assert.deepEqual(formatFindings(source.join("\n"), source.join("\r\n"), tool), []);
    assert.deepEqual(formatFindings(source.join("\r"), source.join("\n"), tool), []);
  }));
});

test("formatting changes yield deterministic, ordered findings within the original source", () => {
  fc.assert(fc.property(lines, lines, formatter, (source, revised, tool) => {
    const code = source.join("\n");
    const formatted = revised.join("\n");
    const findings = formatFindings(code, formatted, tool);
    assert.deepEqual(findings, formatFindings(code, formatted, tool));
    assert.equal(findings.length === 0, code === formatted);
    let previousLine = 0;
    for (const finding of findings) {
      assert.ok(finding.line >= Math.max(previousLine, 1) && finding.line <= source.length);
      assert.ok(finding.column >= 1 && finding.column <= source[finding.line - 1]!.length + 1);
      previousLine = finding.line;
    }
  }));
});

test("large changes still report a source location when the diff reaches its limit", () => {
  const code = "start";
  const formatted = [code, ...Array<string>(129).fill("extra")].join("\n");
  assert.deepEqual(formatFindings(code, formatted, "Ruff"), [{
    line: 1, column: 1, ruleId: "ruff-format", message: "Check the formatting here with Ruff.",
  }]);
});
