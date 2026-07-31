const { getEligibleReviewers } = require("../application/get-eligible-reviewers.service");
const { getMyRequests } = require("../application/get-my-requests.service");
const { getAllRequests } = require("../application/get-all-requests.service");
const { getRequestById } = require("../application/get-request-by-id.service");
const { cancelRequest } = require("../application/cancel-request.service");
const { createRequest } = require("../application/create-request.service");
const { reviewRequest } = require("../application/review-request.service");

const requestHttpController = {
  async getEligibleReviewers(req, res) {
    const reviewer = await getEligibleReviewers(req.account._id);
    return res.status(200).json({ message: "OK", data: reviewer });
  },

  async getMyRequests(req, res) {
    const result = await getMyRequests(req.account._id, req.query);
    return res.status(200).json({ message: "OK", ...result });
  },

  async getAll(req, res) {
    const result = await getAllRequests(req.account, req.query);
    return res.status(200).json({ message: "OK", ...result });
  },

  async getById(req, res) {
    const data = await getRequestById(req.account, req.params.id);
    return res.status(200).json({ message: "OK", data });
  },

  async cancel(req, res) {
    await cancelRequest(req.account, req.params.id);
    return res.status(200).json({ message: "Hủy đơn thành công" });
  },

  async create(req, res) {
    const entity = await createRequest(req.account, req.body);
    return res.status(201).json({ message: "Tạo đơn thành công", data: entity.getProps() });
  },

  async review(req, res) {
    const { action, reviewer_note } = req.body;
    const { entity, isFinal } = await reviewRequest(req.account, req.params.id, {
      action,
      reviewer_note
    });

    let message;
    if (!isFinal) {
      message = "Đã ghi nhận duyệt, đang chờ người duyệt tiếp theo";
    } else {
      message = action === "approve" ? "Đã duyệt đơn" : "Đã từ chối đơn";
    }

    return res.status(200).json({ message, data: entity.getProps() });
  }
};

module.exports = { requestHttpController };
