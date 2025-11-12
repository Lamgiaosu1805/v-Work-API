const AllowedWifiLocationModel = require("../models/AllowedWifiLocationModel");
const ShiftModel = require("../models/ShiftModel");
const UserInfoModel = require("../models/UserInfoModel");
const WorkSheetModel = require("../models/WorkSheetModel");
const moment = require("moment-timezone");

const AttendanceController = {
    createAllowedWifiLocation: async (req, res) => {
        try {
            const { ssid, latitude, longitude } = req.body;
            if (!ssid || !latitude || !longitude) {
                return res.status(400).json({ message: 'ssid, latitude, longitude required' });
            }

            const existing = await AllowedWifiLocationModel.findOne({ ssid });
            if (existing) {
                return res.status(400).json({ message: `SSID ${ssid} đã tồn tại` });
            }

            const doc = await AllowedWifiLocationModel.create({ ssid, latitude, longitude });
            res.json({ message: "Tạo điểm chấm công thành công", data: doc });
        } catch (error) {
            console.error(error);
            res.status(500).json({ message: "Lỗi server.", error: error.message });
        }
    },

    createShift: async (req, res) => {
        try {
            const { name, start_time, end_time, late_allowance_minutes = 0 } = req.body;
            if (!name || !start_time || !end_time) {
                return res.status(400).json({ message: "name, start_time, end_time là bắt buộc" });
            }

            const existing = await ShiftModel.findOne({ name });
            if (existing) return res.status(400).json({ message: `Shift ${name} đã tồn tại` });

            const shift = await ShiftModel.create({ name, start_time, end_time, late_allowance_minutes });
            return res.status(201).json({ message: "Tạo ca làm việc thành công", data: shift });
        } catch (err) {
            console.error(err);
            return res.status(500).json({ message: "Lỗi server", error: err.message });
        }
    },

    checkIn: async (req, res) => {
        try {
            const { ssid, latitude, longitude } = req.body;
            if (!ssid || latitude == null || longitude == null)
                return res.status(400).json({ message: "ssid, latitude, longitude required" });

            const allowed = await AllowedWifiLocationModel.findOne({ ssid, isDeleted: false });
            if (!allowed) return res.status(400).json({ message: "SSID không hợp lệ." });

            // Kiểm tra khoảng cách
            const R = 6371000;
            const toRad = x => x * Math.PI / 180;
            const dLat = toRad(latitude - allowed.latitude);
            const dLon = toRad(longitude - allowed.longitude);
            const a = Math.sin(dLat / 2) ** 2 +
                Math.cos(toRad(latitude)) * Math.cos(toRad(allowed.latitude)) *
                Math.sin(dLon / 2) ** 2;
            const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
            const distance = R * c;
            if (distance > allowed.radius)
                return res.status(400).json({ message: "Vị trí không hợp lệ." });

            const accountId = req.account._id;
            const userInfo = await UserInfoModel.findOne({ id_account: accountId });
            if (!userInfo) return res.status(400).json({ message: "User info không tồn tại" });

            // Xác định ngày hôm nay theo VN timezone
            const today = moment.tz("Asia/Ho_Chi_Minh").startOf("day").toDate();
            const tomorrow = moment(today).add(1, "day").toDate();

            // Lấy worksheet
            const worksheet = await WorkSheetModel.findOne({
                user_id: userInfo._id,
                date: { $gte: today, $lt: tomorrow },
            }).populate("shifts");

            if (!worksheet) return res.status(400).json({ message: "Bạn chưa có ca làm việc hôm nay." });
            if (worksheet.check_in) return res.status(400).json({ message: "Bạn đã check-in hôm nay rồi." });

            // Lấy ca đầu tiên
            const firstShiftId = worksheet.shifts[0];
            const firstShift = await ShiftModel.findById(firstShiftId);
            if (!firstShift) return res.status(400).json({ message: "Không tìm thấy thông tin ca làm việc." });

            // Tính số phút đi muộn
            const now = moment.tz("Asia/Ho_Chi_Minh").toDate();
            const [h, m] = firstShift.start_time.split(":").map(Number);
            const shiftStart = moment.tz(today, "Asia/Ho_Chi_Minh").hour(h).minute(m).toDate();
            const lateMinutes = Math.max(0, Math.floor((now - shiftStart) / 60000) - firstShift.late_allowance_minutes);

            worksheet.check_in = now;
            worksheet.minutes_late = lateMinutes;
            worksheet.status = "pending";
            await worksheet.save();

            return res.json({ message: "Check-in thành công", check_in: worksheet.check_in, minutes_late: worksheet.minutes_late });
        } catch (err) {
            console.error(err);
            return res.status(500).json({ message: "Lỗi server", error: err.message });
        }
    },

    checkOut: async (req, res) => {
        try {
            const { ssid, latitude, longitude } = req.body;
            if (!ssid || latitude == null || longitude == null)
                return res.status(400).json({ message: "ssid, latitude, longitude required" });

            const allowed = await AllowedWifiLocationModel.findOne({ ssid, isDeleted: false });
            if (!allowed) return res.status(400).json({ message: "SSID không hợp lệ." });

            const R = 6371000;
            const toRad = x => x * Math.PI / 180;
            const dLat = toRad(latitude - allowed.latitude);
            const dLon = toRad(longitude - allowed.longitude);
            const a = Math.sin(dLat / 2) ** 2 +
                Math.cos(toRad(latitude)) * Math.cos(toRad(allowed.latitude)) *
                Math.sin(dLon / 2) ** 2;
            const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
            const distance = R * c;
            if (distance > allowed.radius)
                return res.status(400).json({ message: "Vị trí không hợp lệ." });

            const accountId = req.account._id;
            const userInfo = await UserInfoModel.findOne({ id_account: accountId });
            if (!userInfo) return res.status(400).json({ message: "User info không tồn tại" });

            // Ngày hôm nay VN
            const today = moment.tz("Asia/Ho_Chi_Minh").startOf("day").toDate();
            const tomorrow = moment(today).add(1, "day").toDate();

            let worksheet = await WorkSheetModel.findOne({
                user_id: userInfo._id,
                date: { $gte: today, $lt: tomorrow }
            }).populate("shifts");

            if (!worksheet) {
                const shifts = await ShiftModel.find({});
                worksheet = new WorkSheetModel({
                    user_id: userInfo._id,
                    date: moment.tz("Asia/Ho_Chi_Minh").toDate(),
                    shifts: shifts.map(s => s._id),
                });
            }

            if (worksheet.check_out) return res.status(400).json({ message: "Bạn đã check-out hôm nay rồi." });

            // Lấy ca cuối để tính về sớm
            let shifts = worksheet.shifts.length ? worksheet.shifts : await ShiftModel.find({});
            if (!worksheet.shifts.length) worksheet.shifts = shifts.map(s => s._id);

            const lastShift = shifts[shifts.length - 1];
            const [h, m] = lastShift.end_time.split(":").map(Number);
            const shiftEnd = moment.tz(today, "Asia/Ho_Chi_Minh").hour(h).minute(m).toDate();

            const now = moment.tz("Asia/Ho_Chi_Minh").toDate();
            worksheet.check_out = now;
            worksheet.minute_early = Math.max(0, Math.floor((shiftEnd - now) / 60000));

            await worksheet.save();

            return res.json({ message: "Check-out thành công", check_out: worksheet.check_out, minute_early: worksheet.minute_early });
        } catch (err) {
            console.error(err);
            return res.status(500).json({ message: "Lỗi server", error: err.message });
        }
    },

    getWorkSheet: async (req, res) => {
        try {
            const targetDate = req.query.date
                ? moment.tz(req.query.date, "Asia/Ho_Chi_Minh").startOf("day").toDate()
                : moment.tz("Asia/Ho_Chi_Minh").startOf("day").toDate();

            const nextDate = moment(targetDate).add(1, "day").toDate();

            const user = await UserInfoModel.findOne({ id_account: req.account._id });
            if (!user) return res.status(404).json({ message: "Không tìm thấy thông tin nhân viên" });

            const worksheets = await WorkSheetModel.find({
                user_id: user._id,
                date: { $gte: targetDate, $lt: nextDate },
            })
                .populate("user_id", "full_name ma_nv employment_type")
                .populate("shifts", "name start_time end_time late_allowance_minutes");

            res.json({
                message: `WorkSheet ngày ${moment(targetDate).format("DD/MM/YYYY")}`,
                data: worksheets,
            });
        } catch (err) {
            console.error(err);
            res.status(500).json({ message: "Lỗi server", error: err.message });
        }
    }
};

module.exports = AttendanceController;
