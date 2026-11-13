// Câu trả lời đang chạy trong tiến trình này (1 câu / tài khoản) — để chặn hỏi trùng và cho phép huỷ.
interface RunningRun {
  messageId: string;
  controller: AbortController;
}

const running = new Map<string, RunningRun>();

export const runningRuns = {
  has: (accountId: string): boolean => running.has(accountId),
  add: (accountId: string, run: RunningRun): void => {
    running.set(accountId, run);
  },
  remove: (accountId: string, messageId: string): void => {
    if (running.get(accountId)?.messageId === messageId) running.delete(accountId);
  },
  cancel: (accountId: string, messageId?: string): boolean => {
    const run = running.get(accountId);
    if (!run || (messageId && run.messageId !== messageId)) return false;
    run.controller.abort();
    return true;
  },
  abortAll: (): void => {
    running.forEach((run) => run.controller.abort());
  }
};
