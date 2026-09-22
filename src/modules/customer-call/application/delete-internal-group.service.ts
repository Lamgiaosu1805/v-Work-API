import { OmicallClient } from "../../../utils/omicallClient";
import { ConflictException } from "../../../core/exceptions/exceptions";

const omicallClient = new OmicallClient();

export async function deleteInternalGroup(id: string): Promise<void> {
  const succeeded = await omicallClient.deleteInternalGroup(id);
  if (!succeeded) {
    throw new ConflictException("Xoá nhóm nội bộ thất bại, vui lòng thử lại", {
      metadata: { groupId: id }
    });
  }
}
