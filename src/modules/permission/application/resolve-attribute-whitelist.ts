import { getAttributeCatalog } from "./get-attribute-catalog.service";
import { AttributeWhitelist } from "../domain/data-scope-policy.entity";
import { FieldAttributeWhitelist } from "../domain/field-scope-policy.entity";

export async function resolveAttributeWhitelist(entity: string): Promise<AttributeWhitelist> {
  const catalog = await getAttributeCatalog(entity);
  return {
    resourcePaths: catalog.resourceAttributes.map((attr) => attr.path),
    subjectPaths: catalog.subjectAttributes.map((attr) => attr.path)
  };
}

export async function resolveFieldAttributeWhitelist(
  entity: string
): Promise<FieldAttributeWhitelist> {
  const catalog = await getAttributeCatalog(entity);
  return {
    resourcePaths: catalog.resourceAttributes.map((attr) => attr.path),
    subjectPaths: catalog.subjectAttributes.map((attr) => attr.path),
    fields: catalog.fields.map((field) => field.name)
  };
}
