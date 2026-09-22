// 子プロセスの終了が「外部から止められた」ものか「失敗」かを判定する
//
// シェル経由でシグナル死すると終了コードは 128+シグナル番号（SIGTERM=143, SIGINT=130）になり、
// 直接シグナルで死んだ場合は signal に SIGTERM / SIGINT が入る。

export type ExitKind = "interrupted" | "failed";

/** `status` が 0（成功）のときは呼ばない前提。 */
export function classifyExit({ status, signal }: { status: number | null; signal: string | null }): ExitKind {
  if (status === 143 || status === 130) return "interrupted";
  if (signal === "SIGTERM" || signal === "SIGINT") return "interrupted";
  return "failed";
}
