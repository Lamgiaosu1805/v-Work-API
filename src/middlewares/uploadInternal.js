const multer = require("multer");
const path = require("path");
const fs = require("fs");
const DepartmentModel = require("../models/DepartmentModel");

const getBaseDir = () => {
    const dir = process.env.NODE_ENV === "production"
        ? process.env.INTERNAL_DIR_PROD
        : process.env.INTERNAL_DIR_DEV;
    return path.resolve(dir);
};

// Tính path đầy đủ tới file, hỗ trợ subfolder
function getInternalFilePath(departmentCode, subfolder, filename) {
    if (subfolder) return path.join(getBaseDir(), departmentCode, subfolder, filename);
    return path.join(getBaseDir(), departmentCode, filename);
}

const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        DepartmentModel.findById(req.params.deptId)
            .then((dept) => {
                if (!dept || dept.isDeleted) return cb(new Error("Phòng ban không tồn tại"));
                // req.subfolder có thể được set bởi route middleware trước khi multer chạy
                const subfolder = req.subfolder || "";
                const destFolder = subfolder
                    ? path.join(getBaseDir(), dept.department_code, subfolder)
                    : path.join(getBaseDir(), dept.department_code);
                fs.mkdirSync(destFolder, { recursive: true });
                req._deptCode = dept.department_code;
                cb(null, destFolder);
            })
            .catch(cb);
    },
    filename: (req, file, cb) => {
        const uniqueSuffix = Date.now() + "-" + Math.round(Math.random() * 1e9);
        cb(null, uniqueSuffix + path.extname(file.originalname));
    },
});

const uploadInternal = multer({
    storage,
    limits: { fileSize: 50 * 1024 * 1024 }, // 50MB
});

module.exports = { uploadInternal, getInternalFilePath };
