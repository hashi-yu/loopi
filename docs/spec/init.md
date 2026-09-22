# `loopi init` の仕様

実装: `src/init.ts`。対象リポジトリのルートで実行する。`.git` が無ければエラー。

## 書くもの（loopi 自身のものだけ）

| ファイル | 既にあるとき |
|---|---|
| `loopi.config.json` | 触らない（`--force` で上書き） |
| `.claude/skills/loopi-run/SKILL.md` | 触らない（`--force` で上書き）。`templates/skills/loopi-run/SKILL.md` のコピー |
| `.claude/settings.json` | 触らない。不足している `permissions.allow` の項目を提案として表示する |

`loopi.config.json` の内容は次の推測で埋める。外れたら人が直す。

- `baseBranch`: `origin/HEAD` → 現在のブランチ → `main` の順
- `docs`: `AGENTS.md` / `CLAUDE.md`、`docs/spec/` / `docs/specs/` / `spec/`、`docs/adr/` / `docs/decisions/` / `adr/` のうち最初に見つかったもの
- `test`: `pyproject.toml` や `pytest.ini` → pytest、`go.mod` → `go test`、`Cargo.toml` → `cargo test`、`package.json` → `npm test`、`tests/` → pytest。どれも無ければ空にして提案を出す
- `protectedPaths`: 見つかった ADR の置き場と AGENTS.md、`.github/`、`.claude/`
- `holdOnChange`: 見つかった spec の置き場

## 書かないもの

`AGENTS.md`、spec / ADR の置き場、`.github/ISSUE_TEMPLATE/` は、無くても雛形を置かない。何のために必要かを添えて追加を提案するだけ。
理由は [ADR 0002](../adr/0002-existing-docs-only.md)。
