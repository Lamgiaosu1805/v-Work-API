import axios from "axios";
import { OmicallClient } from "../src/utils/omicallClient";

jest.mock("axios");

describe("OmicallClient.transferAgent — parse response shape", () => {
  let postMock: jest.Mock;

  beforeEach(() => {
    postMock = jest.fn();
    (axios.create as jest.Mock).mockReturnValue({
      post: postMock,
      get: jest.fn(),
      put: jest.fn(),
      interceptors: {
        request: { use: jest.fn() },
        response: { use: jest.fn() }
      }
    });
  });

  test("response dạng { payload: { requestId } } -> lấy được requestId", async () => {
    postMock.mockResolvedValue({ data: { payload: { requestId: "req-1" } } });

    const client = new OmicallClient();
    const result = await client.transferAgent({
      sourceEmail: "a@x.test",
      targetEmail: "b@x.test"
    });

    expect(result).toEqual({ requestId: "req-1" });
  });

  test("response dạng { requestId } ở top-level (không có payload) -> vẫn lấy được", async () => {
    postMock.mockResolvedValue({ data: { requestId: "req-2" } });

    const client = new OmicallClient();
    const result = await client.transferAgent({
      sourceEmail: "a@x.test",
      targetEmail: "b@x.test"
    });

    expect(result).toEqual({ requestId: "req-2" });
  });

  test("response không có field requestId ở bất kỳ shape nào -> KHÔNG throw, trả về requestId: null", async () => {
    postMock.mockResolvedValue({ data: { success: true } });

    const client = new OmicallClient();
    const result = await client.transferAgent({
      sourceEmail: "a@x.test",
      targetEmail: "b@x.test"
    });

    expect(result).toEqual({ requestId: null });
  });

  test("response rỗng/undefined -> KHÔNG throw, trả về requestId: null", async () => {
    postMock.mockResolvedValue({ data: undefined });

    const client = new OmicallClient();
    const result = await client.transferAgent({
      sourceEmail: "a@x.test",
      targetEmail: "b@x.test"
    });

    expect(result).toEqual({ requestId: null });
  });
});
