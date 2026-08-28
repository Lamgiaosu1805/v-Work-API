import {
  ConditionNode,
  ConditionTreeProps,
  isClauseProps
} from "../value-objects/condition-tree.vo";
import {
  ConditionClauseProps,
  ConditionOperator,
  ConditionOperand
} from "../value-objects/condition-clause.vo";
import { ArgumentInvalidException } from "../../../../core/exceptions/exceptions";

export type MongoComparisonOperator =
  | "$eq"
  | "$ne"
  | "$in"
  | "$nin"
  | "$gt"
  | "$gte"
  | "$lt"
  | "$lte";

export type CompiledCondition =
  | { $and: CompiledCondition[] }
  | { $or: CompiledCondition[] }
  | Record<string, Partial<Record<MongoComparisonOperator, unknown>>>;

const OPERATOR_TO_MONGO: Record<ConditionOperator, MongoComparisonOperator> = {
  EQ: "$eq",
  NE: "$ne",
  IN: "$in",
  NOT_IN: "$nin",
  GT: "$gt",
  GTE: "$gte",
  LT: "$lt",
  LTE: "$lte"
};

function compileOperandValue(right: ConditionOperand): unknown {
  if (right.type === "LITERAL") return right.value;
  return `\${${right.path}}`;
}

const RESOURCE_PATH_PREFIX = /^resource\./;

function toMongoFieldPath(left: string): string {
  return left.replace(RESOURCE_PATH_PREFIX, "");
}

function compileClause(clause: ConditionClauseProps): CompiledCondition {
  if (clause.left.includes("$")) {
    throw new ArgumentInvalidException(`ConditionClause.left không hợp lệ: "${clause.left}"`);
  }

  const mongoOperator = OPERATOR_TO_MONGO[clause.operator];
  if (!mongoOperator) {
    throw new ArgumentInvalidException(`Operator không được hỗ trợ: "${clause.operator}"`);
  }

  const fieldPath = toMongoFieldPath(clause.left);
  return { [fieldPath]: { [mongoOperator]: compileOperandValue(clause.right) } };
}

function compileNode(node: ConditionNode): CompiledCondition {
  if (isClauseProps(node)) return compileClause(node);
  const compiledClauses = node.clauses.map(compileNode);
  return node.operator === "AND" ? { $and: compiledClauses } : { $or: compiledClauses };
}

export function compile(conditionTree: ConditionTreeProps): CompiledCondition {
  return compileNode(conditionTree);
}

const SUBJECT_PLACEHOLDER_PATTERN = /^\$\{subject\.(.+)\}$/;

function resolveOperandValue(value: unknown, subject: Record<string, unknown>): unknown {
  if (typeof value !== "string") return value;
  const match = value.match(SUBJECT_PLACEHOLDER_PATTERN);
  if (!match) return value;

  const [, subjectPath] = match;
  if (!(subjectPath in subject)) {
    throw new ArgumentInvalidException(
      `Không resolve được subject attribute "subject.${subjectPath}" khi interpolate condition — thiếu trong subject object truyền vào`
    );
  }
  return subject[subjectPath];
}

function isAndNode(node: CompiledCondition): node is { $and: CompiledCondition[] } {
  return Array.isArray((node as { $and?: unknown }).$and);
}

function isOrNode(node: CompiledCondition): node is { $or: CompiledCondition[] } {
  return Array.isArray((node as { $or?: unknown }).$or);
}

function interpolateNode(
  node: CompiledCondition,
  subject: Record<string, unknown>
): CompiledCondition {
  if (isAndNode(node)) return { $and: node.$and.map((child) => interpolateNode(child, subject)) };
  if (isOrNode(node)) return { $or: node.$or.map((child) => interpolateNode(child, subject)) };

  const result: Record<string, Partial<Record<MongoComparisonOperator, unknown>>> = {};
  Object.entries(node).forEach(([field, operatorMap]) => {
    const resolvedOperatorMap: Partial<Record<MongoComparisonOperator, unknown>> = {};
    Object.entries(operatorMap ?? {}).forEach(([operator, value]) => {
      resolvedOperatorMap[operator as MongoComparisonOperator] = resolveOperandValue(
        value,
        subject
      );
    });
    result[field] = resolvedOperatorMap;
  });
  return result;
}

export type ResolvedCondition = CompiledCondition & { readonly __resolved: true };

export function interpolate(
  condition: CompiledCondition,
  subject: Record<string, unknown>
): ResolvedCondition {
  return interpolateNode(condition, subject) as ResolvedCondition;
}

export function emptyResolvedCondition(): ResolvedCondition {
  const empty: CompiledCondition = {};
  return empty as ResolvedCondition;
}

export function mergeResolvedWithAnd(
  a: ResolvedCondition,
  b: ResolvedCondition
): ResolvedCondition {
  const merged: CompiledCondition = { $and: [a, b] };
  return merged as ResolvedCondition;
}
