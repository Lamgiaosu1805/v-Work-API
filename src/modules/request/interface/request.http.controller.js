const { getEligibleReviewers } = require("../application/get-eligible-reviewers.service");
const { getMyRequests } = require("../application/get-my-requests.service");
const { getAllRequests } = require("../application/get-all-requests.service");

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
  }
};

module.exports = { requestHttpController };
