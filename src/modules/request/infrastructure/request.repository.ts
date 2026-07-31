import {
  RequestModel,
  LeaveRequest,
  LateEarlyRequest,
  RemoteRequest,
  BusinessTripRequest,
  ClientVisitRequest,
  ExplanationRequest,
  ForgotCheckinRequest
} from "../../../models/RequestModel";
import { MongooseRepositoryBase } from "../../../core/db/mongoose-repository.base";
import { requestMapper } from "./request.mapper";
import { RequestEntity } from "../domain/request.entity";
import { RequestType } from "../domain/types";

const DISCRIMINATOR_MODELS: Record<RequestType, any> = {
  leave: LeaveRequest,
  late_early: LateEarlyRequest,
  remote: RemoteRequest,
  business_trip: BusinessTripRequest,
  client_visit: ClientVisitRequest,
  explanation: ExplanationRequest,
  forgot_checkin: ForgotCheckinRequest
};

export class RequestRepository extends MongooseRepositoryBase<RequestEntity, any> {
  constructor() {
    super(RequestModel, requestMapper);
  }

  private _modelFor(entity: RequestEntity) {
    return DISCRIMINATOR_MODELS[entity.requestType] || this.model;
  }

  async insert(entity: RequestEntity): Promise<void> {
    entity.validate();
    const record = this.mapper.toPersistence(entity);
    await this._modelFor(entity).create([record], { session: this.session });
  }

  async updateById(id: string, entity: RequestEntity): Promise<RequestEntity | null> {
    entity.validate();
    const record = this.mapper.toPersistence(entity);
    const doc = await this._modelFor(entity)
      .findOneAndUpdate({ _id: id, isDeleted: false }, record, { session: this.session, new: true })
      .lean();
    return doc ? this.mapper.toDomain(doc) : null;
  }
}
