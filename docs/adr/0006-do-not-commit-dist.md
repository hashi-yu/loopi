# 0006 `dist/` はコミットせず `prepare` でビルドする

状態: 採用（コミット 60149ee）

## 背景

`npx github:hashi-yu/loopi` で配布している。当初は npm のインストール時スクリプトの承認ゲートで `prepare` のビルドが失敗すると考え、`dist/` をコミットしていた。git 依存としてインストールして検証したところ、警告は出るが `prepare` は走り、成果物も正常に動いた。前提が誤りだった。

## 決定

- `dist/` は `.gitignore` に入れ、コミットしない
- `package.json` の `prepare` で `npm run build` を走らせる。`npx github:…` と `npm ci` の両方でビルドされる
- コミットするのは `src/` と `templates/` だけ

## 結果

- `src` を直して `build` を忘れても古い挙動が配布されることがない（インストール失敗はその場で分かるが、古い `dist` は静かに壊れる）
- 手元で `node dist/cli.js` を使うときは `npm run build` が要る
