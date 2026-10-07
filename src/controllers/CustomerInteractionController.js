const CustomerModel = require("../models/CustomerModel");
const CustomerInteractionModel = require("../models/CustomerInteractionModel");
const UserInfoModel = require("../models/UserInfoModel");
const { canAccessCustomer } = require("../helpers/crmScope");
const { canOnSubject } = require("../modules/permission");
const { recordCareReport, getActiveAssignmentForCustomer } = require("../modules/customer-care");

const INTERACTION_TYPES = ["call", "message", "meeting"];
const INTERACTION_RESULTS = [
  "interested",
  "not_interested",
  "need_more_info",
  "will_invest",
  "invested",
  "no_answer"
];
const CONTACT_RESULTS = [
  "connected",
  "no_answer",
  "busy",
  "wrong_number",
  "callback_requested",
  "message_replied"
];
const LOST_REASONS = [
  "no_need",
  "not_eligible",
  "product_mismatch",
  "competitor",
  "unreachable",
  "wrong_contact",
  "other"
];
// Ngoài các loại báo cáo do Sale nhập, lịch sử chăm sóc hiển thị cả log hệ thống (giao/thu hồi/eKYC)
const HISTORY_TYPES = [...INTERACTION_TYPES, "note", "reassigned", "kyc_updated", "status_changed"];

const findCustomer = (externalId) =>
  CustomerModel.findOne({ external_id: externalId, isDeleted: false });

const trimOrNull = (value) => String(value ?? "").trim() || null;

const CustomerInteractionController = {
  list: async (req, res) => {
    try {
      const { externalId } = req.params;
      const page = Math.max(Number(req.query.page) || 1, 1);
      const limit = Math.min(Math.max(Number(req.query.limit) || 20, 1), 100);
      const customer = await findCustomer(externalId);
      if (!customer) return res.status(404).json({ message: "Không tìm thấy khách hàng" });
      if (!(await canAccessCustomer(req.permissionAbility, customer, "customer.view"))) {
        return res.status(403).json({ message: "Bạn không có quyền xem khách hàng này" });
      }

      const filter = {
        customer_id: customer._id,
        isDeleted: false,
        type: { $in: req.query.reportsOnly === "true" ? INTERACTION_TYPES : HISTORY_TYPES }
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

  /**
   * Báo cáo chăm sóc sau mỗi lần liên hệ (Quy định 183A, Điều 7.2). Khi khách đang được giao cho chính
   * Sale báo cáo, bắt buộc đủ: kết quả liên hệ, nhu cầu khách, trạng thái hiện tại, bước tiếp theo
   * (khách từ chối thì bắt buộc lý do thay cho bước tiếp theo) — báo cáo đủ được tính là hoạt động
   * chăm sóc hợp lệ cho SLA.
   */
  create: async (req, res) => {
    try {
      const { externalId } = req.params;
      const {
        type,
        content,
        result = null,
        next_action = {},
        contact_result = null,
        customer_need = null,
        lost_reason = null,
        call_log_id = null
      } = req.body;

      if (!INTERACTION_TYPES.includes(type)) {
        return res.status(400).json({ message: "Hình thức liên hệ không hợp lệ" });
      }
      if (String(content || "").trim().length > 2000) {
        return res.status(400).json({ message: "Nội dung chăm sóc tối đa 2.000 ký tự" });
      }
      if (result && !INTERACTION_RESULTS.includes(result)) {
        return res.status(400).json({ message: "Trạng thái khách hàng không hợp lệ" });
      }
      if (contact_result && !CONTACT_RESULTS.includes(contact_result)) {
        return res.status(400).json({ message: "Kết quả liên hệ không hợp lệ" });
      }
      if (lost_reason && !LOST_REASONS.includes(lost_reason)) {
        return res.status(400).json({ message: "Lý do từ chối không hợp lệ" });
      }

      let dueDate = null;
      if (next_action?.due_date) {
        dueDate = new Date(next_action.due_date);
        if (Number.isNaN(dueDate.getTime())) {
          return res.status(400).json({ message: "Ngày hẹn chăm sóc tiếp theo không hợp lệ" });
        }
      }

      const customer = await findCustomer(externalId);
      if (!customer) return res.status(404).json({ message: "Không tìm thấy khách hàng" });

      const ability = req.permissionAbility;
      const isManager = canOnSubject(ability, "customer_care.manage", "Customer", customer);
      if (!isManager && !(await canAccessCustomer(ability, customer, "customer.view"))) {
        return res
          .status(403)
          .json({ message: "Bạn không có quyền báo cáo chăm sóc khách hàng này" });
      }

      const sale = await UserInfoModel.findOne({ id_account: req.account._id })
        .select("_id")
        .lean();
      if (!sale) return res.status(404).json({ message: "Không tìm thấy thông tin nhân viên" });

      const assignment = await getActiveAssignmentForCustomer(String(customer._id));
      const isAssignedSale = !!assignment && String(assignment.sale_id) === String(sale._id);
      const nextStep = trimOrNull(next_action?.description);

      if (isAssignedSale) {
        const missing = [];
        if (!contact_result) missing.push("kết quả liên hệ");
        if (!trimOrNull(customer_need)) missing.push("nhu cầu khách hàng");
        if (!result) missing.push("trạng thái hiện tại");
        if (result === "not_interested") {
          if (!lost_reason) missing.push("lý do khách từ chối");
        } else if (!nextStep) {
          missing.push("bước tiếp theo");
        }
        if (missing.length) {
          return res.status(400).json({
            message: `Vui lòng nhập đủ: ${missing.join(", ")}`,
            missing_fields: missing
          });
        }
      } else if (!trimOrNull(content) && !trimOrNull(customer_need)) {
        return res.status(400).json({ message: "Vui lòng nhập nội dung chăm sóc khách hàng" });
      }

      const now = new Date();
      const interaction = await CustomerInteractionModel.create({
        app_id: customer.app_id,
        customer_id: customer._id,
        sale_id: sale._id,
        type,
        content: trimOrNull(content),
        result,
        contact_result,
        customer_need: trimOrNull(customer_need),
        lost_reason,
        call_log_id: call_log_id || null,
        assignment_id: isAssignedSale ? assignment._id : null,
        is_valid_activity: isAssignedSale,
        next_action: { description: nextStep, due_date: dueDate }
      });

      if (isAssignedSale) {
        await recordCareReport({
          customerId: String(customer._id),
          saleId: String(sale._id),
          at: now,
          appointmentAt: dueDate && dueDate.getTime() > now.getTime() ? dueDate : null
        });
      }

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
