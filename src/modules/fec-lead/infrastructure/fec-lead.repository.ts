import { MongooseRepositoryBase } from "../../../core/db/mongoose-repository.base";
import FecLeadModel, { FecLeadDoc } from "../../../models/FecLeadModel";
import { FecLeadEntity } from "../domain/fec-lead.entity";
import { fecLeadMapper } from "./fec-lead.mapper";

export class FecLeadRepository extends MongooseRepositoryBase<FecLeadEntity, FecLeadDoc> {
  constructor() {
    super(FecLeadModel, fecLeadMapper);
  }

  async findByLeadGenId(leadGenId: string): Promise<FecLeadEntity | null> {
    const doc = await this.model
      .findOne({ lead_gen_id: leadGenId, isDeleted: false })
      .session(this.session ?? null)
      .lean();
    return doc ? this.mapper.toDomain(doc as unknown as FecLeadDoc) : null;
  }

  async findCompletedPendingCommission(): Promise<{ leadGenId: string; customerId: string }[]> {
    const docs = await this.model
      .find({ stage: "COMPLETED", commission_status: "pending", isDeleted: false })
      .select("lead_gen_id customer_id")
      .lean();
    return docs.map((d) => ({
      leadGenId: d.lead_gen_id,
      customerId: d.customer_id.toString()
    }));
  }

  async markCommissionCalculated(leadGenId: string): Promise<void> {
    await this.model.updateOne({ lead_gen_id: leadGenId }, { commission_status: "calculated" });
  }
}
