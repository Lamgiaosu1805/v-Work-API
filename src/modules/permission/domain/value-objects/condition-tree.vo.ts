import { ValueObject } from "../../../../core/ddd/value-object.base";
import { ArgumentInvalidException } from "../../../../core/exceptions/exceptions";
import { ConditionClause, ConditionClauseProps } from "./condition-clause.vo";

export type ConditionLogicalOperator = "AND" | "OR";

export type ConditionNode = ConditionClauseProps | ConditionTreeProps;

export interface ConditionTreeProps {
  operator: ConditionLogicalOperator;
  clauses: ConditionNode[];
}

export interface ReferencedAttributePaths {
  resourcePaths: string[];
  subjectPaths: string[];
}

export function isClauseProps(node: ConditionNode): node is ConditionClauseProps {
  return "left" in node && "operator" in node && "right" in node;
}

export class ConditionTree extends ValueObject<ConditionTreeProps> {
  static of(props: ConditionTreeProps): ConditionTree {
    return new ConditionTree(props);
  }

  // eslint-disable-next-line class-methods-use-this
  validate({ operator, clauses }: ConditionTreeProps): void {
    if (operator !== "AND" && operator !== "OR") {
      throw new ArgumentInvalidException(`ConditionTree operator không hợp lệ: "${operator}"`);
    }
    if (!Array.isArray(clauses) || clauses.length === 0) {
      throw new ArgumentInvalidException("ConditionTree phải có ít nhất 1 clause");
    }
    clauses.forEach((node) => {
      if (isClauseProps(node)) {
        ConditionClause.of(node);
      } else {
        ConditionTree.of(node);
      }
    });
  }

  get operator(): ConditionLogicalOperator {
    return this.unpack().operator;
  }

  get clauses(): ConditionNode[] {
    return this.unpack().clauses;
  }

  collectReferencedPaths(): ReferencedAttributePaths {
    const resourcePaths: string[] = [];
    const subjectPaths: string[] = [];

    const walk = (node: ConditionNode): void => {
      if (isClauseProps(node)) {
        resourcePaths.push(node.left);
        if (node.right.type === "SUBJECT_REF") subjectPaths.push(node.right.path);
        return;
      }
      node.clauses.forEach(walk);
    };

    this.clauses.forEach(walk);
    return { resourcePaths, subjectPaths };
  }
}
