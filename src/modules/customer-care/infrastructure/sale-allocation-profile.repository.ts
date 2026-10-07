import { MongooseRepositoryBase } from "../../../core/db/mongoose-repository.base";
import SaleAllocationProfileModel from "../../../models/SaleAllocationProfileModel";
import { SaleAllocationProfileEntity } from "../domain/sale-allocation-profile.entity";
import { saleAllocationProfileMapper } from "./sale-allocation-profile.mapper";

export class SaleAllocationProfileRepository extends MongooseRepositoryBase<
  SaleAllocationProfileEntity,
  any
> {
  constructor() {
    super(SaleAllocationProfileModel, saleAllocationProfileMapper);
  }

  async findBySale(saleId: string): Promise<SaleAllocationProfileEntity | null> {
    const doc = await this.model
      .findOne({ sale_id: saleId, isDeleted: false })
      .session(this.session ?? null)
      .lean();
    return doc ? this.mapper.toDomain(doc) : null;
  }

  async findBySales(saleIds: string[]): Promise<SaleAllocationProfileEntity[]> {
    if (!saleIds.length) return [];
    const docs = await this.model
      .find({ sale_id: { $in: saleIds }, isDeleted: false })
      .session(this.session ?? null)
      .lean();
    return docs.map((doc) => this.mapper.toDomain(doc));
  }

  async upsert(entity: SaleAllocationProfileEntity): Promise<void> {
    const existing = await this.model
      .findOne({ _id: entity.id })
      .session(this.session ?? null)
      .lean();
    if (existing) await this.updateById(entity.id, entity);
    else await this.insert(entity);
  }
}
