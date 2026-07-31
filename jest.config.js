module.exports = {
  testEnvironment: "node",
  roots: ["<rootDir>/__tests__"],
  testMatch: ["<rootDir>/__tests__/**/*.test.js", "<rootDir>/__tests__/**/*.test.ts"],
  transform: {
    "^.+\\.tsx?$": ["ts-jest", { tsconfig: "tsconfig.test.json" }]
  },
  moduleNameMapper: {
    "config/redis$": "<rootDir>/__tests__/mocks/redis.js"
  },
  testTimeout: 30000,
  clearMocks: true
};
