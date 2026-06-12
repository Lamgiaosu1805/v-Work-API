const axios = require("axios");

export const tikluyClient = axios.create({
  baseURL: process.env.TIKLUY_BASE_URL,
  auth: {
    username: process.env.CRM_SYNC_USERNAME,
    password: process.env.CRM_SYNC_PASSWORD,
  },
  timeout: 10000,
});

tikluyClient.interceptors.request.use((config) => {
  config.headers["transactionId"] = `${Date.now()}-${Math.floor(Math.random() * 1000)}`;
  return config;
});
