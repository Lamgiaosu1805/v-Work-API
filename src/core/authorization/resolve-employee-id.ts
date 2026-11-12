import UserInfoModel from "../../models/UserInfoModel";
import { NotFoundException } from "../exceptions/exceptions";
import { cacheTtl, DIRECTORY_CACHE_GROUP, TtlCache } from "../cache/ttl-cache";

// Tài khoản → nhân viên gần như không đổi, nhưng được hỏi ở mọi request có kiểm tra quyền: giữ 60 giây trong bộ nhớ.
// Chỉ đổi khi hồ sơ nhân viên bị xoá mềm hoặc gắn lại tài khoản — hiện không có luồng nào làm vậy (nghỉ việc chỉ ghi
// resignation_date, không đụng tới ánh xạ này; nhân viên mới chưa có trong cache nên được nhận ngay). Nếu sau này có
// luồng như vậy thì gọi invalidateDirectoryCaches() sau khi ghi. Sửa tay trong DB / từ bản API khác: tối đa 60 giây.
const employeeIdCache = new TtlCache<string>(cacheTtl(60_000), DIRECTORY_CACHE_GROUP);

export async function resolveEmployeeId(accountId: string): Promise<string> {
  return employeeIdCache.getOrLoad(String(accountId), async () => {
    const userInfo = await UserInfoModel.findOne({ id_account: accountId, isDeleted: false })
      .select("_id")
      .lean();
    if (!userInfo) {
      throw new NotFoundException("Không tìm thấy thông tin nhân viên");
    }
    return String((userInfo as { _id: unknown })._id);
  });
}
