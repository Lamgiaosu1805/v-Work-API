// middlewares/verifyInternalRequest.js
const ALLOWED_CLIENTS = [
    {
        api_key: process.env.TIKLUY_API_KEY,
        allowed_ips: process.env.TIKLUY_ALLOWED_IPS?.split(",").map(ip => ip.trim()) ?? [],
        app_code: "tikluy",
    },
    // Thêm app khác vào đây
];

const verifyInternalRequest = (req, res, next) => {
    // Lấy IP thật từ x-forwarded-for do Traefik inject
    const forwardedFor = req.headers["x-forwarded-for"];
    const clientIp = forwardedFor
        ? forwardedFor.split(",")[0].trim()
        : req.socket.remoteAddress;
    const apiKey = req.headers["x-api-key"];

    console.log(`[verifyInternalRequest] IP: ${clientIp} | Key: ${apiKey}`);

    if (!apiKey) {
        return res.status(401).json({ message: "Thiếu API key" });
    }

    const client = ALLOWED_CLIENTS.find(c => c.api_key === apiKey);

    if (!client) {
        return res.status(401).json({ message: "API key không hợp lệ" });
    }

    if (!client.allowed_ips.includes(clientIp)) {
        console.warn(`[verifyInternalRequest] IP bị từ chối: ${clientIp}`);
        return res.status(403).json({ message: "IP không được phép truy cập" });
    }

    req.client = client;
    next();
};

module.exports = verifyInternalRequest;