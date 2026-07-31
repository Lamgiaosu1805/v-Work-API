const mongoose = require("mongoose");
const { RequestContextService } = require("../context/request-context");
const { ConflictException } = require("../exceptions/exceptions");

async function runInTransaction(work) {
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
    if (error.errorLabels?.includes("TransientTransactionError")) {
      throw new ConflictException("Yêu cầu đang được xử lý bởi thao tác khác, vui lòng thử lại");
    }
    throw error;
  } finally {
    session.endSession();
  }
}

module.exports = { runInTransaction };
