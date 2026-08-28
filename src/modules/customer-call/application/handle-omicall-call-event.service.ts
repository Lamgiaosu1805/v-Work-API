import { getIO } from "../../../sockets/ioRegistry";
import { logger } from "../../../config/logger";
import { SaleOmicallProfileRepository } from "../infrastructure/sale-omicall-profile.repository";

const saleOmicallProfileRepository = new SaleOmicallProfileRepository();

export type OmicallCallEventState = "create" | "early" | "ringing" | "answered" | "hangup";

export interface OmicallCallEventPayload {
  call_uuid: string;
  extension: string;
  phone_number: string;
  state: OmicallCallEventState;
  direction: "outbound" | "inbound";
}

export async function handleOmicallCallEvent(payload: OmicallCallEventPayload): Promise<void> {
  try {
    if (!payload.extension) return;

    const saleProfile = await saleOmicallProfileRepository.findByExtension(payload.extension);
    if (!saleProfile) return;

    const io = getIO();
    if (!io) return;

    io.to(`user:${saleProfile.saleId}`).emit("customer_call:state", {
      callUuid: payload.call_uuid,
      phoneNumber: payload.phone_number,
      state: payload.state,
      direction: payload.direction
    });
  } catch (error) {
    logger.error("Xử lý webhook trạng thái cuộc gọi Omicall thất bại", {
      error: (error as Error).message,
      payload
    });
  }
}
