import { EmployeeId } from "../../src/shared-kernel/employee-id";
import {
  ArgumentNotProvidedException,
  ArgumentInvalidException
} from "../../src/core/exceptions/exceptions";

describe("EmployeeId", () => {
  it("equals() so sánh theo giá trị, không theo instance", () => {
    const a = EmployeeId.of("507f1f77bcf86cd799439011");
    const b = EmployeeId.of("507f1f77bcf86cd799439011");
    expect(a.equals(b)).toBe(true);
    expect(a).not.toBe(b);
  });

  it("equals() trả false khi giá trị khác nhau", () => {
    const a = EmployeeId.of("id-1");
    const b = EmployeeId.of("id-2");
    expect(a.equals(b)).toBe(false);
  });

  it("of() nhận cả ObjectId lẫn string, tự String() hoá", () => {
    const fakeObjectId = { toString: () => "abc123" };
    const id = EmployeeId.of(fakeObjectId);
    expect(id.toString()).toBe("abc123");
  });

  it("throw khi giá trị rỗng", () => {
    expect(() => EmployeeId.of("")).toThrow(ArgumentNotProvidedException);
  });

  it('throw khi null/undefined — KHÔNG được nuốt lỗi bằng String() hoá (String(null)==="null" là chuỗi khác rỗng, dễ lọt qua validate nếu String() hoá trước khi check)', () => {
    expect(() => EmployeeId.of(null)).toThrow(ArgumentInvalidException);
    expect(() => EmployeeId.of(undefined)).toThrow(ArgumentInvalidException);
  });

  it("throw ArgumentInvalidException khi giá trị không phải string (sau khi String() hoá vẫn hợp lệ nên test qua validate trực tiếp)", () => {
    // EmployeeId.of() luôn String()-hoá nên khó tạo giá trị non-string tới validate() —
    // xác nhận qua constructor trực tiếp để test đúng nhánh validate().
    expect(() => new EmployeeId({ value: 123 as unknown as string })).toThrow(
      ArgumentInvalidException
    );
  });
});
