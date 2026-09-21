import {
  Ability as CaslAbility,
  buildMongoQueryMatcher,
  fieldPatternMatcher,
  subject as caslSubject,
  MongoAbility
} from "@casl/ability";
import { permittedFieldsOf } from "@casl/ability/extra";
import { accessibleBy } from "@casl/mongoose";
import { $and, $or, $nor, and, or, nor } from "@ucast/mongo2js";
import pick from "lodash/pick";
import { RawCaslRule } from "../domain/services/ability-rule-builder.service";
import { ArgumentInvalidException } from "../../../core/exceptions/exceptions";

export type Ability = MongoAbility;

const conditionsMatcher = buildMongoQueryMatcher({ $and, $or, $nor }, { and, or, nor });

export function buildAbility(rawRules: RawCaslRule[]): Ability {
  return new CaslAbility(
    rawRules as any,
    {
      conditionsMatcher,
      fieldMatcher: fieldPatternMatcher
    } as any
  );
}

export function toMongoQuery(
  ability: Ability,
  action: string,
  entity: string
): Record<string, unknown> {
  return accessibleBy(ability, action).ofType(entity);
}

const fieldsFrom = (rule: { fields?: string[] }): string[] => rule.fields || [];

export function maskFields<T extends Record<string, unknown>>(
  ability: Ability,
  action: string,
  entity: string,
  doc: T
): Partial<T> {
  const taggedSubject = caslSubject(entity, doc);
  const fields = permittedFieldsOf(ability, action, taggedSubject, { fieldsFrom });
  return pick(doc, fields) as Partial<T>;
}

export function assertAllowedFields(
  ability: Ability,
  action: string,
  entity: string,
  payload: Record<string, unknown>
): void {
  const taggedSubject = caslSubject(entity, payload);
  const allowedFields = permittedFieldsOf(ability, action, taggedSubject, { fieldsFrom });
  const disallowedField = Object.keys(payload).find((field) => !allowedFields.includes(field));
  if (disallowedField) {
    throw new ArgumentInvalidException(
      `Không có quyền ghi field "${disallowedField}" cho action "${action}"`
    );
  }
}
