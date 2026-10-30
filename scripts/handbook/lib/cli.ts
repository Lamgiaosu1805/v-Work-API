// Đọc tham số dạng `--name=value` / `--flag` cho các script nạp văn bản nội quy.

export function getArg(name: string, argv: string[] = process.argv): string | undefined {
  const prefix = `--${name}=`;
  const hit = argv.find((arg) => arg.startsWith(prefix));
  return hit ? hit.slice(prefix.length) : undefined;
}

export function requireArg(name: string, argv: string[] = process.argv): string {
  const value = getArg(name, argv);
  if (!value) throw new Error(`Thiếu tham số --${name}=...`);
  return value;
}

export function hasFlag(name: string, argv: string[] = process.argv): boolean {
  return argv.includes(`--${name}`);
}
