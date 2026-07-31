import mongoose, { ClientSession } from "mongoose";
import { RequestContextService } from "../context/request-context";
import { ConflictException } from "../exceptions/exceptions";

export async function runInTransaction<T>(
  work: (session: ClientSession) => Promise<T>
): Promise<T> {
  const session = await mongoose.startSession();
  session.startTransaction();
  try {
    const result = await RequestContextService.runChild({ transactionSession: session }, () =>
      work(session)
    );
    await session.commitTransaction();
    return result;
  } catch (error) {
    await session.abortTransaction();
    const errorLabels = (error as { errorLabels?: string[] })?.errorLabels;
    if (errorLabels?.includes("TransientTransactionError")) {
      throw new ConflictException("Yêu cầu đang được xử lý bởi thao tác khác, vui lòng thử lại");
    }
    throw error;
  } finally {
    session.endSession();
  }
}
