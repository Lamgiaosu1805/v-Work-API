// Các câu trả lời đang chạy TRONG TIẾN TRÌNH NÀY (server chạy 1 instance, không có Redis adapter cho
// socket.io). Dùng để: chặn hỏi chồng (1 câu/tài khoản + trần toàn server → BUSY), hủy theo
// messageId, hủy hàng loạt khi xoá hội thoại / tắt server.

export type AbortReason =
  | "cancelled" // người dùng bấm Dừng
  | "refused" // model trả sentinel ngoài phạm vi
  | "idle" // quá lâu không nhận được sự kiện nào
  | "first_text" // quá lâu chưa có chữ đầu tiên
  | "max_duration" // quá tổng thời gian cho phép
  | "shutdown" // server đang tắt
  | "deleted"; // hội thoại bị xoá

export type AnswerState = "preparing" | "streaming";

export interface RunningAnswer {
  messageId: string;
  accountId: string;
  conversationId: string | null;
  controller: AbortController;
  // Lý do hủy ĐẦU TIÊN — lỗi abort của SDK luôn được quy theo lý do này, không bao giờ thành "AI lỗi".
  abortReason: AbortReason | null;
  state: AnswerState;
  // Resolve khi câu trả lời đã được chốt xong (phục vụ chờ khi tắt server).
  finished: Promise<void>;
  markFinished: () => void;
}

export interface ClaimInput {
  messageId: string;
  accountId: string;
  maxConcurrent: number;
}

export class RunningAnswersRegistry {
  private readonly byMessage = new Map<string, RunningAnswer>();

  private readonly messageByAccount = new Map<string, string>();

  // ĐỒNG BỘ (không await) để 2 yêu cầu cùng lúc của một tài khoản không bao giờ cùng qua được.
  // Trả về null nghĩa là BUSY: tài khoản đang có câu chạy, hoặc toàn server đã đạt trần.
  tryClaim({ messageId, accountId, maxConcurrent }: ClaimInput): RunningAnswer | null {
    if (this.messageByAccount.has(accountId)) return null;
    if (this.byMessage.size >= maxConcurrent) return null;

    let markFinished: () => void = () => undefined;
    const finished = new Promise<void>((resolve) => {
      markFinished = resolve;
    });
    const entry: RunningAnswer = {
      messageId,
      accountId,
      conversationId: null,
      controller: new AbortController(),
      abortReason: null,
      state: "preparing",
      finished,
      markFinished
    };
    this.byMessage.set(messageId, entry);
    this.messageByAccount.set(accountId, messageId);
    return entry;
  }

  get(messageId: string): RunningAnswer | undefined {
    return this.byMessage.get(messageId);
  }

  setConversation(messageId: string, conversationId: string): void {
    const entry = this.byMessage.get(messageId);
    if (entry) entry.conversationId = conversationId;
  }

  // Ghi lý do TRƯỚC rồi mới abort. Chỉ lý do đầu tiên được giữ. Trả về true nếu có câu đang chạy.
  abort(messageId: string, reason: AbortReason): boolean {
    const entry = this.byMessage.get(messageId);
    if (!entry) return false;
    if (!entry.abortReason) entry.abortReason = reason;
    entry.controller.abort();
    return true;
  }

  abortByConversation(conversationId: string, reason: AbortReason): number {
    let count = 0;
    this.byMessage.forEach((entry) => {
      if (entry.conversationId === conversationId && this.abort(entry.messageId, reason)) {
        count += 1;
      }
    });
    return count;
  }

  abortAll(reason: AbortReason): number {
    let count = 0;
    [...this.byMessage.keys()].forEach((messageId) => {
      if (this.abort(messageId, reason)) count += 1;
    });
    return count;
  }

  release(messageId: string): void {
    const entry = this.byMessage.get(messageId);
    if (!entry) return;
    this.byMessage.delete(messageId);
    if (this.messageByAccount.get(entry.accountId) === messageId) {
      this.messageByAccount.delete(entry.accountId);
    }
    entry.markFinished();
  }

  get size(): number {
    return this.byMessage.size;
  }

  // Chờ mọi câu đang chạy chốt xong, tối đa `timeoutMs`.
  async waitAllFinished(timeoutMs: number): Promise<void> {
    const pending = [...this.byMessage.values()].map((entry) => entry.finished);
    if (!pending.length) return;
    await Promise.race([
      Promise.all(pending).then(() => undefined),
      new Promise<void>((resolve) => {
        setTimeout(resolve, timeoutMs).unref();
      })
    ]);
  }

  // Chỉ dùng trong test.
  clear(): void {
    this.byMessage.forEach((entry) => entry.markFinished());
    this.byMessage.clear();
    this.messageByAccount.clear();
  }
}

export const runningAnswers = new RunningAnswersRegistry();
