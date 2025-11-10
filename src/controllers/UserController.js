const mongoose = require("mongoose");
const AccountModel = require("../models/AccountModel");
const UserInfoModel = require("../models/UserInfoModel");
const UserDocumentModel = require("../models/UserDocumentModel");
const Utils = require("../config/common/utils");
const bcrypt = require('bcrypt');
const UserDepartmentPositionModel = require("../models/UserDepartmentPositionModel");
const LaborContractModel = require("../models/LaborContractModel");
const WorkScheduleModel = require("../models/WorkScheduleModel");

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
        employment_type,
      } = req.body;

      let { userDepartments = [], schedules = [] } = req.body;

      // Parse nếu là string
      if (typeof userDepartments === "string") {
        try {
          userDepartments = JSON.parse(userDepartments);
        } catch (e) {
          await session.abortTransaction();
          session.endSession();
          return res.status(400).json({ message: "Sai định dạng userDepartments" });
        }
      }

      if (typeof schedules === "string") {
        try {
          schedules = JSON.parse(schedules);
        } catch (e) {
          await session.abortTransaction();
          session.endSession();
          return res.status(400).json({ message: "Sai định dạng schedules" });
        }
      }

      // Nếu là parttime, schedules bắt buộc phải có
      if (employment_type === "parttime") {
        if (!Array.isArray(schedules) || schedules.length === 0) {
          await session.abortTransaction();
          session.endSession();
          return res.status(400).json({ message: "Schedules bắt buộc cho parttime" });
        }

        // Validate từng item và tính tổng số buổi
        let totalShifts = 0;
        for (const item of schedules) {
          if (
            typeof item.dayOfWeek !== "number" ||
            !Array.isArray(item.shifts) ||
            item.shifts.length === 0
          ) {
            await session.abortTransaction();
            session.endSession();
            return res.status(400).json({
              message:
                "Mỗi schedules phải có dayOfWeek (number) và shifts (array chứa ít nhất 1 ca)",
            });
          }
          totalShifts += item.shifts.length; // mỗi ca = 1 buổi
        }

        if (totalShifts < 6) {
          await session.abortTransaction();
          session.endSession();
          return res.status(400).json({
            message: "Parttime phải đăng ký ít nhất 6 buổi/tuần",
          });
        }
      }

      // Kiểm tra trùng CCCD
      const existingUser = await UserInfoModel.findOne({ cccd }).session(session);
      if (existingUser) {
        await session.abortTransaction();
        session.endSession();
        return res.status(400).json({ message: "Thông tin đã tồn tại" });
      }

      // Sinh mã nhân viên và tài khoản
      const stt = await UserInfoModel.countDocuments().session(session);
      const maNV = Utils.getMaNV((stt + 1).toString());
      const username = await Utils.generateUsername(full_name);
      const password = Utils.genRandomPassword();
      const salt = await bcrypt.genSalt(10);
      const hashedPassword = await bcrypt.hash(password, salt);

      // Tạo tài khoản
      const [account] = await AccountModel.create(
        [
          {
            username,
            password: hashedPassword,
          },
        ],
        { session }
      );

      // Tạo thông tin người dùng
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
            employment_type,
          },
        ],
        { session }
      );

      // Lưu tài liệu người dùng (nếu có upload)
      const files = req.files || {};
      const documents = [];

      for (const [type_id, fileArray] of Object.entries(files)) {
        const attachments = fileArray.map((f) => ({
          file_name: f.originalname,
          file_url: f.path,
          uploaded_at: new Date(),
          uploaded_by: req.account?._id || null,
          allowed_users: [userInfo._id],
        }));
        documents.push({ type_id, attachments });
      }

      if (documents.length > 0) {
        await UserDocumentModel.create(
          [
            {
              user_id: userInfo._id,
              documents,
            },
          ],
          { session }
        );
      }

      // Lưu danh sách phòng ban – vị trí
      if (userDepartments.length > 0) {
        const invalidItem = userDepartments.find(
          (item) => !item.department_id || !item.position_id
        );

        if (invalidItem) {
          await session.abortTransaction();
          session.endSession();
          return res.status(400).json({
            message: "Thiếu department_id hoặc position_id trong userDepartments",
          });
        }

        const udpDocs = userDepartments.map((item) => ({
          user: userInfo._id,
          department: item.department_id,
          position: item.position_id,
        }));

        await UserDepartmentPositionModel.insertMany(udpDocs, { session });
      }

      // Nếu là parttime → tạo WorkSchedule
      if (employment_type === "parttime") {
        const scheduleDocs = schedules.map((item) => ({
          userId: userInfo._id,
          dayOfWeek: item.dayOfWeek,
          shifts: item.shifts,
        }));
        await WorkScheduleModel.insertMany(scheduleDocs, { session });
      }

      // Commit transaction
      await session.commitTransaction();
      session.endSession();

      return res.status(201).json({
        message: "Tạo user, userInfo, documents, mapping và WorkSchedule thành công",
        account,
        firstPassword: password,
        userInfo,
      });
    } catch (err) {
      await session.abortTransaction();
      session.endSession();
      console.error("Error in createUser:", err);
      return res.status(500).json({
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
      // Lấy thông tin user cơ bản
      const user = await UserInfoModel.findOne({ id_account: req.account._id });
      if (!user) {
        return res.status(404).json({ message: "User not found" });
      }

      // Lấy danh sách phòng ban + vị trí đảm nhận
      const userDepartments = await UserDepartmentPositionModel.find({ user: user._id })
        .populate("department", "department_name department_code")
        .populate("position", "position_name");

      // Lấy danh sách hồ sơ tài liệu
      const userDocuments = await UserDocumentModel.findOne({ user_id: user._id })
        .populate("documents.type_id", "name required")
        .populate("documents.attachments.uploaded_by", "username");

      // Lấy thông tin hợp đồng lao động của user
      const laborContracts = await LaborContractModel.find({ id_user_info: user._id })
        .select("-__v") // bỏ __v nếu muốn
        .lean(); // trả về plain object

      // Chuẩn hóa dữ liệu trả về
      res.json({
        ...user.toObject(),
        departments: userDepartments.map((item) => ({
          department: item.department,
          position: item.position,
        })),
        documents: userDocuments
          ? userDocuments.documents.map((doc) => ({
            type: doc.type_id,
            note: doc.note,
            attachments: doc.attachments.map((a) => ({
              file_name: a.file_name,
              file_url: a.file_url,
              uploaded_at: a.uploaded_at,
              uploaded_by: a.uploaded_by,
            })),
          }))
          : [],
        laborContracts: laborContracts, // thêm info hợp đồng
      });
    } catch (error) {
      console.error("Error in getUserInfo:", error);
      res.status(500).json({
        message: "Internal server error",
        error: error.message,
      });
    }
  }
};

module.exports = UserController;
