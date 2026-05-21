const anthropic = require('../config/anthropic');
const redis = require('../config/redis');
const CustomerModel = require('../models/CustomerModel');
const InvestmentModel = require('../models/InvestmentModel');
const UserInfoModel = require('../models/UserInfoModel');
const dayjs = require('dayjs');

// ─── Helpers ────────────────────────────────────────────────────────────────

const formatMoney = (v) => {
    if (!v) return '0 đ';
    if (v >= 1_000_000_000) return `${(v / 1_000_000_000).toFixed(1)} tỷ đ`;
    if (v >= 1_000_000) return `${Math.round(v / 1_000_000)} triệu đ`;
    return v.toLocaleString('vi-VN') + ' đ';
};

const formatTerm = (value, type) =>
    type === 'month' ? `${value} tháng` : `${value} ngày`;

const STATUS_VI = {
    active: 'đang chạy',
    matured: 'đã đáo hạn',
    cancelled: 'đã hủy',
    renewed: 'đã tái tục',
    early_terminated: 'tất toán sớm',
};

// ─── Feature A: Tóm tắt hồ sơ khách hàng ────────────────────────────────────

const SUMMARY_SYSTEM_PROMPT = `Bạn là trợ lý CRM thông minh của vWork.
Tóm tắt hồ sơ khách hàng dưới đây trong 3-5 câu ngắn gọn bằng tiếng Việt.
Tập trung vào: tổng giá trị đầu tư, xu hướng (tăng trưởng/ổn định/thụt lùi), sản phẩm ưa thích, và đề xuất hành động follow-up cụ thể cho nhân viên.
Văn phong chuyên nghiệp, súc tích. KHÔNG giải thích thêm, KHÔNG dùng danh sách bullet.`;

exports.customerSummary = async (req, res) => {
    const { customerId } = req.params;
    const cacheKey = `ai:customer_summary:${customerId}`;

    try {
        // Trả cache nếu còn hạn
        const cached = await redis.get(cacheKey);
        if (cached) return res.json({ summary: cached, cached: true });

        // Lấy dữ liệu tối thiểu cần thiết
        const [customer, investments] = await Promise.all([
            CustomerModel.findOne({ _id: customerId, isDeleted: false })
                .select('identity.full_name identity.date_of_birth status source_type createdAt phone_number')
                .lean(),
            InvestmentModel.find({ customer_id: customerId, isDeleted: false })
                .select('product_name amount term_type term_value interest_rate invested_at maturity_at status')
                .sort({ invested_at: -1 })
                .limit(10)
                .lean(),
        ]);

        if (!customer) return res.status(404).json({ message: 'Không tìm thấy khách hàng' });

        const name = customer.identity?.full_name ?? customer.phone_number ?? 'Khách hàng';
        const age = customer.identity?.date_of_birth
            ? dayjs().diff(dayjs(customer.identity.date_of_birth), 'year') + ' tuổi'
            : 'không rõ tuổi';

        const totalActive = investments
            .filter(i => i.status === 'active')
            .reduce((s, i) => s + (i.amount || 0), 0);

        const invSummary = investments.map(i =>
            `${i.product_name} | ${formatMoney(i.amount)} | kỳ hạn ${formatTerm(i.term_value, i.term_type)} | lãi ${i.interest_rate}%/năm | ${STATUS_VI[i.status] ?? i.status} | đáo hạn ${dayjs(i.maturity_at).format('DD/MM/YYYY')}`
        ).join('\n');

        const prompt = `Khách hàng: ${name}, ${age}, trạng thái KYC: ${customer.status}, nguồn: ${customer.source_type}, tham gia: ${dayjs(customer.createdAt).format('DD/MM/YYYY')}
Tổng đầu tư đang chạy: ${formatMoney(totalActive)}
Số khoản đầu tư: ${investments.length}
${invSummary ? `\nChi tiết khoản đầu tư (mới nhất trước):\n${invSummary}` : 'Chưa có khoản đầu tư nào.'}`;

        const response = await anthropic.messages.create({
            model: 'claude-haiku-4-5',
            max_tokens: 350,
            system: SUMMARY_SYSTEM_PROMPT,
            messages: [{ role: 'user', content: prompt }],
        });

        const summary = response.content[0].text.trim();

        // Cache 1 tiếng
        await redis.set(cacheKey, summary, 'EX', 3600);

        res.json({ summary, cached: false });
    } catch (err) {
        console.log('AiController.customerSummary error:', err.message);
        res.status(500).json({ message: 'Lỗi khi tạo tóm tắt AI', error: err.message });
    }
};

// ─── Feature B: Phát hiện khách hàng có nguy cơ rời bỏ ──────────────────────

