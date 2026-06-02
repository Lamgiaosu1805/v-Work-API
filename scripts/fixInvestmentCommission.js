/**
 * Script fix commission.sale_id cho investment của khách đã được gán sale lần đầu
 * nhưng investment tạo trước khi gán (commission.sale_id = null).
 *
 * Lưu ý nghiệp vụ:
 * - Investment tạo TRƯỚC khi đổi sale → HH vẫn thuộc sale cũ, KHÔNG đụng vào.
 * - Chỉ fix investment có commission.sale_id = null (chưa từng có sale nào nhận).
 * - Investment mới sau khi gán/đổi sale tự dùng customer.referred_by → không cần fix.
 *
 * Chạy: node scripts/fixInvestmentCommission.js
 * Dry run: node scripts/fixInvestmentCommission.js --dry-run
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

    // Chỉ xử lý khách đã có sale (referred_by != null)
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

        const sale = await userInfos.findOne(
            { _id: currentSaleId },
            { projection: { _id: 1, full_name: 1, ma_nv: 1, employment_type: 1 } }
        );
        if (!sale) continue;

        // Chỉ tìm investment chưa có sale nào nhận (commission.sale_id = null)
        // KHÔNG đụng vào investment đã có sale_id dù là sale cũ hay mới
        const unownedInvestments = await investments.find({
            customer_id: customer._id,
            "commission.sale_id": null,
            "commission.status": { $ne: "paid" },
            status: { $nin: ["cancelled", "early_terminated"] },
            isDeleted: false,
        }).toArray();

        if (unownedInvestments.length === 0) continue;

        totalChecked += unownedInvestments.length;

        const tncn_rate = getTNCNRate(sale.employment_type);
        console.log(`\nKhách ${customer.phone_number} — sale: ${sale.full_name} (${sale.ma_nv})`);
        console.log(`  → ${unownedInvestments.length} investment chưa có sale`);

        for (const inv of unownedInvestments) {
            if (inv.term_type !== "month") {
                console.log(`    [week/skip] inv ${inv._id}: term_type=${inv.term_type}, chỉ gán sale_id`);
                if (!isDryRun) {
                    await investments.updateOne(
                        { _id: inv._id },
                        { $set: { "commission.sale_id": currentSaleId } }
                    );
                    totalFixed++;
                } else {
                    totalSkipped++;
                }
                continue;
            }

            const calc = calculateCommission({ amount: inv.amount, term_months: inv.term_value, tncn_rate });
            console.log(`    [new HH] inv ${inv._id}: ${inv.amount?.toLocaleString()}đ × ${inv.term_value}th → gross ${calc.gross_amount.toLocaleString()}đ`);

            if (!isDryRun) {
                await investments.updateOne(
                    { _id: inv._id },
                    {
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
                    }
                );
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
