import { OmicallClient, HotlineItem } from "../../../utils/omicallClient";
import { NotFoundException } from "../../../core/exceptions/exceptions";

const omicallClient = new OmicallClient();

export async function getHotlineDetail(phone: string): Promise<HotlineItem> {
  const detail = await omicallClient.getHotlineByPhone(phone);
  if (!detail) {
    throw new NotFoundException("Không tìm thấy đầu số Hotline");
  }
  return detail;
}
