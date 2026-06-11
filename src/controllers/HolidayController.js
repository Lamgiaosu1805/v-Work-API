const moment = require("moment-timezone");
const HolidayModel = require("../models/HolidayModel");
const BranchModel = require("../models/BranchModel");

const TZ = "Asia/Ho_Chi_Minh";

const HolidayController = {
  getHolidays: async (req, res) => {
    try {
      const year = parseInt(req.query.year) || moment.tz(TZ).year();

      const groups = await HolidayModel.aggregate([
        { $match: { year, isDeleted: false } },
        { $sort: { date: 1 } },
        {
          $group: {
            _id: "$name",
            from_date: { $min: "$date" },
            to_date: { $max: "$date" },
            duration_days: { $sum: "$duration_days" },
            scope_type: { $first: "$scope_type" },
            pay_policy: { $first: "$pay_policy" },
            branches: { $first: "$branches" },
            ids: { $push: "$_id" },
            record_count: { $sum: 1 },
          },
        },
        { $sort: { from_date: 1 } },
      ]);

      const allBranchIds = [
        ...new Set(groups.flatMap((g) => g.branches.map((b) => b.toString()))),
      ];
      const branchDocs = allBranchIds.length
        ? await BranchModel.find(
            { _id: { $in: allBranchIds } },
            "branch_name branch_code",
          )
        : [];
      const branchMap = new Map(branchDocs.map((b) => [b._id.toString(), b]));

      const data = groups.map((g) => ({
        name: g._id,
        from_date: moment.tz(g.from_date, TZ).format("YYYY-MM-DD"),
        to_date: moment.tz(g.to_date, TZ).format("YYYY-MM-DD"),
        duration_days: g.duration_days,
        scope_type: g.scope_type,
        pay_policy: g.pay_policy,
        branches: g.branches.map((b) => branchMap.get(b.toString()) || b),
        record_count: g.record_count,
        ids: g.ids,
      }));

      res.json({ message: "OK", data });
    } catch (err) {
      console.error(err);
      res.status(500).json({ message: "Lỗi server", error: err.message });
    }
  },

  createHoliday: async (req, res) => {
    try {
      const {
        date,
        name,
        duration_days = 1,
        scope_type,
        branches,
        pay_policy,
      } = req.body;
      if (!date || !name)
        return res.status(400).json({ message: "date và name là bắt buộc" });

      const startMoment = moment.tz(date, TZ).startOf("day");
      if (!startMoment.isValid())
        return res.status(400).json({ message: "date không hợp lệ" });
      if (duration_days <= 0)
        return res
          .status(400)
          .json({ message: "duration_days phải lớn hơn 0" });

      if (scope_type === "branch" && (!branches || !branches.length))
        return res
          .status(400)
          .json({
            message: "Phạm vi theo chi nhánh yêu cầu chọn ít nhất 1 chi nhánh",
          });

      const commonFields = {
        name: name.trim(),
        scope_type: scope_type || "all",
        branches: scope_type === "branch" ? branches : [],
        pay_policy: pay_policy || "paid",
      };

      if (duration_days <= 1) {
        const existing = await HolidayModel.findOne({
          date: startMoment.toDate(),
          isDeleted: false,
        });
        if (existing)
          return res.status(409).json({ message: "Ngày lễ này đã tồn tại" });

        const holiday = await HolidayModel.create({
          ...commonFields,
          date: startMoment.toDate(),
          year: startMoment.year(),
          duration_days,
        });
        const populated = await holiday.populate(
          "branches",
          "branch_name branch_code",
        );
        return res
          .status(201)
          .json({ message: "Tạo ngày lễ thành công", data: populated });
      }

      const dates = [];
      const cursor = startMoment.clone();
      while (dates.length < Math.round(duration_days)) {
        if (cursor.day() !== 0) dates.push(cursor.clone());
        cursor.add(1, "day");
      }

      const existingDates = await HolidayModel.find({
        date: {
          $gte: startMoment.toDate(),
          $lte: dates[dates.length - 1].toDate(),
        },
        isDeleted: false,
      }).select("date");
      const existingSet = new Set(
        existingDates.map((h) => moment.tz(h.date, TZ).format("YYYY-MM-DD")),
      );

      const toCreate = dates.filter(
        (d) => !existingSet.has(d.format("YYYY-MM-DD")),
      );
      const skipped = dates
        .filter((d) => existingSet.has(d.format("YYYY-MM-DD")))
        .map((d) => d.format("DD/MM/YYYY"));

      const created = await HolidayModel.insertMany(
        toCreate.map((d) => ({
          ...commonFields,
          date: d.toDate(),
          year: d.year(),
          duration_days: 1,
        })),
      );

      return res.status(201).json({
        message: `Đã tạo ${created.length} ngày lễ${skipped.length ? `, bỏ qua ${skipped.length} ngày đã tồn tại` : ""}`,
        data: { created_count: created.length, skipped_dates: skipped },
      });
    } catch (err) {
      console.error(err);
      res.status(500).json({ message: "Lỗi server", error: err.message });
    }
  },

  updateHoliday: async (req, res) => {
    try {
      const { id } = req.params;
      const { date, name, duration_days, scope_type, branches, pay_policy } =
        req.body;

      const holiday = await HolidayModel.findOne({ _id: id, isDeleted: false });
      if (!holiday)
        return res.status(404).json({ message: "Không tìm thấy ngày lễ" });

      if (date) {
        const dateMoment = moment.tz(date, TZ).startOf("day");
        if (!dateMoment.isValid())
          return res.status(400).json({ message: "date không hợp lệ" });
        const dup = await HolidayModel.findOne({
          date: dateMoment.toDate(),
          isDeleted: false,
          _id: { $ne: id },
        });
        if (dup)
          return res.status(409).json({ message: "Ngày lễ này đã tồn tại" });
        holiday.date = dateMoment.toDate();
        holiday.year = dateMoment.year();
      }
      if (name) holiday.name = name.trim();
      if (duration_days != null) holiday.duration_days = duration_days;
      if (pay_policy) holiday.pay_policy = pay_policy;
      if (scope_type) {
        if (scope_type === "branch" && (!branches || !branches.length))
          return res
            .status(400)
            .json({
              message:
                "Phạm vi theo chi nhánh yêu cầu chọn ít nhất 1 chi nhánh",
            });
        holiday.scope_type = scope_type;
        holiday.branches = scope_type === "branch" ? branches : [];
      } else if (branches) {
        holiday.branches = branches;
      }

      await holiday.save();
      const populated = await holiday.populate(
        "branches",
        "branch_name branch_code",
      );
      res.json({ message: "Cập nhật thành công", data: populated });
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
      if (!holiday)
        return res.status(404).json({ message: "Không tìm thấy ngày lễ" });
      res.json({ message: "Xóa ngày lễ thành công" });
    } catch (err) {
      console.error(err);
      res.status(500).json({ message: "Lỗi server", error: err.message });
    }
  },
};

module.exports = HolidayController;
