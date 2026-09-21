/* eslint-disable no-template-curly-in-string -- test fixture cố ý dùng đúng chuỗi placeholder
   "${subject.xxx}" mà compiler sinh ra, không phải lỗi quên template literal */
import {
  compile,
  interpolate,
  CompiledCondition
} from "../src/modules/permission/domain/services/condition-compiler.service";
import { ConditionTreeProps } from "../src/modules/permission/domain/value-objects/condition-tree.vo";
import {
  ConditionClauseProps,
  ConditionOperator
} from "../src/modules/permission/domain/value-objects/condition-clause.vo";
import { ArgumentInvalidException } from "../src/core/exceptions/exceptions";

const literalClause = (
  left: string,
  operator: ConditionOperator,
  value: string | number | boolean
): ConditionClauseProps => ({
  left,
  operator,
  right: { type: "LITERAL", value }
});

const subjectRefClause = (
  left: string,
  operator: ConditionOperator,
  path: string
): ConditionClauseProps => ({
  left,
  operator,
  right: { type: "SUBJECT_REF", path }
});

describe("compile", () => {
  test("1 clause LITERAL -> { field: { $eq: value } }, bỏ tiền tố resource. khi ra Mongo field key", () => {
    const tree: ConditionTreeProps = {
      operator: "AND",
      clauses: [literalClause("resource.status", "EQ", "approved")]
    };
    expect(compile(tree)).toEqual({
      $and: [{ status: { $eq: "approved" } }]
    });
  });

  test("1 clause SUBJECT_REF -> placeholder chưa interpolate, left cũng bỏ tiền tố resource.", () => {
    const tree: ConditionTreeProps = {
      operator: "OR",
      clauses: [subjectRefClause("resource.managerId", "EQ", "subject.userId")]
    };
    expect(compile(tree)).toEqual({
      $or: [{ managerId: { $eq: "${subject.userId}" } }]
    });
  });

  test.each([
    ["EQ", "$eq"],
    ["NE", "$ne"],
    ["IN", "$in"],
    ["NOT_IN", "$nin"],
    ["GT", "$gt"],
    ["GTE", "$gte"],
    ["LT", "$lt"],
    ["LTE", "$lte"]
  ])("map operator %s -> %s", (operator, mongoOperator) => {
    const tree: ConditionTreeProps = {
      operator: "AND",
      clauses: [literalClause("resource.amount", operator as ConditionOperator, 100)]
    };
    const result = compile(tree) as { $and: CompiledCondition[] };
    expect(result.$and[0]).toEqual({ amount: { [mongoOperator]: 100 } });
  });

  test("AND lồng OR bên trong -> giữ đúng cấu trúc cây", () => {
    const tree: ConditionTreeProps = {
      operator: "AND",
      clauses: [
        literalClause("resource.status", "EQ", "approved"),
        {
          operator: "OR",
          clauses: [
            subjectRefClause("resource.managerId", "EQ", "subject.userId"),
            subjectRefClause("resource.departmentId", "EQ", "subject.departmentId")
          ]
        }
      ]
    };
    expect(compile(tree)).toEqual({
      $and: [
        { status: { $eq: "approved" } },
        {
          $or: [
            { managerId: { $eq: "${subject.userId}" } },
            { departmentId: { $eq: "${subject.departmentId}" } }
          ]
        }
      ]
    });
  });

  test('left chứa "$" -> ném ArgumentInvalidException (chặn NoSQL injection qua $where)', () => {
    const tree: ConditionTreeProps = {
      operator: "AND",
      clauses: [literalClause("$where", "EQ", "1==1")]
    };
    expect(() => compile(tree)).toThrow(ArgumentInvalidException);
  });

  test('operator lạ không có trong map -> ném lỗi thay vì tạo key "undefined"', () => {
    const badClause = {
      left: "resource.status",
      operator: "UNKNOWN_OP" as ConditionOperator,
      right: { type: "LITERAL", value: "x" } as const
    };
    const tree: ConditionTreeProps = { operator: "AND", clauses: [badClause] };
    expect(() => compile(tree)).toThrow(ArgumentInvalidException);
  });
});

describe("interpolate", () => {
  test("thay placeholder SUBJECT_REF bằng giá trị thật từ subject", () => {
    const tree: ConditionTreeProps = {
      operator: "OR",
      clauses: [
        subjectRefClause("resource.managerId", "EQ", "subject.userId"),
        subjectRefClause("resource.departmentId", "EQ", "subject.departmentId")
      ]
    };
    const compiled = compile(tree);
    const resolved = interpolate(compiled, { userId: "u1", departmentId: "d1" });
    expect(resolved).toEqual({
      $or: [{ managerId: { $eq: "u1" } }, { departmentId: { $eq: "d1" } }]
    });
  });

  test("LITERAL giữ nguyên, không bị đụng vào khi interpolate", () => {
    const tree: ConditionTreeProps = {
      operator: "AND",
      clauses: [literalClause("resource.status", "EQ", "approved")]
    };
    const compiled = compile(tree);
    expect(interpolate(compiled, {})).toEqual({
      $and: [{ status: { $eq: "approved" } }]
    });
  });

  test("thiếu subject attribute cần thiết -> ném ArgumentInvalidException", () => {
    const tree: ConditionTreeProps = {
      operator: "AND",
      clauses: [subjectRefClause("resource.managerId", "EQ", "subject.userId")]
    };
    const compiled = compile(tree);
    expect(() => interpolate(compiled, { departmentId: "d1" })).toThrow(ArgumentInvalidException);
  });

  test("không mutate compiled template gốc -- interpolate 2 subject khác nhau ra 2 kết quả độc lập", () => {
    const tree: ConditionTreeProps = {
      operator: "AND",
      clauses: [subjectRefClause("resource.managerId", "EQ", "subject.userId")]
    };
    const compiled = compile(tree);
    const snapshotBefore = JSON.parse(JSON.stringify(compiled));

    const resolvedA = interpolate(compiled, { userId: "userA" });
    const resolvedB = interpolate(compiled, { userId: "userB" });

    expect(resolvedA).toEqual({ $and: [{ managerId: { $eq: "userA" } }] });
    expect(resolvedB).toEqual({ $and: [{ managerId: { $eq: "userB" } }] });
    expect(compiled).toEqual(snapshotBefore);
  });

  test("filter sinh ra match đúng document Mongo thật (không có wrapper 'resource')", () => {
    const tree: ConditionTreeProps = {
      operator: "AND",
      clauses: [subjectRefClause("resource.managerId", "EQ", "subject.userId")]
    };
    const compiled = compile(tree);
    const resolved = interpolate(compiled, { userId: "u1" });

    expect(JSON.stringify(resolved)).not.toContain("resource.");
    expect(resolved).toEqual({ $and: [{ managerId: { $eq: "u1" } }] });
  });
});
