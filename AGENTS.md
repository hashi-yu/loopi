# AGENTS.md

loopi のリポジトリで作業するエージェント（実装担当・レビュー担当）向けの共通ルール。

## このリポジトリは何か

issue 駆動の自動実装パイプライン（`README.md`）。loopi 自身の開発にも loopi を使う（dogfooding）。
つまり、あなたがいま直しているコードは、このパイプラインそのものである。

## 構成

- `src/cli.ts` — 引数解釈と `run` / `init` への振り分け
- `src/config.ts` — `loopi.config.json` の読み込み・既定値・検証。副作用のない純粋な処理に保つ
- `src/init.ts` — `loopi init`（設定と skill の雛形を書く）
- `src/run.ts` — パイプライン本体。工程の順序は先頭コメントの通りで、順序を変える変更は issue に明記されている場合だけ行う
- `templates/skills/loopi-run/SKILL.md` — `init` が対象リポジトリにコピーする Claude Code skill
- `tests/` — `node --test` のテスト（TypeScript、`tsx` で実行）
- `docs/spec/` — 正しい挙動の出典。README と食い違ったらこちらが正
- `docs/adr/` — 決定済みの設計判断。指摘の却下根拠と、「これに反する変更は人間に回す」の判定に使う

## 言語・スタイル

- TypeScript / ESM。相対 import は `./config.js` のように `.js` 拡張子を付ける（`tsc --noEmit` と `esbuild` の両方を通すため）
- 実行時依存は `@earendil-works/pi-coding-agent` と `@openai/codex-sdk` のみ。新しい実行時依存は追加しない（`devDependencies` も issue に書かれていない限り増やさない）
- コメント・ログ・エラーメッセージ・PR/issue へのコメント文面は日本語
- 既存コードの流儀に合わせる。長い関数を分割するだけのリファクタや、issue に関係ない整形は行わない

## テスト

- コマンド: `npm test`（`tsc --noEmit` → `node --import tsx --test "tests/**/*.test.ts"`）
- テストは `tests/<対象>.test.ts` に置き、`node:test` と `node:assert/strict` を使う。外部プロセス（`gh`、`claude`、`git`）は起動しない
- 受け入れ条件ごとにテストを書く。設定の読み込みや文字列の組み立てなど、`src/config.ts` に寄せた純粋な処理をテストする
- `src/run.ts` に新しい判断ロジック（終了コードの分類、モデル指定の解決、ラベルの再判定など）を足すときは、可能ならその判断部分を純粋な関数として切り出し、`tests/` で検証できる形にする

## 触ってはいけないもの

- `.github/`、`.claude/`、`AGENTS.md`、`docs/adr/` — パイプライン自体の設定と決定済みの設計判断。変更が必要なら作業を止めて人間に回す
- `docs/spec/` は issue が仕様変更を明記している場合だけ変更する。変更すると自動マージされず人間の確認に回る
- `dist/` はコミットしない（`prepare` でビルドされる）
- `package-lock.json` を手で編集しない。依存を変えるときは `npm install` で更新する

## 止めて人間に回す条件

- issue に書かれていない設計判断（設定ファイルの形式変更、工程の追加・削除、既定モデルの変更など）が必要になった
- `docs/adr/` の判断に反する変更が必要になった
- `docs/spec/` に書かれた挙動と矛盾する変更が、issue に明記されずに必要になった
- `test.command` で検証できない挙動（実際に `claude -p` や `gh` を呼ぶ部分）しか変更点がない場合は、その旨を最後に書く
