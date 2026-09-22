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
  /** ツールごとのモデルと effort。effort はツールごとに語彙が違うため検証せずそのまま渡す */
  models: {
    pi: { provider: string; model: string; effort?: string };
    claude: { model: string; effort?: string };
    /** Codex 一次レビューの指定。省略したキーは Codex CLI の既定に従う */
    codex: { model?: string; effort?: string };
  };
  /**
   * モデル指定（`models`）の部分集合に付けた名前。`--profile` で 1 つ選び、
   * 書いたキーだけが `models` を上書きする。`models` 以外のキーは持たない
   */
  profiles: Record<string, ModelProfile>;
  limits: { maxReviewRounds: number; maxTestFixes: number };
  /** これが付いた issue は自動マージしない */
  noAutomergeLabel: string;
};

/** `models` と同じ形の部分集合。書いたツール・キーだけが適用される */
export type ModelProfile = {
  pi?: Partial<Config["models"]["pi"]>;
  claude?: Partial<Config["models"]["claude"]>;
  codex?: Partial<Config["models"]["codex"]>;
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
  models: {
    pi: { provider: "opencode-go", model: "deepseek-v4.1-flash" },
    claude: { model: "claude-fable-5-1" },
    codex: {} as { model?: string; effort?: string },
  },
  profiles: {} as Record<string, ModelProfile>,
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
      claude: { ...DEFAULTS.models.claude, ...(raw.models?.claude ?? {}) },
      codex: { ...DEFAULTS.models.codex, ...(raw.models?.codex ?? {}) },
    },
    profiles: raw.profiles ?? {},
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
 * `profiles` から名前で選んだプロファイルを `models` に適用する。
 * 名前が無ければ設定をそのまま返す。無い名前なら、指定した名前と利用できる名前を並べて投げる。
 */
export function applyProfile(cfg: Config, name?: string): Config {
  if (!name) return cfg;
  const profile = Object.hasOwn(cfg.profiles, name) ? cfg.profiles[name] : undefined;
  if (!profile) {
    const available = Object.keys(cfg.profiles);
    throw new Error(
      `プロファイルが見つかりません: ${name}\n` +
        (available.length
          ? `利用できるプロファイル: ${available.join(", ")}`
          : `利用できるプロファイルがありません（${CONFIG_FILENAME} の profiles に追加してください）`),
    );
  }
  return {
    ...cfg,
    models: {
      pi: { ...cfg.models.pi, ...(profile.pi ?? {}) },
      claude: { ...cfg.models.claude, ...(profile.claude ?? {}) },
      codex: { ...cfg.models.codex, ...(profile.codex ?? {}) },
    },
  };
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
