/**
 * Script fix commission.sale_id cho investment của khách đã được chuyển/gán sale.
 *
 * Vấn đề: reassignCustomer và assignCustomer trước đây chỉ update customer.referred_by
 * nhưng không cập nhật commission.sale_id trên InvestmentModel.
 *
 * Script này tìm tất cả investment bị lệch và fix lại dựa trên customer.referred_by hiện tại.
 *
 * Chạy: node scripts/fixInvestmentCommission.js
 * Dry run (chỉ xem, không sửa): node scripts/fixInvestmentCommission.js --dry-run
 */

require("dotenv").config();
const mongoose = require("mongoose");

const isDryRun = process.argv.includes("--dry-run");

const COMMISSION_RATE = 1.8;

function getTNCNRate(employment_type) {
    if (employment_type === "fulltime") return 5;
    return 10;
}

function calculateCommission({ amount, term_months, tncn_rate }) {
    const gross_amount = (COMMISSION_RATE / 100) * amount * term_months / 12;
    const tncn_amount = (tncn_rate / 100) * gross_amount;
    const net_amount = gross_amount - tncn_amount;
    return {
        commission_rate: COMMISSION_RATE,
        gross_amount: Math.round(gross_amount),
        tncn_rate,
        tncn_amount: Math.round(tncn_amount),
        net_amount: Math.round(net_amount),
    };
}

async function run() {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log("DB connected" + (isDryRun ? " [DRY RUN - không ghi DB]" : ""));

    const db = mongoose.connection;
    const customers = db.collection("customers");
    const investments = db.collection("investments");
    const userInfos = db.collection("user_infos");

    // Lấy tất cả khách có referred_by (đã có sale)
    const assignedCustomers = await customers.find(
        { referred_by: { $ne: null, $exists: true }, isDeleted: false },
        { projection: { _id: 1, referred_by: 1, phone_number: 1 } }
    ).toArray();

    console.log(`Tìm thấy ${assignedCustomers.length} khách đã có sale`);

    let totalChecked = 0;
    let totalFixed = 0;
    let totalSkipped = 0;

    for (const customer of assignedCustomers) {
        const currentSaleId = customer.referred_by;

        // Lấy thông tin sale hiện tại
        const sale = await userInfos.findOne(
            { _id: currentSaleId },
            { projection: { _id: 1, full_name: 1, ma_nv: 1, employment_type: 1 } }
        );
        if (!sale) continue;

        const tncn_rate = getTNCNRate(sale.employment_type);

        // Tìm investment bị lệch:
        // 1. commission.sale_id khác currentSaleId (trỏ sai sale) và chưa paid
        // 2. commission.sale_id = null (chưa gán sale)
        const badInvestments = await investments.find({
            customer_id: customer._id,
            status: { $nin: ["cancelled", "early_terminated"] },
            isDeleted: false,
            "commission.status": { $ne: "paid" },
            $or: [
                { "commission.sale_id": null },
                {
                    "commission.sale_id": { $ne: currentSaleId, $exists: true },
                    "commission.receiver_type": "sale",
                },
            ],
        }).toArray();

        if (badInvestments.length === 0) continue;

        totalChecked += badInvestments.length;

        console.log(`\nKhách ${customer.phone_number} (${customer._id}) — sale hiện tại: ${sale.full_name} (${sale.ma_nv})`);
        console.log(`  → ${badInvestments.length} investment cần fix`);

        for (const inv of badInvestments) {
            const oldSaleId = inv.commission?.sale_id ?? null;
            const oldStatus = inv.commission?.status ?? "none";
            const oldGross = inv.commission?.gross_amount ?? 0;

            let update;

            if (inv.term_type !== "month") {
                // Kỳ hạn tuần — không tính HH, chỉ gán sale_id
                update = { $set: { "commission.sale_id": currentSaleId } };
                console.log(`    [week] inv ${inv._id}: sale_id ${oldSaleId} → ${currentSaleId}`);
            } else if (oldStatus === "none" || (!oldGross && oldSaleId === null)) {
                // Chưa có HH — tính mới
                const calc = calculateCommission({ amount: inv.amount, term_months: inv.term_value, tncn_rate });
                update = {
                    $set: {
                        "commission.receiver_type": "sale",
                        "commission.sale_id": currentSaleId,
                        "commission.commission_rate": calc.commission_rate,
                        "commission.gross_amount": calc.gross_amount,
                        "commission.tncn_rate": tncn_rate,
                        "commission.tncn_amount": calc.tncn_amount,
                        "commission.net_amount": calc.net_amount,
                        "commission.status": "pending",
                    },
                };
                console.log(`    [new HH] inv ${inv._id}: gross 0 → ${calc.gross_amount.toLocaleString()}đ, sale ${currentSaleId}`);
            } else {
                // Đã có HH pending nhưng trỏ sai sale — chỉ chuyển sale_id
                update = { $set: { "commission.sale_id": currentSaleId } };
                console.log(`    [transfer] inv ${inv._id}: sale_id ${oldSaleId} → ${currentSaleId}, giữ gross ${oldGross.toLocaleString()}đ`);
            }

            if (!isDryRun) {
                await investments.updateOne({ _id: inv._id }, update);
                totalFixed++;
            } else {
                totalSkipped++;
            }
        }
    }

    console.log("\n═══════════════════════════════════════");
    console.log(`Tổng investment kiểm tra: ${totalChecked}`);
    if (isDryRun) {
        console.log(`Sẽ fix: ${totalSkipped} (dry run — chưa ghi DB)`);
    } else {
        console.log(`Đã fix: ${totalFixed}`);
    }
    console.log("═══════════════════════════════════════");

    await mongoose.disconnect();
    console.log("Xong.");
}

run().catch((err) => {
    console.error("Lỗi:", err.message);
    process.exit(1);
});
