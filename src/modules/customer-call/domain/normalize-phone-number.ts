export function normalizePhoneNumber(rawPhoneNumber: string): string {
  return rawPhoneNumber.replace(/\D/g, "");
}
