const swaggerJSDoc = require("swagger-jsdoc");

const PORT = process.env.PORT || 2345;

const definition = {
  openapi: "3.0.3",
  info: {
    title: "vWork API",
    version: "1.0.0",
    description: "REST API hệ thống quản lý nội bộ vWork (HRM / Workplace / CRM / KPI)."
  },
  servers: [
    { url: process.env.BASE_URL || `http://localhost:${PORT}`, description: "Server hiện tại" }
  ],
  components: {
    securitySchemes: {
      bearerAuth: { type: "http", scheme: "bearer", bearerFormat: "JWT" }
    },
    schemas: {
      Error: {
        type: "object",
        properties: {
          message: { type: "string", example: "Thông báo lỗi" },
          errorCode: { type: "string", example: "FORBIDDEN" },
          error: { type: "string" }
        }
      }
    },
    responses: {
      Unauthorized: {
        description: "Thiếu / sai / hết hạn token",
        content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } }
      },
      Forbidden: {
        description: "Không đủ quyền",
        content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } }
      },
      NotFound: {
        description: "Không tìm thấy tài nguyên",
        content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } }
      },
      InvalidId: {
        description: "Id không phải ObjectId hợp lệ",
        content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } }
      }
    }
  },
  security: [{ bearerAuth: [] }],
  tags: [
    { name: "Auth", description: "Đăng nhập, refresh token, gán quyền cơ bản" },
    { name: "RBAC", description: "Quản trị phân quyền (role / permission) — admin only" },
    { name: "User", description: "Quản lý nhân viên" },
    { name: "Department", description: "Phòng ban & vị trí" },
    { name: "Attendance", description: "Chấm công" },
    { name: "Document", description: "Loại tài liệu, xem file hồ sơ" },
    { name: "Labor Contract", description: "Hợp đồng lao động" },
    { name: "Customer", description: "Khách hàng (CRM)" },
    { name: "Investment", description: "Khoản đầu tư" },
    { name: "Claim Period", description: "Kỳ claim hoa hồng" },
    { name: "Agent", description: "Đại lý" },
    { name: "Referral", description: "Giới thiệu" },
    { name: "Internal Files", description: "Ổ file nội bộ theo phòng ban" },
    { name: "Weekly Report", description: "Báo cáo tuần" },
    { name: "Notification", description: "FCM device token" },
    { name: "App", description: "App config" },
    { name: "Branch", description: "Chi nhánh" },
    { name: "Holiday", description: "Ngày lễ" },
    { name: "Employment Status", description: "Trạng thái lao động" },
    { name: "Attendance Mapping", description: "Map máy chấm công ↔ nhân viên" },
    { name: "Penalty Tier", description: "Bậc phạt đi muộn / vi phạm" },
    { name: "Print", description: "In tài liệu nội bộ" },
    { name: "Transaction Management", description: "Quản lý giao dịch / nạp tiền KH (CRM)" },
    { name: "Customer Claim Request", description: "Yêu cầu nhận khách hàng" },
    { name: "Request", description: "Đơn từ (nghỉ phép, điều chỉnh...)" },
    { name: "Post", description: "Bài đăng nội bộ (feed)" },
    { name: "AI", description: "Tính năng AI" },
    { name: "Chat", description: "Nhắn tin nội bộ" }
  ]
};

const swaggerSpec = swaggerJSDoc({
  definition,
  apis: ["./src/docs/*.yaml"]
});

module.exports = swaggerSpec;
