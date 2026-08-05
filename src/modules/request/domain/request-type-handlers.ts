import leaveHandler from "../../../helpers/leaveHandler";
import lateEarlyHandler from "../../../helpers/lateEarlyHandler";
import remoteHandler from "../../../helpers/remoteHandler";
import businessTripHandler from "../../../helpers/businessTripHandler";
import clientVisitHandler from "../../../helpers/clientVisitHandler";
import explanationHandler from "../../../helpers/explanationHandler";
import forgotCheckinHandler from "../../../helpers/forgotCheckinHandler";
import { RequestType, RequestTypeHandler } from "./types";

export const REQUEST_TYPE_HANDLERS: Record<RequestType, RequestTypeHandler> = {
  leave: leaveHandler,
  late_early: lateEarlyHandler,
  remote: remoteHandler,
  business_trip: businessTripHandler,
  client_visit: clientVisitHandler,
  explanation: explanationHandler,
  forgot_checkin: forgotCheckinHandler
};
