const AccountModel = require("../models/AccountModel");
const UserInfoModel = require("../models/UserInfoModel");
const UserDocumentModel = require("../models/UserDocumentModel");

const UserController = {
  createUser: async (req, res) => {
    try {
      const {
        username,
        password,
        full_name,
        cccd,
        phone_number,
        sex,
        date_of_birth,
        address,
        tinh_trang_hon_nhan,
      } = req.body;

      const account = await AccountModel.create({ username, password });

      const userInfo = await UserInfoModel.create({
        full_name,
        cccd,
        phone_number,
        sex,
        date_of_birth,
        address,
        tinh_trang_hon_nhan,
        id_account: account._id,
      });

      const documents = [];
      const files = req.files;

      for (const [type_id, fileArray] of Object.entries(files)) {
        const attachments = fileArray.map((f) => ({
          file_name: f.originalname,
          file_url: f.path,
          uploaded_at: new Date(),
          uploaded_by: req.user._id, // admin
          allowed_users: [userInfo._id],
        }));
        documents.push({ type_id, attachments });
      }

      // 4️⃣ Lưu UserDocument
      const userDocument = await UserDocumentModel.create({
        user_id: userInfo._id,
        documents,
      });

      res.status(201).json({
        message: "User, userInfo và documents created successfully",
        account,
        userInfo,
        userDocument,
      });
    } catch (err) {
      console.error(err);
      res.status(500).json({ message: "Internal server error", error: err.message });
    }
  },
};
module.exports = UserController;
