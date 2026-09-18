#!/usr/bin/env node

// src/cli.ts
import fs4 from "node:fs";
import path4 from "node:path";
import { fileURLToPath as fileURLToPath2 } from "node:url";

// src/init.ts
import { execSync } from "node:child_process";
import fs2 from "node:fs";
import path2 from "node:path";
import { fileURLToPath } from "node:url";

// src/config.ts
import fs from "node:fs";
import path from "node:path";
var CONFIG_FILENAME = "loopi.config.json";
var DEFAULTS = {
  baseBranch: "main",
  branchPrefix: "issue-",
  worktreeDir: "..",
  docs: {},
  code: {},
  protectedPaths: [],
  holdOnChange: [],
  models: { pi: { provider: "opencode-go", model: "deepseek-v4.1-flash" }, claude: "claude-fable-5-1" },
  limits: { maxReviewRounds: 3, maxTestFixes: 3 },
  noAutomergeLabel: "no-automerge"
};
function configPath(repo, explicit) {
  return explicit ? path.resolve(repo, explicit) : path.join(repo, CONFIG_FILENAME);
}
function loadConfig(repo, explicit) {
  const file = configPath(repo, explicit);
  if (!fs.existsSync(file)) {
    throw new Error(
      `\u8A2D\u5B9A\u30D5\u30A1\u30A4\u30EB\u304C\u3042\u308A\u307E\u305B\u3093: ${file}
` + (explicit ? "" : `\u30EA\u30DD\u30B8\u30C8\u30EA\u306E\u30EB\u30FC\u30C8\u3067 \`loopi init\` \u3092\u5B9F\u884C\u3059\u308B\u3068 ${CONFIG_FILENAME} \u306E\u96DB\u5F62\u3092\u4F5C\u308C\u307E\u3059\u3002`)
    );
  }
  let raw;
  try {
    raw = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (e) {
    throw new Error(`\u8A2D\u5B9A\u30D5\u30A1\u30A4\u30EB\u3092 JSON \u3068\u3057\u3066\u8AAD\u3081\u307E\u305B\u3093: ${file}
${e.message}`);
  }
  const cfg = {
    ...DEFAULTS,
    ...raw,
    docs: { ...DEFAULTS.docs, ...raw.docs ?? {} },
    code: { ...DEFAULTS.code, ...raw.code ?? {} },
    models: {
      pi: { ...DEFAULTS.models.pi, ...raw.models?.pi ?? {} },
      claude: raw.models?.claude ?? DEFAULTS.models.claude
    },
    limits: { ...DEFAULTS.limits, ...raw.limits ?? {} },
    test: raw.test ?? {}
  };
  if (!cfg.test?.command) throw new Error(`${file} \u306B test.command \u304C\u3042\u308A\u307E\u305B\u3093\uFF08\u4F8B: "python -m pytest -q"\uFF09`);
  cfg.test.reportCommand ||= cfg.test.command;
  if (cfg.limits.maxReviewRounds < 1) throw new Error(`${file} \u306E limits.maxReviewRounds \u306F 1 \u4EE5\u4E0A\u306B\u3057\u3066\u304F\u3060\u3055\u3044`);
  if (cfg.limits.maxTestFixes < 0) throw new Error(`${file} \u306E limits.maxTestFixes \u306F 0 \u4EE5\u4E0A\u306B\u3057\u3066\u304F\u3060\u3055\u3044`);
  return cfg;
}
function docRef(cfg) {
  const parts = [];
  if (cfg.docs.agents) parts.push(cfg.docs.agents);
  const specAdr = [cfg.docs.spec, cfg.docs.adr].filter(Boolean);
  if (specAdr.length) parts.push(`issue \u306B\u66F8\u304B\u308C\u305F\u95A2\u9023\u30C9\u30AD\u30E5\u30E1\u30F3\u30C8\uFF08${specAdr.join(", ")}\uFF09`);
  return parts.join(" \u3068\u3001");
}
function docSentence(cfg, template) {
  const ref = docRef(cfg);
  return ref ? template(ref) : "";
}

// src/init.ts
var TEMPLATES = path2.resolve(path2.dirname(fileURLToPath(import.meta.url)), "..", "templates");
function detectBaseBranch(repo) {
  try {
    const head = execSync("git symbolic-ref --quiet refs/remotes/origin/HEAD", { cwd: repo, encoding: "utf8", stdio: "pipe" }).trim();
    if (head) return head.replace("refs/remotes/origin/", "");
  } catch {
  }
  try {
    return execSync("git branch --show-current", { cwd: repo, encoding: "utf8", stdio: "pipe" }).trim() || "main";
  } catch {
    return "main";
  }
}
function detectTest(repo) {
  const has = (p) => fs2.existsSync(path2.join(repo, p));
  if (has("pyproject.toml") || has("pytest.ini") || has("tests") && has("setup.py"))
    return { command: "python -m pytest -q", reportCommand: "python -m pytest -v --tb=short", testDir: has("tests") ? "tests/" : void 0 };
  if (has("go.mod")) return { command: "go test ./...", reportCommand: "go test -v ./..." };
  if (has("Cargo.toml")) return { command: "cargo test -q", reportCommand: "cargo test -- --nocapture" };
  if (has("package.json")) return { command: "npm test", reportCommand: "npm test" };
  if (has("tests")) return { command: "python -m pytest -q", reportCommand: "python -m pytest -v --tb=short", testDir: "tests/" };
  return { command: "", reportCommand: "" };
}
function firstExisting(repo, candidates) {
  return candidates.find((c) => fs2.existsSync(path2.join(repo, c)));
}
function init(opts) {
  const repo = process.cwd();
  if (!fs2.existsSync(path2.join(repo, ".git"))) {
    console.error("git \u30EA\u30DD\u30B8\u30C8\u30EA\u306E\u30EB\u30FC\u30C8\u3067\u5B9F\u884C\u3057\u3066\u304F\u3060\u3055\u3044\u3002");
    process.exit(1);
  }
  const wrote = [];
  const skipped = [];
  const suggestions = [];
  const agents = firstExisting(repo, ["AGENTS.md", "CLAUDE.md"]);
  const spec = firstExisting(repo, ["docs/spec/", "docs/specs/", "spec/"]);
  const adr = firstExisting(repo, ["docs/adr/", "docs/decisions/", "adr/"]);
  const issueTemplate = firstExisting(repo, [".github/ISSUE_TEMPLATE/"]);
  if (!agents) suggestions.push({
    what: "AGENTS.md",
    why: "\u5B9F\u88C5\u62C5\u5F53\u30FB\u30EC\u30D3\u30E5\u30FC\u62C5\u5F53\u304C\u6700\u521D\u306B\u8AAD\u3080\u5171\u901A\u30EB\u30FC\u30EB\uFF08\u8A00\u8A9E\u3001\u30C6\u30B9\u30C8\u306E\u66F8\u304D\u65B9\u3001\u89E6\u3063\u3066\u306F\u3044\u3051\u306A\u3044\u30D1\u30B9\u3001\u6B62\u3081\u3066\u4EBA\u9593\u306B\u56DE\u3059\u6761\u4EF6\uFF09\u3002\u7121\u3044\u3068\u5404\u30A8\u30FC\u30B8\u30A7\u30F3\u30C8\u304C\u30EA\u30DD\u30B8\u30C8\u30EA\u306E\u4F5C\u6CD5\u3092\u77E5\u3089\u306A\u3044\u307E\u307E\u4F5C\u696D\u3059\u308B\u3002"
  });
  if (!spec) suggestions.push({
    what: "docs/spec/",
    why: "\u300C\u4F55\u304C\u6B63\u3057\u3044\u6319\u52D5\u304B\u300D\u306E\u51FA\u5178\u3002\u30EC\u30D3\u30E5\u30FC\u304C\u53D7\u3051\u5165\u308C\u6761\u4EF6\u306E\u672A\u9054\u3092\u5224\u5B9A\u3059\u308B\u6839\u62E0\u306B\u306A\u308B\u3002\u7121\u3044\u3068 issue \u672C\u6587\u3060\u3051\u304C\u552F\u4E00\u306E\u4ED5\u69D8\u306B\u306A\u308B\u3002"
  });
  if (!adr) suggestions.push({
    what: "docs/adr/",
    why: "\u6C7A\u5B9A\u6E08\u307F\u306E\u8A2D\u8A08\u5224\u65AD\u3002\u30EC\u30D3\u30E5\u30FC\u3067\u306E\u6307\u6458\u306E\u5374\u4E0B\u6839\u62E0\u3001\u304A\u3088\u3073\u300C\u3053\u308C\u306B\u53CD\u3059\u308B\u5909\u66F4\u306F\u4EBA\u9593\u306B\u56DE\u3059\u300D\u306E\u5224\u5B9A\u306B\u4F7F\u3046\u3002"
  });
  if (!issueTemplate) suggestions.push({
    what: ".github/ISSUE_TEMPLATE/",
    why: "issue \u304C\u552F\u4E00\u306E\u4F5C\u696D\u6307\u793A\u306B\u306A\u308B\u305F\u3081\u3001\u80CC\u666F\u30FB\u53D7\u3051\u5165\u308C\u6761\u4EF6\u30FB\u89E6\u3063\u3066\u3088\u3044\u30D5\u30A1\u30A4\u30EB\u30FB\u30B9\u30B3\u30FC\u30D7\u5916\u3092\u6BCE\u56DE\u57CB\u3081\u308B\u578B\u304C\u8981\u308B\u3002"
  });
  const configFile = path2.join(repo, CONFIG_FILENAME);
  if (fs2.existsSync(configFile) && !opts.force) {
    skipped.push(CONFIG_FILENAME);
  } else {
    const test = detectTest(repo);
    const cfg = {
      baseBranch: detectBaseBranch(repo),
      docs: {
        ...agents ? { agents } : {},
        ...spec ? { spec } : {},
        ...adr ? { adr } : {}
      },
      code: test.testDir ? { testDir: test.testDir } : {},
      protectedPaths: [adr, agents, ".github/", ".claude/"].filter(Boolean),
      holdOnChange: [spec].filter(Boolean),
      test: { command: test.command, reportCommand: test.reportCommand },
      models: { pi: { provider: "opencode-go", model: "deepseek-v4.1-flash" }, claude: "claude-fable-5-1" },
      limits: { maxReviewRounds: 3, maxTestFixes: 3 },
      noAutomergeLabel: "no-automerge"
    };
    fs2.writeFileSync(configFile, JSON.stringify(cfg, null, 2) + "\n");
    wrote.push(CONFIG_FILENAME);
    if (!test.command) suggestions.push({
      what: `${CONFIG_FILENAME} \u306E test.command`,
      why: "\u30C6\u30B9\u30C8\u30B3\u30DE\u30F3\u30C9\u3092\u63A8\u6E2C\u3067\u304D\u306A\u304B\u3063\u305F\u3002\u30D1\u30A4\u30D7\u30E9\u30A4\u30F3\u306F\u30C6\u30B9\u30C8\u306E\u5408\u5426\u3067\u9032\u3080\u305F\u3081\u3001\u3053\u3053\u304C\u7A7A\u3060\u3068\u52D5\u304B\u306A\u3044\u3002"
    });
  }
  const skillDir = path2.join(repo, ".claude", "skills", "loopi-run");
  const skillFile = path2.join(skillDir, "SKILL.md");
  if (fs2.existsSync(skillFile) && !opts.force) {
    skipped.push(".claude/skills/loopi-run/SKILL.md");
  } else {
    fs2.mkdirSync(skillDir, { recursive: true });
    fs2.copyFileSync(path2.join(TEMPLATES, "skills", "loopi-run", "SKILL.md"), skillFile);
    wrote.push(".claude/skills/loopi-run/SKILL.md");
  }
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
      "Read(logs/**)"
    ],
    ask: ["Bash(gh pr merge *)"]
  };
  const settingsFile = path2.join(repo, ".claude", "settings.json");
  let settingsAdvice = "";
  if (fs2.existsSync(settingsFile)) {
    let current = {};
    try {
      current = JSON.parse(fs2.readFileSync(settingsFile, "utf8"));
    } catch {
    }
    const have = current?.permissions?.allow ?? [];
    const missing = permissions.allow.filter((p) => !have.includes(p));
    if (missing.length) settingsAdvice = `.claude/settings.json \u306E permissions.allow \u306B\u8FFD\u8A18\u3059\u308B\u3068\u78BA\u8A8D\u3092\u6E1B\u3089\u305B\u307E\u3059:
${missing.map((m) => `    ${JSON.stringify(m)},`).join("\n")}`;
  } else {
    fs2.mkdirSync(path2.dirname(settingsFile), { recursive: true });
    fs2.writeFileSync(settingsFile, JSON.stringify({ permissions }, null, 2) + "\n");
    wrote.push(".claude/settings.json");
  }
  console.log("loopi init\n");
  if (wrote.length) console.log(`\u4F5C\u6210:
${wrote.map((w) => `  - ${w}`).join("\n")}
`);
  if (skipped.length) console.log(`\u65E2\u306B\u3042\u308B\u306E\u3067\u89E6\u3063\u3066\u3044\u307E\u305B\u3093\uFF08\u4E0A\u66F8\u304D\u3059\u308B\u306A\u3089 --force\uFF09:
${skipped.map((s) => `  - ${s}`).join("\n")}
`);
  const found = [agents, spec, adr, issueTemplate].filter(Boolean);
  if (found.length) console.log(`\u898B\u3064\u304B\u3063\u305F\u53C2\u7167\u30C9\u30AD\u30E5\u30E1\u30F3\u30C8\uFF08\u305D\u306E\u307E\u307E\u4F7F\u3044\u307E\u3059\uFF09:
${found.map((f) => `  - ${f}`).join("\n")}
`);
  if (suggestions.length) {
    console.log("\u8FFD\u52A0\u3092\u691C\u8A0E\u3057\u3066\u304F\u3060\u3055\u3044\uFF08loopi \u306F\u52DD\u624B\u306B\u4F5C\u308A\u307E\u305B\u3093\uFF09:");
    for (const s of suggestions) console.log(`  - ${s.what}
      ${s.why}`);
    console.log("");
  }
  if (settingsAdvice) console.log(settingsAdvice + "\n");
  console.log(`\u6B21: ${CONFIG_FILENAME} \u3092\u78BA\u8A8D\u3057\u3066\u304B\u3089 \`npx github:hashi-yu/loopi run <issue\u756A\u53F7>\``);
  process.exit(0);
}

