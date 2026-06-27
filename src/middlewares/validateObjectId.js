const express = require("express");
const mongoose = require("mongoose");

const ID_PARAMS = [
  "id",
  "accountId",
  "userId",
  "customerId",
  "deptId",
  "fileId",
  "folderId",
  "commentId",
  "conversationId",
  "messageId",
  "memberId",
  "reportId",
  "worksheetId"
];

function objectIdParam(req, res, next, value, name) {
  if (!mongoose.Types.ObjectId.isValid(value)) {
    return res.status(400).json({ errorCode: "INVALID_ID", message: `${name} không hợp lệ` });
  }
  return next();
}

function createRouter(options) {
  const router = express.Router(options);
  for (const name of ID_PARAMS) router.param(name, objectIdParam);
  return router;
}

module.exports = { createRouter, objectIdParam, ID_PARAMS };
