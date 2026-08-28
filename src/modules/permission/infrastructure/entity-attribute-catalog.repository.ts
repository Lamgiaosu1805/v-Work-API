import EntityAttributeCatalogModel, {
  AttributeDefDoc,
  FieldDefDoc
} from "../../../models/EntityAttributeCatalogModel";

export interface EntityAttributeCatalogView {
  entity: string;
  subjectAttributes: AttributeDefDoc[];
  resourceAttributes: AttributeDefDoc[];
  fields: FieldDefDoc[];
}

export class EntityAttributeCatalogRepository {
  // eslint-disable-next-line class-methods-use-this
  async findByEntity(entity: string): Promise<EntityAttributeCatalogView | null> {
    const doc = await EntityAttributeCatalogModel.findOne({ entity, isDeleted: false }).lean();
    if (!doc) return null;
    return {
      entity: doc.entity,
      subjectAttributes: doc.subjectAttributes,
      resourceAttributes: doc.resourceAttributes,
      fields: doc.fields
    };
  }
}
