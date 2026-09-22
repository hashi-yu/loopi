# loopi

issue を渡すと、実装 → レビュー → PR → 最終レビュー → マージまで回す自動実装パイプライン。

```
issue ──> pi 実装 ──> テスト ──> Codex レビュー ──> Claude 取捨選択 ──┐
             ↑                                                      │ 採用あり
             └──────────────────────────────────────────────────────┘
                            ↓ 合格
                       PR ──> Claude 最終レビュー ──> 自動マージ / 人間の確認待ち
```

実装とレビューでモデルの系統を分け（自己採点を避ける）、判断が重いところだけ人間に回す。

## 前提

- Node.js 20 以上
- `gh`（GitHub CLI）でログイン済み
- `claude`（Claude Code）が PATH にあり、ログイン済み
- pi（`@earendil-works/pi-coding-agent`）と Codex（`@openai/codex-sdk`）の認証が済んでいる

## 導入

対象リポジトリのルートで:

```bash
npx github:hashi-yu/loopi init
```

`init` が書き込むのは `loopi.config.json` と `.claude/skills/loopi-run/` だけ。`AGENTS.md` や spec / ADR、issue テンプレートは**既にあるものを使い、無ければ理由付きで追加を提案するだけ**で、勝手に作らない。

## 実行

```bash
npx github:hashi-yu/loopi run 12              # 実装からマージまで
npx github:hashi-yu/loopi run 12 --no-merge   # PR 作成と最終レビューまで
npx github:hashi-yu/loopi run 12 --fresh      # 保存済みのレビュー結果を捨ててやり直す
```

再実行すると成功済みの工程を飛ばす。作業フォルダに実装があれば実装をスキップし、前回の合格時から差分と issue が変わっていなければレビューもスキップする。作り直したいときは作業フォルダを消す。

終了コード: `0` = マージ済みまたは確認待ち / `2` = 人間の判断待ちで停止 / `1` = エラー

結果は対象リポジトリの `logs/issue-<番号>.log`（全ログ）と `.status.json`（最終状態）に残る。

## 設定（`loopi.config.json`）

```json
{
  "baseBranch": "main",
  "branchPrefix": "issue-",
  "worktreeDir": "..",
  "docs": { "agents": "AGENTS.md", "spec": "docs/spec/", "adr": "docs/adr/" },
  "code": { "testDir": "tests/" },
  "protectedPaths": ["docs/adr/", "AGENTS.md", ".github/", ".claude/"],
  "holdOnChange": ["docs/spec/"],
  "test": {
    "command": "python -m pytest -q",
    "reportCommand": "python -m pytest -v --tb=short"
  },
  "models": {
    "pi": { "provider": "opencode-go", "model": "deepseek-v4.1-flash" },
    "claude": "claude-fable-5-1"
  },
  "limits": { "maxReviewRounds": 3, "maxTestFixes": 3 },
  "noAutomergeLabel": "no-automerge"
}
```

| キー | 意味 |
|---|---|
| `baseBranch` | 差分の基準・作業ブランチの起点・PR の base・マージ前の取り込み先（既定 `main`） |
| `branchPrefix` / `worktreeDir` | 作業ブランチ名と作業フォルダの置き場（既定 `issue-` / `..`） |
| `docs` | 各エージェントに読ませる参照ドキュメント。すべて任意で、指定したものだけがプロンプトに載る |
| `code.testDir` | 実装担当に「ここにテストを書け」と伝える場所（任意） |
| `protectedPaths` | 実装担当が変更したら停止するパス |
| `holdOnChange` | 変更が含まれると自動マージせず人間の確認に回すパス |
| `test.command` | パイプラインが合否判定に使うコマンド（必須） |
| `test.reportCommand` | 最終レビューに渡す詳細なテスト結果を取るコマンド |
| `limits` | レビューの最大ラウンド数と、1ラウンド内でテスト失敗を実装担当に戻す最大回数 |
| `noAutomergeLabel` | これが付いた issue は自動マージしない |

環境変数 `PI_PROVIDER` / `PI_MODEL` / `CLAUDE_MODEL` は設定より優先される。

## 自動マージを止める条件

次のいずれかに当たると PR を作って止まり、人間の確認を待つ。

- 最終レビューが `hold`
- テストで確認できない受け入れ条件がある
- `holdOnChange` のパスを変更している
- `noAutomergeLabel` が付いている
- `--no-merge` を指定した

次のいずれかでは PR も作らず停止し、issue にコメントする。

