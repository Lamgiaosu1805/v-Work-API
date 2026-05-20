const mongoose = require("mongoose");
const moment = require("moment-timezone");
const LeaveRequestModel = require("../models/LeaveRequestModel");
const UserInfoModel = require("../models/UserInfoModel");
const WorkSheetModel = require("../models/WorkSheetModel");
const UserDepartmentPositionModel = require("../models/UserDepartmentPositionModel");
const AccountModel = require("../models/AccountModel");
const NotificationModel = require("../models/NotificationModel");
const pushNotification = require("../helpers/pushNotification");

const { MONTHLY_ACCRUAL } = require("../config/common/leaveConfig");

const TZ = "Asia/Ho_Chi_Minh";

function calcTotalDays(fromDate, fromPeriod, toDate, toPeriod) {
  const from = moment.tz(fromDate, TZ).startOf("day");
  const to = moment.tz(toDate, TZ).startOf("day");

  if (to.isBefore(from)) return null;
  if (
    from.isSame(to, "day") &&
    fromPeriod === "afternoon" &&
    toPeriod === "morning"
  )
    return null;

  let total = 0;
  const cursor = from.clone();

  while (cursor.isSameOrBefore(to, "day")) {
    const dow = cursor.day();

    if (dow === 0) {
      cursor.add(1, "day");
      continue;
    }

    const isFromDay = cursor.isSame(from, "day");
    const isToDay = cursor.isSame(to, "day");

    if (dow === 6) {
      total += isFromDay && fromPeriod === "afternoon" ? 0 : 0.5;
    } else {
      if (isFromDay && isToDay) {
        total += fromPeriod === "morning" && toPeriod === "afternoon" ? 1 : 0.5;
      } else if (isFromDay) {
        total += fromPeriod === "morning" ? 1 : 0.5;
      } else if (isToDay) {
        total += toPeriod === "afternoon" ? 1 : 0.5;
      } else {
        total += 1;
      }
    }
    cursor.add(1, "day");
  }

  return total;
}

async function findDirectManagerAccountIds(userInfoId) {
  const employee = await UserInfoModel.findById(userInfoId, { branch_id: 1 });
  const branchId = employee?.branch_id ?? null;

  const memberships = await UserDepartmentPositionModel.find(
    { user: userInfoId, isDeleted: false },
    { department: 1 },
  );
  const deptIds = memberships.map((m) => m.department);
  if (!deptIds.length) return [];

  const userInfoMatch = { "userInfo.isDeleted": false };
  if (branchId) userInfoMatch["userInfo.branch_id"] = branchId;

  const results = await UserDepartmentPositionModel.aggregate([
    {
      $match: {
        department: { $in: deptIds },
        user: { $ne: userInfoId },
        isDeleted: false,
      },
    },
    {
      $lookup: {
        from: "user_infos",
        localField: "user",
        foreignField: "_id",
        as: "userInfo",
      },
    },
    { $unwind: "$userInfo" },
    { $match: userInfoMatch },
    {
      $lookup: {
        from: "accounts",
        localField: "userInfo.id_account",
        foreignField: "_id",
        as: "account",
      },
    },
    { $unwind: "$account" },
    {
      $match: {
        "account.role": "manager",
        "account.module_access": "hrm",
        "account.dept_scope": "own",
        "account.isDeleted": false,
      },
    },
    { $group: { _id: "$account._id" } },
  ]);

  return results.map((r) => r._id);
}

async function notify(accountId, { title, body, type, ref_id, ref_type, uri }) {
  await NotificationModel.create({
    target: "individual",
    account_id: accountId,
    title,
    body,
    type,
    ref_id,
    ref_type,
    uri,
  });
  pushNotification
    .sendToAccount({
      account_id: accountId,
      title,
      body,
      data: { type, uri: uri || "" },
    })
    .catch(() => {});
}

