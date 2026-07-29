const { MongoMemoryReplSet } = require("mongodb-memory-server");
const mongoose = require("mongoose");
const { RequestContextService } = require("../../src/core/context/request-context");
const { MongooseRepositoryBase } = require("../../src/core/db/mongoose-repository.base");
const { Entity } = require("../../src/core/ddd/entity.base");

class ThingEntity extends Entity {
  validate() {
    if (!this.props.name) throw new Error("name required");
  }
}

// Reminder for real Phase 1 mappers: toPersistence() MUST set _id: props.id,
// otherwise entity.id will not match the document's real _id in MongoDB.
const mapper = {
  toDomain(doc) {
    return new ThingEntity(
      {
        id: String(doc._id),
        props: { name: doc.name },
        createdAt: doc.createdAt,
        updatedAt: doc.updatedAt,
        isDeleted: doc.isDeleted
      },
      { validate: false }
    );
  },
  toPersistence(entity) {
    const props = entity.getProps();
    return { _id: props.id, name: props.name };
  }
};

let mongod;
let ThingModel;
let repo;

beforeAll(async () => {
  mongod = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  await mongoose.connect(mongod.getUri());

  const ThingSchema = new mongoose.Schema(
    {
      _id: mongoose.Schema.Types.ObjectId,
      name: String,
      isDeleted: { type: Boolean, default: false }
    },
    { timestamps: true }
  );
  ThingModel = mongoose.model("Thing", ThingSchema);
  // Avoid the "Unable to acquire IX lock" race when a collection is created
  // for the first time inside a transaction (same fix already used in
  // requestApprovalFlow.test.js / requestControllerCreate.test.js).
  await Promise.all(Object.values(mongoose.connection.models).map((m) => m.init()));

  repo = new MongooseRepositoryBase(ThingModel, mapper);
}, 60000);

afterAll(async () => {
  await mongoose.disconnect();
  await mongod.stop();
});

afterEach(async () => {
  await ThingModel.deleteMany({});
});

function newThing(name) {
  return new ThingEntity({ id: new mongoose.Types.ObjectId().toString(), props: { name } });
}

describe("MongooseRepositoryBase", () => {
  it("insert() persists the entity with a matching _id", async () => {
    const entity = newThing("Alpha");
    await repo.insert(entity);
    const doc = await ThingModel.findById(entity.id);
    expect(doc).not.toBeNull();
    expect(doc.name).toBe("Alpha");
  });

  it("findOneById() maps a found document back to the domain Entity", async () => {
    const entity = newThing("Alpha");
    await repo.insert(entity);
    const found = await repo.findOneById(entity.id);
    expect(found).toBeInstanceOf(ThingEntity);
    expect(found.getProps().name).toBe("Alpha");
  });

  it("findOneById() returns null (not an Option/Result) when not found", async () => {
    const found = await repo.findOneById(new mongoose.Types.ObjectId().toString());
    expect(found).toBeNull();
  });

  it("findAll() returns every non-deleted entity, mapped", async () => {
    await repo.insert(newThing("Alpha"));
    await repo.insert(newThing("Beta"));
    const all = await repo.findAll();
    expect(all).toHaveLength(2);
    expect(all.every((e) => e instanceof ThingEntity)).toBe(true);
  });

  it("findAllPaginated() paginates and reports the correct total count", async () => {
    await repo.insert(newThing("Alpha"));
    await repo.insert(newThing("Beta"));
    await repo.insert(newThing("Gamma"));

    const page0 = await repo.findAllPaginated({ limit: 2, page: 0 });
    expect(page0.count).toBe(3);
    expect(page0.data).toHaveLength(2);

    const page1 = await repo.findAllPaginated({ limit: 2, page: 1 });
    expect(page1.data).toHaveLength(1);
  });

  it("updateById() writes the change and returns the updated Entity", async () => {
    const entity = newThing("Alpha");
    await repo.insert(entity);

    const updated = new ThingEntity(
      { id: entity.id, props: { name: "Alpha-Updated" } },
      { validate: false }
    );
    const result = await repo.updateById(entity.id, updated);

    expect(result.getProps().name).toBe("Alpha-Updated");
    const reread = await repo.findOneById(entity.id);
    expect(reread.getProps().name).toBe("Alpha-Updated");
  });

  describe("delete() — soft delete only, per CLAUDE.md convention", () => {
    it("returns true and marks isDeleted, without removing the document", async () => {
      const entity = newThing("Alpha");
      await repo.insert(entity);

      const result = await repo.delete(entity);
      expect(result).toBe(true);

      const raw = await ThingModel.findById(entity.id);
      expect(raw).not.toBeNull();
      expect(raw.isDeleted).toBe(true);
    });

    it("soft-deleted entities are excluded from findOneById/findAll afterwards", async () => {
      const entity = newThing("Alpha");
      await repo.insert(entity);
      await repo.delete(entity);

      expect(await repo.findOneById(entity.id)).toBeNull();
      expect(await repo.findAll()).toHaveLength(0);
    });
  });

  describe("transaction session (RequestContextService.getTransactionSession())", () => {
    it("reads its own uncommitted writes within the same transaction", async () => {
      const session = await mongoose.startSession();
      session.startTransaction();
      const entity = newThing("InTransaction");

      await RequestContextService.run({ requestId: "tx-test" }, async () => {
        RequestContextService.setTransactionSession(session);
        await repo.insert(entity);
        const seenInsideTx = await repo.findOneById(entity.id);
        expect(seenInsideTx).not.toBeNull();
        expect(seenInsideTx.getProps().name).toBe("InTransaction");
      });

      await session.commitTransaction();
      session.endSession();

      const afterCommit = await repo.findOneById(entity.id);
      expect(afterCommit).not.toBeNull();
    });

    it("rolls back correctly — aborted writes are not persisted", async () => {
      const session = await mongoose.startSession();
      session.startTransaction();
      const entity = newThing("ShouldRollback");

      await RequestContextService.run({ requestId: "tx-test-2" }, async () => {
        RequestContextService.setTransactionSession(session);
        await repo.insert(entity);
      });

      await session.abortTransaction();
      session.endSession();

      const raw = await ThingModel.findById(entity.id);
      expect(raw).toBeNull();
    });

    it("works normally when there is no active transaction session", async () => {
      const entity = newThing("NoTransaction");
      await repo.insert(entity); // outside any RequestContextService.run()
      const found = await repo.findOneById(entity.id);
      expect(found).not.toBeNull();
    });
  });
});
