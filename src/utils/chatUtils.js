function removeAttachmentFiles(attachment) {
  if (!attachment) return;

  const baseDir =
    process.env.NODE_ENV === "production"
      ? process.env.UPLOAD_DIR_PROD
      : process.env.UPLOAD_DIR_DEV;

  [attachment.url, attachment.thumbnailUrl].filter(Boolean).forEach((relativePath) => {
    try {
      const filePath = path.resolve(baseDir, relativePath);
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    } catch (error) {
      console.error("removeAttachmentFiles error:", error?.message || error);
    }
  });
}

function normalizeObjectIds(values) {
  if (!Array.isArray(values)) return [];

  return [...new Set(values.map((value) => String(value || "").trim()).filter(Boolean))];
}

function normalizeMentions(mentions, conversation) {
  if (!Array.isArray(mentions) || mentions.length === 0) return [];

  const memberIds = new Set((conversation?.members || []).map((m) => String(m?._id || m)));
  const seen = new Set();
  const normalized = [];

  for (const raw of mentions) {
    const type = raw?.type === "all" ? "all" : "user";

    if (type === "all") {
      if (conversation?.type !== "group" || seen.has("all")) continue;
      seen.add("all");
      normalized.push({ type: "all", userId: null });
      continue;
    }

    const userId = String(raw?.userId || "").trim();
    if (!userId || !memberIds.has(userId) || seen.has(userId)) continue;
    seen.add(userId);
    normalized.push({ type: "user", userId });
  }

  return normalized;
}

function toPlainObject(doc) {
  if (!doc) return doc;
  if (typeof doc.toObject === "function") return doc.toObject();
  return doc;
}

module.exports = {
  removeAttachmentFiles,
  normalizeObjectIds,
  normalizeMentions,
  toPlainObject
};