const LeaveRequestController = {
  create: async (req, res) => {
    const session = await mongoose.startSession();
    session.startTransaction();
    try {
      const { from_date, from_period, to_date, to_period, leave_type, reason } = req.body;

      if (!from_date || !from_period || !to_date || !to_period || !leave_type) {
        await session.abortTransaction();
        session.endSession();
        return res.status(400).json({ message: "Thông tin đầu vào không hợp lệ" });
      }
      if (!["paid", "unpaid"].includes(leave_type)) {
        await session.abortTransaction();
        session.endSession();
        return res.status(400).json({ message: "Thông tin đầu vào không hợp lệ" });
      }

      const userInfo = await UserInfoModel.findOne({
        id_account: req.account._id,
        isDeleted: false,
      }).session(session);
      if (!userInfo) {
        await session.abortTransaction();
        session.endSession();
        return res.status(404).json({ message: "Không tìm thấy thông tin nhân viên" });
      }

      const total_days = calcTotalDays(from_date, from_period, to_date, to_period);
      if (total_days === null || total_days === 0) {
        await session.abortTransaction();
        session.endSession();
        return res.status(400).json({ message: "Khoảng thời gian nghỉ không hợp lệ" });
      }

      if (leave_type === "paid" && total_days > userInfo.leave_balance.annual) {
        await session.abortTransaction();
        session.endSession();
        return res.status(400).json({
          message: "Số ngày phép không đủ",
          available: userInfo.leave_balance.annual,
        });
      }

      const overlap = await LeaveRequestModel.findOne({
        user_id: userInfo._id,
        status: { $in: ["pending", "approved"] },
        from_date: { $lte: new Date(to_date) },
        to_date: { $gte: new Date(from_date) },
        isDeleted: false,
      }).session(session);
      if (overlap) {
        await session.abortTransaction();
        session.endSession();
        return res.status(409).json({ message: "Đã có đơn nghỉ trong khoảng thời gian này" });
      }

      const [request] = await LeaveRequestModel.create(
        [{ user_id: userInfo._id, from_date, from_period, to_date, to_period, total_days, leave_type, reason: reason || "" }],
        { session },
      );

      if (leave_type === "paid") {
        await UserInfoModel.findByIdAndUpdate(
          userInfo._id,
          { $inc: { "leave_balance.annual": -total_days } },
          { session },
        );
      }

      await session.commitTransaction();
      session.endSession();

      findDirectManagerAccountIds(userInfo._id)
        .then((managerIds) => {
          const fromStr = moment.tz(request.from_date, TZ).format("DD/MM");
          const toStr = moment.tz(request.to_date, TZ).format("DD/MM");
          return Promise.all(
            managerIds.map((accountId) =>
              notify(accountId, {
                title: "Đơn xin nghỉ",
                body: `${userInfo.full_name} xin nghỉ từ ${fromStr} đến ${toStr} (${request.total_days} ngày)`,
                type: "leave_request_created",
                ref_id: request._id,
                ref_type: "leave_request",
                uri: `/leave-requests/${request._id}`,
              }),
            ),
          );
        })
        .catch(() => {});

      return res.status(201).json({ message: "Tạo đơn xin nghỉ thành công", data: request });
    } catch (error) {
      await session.abortTransaction();
      session.endSession();
      return res.status(500).json({ message: "Lỗi server", error: error.message });
    }
  },

  getMyRequests: async (req, res) => {
    try {
      const userInfo = await UserInfoModel.findOne({
        id_account: req.account._id,
        isDeleted: false,
      });
      if (!userInfo)
        return res
          .status(404)
          .json({ message: "Không tìm thấy thông tin nhân viên" });

      const { status, from, to, page = 1, limit = 20 } = req.query;
      const skip = (Number(page) - 1) * Number(limit);
      const filter = { user_id: userInfo._id, isDeleted: false };

      if (status) filter.status = status;
      if (from || to) {
        filter.from_date = {};
        if (from) filter.from_date.$gte = new Date(from);
        if (to)
          filter.from_date.$lte = new Date(
            new Date(to).setHours(23, 59, 59, 999),
          );
      }

      const [requests, total] = await Promise.all([
        LeaveRequestModel.find(filter)
          .populate("reviewed_by", "full_name")
          .sort({ createdAt: -1 })
          .skip(skip)
          .limit(Number(limit)),
        LeaveRequestModel.countDocuments(filter),
      ]);

      return res.status(200).json({
        message: "OK",
        data: requests,
        pagination: {
          total,
          page: Number(page),
          limit: Number(limit),
          total_pages: Math.ceil(total / Number(limit)),
        },
      });
    } catch (error) {
      return res
        .status(500)
        .json({ message: "Lỗi server", error: error.message });
    }
  },

  getAll: async (req, res) => {
    try {
      const { status, from, to, search, page = 1, limit = 20 } = req.query;
      const skip = (Number(page) - 1) * Number(limit);
      const filter = { isDeleted: false };

      if (req.account.role === "user") {
        return res.status(403).json({
          errorCode: "FORBIDDEN",
          message: "Bạn không có quyền quản lý tính năng này",
        });
      }

      if (status) filter.status = status;
      if (from || to) {
        filter.from_date = {};
        if (from) filter.from_date.$gte = new Date(from);
        if (to)
          filter.from_date.$lte = new Date(
            new Date(to).setHours(23, 59, 59, 999),
          );
      }

      let allowedUserIds = null;

      if (req.account.role !== "admin") {
        const managerInfo = await UserInfoModel.findOne({
          id_account: req.account._id,
          isDeleted: false,
        });
        if (!managerInfo)
          return res
            .status(404)
            .json({ message: "Không tìm thấy thông tin quản lý" });

        let deptUserIds = null;
        if (req.account.dept_scope === "own") {
          const memberships = await UserDepartmentPositionModel.find({
            user: managerInfo._id,
            isDeleted: false,
          });
          const deptIds = memberships.map((m) => m.department);
          deptUserIds = await UserDepartmentPositionModel.find({
            department: { $in: deptIds },
            isDeleted: false,
          }).distinct("user");
        }

        const branchFilter = { branch_id: managerInfo.branch_id, isDeleted: false };
        if (deptUserIds) branchFilter._id = { $in: deptUserIds };

        const branchUsers = await UserInfoModel.find(branchFilter).distinct("_id");
        allowedUserIds = branchUsers.filter((id) => !id.equals(managerInfo._id));
      }

      if (search) {
        const searchFilter = {
          isDeleted: false,
          $or: [
            { full_name: { $regex: search, $options: "i" } },
            { ma_nv: { $regex: search, $options: "i" } },
          ],
        };
        if (allowedUserIds) searchFilter._id = { $in: allowedUserIds };

        const matchedUsers =
          await UserInfoModel.find(searchFilter).select("_id");
        filter.user_id = { $in: matchedUsers.map((u) => u._id) };
      } else if (allowedUserIds) {
        filter.user_id = { $in: allowedUserIds };
      }

      const [requests, total] = await Promise.all([
        LeaveRequestModel.find(filter)
          .populate("user_id", "full_name ma_nv phone_number")
          .populate("reviewed_by", "full_name")
          .sort({ createdAt: -1 })
          .skip(skip)
          .limit(Number(limit)),
        LeaveRequestModel.countDocuments(filter),
      ]);

      return res.status(200).json({
        message: "OK",
        data: requests,
        pagination: {
          total,
          page: Number(page),
          limit: Number(limit),
          total_pages: Math.ceil(total / Number(limit)),
        },
      });
    } catch (error) {
      return res
        .status(500)
        .json({ message: "Lỗi server", error: error.message });
    }
  },

  review: async (req, res) => {
    if (req.account.role === "user") {
      return res.status(403).json({
        errorCode: "FORBIDDEN",
        message: "Bạn không có quyền quản lý tính năng này",
      });
    }
    const session = await mongoose.startSession();
    session.startTransaction();
    try {
      const { id } = req.params;
      if (!mongoose.Types.ObjectId.isValid(id)) {
        await session.abortTransaction();
        session.endSession();
        return res.status(400).json({ message: "ID không hợp lệ" });
      }

      const { action, reviewer_note = "" } = req.body;
      if (!["approve", "reject"].includes(action)) {
        await session.abortTransaction();
        session.endSession();
        return res
          .status(400)
          .json({ message: "action phải là approve hoặc reject" });
      }

      const request = await LeaveRequestModel.findOne({
        _id: id,
        isDeleted: false,
      }).session(session);
      if (!request) {
        await session.abortTransaction();
        session.endSession();
        return res.status(404).json({ message: "Đơn nghỉ không tồn tại" });
      }
      if (request.status !== "pending") {
        await session.abortTransaction();
        session.endSession();
        return res
          .status(409)
          .json({ message: "Đơn nghỉ không ở trạng thái chờ duyệt" });
      }

      if (req.account.role !== "admin") {
        const managerInfo = await UserInfoModel.findOne({
          id_account: req.account._id,
          isDeleted: false,
        }).session(session);

        if (request.user_id.equals(managerInfo._id)) {
          await session.abortTransaction();
          session.endSession();
          return res
            .status(403)
            .json({ message: "Không thể tự duyệt đơn của mình" });
        }

        const employeeInfo = await UserInfoModel.findById(
          request.user_id,
          { branch_id: 1 },
        ).session(session);
        if (
          !managerInfo.branch_id ||
          !employeeInfo?.branch_id ||
          !managerInfo.branch_id.equals(employeeInfo.branch_id)
        ) {
          await session.abortTransaction();
          session.endSession();
          return res
            .status(403)
            .json({ message: "Không có quyền duyệt đơn của nhân viên khác chi nhánh" });
        }

        if (req.account.dept_scope === "own") {
          const memberships = await UserDepartmentPositionModel.find({
            user: managerInfo._id,
            isDeleted: false,
          }).session(session);
          const deptIds = memberships.map((m) => m.department);
          const deptUsers = await UserDepartmentPositionModel.find({
            department: { $in: deptIds },
            isDeleted: false,
          }).distinct("user");

          const canReview = deptUsers.some((id) => id.equals(request.user_id));
          if (!canReview) {
            await session.abortTransaction();
            session.endSession();
            return res
              .status(403)
              .json({ message: "Không có quyền duyệt đơn này" });
          }
        }
      }

      const reviewerInfo = await UserInfoModel.findOne({
        id_account: req.account._id,
        isDeleted: false,
      }).session(session);

      request.status = action === "approve" ? "approved" : "rejected";
      request.reviewed_by = reviewerInfo._id;
      request.reviewed_at = new Date();
      request.reviewer_note = reviewer_note;
      await request.save({ session });

      if (action === "approve") {
        const fromStart = moment.tz(request.from_date, TZ).startOf("day").toDate();
        const toEnd = moment.tz(request.to_date, TZ).endOf("day").toDate();
        await WorkSheetModel.updateMany(
          {
            user_id: request.user_id,
            date: { $gte: fromStart, $lte: toEnd },
            isDeleted: false,
          },
          { status: "leave" },
          { session },
        );
      } else {
        if (request.leave_type === "paid") {
          await UserInfoModel.findByIdAndUpdate(
            request.user_id,
            { $inc: { "leave_balance.annual": request.total_days } },
            { session },
          );
        }
      }

      await session.commitTransaction();
      session.endSession();

      UserInfoModel.findById(request.user_id)
        .select("id_account full_name")
        .then((employeeInfo) => {
          if (!employeeInfo) return;
          const title =
            action === "approve"
              ? "Đơn nghỉ được duyệt"
              : "Đơn nghỉ bị từ chối";
          const body =
            action === "approve"
              ? `Đơn xin nghỉ của bạn đã được ${reviewerInfo.full_name} duyệt`
              : `Đơn xin nghỉ của bạn đã bị ${reviewerInfo.full_name} từ chối${reviewer_note ? `: ${reviewer_note}` : ""}`;
          return notify(employeeInfo.id_account, {
            title,
            body,
            type:
              action === "approve"
                ? "leave_request_approved"
                : "leave_request_rejected",
            ref_id: request._id,
            ref_type: "leave_request",
            uri: `/leave-requests/${request._id}`,
          });
        })
        .catch(() => {});

      return res.status(200).json({
        message:
          action === "approve" ? "Đã duyệt đơn nghỉ" : "Đã từ chối đơn nghỉ",
        data: request,
      });
    } catch (error) {
      await session.abortTransaction();
      session.endSession();
      return res
        .status(500)
        .json({ message: "Lỗi server", error: error.message });
    }
  },

  cancel: async (req, res) => {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ message: "ID không hợp lệ" });
    }

    const session = await mongoose.startSession();
    session.startTransaction();
    try {
      const [currentUserInfo, request] = await Promise.all([
        UserInfoModel.findOne({ id_account: req.account._id, isDeleted: false }).session(session),
        LeaveRequestModel.findOne({ _id: id, isDeleted: false }).session(session),
      ]);

      if (!request) {
        await session.abortTransaction();
        session.endSession();
        return res.status(404).json({ message: "Đơn nghỉ không tồn tại" });
      }

      const isOwner = currentUserInfo && request.user_id.equals(currentUserInfo._id);
      const isManagerOrAdmin = req.account.role === "admin" || req.account.role === "manager";

      if (isOwner) {
        if (request.status !== "pending") {
          await session.abortTransaction();
          session.endSession();
          return res.status(409).json({ message: "Chỉ có thể hủy đơn đang chờ duyệt" });
        }
      } else if (isManagerOrAdmin) {
        if (!["pending", "approved"].includes(request.status)) {
          await session.abortTransaction();
          session.endSession();
          return res.status(409).json({ message: "Chỉ có thể hủy đơn đang chờ duyệt hoặc đã được duyệt" });
        }

        if (request.status === "approved") {
          const now = moment.tz(TZ);
          const fromDate = moment.tz(request.from_date, TZ).startOf("day");
          if (!now.isBefore(fromDate)) {
            await session.abortTransaction();
            session.endSession();
            return res.status(409).json({ message: "Không thể hủy đơn khi nhân viên đã bắt đầu kỳ nghỉ" });
          }
        }

        if (req.account.role !== "admin") {
          const employeeInfo = await UserInfoModel.findById(request.user_id, { branch_id: 1 }).session(session);
          if (
            !currentUserInfo?.branch_id ||
            !employeeInfo?.branch_id ||
            !currentUserInfo.branch_id.equals(employeeInfo.branch_id)
          ) {
            await session.abortTransaction();
            session.endSession();
            return res.status(403).json({ message: "Không có quyền hủy đơn của nhân viên khác chi nhánh" });
          }

          if (req.account.dept_scope === "own") {
            const memberships = await UserDepartmentPositionModel.find({
              user: currentUserInfo._id,
              isDeleted: false,
            }).session(session);
            const deptIds = memberships.map((m) => m.department);
            const deptUsers = await UserDepartmentPositionModel.find({
              department: { $in: deptIds },
              isDeleted: false,
            }).distinct("user");
            if (!deptUsers.some((uid) => uid.equals(request.user_id))) {
              await session.abortTransaction();
              session.endSession();
              return res.status(403).json({ message: "Không có quyền hủy đơn này" });
            }
          }
        }
      } else {
        await session.abortTransaction();
        session.endSession();
        return res.status(403).json({ message: "Không có quyền hủy đơn này" });
      }

      if (request.leave_type === "paid") {
        await UserInfoModel.findByIdAndUpdate(
          request.user_id,
          { $inc: { "leave_balance.annual": request.total_days } },
          { session },
        );
      }

      if (request.status === "approved") {
        const fromStart = moment.tz(request.from_date, TZ).startOf("day").toDate();
        const toEnd = moment.tz(request.to_date, TZ).endOf("day").toDate();
        await WorkSheetModel.updateMany(
          {
            user_id: request.user_id,
            date: { $gte: fromStart, $lte: toEnd },
            status: "leave",
            isDeleted: false,
          },
          { status: "pending" },
          { session },
        );
      }

      request.status = "cancelled";
      await request.save({ session });

      await session.commitTransaction();
      session.endSession();

      if (!isOwner) {
        UserInfoModel.findById(request.user_id)
          .select("id_account full_name")
          .then((employeeInfo) => {
            if (!employeeInfo) return;
            return notify(employeeInfo.id_account, {
              title: "Đơn nghỉ bị hủy",
              body: `Đơn xin nghỉ của bạn đã bị ${currentUserInfo.full_name} hủy`,
              type: "leave_request_cancelled",
              ref_id: request._id,
              ref_type: "leave_request",
              uri: `/leave-requests/${request._id}`,
            });
          })
          .catch(() => {});
      }

      return res.status(200).json({ message: "Hủy đơn nghỉ thành công" });
    } catch (error) {
      await session.abortTransaction();
      session.endSession();
      return res.status(500).json({ message: "Lỗi server", error: error.message });
    }
  },
};

module.exports = LeaveRequestController;
