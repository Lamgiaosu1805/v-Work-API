import UserDepartmentPositionModel from "../../models/UserDepartmentPositionModel";
import { toMongoQuery, Ability } from "../../modules/permission";

async function translateDepartmentIdNode(node: unknown): Promise<unknown> {
  if (Array.isArray(node)) {
    return Promise.all(node.map(translateDepartmentIdNode));
  }
  if (!node || typeof node !== "object") return node;

  const entries = await Promise.all(
    Object.entries(node as Record<string, unknown>).map(async ([key, value]) => {
      if (key === "departmentId") {
        const operatorMap = value as Record<string, unknown>;
        const deptIds = (operatorMap.$in as unknown[] | undefined) ?? [operatorMap.$eq];
        const userIds = await UserDepartmentPositionModel.distinct("user", {
          department: { $in: deptIds },
          isDeleted: false
        });
        return ["_id", { $in: userIds.map(String) }];
      }
      return [key, await translateDepartmentIdNode(value)];
    })
  );
  return Object.fromEntries(entries);
}

export async function resolveEmployeeScopeFilter(
  ability: Ability,
  action: string
): Promise<Record<string, unknown>> {
  const rawFilter = toMongoQuery(ability, action, "Employee");
  return translateDepartmentIdNode(rawFilter) as Promise<Record<string, unknown>>;
}
