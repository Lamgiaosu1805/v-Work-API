import { OmicallClient } from "../../../utils/omicallClient";
import { ConflictException } from "../../../core/exceptions/exceptions";

const omicallClient = new OmicallClient();

export async function removeInternalGroupMember(groupId: string, sipUser: string): Promise<void> {
  const succeeded = await omicallClient.removeInternalGroupMembers(groupId, [sipUser]);
  if (!succeeded) {
    throw new ConflictException("Xoá nhân viên khỏi nhóm nội bộ thất bại, vui lòng thử lại", {
      metadata: { groupId, sipUser }
    });
  }
}
