const { parsePagination } = require("../../src/core/http/parse-pagination");

describe("parsePagination()", () => {
  it("dùng default page=1, limit=20 khi query rỗng", () => {
    expect(parsePagination({})).toEqual({ page: 1, limit: 20, skip: 0 });
  });

  it("page không phải số hợp lệ (NaN) — fallback về default thay vì tạo skip(NaN)", () => {
    expect(parsePagination({ page: "abc" })).toEqual({ page: 1, limit: 20, skip: 0 });
  });

  it("limit không phải số hợp lệ (NaN) — fallback về default thay vì bỏ giới hạn hoàn toàn", () => {
    expect(parsePagination({ limit: "abc" })).toEqual({ page: 1, limit: 20, skip: 0 });
  });

  it("limit âm — fallback về default thay vì gây hành vi lạ ở tầng Mongo driver", () => {
    expect(parsePagination({ limit: "-1" })).toEqual({ page: 1, limit: 20, skip: 0 });
  });

  it("limit vượt trần — bị clamp về MAX_LIMIT (100), không cho query không giới hạn", () => {
    expect(parsePagination({ limit: "99999" })).toEqual({ page: 1, limit: 100, skip: 0 });
  });

  it("page=0 hoặc âm — fallback về 1", () => {
    expect(parsePagination({ page: "0" })).toEqual({ page: 1, limit: 20, skip: 0 });
    expect(parsePagination({ page: "-5" })).toEqual({ page: 1, limit: 20, skip: 0 });
  });

  it("page không phải số nguyên (2.5) — fallback về default", () => {
    expect(parsePagination({ page: "2.5" })).toEqual({ page: 1, limit: 20, skip: 0 });
  });

  it("input hợp lệ — tính đúng skip", () => {
    expect(parsePagination({ page: "3", limit: "10" })).toEqual({ page: 3, limit: 10, skip: 20 });
  });
});
