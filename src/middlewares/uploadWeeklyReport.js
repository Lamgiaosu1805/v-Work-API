const multer = require("multer");
const path = require("path");
const fs = require("fs");
const DepartmentModel = require("../models/DepartmentModel");
const { getInternalFilePath } = require("./uploadInternal");

const SUBFOLDER = "weekly-reports";

const getBaseDir = () => {
    const dir = process.env.NODE_ENV === "production"
        ? process.env.INTERNAL_DIR_PROD
        : process.env.INTERNAL_DIR_DEV;
    return path.resolve(dir);
};

const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        DepartmentModel.findById(req.params.deptId)
            .then((dept) => {
                if (!dept || dept.isDeleted) return cb(new Error("Phòng ban không tồn tại"));
                const destFolder = path.join(getBaseDir(), dept.department_code, SUBFOLDER);
                fs.mkdirSync(destFolder, { recursive: true });
                req._deptCode = dept.department_code;
                req._subfolder = SUBFOLDER;
                cb(null, destFolder);
            })
            .catch(cb);
    },
    filename: (req, file, cb) => {
        const uniqueSuffix = Date.now() + "-" + Math.round(Math.random() * 1e9);
        cb(null, uniqueSuffix + path.extname(file.originalname));
    },
});

const uploadWeeklyReport = multer({
    storage,
    limits: { fileSize: 50 * 1024 * 1024 }, // 50MB
});

module.exports = { uploadWeeklyReport, WEEKLY_REPORT_SUBFOLDER: SUBFOLDER };
