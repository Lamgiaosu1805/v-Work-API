const mongoose = require("mongoose");
const AccountModel = require("../models/AccountModel");
const UserInfoModel = require("../models/UserInfoModel");
const UserDocumentModel = require("../models/UserDocumentModel");
const Utils = require("../config/common/utils");
const bcrypt = require('bcrypt')

const UserController = {
  createUser: async (req, res) => {
    const session = await mongoose.startSession();
    session.startTransaction();

    try {
      const {
        full_name,
        cccd,
        phone_number,
        sex,
        date_of_birth,
        address,
        tinh_trang_hon_nhan,
      } = req.body;

      const existingUser = await UserInfoModel.findOne({ cccd }).session(session);
      if (existingUser) {
        await session.abortTransaction();
        session.endSession();
        return res.status(400).json({ message: "Thông tin đã tồn tại" });
      }

      const stt = await UserInfoModel.countDocuments().session(session);
      const maNV = Utils.getMaNV((stt + 1).toString());
      const username = await Utils.generateUsername(full_name);
      const password = Utils.genRandomPassword();
      const salt = await bcrypt.genSalt(10);
      const hashedPassword = await bcrypt.hash(password, salt);

      const [account] = await AccountModel.create(
        [
          {
            username,
            password: hashedPassword,
          },
        ],
        { session }
      );

      const [userInfo] = await UserInfoModel.create(
        [
          {
            full_name,
            cccd,
            phone_number,
            sex,
            date_of_birth,
            address,
            tinh_trang_hon_nhan,
            id_account: account._id,
            ma_nv: maNV,
          },
        ],
        { session }
      );

      const documents = [];
      const files = req.files || {};

      for (const [type_id, fileArray] of Object.entries(files)) {
        const attachments = fileArray.map((f) => ({
          file_name: f.originalname,
          file_url: f.path,
          uploaded_at: new Date(),
          uploaded_by: req.account?._id || null, // admin
          allowed_users: [userInfo._id],
        }));
        documents.push({ type_id, attachments });
      }

      await UserDocumentModel.create(
        [
          {
            user_id: userInfo._id,
            documents,
          },
        ],
        { session }
      );

      await session.commitTransaction();
      session.endSession();

      res.status(201).json({
        message: "User, userInfo và documents created successfully",
        account,
        firstPassword: password,
        userInfo,
      });
    } catch (err) {
      await session.abortTransaction();
      session.endSession();
      console.error(err);
      res.status(500).json({
        message: "Internal server error",
        error: err.message,
      });
    }
  },
  createAdmin: async (req, res) => {
    try {
      const { username, password } = req.body;
      const existingAdmin = await AccountModel.findOne({ username, role: "admin" });
      if (existingAdmin) {
        return res.status(400).json({ message: "Admin đã tồn tại" });
      }

      const salt = await bcrypt.genSalt(10);
      const hashedPassword = await bcrypt.hash(password, salt);

      const newAdmin = new AccountModel({
        username,
        password: hashedPassword,
        role: "admin",
        isFirstLogin: false,
      });

      await newAdmin.save();

      res.status(201).json({
        message: "Admin created successfully",
        admin: newAdmin,
      });
    } catch (error) {
      console.log(error);
      res.status(500).json({ message: "Internal server error", error: error.message });
    }
  },
  getUserInfo: async (req, res) => {
    try {
      const user = await UserInfoModel.findOne({ id_account: req.account._id })
      res.json(user)
    } catch (error) {
      console.log(error)
      res.status(500).json({ message: "Internal server error", error: error.message });
    }
  }
};

module.exports = UserController;
