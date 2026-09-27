// claudeChildEnv の挙動（claude -p に effort の環境変数を渡さない）
import assert from "node:assert/strict";
import { test } from "node:test";
import { claudeChildEnv } from "../src/env.js";

test("CLAUDE_EFFORT と CLAUDE_CODE_EFFORT_LEVEL だけを取り除き、他のキーは保持する", () => {
  const env = {
    CLAUDE_EFFORT: "high",
    CLAUDE_CODE_EFFORT_LEVEL: "high",
    CLAUDE_CODE_ENTRYPOINT: "cli",
    PATH: "/usr/bin:/bin",
    GIT_TERMINAL_PROMPT: "0",
  };
  assert.deepEqual(claudeChildEnv(env), {
    CLAUDE_CODE_ENTRYPOINT: "cli",
    PATH: "/usr/bin:/bin",
    GIT_TERMINAL_PROMPT: "0",
  });
  // 渡した env 自体は変更しない
  assert.equal(env.CLAUDE_EFFORT, "high");
  assert.equal(env.CLAUDE_CODE_EFFORT_LEVEL, "high");
});

test("2 つが無い env は同じ内容で返す", () => {
  const env = { CLAUDE_CODE_ENTRYPOINT: "cli", PATH: "/usr/bin:/bin" };
  assert.deepEqual(claudeChildEnv(env), env);
});
