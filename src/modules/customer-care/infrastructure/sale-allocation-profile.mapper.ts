import { Mapper } from "../../../core/db/mongoose-repository.base";
import {
  SaleAllocationProfileEntity,
  SaleAllocationProfileProps
} from "../domain/sale-allocation-profile.entity";

export const saleAllocationProfileMapper: Mapper<SaleAllocationProfileEntity, any> = {
  toDomain(record) {
    return new SaleAllocationProfileEntity(
      {
        id: String(record._id),
        props: {
          saleId: String(record.sale_id),
          status: record.status,
          reason: record.reason ?? null,
          until: record.until ?? null,
          setBy: record.set_by ? String(record.set_by) : null,
          setAt: record.set_at ?? null,
          rank: record.rank,
          capNewPerDay: record.cap_new_per_day ?? null,
          capTotal: record.cap_total ?? null,
          lastAssignedAt: record.last_assigned_at ?? null
        } as SaleAllocationProfileProps,
        createdAt: record.createdAt,
        updatedAt: record.updatedAt,
        isDeleted: record.isDeleted
      },
      { validate: false }
    );
  },

  toPersistence(entity) {
    const p = entity.getProps();
    return {
      _id: p.id,
      sale_id: p.saleId,
      status: p.status,
      reason: p.reason,
      until: p.until,
      set_by: p.setBy,
      set_at: p.setAt,
      rank: p.rank,
      cap_new_per_day: p.capNewPerDay,
      cap_total: p.capTotal,
      last_assigned_at: p.lastAssignedAt
    };
  }
};
