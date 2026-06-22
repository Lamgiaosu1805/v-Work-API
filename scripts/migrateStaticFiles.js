require("dotenv").config();
const mongoose = require("mongoose");
const path = require("path");
const fs = require("fs");

const UserInfoModel = require("../src/models/UserInfoModel");
const PostModel = require("../src/models/PostModel");

const DRY = process.argv.includes("--dry-run");
const isProd = process.env.NODE_ENV === "production";

const PRIVATE_DIR = isProd ? process.env.UPLOAD_DIR_PROD : process.env.UPLOAD_DIR_DEV;
const PUBLIC_DIR = isProd ? process.env.UPLOAD_DIR_PUBLIC_PROD : process.env.UPLOAD_DIR_PUBLIC_DEV;
const AVATAR_DIR = path.resolve(PUBLIC_DIR, "avatar");
const FEED_PUBLIC_DIR = path.resolve(PUBLIC_DIR, "feed");
const FEED_PRIVATE_DIR = path.resolve(PRIVATE_DIR, "feed");

const stats = { avatar: 0, cover: 0, feed: 0, skipped: 0, missing: 0 };

function ensureDir(dir) {
  if (!DRY && !fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function moveFile(srcPath, destPath, label) {
  if (fs.existsSync(destPath)) {
    stats.skipped++;
    return true;
  }
  if (!fs.existsSync(srcPath)) {
    console.warn(`  ⚠️  [${label}] thiếu file nguồn: ${srcPath}`);
    stats.missing++;
    return false;
  }
  if (DRY) {
    console.log(`  [dry] move ${srcPath} → ${destPath}`);
    return true;
  }
  fs.copyFileSync(srcPath, destPath);
  fs.unlinkSync(srcPath);
  return true;
}

async function migrateAvatars() {
  ensureDir(AVATAR_DIR);
  const users = await UserInfoModel.find(
    { $or: [{ avatar: { $ne: null } }, { cover_photo: { $ne: null } }] },
    { avatar: 1, cover_photo: 1 }
  ).lean();

  console.log(`\n── Avatar/Cover: ${users.length} user có ảnh ──`);
  for (const u of users) {
    const update = {};

    for (const field of ["avatar", "cover_photo"]) {
      const val = u[field];
      if (!val) continue;
      if (val.startsWith("avatar/")) {
        stats.skipped++;
        continue;
      }
      const base = path.basename(val);
      const srcPath = path.join(PRIVATE_DIR, base);
      const destPath = path.join(AVATAR_DIR, base);
      const ok = moveFile(srcPath, destPath, field);
      update[field] = `avatar/${base}`;
      if (ok) stats[field === "avatar" ? "avatar" : "cover"]++;
    }

    if (Object.keys(update).length && !DRY) {
      await UserInfoModel.updateOne({ _id: u._id }, { $set: update });
    }
  }
}

async function migrateFeed() {
  ensureDir(FEED_PUBLIC_DIR);
  const posts = await PostModel.find({ images: { $exists: true, $ne: [] } }, { images: 1 }).lean();

  const files = new Set();
  posts.forEach((p) => (p.images || []).forEach((img) => files.add(path.basename(img))));

  console.log(`\n── Feed: ${files.size} file ảnh từ ${posts.length} bài viết ──`);
  for (const base of files) {
    const srcPath = path.join(FEED_PRIVATE_DIR, base);
    const destPath = path.join(FEED_PUBLIC_DIR, base);
    if (moveFile(srcPath, destPath, "feed") && fs.existsSync(destPath)) stats.feed++;
  }
}

async function run() {
  console.log(`Mode: ${DRY ? "DRY-RUN" : "LIVE"} | env=${process.env.NODE_ENV}`);
  console.log(`PRIVATE_DIR=${PRIVATE_DIR}`);
  console.log(`PUBLIC_DIR=${PUBLIC_DIR}`);

  await mongoose.connect(process.env.MONGODB_URI);
  console.log("DB connected");

  await migrateAvatars();
  await migrateFeed();

  console.log("\n── Kết quả ──");
  console.log(stats);

  await mongoose.disconnect();
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
