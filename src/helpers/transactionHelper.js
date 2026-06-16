const sharp = require("sharp");

const ALLOWED_MIME_TYPES = ["image/jpeg", "image/png", "image/jpg"];
const MAX_FILE_SIZE = 5 * 1024 * 1024;
const MAX_IMAGE_DIMENSION = 1920;
const JPEG_QUALITY = 80;

const compressImage = async (buffer) => {
  const image = sharp(buffer);
  const metadata = await image.metadata();

  const needsResize =
    metadata.width > MAX_IMAGE_DIMENSION ||
    metadata.height > MAX_IMAGE_DIMENSION;

  const pipeline = needsResize
    ? image.resize(MAX_IMAGE_DIMENSION, MAX_IMAGE_DIMENSION, {
        fit: "inside",
        withoutEnlargement: true,
      })
    : image;

  return pipeline.jpeg({ quality: JPEG_QUALITY, progressive: true }).toBuffer();
};

/**
 * @returns {string|null} error message hoặc null nếu hợp lệ
 */
const validateImageFile = (file) => {
  if (!file) return "File ảnh là bắt buộc";

  if (!ALLOWED_MIME_TYPES.includes(file.mimetype)) {
    return `Định dạng file không hợp lệ. Chỉ chấp nhận: JPG, PNG`;
  }

  if (file.size > MAX_FILE_SIZE) {
    return `Kích thước file vượt quá giới hạn cho phép (tối đa 5MB)`;
  }

  if (!file.buffer || file.buffer.length === 0) {
    return "File ảnh bị lỗi hoặc rỗng";
  }

  return null;
};

const validateAmount = (amount) => {
  if (!amount && amount !== 0) return "Số tiền là bắt buộc";

  const parsed = Number(amount);

  if (isNaN(parsed)) return "Số tiền không hợp lệ";
  if (!Number.isInteger(parsed)) return "Số tiền phải là số nguyên";
  if (parsed <= 0) return "Số tiền phải lớn hơn 0";
  if (parsed < 10_000) return "Số tiền tối thiểu là 10,000 VNĐ";
  if (parsed > 1_000_000_000) return "Số tiền tối đa là 1,000,000,000 VNĐ";

  return null;
};

const validateUUID = (value, fieldName = "id") => {
  if (!value || typeof value !== "string" || !value.trim()) {
    return `${fieldName} là bắt buộc`;
  }

  return null;
};

const validateCrmUserName = (crmUserName) => {
  if (!crmUserName || typeof crmUserName !== "string" || !crmUserName.trim()) {
    return "crmUserName là bắt buộc";
  }

  return null;
};

const collectErrors = (checks) => {
  for (const error of Object.values(checks)) {
    if (error) return error;
  }
  return null;
};

module.exports = {
  compressImage,
  validateImageFile,
  validateAmount,
  validateUUID,
  validateCrmUserName,
  collectErrors,
};
