import {
  SaleOmicallProfileEntity,
  SaleOmicallProfileProps
} from "../domain/sale-omicall-profile.entity";
import { Mapper } from "../../../core/db/mongoose-repository.base";

export const saleOmicallProfileMapper: Mapper<SaleOmicallProfileEntity, any> = {
  toDomain(record) {
    return new SaleOmicallProfileEntity(
      {
        id: String(record._id),
        props: {
          saleId: String(record.sale_id),
          sipRealm: record.sip_realm,
          omicallExtension: record.omicall_extension,
          sipPassword: record.sip_password,
          omicallAgentId: record.omicall_agent_id ?? null,
          omicallEmail: record.omicall_email
        } as SaleOmicallProfileProps,
        createdAt: record.createdAt,
        updatedAt: record.updatedAt,
        isDeleted: record.isDeleted
      },
      { validate: false }
    );
  },

  toPersistence(entity) {
    const props = entity.getProps();
    return {
      _id: props.id,
      sale_id: props.saleId,
      sip_realm: props.sipRealm,
      omicall_extension: props.omicallExtension,
      sip_password: props.sipPassword,
      omicall_agent_id: props.omicallAgentId,
      omicall_email: props.omicallEmail
    };
  }
};
