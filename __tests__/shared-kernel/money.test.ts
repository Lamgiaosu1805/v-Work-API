import { Money } from "../../src/shared-kernel/money";
import { ArgumentInvalidException } from "../../src/core/exceptions/exceptions";

describe("Money", () => {
  it("zero() cho ra giá trị 0 — không bị isEmpty() của ValueObject base chặn nhầm (0 khác falsy)", () => {
    expect(Money.zero().toNumber()).toBe(0);
    expect(Money.zero().isNegative()).toBe(false);
  });

  it("of() giữ nguyên số thập phân (0.5 ngày phép)", () => {
    expect(Money.of(0.5).toNumber()).toBe(0.5);
  });

  it("isNegative() đúng cho cả âm/dương/0", () => {
    expect(Money.of(-1).isNegative()).toBe(true);
    expect(Money.of(1).isNegative()).toBe(false);
    expect(Money.of(0).isNegative()).toBe(false);
  });

  it("add()/subtract() trả về Money mới, không mutate", () => {
    const a = Money.of(5);
    const b = a.add(Money.of(3));
    expect(b.toNumber()).toBe(8);
    expect(a.toNumber()).toBe(5);

    const c = a.subtract(Money.of(2));
    expect(c.toNumber()).toBe(3);
  });

  it("equals() so sánh theo giá trị", () => {
    expect(Money.of(4).equals(Money.of(4))).toBe(true);
    expect(Money.of(4).equals(Money.of(5))).toBe(false);
  });

  it("throw khi giá trị không phải number hợp lệ", () => {
    expect(() => new Money({ value: NaN })).toThrow(ArgumentInvalidException);
    expect(() => new Money({ value: "5" as unknown as number })).toThrow(ArgumentInvalidException);
  });

  describe("chặn nhiễu floating point (0.1 + 0.2 !== 0.3 trong JS thuần)", () => {
    it("add() cho kết quả chính xác tuyệt đối, không dư nhiễu", () => {
      expect(Money.of(0.1).add(Money.of(0.2)).toNumber()).toBe(0.3);
    });

    it("chuỗi add() liên tiếp không tích luỹ sai số qua nhiều bước", () => {
      let acc = Money.of(0.1);
      for (let i = 0; i < 20; i += 1) acc = acc.add(Money.of(0.1));
      expect(acc.toNumber()).toBe(2.1);
    });

    it("of() tự làm tròn về 2 chữ số thập phân ngay lúc tạo, không chỉ ở add()/subtract()", () => {
      expect(Money.of(0.1 + 0.2).toNumber()).toBe(0.3);
    });
  });
});
