import { OmicallClient } from "../../../utils/omicallClient";
import { ConflictException } from "../../../core/exceptions/exceptions";

const omicallClient = new OmicallClient();

export async function addInternalGroupMember(groupId: string, sipUser: string): Promise<void> {
  const succeeded = await omicallClient.addInternalGroupMembers(groupId, [sipUser]);
  if (!succeeded) {
    throw new ConflictException("Thêm nhân viên vào nhóm nội bộ thất bại, vui lòng thử lại", {
      metadata: { groupId, sipUser }
    });
  }
}
