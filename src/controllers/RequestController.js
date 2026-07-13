const mongoose = require("mongoose");
const { RequestModel } = require("../models/RequestModel");
const UserInfoModel = require("../models/UserInfoModel");
const { getEligibleReviewers, notify } = require("../helpers/requestUtils");
const leaveHandler = require("../helpers/leaveHandler");
const lateEarlyHandler = require("../helpers/lateEarlyHandler");
const remoteHandler = require("../helpers/remoteHandler");
const businessTripHandler = require("../helpers/businessTripHandler");
const clientVisitHandler = require("../helpers/clientVisitHandler");
const explanationHandler = require("../helpers/explanationHandler");
const forgotCheckinHandler = require("../helpers/forgotCheckinHandler");

const VALID_TYPES = [
  "leave",
  "late_early",
  "remote",
  "business_trip",
  "client_visit",
  "explanation",
  "forgot_checkin"
];

const TYPE_LABELS = {
  leave: "xin nghỉ phép",
  late_early: "đi muộn/về sớm",
  remote: "làm việc từ xa",
  business_trip: "đi công tác",
  client_visit: "đi gặp gỡ khách hàng",
  explanation: "giải trình",
  forgot_checkin: "quên chấm công",
};

const handlers = {
  leave: leaveHandler,
  late_early: lateEarlyHandler,
  remote: remoteHandler,
  business_trip: businessTripHandler,
  client_visit: clientVisitHandler,
  explanation: explanationHandler,
  forgot_checkin: forgotCheckinHandler,
};

