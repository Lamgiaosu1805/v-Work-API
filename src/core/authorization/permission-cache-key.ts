const ENV_PREFIX = (process.env.BASE_URL ?? "default").replace(/[^a-zA-Z0-9_-]/g, "_");

export function buildPermissionCacheKey(employeeId: string): string {
  return `${ENV_PREFIX}:perm:employee:${employeeId}`;
}
