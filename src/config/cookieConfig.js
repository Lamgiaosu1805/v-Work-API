const isProd = process.env.NODE_ENV === "production";

const base = {
  httpOnly: true,
  secure: isProd,
  sameSite: isProd ? "strict" : "lax",
};

const accessTokenCookieOptions = {
  ...base,
  maxAge: 30 * 60 * 1000, // 30 phút
};

const refreshTokenCookieOptions = {
  ...base,
  maxAge: 3 * 24 * 60 * 60 * 1000, // 3 ngày
};

module.exports = { accessTokenCookieOptions, refreshTokenCookieOptions };
