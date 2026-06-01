const COMMISSION_RATE = 1.8; // % cố định

const CIF_COMMISSION_AMOUNT = 10000;
const EKYC_COMMISSION_AMOUNT = 25000;

function getTNCNRate(employment_type) {
    if (employment_type === "fulltime") return 5;
    return 10;
}

// HH = 1.8% × Số tiền × Kỳ hạn (tháng) / 12
// Thực nhận = (1 - T_TNCN) × HH
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

function createCifCommission(sale_id, granted_by = null) {
    return {
        amount: CIF_COMMISSION_AMOUNT,
        sale_id,
        granted_by,
        granted_at: new Date(),
    };
}

function createEkycCommission(sale_id, granted_by = null) {
    return {
        amount: EKYC_COMMISSION_AMOUNT,
        sale_id,
        granted_by,
        granted_at: new Date(),
    };
}

module.exports = {
    calculateCommission,
    getTNCNRate,
    CIF_COMMISSION_AMOUNT,
    EKYC_COMMISSION_AMOUNT,
    createCifCommission,
    createEkycCommission,
};