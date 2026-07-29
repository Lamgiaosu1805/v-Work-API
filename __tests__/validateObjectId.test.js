const express = require("express");
const request = require("supertest");
const { createRouter } = require("../src/middlewares/validateObjectId");

function buildApp() {
  const app = express();
  const router = createRouter();
  router.get("/users/:accountId", (req, res) => res.json({ ok: true, id: req.params.accountId }));
  app.use(router);
  return app;
}

describe("validateObjectId middleware (qua createRouter)", () => {
  const app = buildApp();

  test("ObjectId hợp lệ → đi tiếp vào handler (200)", async () => {
    const res = await request(app).get("/users/507f1f77bcf86cd799439011");
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });

  test("id sai định dạng → 400 INVALID_ID, không rơi vào 500", async () => {
    const res = await request(app).get("/users/not-an-id");
    expect(res.status).toBe(400);
    expect(res.body.errorCode).toBe("INVALID_ID");
    expect(res.body.message).toMatch(/accountId/);
  });
});
