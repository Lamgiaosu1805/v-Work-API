const { RequestEntity, REQUEST_TYPE_FIELDS } = require("../domain/request.entity");

function pickTypeSpecificFields(record, requestType) {
  const fields = REQUEST_TYPE_FIELDS[requestType] || [];
  const picked = {};
  fields.forEach((field) => {
    if (record[field] !== undefined) picked[field] = record[field];
  });
  return picked;
}

const requestMapper = {
  toDomain(record) {
    return new RequestEntity(
      {
        id: String(record._id),
        props: {
          user_id: String(record.user_id),
          request_type: record.request_type,
          reason: record.reason ?? "",
          status: record.status,
          reviewed_by: record.reviewed_by ? String(record.reviewed_by) : null,
          reviewed_at: record.reviewed_at ?? null,
          reviewer_note: record.reviewer_note ?? "",
          approvals: (record.approvals ?? []).map((approval) => ({
            account: String(approval.account),
            reviewed_at: approval.reviewed_at
          })),
          ...pickTypeSpecificFields(record, record.request_type)
        },
        createdAt: record.createdAt,
        updatedAt: record.updatedAt,
        isDeleted: record.isDeleted
      },
      { validate: false }
    );
  },

  toPersistence(entity) {
    const { id, createdAt, updatedAt, ...rest } = entity.getProps();
    return { _id: id, ...rest };
  }
};

module.exports = { requestMapper };
