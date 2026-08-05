const { mergePermissions } = require("../src/helpers/rbacResolve");
const { PERMISSION_EFFECT } = require("../src/constants");

const { ALLOW, DENY } = PERMISSION_EFFECT;

describe("mergePermissions", () => {
  test("role grant cơ bản", () => {
    const r = mergePermissions(["a", "b"], []);
    expect([...r].sort()).toEqual(["a", "b"]);
  });

  test("user ALLOW cấp thêm quyền ngoài role", () => {
    const r = mergePermissions(["a"], [{ code: "b", effect: ALLOW }]);
    expect(r.has("a")).toBe(true);
    expect(r.has("b")).toBe(true);
  });

  test("user DENY chặn quyền role đã cấp", () => {
    const r = mergePermissions(["a", "b"], [{ code: "b", effect: DENY }]);
    expect(r.has("a")).toBe(true);
    expect(r.has("b")).toBe(false);
  });

  test("DENY thắng ALLOW khi cùng 1 code", () => {
    const r = mergePermissions(
      [],
      [
        { code: "x", effect: ALLOW },
        { code: "x", effect: DENY }
      ]
    );
    expect(r.has("x")).toBe(false);
  });

  test("DENY code không tồn tại không gây lỗi", () => {
    const r = mergePermissions(["a"], [{ code: "zzz", effect: DENY }]);
    expect([...r]).toEqual(["a"]);
  });

  test("trùng quyền từ nhiều role chỉ tính 1 lần", () => {
    const r = mergePermissions(["a", "a", "b"], []);
    expect(r.size).toBe(2);
  });

  test("rỗng hoàn toàn", () => {
    expect(mergePermissions([], []).size).toBe(0);
  });
});