exports.getChurnRisks = async (req, res) => {
    const cacheKey = 'ai:churn_risks';
    try {
        const cached = await redis.get(cacheKey);
        if (cached) return res.json(JSON.parse(cached));

        const result = await _computeChurnRisks();
        await redis.set(cacheKey, JSON.stringify(result), 'EX', 86400); // cache 24h
        res.json(result);
    } catch (err) {
        console.log('AiController.getChurnRisks error:', err.message);
        res.status(500).json({ message: 'Lỗi khi tải danh sách rủi ro', error: err.message });
    }
};

// Được gọi cả từ API lẫn cron job
const _computeChurnRisks = async () => {
    const thresholdDays = 90;
    const cutoff = dayjs().subtract(thresholdDays, 'day').toDate();

    // Tìm khách hàng active nhưng không có đầu tư nào trong 90 ngày
    const atRiskCustomers = await CustomerModel.aggregate([
        { $match: { status: 'active', isDeleted: false } },
        {
            $lookup: {
                from: 'investments',
                let: { cid: '$_id' },
                pipeline: [
                    { $match: { $expr: { $eq: ['$customer_id', '$$cid'] }, isDeleted: false } },
                    { $sort: { invested_at: -1 } },
                    { $limit: 1 },
                    { $project: { invested_at: 1, status: 1, amount: 1 } },
                ],
                as: 'lastInvestment',
            },
        },
        {
            $match: {
                $or: [
                    { lastInvestment: { $size: 0 } }, // chưa đầu tư lần nào
                    { 'lastInvestment.0.invested_at': { $lt: cutoff } }, // lần cuối > 90 ngày
                ],
            },
        },
        {
            $project: {
                _id: 1,
                phone_number: 1,
                'identity.full_name': 1,
                status: 1,
                createdAt: 1,
                lastInvestedAt: { $arrayElemAt: ['$lastInvestment.invested_at', 0] },
                lastAmount: { $arrayElemAt: ['$lastInvestment.amount', 0] },
            },
        },
        { $sort: { lastInvestedAt: 1 } },
        { $limit: 50 },
    ]);

    return {
        total: atRiskCustomers.length,
        thresholdDays,
        customers: atRiskCustomers.map(c => ({
            _id: c._id,
            name: c.identity?.full_name ?? c.phone_number,
            phone_number: c.phone_number,
            daysSinceLastInvestment: c.lastInvestedAt
                ? dayjs().diff(dayjs(c.lastInvestedAt), 'day')
                : null,
            lastAmount: c.lastAmount ?? 0,
            neverInvested: !c.lastInvestedAt,
            joinedAt: c.createdAt,
        })),
    };
};

exports._computeChurnRisks = _computeChurnRisks;


// ─── Feature C: Chatbot CRM với tool use ─────────────────────────────────────

const CHAT_SYSTEM_PROMPT = `Bạn là trợ lý CRM thông minh của vWork, hỗ trợ nhân viên bán hàng tra cứu thông tin khách hàng và đầu tư.
Luôn trả lời bằng tiếng Việt, ngắn gọn và chuyên nghiệp.
Khi cần tra cứu dữ liệu, hãy dùng công cụ được cung cấp. Không đoán mò số liệu.
Nếu không tìm thấy thông tin, hãy nói rõ thay vì bịa ra.`;

const CHAT_TOOLS = [
    {
        name: 'search_customer',
        description: 'Tìm kiếm khách hàng theo tên hoặc số điện thoại',
        input_schema: {
            type: 'object',
            properties: {
                query: { type: 'string', description: 'Tên hoặc số điện thoại khách hàng' },
            },
            required: ['query'],
        },
    },
    {
        name: 'get_investments',
        description: 'Lấy danh sách khoản đầu tư của một khách hàng',
        input_schema: {
            type: 'object',
            properties: {
                customer_id: { type: 'string', description: 'ID khách hàng' },
            },
            required: ['customer_id'],
        },
    },
    {
        name: 'get_expiring_investments',
        description: 'Lấy các khoản đầu tư sắp đáo hạn trong N ngày tới (của nhân viên hiện tại)',
        input_schema: {
            type: 'object',
            properties: {
                days: { type: 'number', description: 'Số ngày tới cần kiểm tra (mặc định 30)' },
            },
        },
    },
];

