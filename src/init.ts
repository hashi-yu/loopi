// loopi の導入コマンド（設計: agent-lab docs/adr/0005）
//
// 書き込むのは loopi 自身のもの 2 つだけ:
//   - loopi.config.json
//   - .claude/skills/loopi-run/
// AGENTS.md・spec / ADR の置き場・issue テンプレートは、あるものを使う。
// 無い場合は「何のために必要か」を示して追加を提案するだけで、雛形は置かない。

import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { CONFIG_FILENAME } from "./config.js";

const TEMPLATES = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "templates");

type Suggestion = { what: string; why: string };

function detectBaseBranch(repo: string): string {
  try {
    const head = execSync("git symbolic-ref --quiet refs/remotes/origin/HEAD", { cwd: repo, encoding: "utf8", stdio: "pipe" }).trim();
    if (head) return head.replace("refs/remotes/origin/", "");
  } catch { /* origin/HEAD が無い場合は下で推測する */ }
  try {
    return execSync("git branch --show-current", { cwd: repo, encoding: "utf8", stdio: "pipe" }).trim() || "main";
  } catch { return "main"; }
}

/** リポジトリの中身からテストコマンドを推測する。外したら人が直せばよい */
function detectTest(repo: string): { command: string; reportCommand: string; testDir?: string } {
  const has = (p: string) => fs.existsSync(path.join(repo, p));
  if (has("pyproject.toml") || has("pytest.ini") || has("tests") && has("setup.py"))
    return { command: "python -m pytest -q", reportCommand: "python -m pytest -v --tb=short", testDir: has("tests") ? "tests/" : undefined };
  if (has("go.mod")) return { command: "go test ./...", reportCommand: "go test -v ./..." };
  if (has("Cargo.toml")) return { command: "cargo test -q", reportCommand: "cargo test -- --nocapture" };
  if (has("package.json")) return { command: "npm test", reportCommand: "npm test" };
  if (has("tests")) return { command: "python -m pytest -q", reportCommand: "python -m pytest -v --tb=short", testDir: "tests/" };
  return { command: "", reportCommand: "" };
}

function firstExisting(repo: string, candidates: string[]): string | undefined {
  return candidates.find(c => fs.existsSync(path.join(repo, c)));
}

