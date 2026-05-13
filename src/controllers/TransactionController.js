const AppModel = require("../models/AppModel");
const CustomerModel = require("../models/CustomerModel");
const TransactionHistoryModel = require("../models/TransactionHistoryModel");
const FluctuationHistoryModel = require("../models/FluctuationHistoryModel");

const TransactionController = {
    // POST /transactions/sync-history
    syncHistory: async (req, res) => {
        try {
            const { app_code, transactions = [], fluctuations = [] } = req.body;

            if (!app_code) {
                return res.status(400).json({ message: "Thiếu app_code" });
            }

            if (!Array.isArray(transactions) || !Array.isArray(fluctuations)) {
                return res.status(400).json({ message: "transactions và fluctuations phải là mảng" });
            }

            if (transactions.length === 0 && fluctuations.length === 0) {
                return res.status(400).json({ message: "Cần ít nhất transactions hoặc fluctuations" });
            }

            if (transactions.length > 500 || fluctuations.length > 500) {
                return res.status(400).json({ message: "Tối đa 500 items mỗi loại" });
            }

            const app = await AppModel.findOne({ code: app_code, is_active: true });
            if (!app) {
                return res.status(404).json({ message: "App không tồn tại" });
            }

            const customerCache = {};

            const getCustomer = async (external_id) => {
                if (!external_id) throw new Error("Thiếu external_id");
                if (customerCache[external_id]) return customerCache[external_id];

                const customer = await CustomerModel.findOne({ app_id: app._id, external_id });
                if (!customer) throw new Error(`Không tìm thấy khách hàng với external_id: ${external_id}`);
                console.log('customer', customer)
                customerCache[external_id] = customer;
                return customer;
            };

            const txResults = { total: transactions.length, created: 0, skipped: 0, failed: [] };

            for (const item of transactions) {
                try {
                    if (!item.external_transaction_id) {
                        txResults.failed.push({ external_transaction_id: null, reason: "Thiếu external_transaction_id" });
                        continue;
                    }

                    const customer = await getCustomer(item.external_id);

                    const exists = await TransactionHistoryModel.findOne({
                        app_id: app._id,
                        external_transaction_id: item.external_transaction_id,
                    });

                    if (exists) { txResults.skipped++; continue; }

                    await TransactionHistoryModel.create({
                        app_id: app._id,
                        customer_id: customer._id,
                        external_id: item.external_id,
                        external_transaction_id: item.external_transaction_id,
                        amount: item.amount ?? null,
                        category: item.category ?? null,
                        status: item.status ?? null,
                        details: item.details ?? null,
                        associate_bank_id: item.associate_bank_id ?? null,
                        is_auto: item.is_auto ?? null,
                        img_id: item.img_id ?? null,
                        reject_reason: item.reject_reason ?? null,
                        transaction_date: item.transaction_date ? new Date(item.transaction_date) : null,
                    });

                    txResults.created++;
                } catch (err) {
                    txResults.failed.push({ external_transaction_id: item.external_transaction_id ?? null, reason: err.message });
                }
            }

            const flResults = { total: fluctuations.length, created: 0, skipped: 0, failed: [] };

            for (const item of fluctuations) {
                try {
                    if (!item.external_fluctuation_id) {
                        flResults.failed.push({ external_fluctuation_id: null, reason: "Thiếu external_fluctuation_id" });
                        continue;
                    }

                    const customer = await getCustomer(item.external_id);

                    const exists = await FluctuationHistoryModel.findOne({
                        app_id: app._id,
                        external_fluctuation_id: item.external_fluctuation_id,
                    });

                    if (exists) { flResults.skipped++; continue; }

                    await FluctuationHistoryModel.create({
                        app_id: app._id,
                        customer_id: customer._id,
                        external_id: item.external_id,
                        external_fluctuation_id: item.external_fluctuation_id,
                        acc_no: item.acc_no ?? null,
                        acc_name: item.acc_name ?? null,
                        transaction_id: item.transaction_id ?? null,
                        fluctuated_amount: item.fluctuated_amount ?? null,
                        total_remaining_amount: item.total_remaining_amount ?? null,
                        content: item.content ?? null,
                        is_plus: item.is_plus ?? null,
                        transaction_date: item.transaction_date ? new Date(item.transaction_date) : null,
                        created_by: item.created_by ?? null,
                    });

                    flResults.created++;
                } catch (err) {
                    flResults.failed.push({ external_fluctuation_id: item.external_fluctuation_id ?? null, reason: err.message });
                }
            }

            return res.status(200).json({
                message: "Đồng bộ lịch sử thành công",
                results: {
                    transactions: txResults,
                    fluctuations: flResults,
                },
            });
        } catch (error) {
            console.error("Error in syncHistory:", error);
            return res.status(500).json({ message: "Internal server error", error: error.message });
        }
    },
};

module.exports = TransactionController;
