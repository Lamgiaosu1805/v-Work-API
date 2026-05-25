const moment = require("moment-timezone");
const HolidayModel = require("../models/HolidayModel");

const TZ = "Asia/Ho_Chi_Minh";

const HolidayController = {
    getHolidays: async (req, res) => {
        try {
            const year = parseInt(req.query.year) || moment.tz(TZ).year();
            const holidays = await HolidayModel.find({ year, isDeleted: false }).sort({ date: 1 });
            res.json({ message: "OK", data: holidays });
        } catch (err) {
            console.error(err);
            res.status(500).json({ message: "Lỗi server", error: err.message });
        }
    },

    createHoliday: async (req, res) => {
        try {
            const { date, name } = req.body;
            if (!date || !name)
                return res.status(400).json({ message: "date và name là bắt buộc" });

            const dateMoment = moment.tz(date, TZ).startOf("day");
            if (!dateMoment.isValid())
                return res.status(400).json({ message: "date không hợp lệ" });

            const existing = await HolidayModel.findOne({ date: dateMoment.toDate(), isDeleted: false });
            if (existing)
                return res.status(409).json({ message: "Ngày lễ này đã tồn tại" });

            const holiday = await HolidayModel.create({
                date: dateMoment.toDate(),
                name: name.trim(),
                year: dateMoment.year(),
            });
            res.status(201).json({ message: "Tạo ngày lễ thành công", data: holiday });
        } catch (err) {
            console.error(err);
            res.status(500).json({ message: "Lỗi server", error: err.message });
        }
    },

    updateHoliday: async (req, res) => {
        try {
            const { id } = req.params;
            const { date, name } = req.body;

            const holiday = await HolidayModel.findOne({ _id: id, isDeleted: false });
            if (!holiday) return res.status(404).json({ message: "Không tìm thấy ngày lễ" });

            if (date) {
                const dateMoment = moment.tz(date, TZ).startOf("day");
                if (!dateMoment.isValid())
                    return res.status(400).json({ message: "date không hợp lệ" });
                const dup = await HolidayModel.findOne({ date: dateMoment.toDate(), isDeleted: false, _id: { $ne: id } });
                if (dup) return res.status(409).json({ message: "Ngày lễ này đã tồn tại" });
                holiday.date = dateMoment.toDate();
                holiday.year = dateMoment.year();
            }
            if (name) holiday.name = name.trim();

            await holiday.save();
            res.json({ message: "Cập nhật thành công", data: holiday });
        } catch (err) {
            console.error(err);
            res.status(500).json({ message: "Lỗi server", error: err.message });
        }
    },

    deleteHoliday: async (req, res) => {
        try {
            const { id } = req.params;
            const holiday = await HolidayModel.findOneAndUpdate(
                { _id: id, isDeleted: false },
                { isDeleted: true },
                { new: true },
            );
            if (!holiday) return res.status(404).json({ message: "Không tìm thấy ngày lễ" });
            res.json({ message: "Xóa ngày lễ thành công" });
        } catch (err) {
            console.error(err);
            res.status(500).json({ message: "Lỗi server", error: err.message });
        }
    },
};

module.exports = HolidayController;
