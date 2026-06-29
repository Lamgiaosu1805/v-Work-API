const mongoose = require("mongoose");
const DeviceTokenModel = require("../models/DeviceTokenModel");
const pushNotification = require("../helpers/pushNotification");
const notificationService = require("../services/notificationService");

const NotificationController = {
  list: async (req, res) => {
    try {
      const { page = 1, limit = 20 } = req.query;
      const result = await notificationService.listNotifications({
        accountId: req.account._id,
        page,
        limit
      });
      return res.status(200).json(result);
    } catch (error) {
      console.error("Error in list notifications:", error);
      return res.status(500).json({ message: "Internal server error", error: error.message });
    }
  },

  unreadCount: async (req, res) => {
    try {
      const count = await notificationService.countUnread(req.account._id);
      return res.status(200).json({ count });
    } catch (error) {
      console.error("Error in unreadCount notifications:", error);
      return res.status(500).json({ message: "Internal server error", error: error.message });
    }
  },

  markRead: async (req, res) => {
    try {
      const notification = await notificationService.markRead({
        accountId: req.account._id,
        notificationId: req.params.id
      });
      if (!notification) {
        return res.status(404).json({ message: "Không tìm thấy thông báo" });
      }
      return res.status(200).json({ message: "Đã đánh dấu đã đọc", notification });
    } catch (error) {
      console.error("Error in markRead notification:", error);
      return res.status(500).json({ message: "Internal server error", error: error.message });
    }
  },

  markAllRead: async (req, res) => {
    try {
      const result = await notificationService.markAllRead(req.account._id);
      return res.status(200).json({ message: "Đã đánh dấu tất cả đã đọc", ...result });
    } catch (error) {
      console.error("Error in markAllRead notifications:", error);
      return res.status(500).json({ message: "Internal server error", error: error.message });
    }
  },

  registerDeviceToken: async (req, res) => {
    try {
      const { fcm_token, platform = "android", device_id = null } = req.body;

      if (!fcm_token) return res.status(400).json({ message: "Thiếu fcm_token" });
      if (!["ios", "android", "web"].includes(platform))
        return res.status(400).json({ message: "platform không hợp lệ" });
      if (!device_id) return res.status(400).json({ message: "Thiếu device_id" });

      const accountId = req.account._id;
      const now = new Date();

      await DeviceTokenModel.updateMany(
        { device_id, account_id: { $ne: accountId }, is_active: true, isDeleted: false },
        { $set: { is_active: false, last_used_at: now } }
      );

      const tokenOwner = await DeviceTokenModel.findOne({ fcm_token, isDeleted: false });
      const tokenBelongsToOther =
        tokenOwner &&
        !(
          String(tokenOwner.account_id) === String(accountId) && tokenOwner.device_id === device_id
        );

      let deviceToken;

      if (tokenBelongsToOther) {
        await DeviceTokenModel.updateMany(
          { account_id: accountId, device_id, _id: { $ne: tokenOwner._id }, isDeleted: false },
          { $set: { is_active: false, last_used_at: now } }
        );

        deviceToken = await DeviceTokenModel.findByIdAndUpdate(
          tokenOwner._id,
          {
            $set: {
              account_id: accountId,
              fcm_token,
              platform,
              device_id,
              is_active: true,
              isDeleted: false,
              last_used_at: now
            }
          },
          { new: true }
        );
      } else {
        const existing = await DeviceTokenModel.findOne({ account_id: accountId, device_id });

        if (existing) {
          deviceToken = await DeviceTokenModel.findByIdAndUpdate(
            existing._id,
            {
              $set: {
                fcm_token,
                platform,
                is_active: true,
                isDeleted: false,
                last_used_at: now
              }
            },
            { new: true }
          );
        } else {
          deviceToken = await DeviceTokenModel.create({
            account_id: accountId,
            fcm_token,
            platform,
            device_id,
            is_active: true,
            isDeleted: false,
            last_used_at: now
          });
        }
      }

      return res.status(200).json({ message: "Lưu device token thành công", deviceToken });
    } catch (error) {
      console.error("Error in registerDeviceToken:", error);
      return res.status(500).json({ message: "Internal server error", error: error.message });
    }
  },

  unregisterDeviceToken: async (req, res) => {
    try {
      const { device_id, fcm_token } = req.body;

      if (!device_id && !fcm_token) {
        return res.status(400).json({ message: "Thiếu device_id hoặc fcm_token" });
      }

      const query = {
        account_id: req.account._id,
        isDeleted: false
      };

      if (device_id) {
        query.device_id = device_id;
      } else {
        query.fcm_token = fcm_token;
      }

      const deviceToken = await DeviceTokenModel.findOneAndUpdate(
        query,
        {
          is_active: false,
          last_used_at: new Date()
        },
        { new: true }
      );

      if (!deviceToken) {
        return res.status(404).json({ message: "Không tìm thấy device token" });
      }

      return res.status(200).json({
        message: "Hủy device token thành công"
      });
    } catch (error) {
      console.error("Error in unregisterDeviceToken:", error);
      return res.status(500).json({ message: "Internal server error", error: error.message });
    }
  },

  testSend: async (req, res) => {
    try {
      const { account_id, title, body, data = {} } = req.body;

      if (!account_id) {
        return res.status(400).json({ message: "Thiếu account_id" });
      }

      if (!mongoose.Types.ObjectId.isValid(account_id)) {
        return res.status(400).json({ message: "account_id không hợp lệ" });
      }

      if (!title || !body) {
        return res.status(400).json({ message: "Thiếu title hoặc body" });
      }

      const result = await pushNotification.sendToAccount({
        account_id,
        title,
        body,
        data
      });

      if (!result.tokens.length) {
        return res.status(404).json({ message: "Account này chưa có device token active" });
      }

      return res.status(200).json({
        message: "Gửi thông báo test hoàn tất",
        successCount: result.successCount,
        failureCount: result.failureCount,
        invalidTokens: result.invalidTokens
      });
    } catch (error) {
      console.error("Error in testSend notification:", error);
      return res.status(500).json({ message: "Internal server error", error: error.message });
    }
  }
};

module.exports = NotificationController;
