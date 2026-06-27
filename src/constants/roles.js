const ROLE = Object.freeze({
  ADMIN: "admin",
  MANAGER: "manager",
  USER: "user"
});

const ROLE_VALUES = Object.values(ROLE);

module.exports = { ROLE, ROLE_VALUES };
