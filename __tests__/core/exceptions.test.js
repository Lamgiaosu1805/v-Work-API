const {
  ArgumentInvalidException,
  ArgumentNotProvidedException,
  ArgumentOutOfRangeException,
  ConflictException,
  NotFoundException,
  InternalServerErrorException
} = require("../../src/core/exceptions/exceptions");
const { ExceptionBase } = require("../../src/core/exceptions/exception.base");

describe.each([
  ["ArgumentInvalidException", ArgumentInvalidException, "GENERIC.ARGUMENT_INVALID", 400],
  [
    "ArgumentNotProvidedException",
    ArgumentNotProvidedException,
    "GENERIC.ARGUMENT_NOT_PROVIDED",
    400
  ],
  [
    "ArgumentOutOfRangeException",
    ArgumentOutOfRangeException,
    "GENERIC.ARGUMENT_OUT_OF_RANGE",
    400
  ],
  ["ConflictException", ConflictException, "GENERIC.CONFLICT", 409]
])("%s", (_name, ExceptionClass, expectedCode, expectedStatus) => {
  it(`has code=${expectedCode} and statusCode=${expectedStatus}`, () => {
    const err = new ExceptionClass("something went wrong");
    expect(err.code).toBe(expectedCode);
    expect(err.statusCode).toBe(expectedStatus);
    expect(err.message).toBe("something went wrong");
    expect(err).toBeInstanceOf(ExceptionBase);
    expect(err).toBeInstanceOf(Error);
  });
});

describe("NotFoundException", () => {
  it("uses a default message when none is given", () => {
    expect(new NotFoundException().message).toBe("Not found");
    expect(new NotFoundException().statusCode).toBe(404);
  });

  it("accepts a custom message", () => {
    expect(new NotFoundException("Request không tồn tại").message).toBe("Request không tồn tại");
  });
});

describe("InternalServerErrorException", () => {
  it("uses a default message when none is given", () => {
    expect(new InternalServerErrorException().message).toBe("Internal server error");
    expect(new InternalServerErrorException().statusCode).toBe(500);
  });
});

describe("ExceptionBase", () => {
  it("carries cause + metadata through to toJSON()", () => {
    const cause = new Error("duplicate key");
    const err = new ConflictException("Record đã tồn tại", { cause, metadata: { field: "email" } });
    expect(err.cause).toBe(cause);
    expect(err.metadata).toEqual({ field: "email" });

    const json = err.toJSON();
    expect(json).toMatchObject({
      message: "Record đã tồn tại",
      code: "GENERIC.CONFLICT",
      statusCode: 409,
      metadata: { field: "email" }
    });
    expect(typeof json.stack).toBe("string");
  });

  it("captures a stack trace naming the concrete exception class, not Error/ExceptionBase", () => {
    const err = new ArgumentInvalidException("bad input");
    expect(err.stack).toMatch(/ArgumentInvalidException/);
  });

  it("name matches the concrete class", () => {
    expect(new NotFoundException().name).toBe("NotFoundException");
  });
});
