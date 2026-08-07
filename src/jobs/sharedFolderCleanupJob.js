const cron = require("node-cron");
const SharedFolderModel = require("../models/SharedFolderModel");
const SharedFileModel = require("../models/SharedFileModel");
const { getSharedFilePath } = require("../middlewares/uploadShared");
const { safeUnlink } = require("../services/sharedFolderService");
const { getAllDescendantSharedFolderIds } = require("../helpers/shareFolderHelper");
const SharedFolderAuditLogModel = require("../models/SharedFolderAuditLogModel");
const { mappingMessageAuditLog } = require("../helpers/sharedFolderAuditLogHelper");

function getDailyCutoffDate(days) {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate() - (days - 1), 0, 0, 0, 0);
}

async function bulkLogAutoCleanup(entries) {
  if (!entries.length) return;
  try {
    await SharedFolderAuditLogModel.insertMany(entries, { ordered: false });
  } catch (err) {
    console.error("[SharedFolderCleanup] Ghi audit log thất bại:", err.message);
  }
}

async function unlinkInBatches(filePaths, batchSize = 20) {
  for (let i = 0; i < filePaths.length; i += batchSize) {
    const batch = filePaths.slice(i, i + batchSize);
    await Promise.all(batch.map((p) => safeUnlink(p)));
  }
}

async function scanCleanupTarget(rootFolder) {
  const cutoff = getDailyCutoffDate(rootFolder.autoCleanupDays || 3);
  const scopeIds = await getAllDescendantSharedFolderIds(rootFolder._id);

  const expiredFiles = await SharedFileModel.find({
    folder_id: { $in: scopeIds },
    isDeleted: false,
    createdAt: { $lt: cutoff }
  }).select("_id filename folder_id originalName");

  const expiredFoldersRaw = await SharedFolderModel.find({
    _id: { $in: scopeIds, $ne: rootFolder._id },
    isDeleted: false,
    createdAt: { $lt: cutoff }
  }).select("_id name parent_id");

  const expiredIdSet = new Set(expiredFoldersRaw.map((f) => f._id.toString()));
  const topMostExpiredFolders = expiredFoldersRaw.filter(
    (f) => !expiredIdSet.has(f.parent_id?.toString())
  );

  return { cutoff, expiredFiles, topMostExpiredFolders, scopeIds };
}

