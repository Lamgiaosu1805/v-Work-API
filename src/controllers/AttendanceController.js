const AllowedWifiLocationModel = require("../models/AllowedWifiLocationModel");
const ShiftModel = require("../models/ShiftModel");

const AttendanceController = {
    createAllowedWifiLocation: async (req, res) => {
        try {
            const { ssid, latitude, longitude } = req.body;

            if (!ssid || !latitude || !longitude) {
                return res.status(400).json({ message: 'ssid, latitude, longitude required' });
            }

            // Kiểm tra SSID đã tồn tại chưa
            const existing = await AllowedWifiLocationModel.findOne({ ssid });
            if (existing) {
                return res.status(400).json({ message: `SSID ${ssid} đã tồn tại` });
            }

            const doc = await AllowedWifiLocationModel.create({
                ssid,
                latitude,
                longitude,
            });

            res.json({ message: "Tạo điểm chấm công thành công", data: doc });
        } catch (error) {
            console.error(error);
            res.status(500).json({ message: "Lỗi server.", error: error.message });
        }
    },
    createShift: async (req, res) => {
        try {
            const { name, start_time, end_time } = req.body;

            // Validate bắt buộc
            if (!name || !start_time || !end_time) {
                return res.status(400).json({ message: "name, start_time, end_time là bắt buộc" });
            }

            // Kiểm tra trùng tên shift
            const existing = await ShiftModel.findOne({ name });
            if (existing) {
                return res.status(400).json({ message: `Shift ${name} đã tồn tại` });
            }

            const shift = await ShiftModel.create({
                name,
                start_time,
                end_time,
                late_allowance_minutes,
            });

            return res.status(201).json({
                message: "Tạo ca làm việc thành công",
                data: shift,
            });
        } catch (err) {
            console.error(err);
            return res.status(500).json({ message: "Lỗi server", error: err.message });
        }
    },
    attendance: async (req, res) => {
        try {
            const { ssid, latitude, longitude } = req.body;

            if (!ssid || latitude == null || longitude == null) {
                return res.status(400).json({ message: "ssid, latitude, longitude required" });
            }

            // Tìm SSID trong danh sách cho phép
            const allowed = await AllowedWifiLocationModel.findOne({ ssid, isDeleted: false });
            if (!allowed) {
                return res.status(400).json({ message: "SSID không hợp lệ hoặc chưa được đăng ký." });
            }

            // Hàm tính khoảng cách Haversine
            const getDistance = (lat1, lon1, lat2, lon2) => {
                const R = 6371000;
                const toRad = x => x * Math.PI / 180;
                const dLat = toRad(lat2 - lat1);
                const dLon = toRad(lon2 - lon1);
                const a = Math.sin(dLat / 2) ** 2 +
                    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
                    Math.sin(dLon / 2) ** 2;
                const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
                return R * c;
            };

            const distance = getDistance(latitude, longitude, allowed.latitude, allowed.longitude);
            const isValid = distance <= allowed.radius;

            // Trả kết quả test
            res.json({
                message: isValid ? "Chấm công hợp lệ" : "Chấm công không hợp lệ",
                ssid,
                clientLocation: { latitude, longitude },
                allowedLocation: { latitude: allowed.latitude, longitude: allowed.longitude, radius: allowed.radius },
                distance,
                valid: isValid
            });

        } catch (error) {
            console.error(error);
            res.status(500).json({ message: "Lỗi server.", error: error.message });
        }
    }
}

module.exports = AttendanceController;
