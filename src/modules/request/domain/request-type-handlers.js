const leaveHandler = require("../../../helpers/leaveHandler");
const lateEarlyHandler = require("../../../helpers/lateEarlyHandler");
const remoteHandler = require("../../../helpers/remoteHandler");
const businessTripHandler = require("../../../helpers/businessTripHandler");
const clientVisitHandler = require("../../../helpers/clientVisitHandler");
const explanationHandler = require("../../../helpers/explanationHandler");
const forgotCheckinHandler = require("../../../helpers/forgotCheckinHandler");

const REQUEST_TYPE_HANDLERS = {
  leave: leaveHandler,
  late_early: lateEarlyHandler,
  remote: remoteHandler,
  business_trip: businessTripHandler,
  client_visit: clientVisitHandler,
  explanation: explanationHandler,
  forgot_checkin: forgotCheckinHandler
};

module.exports = { REQUEST_TYPE_HANDLERS };
