const axios = require("axios");

const tikluyClient = axios.create({
  baseURL: process.env.TIKLUY_BASE_URL,
  auth: {
    username: process.env.CRM_SYNC_USERNAME,
    password: process.env.CRM_SYNC_PASSWORD
  },
  timeout: 10000
});

tikluyClient.interceptors.request.use((config) => {
  config.headers.transactionId = `${Date.now()}-${Math.floor(Math.random() * 1000)}`;
  return config;
});

// Danh mục đầu tư của 1 khách (cùng API màn chi tiết khách đang dùng): { rows, total }.
// Dòng có investmentCode, investAmount, startDate, endDate, status (0 đang đầu tư / 1 tất toán trước hạn / 2 đã tất toán),
// totalProfit, formOfMaturity. type=1 giống tab "Đầu tư" của web.
const getInvestmentHoldings = async (externalId, { pageNumber = 0, pageSize = 50, type = 1 } = {}) => {
  const res = await tikluyClient.get(`/user-investment-holding/crm/${externalId}`, {
    params: { pageNumber, pageSize, type }
  });
  const data = res.data?.data ?? {};
  return {
    rows: Array.isArray(data.investmentHoldingProducts) ? data.investmentHoldingProducts : [],
    total: Number(data.totalRecords ?? 0)
  };
};

module.exports = {
  tikluyClient,
  getInvestmentHoldings
};
