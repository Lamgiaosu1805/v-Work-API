const express = require('express');
const router = express.Router();
const multer = require('multer');
const axios = require('axios');
const { authenticate } = require('../middlewares/authMiddleware');
const PrintJobModel = require('../models/PrintJobModel');

const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 50 * 1024 * 1024 },
});

const PRINT_URL    = process.env.PRINT_SERVICE_URL || 'https://printer-service.lamgs.io.vn';
const PRINT_SECRET = process.env.PRINT_SERVICE_SECRET;

// GET /print/status — health check, không đụng máy in
router.get('/status', authenticate, async (_req, res) => {
    try {
        const { data } = await axios.get(`${PRINT_URL}/health`, { timeout: 8000 });
        return res.json(data);
    } catch (err) {
        const status = err.response?.status || 500;
        return res.status(status).json({ message: 'Không thể kết nối dịch vụ in', error: err.message });
    }
});

// POST /print — gửi lệnh in
router.post('/', authenticate, upload.single('file'), async (req, res) => {
    if (!req.file) return res.status(400).json({ message: 'Vui lòng chọn file để in' });

    const { copies, duplex, paperSize, orientation, pageRange, fitToPage, jobName } = req.body;
    // Multer nhận UTF-8 bytes nhưng interpret là Latin-1 — decode lại đúng charset
    const filename = Buffer.from(req.file.originalname, 'latin1').toString('utf8');

    try {
        const form = new FormData();
        form.append('file', new Blob([req.file.buffer], { type: req.file.mimetype }), filename);

        if (copies)                 form.append('copies',      String(copies));
        if (duplex !== undefined)   form.append('duplex',      String(duplex));
        if (paperSize)              form.append('paperSize',   String(paperSize));
        if (orientation)            form.append('orientation', String(orientation));
        if (pageRange)              form.append('pageRange',   String(pageRange));
        if (fitToPage !== undefined) form.append('fitToPage',  String(fitToPage));
        form.append('user', req.account.username);
        if (jobName)                form.append('jobName',     String(jobName));

        const { data } = await axios.post(`${PRINT_URL}/api/print`, form, {
            headers: { 'x-api-secret': PRINT_SECRET },
            timeout: 30000,
        });

        // Tính totalSheets nếu service không trả về
        const pagesNum   = parseInt(data.pages)  || 0;
        const copiesNum  = parseInt(copies)       || 1;
        const isDuplex   = String(duplex) === 'true';
        const totalSheets = data.totalSheets != null
            ? data.totalSheets
            : isDuplex
                ? Math.ceil(pagesNum / 2) * copiesNum
                : pagesNum * copiesNum;

        // Lưu lịch sử
        await PrintJobModel.create({
            account:     req.account._id,
            username:    req.account.username,
            filename,
            pages:       pagesNum,
            copies:      copiesNum,
            duplex:      isDuplex,
            totalSheets,
            paperSize:   paperSize   || 'A4',
            orientation: orientation || 'portrait',
            pageRange:   pageRange   || 'all',
        });

        return res.json({ ...data, pages: pagesNum, totalSheets });
    } catch (err) {
        const status  = err.response?.status || 500;
        const message = err.response?.data?.message || 'Lỗi khi gửi lệnh in';
        return res.status(status).json({ message, error: err.message });
    }
});

// GET /print/history — lịch sử in của chính user
router.get('/history', authenticate, async (req, res) => {
    try {
        const page  = Math.max(1, parseInt(req.query.page)  || 1);
        const limit = Math.min(50, parseInt(req.query.limit) || 20);
        const skip  = (page - 1) * limit;

        const [jobs, total] = await Promise.all([
            PrintJobModel.find({ account: req.account._id, isDeleted: false })
                .sort({ createdAt: -1 })
                .skip(skip)
                .limit(limit)
                .lean(),
            PrintJobModel.countDocuments({ account: req.account._id, isDeleted: false }),
        ]);

        return res.json({ data: jobs, total, page, limit });
    } catch (err) {
        return res.status(500).json({ message: 'Lỗi khi lấy lịch sử in', error: err.message });
    }
});

// GET /print/stats — tổng số tờ + lần in của chính user
router.get('/stats', authenticate, async (req, res) => {
    try {
        const [result] = await PrintJobModel.aggregate([
            { $match: { account: req.account._id, isDeleted: false } },
            {
                $group: {
                    _id:         null,
                    totalSheets: { $sum: '$totalSheets' },
                    totalJobs:   { $sum: 1 },
                },
            },
        ]);

        return res.json({
            totalSheets: result?.totalSheets ?? 0,
            totalJobs:   result?.totalJobs   ?? 0,
        });
    } catch (err) {
        return res.status(500).json({ message: 'Lỗi khi lấy thống kê in', error: err.message });
    }
});

module.exports = router;