async function purgeExpired(rootFolder) {
  const { expiredFiles, topMostExpiredFolders } = await scanCleanupTarget(rootFolder);

  const topMostIdSet = new Set();
  for (const folder of topMostExpiredFolders) {
    const ids = await getAllDescendantSharedFolderIds(folder._id);
    ids.forEach((id) => topMostIdSet.add(id));
  }

  const auditEntries = [];
  let deletedFileCount = 0;

  const standaloneExpiredFiles = expiredFiles.filter(
    (f) => !f.folder_id || !topMostIdSet.has(f.folder_id.toString())
  );

  await unlinkInBatches(
    standaloneExpiredFiles.map((f) => getSharedFilePath(f.folder_id, f.filename))
  );

  if (standaloneExpiredFiles.length) {
    await SharedFileModel.deleteMany({ _id: { $in: standaloneExpiredFiles.map((f) => f._id) } });
    deletedFileCount += standaloneExpiredFiles.length;

    standaloneExpiredFiles.forEach((f) => {
      auditEntries.push({
        rootFolderId: rootFolder?._id,
        folderId: f.folder_id,
        targetType: SharedFolderAuditLogModel.TARGET_TYPES.FILE,
        targetId: f._id,
        action: SharedFolderAuditLogModel.AUDIT_ACTION.AUTO_CLEANUP_DELETE_FILE,
        performedBy: null,
        isSystemAction: true,
        targetName: f.originalName,
        message: mappingMessageAuditLog.AUTO_CLEANUP_DELETE_FILE(f.originalName)
      });
    });
  }

  let deletedFolderCount = 0;
  for (const folder of topMostExpiredFolders) {
    const descendantIds = await getAllDescendantSharedFolderIds(folder._id);

    const filesInside = await SharedFileModel.find({
      folder_id: { $in: descendantIds },
      isDeleted: false
    }).select("filename folder_id");

    await unlinkInBatches(filesInside.map((f) => getSharedFilePath(f.folder_id, f.filename)));

    if (filesInside.length) {
      await SharedFileModel.deleteMany({ folder_id: { $in: descendantIds } });
      deletedFileCount += filesInside.length;

      filesInside.forEach((f) => {
        auditEntries.push({
          rootFolderId: rootFolder?._id,
          folderId: f.folder_id,
          targetType: SharedFolderAuditLogModel.TARGET_TYPES.FILE,
          targetId: f._id,
          action: SharedFolderAuditLogModel.AUDIT_ACTION.AUTO_CLEANUP_DELETE_FILE,
          performedBy: null,
          isSystemAction: true,
          targetName: f.originalName,
          message: mappingMessageAuditLog.AUTO_CLEANUP_DELETE_FILE(f.originalName)
        });
      });
    }

    await SharedFolderModel.deleteMany({ _id: { $in: descendantIds } });
    deletedFolderCount += descendantIds.length;

    auditEntries.push({
      rootFolderId: rootFolder?._id,
      folderId: folder.parent_id,
      targetType: SharedFolderAuditLogModel.TARGET_TYPES.FOLDER,
      targetId: folder._id,
      action: SharedFolderAuditLogModel.AUDIT_ACTION.AUTO_CLEANUP_DELETE_FOLDER,
      performedBy: null,
      isSystemAction: true,
      targetName: folder.name,
      message: mappingMessageAuditLog.AUTO_CLEANUP_DELETE_FOLDER(folder.name)
    });
  }

  await bulkLogAutoCleanup(auditEntries);

  return { deletedFileCount, deletedFolderCount };
}

async function runAutoCleanup() {
  const targets = await SharedFolderModel.find({
    autoCleanup: true,
    isDeleted: false,
    parent_id: null
  });

  const results = [];
  for (const folder of targets) {
    const { deletedFileCount, deletedFolderCount } = await purgeExpired(folder);
    results.push({
      folderId: folder._id,
      folderName: folder.name,
      deletedFiles: deletedFileCount,
      deletedFolders: deletedFolderCount
    });
    console.log(
      `[SharedFolderCleanup] "${folder.name}": xóa vĩnh viễn ${deletedFileCount} file, ${deletedFolderCount} thư mục con`
    );
  }
  return results;
}

let isRunning = false;

async function executeCleanup() {
  if (isRunning) {
    console.log("[SharedFolderCleanup] Bỏ qua vì lượt chạy trước chưa xong");
    return;
  }
  isRunning = true;
  const start = Date.now();
  console.log(`[SharedFolderCleanup] Bắt đầu lúc ${new Date().toISOString()}`);
  try {
    const results = await runAutoCleanup();
    const totalFiles = results.reduce((sum, r) => sum + r.deletedFiles, 0);
    const totalFolders = results.reduce((sum, r) => sum + r.deletedFolders, 0);
    console.log(
      `[SharedFolderCleanup] Hoàn tất trong ${Date.now() - start}ms — tổng cộng xóa ${totalFiles} file, ${totalFolders} thư mục`
    );
  } catch (err) {
    console.error("[SharedFolderCleanup] Lỗi khi chạy auto cleanup:", err);
  } finally {
    isRunning = false;
  }
}

function registerSharedFolderCleanupJob() {
  // Chạy 1 lần mỗi ngày lúc 17:00 giờ Việt Nam.
  cron.schedule("0 17 * * *", executeCleanup, {
    timezone: "Asia/Ho_Chi_Minh"
  });

  console.log(
    "[SharedFolderCleanup] Job đã được đăng ký, chạy mỗi ngày lúc 17:00 (Asia/Ho_Chi_Minh)"
  );
}

module.exports = { registerSharedFolderCleanupJob, executeCleanup, getDailyCutoffDate };
