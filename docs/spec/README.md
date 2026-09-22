# docs/spec

loopi の「正しい挙動」の出典。README は利用者向けの要約で、食い違ったらこちらが正。
レビュー担当は受け入れ条件の未達をここに照らして判定し、実装担当はここに無い挙動を勝手に足さない。

- [pipeline.md](pipeline.md) — `loopi run` の工程、再実行時のスキップ、停止条件、出力ファイル、終了コード
- [config.md](config.md) — `loopi.config.json` のキー、既定値、検証、環境変数との優先順位
- [init.md](init.md) — `loopi init` が書くもの・書かないもの

仕様を変える変更は `holdOnChange` に入っているため自動マージされず、人間の確認に回る。
