import { ValueObject } from "../../../../core/ddd/value-object.base";
import { ArgumentInvalidException } from "../../../../core/exceptions/exceptions";

export type ConditionOperator = "EQ" | "NE" | "IN" | "NOT_IN" | "GT" | "GTE" | "LT" | "LTE";

const VALID_OPERATORS: ConditionOperator[] = ["EQ", "NE", "IN", "NOT_IN", "GT", "GTE", "LT", "LTE"];

export type ConditionOperand =
  | { type: "LITERAL"; value: string | number | boolean }
  | { type: "SUBJECT_REF"; path: string };

export interface ConditionClauseProps {
  left: string;
  operator: ConditionOperator;
  right: ConditionOperand;
}

function isValidOperand(right: ConditionOperand): boolean {
  if (!right || typeof right !== "object") return false;
  if (right.type === "LITERAL") {
    const { value } = right;
    return typeof value === "string" || typeof value === "number" || typeof value === "boolean";
  }
  if (right.type === "SUBJECT_REF") {
    return typeof right.path === "string" && right.path.length > 0;
  }
  return false;
}

export class ConditionClause extends ValueObject<ConditionClauseProps> {
  static of(props: ConditionClauseProps): ConditionClause {
    return new ConditionClause(props);
  }

  // eslint-disable-next-line class-methods-use-this
  validate({ left, operator, right }: ConditionClauseProps): void {
    if (!left || typeof left !== "string" || left.includes("$")) {
      throw new ArgumentInvalidException(
        `ConditionClause thiếu left attribute path hợp lệ (không được chứa ký tự "$"): "${left}"`
      );
    }
    if (!VALID_OPERATORS.includes(operator)) {
      throw new ArgumentInvalidException(`ConditionClause operator không hợp lệ: "${operator}"`);
    }
    if (!isValidOperand(right)) {
      throw new ArgumentInvalidException(
        `ConditionClause "${left}" thiếu right operand hợp lệ (LITERAL hoặc SUBJECT_REF)`
      );
    }
  }

  get left(): string {
    return this.unpack().left;
  }

  get operator(): ConditionOperator {
    return this.unpack().operator;
  }

  get right(): ConditionOperand {
    return this.unpack().right;
  }
}