// src/run.ts
import { execSync as execSync2, spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs3 from "node:fs";
import path3 from "node:path";
import { createAgentSession, ModelRuntime, SessionManager } from "@earendil-works/pi-coding-agent";
import { Codex } from "@openai/codex-sdk";
async function run(opts) {
  const n = opts.issue;
  const NO_MERGE = opts.noMerge;
  const FRESH = opts.fresh;
  const repo = process.cwd();
  let cfg;
  try {
    cfg = loadConfig(repo, opts.config);
  } catch (e) {
    console.error(e.message);
    process.exit(1);
  }
  const PI_PROVIDER = process.env.PI_PROVIDER ?? cfg.models.pi.provider;
  const PI_MODEL = process.env.PI_MODEL ?? cfg.models.pi.model;
  const CLAUDE_MODEL = process.env.CLAUDE_MODEL ?? cfg.models.claude;
  const MAX_REVIEW_ROUNDS = cfg.limits.maxReviewRounds;
  const MAX_TEST_FIXES = cfg.limits.maxTestFixes;
  const TEST_CMD = cfg.test.command;
  const TEST_REPORT_CMD = cfg.test.reportCommand;
  const PROTECTED = cfg.protectedPaths;
  const BASE = cfg.baseBranch;
  const ORIGIN_BASE = `origin/${BASE}`;
  const branch = `${cfg.branchPrefix}${n}`;
  const wt = path3.resolve(repo, cfg.worktreeDir, `wt-${branch}`);
  fs3.mkdirSync(path3.join(repo, "logs"), { recursive: true });
  const LOG = path3.join(repo, "logs", `issue-${n}.log`);
  const STATUS = path3.join(repo, "logs", `issue-${n}.status.json`);
  const STATE = path3.join(repo, "logs", `issue-${n}.state.json`);
  let state = {};
  if (FRESH) fs3.rmSync(STATE, { force: true });
  else if (fs3.existsSync(STATE)) {
    try {
      state = JSON.parse(fs3.readFileSync(STATE, "utf8"));
    } catch {
      state = {};
    }
  }
  function saveState(patch) {
    state = { ...state, ...patch };
    fs3.writeFileSync(STATE, JSON.stringify(state, null, 2));
  }
  const NON_INTERACTIVE = { ...process.env, GIT_TERMINAL_PROMPT: "0", GIT_SSH_COMMAND: "ssh -o BatchMode=yes" };
  function write(text) {
    process.stdout.write(text);
    fs3.appendFileSync(LOG, text);
  }
  function log(m) {
    write(`

===== [${(/* @__PURE__ */ new Date()).toLocaleTimeString("ja-JP")}] ${m} =====
`);
  }
  function runCmd(cmd, cwd = repo) {
    try {
      return { ok: true, out: execSync2(cmd, { cwd, encoding: "utf8", stdio: "pipe", env: NON_INTERACTIVE, maxBuffer: 64 * 1024 * 1024 }) };
    } catch (e) {
      return { ok: false, out: `${e.stdout ?? ""}${e.stderr ?? ""}` };
    }
  }
  function must(cmd, cwd = repo) {
    const r = runCmd(cmd, cwd);
    if (!r.ok) fail(`\u30B3\u30DE\u30F3\u30C9\u5931\u6557: ${cmd}
${r.out}`);
    return r.out;
  }
  const sha = (text) => crypto.createHash("sha256").update(text).digest("hex").slice(0, 16);
  function shq(s) {
    return `'${s.replace(/'/g, `'\\''`)}'`;
  }
  function setStatus(status, extra = {}) {
    fs3.writeFileSync(STATUS, JSON.stringify({ issue: Number(n), status, updatedAt: (/* @__PURE__ */ new Date()).toISOString(), log: LOG, worktree: wt, ...extra }, null, 2));
  }
  function fail(msg) {
    log(`\u30A8\u30E9\u30FC: ${msg}`);
    setStatus("error", { reason: msg });
    process.exit(1);
  }
  function escalate(reason, detail = "") {
    log(`\u4EBA\u9593\u306E\u5224\u65AD\u304C\u5FC5\u8981: ${reason}`);
    write(detail + "\n");
    runCmd(`gh issue comment ${n} --body ${shq(`### \u{1F6D1} \u81EA\u52D5\u30D1\u30A4\u30D7\u30E9\u30A4\u30F3\u505C\u6B62

**\u7406\u7531:** ${reason}

${detail}

\u4F5C\u696D\u30D5\u30A9\u30EB\u30C0: \`${wt}\`
\u30ED\u30B0: \`logs/issue-${n}.log\``)}`);
    setStatus("escalated", { reason, detail });
    process.exit(2);
  }
  function changedFiles() {
    runCmd("git add -A", wt);
    return must(`git diff --cached --name-only ${ORIGIN_BASE}`, wt).split("\n").filter(Boolean);
  }
  function stagedDiff() {
    runCmd("git add -A", wt);
    return must(`git diff --cached ${ORIGIN_BASE}`, wt);
  }
  function checkProtected() {
    if (PROTECTED.length === 0) return;
    const bad = changedFiles().filter((f) => PROTECTED.some((p) => f === p || f.startsWith(p)));
    if (bad.length) escalate("\u5B9F\u88C5\u62C5\u5F53\u304C\u4FDD\u8B77\u3055\u308C\u305F\u30D5\u30A1\u30A4\u30EB\u3092\u5909\u66F4\u3057\u307E\u3057\u305F", bad.map((f) => `- ${f}`).join("\n"));
  }
  function askClaude(prompt, input, schema) {
    const r = spawnSync("claude", [
      "-p",
      prompt,
      "--model",
      CLAUDE_MODEL,
      "--output-format",
      "json",
      "--json-schema",
      JSON.stringify(schema),
      "--permission-mode",
      "dontAsk",
      "--allowedTools",
      "Read,Grep,Glob"
    ], { cwd: wt, input, encoding: "utf8", maxBuffer: 64 * 1024 * 1024, env: NON_INTERACTIVE });
    if (r.status !== 0) fail(`claude -p \u304C\u5931\u6557\u3057\u307E\u3057\u305F (exit ${r.status})
${r.stderr}
${r.stdout?.slice(-2e3)}`);
    let res;
    try {
      res = JSON.parse(r.stdout);
    } catch {
      fail(`claude -p \u306E\u51FA\u529B\u3092 JSON \u3068\u3057\u3066\u8AAD\u3081\u307E\u305B\u3093:
${r.stdout.slice(-2e3)}`);
    }
    if (Array.isArray(res)) res = res.filter((m) => m?.type === "result").at(-1) ?? {};
    if (res.is_error || !res.structured_output) fail(`claude -p \u304C\u69CB\u9020\u5316\u51FA\u529B\u3092\u8FD4\u3057\u307E\u305B\u3093\u3067\u3057\u305F:
${JSON.stringify(res).slice(0, 2e3)}`);
    if (typeof res.total_cost_usd === "number") write(`(Claude \u63A8\u5B9A\u30B3\u30B9\u30C8: $${res.total_cost_usd.toFixed(3)})
`);
    return res.structured_output;
  }
  fs3.appendFileSync(LOG, `

################ \u5B9F\u884C\u958B\u59CB ${(/* @__PURE__ */ new Date()).toISOString()} ################
`);
  setStatus("running");
  log(`issue #${n} \u958B\u59CB\uFF08pi: ${PI_PROVIDER}/${PI_MODEL}, claude: ${CLAUDE_MODEL}, base: ${BASE}${NO_MERGE ? ", --no-merge" : ""}${FRESH ? ", --fresh" : ""}\uFF09`);
  const issueJson = JSON.parse(must(`gh issue view ${n} --json number,title,body,labels,state`));
  if (issueJson.state !== "OPEN") fail(`issue #${n} \u306F ${issueJson.state} \u3067\u3059`);
  const labels = issueJson.labels.map((l) => l.name);
  const ISSUE = `# #${issueJson.number} ${issueJson.title}

${issueJson.body}`;
  const reviewKey = (diff) => sha(`${diff}
---
${ISSUE}`);
  must("git fetch origin");
  if (!runCmd(`git rev-parse --verify ${ORIGIN_BASE}`).ok) fail(`\u57FA\u6E96\u30D6\u30E9\u30F3\u30C1\u304C\u898B\u3064\u304B\u308A\u307E\u305B\u3093: ${ORIGIN_BASE}\uFF08loopi.config.json \u306E baseBranch \u3092\u78BA\u8A8D\u3057\u3066\u304F\u3060\u3055\u3044\uFF09`);
  if (fs3.existsSync(wt)) {
    log(`\u65E2\u5B58\u306E\u4F5C\u696D\u30D5\u30A9\u30EB\u30C0\u3092\u518D\u5229\u7528: ${wt}`);
  } else if (runCmd(`git rev-parse --verify ${branch}`).ok) {
    must(`git worktree add ${shq(wt)} ${branch}`);
    log(`\u65E2\u5B58\u30D6\u30E9\u30F3\u30C1 ${branch} \u3067\u4F5C\u696D\u30D5\u30A9\u30EB\u30C0\u3092\u4F5C\u6210`);
  } else {
    must(`git worktree add ${shq(wt)} -b ${branch} ${ORIGIN_BASE}`);
    log(`\u4F5C\u696D\u30D5\u30A9\u30EB\u30C0\u3092\u4F5C\u6210: ${wt}`);
  }
  const readDocs = docSentence(cfg, (ref) => `\u307E\u305A ${ref} \u3092\u8AAD\u3093\u3067\u304F\u3060\u3055\u3044\u3002
`);
  const testFileLine = cfg.code.testDir ? `- \u53D7\u3051\u5165\u308C\u6761\u4EF6\u3054\u3068\u306B ${cfg.code.testDir} \u306B\u30C6\u30B9\u30C8\u3092\u66F8\u304F` : `- \u53D7\u3051\u5165\u308C\u6761\u4EF6\u3054\u3068\u306B\u30C6\u30B9\u30C8\u3092\u66F8\u304F`;
  const protectedLine = PROTECTED.length ? `
- \u300C\u89E6\u3063\u3066\u3088\u3044\u30D5\u30A1\u30A4\u30EB\u300D\u4EE5\u5916\u3001\u304A\u3088\u3073\u6B21\u306E\u30D1\u30B9\u306F\u5909\u66F4\u3057\u306A\u3044: ${PROTECTED.join(", ")}` : "";
  const PI_CONTEXT = `\u3042\u306A\u305F\u306F\u3053\u306E\u30EA\u30DD\u30B8\u30C8\u30EA\u306E\u5B9F\u88C5\u62C5\u5F53\u3067\u3059\u3002
${readDocs}${testFileLine}
- \u5909\u66F4\u5F8C\u306F ${TEST_CMD} \u3092\u5B9F\u884C\u3057\u3001\u901A\u308B\u3053\u3068\u3092\u78BA\u8A8D\u3059\u308B
- git commit \u306F\u3057\u306A\u3044${protectedLine}
- \u6C7A\u5B9A\u6E08\u307F\u306E\u8A2D\u8A08\u5224\u65AD\u306B\u53CD\u3059\u308B\u5909\u66F4\u3084\u3001\u4ED5\u69D8\u306B\u306A\u3044\u5224\u65AD\u304C\u5FC5\u8981\u306B\u306A\u3063\u305F\u3089\u3001\u4F5C\u696D\u3092\u6B62\u3081\u3066\u305D\u306E\u65E8\u3092\u6700\u5F8C\u306B\u66F8\u304F

${ISSUE}`;
  let session = null;
  async function askPi(msg) {
    let prompt = msg;
    if (!session) {
      const modelRuntime = await ModelRuntime.create();
      const model = modelRuntime.getModel(PI_PROVIDER, PI_MODEL);
      if (!model) fail(`\u30E2\u30C7\u30EB\u304C\u898B\u3064\u304B\u308A\u307E\u305B\u3093: ${PI_PROVIDER}/${PI_MODEL}`);
      ({ session } = await createAgentSession({ cwd: wt, sessionManager: SessionManager.inMemory(wt), modelRuntime, model }));
      session.subscribe((ev) => {
        if (ev.type === "message_update" && ev.assistantMessageEvent.type === "text_delta") write(ev.assistantMessageEvent.delta);
      });
      prompt = msg.startsWith(PI_CONTEXT) ? msg : `${PI_CONTEXT}

---
\u3053\u306E issue \u306E\u5B9F\u88C5\u306F\u4F5C\u696D\u30D5\u30A9\u30EB\u30C0\u306B\u65E2\u306B\u3042\u308A\u307E\u3059\u3002\u6B21\u306E\u5BFE\u5FDC\u3092\u3057\u3066\u304F\u3060\u3055\u3044:
${msg}`;
    }
    await session.prompt(prompt);
  }
  const existingChanges = changedFiles();
  if (existingChanges.length > 0) {
    log(`\u65E2\u5B58\u306E\u5B9F\u88C5\u3092\u518D\u5229\u7528\uFF08${existingChanges.length} \u30D5\u30A1\u30A4\u30EB\uFF09\u2192 pi \u306E\u521D\u56DE\u5B9F\u88C5\u3092\u30B9\u30AD\u30C3\u30D7`);
    write(existingChanges.map((f) => `- ${f}`).join("\n") + "\n");
  } else {
    log("pi: \u5B9F\u88C5");
    await askPi(`${PI_CONTEXT}

---
\u4E0A\u306E issue \u3092\u5B9F\u88C5\u3057\u3066\u304F\u3060\u3055\u3044\u3002`);
  }
  async function ensureTestsPass(round) {
    for (let i = 0; i <= MAX_TEST_FIXES; i++) {
      log(`\u30E9\u30A6\u30F3\u30C9${round}: \u30C6\u30B9\u30C8${i ? `\uFF08\u518D\u8A66\u884C${i}\uFF09` : ""}`);
      const t2 = runCmd(TEST_CMD, wt);
      write(t2.out.slice(-1500) + "\n");
      if (t2.ok) return;
      if (i === MAX_TEST_FIXES) escalate(`\u30C6\u30B9\u30C8\u304C ${MAX_TEST_FIXES} \u56DE\u306E\u4FEE\u6B63\u3067\u901A\u308A\u307E\u305B\u3093\u3067\u3057\u305F`, "```\n" + t2.out.slice(-3e3) + "\n```");
      log(`\u30E9\u30A6\u30F3\u30C9${round}: \u30C6\u30B9\u30C8\u5931\u6557 \u2192 pi \u306B\u4FEE\u6B63\u4F9D\u983C`);
      await askPi(`\u30C6\u30B9\u30C8\u304C\u5931\u6557\u3057\u3066\u3044\u307E\u3059\u3002\u539F\u56E0\u3092\u8ABF\u3079\u3066\u4FEE\u6B63\u3057\u3066\u304F\u3060\u3055\u3044:
${t2.out.slice(-4e3)}`);
    }
  }
  const codex = new Codex();
  const codexSchema = {
    type: "object",
    properties: {
      issues: {
        type: "array",
        items: {
          type: "object",
          properties: {
            severity: { type: "string", enum: ["high", "medium"] },
            file: { type: "string" },
            detail: { type: "string" }
          },
          required: ["severity", "file", "detail"],
          additionalProperties: false
        }
      }
    },
    required: ["issues"],
    additionalProperties: false
  };
  const triageSchema = {
    type: "object",
    properties: {
      decision: { type: "string", enum: ["fix", "done", "escalate"] },
      accepted: { type: "array", items: { type: "object", properties: { issue: { type: "string" }, instruction: { type: "string" } }, required: ["issue", "instruction"] } },
      rejected: { type: "array", items: { type: "object", properties: { issue: { type: "string" }, reason: { type: "string" } }, required: ["issue", "reason"] } },
      escalation_reason: { type: "string" }
    },
    required: ["decision", "accepted", "rejected"]
  };
  const triageRecord = [];
  let passed = false;
  for (let round = 1; round <= MAX_REVIEW_ROUNDS; round++) {
    await ensureTestsPass(round);
    checkProtected();
    const diff = stagedDiff();
    if (state.reviewPassedKey === reviewKey(diff)) {
      log("\u524D\u56DE\u306E\u30EC\u30D3\u30E5\u30FC\u5408\u683C\u6642\u304B\u3089\u5DEE\u5206\u30FBissue \u304C\u5909\u308F\u3063\u3066\u3044\u306A\u3044 \u2192 Codex \u30EC\u30D3\u30E5\u30FC\u3068\u53D6\u6368\u9078\u629E\u3092\u30B9\u30AD\u30C3\u30D7");
      triageRecord.push(...state.triage ?? []);
      passed = true;
      break;
    }
    log(`\u30E9\u30A6\u30F3\u30C9${round}: Codex \u30EC\u30D3\u30E5\u30FC`);
    const turn = await codex.startThread({ workingDirectory: wt }).run(
      `\u3042\u306A\u305F\u306F\u30B3\u30FC\u30C9\u30EC\u30D3\u30E5\u30A2\u30FC\u3067\u3059\u3002\u30D5\u30A1\u30A4\u30EB\u306F\u4E00\u5207\u5909\u66F4\u3057\u306A\u3044\u3067\u304F\u3060\u3055\u3044\u3002
${docSentence(cfg, (ref) => `${ref} \u3092\u8AAD\u3093\u3060\u3046\u3048\u3067\u3001
`)}\u4E0B\u306E\u5DEE\u5206\u3092\u30EC\u30D3\u30E5\u30FC\u3057\u3001\u91CD\u5927\u306A\u554F\u984C\u3060\u3051\u3092 issues \u306B\u6319\u3052\u3066\u304F\u3060\u3055\u3044:
- \u30D0\u30B0\u3001\u53D7\u3051\u5165\u308C\u6761\u4EF6\u306E\u672A\u9054\u3001\u4ED5\u69D8\u30FB\u8A2D\u8A08\u5224\u65AD\uFF08spec / ADR\uFF09\u9055\u53CD\u3001\u30C6\u30B9\u30C8\u4E0D\u8DB3\u3001\u30BB\u30AD\u30E5\u30EA\u30C6\u30A3
\u597D\u307F\u3084\u30B9\u30BF\u30A4\u30EB\u306E\u6307\u6458\u306F\u4E0D\u8981\u3067\u3059\u3002\u554F\u984C\u304C\u306A\u3051\u308C\u3070 issues \u306F\u7A7A\u914D\u5217\u306B\u3057\u3066\u304F\u3060\u3055\u3044\u3002

${ISSUE}

# \u5DEE\u5206
${diff.slice(0, 6e4)}`,
      { outputSchema: codexSchema }
    );
    const codexIssues = JSON.parse(turn.finalResponse).issues;
    write(JSON.stringify(codexIssues, null, 2) + "\n");
    if (stagedDiff() !== diff) escalate("Codex \u30EC\u30D3\u30E5\u30FC\u4E2D\u306B\u30D5\u30A1\u30A4\u30EB\u304C\u5909\u66F4\u3055\u308C\u307E\u3057\u305F");
    if (codexIssues.length === 0) {
      passed = true;
      break;
    }
    log(`\u30E9\u30A6\u30F3\u30C9${round}: Claude \u304C\u6307\u6458\u3092\u53D6\u6368\u9078\u629E\uFF08${codexIssues.length}\u4EF6\uFF09`);
    const triage = askClaude(
      `\u3042\u306A\u305F\u306F\u3053\u306E\u30EA\u30DD\u30B8\u30C8\u30EA\u306E\u8A2D\u8A08\u8CAC\u4EFB\u8005\u3067\u3059\u3002\u30D5\u30A1\u30A4\u30EB\u306F\u5909\u66F4\u3057\u306A\u3044\u3067\u304F\u3060\u3055\u3044\u3002
\u6A19\u6E96\u5165\u529B\u306B issue\u30FB\u5DEE\u5206\u30FBCodex \u306E\u30EC\u30D3\u30E5\u30FC\u6307\u6458\u304C\u3042\u308A\u307E\u3059\u3002
${docSentence(cfg, (ref) => `${ref} \u3092\u5FC5\u8981\u306B\u5FDC\u3058\u3066\u8AAD\u307F\u3001`)}\u5404\u6307\u6458\u3092\u5224\u65AD\u3057\u3066\u304F\u3060\u3055\u3044\u3002

- \u63A1\u7528: \u30D0\u30B0\u30FB\u53D7\u3051\u5165\u308C\u6761\u4EF6\u672A\u9054\u30FB\u4ED5\u69D8\u3084\u8A2D\u8A08\u5224\u65AD\u3078\u306E\u9055\u53CD\u306A\u3069\u3001\u76F4\u3059\u3079\u304D\u3082\u306E\u3002instruction \u306B\u306F\u5B9F\u88C5\u62C5\u5F53\uFF08\u80FD\u529B\u306E\u4F4E\u3081\u306A\u30E2\u30C7\u30EB\uFF09\u304C\u8FF7\u308F\u305A\u76F4\u305B\u308B\u5177\u4F53\u7684\u306A\u4FEE\u6B63\u6307\u793A\u3092\u66F8\u304F
- \u5374\u4E0B: issue \u306E\u610F\u56F3\u30FB\u5224\u65AD\u57FA\u6E96\u30FB\u30B9\u30B3\u30FC\u30D7\u5916\u30FB\u4ED5\u69D8\u30FB\u8A2D\u8A08\u5224\u65AD\u306B\u7167\u3089\u3057\u3066\u4E0D\u8981\u306A\u3082\u306E\u3002reason \u306B\u6839\u62E0\uFF08ADR \u756A\u53F7\u3084 issue \u306E\u8A72\u5F53\u7B87\u6240\uFF09\u3092\u66F8\u304F
- decision:
  - fix: \u63A1\u7528\u304C1\u4EF6\u4EE5\u4E0A
  - done: \u3059\u3079\u3066\u5374\u4E0B
  - escalate: \u76F4\u3059\u306B\u306F\u6C7A\u5B9A\u6E08\u307F\u306E\u8A2D\u8A08\u5224\u65AD\u3078\u306E\u9055\u53CD\u30FB\u4ED5\u69D8\u306B\u306A\u3044\u5224\u65AD\u30FB\u30B9\u30B3\u30FC\u30D7\u5916\u306E\u5909\u66F4\u304C\u5FC5\u8981\uFF08escalation_reason \u306B\u7406\u7531\uFF09`,
      `${ISSUE}

# \u5DEE\u5206
${diff.slice(0, 6e4)}

# Codex \u306E\u6307\u6458
${JSON.stringify(codexIssues, null, 2)}`,
      triageSchema
    );
    write(JSON.stringify(triage, null, 2) + "\n");
    if (stagedDiff() !== diff) escalate("Claude \u306E\u53D6\u6368\u9078\u629E\u4E2D\u306B\u30D5\u30A1\u30A4\u30EB\u304C\u5909\u66F4\u3055\u308C\u307E\u3057\u305F");
    triageRecord.push({ round, accepted: triage.accepted, rejected: triage.rejected });
    if (triage.decision === "escalate") escalate(triage.escalation_reason || "Claude \u304C\u4EBA\u9593\u306E\u5224\u65AD\u304C\u5FC5\u8981\u3068\u5224\u65AD\u3057\u307E\u3057\u305F", JSON.stringify(triage, null, 2));
    if (triage.decision === "done" || triage.accepted.length === 0) {
      passed = true;
      break;
    }
    if (round === MAX_REVIEW_ROUNDS) break;
    log(`\u30E9\u30A6\u30F3\u30C9${round}: \u63A1\u7528 ${triage.accepted.length} \u4EF6 \u2192 pi \u306B\u4FEE\u6B63\u4F9D\u983C`);
    await askPi(`\u30EC\u30D3\u30E5\u30FC\u306E\u7D50\u679C\u3001\u6B21\u306E\u4FEE\u6B63\u304C\u5FC5\u8981\u3067\u3059\u3002\u5BFE\u5FDC\u3057\u3066\u304F\u3060\u3055\u3044:
${triage.accepted.map((a, i) => `${i + 1}. ${a.instruction}`).join("\n")}`);
  }
  if (!passed) escalate(`\u30EC\u30D3\u30E5\u30FC\u304C ${MAX_REVIEW_ROUNDS} \u30E9\u30A6\u30F3\u30C9\u3067\u53CE\u675F\u3057\u307E\u305B\u3093\u3067\u3057\u305F`, JSON.stringify(triageRecord.at(-1), null, 2));
  saveState({ reviewPassedKey: reviewKey(stagedDiff()), triage: triageRecord });
  await ensureTestsPass(0);
  checkProtected();
  log("PR \u4F5C\u6210");
  const files = changedFiles();
  if (files.length === 0) escalate("\u5909\u66F4\u304C\u3042\u308A\u307E\u305B\u3093");
  const holdPaths = files.filter((f) => cfg.holdOnChange.some((p) => f.startsWith(p)));
  const rejectedMd = triageRecord.flatMap((t2) => t2.rejected.map((r) => `- (R${t2.round}) ${r.issue}
  - \u5374\u4E0B\u7406\u7531: ${r.reason}`)).join("\n") || "\u306A\u3057";
  const acceptedMd = triageRecord.flatMap((t2) => t2.accepted.map((a) => `- (R${t2.round}) ${a.issue}`)).join("\n") || "\u306A\u3057";
  const prBody = `Closes #${n}

## \u81EA\u52D5\u30D1\u30A4\u30D7\u30E9\u30A4\u30F3
- \u5B9F\u88C5: pi (${PI_PROVIDER}/${PI_MODEL})
- \u4E00\u6B21\u30EC\u30D3\u30E5\u30FC: Codex / \u53D6\u6368\u9078\u629E\u30FB\u6700\u7D42\u30EC\u30D3\u30E5\u30FC: ${CLAUDE_MODEL}

### \u63A1\u7528\u3057\u305F\u30EC\u30D3\u30E5\u30FC\u6307\u6458
${acceptedMd}

### \u5374\u4E0B\u3057\u305F\u30EC\u30D3\u30E5\u30FC\u6307\u6458
${rejectedMd}`;
  if (!runCmd(`git diff --cached --quiet`, wt).ok) must(`git commit -m ${shq(`Implement #${n}: ${issueJson.title}`)}`, wt);
  must(`git push -u origin ${branch}`, wt);
  const existing = runCmd(`gh pr view ${branch} --json number,url`, wt);
  let pr;
  if (existing.ok) {
    pr = JSON.parse(existing.out);
    must(`gh pr edit ${pr.number} --body ${shq(prBody)}`, wt);
  } else {
    const url = must(`gh pr create --base ${BASE} --head ${branch} --title ${shq(`Implement #${n}: ${issueJson.title}`)} --body ${shq(prBody)}`, wt).trim();
    pr = JSON.parse(must(`gh pr view ${url} --json number,url`, wt));
  }
  log(`PR: ${pr.url}`);
  log("Claude \u6700\u7D42\u30EC\u30D3\u30E5\u30FC");
  const finalSchema = {
    type: "object",
    properties: {
      verdict: { type: "string", enum: ["merge", "hold"] },
      summary: { type: "string" },
      concerns: { type: "array", items: { type: "string" } },
      acceptance: {
        type: "array",
        items: {
          type: "object",
          properties: {
            condition: { type: "string" },
            tests: { type: "array", items: { type: "string" } },
            result: { type: "string", enum: ["passed", "failed", "missing"] }
          },
          required: ["condition", "tests", "result"]
        }
      }
    },
    required: ["verdict", "summary", "concerns", "acceptance"]
  };
  const finalDiff = stagedDiff();
  const finalKey = reviewKey(finalDiff);
  let finalReview;
  if (state.finalReviewKey === finalKey && state.finalReview) {
    log("\u524D\u56DE\u306E\u6700\u7D42\u30EC\u30D3\u30E5\u30FC\u304B\u3089\u5DEE\u5206\u30FBissue \u304C\u5909\u308F\u3063\u3066\u3044\u306A\u3044 \u2192 \u6700\u7D42\u30EC\u30D3\u30E5\u30FC\u3092\u30B9\u30AD\u30C3\u30D7\uFF08\u524D\u56DE\u306E\u7D50\u679C\u3092\u4F7F\u7528\uFF09");
    finalReview = state.finalReview;
    write(JSON.stringify(finalReview, null, 2) + "\n");
  } else {
    log("\u30C6\u30B9\u30C8\u7D50\u679C\u306E\u8A73\u7D30\u3092\u53D6\u5F97");
    const report = runCmd(TEST_REPORT_CMD, wt);
    write(report.out.slice(-3e3) + "\n");
    if (!report.ok) escalate("\u6700\u7D42\u30EC\u30D3\u30E5\u30FC\u524D\u306E\u8A73\u7D30\u30C6\u30B9\u30C8\u304C\u5931\u6557\u3057\u307E\u3057\u305F", "```\n" + report.out.slice(-3e3) + "\n```");
    finalReview = askClaude(
      `\u3042\u306A\u305F\u306F\u3053\u306E\u30EA\u30DD\u30B8\u30C8\u30EA\u306E\u8A2D\u8A08\u8CAC\u4EFB\u8005\u3068\u3057\u3066\u3001\u30DE\u30FC\u30B8\u524D\u306E\u6700\u7D42\u30EC\u30D3\u30E5\u30FC\u3092\u884C\u3044\u307E\u3059\u3002\u30D5\u30A1\u30A4\u30EB\u306F\u5909\u66F4\u3057\u306A\u3044\u3067\u304F\u3060\u3055\u3044\u3002
\u6A19\u6E96\u5165\u529B\u306B issue\u30FB\u6700\u7D42\u5DEE\u5206\u30FB\u30D1\u30A4\u30D7\u30E9\u30A4\u30F3\u304C\u5B9F\u884C\u3057\u305F\u30C6\u30B9\u30C8\u7D50\u679C\u30FB\u30EC\u30D3\u30E5\u30FC\u3067\u306E\u63A1\u7528/\u5374\u4E0B\u306E\u8A18\u9332\u304C\u3042\u308A\u307E\u3059\u3002
\u300C\u30C6\u30B9\u30C8\u5B9F\u884C\u7D50\u679C\u300D\u306F\u5B9F\u969B\u306B\u5B9F\u884C\u3057\u305F \`${TEST_REPORT_CMD}\` \u306E\u51FA\u529B\u3067\u3059\u3002\u30C6\u30B9\u30C8\u3092\u81EA\u5206\u3067\u5B9F\u884C\u3059\u308B\u5FC5\u8981\u306F\u3042\u308A\u307E\u305B\u3093\uFF08\u5B9F\u884C\u6A29\u9650\u3082\u3042\u308A\u307E\u305B\u3093\uFF09\u3002

${docSentence(cfg, (ref) => `${ref} \u3092\u8AAD\u307F\u3001`)}\u6B21\u3092\u884C\u3063\u3066\u304F\u3060\u3055\u3044:
1. acceptance: issue \u306E\u53D7\u3051\u5165\u308C\u6761\u4EF6\u30921\u3064\u305A\u3064\u6319\u3052\u3001\u305D\u308C\u3092\u691C\u8A3C\u3057\u3066\u3044\u308B\u30C6\u30B9\u30C8\u540D\uFF08\u30C6\u30B9\u30C8\u5B9F\u884C\u7D50\u679C\u306B\u51FA\u3066\u3044\u308B\u540D\u524D\uFF09\u3068\u7D50\u679C\u3092\u5BFE\u5FDC\u3055\u305B\u308B
   - \u8A72\u5F53\u30C6\u30B9\u30C8\u304C PASSED \u2192 passed / FAILED \u2192 failed / \u8A72\u5F53\u30C6\u30B9\u30C8\u304C\u306A\u3044\u3001\u307E\u305F\u306F\u30C6\u30B9\u30C8\u304C\u6761\u4EF6\u3092\u5B9F\u8CEA\u7684\u306B\u691C\u8A3C\u3057\u3066\u3044\u306A\u3044 \u2192 missing
2. \u6B21\u3092\u3059\u3079\u3066\u6E80\u305F\u3059\u3068\u304D\u3060\u3051 verdict \u3092 merge \u306B\u3059\u308B:
   - acceptance \u304C\u3059\u3079\u3066 passed
   - \u4ED5\u69D8\u30FB\u6C7A\u5B9A\u6E08\u307F\u306E\u8A2D\u8A08\u5224\u65AD\u306B\u9055\u53CD\u3057\u3066\u3044\u306A\u3044
   - issue \u306E\u80CC\u666F\u30FB\u610F\u56F3\u30FB\u5224\u65AD\u57FA\u6E96\u306B\u6CBF\u3063\u3066\u3044\u308B
   - \u5374\u4E0B\u3057\u305F\u6307\u6458\u306E\u5224\u65AD\u304C\u59A5\u5F53
1\u3064\u3067\u3082\u7591\u308F\u3057\u3051\u308C\u3070 hold \u306B\u3057\u3001concerns \u306B\u5177\u4F53\u7684\u306B\u66F8\u304F\u3002\u30DE\u30FC\u30B8\u3092\u59A8\u3052\u306A\u3044\u6C17\u3065\u304D\u306F concerns \u306B\u300C\u975E\u30D6\u30ED\u30C3\u30AD\u30F3\u30B0:\u300D\u3068\u4ED8\u3051\u3066\u66F8\u304F\u3002
summary \u306F\u65E5\u672C\u8A9E\u30673\u884C\u4EE5\u5185\u3002`,
      `${ISSUE}

# \u6700\u7D42\u5DEE\u5206
${finalDiff.slice(0, 8e4)}

# \u30C6\u30B9\u30C8\u5B9F\u884C\u7D50\u679C\uFF08${TEST_REPORT_CMD}\uFF09
${report.out.slice(-2e4)}

# \u30EC\u30D3\u30E5\u30FC\u8A18\u9332
${JSON.stringify(triageRecord, null, 2)}`,
      finalSchema
    );
    write(JSON.stringify(finalReview, null, 2) + "\n");
    const concernsMd = finalReview.concerns.length ? finalReview.concerns.map((c) => `- ${c}`).join("\n") : "\u306A\u3057";
    const mark = (r) => r === "passed" ? "\u2705" : r === "failed" ? "\u274C" : "\u26A0\uFE0F missing";
    const acceptanceMd = finalReview.acceptance.map((a) => `| ${a.condition.replace(/\|/g, "\\|")} | ${a.tests.map((t2) => `\`${t2}\``).join("<br>") || "-"} | ${mark(a.result)} |`).join("\n");
    runCmd(`gh pr comment ${pr.number} --body ${shq(`### \u{1F916} Claude \u6700\u7D42\u30EC\u30D3\u30E5\u30FC: **${finalReview.verdict}**

${finalReview.summary}

**\u53D7\u3051\u5165\u308C\u6761\u4EF6\u3068\u30C6\u30B9\u30C8**

| \u6761\u4EF6 | \u30C6\u30B9\u30C8 | \u7D50\u679C |
|---|---|---|
${acceptanceMd}

**\u61F8\u5FF5\u70B9**
${concernsMd}`)}`, wt);
    saveState({ finalReviewKey: finalKey, finalReview });
  }
  const holdReasons = [];
  if (finalReview.verdict !== "merge") holdReasons.push("\u6700\u7D42\u30EC\u30D3\u30E5\u30FC\u304C hold");
  if (finalReview.acceptance.some((a) => a.result !== "passed")) holdReasons.push("\u30C6\u30B9\u30C8\u3067\u78BA\u8A8D\u3067\u304D\u306A\u3044\u53D7\u3051\u5165\u308C\u6761\u4EF6\u304C\u3042\u308B");
  if (holdPaths.length) holdReasons.push(`\u5909\u66F4\u306B ${holdPaths.join(", ")} \u3092\u542B\u3080`);
  if (labels.includes(cfg.noAutomergeLabel)) holdReasons.push(`\`${cfg.noAutomergeLabel}\` \u30E9\u30D9\u30EB`);
  if (NO_MERGE) holdReasons.push("--no-merge \u6307\u5B9A");
  if (holdReasons.length) {
    log(`\u81EA\u52D5\u30DE\u30FC\u30B8\u305B\u305A\u78BA\u8A8D\u5F85\u3061: ${holdReasons.join(", ")}`);
    setStatus("pr_waiting", { pr: pr.url, reasons: holdReasons, review: finalReview, triage: triageRecord });
    process.exit(0);
  }
  log(`\u6700\u65B0\u306E ${BASE} \u3092\u53D6\u308A\u8FBC\u3093\u3067\u518D\u30C6\u30B9\u30C8`);
  must("git fetch origin", wt);
  const merge = runCmd(`git merge --no-edit ${ORIGIN_BASE}`, wt);
  if (!merge.ok) {
    runCmd("git merge --abort", wt);
    escalate(`${BASE} \u3068\u306E\u7AF6\u5408\u304C\u3042\u308A\u307E\u3059`, merge.out.slice(-2e3));
  }
  const t = runCmd(TEST_CMD, wt);
  if (!t.ok) escalate(`${BASE} \u53D6\u308A\u8FBC\u307F\u5F8C\u306B\u30C6\u30B9\u30C8\u304C\u5931\u6557\u3057\u307E\u3057\u305F`, "```\n" + t.out.slice(-3e3) + "\n```");
  must(`git push origin ${branch}`, wt);
  log("\u30DE\u30FC\u30B8");
  must(`gh pr merge ${pr.number} --squash`);
  runCmd(`git push origin --delete ${branch}`);
  runCmd(`git worktree remove --force ${shq(wt)}`);
  runCmd(`git branch -D ${branch}`);
  runCmd("git fetch origin");
  setStatus("merged", { pr: pr.url, review: finalReview, triage: triageRecord });
  fs3.rmSync(STATE, { force: true });
  log(`\u5B8C\u4E86: ${pr.url} \u3092\u30DE\u30FC\u30B8\u3057\u307E\u3057\u305F`);
  process.exit(0);
}

// src/cli.ts
var USAGE = `loopi \u2014 issue \u99C6\u52D5\u306E\u81EA\u52D5\u5B9F\u88C5\u30D1\u30A4\u30D7\u30E9\u30A4\u30F3

\u4F7F\u3044\u65B9:
  loopi run <issue\u756A\u53F7> [\u30AA\u30D7\u30B7\u30E7\u30F3]   \u5B9F\u88C5 \u2192 \u30EC\u30D3\u30E5\u30FC \u2192 PR \u2192 \u6700\u7D42\u30EC\u30D3\u30E5\u30FC \u2192 \u81EA\u52D5\u30DE\u30FC\u30B8
  loopi init [--force]                 \u3053\u306E\u30EA\u30DD\u30B8\u30C8\u30EA\u306B loopi \u3092\u5C0E\u5165\u3059\u308B

run \u306E\u30AA\u30D7\u30B7\u30E7\u30F3:
  --no-merge         PR \u4F5C\u6210\u3068\u6700\u7D42\u30EC\u30D3\u30E5\u30FC\u307E\u3067\u3067\u6B62\u3081\u308B
  --fresh            \u4FDD\u5B58\u6E08\u307F\u306E\u30EC\u30D3\u30E5\u30FC\u7D50\u679C\u3092\u4F7F\u308F\u305A\u3001\u30EC\u30D3\u30E5\u30FC\u3092\u3084\u308A\u76F4\u3059
  --config <path>    \u8A2D\u5B9A\u30D5\u30A1\u30A4\u30EB\u3092\u660E\u793A\u6307\u5B9A\u3059\u308B\uFF08\u65E2\u5B9A: ./loopi.config.json\uFF09

\u74B0\u5883\u5909\u6570 PI_PROVIDER / PI_MODEL / CLAUDE_MODEL \u306F\u8A2D\u5B9A\u30D5\u30A1\u30A4\u30EB\u306E\u30E2\u30C7\u30EB\u6307\u5B9A\u3088\u308A\u512A\u5148\u3055\u308C\u307E\u3059\u3002

\u7D42\u4E86\u30B3\u30FC\u30C9: 0=merged \u307E\u305F\u306F pr_waiting / 2=escalated\uFF08\u4EBA\u9593\u306E\u5224\u65AD\u5F85\u3061\uFF09 / 1=error`;
function version() {
  const pkg = path4.resolve(path4.dirname(fileURLToPath2(import.meta.url)), "..", "package.json");
  try {
    return JSON.parse(fs4.readFileSync(pkg, "utf8")).version;
  } catch {
    return "unknown";
  }
}
function flagValue(argv2, name) {
  const i = argv2.indexOf(name);
  if (i === -1) return void 0;
  const v = argv2[i + 1];
  if (!v || v.startsWith("--")) {
    console.error(`${name} \u306B\u306F\u5024\u304C\u5FC5\u8981\u3067\u3059`);
    process.exit(1);
  }
  return v;
}
var argv = process.argv.slice(2);
var first = argv[0];
if (!first || first === "--help" || first === "-h" || first === "help") {
  console.log(USAGE);
  process.exit(0);
}
if (first === "--version" || first === "-v") {
  console.log(version());
  process.exit(0);
}
if (first === "init") {
  init({ force: argv.includes("--force") });
}
var issue = first === "run" ? argv[1] : first;
if (!issue || !/^\d+$/.test(issue)) {
  console.error(`issue \u756A\u53F7\u3092\u6307\u5B9A\u3057\u3066\u304F\u3060\u3055\u3044\u3002

${USAGE}`);
  process.exit(1);
}
await run({
  issue,
  noMerge: argv.includes("--no-merge"),
  fresh: argv.includes("--fresh"),
  config: flagValue(argv, "--config")
});
