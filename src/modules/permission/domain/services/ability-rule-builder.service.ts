import { ResolvedCondition, mergeResolvedWithAnd } from "./condition-compiler.service";

export interface ResolvedPermissionGrant {
  permissionCode: string;
  entity: string;
  dataScopeCondition: ResolvedCondition;
  fieldScopeFields: string[] | null;
  fieldScopeCondition: ResolvedCondition | null;
}

export interface ResolvedOverride {
  permissionCode: string;
  entity: string;
  status: "ALLOW" | "BLOCK";
  dataScopeCondition: ResolvedCondition | null;
  fieldScopeFields: string[] | null;
  fieldScopeCondition: ResolvedCondition | null;
}

export interface RawCaslRule {
  action: string;
  subject: string;
  conditions?: ResolvedCondition;
  fields?: string[];
  inverted?: boolean;
}

function buildGrantRule(grant: ResolvedPermissionGrant): RawCaslRule {
  const conditions = grant.fieldScopeCondition
    ? mergeResolvedWithAnd(grant.dataScopeCondition, grant.fieldScopeCondition)
    : grant.dataScopeCondition;

  const rule: RawCaslRule = { action: grant.permissionCode, subject: grant.entity, conditions };
  if (grant.fieldScopeFields) rule.fields = grant.fieldScopeFields;
  return rule;
}

function mergeOverrideConditions(override: ResolvedOverride): ResolvedCondition | undefined {
  if (override.dataScopeCondition && override.fieldScopeCondition) {
    return mergeResolvedWithAnd(override.dataScopeCondition, override.fieldScopeCondition);
  }
  return override.dataScopeCondition ?? override.fieldScopeCondition ?? undefined;
}

function buildAllowOverrideRule(override: ResolvedOverride): RawCaslRule {
  const conditions = mergeOverrideConditions(override);
  const rule: RawCaslRule = { action: override.permissionCode, subject: override.entity };
  if (conditions) rule.conditions = conditions;
  if (override.fieldScopeFields) rule.fields = override.fieldScopeFields;
  return rule;
}

function buildBlockOverrideRule(override: ResolvedOverride): RawCaslRule {
  const conditions = mergeOverrideConditions(override);
  const rule: RawCaslRule = {
    action: override.permissionCode,
    subject: override.entity,
    inverted: true
  };
  if (conditions) rule.conditions = conditions;
  if (override.fieldScopeFields) rule.fields = override.fieldScopeFields;
  return rule;
}

export function buildRawRules(input: {
  grants: ResolvedPermissionGrant[];
  overrides: ResolvedOverride[];
}): RawCaslRule[] {
  const canFromRoles = input.grants.map(buildGrantRule);
  const canFromAllowOverrides = input.overrides
    .filter((override) => override.status === "ALLOW")
    .map(buildAllowOverrideRule);
  const cannotFromBlockOverrides = input.overrides
    .filter((override) => override.status === "BLOCK")
    .map(buildBlockOverrideRule);

  return [...canFromRoles, ...canFromAllowOverrides, ...cannotFromBlockOverrides];
}
