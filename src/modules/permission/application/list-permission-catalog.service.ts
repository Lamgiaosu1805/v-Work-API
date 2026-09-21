import {
  PermissionCatalogRepository,
  PermissionCatalogView
} from "../infrastructure/permission-catalog.repository";

const permissionCatalogRepository = new PermissionCatalogRepository();

export async function listPermissionCatalog(): Promise<PermissionCatalogView[]> {
  return permissionCatalogRepository.findAll();
}
