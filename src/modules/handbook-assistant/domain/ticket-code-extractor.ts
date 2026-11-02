// Tách mã ticket (dạng TK-2611-0003) khỏi câu hỏi để tra ticket CỦA CHÍNH người hỏi. Hàm thuần.
//  - ưu tiên câu hỏi hiện tại; không có thì lấy mã trong câu hỏi gần nhất trước đó của hội thoại có nêu mã (để hỏi tiếp
//    "còn ticket đó thì sao" không phải gõ lại). Chỉ đọc câu hỏi của NGƯỜI DÙNG, không đọc câu trả lời của trợ lý;
//  - viết hoa, bỏ trùng, tối đa MAX_TICKET_CODES mã mỗi câu hỏi.
// Mã chỉ để CHỌN trong số ticket do người hỏi tạo — không bao giờ quyết định ai được xem (xem own-ticket-lookup.port.ts).

export const MAX_TICKET_CODES = 3;

const TICKET_CODE_IN_TEXT = /\bTK-\d{4}-\d{4,6}\b/gi;

function codesIn(text: string): string[] {
  return [...new Set((text.match(TICKET_CODE_IN_TEXT) ?? []).map((code) => code.toUpperCase()))];
}

// `previousQuestions`: câu hỏi của người dùng ở các lượt trước, CŨ → MỚI.
export function findTicketCodes(question: string, previousQuestions: string[] = []): string[] {
  const current = codesIn(question);
  if (current.length) return current.slice(0, MAX_TICKET_CODES);
  for (let index = previousQuestions.length - 1; index >= 0; index -= 1) {
    const earlier = codesIn(previousQuestions[index]);
    if (earlier.length) return earlier.slice(0, MAX_TICKET_CODES);
  }
  return [];
}
