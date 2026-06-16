const {
  collectErrors,
  validateCrmUserName,
  validateUUID,
  validateAmount,
  validateImageFile,
  buildImageForm,
  compressImage,
} = require("../helpers/transactionHelper");
const { tikluyClient } = require("../utils/tikluyClient");
const FormData = require("form-data");

const TransactionManagementController = {
  getTransactions: async (req, res) => {
    try {
      const { category, pageNumber, pageSize } = req.query;

      const listTransactionRes = await tikluyClient.get(
        `transaction-management?category=${category || 0}&pageNumber=${pageNumber || 0}&pageSize=${pageSize || 10}`,
      );

      const transactionData = listTransactionRes.data?.data || {};
      const total = Number(transactionData.totalRecords || 0);

      return res.status(200).json({
        message: "Lấy danh sách nạp tiền thành công",
        data: transactionData || [],
        pagination: {
          total,
          page: Number(pageNumber) || 0,
          limit: Number(pageSize) || 10,
          total_pages: Math.ceil(total / Number(pageSize) || 10),
        },
      });
    } catch (error) {
      console.error(
        "Error fetching transactions:",
        error?.response?.data || error.message,
      );
      return res.status(500).json({
        message: "Lỗi lấy danh sách nạp tiền",
        error: error.message,
      });
    }
  },

  createManualDeposit: async (req, res) => {
    try {
      const { crmUserName } = req.query;
      const { userId, amount } = req.body;
      const file = req.file;

      const errors = collectErrors({
        crmUserName: validateCrmUserName(crmUserName),
        userId: validateUUID(userId, "userId"),
        amount: validateAmount(amount),
        file: validateImageFile(file),
      });

      if (errors) {
        return res.status(422).json({
          message: errors,
        });
      }

      const compressedBuffer = await compressImage(file.buffer, file.mimetype);

      const form = new FormData();
      form.append("userId", userId);
      form.append("amount", amount);
      form.append("file", compressedBuffer, {
        filename: `deposit_${Date.now()}.jpg`,
        contentType: "image/jpeg",
      });

      const response = await tikluyClient.post(
        `transaction-management/recharge-customer?crmUserName=${encodeURIComponent(crmUserName || "")}`,
        form,
        { headers: form.getHeaders() },
      );

      return res.status(200).json({
        message: "Tạo giao dịch nạp tiền thủ công thành công",
        data: response.data,
      });
    } catch (error) {
      console.error(
        "Error creating manual deposit:",
        error?.response?.data || error.message,
      );
      return res.status(500).json({
        message: "Lỗi tạo giao dịch nạp tiền thủ công",
        error: error?.response?.data || error.message,
      });
    }
  },

  requestAccounting: async (req, res) => {
    try {
      const { id } = req.params;
      const { crmUserName } = req.query;
      const { amount } = req.body;
      const file = req.file;

      const errors = collectErrors({
        id: validateUUID(id, "id"),
        crmUserName: validateCrmUserName(crmUserName),
        amount: validateAmount(amount),
        file: validateImageFile(file),
      });

      if (errors) {
        return res.status(422).json({
          message: errors,
        });
      }

      const compressedBuffer = await compressImage(file.buffer, file.mimetype);

      const form = new FormData();
      form.append("amount", amount);
      form.append("file", compressedBuffer, {
        filename: `deposit_${Date.now()}.jpg`,
        contentType: "image/jpeg",
      });

      const response = await tikluyClient.post(
        `transaction-management/recharge-customer/${id}?crmUserName=${encodeURIComponent(crmUserName || "")}`,
        form,
        { headers: form.getHeaders() },
      );

      return res.status(200).json({
        message: "Yêu cầu kế toán xử lý giao dịch thành công",
        data: response.data,
      });
    } catch (error) {
      console.error(
        "Error requesting accounting:",
        error?.response?.data || error.message,
      );
      return res.status(500).json({
        message: "Lỗi yêu cầu kế toán xử lý giao dịch",
        error: error?.response?.data || error.message,
      });
    }
  },
};

module.exports = TransactionManagementController;
