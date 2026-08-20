import PermissionCatalogModel, {
  PermissionActionKind
} from "../../../models/PermissionCatalogModel";

export interface PermissionCatalogView {
  code: string;
  module: string;
  name: string;
  entity: string;
  actionKind: PermissionActionKind;
  supportsFieldScope: boolean;
  validDataScopePolicies: string[];
  validFieldScopePolicies: string[];
}

function toView(doc: any): PermissionCatalogView {
  return {
    code: doc.code,
    module: doc.module,
    name: doc.name,
    entity: doc.entity,
    actionKind: doc.actionKind,
    supportsFieldScope: doc.supportsFieldScope,
    validDataScopePolicies: doc.validDataScopePolicies,
    validFieldScopePolicies: doc.validFieldScopePolicies
  };
}

export class PermissionCatalogRepository {
  // eslint-disable-next-line class-methods-use-this
  async findByCode(code: string): Promise<PermissionCatalogView | null> {
    const doc = await PermissionCatalogModel.findOne({ code, isDeleted: false }).lean();
    return doc ? toView(doc) : null;
  }

  // eslint-disable-next-line class-methods-use-this
  async findAll(): Promise<PermissionCatalogView[]> {
    const docs = await PermissionCatalogModel.find({ isDeleted: false }).lean();
    return docs.map(toView);
  }

  // eslint-disable-next-line class-methods-use-this
  async updateWhitelistsByCode(
    code: string,
    patch: { validDataScopePolicies?: string[]; validFieldScopePolicies?: string[] }
  ): Promise<PermissionCatalogView | null> {
    const doc = await PermissionCatalogModel.findOneAndUpdate(
      { code, isDeleted: false },
      { $set: patch },
      { new: true }
    ).lean();
    return doc ? toView(doc) : null;
  }
}
