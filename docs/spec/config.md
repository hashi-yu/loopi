# `loopi.config.json` の仕様

実装: `src/config.ts`。

このリポジトリのルートにある `loopi.config.json` は loopi 自身を対象に回すための設定で、雛形ではない。雛形は `loopi init` が生成する（[init.md](init.md)）。

## 探索

1. `--config <path>`（リポジトリのルートからの相対パス、または絶対パス）
2. リポジトリのルートの `loopi.config.json`

見つからなければエラー。2 のときだけ `loopi init` を案内する。JSON として読めなければエラー。

## キー

| キー | 型 | 既定値 | 意味 |
|---|---|---|---|
| `baseBranch` | string | `"main"` | 差分の基準・作業ブランチの起点・PR の base・マージ前の取り込み先 |
| `branchPrefix` | string | `"issue-"` | 作業ブランチ名の接頭辞 |
| `worktreeDir` | string | `".."` | 作業フォルダを作る場所（リポジトリからの相対パス） |
| `docs.agents` | string? | なし | 共通ルールの文書。指定するとプロンプトに載る |
| `docs.spec` | string? | なし | 仕様の置き場 |
| `docs.adr` | string? | なし | 設計判断の置き場 |
| `code.testDir` | string? | なし | 実装担当に「ここにテストを書け」と伝える場所 |
| `protectedPaths` | string[] | `[]` | 実装担当が変更したら停止するパス（前方一致） |
| `holdOnChange` | string[] | `[]` | 変更に含まれると自動マージしないパス（前方一致） |
| `test.command` | string | **必須** | 合否判定のコマンド。作業フォルダで実行する |
| `test.reportCommand` | string | `test.command` | 最終レビューに渡す詳細なテスト結果を取るコマンド |
| `models.pi.provider` | string | `"opencode-go"` | pi のプロバイダ |
| `models.pi.model` | string | `"deepseek-v4.1-flash"` | pi のモデル |
| `models.pi.effort` | string? | なし | pi の thinking level。省略すると pi の設定（無ければ `medium`） |
| `models.claude.model` | string | `"claude-fable-5-1"` | 取捨選択と最終レビューの `claude -p --model` |
| `models.claude.effort` | string? | なし | 取捨選択と最終レビューの `claude -p --effort`。省略すると Claude Code の既定 |
| `models.codex.model` | string? | なし | Codex 一次レビューのモデル。省略すると Codex CLI の既定（`~/.codex/config.toml`） |
| `models.codex.effort` | string? | なし | Codex 一次レビューの reasoning effort。省略すると Codex CLI の既定 |
| `profiles` | object | `{}` | モデル指定（`models`）の部分集合に付けた名前。`--profile <名前>` で 1 つ選ぶ |
| `limits.maxReviewRounds` | number | `3` | レビューの最大ラウンド数。1 以上 |
| `limits.maxTestFixes` | number | `3` | 1 ラウンド内でテスト失敗を実装担当に戻す最大回数。0 以上 |
| `noAutomergeLabel` | string | `"no-automerge"` | これが付いた issue は自動マージしない |

- `models` は 3 ツールとも `model` と `effort` を持ち、pi だけ `provider` が加わる。`effort` は省略でき、省略するとそのツールの既定に従う（何も渡さない）。値はツールごとに語彙が違うため検証せずそのまま渡す
- 入れ子（`docs`, `code`, `models.pi`, `models.claude`, `models.codex`, `limits`）は指定したキーだけが既定値を上書きする
- `test` は入れ子の既定値を持たない。`test.command` が空ならエラー
- 上の表に無いキーは無視も検証もされない（そのまま `Config` に混ざる）

## プロファイル

`profiles` は `models` と同じ形の部分集合に名前を付けたもの。`loopi run <番号> --profile <名前>` で 1 つ選ぶ。

```json
"profiles": {
  "fast": { "claude": { "model": "claude-sonnet-5" }, "codex": { "effort": "low" } }
}
```

- 書いたキーだけが `models` を上書きする（ツール単位でさらにキー単位）。上の例では `claude.model` と `codex.effort` だけが変わり、`claude.effort` と pi の指定は `models` のまま
- プロファイルの `models` 以外のキー（例: `limits`）は無視する
- 指定しなければ `models` がそのまま効く。既定のプロファイルは無い
- 無い名前を指定するとエラー。メッセージに指定した名前と利用できるプロファイル名の一覧を出す

## 環境変数

`PI_PROVIDER` / `PI_MODEL` / `PI_EFFORT` / `CLAUDE_MODEL` / `CLAUDE_EFFORT` / `CODEX_MODEL` / `CODEX_EFFORT` は設定ファイルより優先される。設定ファイルの値は環境変数が無いときの既定になる。優先順位は 環境変数 > プロファイル > `models`。

## 参照ドキュメントの案内文（`docRef`）

プロンプトに繰り返し載せる文。`docs` の指定に応じて次のように組み立てる。

| 指定 | 案内文 |
|---|---|
| なし | 空文字（呼び出し側が案内文ごと落とす） |
| `agents` のみ | `AGENTS.md` |
| `spec` / `adr` のいずれか以上 | `issue に書かれた関連ドキュメント（docs/spec/, docs/adr/）` |
| `agents` と `spec` / `adr` | `AGENTS.md と、issue に書かれた関連ドキュメント（…）` |
