// Chọn các lượt hỏi–đáp ĐÃ HOÀN TẤT của một hội thoại để gửi kèm làm ngữ cảnh cho model. Lượt lỗi,
// bị hủy, bị từ chối hoặc chưa xong bị bỏ cả hai phía để prompt luôn xen kẽ user/assistant và phần
// đầu prompt ổn định giữa các lượt (giúp prompt caching trúng). Hàm thuần.

export interface HistoryMessage {
  seq: number;
  role: "user" | "assistant";
  content: string;
  status: string;
}

export interface HistoryTurn {
  question: string;
  answer: string;
}

// Tin user ở `seq` lẻ n và tin trả lời ở n+1 (xem handbook_message.seq). `beforeSeq` là seq của tin
// user hiện tại — những tin từ đó trở đi không phải lịch sử.
export function selectHistoryTurns(messages: HistoryMessage[], beforeSeq: number): HistoryTurn[] {
  const bySeq = new Map(messages.map((message) => [message.seq, message]));
  const turns: HistoryTurn[] = [];
  [...messages]
    .sort((a, b) => a.seq - b.seq)
    .forEach((message) => {
      if (message.role !== "user" || message.seq >= beforeSeq) return;
      const answer = bySeq.get(message.seq + 1);
      if (!answer || answer.role !== "assistant" || answer.status !== "done") return;
      if (!message.content.trim() || !answer.content.trim()) return;
      turns.push({ question: message.content, answer: answer.content });
    });
  return turns;
}
