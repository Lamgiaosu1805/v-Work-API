import "dotenv/config";
import mongoose from "mongoose";
// eslint-disable-next-line @typescript-eslint/no-var-requires
const AppModel = require("../src/models/AppModel");

const HOTLINE_NUMBERS_BY_APP_CODE: Record<string, string[]> = {
  tikluy: ["842871008617"]
};

async function main() {
  await mongoose.connect(process.env.MONGODB_URI as string);

  for (const [code, hotlineNumbers] of Object.entries(HOTLINE_NUMBERS_BY_APP_CODE)) {
    const app = await AppModel.findOne({ code });
    if (!app) {
      console.log(`Bỏ qua — không tìm thấy app code "${code}"`);
      continue;
    }
    app.hotline_numbers = hotlineNumbers;
    await app.save();
    console.log(`Đã cập nhật hotline_numbers cho app "${code}": ${hotlineNumbers.join(", ")}`);
  }

  await mongoose.disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
