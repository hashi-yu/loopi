# 0007 loopi 自身を loopi で開発する

状態: 採用（PR #7）

## 背景

loopi の改善点（issue #1〜#6）は、対象リポジトリで実際に回して初めて見えたものだった。loopi 自身の変更も同じパイプラインで回せば、パイプラインの使い勝手と判断の質を毎回検証できる。

## 決定

- このリポジトリに自分自身を対象にした `loopi.config.json` と `.claude/skills/loopi-run/` を置く
- テストは `npm test`（`tsc --noEmit` → `node --test`）。TypeScript のテストを `tsx` で直接実行し、外部プロセス（`gh`、`claude`、`git`）は起動しない
- `test.command` は `npm ci && npm test`。作業フォルダは `git worktree` で新規に作られ `node_modules` が無いため、依存の導入を合否判定に含める（`npm ci` は `prepare` 経由でビルドも検証する）
- `src/run.ts` に判断ロジックを足すときは純粋な関数に切り出し、`tests/` で受け入れ条件を検証できる形にする（AGENTS.md）
- 仕様（`docs/spec/`）、README、`package.json`、`loopi.config.json` の変更は自動マージせず人間の確認に回す。ADR、AGENTS.md、`.github/`、`.claude/` は実装担当が変更したら停止する

## 結果

- パイプラインは `origin/main` から作業するため、この設定は main に入って初めて効く
- `claude -p` や `gh` を実際に呼ぶ部分は `npm test` で検証できない。そこだけを変える issue では、最終レビューの受け入れ条件が `missing` になり確認待ちになる。これは意図した挙動
- `npx github:hashi-yu/loopi` は GitHub の main を使う。`run.ts` を直した直後の確認は `node dist/cli.js` で行う
