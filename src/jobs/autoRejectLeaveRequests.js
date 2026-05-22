const cron = require("node-cron");
const mongoose = require("mongoose");
const moment = require("moment-timezone");
const { RequestModel } = require("../models/RequestModel");
const UserInfoModel = require("../models/UserInfoModel");
const NotificationModel = require("../models/NotificationModel");
const pushNotification = require("../helpers/pushNotification");
const { AUTO_REJECT_AFTER_DAYS } = require("../config/common/leaveConfig");

const TZ = "Asia/Ho_Chi_Minh";

async function autoRejectLeaveRequests() {
    try {
        console.log("[Cron] Bắt đầu tự động từ chối đơn nghỉ quá hạn...");

        const threshold = moment.tz(TZ).startOf("day").subtract(AUTO_REJECT_AFTER_DAYS, "days").toDate();

        const expiredRequests = await RequestModel.find({
            request_type: "leave",
            status:       "pending",
            from_date:    { $lte: threshold },
            isDeleted:    false,
        });

        if (!expiredRequests.length) {
            console.log("[Cron] Không có đơn nghỉ nào cần tự động từ chối.");
            return;
        }

        console.log(`[Cron] Tìm thấy ${expiredRequests.length} đơn cần từ chối.`);

        for (const request of expiredRequests) {
            const session = await mongoose.startSession();
            session.startTransaction();
            try {
                request.status        = "rejected";
                request.reviewed_at   = new Date();
                request.reviewer_note = `Tự động từ chối do quá ${AUTO_REJECT_AFTER_DAYS} ngày không được duyệt`;
                await request.save({ session });

                if (request.paid_days > 0) {
                    await UserInfoModel.findByIdAndUpdate(
                        request.user_id,
                        { $inc: { "leave_balance.annual": request.paid_days } },
                        { session },
                    );
                }

                await session.commitTransaction();
                session.endSession();

                UserInfoModel.findById(request.user_id)
                    .select("id_account")
                    .then((userInfo) => {
                        if (!userInfo) return;
                        const fromStr = moment.tz(request.from_date, TZ).format("DD/MM/YYYY");
                        const body = `Đơn xin nghỉ từ ${fromStr} đã bị tự động từ chối do quá ${AUTO_REJECT_AFTER_DAYS} ngày không được duyệt`;
                        return Promise.all([
                            NotificationModel.create({
                                target:     "individual",
                                account_id: userInfo.id_account,
                                title:      "Đơn nghỉ bị từ chối",
                                body,
                                type:       "leave_rejected",
                                ref_id:     request._id,
                                ref_type:   "request",
                                uri:        `/requests/${request._id}`,
                            }),
                            pushNotification.sendToAccount({
                                account_id: userInfo.id_account,
                                title:      "Đơn nghỉ bị từ chối",
                                body,
                                data:       { type: "leave_rejected", uri: `/requests/${request._id}` },
                            }),
                        ]);
                    })
                    .catch(() => {});
            } catch (err) {
                await session.abortTransaction();
                session.endSession();
                console.error(`[Cron] Lỗi khi từ chối đơn ${request._id}:`, err);
            }
        }

        console.log(`[Cron] Hoàn tất tự động từ chối ${expiredRequests.length} đơn nghỉ.`);
    } catch (error) {
        console.error("[Cron] Lỗi autoRejectLeaveRequests:", error);
    }
}

cron.schedule("0 1 * * *", async () => {
    await autoRejectLeaveRequests();
}, { timezone: "Asia/Ho_Chi_Minh" });

module.exports = autoRejectLeaveRequests;
