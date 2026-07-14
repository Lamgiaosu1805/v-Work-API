const redis = require("../config/redis");

const LOG_KEY = "omicall:webhook:logs";
const LOG_LIMIT = 50;

const OmicallController = {
  callHooks: async (req, res) => {
    try {
      const entry = {
        receivedAt: new Date().toISOString(),
        body: req.body,
        query: req.query
      };
      console.log("[Omicall webhook]", JSON.stringify(entry));

      await redis.lpush(LOG_KEY, JSON.stringify(entry));
      await redis.ltrim(LOG_KEY, 0, LOG_LIMIT - 1);

      return res.status(200).json({ message: "OK" });
    } catch (error) {
      console.error("Error in Omicall callHooks:", error);
      return res.status(200).json({ message: "OK" });
    }
  },

  getLogs: async (req, res) => {
    try {
      const raw = await redis.lrange(LOG_KEY, 0, LOG_LIMIT - 1);
      const logs = raw.map((item) => JSON.parse(item));
      return res.status(200).json({ message: "OK", data: logs });
    } catch (error) {
      console.error("Error in Omicall getLogs:", error);
      return res.status(500).json({ message: "Internal server error", error: error.message });
    }
  }
};

module.exports = OmicallController;