- 実装担当が `protectedPaths` を変更した
- テストが上限回数で通らなかった
- レビューが上限ラウンドで収束しなかった
- 取捨選択の段階で「決定済みの設計判断に反する／仕様にない判断が必要」と判断された
- 基準ブランチとの競合、取り込み後のテスト失敗

## うまく回すために

パイプラインの判断の質は、リポジトリの文書の質で決まる。issue 本文（背景・受け入れ条件・触ってよいファイル・スコープ外）と、`docs` に指定した仕様・設計判断が薄いと、レビューは「テストが通っているか」しか見られない。

## 開発

`dist/` はコミットしない。`npx github:...` でのインストール時に `prepare` が走り、そこでビルドされる。

```bash
npm install
npm test          # tsc --noEmit + node --test（tests/*.test.ts）
npm run build     # 手元で試す用。コミットするのは src/ だけ
```

手元のリポジトリで試すときは、対象リポジトリから直接叩く:

```bash
node /path/to/loopi/dist/cli.js run 12
```

### リポジトリ構成

このリポジトリには「ツールとしての loopi」と「loopi を対象リポジトリとして回すための設定」が同居している。

| 場所 | 役割 |
|---|---|
| `src/` | 本体。`cli.ts`（引数）→ `run.ts`（パイプライン）/ `init.ts`（導入）、`config.ts`（設定） |
| `templates/` | `init` が対象リポジトリにコピーする skill の元 |
| `docs/spec/`, `docs/adr/` | 仕様と設計判断。README と食い違ったら `docs/spec/` が正 |
| `tests/` | `npm test` のテスト |
| `dist/` | ビルド成果物。コミットしない（`prepare` で作られる。ADR 0006） |
| `logs/` | `loopi run` の実行結果。コミットしない |
| `loopi.config.json`, `.claude/` | **loopi 自身を対象に回すための設定と skill**。他のリポジトリに入れる雛形ではない（雛形は `loopi init` が生成する。中身は `src/init.ts`） |
| `AGENTS.md`, `.github/ISSUE_TEMPLATE/` | エージェント向けの共通ルールと issue の型。開発規約であり、パイプラインの入力でもある |

### loopi 自身を loopi で開発する（dogfooding）

issue を `.github/ISSUE_TEMPLATE/task.md` の型（背景・提案・関連ドキュメント・受け入れ条件・触ってよいファイル・スコープ外）で書いてから、リポジトリのルートで実行する。どの loopi が動くかはコマンドで決まる:

| やりたいこと | コマンド | 動く loopi |
|---|---|---|
| issue #5 を普通に回す | `npx github:hashi-yu/loopi run 5` | GitHub の `main` |
| ルートで直した `run.ts` を試す | `npm run build && node dist/cli.js run 5` | 手元の作業ツリー（未コミット分を含む） |
| マージ前の issue #3 の実装で、別の issue #5 を回す | `node ../wt-issue-3/dist/cli.js run 5` | issue #3 の作業フォルダでビルド済みの実装 |

作業フォルダの `dist/` は `test.command` の `npm ci` が `prepare` 経由で作るので、パイプラインが一度通っていればビルド済み（最後にテストが走った時点の `src/` の内容）。設定と `logs/` は、コマンドを実行したカレントディレクトリ（リポジトリのルート）のものが使われる。作業フォルダ側の `loopi.config.json` は読まれない（[ADR 0004](docs/adr/0004-single-config-file.md)）。

- 作業フォルダは `../wt-issue-<番号>`。`test.command` が `npm ci` から始まるので、作業フォルダに `node_modules` が無くても動く
- `docs/spec/` / `README.md` / `package.json` / `loopi.config.json` を変更した PR は自動マージせず確認待ちになる（`holdOnChange`）
- `docs/adr/` / `AGENTS.md` / `.github/` / `.claude/` は保護パス。実装担当が触ると停止する
- `templates/skills/loopi-run/SKILL.md` を直したら `cp templates/skills/loopi-run/SKILL.md .claude/skills/loopi-run/SKILL.md` で反映する。`loopi init --force` は `loopi.config.json` も上書きするので使わない。`.claude/` は保護パスなので実装担当は触れず、人間が反映する
- `npx github:...` は npm のキャッシュを使うため、マージ直後の変更を確実に使いたいときは `npx --yes github:hashi-yu/loopi#<コミットSHA>` のようにコミットを固定するか `node dist/cli.js` を使う（`#main` はブランチ参照なので固定にならない）
