const { MongoMemoryReplSet } = require("mongodb-memory-server");
const mongoose = require("mongoose");
const { RequestEntity } = require("../../../src/modules/request/domain/request.entity");
const {
  RequestRepository
} = require("../../../src/modules/request/infrastructure/request.repository");
const { RequestModel, LeaveRequest } = require("../../../src/models/RequestModel");

let mongod;
let repo;

beforeAll(async () => {
  mongod = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  await mongoose.connect(mongod.getUri());
  // Same fix as requestApprovalFlow.test.js: avoid "Unable to acquire IX lock"
  // when a discriminator collection is created for the first time.
  await Promise.all(Object.values(mongoose.connection.models).map((m) => m.init()));

  repo = new RequestRepository();
}, 60000);

afterAll(async () => {
  await mongoose.disconnect();
  await mongod.stop();
});

afterEach(async () => {
  await RequestModel.deleteMany({});
});

function newLeaveRequest(userId, overrides = {}) {
  return RequestEntity.create({
    userId,
    requestType: "leave",
    reason: "Nghỉ phép",
    from_date: new Date("2026-01-05"),
    from_period: "morning",
    to_date: new Date("2026-01-05"),
    to_period: "afternoon",
    total_days: 1,
    leave_type: "paid",
    paid_days: 1,
    unpaid_days: 0,
    ...overrides
  });
}

describe("RequestRepository", () => {
  it("insert() writes through the discriminator model — required leave-only fields are enforced", async () => {
    const entity = newLeaveRequest(new mongoose.Types.ObjectId().toString());
    await repo.insert(entity);

    const raw = await LeaveRequest.findById(entity.id).lean();
    expect(raw).not.toBeNull();
    expect(raw.request_type).toBe("leave");
    expect(raw.leave_type).toBe("paid");
    expect(raw.total_days).toBe(1);
  });

  it("insert() rejects a leave request missing a discriminator-required field (leave_type)", async () => {
    const userId = new mongoose.Types.ObjectId().toString();
    const entity = new RequestEntity(
      {
        id: new mongoose.Types.ObjectId().toString(),
        props: {
          user_id: userId,
          request_type: "leave",
          reason: "",
          status: "pending",
          reviewed_by: null,
          reviewed_at: null,
          reviewer_note: "",
          approvals: [],
          from_date: new Date("2026-01-05"),
          from_period: "morning",
          to_date: new Date("2026-01-05"),
          to_period: "afternoon",
          total_days: 1
          // leave_type intentionally omitted — required by LeaveRequest discriminator schema
        }
      },
      { validate: false }
    );

    await expect(repo.insert(entity)).rejects.toThrow();
  });

  it("findOneById() reads back a leave request mapped to a full RequestEntity", async () => {
    const entity = newLeaveRequest(new mongoose.Types.ObjectId().toString());
    await repo.insert(entity);

    const found = await repo.findOneById(entity.id);
    expect(found).toBeInstanceOf(RequestEntity);
    expect(found.requestType).toBe("leave");
    expect(found.getProps().leave_type).toBe("paid");
  });

  it("updateById() writes through the discriminator model and persists a domain state change (approve)", async () => {
    const reviewerId = new mongoose.Types.ObjectId().toString();
    const entity = newLeaveRequest(new mongoose.Types.ObjectId().toString(), { total_days: 1 });
    await repo.insert(entity);

    entity.approve(reviewerId, "Đồng ý");
    const updated = await repo.updateById(entity.id, entity);

    expect(updated.status).toBe("approved");

    const raw = await LeaveRequest.findById(entity.id).lean();
    expect(raw.status).toBe("approved");
    expect(raw.leave_type).toBe("paid"); // discriminator-specific field survives the update
  });

  it("_modelFor() picks the correct discriminator model per request_type", () => {
    const entity = newLeaveRequest(new mongoose.Types.ObjectId().toString());
    expect(repo._modelFor(entity)).toBe(LeaveRequest);
  });
});
