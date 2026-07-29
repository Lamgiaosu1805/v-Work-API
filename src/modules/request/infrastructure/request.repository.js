const {
  RequestModel,
  LeaveRequest,
  LateEarlyRequest,
  RemoteRequest,
  BusinessTripRequest,
  ClientVisitRequest,
  ExplanationRequest,
  ForgotCheckinRequest
} = require("../../../models/RequestModel");
const { MongooseRepositoryBase } = require("../../../core/db/mongoose-repository.base");
const { requestMapper } = require("./request.mapper");

const DISCRIMINATOR_MODELS = {
  leave: LeaveRequest,
  late_early: LateEarlyRequest,
  remote: RemoteRequest,
  business_trip: BusinessTripRequest,
  client_visit: ClientVisitRequest,
  explanation: ExplanationRequest,
  forgot_checkin: ForgotCheckinRequest
};

class RequestRepository extends MongooseRepositoryBase {
  constructor() {
    super(RequestModel, requestMapper);
  }

  _modelFor(entity) {
    return DISCRIMINATOR_MODELS[entity.requestType] || this.model;
  }

  async insert(entity) {
    entity.validate();
    const record = this.mapper.toPersistence(entity);
    await this._modelFor(entity).create([record], { session: this.session });
  }

  async updateById(id, entity) {
    entity.validate();
    const record = this.mapper.toPersistence(entity);
    const doc = await this._modelFor(entity)
      .findOneAndUpdate({ _id: id, isDeleted: false }, record, { session: this.session, new: true })
      .lean();
    return doc ? this.mapper.toDomain(doc) : null;
  }
}

module.exports = { RequestRepository };
