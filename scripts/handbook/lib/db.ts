import mongoose from "mongoose";
import HandbookVersionModel from "../../../src/models/HandbookVersionModel";
import HandbookArticleModel from "../../../src/models/HandbookArticleModel";

// Kết nối MongoDB rồi CHỜ build xong index trước khi script mở giao dịch. Nếu không, `createIndexes`
// nền của Mongoose tranh khóa collection với giao dịch của script (treo tới hết timeout), và index
// unique "chỉ 1 phiên bản active" có thể chưa tồn tại khi ghi dữ liệu.
export async function connectForHandbookScript(): Promise<void> {
  await mongoose.connect(process.env.MONGODB_URI as string);
  console.log("✅ Kết nối MongoDB thành công");
  await Promise.all([HandbookVersionModel.init(), HandbookArticleModel.init()]);
}
