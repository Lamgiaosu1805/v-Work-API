import { handbookCatalogRepository as catalogRepo } from "../infrastructure/handbook-catalog.repository";

// Use-case ĐỌC: câu hỏi gợi ý lấy từ phiên bản đang hiệu lực. Chưa có bản nào → danh sách rỗng
// (lỗi NO_ACTIVE_HANDBOOK được báo khi người dùng thực sự hỏi, không làm hỏng màn chào).
export async function getSuggestions(): Promise<string[]> {
  const active = await catalogRepo.findActiveVersion();
  return active ? active.suggestions : [];
}
