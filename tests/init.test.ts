// detectNpmTest / detectTest の挙動（package.json の scripts からのテストコマンド推測）
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { detectNpmTest, detectTest } from "../src/init.js";

function repoWithPackageJson(text: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "loopi-init-test-"));
  fs.writeFileSync(path.join(dir, "package.json"), text);
  return dir;
}

test("scripts.test があれば npm test で候補は空", () => {
  assert.deepEqual(detectNpmTest({ test: "vitest" }), { command: "npm test", candidates: [] });
});

test("scripts.test が無ければ空にして typecheck・lint・test:* を候補にする（build は含まない）", () => {
  assert.deepEqual(
    detectNpmTest({ typecheck: "tsc", lint: "eslint", "test:e2e": "playwright test", build: "next build" }),
    { command: "", candidates: ["typecheck", "lint", "test:e2e"] },
  );
});

test("scripts が読めなかった（undefined）ときは npm test", () => {
  assert.equal(detectNpmTest(undefined).command, "npm test");
});

test("scripts が空なら npm test を推測せず候補も空", () => {
  assert.deepEqual(detectNpmTest({}), { command: "", candidates: [] });
});

test("package.json に scripts 自体が無いときは test が無いのと同じに扱う", () => {
  const t = detectTest(repoWithPackageJson(JSON.stringify({ name: "x" })));
  assert.equal(t.command, "");
  assert.equal(t.reportCommand, "");
  assert.deepEqual(t.candidates, []);
});

test("package.json の scripts に test が無ければ空にして候補を返す", () => {
  const t = detectTest(repoWithPackageJson(JSON.stringify({ scripts: { lint: "eslint", "test:unit": "vitest" } })));
  assert.equal(t.command, "");
  assert.deepEqual(t.candidates, ["lint", "test:unit"]);
});

test("package.json の scripts に test があれば npm test", () => {
  const t = detectTest(repoWithPackageJson(JSON.stringify({ scripts: { test: "vitest" } })));
  assert.equal(t.command, "npm test");
  assert.equal(t.reportCommand, "npm test");
});

test("package.json が JSON として読めなければ今までどおり npm test", () => {
  const t = detectTest(repoWithPackageJson("{ not json"));
  assert.equal(t.command, "npm test");
  assert.equal(t.reportCommand, "npm test");
});
