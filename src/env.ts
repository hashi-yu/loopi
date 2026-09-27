// claude -p に渡す環境の調整
//
// Claude Code のセッション内から loopi を回すと、セッションが設定した CLAUDE_EFFORT などが
// そのまま子の claude に届き、claude CLI 自身がそれを読む。effort は LOOPI_CLAUDE_EFFORT か設定で
// 指定したときだけ --effort で渡すので、effort に関する 2 つだけを取り除く。認証やパスに関わる
// CLAUDE_* は触らない。

/** 子の claude に渡さない環境変数 */
const EFFORT_VARS = ["CLAUDE_EFFORT", "CLAUDE_CODE_EFFORT_LEVEL"];

/** `env` から effort に関する環境変数を取り除いた複製を返す。`env` 自体は変更しない。 */
export function claudeChildEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const out = { ...env };
  for (const name of EFFORT_VARS) delete out[name];
  return out;
}
