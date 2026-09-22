// templates/ と .claude/ の loopi-run skill が乖離していないことの確認
//
// templates/skills/loopi-run/SKILL.md は `loopi init` が対象リポジトリへコピーする元、
// .claude/skills/loopi-run/SKILL.md はこのリポジトリで Claude Code が実際に読むコピー。
// 片方だけを直すと、配布される skill と dogfooding で動く skill が食い違う。
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const TEMPLATE_REL = "templates/skills/loopi-run/SKILL.md";
const CLAUDE_REL = ".claude/skills/loopi-run/SKILL.md";

/** 2 つの path の内容が等しいことを検証する。異なれば反映手順を添えて失敗する */
function assertSkillInSync(templateFile: string, claudeFile: string): void {
  const template = fs.readFileSync(templateFile, "utf8");
  const claude = fs.readFileSync(claudeFile, "utf8");
  assert.equal(
    claude,
    template,
    `${CLAUDE_REL} が ${TEMPLATE_REL} と一致しません。次のコマンドで反映してください:\n  cp ${TEMPLATE_REL} ${CLAUDE_REL}`,
  );
}

test("templates と .claude の loopi-run skill が同一", () => {
  assertSkillInSync(path.join(REPO_ROOT, TEMPLATE_REL), path.join(REPO_ROOT, CLAUDE_REL));
});

test("内容が異なれば cp コマンドを含むメッセージで失敗する", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "loopi-skill-"));
  const template = path.join(dir, "template.md");
  const claude = path.join(dir, "claude.md");
  fs.writeFileSync(template, "新しい手順\n");
  fs.writeFileSync(claude, "古い手順\n");

  assert.throws(
    () => assertSkillInSync(template, claude),
    (e: Error) =>
      e.message.includes(`cp ${TEMPLATE_REL} ${CLAUDE_REL}`) &&
      e.message.includes(TEMPLATE_REL) &&
      e.message.includes(CLAUDE_REL),
  );
});
