import {
  buildRawRules,
  ResolvedPermissionGrant,
  ResolvedOverride
} from "../src/modules/permission/domain/services/ability-rule-builder.service";
import { ResolvedCondition } from "../src/modules/permission/domain/services/condition-compiler.service";

const fakeCondition = (tag: string): ResolvedCondition =>
  ({ "resource.tag": { $eq: tag } }) as unknown as ResolvedCondition;

const grant = (overrides: Partial<ResolvedPermissionGrant> = {}): ResolvedPermissionGrant => ({
  permissionCode: "employee.view",
  entity: "Employee",
  dataScopeCondition: fakeCondition("data-scope"),
  fieldScopeFields: null,
  fieldScopeCondition: null,
  ...overrides
});

const override = (overrides: Partial<ResolvedOverride> = {}): ResolvedOverride => ({
  permissionCode: "customer.view",
  entity: "Customer",
  status: "ALLOW",
  dataScopeCondition: null,
  fieldScopeFields: null,
  fieldScopeCondition: null,
  ...overrides
});

describe("buildRawRules", () => {
  test("1 grant -> 1 can rule dùng đúng conditions của Data Scope, không có fields nếu fieldScopeFields null", () => {
    const rules = buildRawRules({ grants: [grant()], overrides: [] });
    expect(rules).toEqual([
      { action: "employee.view", subject: "Employee", conditions: fakeCondition("data-scope") }
    ]);
  });

  test("grant có fieldScopeFields -> rule có fields", () => {
    const rules = buildRawRules({
      grants: [grant({ fieldScopeFields: ["salary", "bankAccount"] })],
      overrides: []
    });
    expect(rules[0].fields).toEqual(["salary", "bankAccount"]);
  });

  test("grant có cả dataScopeCondition lẫn fieldScopeCondition -> gộp bằng $and", () => {
    const dataScope = fakeCondition("data-scope");
    const fieldScope = fakeCondition("field-scope");
    const rules = buildRawRules({
      grants: [grant({ dataScopeCondition: dataScope, fieldScopeCondition: fieldScope })],
      overrides: []
    });
    expect(rules[0].conditions).toEqual({ $and: [dataScope, fieldScope] });
  });

  test("2 role cùng cấp 1 permission -> 2 rule riêng, không tự merge", () => {
    const grantFromRoleA = grant({ dataScopeCondition: fakeCondition("role-A-scope") });
    const grantFromRoleB = grant({ dataScopeCondition: fakeCondition("role-B-scope") });
    const rules = buildRawRules({ grants: [grantFromRoleA, grantFromRoleB], overrides: [] });

    expect(rules).toHaveLength(2);
    expect(rules[0].conditions).toEqual(fakeCondition("role-A-scope"));
    expect(rules[1].conditions).toEqual(fakeCondition("role-B-scope"));
  });

  test("override ALLOW không có scope -> can rule không giới hạn", () => {
    const rules = buildRawRules({ grants: [], overrides: [override({ status: "ALLOW" })] });
    expect(rules).toEqual([{ action: "customer.view", subject: "Customer" }]);
  });

  test("override BLOCK không có scope -> cannot rule (inverted: true), không giới hạn", () => {
    const rules = buildRawRules({ grants: [], overrides: [override({ status: "BLOCK" })] });
    expect(rules).toEqual([{ action: "customer.view", subject: "Customer", inverted: true }]);
  });

  test("override ALLOW có dataScopeCondition -> can rule chỉ áp dụng trong scope đó", () => {
    const scope = fakeCondition("own-dept");
    const rules = buildRawRules({
      grants: [],
      overrides: [override({ status: "ALLOW", dataScopeCondition: scope })]
    });
    expect(rules).toEqual([
      { action: "customer.view", subject: "Customer", conditions: scope }
    ]);
  });

  test("override BLOCK có dataScopeCondition -> cannot rule chỉ áp dụng trong scope đó", () => {
    const scope = fakeCondition("own-dept");
    const rules = buildRawRules({
      grants: [],
      overrides: [override({ status: "BLOCK", dataScopeCondition: scope })]
    });
    expect(rules).toEqual([
      { action: "customer.view", subject: "Customer", inverted: true, conditions: scope }
    ]);
  });

  test("override có cả dataScopeCondition lẫn fieldScopeCondition -> gộp bằng $and, kèm fields", () => {
    const dataScope = fakeCondition("own-dept");
    const fieldScope = fakeCondition("masked-salary");
    const rules = buildRawRules({
      grants: [],
      overrides: [
        override({
          status: "ALLOW",
          dataScopeCondition: dataScope,
          fieldScopeCondition: fieldScope,
          fieldScopeFields: ["name", "phone"]
        })
      ]
    });
    expect(rules[0].conditions).toEqual({ $and: [dataScope, fieldScope] });
    expect(rules[0].fields).toEqual(["name", "phone"]);
  });

  test("BR_08: cannot (BLOCK) luôn xếp sau cùng, sau cả can từ role lẫn ALLOW override", () => {
    const rules = buildRawRules({
      grants: [grant()],
      overrides: [
        override({ permissionCode: "customer.view", entity: "Customer", status: "ALLOW" }),
        override({ permissionCode: "employee.view", entity: "Employee", status: "BLOCK" })
      ]
    });

    expect(rules).toHaveLength(3);
    expect(rules[0].action).toBe("employee.view");
    expect(rules[0].inverted).toBeUndefined();
    expect(rules[1].action).toBe("customer.view");
    expect(rules[1].inverted).toBeUndefined();
    expect(rules[2].action).toBe("employee.view");
    expect(rules[2].inverted).toBe(true);
  });
});