const RequestController = {
  getEligibleReviewers: async (req, res) => {
    try {
      const userInfo = await UserInfoModel.findOne({
        id_account: req.account._id,
        isDeleted: false,
      });
      if (!userInfo)
        return res
          .status(404)
          .json({ message: "Không tìm thấy thông tin nhân viên" });

      const reviewers = await getEligibleReviewers(userInfo._id);
      return res.status(200).json({ message: "OK", data: reviewers });
    } catch (error) {
      return res
        .status(500)
        .json({ message: "Lỗi server", error: error.message });
    }
  },

  create: async (req, res) => {
    const { request_type, assigned_reviewer, reason } = req.body;

    if (!VALID_TYPES.includes(request_type))
      return res.status(400).json({ message: "Loại đơn không hợp lệ" });
    if (!assigned_reviewer || !mongoose.Types.ObjectId.isValid(assigned_reviewer))
      return res.status(400).json({ message: "Người duyệt không hợp lệ" });

    const handler = handlers[request_type];

    try {
      const userInfo = await UserInfoModel.findOne({
        id_account: req.account._id,
        isDeleted: false,
      });
      if (!userInfo)
        return res.status(404).json({ message: "Không tìm thấy thông tin nhân viên" });
      if (!userInfo.branch_id)
        return res.status(400).json({ message: "Tài khoản của bạn chưa được gán chi nhánh, vui lòng liên hệ admin" });

      const eligible = await getEligibleReviewers(userInfo._id);
      if (!eligible.length)
        return res.status(400).json({
          message: "Phòng ban của bạn chưa có người quản lý, vui lòng liên hệ admin",
        });
      if (!eligible.map((e) => e.userInfoId.toString()).includes(assigned_reviewer.toString()))
        return res.status(400).json({ message: "Người duyệt không hợp lệ" });

      const { payload, error } = handler.validate(req.body, userInfo);
      if (error) return res.status(error.status).json({ message: error.message });

      const session = await mongoose.startSession();
      session.startTransaction();
      try {
        const asyncError = await handler.validateAsync(payload, userInfo, session);
        if (asyncError) {
          await session.abortTransaction();
          session.endSession();
          return res.status(asyncError.status).json({ message: asyncError.message });
        }

        const [request] = await RequestModel.create(
          [{ user_id: userInfo._id, request_type, reason: reason || "", assigned_reviewer, ...payload }],
          { session },
        );

        if (handler.onCreate) {
          const sideError = await handler.onCreate(request, userInfo, session);
          if (sideError) {
            await session.abortTransaction();
            session.endSession();
            return res.status(sideError.status).json({ message: sideError.message });
          }
        }

        await session.commitTransaction();
        session.endSession();

        getApprovalChain(userInfo._id, { stopAtFirstMatch: true })
          .then((chain) => {
            const nearest = chain[0];
            if (!nearest) return null;
            return notify(nearest.accountId, {
              title: "Đơn xin phép mới",
              body: `${userInfo.full_name} gửi đơn ${TYPE_LABELS[request_type]}`,
              type: `${request_type}_created`,
              ref_id: request._id,
              ref_type: "request",
              uri: `/requests/${request._id}`,
            });
          })
          .catch(() => {});

        return res.status(201).json({ message: "Tạo đơn thành công", data: request });
      } catch (error) {
        await session.abortTransaction();
        session.endSession();
        throw error;
      }
    } catch (error) {
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

      const {
        request_type,
        status,
        from,
        to,
        page = 1,
        limit = 20,
      } = req.query;
      const skip = (Number(page) - 1) * Number(limit);
      const filter = { user_id: userInfo._id, isDeleted: false };

      if (request_type && VALID_TYPES.includes(request_type))
        filter.request_type = request_type;
      if (status) filter.status = status;
      if (from || to) {
        filter.createdAt = {};
        if (from) filter.createdAt.$gte = new Date(from);
        if (to)
          filter.createdAt.$lte = new Date(
            new Date(to).setHours(23, 59, 59, 999),
          );
      }

      const [requests, total] = await Promise.all([
        RequestModel.find(filter)
          .populate("assigned_reviewer", "full_name")
          .populate("reviewed_by", "full_name")
          .sort({ createdAt: -1 })
          .skip(skip)
          .limit(Number(limit)),
        RequestModel.countDocuments(filter),
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
      const { request_type, status, from, to, search, page = 1, limit = 20 } = req.query;
      const skip = (Number(page) - 1) * Number(limit);
      const filter = { isDeleted: false };

      const hasViewAll = await can(req.account, PERMISSION.HRM_REQUEST_VIEW_ALL);
      let scopedUserIds = null;
      if (!hasViewAll) {
        const hasReview = await can(req.account, PERMISSION.HRM_REQUEST_REVIEW);
        if (!hasReview)
          return res.status(403).json({
            errorCode: "FORBIDDEN",
            message: "Bạn không có quyền quản lý tính năng này",
          });

      const {
        request_type,
        status,
        from,
        to,
        search,
        page = 1,
        limit = 20,
      } = req.query;
      const skip = (Number(page) - 1) * Number(limit);
      const filter = { isDeleted: false };

      // if (req.account.role !== "admin") {
      const managerInfo = await UserInfoModel.findOne({
        id_account: req.account._id,
        isDeleted: false,
      });
      if (!managerInfo)
        return res
          .status(404)
          .json({ message: "Không tìm thấy thông tin quản lý" });
      filter.assigned_reviewer = managerInfo._id;
      // }

      if (request_type && VALID_TYPES.includes(request_type))
        filter.request_type = request_type;
      if (status) filter.status = status;
      if (from || to) {
        filter.createdAt = {};
        if (from) filter.createdAt.$gte = new Date(from);
        if (to)
          filter.createdAt.$lte = new Date(
            new Date(to).setHours(23, 59, 59, 999),
          );
      }

      if (search) {
        const matchedUsers = await UserInfoModel.find({
          isDeleted: false,
          $or: [
            { full_name: { $regex: search, $options: "i" } },
            { ma_nv: { $regex: search, $options: "i" } },
          ],
        }).select("_id");
        const matchedIds = matchedUsers.map((u) => u._id);

        if (scopedUserIds) {
          const matchedSet = new Set(matchedIds.map((id) => id.toString()));
          scopedUserIds = scopedUserIds.filter((id) => matchedSet.has(id.toString()));
        } else {
          scopedUserIds = matchedIds;
        }
      }

      const [requests, total] = await Promise.all([
        RequestModel.find(filter)
          .populate("user_id", "full_name ma_nv phone_number")
          .populate("assigned_reviewer", "full_name")
          .populate("reviewed_by", "full_name")
          .sort({ createdAt: -1 })
          .skip(skip)
          .limit(Number(limit)),
        RequestModel.countDocuments(filter),
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
    if (req.account.role === "user")
      return res
        .status(403)
        .json({
          errorCode: "FORBIDDEN",
          message: "Bạn không có quyền quản lý tính năng này",
        });

    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id))
      return res.status(400).json({ message: "ID không hợp lệ" });

    const { action, reviewer_note = "" } = req.body;
    if (!["approve", "reject"].includes(action))
      return res
        .status(400)
        .json({ message: "Hành động không hợp lệ" });

    const session = await mongoose.startSession();
    session.startTransaction();
    try {
      const preCheck = await RequestModel.findOne(
        { _id: id, isDeleted: false },
        { request_type: 1, total_days: 1 }
      );
      if (!preCheck) return res.status(404).json({ message: "Đơn không tồn tại" });

      const canReviewAll = await can(req.account, PERMISSION.HRM_REQUEST_REVIEW_ALL);
      const needsMultiApproval =
        action === "approve" && preCheck.request_type === "leave" && preCheck.total_days > 3;

      if (needsMultiApproval) release = await acquireRequestReviewLock(id);

      session = await mongoose.startSession();
      session.startTransaction();

      const reviewerInfo = await UserInfoModel.findOne({
        id_account: req.account._id,
        isDeleted: false,
      }).session(session);
      if (!reviewerInfo) {
        await session.abortTransaction();
        session.endSession();
        return res
          .status(404)
          .json({ message: "Không tìm thấy thông tin quản lý" });
      }

      const request = await RequestModel.findOne({
        _id: id,
        isDeleted: false,
      }).session(session);
      if (!request) {
        await session.abortTransaction();
        session.endSession();
        return res.status(404).json({ message: "Đơn không tồn tại" });
      }
      if (request.status !== "pending") {
        await session.abortTransaction();
        session.endSession();
        return res
          .status(409)
          .json({ message: "Đơn không ở trạng thái chờ duyệt" });
      }

      if (request.user_id.equals(reviewerInfo._id)) {
        await session.abortTransaction();
        session.endSession();
        return res
          .status(403)
          .json({ message: "Không thể tự duyệt đơn của mình" });
      }
      if (!request.assigned_reviewer.equals(reviewerInfo._id)) {
        await session.abortTransaction();
        session.endSession();
        return res
          .status(403)
          .json({ message: "Bạn không được chỉ định duyệt đơn này" });
      }
      // }

      request.status = action === "approve" ? "approved" : "rejected";
      request.reviewed_by = reviewerInfo._id;
      request.reviewed_at = new Date();
      request.reviewer_note = reviewer_note;
      await request.save({ session });

      const handler = handlers[request.request_type];
      if (action === "approve" && handler?.onApprove) {
        await handler.onApprove(request, session);
      } else if (action === "reject" && handler?.onReject) {
        await handler.onReject(request, session);
      }

      await session.commitTransaction();
      session.endSession();

      if (!isFinal) {
        UserInfoModel.findById(request.user_id)
          .select("id_account full_name")
          .then((employeeInfo) => {
            if (!employeeInfo) return null;
            const employeeAccountId = employeeInfo.id_account.toString();
            if (employeeAccountId === req.account._id.toString()) return null;
            const label = TYPE_LABELS[request.request_type];
            return notify(employeeInfo.id_account, {
              title: "Đơn đã được duyệt bước 1/2",
              body: `Đơn ${label} của bạn đã được ${reviewerInfo.full_name} duyệt (1/2), đang chờ người duyệt tiếp theo`,
              type: "leave_partially_approved",
              ref_id: request._id,
              ref_type: "request",
              uri: `/requests/${request._id}`
            });
          })
          .catch(() => {});

        return res.status(200).json({
          message: "Đã ghi nhận duyệt, đang chờ người duyệt tiếp theo",
          data: request
        });
      }

      Promise.all([
        UserInfoModel.findById(request.user_id).select("id_account full_name"),
        getApprovalChain(request.user_id, { stopAtFirstMatch: true }),
        getAccountsWithPermission(PERMISSION.HRM_REQUEST_VIEW_ALL)
      ])
        .then(([employeeInfo, nearestChain, hrAccountIds]) => {
          if (!employeeInfo) return;
          const label = TYPE_LABELS[request.request_type];
          const title =
            action === "approve" ? "Đơn được duyệt" : "Đơn bị từ chối";
          const body =
            action === "approve"
              ? `Đơn ${label} của bạn đã được ${reviewerInfo.full_name} duyệt`
              : `Đơn ${label} của bạn đã bị ${reviewerInfo.full_name} từ chối${reviewer_note ? `: ${reviewer_note}` : ""}`;
          return notify(employeeInfo.id_account, {
            title,
            body,
            type:
              action === "approve"
                ? `${request.request_type}_approved`
                : `${request.request_type}_rejected`,
            ref_id: request._id,
            ref_type: "request",
            uri: `/requests/${request._id}`,
          });
        })
        .catch(() => { });

      return res.status(200).json({
        message: action === "approve" ? "Đã duyệt đơn" : "Đã từ chối đơn",
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
    if (!mongoose.Types.ObjectId.isValid(id))
      return res.status(400).json({ message: "ID không hợp lệ" });

    const session = await mongoose.startSession();
    session.startTransaction();
    try {
      const userInfo = await UserInfoModel.findOne({
        id_account: req.account._id,
        isDeleted: false,
      }).session(session);
      const request = await RequestModel.findOne({ _id: id, isDeleted: false }).session(session);

      if (!request) {
        await session.abortTransaction();
        session.endSession();
        return res.status(404).json({ message: "Đơn không tồn tại" });
      }
      if (!userInfo || !request.user_id.equals(userInfo._id)) {
        await session.abortTransaction();
        session.endSession();
        return res.status(403).json({ message: "Không có quyền hủy đơn này" });
      }
      if (request.status !== "pending") {
        await session.abortTransaction();
        session.endSession();
        return res
          .status(409)
          .json({ message: "Chỉ có thể hủy đơn đang chờ duyệt" });
      }

      const handler = handlers[request.request_type];
      if (handler?.onReject) {
        await handler.onReject(request, session);
      }

      request.status = "cancelled";
      await request.save({ session });

      await session.commitTransaction();
      session.endSession();

      return res.status(200).json({ message: "Hủy đơn thành công" });
    } catch (error) {
      await session.abortTransaction();
      session.endSession();
      return res
        .status(500)
        .json({ message: "Lỗi server", error: error.message });
    }
  },
};

module.exports = RequestController;
