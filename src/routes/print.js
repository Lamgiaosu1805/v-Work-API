const express = require('express');
const router = express.Router();
const multer = require('multer');
const axios = require('axios');
const { authenticate } = require('../middlewares/authMiddleware');

const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 50 * 1024 * 1024 },
});

const PRINT_URL = process.env.PRINT_SERVICE_URL || 'https://printer-service.lamgs.io.vn';
const PRINT_SECRET = process.env.PRINT_SERVICE_SECRET;

router.get('/status', authenticate, async (_req, res) => {
    try {
        const { data } = await axios.get(`${PRINT_URL}/api/status`, {
            headers: { 'x-api-secret': PRINT_SECRET },
            timeout: 8000,
        });
        return res.json(data);
    } catch (err) {
        const status = err.response?.status || 500;
        return res.status(status).json({ message: 'Không thể kết nối máy in', error: err.message });
    }
});

router.post('/', authenticate, upload.single('file'), async (req, res) => {
    if (!req.file) return res.status(400).json({ message: 'Vui lòng chọn file để in' });

    try {
        const form = new FormData();
        form.append('file', new Blob([req.file.buffer], { type: req.file.mimetype }), req.file.originalname);
        if (req.body.copies)              form.append('copies', String(req.body.copies));
        if (req.body.duplex !== undefined) form.append('duplex', String(req.body.duplex));
        form.append('user', req.account.username);
        if (req.body.jobName)             form.append('jobName', String(req.body.jobName));

        const { data } = await axios.post(`${PRINT_URL}/api/print`, form, {
            headers: { 'x-api-secret': PRINT_SECRET },
            timeout: 30000,
        });
        return res.json(data);
    } catch (err) {
        const status = err.response?.status || 500;
        const message = err.response?.data?.message || 'Lỗi khi gửi lệnh in';
        return res.status(status).json({ message, error: err.message });
    }
});

module.exports = router;
