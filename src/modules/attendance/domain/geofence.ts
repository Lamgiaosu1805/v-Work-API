const EARTH_RADIUS_METERS = 6371000;

export interface GeoPoint {
  latitude: number;
  longitude: number;
}

function toRad(degrees: number): number {
  return (degrees * Math.PI) / 180;
}

// Port nguyên công thức haversine đang lặp lại y hệt ở checkIn/checkOut (AttendanceController.js).
export function calculateDistanceMeters(a: GeoPoint, b: GeoPoint): number {
  const dLat = toRad(b.latitude - a.latitude);
  const dLon = toRad(b.longitude - a.longitude);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.latitude)) * Math.cos(toRad(b.latitude)) * Math.sin(dLon / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
  return EARTH_RADIUS_METERS * c;
}

export function isWithinRadius(point: GeoPoint, center: GeoPoint, radiusMeters: number): boolean {
  return calculateDistanceMeters(point, center) <= radiusMeters;
}
