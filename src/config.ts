// 設定の読み込みと既定値（設計: agent-lab docs/adr/0004, 0005）
//
// 探索順は 2 段のみ:
//   1. --config <path> の明示指定
//   2. リポジトリルートの loopi.config.json

import fs from "node:fs";
import path from "node:path";

export type Config = {
  /** 差分の基準・worktree の起点・PR の base・マージ前の取り込み先 */
  baseBranch: string;
  /** 作業ブランチ名の接頭辞。ブランチは `${branchPrefix}${issue番号}` */
  branchPrefix: string;
  /** 作業フォルダを作る場所（リポジトリからの相対パス） */
  worktreeDir: string;
  /** 参照ドキュメント。いずれも任意で、指定したものだけがプロンプトに載る */
  docs: { agents?: string; spec?: string; adr?: string };
  /** テストの置き場（任意）。実装担当への指示に使う */
  code: { testDir?: string };
  /** 実装担当が変更できないパス */
  protectedPaths: string[];
  /** 変更に含まれると自動マージを止めるパス */
  holdOnChange: string[];
  test: { command: string; reportCommand: string };
  models: { pi: { provider: string; model: string }; claude: string };
  limits: { maxReviewRounds: number; maxTestFixes: number };
  /** これが付いた issue は自動マージしない */
  noAutomergeLabel: string;
};

export const CONFIG_FILENAME = "loopi.config.json";

const DEFAULTS = {
  baseBranch: "main",
  branchPrefix: "issue-",
  worktreeDir: "..",
  docs: {},
  code: {},
  protectedPaths: [] as string[],
  holdOnChange: [] as string[],
  models: { pi: { provider: "opencode-go", model: "deepseek-v4.1-flash" }, claude: "claude-fable-5-1" },
  limits: { maxReviewRounds: 3, maxTestFixes: 3 },
  noAutomergeLabel: "no-automerge",
};

export function configPath(repo: string, explicit?: string): string {
  return explicit ? path.resolve(repo, explicit) : path.join(repo, CONFIG_FILENAME);
}

export function loadConfig(repo: string, explicit?: string): Config {
  const file = configPath(repo, explicit);
  if (!fs.existsSync(file)) {
    throw new Error(
      `設定ファイルがありません: ${file}\n` +
        (explicit ? "" : `リポジトリのルートで \`loopi init\` を実行すると ${CONFIG_FILENAME} の雛形を作れます。`),
    );
  }

  let raw: any;
  try {
    raw = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (e: any) {
    throw new Error(`設定ファイルを JSON として読めません: ${file}\n${e.message}`);
  }

  const cfg: Config = {
    ...DEFAULTS,
    ...raw,
    docs: { ...DEFAULTS.docs, ...(raw.docs ?? {}) },
    code: { ...DEFAULTS.code, ...(raw.code ?? {}) },
    models: {
      pi: { ...DEFAULTS.models.pi, ...(raw.models?.pi ?? {}) },
      claude: raw.models?.claude ?? DEFAULTS.models.claude,
    },
    limits: { ...DEFAULTS.limits, ...(raw.limits ?? {}) },
    test: raw.test ?? {},
  };

  if (!cfg.test?.command) throw new Error(`${file} に test.command がありません（例: "python -m pytest -q"）`);
  cfg.test.reportCommand ||= cfg.test.command;
  if (cfg.limits.maxReviewRounds < 1) throw new Error(`${file} の limits.maxReviewRounds は 1 以上にしてください`);
  if (cfg.limits.maxTestFixes < 0) throw new Error(`${file} の limits.maxTestFixes は 0 以上にしてください`);

  return cfg;
}

/**
 * プロンプトで繰り返す「参照ドキュメントの案内」。
 * docs に何も設定されていないリポジトリでは空文字を返し、呼び出し側が案内文ごと落とす。
 */
export function docRef(cfg: Config): string {
  const parts: string[] = [];
  if (cfg.docs.agents) parts.push(cfg.docs.agents);
  const specAdr = [cfg.docs.spec, cfg.docs.adr].filter(Boolean) as string[];
  if (specAdr.length) parts.push(`issue に書かれた関連ドキュメント（${specAdr.join(", ")}）`);
  return parts.join(" と、");
}

/** `docRef` を含む一文。参照ドキュメントが無ければ空文字。 */
export function docSentence(cfg: Config, template: (ref: string) => string): string {
  const ref = docRef(cfg);
  return ref ? template(ref) : "";
}
