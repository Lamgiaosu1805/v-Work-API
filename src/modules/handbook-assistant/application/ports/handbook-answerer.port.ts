import type { HistoryTurn } from "../../domain/history-selection";
import type { PersonalContext } from "./personal-context.port";

// Cổng gọi AI. Phần còn lại của module chỉ biết interface này nên có thể thay nhà cung cấp (hoặc
// tách thành service riêng) bằng cách viết adapter mới, không đụng tới luồng hỏi/hủy/quota.

export interface PromptArticle {
  documentCode: string;
  documentTitle: string;
  articleIdx: number;
  label: string;
  title: string;
  chapter: string;
  // Từng khoản/điểm — đơn vị trích dẫn nhỏ nhất.
  blocks: string[];
}

export interface AnswerRequest {
  // Toàn bộ văn bản đang hiệu lực, đã sắp theo thứ tự cố định. Vị trí trong mảng chính là
  // `documentIndex` của citation.
  articles: PromptArticle[];
  history: HistoryTurn[];
  question: string;
  // Dữ liệu cá nhân của CHÍNH người hỏi (số ngày phép còn lại); không có = không chèn gì vào prompt.
  personal?: PersonalContext | null;
  signal: AbortSignal;
}

export interface AnswerUsage {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite5m: number;
  cacheWrite1h: number;
}

// Vị trí được trích dẫn trong văn bản gửi lên: document thứ `documentIndex`, từ khối `startBlock`
// đến trước `endBlock`.
export interface RawCitation {
  documentIndex: number;
  startBlock: number;
  endBlock: number;
  citedText: string;
}

export interface AnswerCallbacks {
  // Mọi sự kiện từ nhà cung cấp (kể cả không có chữ) — để watchdog biết kết nối còn sống.
  onActivity(): void;
  onTextDelta(text: string): void;
}

export interface AnswerResult {
  text: string;
  citations: RawCitation[];
  stopReason: string | null;
  model: string;
  usage: AnswerUsage;
}

export type AnswerFailureKind =
  | "aborted"
  | "rate_limited"
  | "overloaded"
  | "timeout"
  | "connection"
  | "auth"
  | "bad_request"
  | "unknown";

// Lỗi của lần gọi AI. Luôn kèm lượng token đã tiêu tốn (kể cả khi bị hủy giữa chừng — input vẫn
// bị tính tiền) để ghi nhận chi phí.
export class AnswerFailure extends Error {
  readonly kind: AnswerFailureKind;

  readonly usage: AnswerUsage;

  constructor(kind: AnswerFailureKind, message: string, usage: AnswerUsage, cause?: unknown) {
    super(message);
    this.name = "AnswerFailure";
    this.kind = kind;
    this.usage = usage;
    this.cause = cause;
  }
}

export interface HandbookAnswerer {
  // false khi chưa cấu hình (vd. thiếu API key) — kiểm tra TRƯỚC khi giữ hạn mức.
  isConfigured(): boolean;
  // Resolve khi model trả lời xong; reject bằng AnswerFailure. Hủy bằng `request.signal`.
  answer(request: AnswerRequest, callbacks: AnswerCallbacks): Promise<AnswerResult>;
}

export function emptyUsage(): AnswerUsage {
  return { input: 0, output: 0, cacheRead: 0, cacheWrite5m: 0, cacheWrite1h: 0 };
}
