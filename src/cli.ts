// loopi: issue 駆動の自動実装パイプライン
//
//   loopi run <issue番号> [--no-merge] [--fresh] [--config <path>]
//   loopi init [--force]

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { init } from "./init.js";
import { run } from "./run.js";

const USAGE = `loopi — issue 駆動の自動実装パイプライン

使い方:
  loopi run <issue番号> [オプション]   実装 → レビュー → PR → 最終レビュー → 自動マージ
  loopi init [--force]                 このリポジトリに loopi を導入する

run のオプション:
  --no-merge         PR 作成と最終レビューまでで止める
  --fresh            保存済みのレビュー結果を使わず、レビューをやり直す
  --config <path>    設定ファイルを明示指定する（既定: ./loopi.config.json）

環境変数 PI_PROVIDER / PI_MODEL / PI_EFFORT / CLAUDE_MODEL / CLAUDE_EFFORT / CODEX_MODEL / CODEX_EFFORT は設定ファイルのモデル指定より優先されます。

終了コード: 0=merged または pr_waiting / 2=escalated（人間の判断待ち） / 1=error`;

function version(): string {
  const pkg = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "package.json");
  try { return JSON.parse(fs.readFileSync(pkg, "utf8")).version; } catch { return "unknown"; }
}

function flagValue(argv: string[], name: string): string | undefined {
  const i = argv.indexOf(name);
  if (i === -1) return undefined;
  const v = argv[i + 1];
  if (!v || v.startsWith("--")) { console.error(`${name} には値が必要です`); process.exit(1); }
  return v;
}

const argv = process.argv.slice(2);
const first = argv[0];

if (!first || first === "--help" || first === "-h" || first === "help") { console.log(USAGE); process.exit(0); }
if (first === "--version" || first === "-v") { console.log(version()); process.exit(0); }

if (first === "init") {
  init({ force: argv.includes("--force") });
}

// `loopi run 5` と `loopi 5` の両方を受ける
const issue = first === "run" ? argv[1] : first;
if (!issue || !/^\d+$/.test(issue)) {
  console.error(`issue 番号を指定してください。\n\n${USAGE}`);
  process.exit(1);
}

await run({
  issue,
  noMerge: argv.includes("--no-merge"),
  fresh: argv.includes("--fresh"),
  config: flagValue(argv, "--config"),
});
