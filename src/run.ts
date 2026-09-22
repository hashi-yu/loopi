// 自動実装パイプライン本体（設計: agent-lab docs/adr/0001, 0003, 0005）
//
// 流れ: pi 実装 → テスト → Codex レビュー → Claude 取捨選択 → PR → Claude 最終レビュー → マージ
//
// 再実行すると成功済みの工程を飛ばす:
//   - 作業フォルダに実装がある → pi の初回実装をスキップ
//   - 前回レビュー合格時から差分と issue が変わっていない → Codex レビュー / 取捨選択をスキップ
//   - 前回の最終レビューから差分と issue が変わっていない → 最終レビューをスキップ
//
// 結果: logs/issue-<番号>.log（全ログ・追記） / .status.json（最終状態） / .state.json（再開用）
// 終了コード: 0=merged or pr_waiting / 3=interrupted（外部から停止） / 2=escalated（人間の判断待ち） / 1=error

import { execSync, spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { createAgentSession, ModelRuntime, SessionManager } from "@earendil-works/pi-coding-agent";
import { Codex } from "@openai/codex-sdk";
import { type Config, docSentence, loadConfig } from "./config.js";
import { classifyExit } from "./exit.js";

export type RunOptions = { issue: string; noMerge: boolean; fresh: boolean; config?: string };

export async function run(opts: RunOptions): Promise<never> {
  const n = opts.issue;
  const NO_MERGE = opts.noMerge;
  const FRESH = opts.fresh;

  const repo = process.cwd();
  let cfg: Config;
  try {
    cfg = loadConfig(repo, opts.config);
  } catch (e: any) {
    console.error(e.message);
    process.exit(1);
  }

  const PI_PROVIDER = process.env.PI_PROVIDER ?? cfg.models.pi.provider;
  const PI_MODEL = process.env.PI_MODEL ?? cfg.models.pi.model;
  const CLAUDE_MODEL = process.env.CLAUDE_MODEL ?? cfg.models.claude;
  const MAX_REVIEW_ROUNDS = cfg.limits.maxReviewRounds;   // Codex レビュー → 修正 の最大回数
  const MAX_TEST_FIXES = cfg.limits.maxTestFixes;         // 1ラウンド内でテスト失敗を pi に戻す最大回数
  const TEST_CMD = cfg.test.command;
  const TEST_REPORT_CMD = cfg.test.reportCommand;         // 最終レビューに渡す詳細なテスト結果
  const PROTECTED = cfg.protectedPaths;
  const BASE = cfg.baseBranch;
  const ORIGIN_BASE = `origin/${BASE}`;

  const branch = `${cfg.branchPrefix}${n}`;
  const wt = path.resolve(repo, cfg.worktreeDir, `wt-${branch}`);
  fs.mkdirSync(path.join(repo, "logs"), { recursive: true });
  const LOG = path.join(repo, "logs", `issue-${n}.log`);
  const STATUS = path.join(repo, "logs", `issue-${n}.status.json`);
  const STATE = path.join(repo, "logs", `issue-${n}.state.json`);

  // ───────── 再開用の状態 ─────────
  type State = { reviewPassedKey?: string; triage?: any[]; finalReviewKey?: string; finalReview?: any };
  let state: State = {};
  if (FRESH) fs.rmSync(STATE, { force: true });
  else if (fs.existsSync(STATE)) { try { state = JSON.parse(fs.readFileSync(STATE, "utf8")); } catch { state = {}; } }
  function saveState(patch: Partial<State>) {
    state = { ...state, ...patch };
    fs.writeFileSync(STATE, JSON.stringify(state, null, 2));
  }

  // ───────── ユーティリティ ─────────
  const NON_INTERACTIVE = { ...process.env, GIT_TERMINAL_PROMPT: "0", GIT_SSH_COMMAND: "ssh -o BatchMode=yes" };

  function write(text: string) { process.stdout.write(text); fs.appendFileSync(LOG, text); }
  function log(m: string) { write(`\n\n===== [${new Date().toLocaleTimeString("ja-JP")}] ${m} =====\n`); }

  function runCmd(cmd: string, cwd = repo) {
    try {
      return { ok: true, out: execSync(cmd, { cwd, encoding: "utf8", stdio: "pipe", env: NON_INTERACTIVE, maxBuffer: 64 * 1024 * 1024 }), status: 0, signal: null };
    } catch (e: any) { return { ok: false, out: `${e.stdout ?? ""}${e.stderr ?? ""}`, status: e.status ?? null, signal: e.signal ?? null }; }
  }
  function must(cmd: string, cwd = repo) {
    const r = runCmd(cmd, cwd);
    if (!r.ok) failOrInterrupt(r.status, r.signal, `コマンド失敗: ${cmd}\n${r.out}`);
    return r.out;
  }
  const sha = (text: string) => crypto.createHash("sha256").update(text).digest("hex").slice(0, 16);
  function shq(s: string) { return `'${s.replace(/'/g, `'\\''`)}'`; }

  function setStatus(status: string, extra: Record<string, unknown> = {}) {
    fs.writeFileSync(STATUS, JSON.stringify({ issue: Number(n), status, updatedAt: new Date().toISOString(), log: LOG, worktree: wt, ...extra }, null, 2));
  }
  function fail(msg: string): never {
    log(`エラー: ${msg}`);
    setStatus("error", { reason: msg });
    process.exit(1);
  }
  // SDK（pi / Codex）が投げた例外から、reason に残すメッセージを取り出す
  function errorMessage(e: any): string {
    return e?.message ?? String(e);
  }
  const INTERRUPTED_REASON = "外部から停止された。再実行すると成功済みの工程を飛ばして続きから進む";
  function interrupt(): never {
    log("外部から停止されました");
    setStatus("interrupted", { reason: INTERRUPTED_REASON });
    process.exit(3);
  }
  // 子プロセスが外部から止められた場合は error ではなく interrupted として残す
  function failOrInterrupt(status: number | null, signal: string | null, msg: string): never {
    if (classifyExit({ status, signal }) === "interrupted") interrupt();
    fail(msg);
  }
  // execSync / spawnSync の実行中はこのハンドラは動かない（子の終了後に走る）。
  // Ctrl-C は同じプロセスグループの子にも届くので、子側の 130 / SIGINT を classifyExit が拾う。
  process.on("SIGINT", interrupt);
  process.on("SIGTERM", interrupt);
  // 同期呼び出しが続く区間の直前でイベントループへ戻し、保留中のシグナルハンドラを走らせる。
  // シグナルは poll フェーズで配送され、setImmediate は check フェーズで走る。poll フェーズの
  // コールバック（SDK の I/O 完了）から続いている場合、1回目の immediate は同じ周回の check で
  // 解決して poll を通らないので、2回待って次の周回の poll を確実に経由させる。
  // これが無いと、同期呼び出しの最中に loopi 本体だけが受けた停止要求が失われる。
  async function checkpoint() {
    await new Promise(r => setImmediate(r));
    await new Promise(r => setImmediate(r));
  }
  function escalate(reason: string, detail = ""): never {
    log(`人間の判断が必要: ${reason}`);
    write(detail + "\n");
    runCmd(`gh issue comment ${n} --body ${shq(`### 🛑 自動パイプライン停止\n\n**理由:** ${reason}\n\n${detail}\n\n作業フォルダ: \`${wt}\`\nログ: \`logs/issue-${n}.log\``)}`);
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
    const bad = changedFiles().filter(f => PROTECTED.some(p => f === p || f.startsWith(p)));
    if (bad.length) escalate("実装担当が保護されたファイルを変更しました", bad.map(f => `- ${f}`).join("\n"));
  }

  // Claude Code をヘッドレスで呼び、JSON Schema に沿った結果を返す（読み取り専用）
  function askClaude(prompt: string, input: string, schema: object) {
    const r = spawnSync("claude", [
      "-p", prompt,
      "--model", CLAUDE_MODEL,
      "--output-format", "json",
      "--json-schema", JSON.stringify(schema),
      "--permission-mode", "dontAsk",
      "--allowedTools", "Read,Grep,Glob",
    ], { cwd: wt, input, encoding: "utf8", maxBuffer: 64 * 1024 * 1024, env: NON_INTERACTIVE });
    if (r.status !== 0) failOrInterrupt(r.status, r.signal, `claude -p が失敗しました (exit ${r.status})\n${r.stderr}\n${r.stdout?.slice(-2000)}`);
    let res: any;
    try { res = JSON.parse(r.stdout); } catch { fail(`claude -p の出力を JSON として読めません:\n${r.stdout.slice(-2000)}`); }
    // Claude Code 2.1.x は --output-format json でメッセージ配列を返す。最後の type=result 要素が結果
    if (Array.isArray(res)) res = res.filter((m: any) => m?.type === "result").at(-1) ?? {};
    if (res.is_error || !res.structured_output) fail(`claude -p が構造化出力を返しませんでした:\n${JSON.stringify(res).slice(0, 2000)}`);
    if (typeof res.total_cost_usd === "number") write(`(Claude 推定コスト: $${res.total_cost_usd.toFixed(3)})\n`);
    return res.structured_output;
  }

  // ───────── 1. 準備 ─────────
  fs.appendFileSync(LOG, `\n\n################ 実行開始 ${new Date().toISOString()} ################\n`);
  setStatus("running");
  log(`issue #${n} 開始（pi: ${PI_PROVIDER}/${PI_MODEL}, claude: ${CLAUDE_MODEL}, base: ${BASE}${NO_MERGE ? ", --no-merge" : ""}${FRESH ? ", --fresh" : ""}）`);

  const issueJson = JSON.parse(must(`gh issue view ${n} --json number,title,body,labels,state`));
  if (issueJson.state !== "OPEN") fail(`issue #${n} は ${issueJson.state} です`);
  const labels: string[] = issueJson.labels.map((l: any) => l.name);
  const ISSUE = `# #${issueJson.number} ${issueJson.title}\n\n${issueJson.body}`;
  // 差分と issue の組み合わせのキー。どちらかが変わればレビューはやり直しになる
  const reviewKey = (diff: string) => sha(`${diff}\n---\n${ISSUE}`);

  must("git fetch origin");
  if (!runCmd(`git rev-parse --verify ${ORIGIN_BASE}`).ok) fail(`基準ブランチが見つかりません: ${ORIGIN_BASE}（loopi.config.json の baseBranch を確認してください）`);
  if (fs.existsSync(wt)) {
    log(`既存の作業フォルダを再利用: ${wt}`);
  } else if (runCmd(`git rev-parse --verify ${branch}`).ok) {
    must(`git worktree add ${shq(wt)} ${branch}`);
    log(`既存ブランチ ${branch} で作業フォルダを作成`);
  } else {
    must(`git worktree add ${shq(wt)} -b ${branch} ${ORIGIN_BASE}`);
    log(`作業フォルダを作成: ${wt}`);
  }

  // ───────── 2. 実装（pi） ─────────
  const readDocs = docSentence(cfg, ref => `まず ${ref} を読んでください。\n`);
  const testFileLine = cfg.code.testDir
    ? `- 受け入れ条件ごとに ${cfg.code.testDir} にテストを書く`
    : `- 受け入れ条件ごとにテストを書く`;
  const protectedLine = PROTECTED.length ? `\n- 「触ってよいファイル」以外、および次のパスは変更しない: ${PROTECTED.join(", ")}` : "";
  const PI_CONTEXT = `あなたはこのリポジトリの実装担当です。
${readDocs}${testFileLine}
- 変更後は ${TEST_CMD} を実行し、通ることを確認する
- git commit はしない${protectedLine}
- 決定済みの設計判断に反する変更や、仕様にない判断が必要になったら、作業を止めてその旨を最後に書く

${ISSUE}`;

  // pi は必要になった時点で起動する（再実行で実装をスキップした場合、修正依頼が来るまで起動しない）
  let session: any = null;
  async function askPi(msg: string) {
    let prompt = msg;
    if (!session) {
      const modelRuntime = await ModelRuntime.create();
      const model = modelRuntime.getModel(PI_PROVIDER, PI_MODEL);
      if (!model) fail(`モデルが見つかりません: ${PI_PROVIDER}/${PI_MODEL}`);
      ({ session } = await createAgentSession({ cwd: wt, sessionManager: SessionManager.inMemory(wt), modelRuntime, model }));
      session.subscribe((ev: any) => {
        if (ev.type === "message_update" && ev.assistantMessageEvent.type === "text_delta") write(ev.assistantMessageEvent.delta);
      });
      // 新しいセッションには役割と issue を先に伝える
      prompt = msg.startsWith(PI_CONTEXT) ? msg : `${PI_CONTEXT}\n\n---\nこの issue の実装は作業フォルダに既にあります。次の対応をしてください:\n${msg}`;
    }
    try {
      await session.prompt(prompt);
    } catch (e: any) {
      fail(`pi が失敗しました: ${errorMessage(e)}`);
    }
  }

  const existingChanges = changedFiles();
  if (existingChanges.length > 0) {
    log(`既存の実装を再利用（${existingChanges.length} ファイル）→ pi の初回実装をスキップ`);
    write(existingChanges.map(f => `- ${f}`).join("\n") + "\n");
  } else {
    log("pi: 実装");
    await askPi(`${PI_CONTEXT}\n\n---\n上の issue を実装してください。`);
  }

  async function ensureTestsPass(round: number) {
    for (let i = 0; i <= MAX_TEST_FIXES; i++) {
      log(`ラウンド${round}: テスト${i ? `（再試行${i}）` : ""}`);
      const t = runCmd(TEST_CMD, wt);
      write(t.out.slice(-1500) + "\n");
      if (t.ok) return;
      if (classifyExit({ status: t.status, signal: t.signal }) === "interrupted") interrupt();
      if (i === MAX_TEST_FIXES) escalate(`テストが ${MAX_TEST_FIXES} 回の修正で通りませんでした`, "```\n" + t.out.slice(-3000) + "\n```");
      log(`ラウンド${round}: テスト失敗 → pi に修正依頼`);
      await askPi(`テストが失敗しています。原因を調べて修正してください:\n${t.out.slice(-4000)}`);
    }
  }

  // ───────── 3. レビューループ（Codex → Claude 取捨選択 → pi） ─────────
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
            detail: { type: "string" },
          },
          required: ["severity", "file", "detail"],
          additionalProperties: false,
        },
      },
    },
    required: ["issues"],
    additionalProperties: false,
  };
  const triageSchema = {
    type: "object",
    properties: {
      decision: { type: "string", enum: ["fix", "done", "escalate"] },
      accepted: { type: "array", items: { type: "object", properties: { issue: { type: "string" }, instruction: { type: "string" } }, required: ["issue", "instruction"] } },
      rejected: { type: "array", items: { type: "object", properties: { issue: { type: "string" }, reason: { type: "string" } }, required: ["issue", "reason"] } },
      escalation_reason: { type: "string" },
    },
    required: ["decision", "accepted", "rejected"],
  };

  const triageRecord: { round: number; accepted: any[]; rejected: any[] }[] = [];
  let passed = false;

  for (let round = 1; round <= MAX_REVIEW_ROUNDS; round++) {
    await ensureTestsPass(round);
    checkProtected();

    const diff = stagedDiff();
    if (state.reviewPassedKey === reviewKey(diff)) {
      log("前回のレビュー合格時から差分・issue が変わっていない → Codex レビューと取捨選択をスキップ");
      triageRecord.push(...(state.triage ?? []));
      passed = true;
      break;
    }

    // Codex レビュー
    log(`ラウンド${round}: Codex レビュー`);
    let turn: any;
    try {
      turn = await codex.startThread({ workingDirectory: wt }).run(
`あなたはコードレビュアーです。ファイルは一切変更しないでください。
${docSentence(cfg, ref => `${ref} を読んだうえで、\n`)}下の差分をレビューし、重大な問題だけを issues に挙げてください:
- バグ、受け入れ条件の未達、仕様・設計判断（spec / ADR）違反、テスト不足、セキュリティ
好みやスタイルの指摘は不要です。問題がなければ issues は空配列にしてください。

${ISSUE}

# 差分
${diff.slice(0, 60000)}`,
      { outputSchema: codexSchema });
    } catch (e: any) {
      fail(`Codex レビューが失敗しました: ${errorMessage(e)}`);
    }
    const codexIssues = JSON.parse(turn.finalResponse).issues as any[];
    write(JSON.stringify(codexIssues, null, 2) + "\n");
    if (stagedDiff() !== diff) escalate("Codex レビュー中にファイルが変更されました");

    if (codexIssues.length === 0) { passed = true; break; }

    // Claude による取捨選択
    log(`ラウンド${round}: Claude が指摘を取捨選択（${codexIssues.length}件）`);
    const triage = askClaude(
`あなたはこのリポジトリの設計責任者です。ファイルは変更しないでください。
標準入力に issue・差分・Codex のレビュー指摘があります。
${docSentence(cfg, ref => `${ref} を必要に応じて読み、`)}各指摘を判断してください。

- 採用: バグ・受け入れ条件未達・仕様や設計判断への違反など、直すべきもの。instruction には実装担当（能力の低めなモデル）が迷わず直せる具体的な修正指示を書く
- 却下: issue の意図・判断基準・スコープ外・仕様・設計判断に照らして不要なもの。reason に根拠（ADR 番号や issue の該当箇所）を書く
- decision:
  - fix: 採用が1件以上
  - done: すべて却下
  - escalate: 直すには決定済みの設計判断への違反・仕様にない判断・スコープ外の変更が必要（escalation_reason に理由）`,
      `${ISSUE}\n\n# 差分\n${diff.slice(0, 60000)}\n\n# Codex の指摘\n${JSON.stringify(codexIssues, null, 2)}`,
      triageSchema);
    write(JSON.stringify(triage, null, 2) + "\n");
    if (stagedDiff() !== diff) escalate("Claude の取捨選択中にファイルが変更されました");
    triageRecord.push({ round, accepted: triage.accepted, rejected: triage.rejected });

    if (triage.decision === "escalate") escalate(triage.escalation_reason || "Claude が人間の判断が必要と判断しました", JSON.stringify(triage, null, 2));
    if (triage.decision === "done" || triage.accepted.length === 0) { passed = true; break; }

    if (round === MAX_REVIEW_ROUNDS) break;
    log(`ラウンド${round}: 採用 ${triage.accepted.length} 件 → pi に修正依頼`);
    await askPi(`レビューの結果、次の修正が必要です。対応してください:\n${triage.accepted.map((a: any, i: number) => `${i + 1}. ${a.instruction}`).join("\n")}`);
  }

  if (!passed) escalate(`レビューが ${MAX_REVIEW_ROUNDS} ラウンドで収束しませんでした`, JSON.stringify(triageRecord.at(-1), null, 2));
  saveState({ reviewPassedKey: reviewKey(stagedDiff()), triage: triageRecord });
  await ensureTestsPass(0);
  checkProtected();

  // ───────── 4. PR 作成 ─────────
  log("PR 作成");
  const files = changedFiles();
  if (files.length === 0) escalate("変更がありません");
  const holdPaths = files.filter(f => cfg.holdOnChange.some(p => f.startsWith(p)));

  const rejectedMd = triageRecord.flatMap(t => t.rejected.map((r: any) => `- (R${t.round}) ${r.issue}\n  - 却下理由: ${r.reason}`)).join("\n") || "なし";
  const acceptedMd = triageRecord.flatMap(t => t.accepted.map((a: any) => `- (R${t.round}) ${a.issue}`)).join("\n") || "なし";
  const prBody = `Closes #${n}

## 自動パイプライン
- 実装: pi (${PI_PROVIDER}/${PI_MODEL})
- 一次レビュー: Codex / 取捨選択・最終レビュー: ${CLAUDE_MODEL}

### 採用したレビュー指摘
${acceptedMd}

### 却下したレビュー指摘
${rejectedMd}`;

  if (!runCmd(`git diff --cached --quiet`, wt).ok) must(`git commit -m ${shq(`Implement #${n}: ${issueJson.title}`)}`, wt);
  must(`git push -u origin ${branch}`, wt);
  const existing = runCmd(`gh pr view ${branch} --json number,url`, wt);
  let pr: { number: number; url: string };
  if (existing.ok) {
    pr = JSON.parse(existing.out);
    must(`gh pr edit ${pr.number} --body ${shq(prBody)}`, wt);
  } else {
    const url = must(`gh pr create --base ${BASE} --head ${branch} --title ${shq(`Implement #${n}: ${issueJson.title}`)} --body ${shq(prBody)}`, wt).trim();
    pr = JSON.parse(must(`gh pr view ${url} --json number,url`, wt));
  }
  log(`PR: ${pr.url}`);

  // ───────── 5. Claude 最終レビュー ─────────
  log("Claude 最終レビュー");
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
            verifiedBy: { type: "string", enum: ["test", "review"] },
            result: { type: "string", enum: ["passed", "failed", "missing"] },
            evidence: { type: "array", items: { type: "string" } },
          },
          required: ["condition", "verifiedBy", "result", "evidence"],
        },
      },
    },
    required: ["verdict", "summary", "concerns", "acceptance"],
  };
  const finalDiff = stagedDiff();
  const finalKey = reviewKey(finalDiff);
  let finalReview: any;

  if (state.finalReviewKey === finalKey && state.finalReview) {
    log("前回の最終レビューから差分・issue が変わっていない → 最終レビューをスキップ（前回の結果を使用）");
    finalReview = state.finalReview;
    write(JSON.stringify(finalReview, null, 2) + "\n");
  } else {
    // パイプラインが実際に実行したテスト結果を、レビューの材料として渡す
    log("テスト結果の詳細を取得");
    const report = runCmd(TEST_REPORT_CMD, wt);
    write(report.out.slice(-3000) + "\n");
    if (!report.ok && classifyExit({ status: report.status, signal: report.signal }) === "interrupted") interrupt();
    if (!report.ok) escalate("最終レビュー前の詳細テストが失敗しました", "```\n" + report.out.slice(-3000) + "\n```");

    finalReview = askClaude(
`あなたはこのリポジトリの設計責任者として、マージ前の最終レビューを行います。ファイルは変更しないでください。
標準入力に issue・最終差分・パイプラインが実行したテスト結果・レビューでの採用/却下の記録があります。
「テスト実行結果」は実際に実行した \`${TEST_REPORT_CMD}\` の出力です。テストを自分で実行する必要はありません（実行権限もありません）。

${docSentence(cfg, ref => `${ref} を読み、`)}次を行ってください:
1. acceptance: issue の受け入れ条件を1つずつ挙げ、検証方法（verifiedBy）・判定結果（result）・根拠（evidence）を対応させる
   - 条件の末尾に「（レビュー確認）」があれば verifiedBy は review、無ければ test
   - test: 該当テストが通った → passed / 落ちた → failed / 該当テストが無い、または条件を実質的に検証していない → missing
   - review: 差分と文書が条件を満たす → passed / 満たさない、または反する → failed / 判断できる材料が無い → missing
   - evidence には根拠を挙げる。test ならテスト名、review ならファイルと行、または文書の節
   - 印のある条件がテストで検証できたはずだと考えても、判定は変えずに concerns へ「非ブロッキング:」と付けて書く
2. 次をすべて満たすときだけ verdict を merge にする:
   - acceptance がすべて passed
   - 仕様・決定済みの設計判断に違反していない
   - issue の背景・意図・判断基準に沿っている
   - 却下した指摘の判断が妥当
1つでも疑わしければ hold にし、concerns に具体的に書く。マージを妨げない気づきは concerns に「非ブロッキング:」と付けて書く。
summary は日本語で3行以内。`,
      `${ISSUE}\n\n# 最終差分\n${finalDiff.slice(0, 80000)}\n\n# テスト実行結果（${TEST_REPORT_CMD}）\n${report.out.slice(-20000)}\n\n# レビュー記録\n${JSON.stringify(triageRecord, null, 2)}`,
      finalSchema);
    write(JSON.stringify(finalReview, null, 2) + "\n");

    const concernsMd = finalReview.concerns.length ? finalReview.concerns.map((c: string) => `- ${c}`).join("\n") : "なし";
    const mark = (r: string) => (r === "passed" ? "✅" : r === "failed" ? "❌" : "⚠️ missing");
    const acceptanceMd = finalReview.acceptance
      .map((a: any) => `| ${a.condition.replace(/\|/g, "\\|")} | ${a.verifiedBy === "review" ? "レビュー確認" : "テスト"} | ${a.evidence.map((e: string) => `\`${e}\``).join("<br>") || "-"} | ${mark(a.result)} |`)
      .join("\n");
    runCmd(`gh pr comment ${pr.number} --body ${shq(`### 🤖 Claude 最終レビュー: **${finalReview.verdict}**\n\n${finalReview.summary}\n\n**受け入れ条件の判定**\n\n| 条件 | 検証方法 | 根拠 | 判定結果 |\n|---|---|---|---|\n${acceptanceMd}\n\n**懸念点**\n${concernsMd}`)}`, wt);
    saveState({ finalReviewKey: finalKey, finalReview });
  }

  // ここから先は同期呼び出しが続くため、その前に保留中の停止要求を処理する
  await checkpoint();

  const holdReasons: string[] = [];
  if (finalReview.verdict !== "merge") holdReasons.push("最終レビューが hold");
  if (finalReview.acceptance.some((a: any) => a.result !== "passed")) {
    holdReasons.push("passed でない受け入れ条件がある");
    holdReasons.push(...finalReview.acceptance.filter((a: any) => a.result !== "passed").map((a: any) => a.condition));
  }
  if (holdPaths.length) holdReasons.push(`変更に ${holdPaths.join(", ")} を含む`);
  if (labels.includes(cfg.noAutomergeLabel)) holdReasons.push(`\`${cfg.noAutomergeLabel}\` ラベル`);
  if (NO_MERGE) holdReasons.push("--no-merge 指定");

  if (holdReasons.length) {
    log(`自動マージせず確認待ち: ${holdReasons.join(", ")}`);
    setStatus("pr_waiting", { pr: pr.url, reasons: holdReasons, review: finalReview, triage: triageRecord });
    process.exit(0);
  }

  // ───────── 6. 最新の基準ブランチで再テストしてマージ ─────────
  log(`最新の ${BASE} を取り込んで再テスト`);
  must("git fetch origin", wt);
  await checkpoint();
  const merge = runCmd(`git merge --no-edit ${ORIGIN_BASE}`, wt);
  if (!merge.ok) { runCmd("git merge --abort", wt); escalate(`${BASE} との競合があります`, merge.out.slice(-2000)); }
  const t = runCmd(TEST_CMD, wt);
  if (!t.ok && classifyExit({ status: t.status, signal: t.signal }) === "interrupted") interrupt();
  if (!t.ok) escalate(`${BASE} 取り込み後にテストが失敗しました`, "```\n" + t.out.slice(-3000) + "\n```");
  must(`git push origin ${branch}`, wt);

  log("マージ");
  await checkpoint();
  // worktree 内で --delete-branch を使うと基準ブランチの checkout に失敗するため、ブランチは個別に削除する
  must(`gh pr merge ${pr.number} --squash`);
  runCmd(`git push origin --delete ${branch}`);
  runCmd(`git worktree remove --force ${shq(wt)}`);
  runCmd(`git branch -D ${branch}`);
  runCmd("git fetch origin");
  setStatus("merged", { pr: pr.url, review: finalReview, triage: triageRecord });
  fs.rmSync(STATE, { force: true });
  log(`完了: ${pr.url} をマージしました`);
  process.exit(0);
}
