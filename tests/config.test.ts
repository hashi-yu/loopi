// loadConfig / docRef の挙動（設定の既定値・検証・参照ドキュメント案内）
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { CONFIG_FILENAME, docRef, docSentence, loadConfig } from "../src/config.js";

function repoWith(config: unknown): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "loopi-test-"));
  if (config !== undefined) fs.writeFileSync(path.join(dir, CONFIG_FILENAME), JSON.stringify(config));
  return dir;
}

test("最小の設定に既定値が補われる", () => {
  const cfg = loadConfig(repoWith({ test: { command: "npm test" } }));
  assert.equal(cfg.baseBranch, "main");
  assert.equal(cfg.branchPrefix, "issue-");
  assert.equal(cfg.worktreeDir, "..");
  assert.deepEqual(cfg.protectedPaths, []);
  assert.deepEqual(cfg.holdOnChange, []);
  assert.equal(cfg.limits.maxReviewRounds, 3);
  assert.equal(cfg.limits.maxTestFixes, 3);
  assert.equal(cfg.noAutomergeLabel, "no-automerge");
  assert.equal(typeof cfg.models.pi.provider, "string");
  assert.equal(cfg.models.claude.model, "claude-fable-5-1");
});

test("test.reportCommand を省略すると test.command が使われる", () => {
  const cfg = loadConfig(repoWith({ test: { command: "npm test" } }));
  assert.equal(cfg.test.reportCommand, "npm test");
});

test("入れ子の設定は部分的に上書きできる", () => {
  const cfg = loadConfig(repoWith({
    test: { command: "npm test" },
    models: { pi: { model: "custom-model" } },
    limits: { maxReviewRounds: 5 },
  }));
  assert.equal(cfg.models.pi.model, "custom-model");
  assert.equal(typeof cfg.models.pi.provider, "string"); // provider は既定値のまま
  assert.equal(cfg.limits.maxReviewRounds, 5);
  assert.equal(cfg.limits.maxTestFixes, 3);
});

test("models を省略すると pi / claude / codex とも既定値のオブジェクトになり effort は未設定", () => {
  const cfg = loadConfig(repoWith({ test: { command: "npm test" } }));
  assert.deepEqual(cfg.models.pi, { provider: "opencode-go", model: "deepseek-v4.1-flash" });
  assert.deepEqual(cfg.models.claude, { model: "claude-fable-5-1" });
  assert.deepEqual(cfg.models.codex, {});
  assert.equal(cfg.models.pi.effort, undefined);
  assert.equal(cfg.models.claude.effort, undefined);
  assert.equal(cfg.models.codex.effort, undefined);
});

test("models.claude と models.codex は model と effort をそのまま保持する", () => {
  const cfg = loadConfig(repoWith({
    test: { command: "npm test" },
    models: {
      claude: { model: "custom-claude", effort: "high" },
      codex: { model: "custom-codex", effort: "medium" },
    },
  }));
  assert.deepEqual(cfg.models.claude, { model: "custom-claude", effort: "high" });
  assert.deepEqual(cfg.models.codex, { model: "custom-codex", effort: "medium" });
});

test("models は pi / claude / codex のすべてで入れ子の部分上書きができる", () => {
  const cfg = loadConfig(repoWith({
    test: { command: "npm test" },
    models: {
      pi: { effort: "high" },
      claude: { effort: "low" },
      codex: { effort: "xhigh" },
    },
  }));
  assert.deepEqual(cfg.models.pi, { provider: "opencode-go", model: "deepseek-v4.1-flash", effort: "high" });
  assert.deepEqual(cfg.models.claude, { model: "claude-fable-5-1", effort: "low" });
  assert.deepEqual(cfg.models.codex, { effort: "xhigh" });
});

test("設定ファイルが無ければ init を案内するエラー", () => {
  assert.throws(() => loadConfig(repoWith(undefined)), /loopi init/);
});

test("--config で明示したパスは init を案内しない", () => {
  const dir = repoWith(undefined);
  assert.throws(() => loadConfig(dir, "other.json"), (e: Error) => /設定ファイルがありません/.test(e.message) && !/loopi init/.test(e.message));
});

test("JSON として壊れていればエラー", () => {
  const dir = repoWith(undefined);
  fs.writeFileSync(path.join(dir, CONFIG_FILENAME), "{ not json");
  assert.throws(() => loadConfig(dir), /JSON として読めません/);
});

test("test.command が無ければエラー", () => {
  assert.throws(() => loadConfig(repoWith({})), /test\.command/);
  assert.throws(() => loadConfig(repoWith({ test: {} })), /test\.command/);
});

test("limits の下限を検証する", () => {
  assert.throws(() => loadConfig(repoWith({ test: { command: "x" }, limits: { maxReviewRounds: 0 } })), /maxReviewRounds/);
  assert.throws(() => loadConfig(repoWith({ test: { command: "x" }, limits: { maxTestFixes: -1 } })), /maxTestFixes/);
  assert.equal(loadConfig(repoWith({ test: { command: "x" }, limits: { maxTestFixes: 0 } })).limits.maxTestFixes, 0);
});

test("docRef は指定された参照ドキュメントだけを案内する", () => {
  const base = { test: { command: "x" } };
  assert.equal(docRef(loadConfig(repoWith(base))), "");
  assert.equal(docRef(loadConfig(repoWith({ ...base, docs: { agents: "AGENTS.md" } }))), "AGENTS.md");
  assert.equal(
    docRef(loadConfig(repoWith({ ...base, docs: { agents: "AGENTS.md", spec: "docs/spec/", adr: "docs/adr/" } }))),
    "AGENTS.md と、issue に書かれた関連ドキュメント（docs/spec/, docs/adr/）",
  );
  assert.equal(docRef(loadConfig(repoWith({ ...base, docs: { adr: "docs/adr/" } }))), "issue に書かれた関連ドキュメント（docs/adr/）");
});

test("docSentence は参照ドキュメントが無ければ空文字", () => {
  const base = { test: { command: "x" } };
  assert.equal(docSentence(loadConfig(repoWith(base)), ref => `まず ${ref} を読む`), "");
  assert.equal(docSentence(loadConfig(repoWith({ ...base, docs: { agents: "AGENTS.md" } })), ref => `まず ${ref} を読む`), "まず AGENTS.md を読む");
});
