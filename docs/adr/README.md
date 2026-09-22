# docs/adr

決定済みの設計判断。レビュー担当は指摘の却下根拠に使い、実装担当はこれに反する変更が必要になったら作業を止めて人間に回す。

loopi は agent-lab の自動実装パイプラインを切り出したもので、`src/` のコメントにある「設計: agent-lab docs/adr/…」は元のリポジトリの番号を指す。ここでは loopi 単体で読めるよう、判断を改めて記録し直している。番号は対応しない。

| 番号 | 判断 |
|---|---|
| [0001](0001-separate-models-for-implement-and-review.md) | 実装とレビューでモデルの系統を分ける |
| [0002](0002-existing-docs-only.md) | 参照ドキュメントは既にあるものを使い、`init` は勝手に作らない |
| [0003](0003-resume-by-skipping-passed-stages.md) | 再実行は成功済みの工程をスキップして続きから進む |
| [0004](0004-single-config-file.md) | 設定は `loopi.config.json` 1 枚。探索は 2 段、環境変数はモデル指定だけを上書きする |
| [0005](0005-hold-vs-escalate.md) | 人間に回す判断を「確認待ち（hold）」と「停止（escalate）」に分ける |
| [0006](0006-do-not-commit-dist.md) | `dist/` はコミットせず `prepare` でビルドする |
| [0007](0007-dogfooding.md) | loopi 自身を loopi で開発する |

書き方: 状態 / 背景 / 決定 / 結果。1 ファイル 1 判断。覆すときは新しい ADR を書き、古い方の状態を「置き換え」にする。
