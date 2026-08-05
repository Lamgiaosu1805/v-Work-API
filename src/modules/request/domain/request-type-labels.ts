import { RequestType } from "./types";

export const TYPE_LABELS: Record<RequestType, string> = {
  leave: "xin nghỉ phép",
  late_early: "đi muộn/về sớm",
  remote: "làm việc từ xa",
  business_trip: "đi công tác",
  client_visit: "đi gặp gỡ khách hàng",
  explanation: "giải trình",
  forgot_checkin: "quên chấm công"
};
