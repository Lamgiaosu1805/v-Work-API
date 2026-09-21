import { toMongoQuery, Ability } from "../../modules/permission";

export function resolveRequestScopeFilter(
  ability: Ability,
  action: "request.view" | "request.review"
): Record<string, unknown> {
  return toMongoQuery(ability, action, "Request");
}
