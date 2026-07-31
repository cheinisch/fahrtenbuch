const EARTH_RADIUS_METERS = 6_371_000;

function radians(value) {
  return (Number(value) * Math.PI) / 180;
}

export function haversineDistance(a, b) {
  const latitude1 = radians(a.lat);
  const latitude2 = radians(b.lat);
  const deltaLatitude = latitude2 - latitude1;
  const deltaLongitude = radians(b.lon) - radians(a.lon);

  const value =
    Math.sin(deltaLatitude / 2) ** 2 +
    Math.cos(latitude1) *
      Math.cos(latitude2) *
      Math.sin(deltaLongitude / 2) ** 2;

  return 2 * EARTH_RADIUS_METERS * Math.asin(Math.sqrt(value));
}

export function routeDistance(points) {
  let total = 0;

  for (let index = 1; index < points.length; index += 1) {
    total += haversineDistance(points[index - 1], points[index]);
  }

  return Math.round(total);
}
