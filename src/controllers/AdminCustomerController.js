const mongoose = require("mongoose");
const CustomerModel = require("../models/CustomerModel");
const AppModel = require("../models/AppModel");

const ADMIN_CUSTOMER_SORT_FIELDS = new Set([
  "createdAt",
  "updatedAt",
  "phone_number",
  "status",
  "source_type",
  "external_id",
]);

const CUSTOMER_SAFE_SELECT =
  "-identity.id_front_url -identity.id_back_url -identity.selfie_url";

const escapeRegex = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const AdminCustomerController = {
  list: async (req, res) => {
    try {
      const {
        page = 1,
        limit = 20,
        search,
        status,
        source_type,
        app_code,
        from_date,
        to_date,
        sort_by = "createdAt",
        sort_order = "desc",
        include_deleted = "false",
      } = req.query;

      const skip = (Number(page) - 1) * Number(limit);
      const sortField = ADMIN_CUSTOMER_SORT_FIELDS.has(sort_by)
        ? sort_by
        : "createdAt";
      const sortDirection = String(sort_order).toLowerCase() === "asc" ? 1 : -1;
      const includeDeleted = String(include_deleted).toLowerCase() === "true";

      const filter = {};

      if (!includeDeleted) {
        filter.isDeleted = false;
      }

      if (status) filter.status = status;
      if (source_type) filter.source_type = source_type;

      if (app_code) {
        const app = await AppModel.findOne({ code: app_code, is_active: true });
        if (!app) {
          return res
            .status(404)
            .json({ message: "App không tồn tại hoặc đã bị khóa" });
        }
        filter.app_id = app._id;
      }

      if (from_date || to_date) {
        filter.createdAt = {};
        if (from_date) filter.createdAt.$gte = new Date(from_date);
        if (to_date)
          filter.createdAt.$lte = new Date(
            new Date(to_date).setHours(23, 59, 59, 999),
          );
      }

      if (search) {
        const safeSearch = escapeRegex(search.trim());
        filter.$or = [
          { phone_number: { $regex: safeSearch, $options: "i" } },
          { "identity.full_name": { $regex: safeSearch, $options: "i" } },
          { external_id: { $regex: safeSearch, $options: "i" } },
        ];
      }

      const [customers, total] = await Promise.all([
        CustomerModel.find(filter)
          .populate("app_id", "name code")
          .populate("referred_by", "full_name phone_number ma_nv")
          .populate("agent_id", "agent_code full_name phone_number")
          .select(CUSTOMER_SAFE_SELECT)
          .sort({ [sortField]: sortDirection })
          .skip(skip)
          .limit(Number(limit)),
        CustomerModel.countDocuments(filter),
      ]);

      return res.status(200).json({
        message: "Lấy danh sách khách hàng thành công",
        data: customers,
        pagination: {
          total,
          page: Number(page),
          limit: Number(limit),
          total_pages: Math.ceil(total / Number(limit)),
          sort_by: sortField,
          sort_order: sortDirection === 1 ? "asc" : "desc",
        },
      });
    } catch (error) {
      console.error("Error in admin customer list:", error);
      return res.status(500).json({
        message: "Internal server error",
        error: error.message,
      });
    }
  },
};

module.exports = AdminCustomerController;
