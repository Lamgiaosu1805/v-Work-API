// Khi câu hỏi nằm ngoài phạm vi nội quy, system prompt yêu cầu model chỉ trả đúng một dòng sentinel.
// Bộ lọc này giữ lại phần đầu câu trả lời cho tới khi biết chắc nó có phải sentinel hay không — để
// không bao giờ stream "[NGOAI_PHAM_VI]" ra giao diện — rồi mới xả dần phần còn lại. Hàm thuần.

export const REFUSAL_SENTINEL = "[NGOAI_PHAM_VI]";

// Model đôi khi bọc sentinel trong markup ("**[NGOAI_PHAM_VI]**", "`[...]`") hoặc mở đầu bằng khoảng
// trắng/xuống dòng — bỏ các ký tự đó khi nhận diện.
const LEADING_NOISE = /^[\s*_`>"'“”‘’]+/u;
const ONLY_NOISE = /^[\s*_`>"'“”‘’]*$/u;

export interface SentinelPush {
  // Phần chữ an toàn để gửi cho người dùng ngay (rỗng nếu đang giữ lại).
  emit: string;
  // Đã chắc chắn câu trả lời là sentinel → người gọi nên hủy stream và báo REFUSED.
  refused: boolean;
}

export class RefusalSentinelFilter {
  private held = "";

  private decided = false;

  push(delta: string): SentinelPush {
    if (this.decided) return { emit: delta, refused: false };

    this.held += delta;
    const candidate = this.held.replace(LEADING_NOISE, "");

    if (candidate.startsWith(REFUSAL_SENTINEL)) {
      this.decided = true;
      this.held = "";
      return { emit: "", refused: true };
    }
    // Vẫn có thể là sentinel (chưa đủ chữ hoặc mới chỉ có khoảng trắng/markup): tiếp tục giữ.
    if (candidate === "" || REFUSAL_SENTINEL.startsWith(candidate)) {
      return { emit: "", refused: false };
    }
    // Đã lệch khỏi sentinel: xả toàn bộ phần đang giữ, từ đây không đệm nữa.
    this.decided = true;
    const emit = this.held;
    this.held = "";
    return { emit, refused: false };
  }

  // Hết stream mà vẫn đang giữ chữ (câu trả lời rất ngắn, trùng tiền tố sentinel): xả ra.
  end(): { emit: string } {
    if (this.decided) return { emit: "" };
    this.decided = true;
    const emit = this.held;
    this.held = "";
    return { emit };
  }
}

export interface StrippedAnswer {
  // Văn bản đã bỏ sentinel; rỗng nếu chỉ còn markup/khoảng trắng.
  text: string;
  found: boolean;
}

// Bỏ sentinel ở MỌI vị trí của câu trả lời cuối (phòng trường hợp model viết thêm chữ rồi mới chèn).
export function stripRefusalSentinel(text: string): StrippedAnswer {
  if (!text.includes(REFUSAL_SENTINEL)) return { text: text.trim(), found: false };
  const remaining = text.split(REFUSAL_SENTINEL).join("");
  return { text: ONLY_NOISE.test(remaining) ? "" : remaining.trim(), found: true };
}
