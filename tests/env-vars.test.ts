// モデル指定を上書きする環境変数の名前（#23）
//
// loopi の環境変数はすべて LOOPI_ で始まる。接頭辞なしの PI_* / CLAUDE_* / CODEX_* は
// Claude Code などの他ツールが同じ名前を使うため、読むと環境によって挙動が変わる。
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/** 上書きできるモデル指定の名前（LOOPI_ を除いた部分） */
const NAMES = ["PI_PROVIDER", "PI_MODEL", "PI_EFFORT", "CLAUDE_MODEL", "CLAUDE_EFFORT", "CODEX_MODEL", "CODEX_EFFORT"];

function read(rel: string): string {
  return fs.readFileSync(path.join(REPO_ROOT, rel), "utf8");
}

test("src/run.ts が読む環境変数は LOOPI_ 接頭辞の 7 つだけ", () => {
  const src = read("src/run.ts");
  const reads = [...src.matchAll(/process\.env\.([A-Za-z0-9_]+)/g)].map(m => m[1]);
  assert.deepEqual([...new Set(reads)].sort(), NAMES.map(n => `LOOPI_${n}`).sort());
});

test("src/run.ts に接頭辞なしの PI_* / CLAUDE_* / CODEX_* への参照が無い", () => {
  const src = read("src/run.ts");
  for (const name of NAMES) {
    // LOOPI_PI_MODEL のような接頭辞付きの名前は、接頭辞なしの参照として数えない
    assert.ok(!new RegExp(`(?<!LOOPI_)${name}`).test(src), `${name} への参照が残っています（LOOPI_${name} にしてください）`);
  }
});

test("USAGE・仕様・README が新しい名前と「すべて LOOPI_ で始まる」規則を記述している", () => {
  for (const rel of ["src/cli.ts", "docs/spec/config.md", "README.md"]) {
    const text = read(rel).replace(/`/g, "");
    assert.ok(text.includes("すべて LOOPI_ で始まる"), `${rel} に「loopi の環境変数はすべて LOOPI_ で始まる」の記述がありません`);
    for (const name of NAMES) {
      assert.ok(text.includes(`LOOPI_${name}`), `${rel} に LOOPI_${name} の記述がありません`);
    }
  }
});
