import { ClientSession } from "mongoose";
import { RequestType } from "../../modules/request/domain/types";
import { createOnApprove } from "./away-day";
import * as lateEarly from "./late-early";
import * as forgotCheckin from "./forgot-checkin";
import * as leave from "./leave";

export interface RequestSideEffectError {
  status?: number;
  message: string;
}

export interface RequestSideEffects {
  onCreate?: (
    request: any,
    userInfo: any,
    session: ClientSession
  ) => Promise<RequestSideEffectError | null>;
  onApprove?: (request: any, session: ClientSession) => Promise<void>;
  onReject?: (request: any, session: ClientSession, isCancel?: boolean) => Promise<void>;
}

// Registry điều phối side-effect xuyên module (Timesheet/Leave/Attendance) theo request_type — thay
// cho REQUEST_TYPE_HANDLERS[type].onCreate/onApprove/onReject cũ (đã bỏ khỏi 7 handler trong helpers/,
// xem task 1.8.6). Mỗi entry gọi qua public API modules/timesheet + modules/leave, đúng nơi DUY NHẤT
// được import ≥2 module (rule #2 mục 13).
//
// QUAN TRỌNG: giữ nguyên object module (`leave`/`lateEarly`/`forgotCheckin`) làm value, KHÔNG destructure
// từng hàm ra object literal mới — nhiều test hiện có (create/review/cancel-request.test.js,
// requestApprovalFlow.test.js) dùng `jest.spyOn(leaveSideEffectsModule, "onApprove"/"onCreate"/
// "onReject")` để mock side-effect. `jest.spyOn` mutate property NGAY TRÊN object được truyền vào —
// nếu registry copy giá trị hàm ra object literal riêng (`{ onCreate: leave.onCreate }`), spy sau đó sẽ
// không có tác dụng gì (registry vẫn giữ tham chiếu hàm gốc, chưa bị mock). Giữ nguyên cả object thì
// property lookup lúc gọi (`sideEffects.onCreate(...)`) luôn đọc đúng giá trị mới nhất, kể cả sau khi
// bị spy.
export const REQUEST_SIDE_EFFECTS: Record<RequestType, RequestSideEffects> = {
  leave,
  late_early: lateEarly,
  remote: { onApprove: createOnApprove("remote") },
  business_trip: { onApprove: createOnApprove("business_trip") },
  client_visit: { onApprove: createOnApprove("client_visit") },
  explanation: {},
  forgot_checkin: forgotCheckin
};
