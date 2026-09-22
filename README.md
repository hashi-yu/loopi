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

### loopi 自身を loopi で開発する（dogfooding）

このリポジトリには自分自身を対象にした `loopi.config.json` と `.claude/skills/loopi-run/` が入っている。issue を `.github/ISSUE_TEMPLATE/task.md` の型（背景・提案・受け入れ条件・触ってよいファイル・スコープ外）で書いてから:

```bash
npx github:hashi-yu/loopi run 12      # GitHub の main にある loopi で、この repo の issue #12 を実装する
node dist/cli.js run 12               # 手元でビルドした loopi を使う（run.ts を直した直後の確認など）
```

- 作業フォルダは `../wt-issue-12`。`test.command` が `npm ci && npm test` なので、作業フォルダに `node_modules` が無くても動く
- `README.md` / `package.json` / `loopi.config.json` を変更した PR は自動マージせず確認待ちになる（`holdOnChange`）
- `AGENTS.md` / `.github/` / `.claude/` は保護パス。実装担当が触ると停止する
- `npx github:...` は npm のキャッシュを使うため、マージしたばかりの変更を使いたいときは `npx --yes github:hashi-yu/loopi#main` のようにコミット指定を付けるか `node dist/cli.js` を使う
