const { RequestContextService } = require("../context/request-context");

class MongooseRepositoryBase {
  constructor(model, mapper) {
    this.model = model;
    this.mapper = mapper;
  }

  // eslint-disable-next-line class-methods-use-this
  get session() {
    return RequestContextService.getTransactionSession();
  }

  async findOneById(id) {
    const doc = await this.model
      .findOne({ _id: id, isDeleted: false })
      .session(this.session)
      .lean();
    return doc ? this.mapper.toDomain(doc) : null;
  }

  async findAll() {
    const docs = await this.model.find({ isDeleted: false }).session(this.session).lean();
    return docs.map((doc) => this.mapper.toDomain(doc));
  }

  async findAllPaginated({ limit, page }) {
    const filter = { isDeleted: false };
    const [docs, count] = await Promise.all([
      this.model
        .find(filter)
        .session(this.session)
        .skip(page * limit)
        .limit(limit)
        .lean(),
      this.model.countDocuments(filter).session(this.session)
    ]);

    return {
      data: docs.map((doc) => this.mapper.toDomain(doc)),
      count,
      limit,
      page
    };
  }

  async insert(entity) {
    entity.validate();
    const record = this.mapper.toPersistence(entity);
    await this.model.create([record], { session: this.session });
  }

  async updateById(id, entity) {
    entity.validate();
    const record = this.mapper.toPersistence(entity);
    const doc = await this.model
      .findOneAndUpdate({ _id: id, isDeleted: false }, record, { session: this.session, new: true })
      .lean();
    return doc ? this.mapper.toDomain(doc) : null;
  }

  async delete(entity) {
    const result = await this.model.updateOne(
      { _id: entity.id, isDeleted: false },
      { isDeleted: true },
      { session: this.session }
    );
    return result.modifiedCount > 0;
  }
}

module.exports = { MongooseRepositoryBase };
