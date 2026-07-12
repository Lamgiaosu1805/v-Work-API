const CustomerModel = require("../models/CustomerModel");
const CustomerInteractionModel = require("../models/CustomerInteractionModel");
const { canAccessCustomer, getCurrentUserInfo } = require("../helpers/crmScope");

const INTERACTION_TYPES = ["call", "message"];
const INTERACTION_RESULTS = [
  "interested",
  "not_interested",
  "need_more_info",
  "will_invest",
  "invested",
  "no_answer"
];

const findCustomer = (externalId) =>
  CustomerModel.findOne({ external_id: externalId, isDeleted: false });

const ensureCustomerAccess = async (req, res, customer) => {
  const allowed = await canAccessCustomer(req.account, customer);
  if (allowed) return true;
  res.status(403).json({ message: "Bạn không có quyền xem hoặc báo cáo chăm sóc khách hàng này" });
  return false;
};

const CustomerInteractionController = {
  list: async (req, res) => {
    try {
      const { externalId } = req.params;
      const page = Math.max(Number(req.query.page) || 1, 1);
      const limit = Math.min(Math.max(Number(req.query.limit) || 20, 1), 100);
      const customer = await findCustomer(externalId);
      if (!customer) return res.status(404).json({ message: "Không tìm thấy khách hàng" });
      if (!(await ensureCustomerAccess(req, res, customer))) return undefined;

      const filter = {
        customer_id: customer._id,
        isDeleted: false,
        type: { $in: INTERACTION_TYPES }
      };
      const [data, total] = await Promise.all([
        CustomerInteractionModel.find(filter)
          .populate("sale_id", "full_name ma_nv")
          .sort({ createdAt: -1 })
          .skip((page - 1) * limit)
          .limit(limit)
          .lean(),
        CustomerInteractionModel.countDocuments(filter)
      ]);

      return res.status(200).json({
        data,
        pagination: { total, page, limit, total_pages: Math.ceil(total / limit) }
      });
    } catch (error) {
      console.error("CustomerInteractionController.list:", error);
      return res
        .status(500)
        .json({ message: "Không thể tải lịch sử chăm sóc", error: error.message });
    }
  },

  create: async (req, res) => {
    try {
      const { externalId } = req.params;
      const { type, content, result = null, next_action = {} } = req.body;
      if (!INTERACTION_TYPES.includes(type)) {
        return res
          .status(400)
          .json({ message: "Loại báo cáo chỉ có thể là gọi điện hoặc nhắn tin" });
      }
      if (!String(content || "").trim()) {
        return res.status(400).json({ message: "Vui lòng nhập nội dung chăm sóc khách hàng" });
      }
      if (String(content).trim().length > 2000) {
        return res.status(400).json({ message: "Nội dung chăm sóc tối đa 2.000 ký tự" });
      }
      if (result && !INTERACTION_RESULTS.includes(result)) {
        return res.status(400).json({ message: "Kết quả chăm sóc không hợp lệ" });
      }

      const customer = await findCustomer(externalId);
      if (!customer) return res.status(404).json({ message: "Không tìm thấy khách hàng" });
      if (!(await ensureCustomerAccess(req, res, customer))) return undefined;
      if (!customer.referred_by && req.account.role !== "admin") {
        return res.status(409).json({ message: "Khách hàng chưa được phân công sale phụ trách" });
      }

      const sale = await getCurrentUserInfo(req.account._id);
      if (!sale) return res.status(404).json({ message: "Không tìm thấy thông tin nhân viên" });

      let dueDate = null;
      if (next_action?.due_date) {
        dueDate = new Date(next_action.due_date);
        if (Number.isNaN(dueDate.getTime())) {
          return res.status(400).json({ message: "Ngày hẹn chăm sóc tiếp theo không hợp lệ" });
        }
      }

      const interaction = await CustomerInteractionModel.create({
        app_id: customer.app_id,
        customer_id: customer._id,
        sale_id: sale._id,
        type,
        content: String(content).trim(),
        result,
        next_action: {
          description: String(next_action?.description || "").trim() || null,
          due_date: dueDate
        }
      });
      await interaction.populate("sale_id", "full_name ma_nv");
      return res.status(201).json({ message: "Đã lưu báo cáo chăm sóc", data: interaction });
    } catch (error) {
      console.error("CustomerInteractionController.create:", error);
      return res
        .status(500)
        .json({ message: "Không thể lưu báo cáo chăm sóc", error: error.message });
    }
  }
};

module.exports = CustomerInteractionController;
