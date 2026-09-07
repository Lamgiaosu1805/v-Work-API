import { MongooseRepositoryBase } from "../../../core/db/mongoose-repository.base";
import SaleOmicallProfileModel from "../../../models/SaleOmicallProfileModel";
import { SaleOmicallProfileEntity } from "../domain/sale-omicall-profile.entity";
import { saleOmicallProfileMapper } from "./sale-omicall-profile.mapper";

export class SaleOmicallProfileRepository extends MongooseRepositoryBase<
  SaleOmicallProfileEntity,
  any
> {
  constructor() {
    super(SaleOmicallProfileModel, saleOmicallProfileMapper);
  }

  async findBySaleId(saleId: string): Promise<SaleOmicallProfileEntity | null> {
    const doc = await this.model
      .findOne({ sale_id: saleId, isDeleted: false })
      .session(this.session ?? null)
      .lean();
    return doc ? this.mapper.toDomain(doc) : null;
  }

  async findByExtension(omicallExtension: string): Promise<SaleOmicallProfileEntity | null> {
    const doc = await this.model
      .findOne({ omicall_extension: omicallExtension, isDeleted: false })
      .session(this.session ?? null)
      .lean();
    return doc ? this.mapper.toDomain(doc) : null;
  }

  async findManyBySaleIds(saleIds: string[]): Promise<SaleOmicallProfileEntity[]> {
    const docs = await this.model
      .find({ sale_id: { $in: saleIds }, isDeleted: false })
      .session(this.session ?? null)
      .lean();
    return docs.map((doc) => this.mapper.toDomain(doc));
  }

  async findManyByExtensions(extensions: string[]): Promise<SaleOmicallProfileEntity[]> {
    const docs = await this.model
      .find({ omicall_extension: { $in: extensions }, isDeleted: false })
      .session(this.session ?? null)
      .lean();
    return docs.map((doc) => this.mapper.toDomain(doc));
  }

  async findByPendingTransferRequestId(
    requestId: string
  ): Promise<SaleOmicallProfileEntity | null> {
    const doc = await this.model
      .findOne({ pending_transfer_request_id: requestId, isDeleted: false })
      .session(this.session ?? null)
      .lean();
    return doc ? this.mapper.toDomain(doc) : null;
  }

  async findTransferringByTargetSaleId(
    targetSaleId: string
  ): Promise<SaleOmicallProfileEntity | null> {
    const doc = await this.model
      .findOne({
        status: "transferring",
        pending_transfer_target_sale_id: targetSaleId,
        isDeleted: false
      })
      .session(this.session ?? null)
      .lean();
    return doc ? this.mapper.toDomain(doc) : null;
  }
}
