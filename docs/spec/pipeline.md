# `loopi run` の仕様

実装: `src/run.ts`。工程の順序と停止条件を定める。

## 入力と前提

- 引数は issue 番号（数字のみ）。`loopi run 12` と `loopi 12` は同じ
- issue は `gh issue view` で読む。状態が `OPEN` でなければ `error`
- 設定は `loopi.config.json`（[config.md](config.md)）。実行はリポジトリのルートで行い、設定はそのルートから読む（作業フォルダの設定は使わない）
- 基準ブランチは `origin/<baseBranch>`。`git fetch origin` 後に存在しなければ `error`

## 作業場所

- ブランチ名: `<branchPrefix><issue番号>`（既定 `issue-12`）
- 作業フォルダ: `<worktreeDir>/wt-<ブランチ名>`（既定 `../wt-issue-12`）。`git worktree` で作る
- 作業フォルダが既にあればそのまま使う。無くてブランチだけあればそのブランチで作る。どちらも無ければ `origin/<baseBranch>` から新しいブランチで作る

## 出力ファイル（リポジトリの `logs/`）

| ファイル | 内容 |
|---|---|
| `issue-<番号>.log` | 全ログ。実行ごとに追記 |
| `issue-<番号>.status.json` | 最終状態。`issue`, `status`, `updatedAt`, `log`, `worktree` と、状態ごとの追加フィールド |
| `issue-<番号>.state.json` | 再開用。`reviewPassedKey`, `triage`, `finalReviewKey`, `finalReview`。`--fresh` で消す。`merged` で消す |

`status` の値と追加フィールド:

| status | 意味 | 追加フィールド | 終了コード |
|---|---|---|---|
| `running` | 実行中 | — | — |
| `merged` | マージ済み | `pr`, `review`, `triage` | 0 |
| `pr_waiting` | PR を作り、人間の確認待ち | `pr`, `reasons`, `review`, `triage` | 0 |
| `escalated` | PR を作らず停止（または最終レビュー後に停止）。issue にコメントする | `reason`, `detail` | 2 |
| `interrupted` | 外部から停止された（再実行すると成功済みの工程を飛ばして続きから進む） | `reason` | 3 |
| `error` | 環境・設定・外部コマンドの失敗 | `reason` | 1 |

## 工程

順序は固定。順序を変える変更は issue に明記されている場合だけ行う。

### 1. 実装（pi）

- 作業フォルダに `origin/<baseBranch>` との差分が 1 ファイルでもあれば、初回実装をスキップする
- 無ければ pi に、役割・参照ドキュメント・テストの置き場・保護パス・issue 本文を渡して実装させる
- pi のセッションは必要になった時点で起動する。スキップした場合、修正依頼が来るまで起動しない

### 2. テスト

- 作業フォルダで `test.command` を実行する
- 失敗したら出力の末尾を pi に渡して修正させる。`limits.maxTestFixes` 回まで。超えたら `escalated`
- テストが通ったら、変更ファイルに `protectedPaths` が含まれていないか確認する。含まれていれば `escalated`

### 3. レビューループ（最大 `limits.maxReviewRounds` ラウンド）

各ラウンドで 2 → 3a → 3b の順に行う。

- **3a. Codex 一次レビュー**: 差分（先頭 60,000 文字）と issue を渡し、`{ issues: [{ severity: high|medium, file, detail }] }` を受け取る。`issues` が空なら合格
- **3b. Claude 取捨選択**: issue・差分・Codex の指摘を渡し、`{ decision: fix|done|escalate, accepted: [{ issue, instruction }], rejected: [{ issue, reason }], escalation_reason? }` を受け取る
  - `escalate` → `escalated`
  - `done` または `accepted` が空 → 合格
  - `fix` → `accepted` の `instruction` を番号付きで pi に渡して修正させ、次のラウンドへ。最終ラウンドなら修正せず終了
- レビュー中（3a, 3b）に作業フォルダの差分が変わったら `escalated`
- 最大ラウンドで合格しなければ `escalated`
- 合格したら **レビュー合格キー** `sha256(差分 + "\n---\n" + issue本文)` の先頭 16 文字と採用/却下の記録を `state.json` に保存し、テストと保護パスの確認をもう一度行う

### 4. PR

- 変更が無ければ `escalated`
- 未コミットの変更を `Implement #<番号>: <issue タイトル>` でコミットし、`git push -u origin <ブランチ>`
- 同じブランチの PR が既にあれば本文だけ更新する。無ければ `base = baseBranch` で作る
- PR 本文: `Closes #<番号>`、使ったモデル、採用した指摘、却下した指摘と理由

### 5. Claude 最終レビュー

- `test.reportCommand` を作業フォルダで実行し、失敗したら `escalated`
- issue・最終差分（先頭 80,000 文字）・テスト結果（末尾 20,000 文字）・採用/却下の記録を渡し、`{ verdict: merge|hold, summary, concerns: string[], acceptance: [{ condition, tests: string[], result: passed|failed|missing }] }` を受け取る
- 結果を PR にコメントする（verdict、summary、受け入れ条件とテストの対応表、懸念点）
- `finalReviewKey`（レビュー合格キーと同じ計算）と結果を `state.json` に保存する

### 6. 自動マージの判定

次のいずれかに当たれば `pr_waiting`（`reasons` にすべて列挙）:

- `verdict` が `merge` でない
- `acceptance` に `passed` でないものがある
- 変更ファイルに `holdOnChange` のパスが含まれる
- issue に `noAutomergeLabel` が付いている（実行開始時に読んだラベル）
- `--no-merge`

### 7. マージ

- `git fetch origin` → `git merge --no-edit origin/<baseBranch>`。競合したら merge を中止して `escalated`
- `test.command` を再実行。失敗したら `escalated`
- push → `gh pr merge --squash` → リモートとローカルのブランチと作業フォルダを削除 → `merged`

## 再実行時のスキップ

| 条件 | スキップするもの |
|---|---|
| 作業フォルダに基準ブランチとの差分がある | 1. 初回実装 |
| `state.reviewPassedKey` が現在の差分と issue から計算したキーと一致 | 3. Codex レビューと取捨選択（保存済みの記録を使う） |
| `state.finalReviewKey` が一致し、`finalReview` がある | 5. 最終レビュー（保存済みの結果を使う。PR コメントも書かない） |

`--fresh` は `state.json` を消してレビューをやり直す。実装のスキップには影響しない（作り直すなら作業フォルダを消す）。

## エージェントの権限

- pi: 作業フォルダ内でファイルを変更できる。`git commit` はしない指示を受ける
- Codex: 作業フォルダで読み取り。ファイルを変更しない指示を受ける
- Claude（取捨選択・最終レビュー）: `claude -p` を `--permission-mode dontAsk --allowedTools Read,Grep,Glob` で起動し、JSON Schema で構造化出力を受け取る。テストは実行しない（結果はパイプラインが渡す）
- git・gh は `GIT_TERMINAL_PROMPT=0`、`ssh -o BatchMode=yes` で対話を禁止する

## `escalated` 時の issue コメント

見出し `🛑 自動パイプライン停止`、理由、詳細、作業フォルダのパス、ログのパスを書く。
