import crypto from "crypto";

export function generateOmicallPassword(): string {
  const random = crypto
    .randomBytes(9)
    .toString("base64")
    .replace(/[^A-Za-z0-9]/g, "");
  return `Om1${random}!`;
}
