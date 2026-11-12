import UserInfoModel from "../../models/UserInfoModel";
import { NotFoundException } from "../exceptions/exceptions";
import { cacheTtl, TtlCache } from "../cache/ttl-cache";

// Tài khoản → nhân viên gần như không đổi, nhưng được hỏi ở mọi request có kiểm tra quyền: giữ 60 giây trong bộ nhớ.
// Nhân viên vừa bị xoá / nghỉ việc có thể còn được nhận diện tối đa 60 giây (token vẫn do authenticate kiểm tra).
const employeeIdCache = new TtlCache<string>(cacheTtl(60_000));

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
