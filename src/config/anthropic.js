// Adapter layer — dùng Gemini (miễn phí) hoặc Anthropic tùy biến AI_PROVIDER trong .env
// AI_PROVIDER=gemini  → Google Gemini Flash (free tier 60 req/phút)
// AI_PROVIDER=anthropic (mặc định) → Anthropic Claude Haiku

const provider = process.env.AI_PROVIDER ?? 'anthropic';

if (provider === 'gemini') {
    const { GoogleGenerativeAI } = require('@google/generative-ai');
    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

    // Wrapper tương thích API Anthropic (messages.create)
    module.exports = {
        messages: {
            create: async ({ system, messages, max_tokens, tools }) => {
                // Ghép system + messages thành prompt cho Gemini
                const history = messages.slice(0, -1).map((m) => ({
                    role: m.role === 'assistant' ? 'model' : 'user',
                    parts: Array.isArray(m.content)
                        ? m.content.map((c) =>
                            c.type === 'tool_result'
                                ? { text: `[Kết quả công cụ]: ${c.content}` }
                                : { text: c.text ?? '' }
                          )
                        : [{ text: String(m.content) }],
                }));

                const lastMsg = messages[messages.length - 1];
                const userText = Array.isArray(lastMsg.content)
                    ? lastMsg.content.map((c) => c.text ?? c.content ?? '').join('\n')
                    : String(lastMsg.content);

                // Mô tả tools thành text nếu có
                const toolsText = tools?.length
                    ? '\n\nCông cụ khả dụng:\n' + tools.map((t) =>
                        `- ${t.name}: ${t.description}`
                      ).join('\n')
                    : '';

                const model = genAI.getGenerativeModel({
                    model: 'gemini-1.5-flash',
                    systemInstruction: (system ?? '') + toolsText,
                    generationConfig: { maxOutputTokens: max_tokens ?? 600 },
                });

                const chat = model.startChat({ history });
                const result = await chat.sendMessage(userText);
                const text = result.response.text();

                return {
                    stop_reason: 'end_turn',
                    content: [{ type: 'text', text }],
                };
            },
        },
    };
} else {
    // Anthropic mặc định
    const Anthropic = require('@anthropic-ai/sdk');
    module.exports = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
}