export function init(opts: { force: boolean }): never {
  const repo = process.cwd();
  if (!fs.existsSync(path.join(repo, ".git"))) {
    console.error("git リポジトリのルートで実行してください。");
    process.exit(1);
  }

  const wrote: string[] = [];
  const skipped: string[] = [];
  const suggestions: Suggestion[] = [];

  // ───────── 参照ドキュメント: あるものを使い、無ければ提案するだけ ─────────
  const agents = firstExisting(repo, ["AGENTS.md", "CLAUDE.md"]);
  const spec = firstExisting(repo, ["docs/spec/", "docs/specs/", "spec/"]);
  const adr = firstExisting(repo, ["docs/adr/", "docs/decisions/", "adr/"]);
  const issueTemplate = firstExisting(repo, [".github/ISSUE_TEMPLATE/"]);

  if (!agents) suggestions.push({
    what: "AGENTS.md",
    why: "実装担当・レビュー担当が最初に読む共通ルール（言語、テストの書き方、触ってはいけないパス、止めて人間に回す条件）。無いと各エージェントがリポジトリの作法を知らないまま作業する。",
  });
  if (!spec) suggestions.push({
    what: "docs/spec/",
    why: "「何が正しい挙動か」の出典。レビューが受け入れ条件の未達を判定する根拠になる。無いと issue 本文だけが唯一の仕様になる。",
  });
  if (!adr) suggestions.push({
    what: "docs/adr/",
    why: "決定済みの設計判断。レビューでの指摘の却下根拠、および「これに反する変更は人間に回す」の判定に使う。",
  });
  if (!issueTemplate) suggestions.push({
    what: ".github/ISSUE_TEMPLATE/",
    why: "issue が唯一の作業指示になるため、背景・受け入れ条件・触ってよいファイル・スコープ外を毎回埋める型が要る。",
  });

  // ───────── loopi.config.json ─────────
  const configFile = path.join(repo, CONFIG_FILENAME);
  if (fs.existsSync(configFile) && !opts.force) {
    skipped.push(CONFIG_FILENAME);
  } else {
    const test = detectTest(repo);
    const cfg: Record<string, unknown> = {
      baseBranch: detectBaseBranch(repo),
      docs: {
        ...(agents ? { agents } : {}),
        ...(spec ? { spec } : {}),
        ...(adr ? { adr } : {}),
      },
      code: test.testDir ? { testDir: test.testDir } : {},
      protectedPaths: [adr, agents, ".github/", ".claude/"].filter(Boolean),
      holdOnChange: [spec].filter(Boolean),
      test: { command: test.command, reportCommand: test.reportCommand },
      models: { pi: { provider: "opencode-go", model: "deepseek-v4.1-flash" }, claude: "claude-fable-5-1" },
      limits: { maxReviewRounds: 3, maxTestFixes: 3 },
      noAutomergeLabel: "no-automerge",
    };
    fs.writeFileSync(configFile, JSON.stringify(cfg, null, 2) + "\n");
    wrote.push(CONFIG_FILENAME);
    if (!test.command) suggestions.push({
      what: `${CONFIG_FILENAME} の test.command`,
      why: "テストコマンドを推測できなかった。パイプラインはテストの合否で進むため、ここが空だと動かない。",
    });
  }

  // ───────── .claude/skills/loopi-run/ ─────────
  const skillDir = path.join(repo, ".claude", "skills", "loopi-run");
  const skillFile = path.join(skillDir, "SKILL.md");
  if (fs.existsSync(skillFile) && !opts.force) {
    skipped.push(".claude/skills/loopi-run/SKILL.md");
  } else {
    fs.mkdirSync(skillDir, { recursive: true });
    fs.copyFileSync(path.join(TEMPLATES, "skills", "loopi-run", "SKILL.md"), skillFile);
    wrote.push(".claude/skills/loopi-run/SKILL.md");
  }

  // ───────── .claude/settings.json: 無ければ作る / あれば追記案を出すだけ ─────────
  const permissions = {
    allow: [
      "Bash(npx github:hashi-yu/loopi run *)",
      "Bash(gh issue view *)",
      "Bash(gh issue list *)",
      "Bash(gh pr view *)",
      "Bash(gh pr diff *)",
      "Bash(gh pr list *)",
      "Bash(gh pr comment *)",
      "Bash(git worktree list *)",
      "Bash(tail *)",
      "Read(logs/**)",
    ],
    ask: ["Bash(gh pr merge *)"],
  };
  const settingsFile = path.join(repo, ".claude", "settings.json");
  let settingsAdvice = "";
  if (fs.existsSync(settingsFile)) {
    let current: any = {};
    try { current = JSON.parse(fs.readFileSync(settingsFile, "utf8")); } catch { /* 壊れていても触らない */ }
    const have: string[] = current?.permissions?.allow ?? [];
    const missing = permissions.allow.filter(p => !have.includes(p));
    if (missing.length) settingsAdvice = `.claude/settings.json の permissions.allow に追記すると確認を減らせます:\n${missing.map(m => `    ${JSON.stringify(m)},`).join("\n")}`;
  } else {
    fs.mkdirSync(path.dirname(settingsFile), { recursive: true });
    fs.writeFileSync(settingsFile, JSON.stringify({ permissions }, null, 2) + "\n");
    wrote.push(".claude/settings.json");
  }

  // ───────── 報告 ─────────
  console.log("loopi init\n");
  if (wrote.length) console.log(`作成:\n${wrote.map(w => `  - ${w}`).join("\n")}\n`);
  if (skipped.length) console.log(`既にあるので触っていません（上書きするなら --force）:\n${skipped.map(s => `  - ${s}`).join("\n")}\n`);
  const found = [agents, spec, adr, issueTemplate].filter(Boolean) as string[];
  if (found.length) console.log(`見つかった参照ドキュメント（そのまま使います）:\n${found.map(f => `  - ${f}`).join("\n")}\n`);
  if (suggestions.length) {
    console.log("追加を検討してください（loopi は勝手に作りません）:");
    for (const s of suggestions) console.log(`  - ${s.what}\n      ${s.why}`);
    console.log("");
  }
  if (settingsAdvice) console.log(settingsAdvice + "\n");
  console.log(`次: ${CONFIG_FILENAME} を確認してから \`npx github:hashi-yu/loopi run <issue番号>\``);
  process.exit(0);
}
