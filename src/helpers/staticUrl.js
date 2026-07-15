const { DEFAULT_TTL_SECONDS, encryptFilePath } = require("./fileSignature");

const sign = (relativePath, ttlSeconds = DEFAULT_TTL_SECONDS) => {
  if (!relativePath) return null;
  if (/^https?:\/\//i.test(relativePath)) return relativePath;

  const base = (process.env.BASE_URL || "").replace(/\/+$/, "");
  const token = encryptFilePath(relativePath, ttlSeconds);
  return `${base}/f/${token}`;
};

const toPlain = (o) => (o && typeof o.toObject === "function" ? o.toObject() : { ...o });

function signReactions(reactions) {
  if (!Array.isArray(reactions)) return reactions;
  return reactions.map((r) => {
    const obj = toPlain(r);
    obj.author_avatar = sign(obj.author_avatar);
    return obj;
  });
}

function serializePost(post) {
  if (!post) return post;
  const p = toPlain(post);
  p.author_avatar = sign(p.author_avatar);
  if (Array.isArray(p.images)) p.images = p.images.map(sign);
  if (Array.isArray(p.reactions)) p.reactions = signReactions(p.reactions);
  return p;
}

function serializeComment(comment) {
  if (!comment) return comment;
  const c = toPlain(comment);
  c.image = sign(c.image);
  c.author_avatar = sign(c.author_avatar);
  return c;
}

function serializeUser(user) {
  if (!user) return user;
  const u = toPlain(user);
  if ("avatar" in u) u.avatar = sign(u.avatar);
  if ("cover_photo" in u) u.cover_photo = sign(u.cover_photo);
  return u;
}

function signAvatarsDeep(value) {
  if (Array.isArray(value)) return value.map(signAvatarsDeep);
  if (!value || typeof value !== "object") return value;
  if (value.constructor !== Object && typeof value.toObject !== "function") {
    return value; // bỏ qua Date, ObjectId, Buffer...
  }
  const obj = typeof value.toObject === "function" ? value.toObject() : value;
  for (const k of Object.keys(obj)) {
    if ((k === "avatar" || k === "cover_photo") && typeof obj[k] === "string") {
      obj[k] = sign(obj[k]);
    } else if (obj[k] && typeof obj[k] === "object") {
      obj[k] = signAvatarsDeep(obj[k]);
    }
  }
  return obj;
}

module.exports = {
  sign,
  signReactions,
  serializePost,
  serializeComment,
  serializeUser,
  signAvatarsDeep
};
