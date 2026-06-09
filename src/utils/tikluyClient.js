import axios from "axios";

export const tikluyClient = axios.create({
  baseURL: process.env.TIKLUY_BASE_URL,
  auth: {
    username: process.env.CRM_SYNC_USERNAME,
    password: process.env.CRM_SYNC_PASSWORD,
  },
  headers: {
    transactionId: "TXN-001",
  },
  timeout: 10000,
});
