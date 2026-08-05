const IS_PROD = process.env.NODE_ENV === "production";

function serializeMeta(meta) {
  if (!meta) return "";
  try {
    return ` ${JSON.stringify(meta)}`;
  } catch {
    return " [meta không serialize được]";
  }
}

function print(level, message, meta) {
  const timestamp = new Date().toISOString();
  const line = `[${timestamp}] [${level}] ${message}${serializeMeta(meta)}`;
  if (level === "ERROR" || level === "WARN") {
    console.error(line);
  } else {
    console.log(line);
  }
}

const logger = {
  info(message, meta) {
    print("INFO", message, meta);
  },
  warn(message, meta) {
    print("WARN", message, meta);
  },
  error(message, meta) {
    print("ERROR", message, meta);
  },
  debug(message, meta) {
    if (!IS_PROD) print("DEBUG", message, meta);
  }
};

module.exports = logger;