// Thực thi tool call từ Claude
const executeTool = async (toolName, toolInput, saleId) => {
    if (toolName === 'search_customer') {
        const q = toolInput.query?.trim();
        const isPhone = /^[0-9+]+$/.test(q);
        const query = { isDeleted: false, status: { $ne: 'blocked' } };

        if (isPhone) {
            query.phone_number = { $regex: q, $options: 'i' };
        } else {
            query['identity.full_name'] = { $regex: q, $options: 'i' };
        }

        // Sale chỉ thấy khách của mình
        if (saleId) query.referred_by = saleId;

        const customers = await CustomerModel.find(query)
            .select('_id phone_number identity.full_name status source_type createdAt')
            .limit(5).lean();

        if (!customers.length) return 'Không tìm thấy khách hàng phù hợp.';

        return customers.map(c =>
            `ID: ${c._id} | Tên: ${c.identity?.full_name ?? 'Chưa KYC'} | SĐT: ${c.phone_number} | Trạng thái: ${c.status}`
        ).join('\n');
    }

    if (toolName === 'get_investments') {
        const investments = await InvestmentModel.find({
            customer_id: toolInput.customer_id,
            isDeleted: false,
        })
            .select('product_name amount term_type term_value interest_rate invested_at maturity_at status')
            .sort({ invested_at: -1 })
            .limit(10).lean();

        if (!investments.length) return 'Khách hàng chưa có khoản đầu tư nào.';

        const total = investments.filter(i => i.status === 'active').reduce((s, i) => s + i.amount, 0);

        return `Tổng đang chạy: ${formatMoney(total)}\n` +
            investments.map(i =>
                `• ${i.product_name} | ${formatMoney(i.amount)} | ${formatTerm(i.term_value, i.term_type)} | ${i.interest_rate}%/năm | ${STATUS_VI[i.status] ?? i.status} | đáo hạn ${dayjs(i.maturity_at).format('DD/MM/YYYY')}`
            ).join('\n');
    }

    if (toolName === 'get_expiring_investments') {
        const days = toolInput.days ?? 30;
        const now = new Date();
        const until = dayjs().add(days, 'day').toDate();

        const matchStage = { status: 'active', isDeleted: false, maturity_at: { $gte: now, $lte: until } };
        if (saleId) matchStage['commission.sale_id'] = saleId;

        const investments = await InvestmentModel.find(matchStage)
            .populate({ path: 'customer_id', select: 'identity.full_name phone_number' })
            .select('product_name amount maturity_at customer_id')
            .sort({ maturity_at: 1 })
            .limit(20).lean();

        if (!investments.length) return `Không có khoản đầu tư nào đáo hạn trong ${days} ngày tới.`;

        return investments.map(i => {
            const c = i.customer_id;
            const daysLeft = dayjs(i.maturity_at).diff(dayjs(), 'day');
            return `• ${c?.identity?.full_name ?? c?.phone_number ?? '?'} | ${i.product_name} | ${formatMoney(i.amount)} | đáo hạn sau ${daysLeft} ngày (${dayjs(i.maturity_at).format('DD/MM/YYYY')})`;
        }).join('\n');
    }

    return 'Công cụ không hợp lệ.';
};

exports.chat = async (req, res) => {
    const { messages } = req.body; // [{ role: 'user'|'assistant', content: string }]

    if (!messages?.length) return res.status(400).json({ message: 'messages không được rỗng' });

    try {
        // Lấy UserInfo để lọc data theo sale
        const userInfo = await UserInfoModel.findOne({ id_account: req.account._id }).select('_id').lean();
        const saleId = (req.account.role === 'user') ? userInfo?._id : null;

        // Chuyển messages sang format Anthropic
        const anthropicMessages = messages.map(m => ({ role: m.role, content: m.content }));

        let response = await anthropic.messages.create({
            model: 'claude-haiku-4-5',
            max_tokens: 600,
            system: CHAT_SYSTEM_PROMPT,
            tools: CHAT_TOOLS,
            messages: anthropicMessages,
        });

        // Agentic loop: thực thi tool calls cho đến khi có text response
        while (response.stop_reason === 'tool_use') {
            const toolUses = response.content.filter(b => b.type === 'tool_use');
            const toolResults = await Promise.all(
                toolUses.map(async (tu) => ({
                    type: 'tool_result',
                    tool_use_id: tu.id,
                    content: await executeTool(tu.name, tu.input, saleId),
                }))
            );

            // Gửi lại kết quả tool cho Claude
            response = await anthropic.messages.create({
                model: 'claude-haiku-4-5',
                max_tokens: 600,
                system: CHAT_SYSTEM_PROMPT,
                tools: CHAT_TOOLS,
                messages: [
                    ...anthropicMessages,
                    { role: 'assistant', content: response.content },
                    { role: 'user', content: toolResults },
                ],
            });
        }

        const reply = response.content.find(b => b.type === 'text')?.text ?? 'Không có phản hồi.';
        res.json({ reply });
    } catch (err) {
        console.log('AiController.chat error:', err.message);
        res.status(500).json({ message: 'Lỗi chatbot AI', error: err.message });
    }
};
