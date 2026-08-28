import {
  EntityAttributeCatalogRepository,
  EntityAttributeCatalogView
} from "../infrastructure/entity-attribute-catalog.repository";
import { NotFoundException } from "../../../core/exceptions/exceptions";

const entityAttributeCatalogRepository = new EntityAttributeCatalogRepository();

export async function getAttributeCatalog(entity: string): Promise<EntityAttributeCatalogView> {
  const catalog = await entityAttributeCatalogRepository.findByEntity(entity);
  if (!catalog) {
    throw new NotFoundException(`Không tìm thấy attribute catalog cho entity "${entity}"`, {
      metadata: { entity }
    });
  }
  return catalog;
}
