export const DUBLIN_BOUNDARY_SOURCE_URL =
  "https://services-eu1.arcgis.com/FH5XCsx8rYXqnjF5/arcgis/rest/services/National_Statutory_Boundaries_-_Counties_Ungeneralised_-_2026/FeatureServer/1/query?where=ENG_NAME_VALUE%3D%27DUBLIN%27&outFields=ENG_NAME_VALUE&returnGeometry=true&outSR=4326&f=geojson";

export const DUBLIN_BOUNDARY_ATTRIBUTION =
  "County boundary data © Tailte Éireann, licensed under CC BY 4.0.";

const DUBLIN_PROXIMITY_KM = 20;
const DEGREES_TO_RADIANS = Math.PI / 180;
const RADIANS_TO_DEGREES = 180 / Math.PI;
const WGS84_SEMI_MAJOR_AXIS_METRES = 6_378_137;
const WGS84_FLATTENING = 1 / 298.257223563;
const WGS84_SEMI_MINOR_AXIS_METRES =
  WGS84_SEMI_MAJOR_AXIS_METRES * (1 - WGS84_FLATTENING);
const MEAN_EARTH_RADIUS_KM = 6_371.0088;

type DublinBoundaryPosition = readonly [
  longitude: number,
  latitude: number,
  ...additionalOrdinates: number[],
];
type DublinBoundaryLinearRing = readonly DublinBoundaryPosition[];
type DublinBoundaryPolygonCoordinates = readonly DublinBoundaryLinearRing[];

export type DublinBoundaryGeometry =
  | {
      readonly type: "Polygon";
      readonly coordinates: DublinBoundaryPolygonCoordinates;
    }
  | {
      readonly type: "MultiPolygon";
      readonly coordinates: readonly DublinBoundaryPolygonCoordinates[];
    };

export interface Wgs84Coordinates {
  readonly latitude: number;
  readonly longitude: number;
}

export interface DublinBoundaryClassification {
  readonly insideCounty: boolean;
  readonly nearestBoundaryDistanceKm: number;
  readonly withinDublin20Km: boolean;
}

type RingRelation = "outside" | "inside" | "boundary";

interface NearestBoundaryPoint {
  bestAngularDistance: number;
  longitude: number;
  latitude: number;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

function parsePosition(value: unknown): DublinBoundaryPosition {
  if (!Array.isArray(value) || value.length < 2) {
    throw new TypeError("Dublin boundary positions must contain longitude and latitude.");
  }

  const coordinates: number[] = [];
  for (const ordinate of value) {
    if (typeof ordinate !== "number" || !Number.isFinite(ordinate)) {
      throw new TypeError("Dublin boundary positions must contain finite numbers.");
    }
    coordinates.push(ordinate);
  }

  const longitude = coordinates[0];
  const latitude = coordinates[1];
  if (
    longitude === undefined ||
    latitude === undefined ||
    longitude < -180 ||
    longitude > 180 ||
    latitude < -90 ||
    latitude > 90
  ) {
    throw new RangeError("Dublin boundary positions must use valid WGS84 coordinates.");
  }
  const position: DublinBoundaryPosition = [
    longitude,
    latitude,
    ...coordinates.slice(2),
  ];
  return position;
}

function parseLinearRing(value: unknown): DublinBoundaryLinearRing {
  if (!Array.isArray(value) || value.length < 4) {
    throw new TypeError("Dublin boundary rings must contain at least four positions.");
  }
  const positions: DublinBoundaryPosition[] = [];
  for (const position of value) { positions.push(parsePosition(position)); }
  const first = positions.at(0);
  const last = positions.at(-1);
  if (first === undefined || last === undefined || first.length !== last.length) {
    throw new TypeError("Dublin boundary rings must be closed.");
  }
  for (let index = 0; index < first.length; index += 1) {
    if (first[index] !== last[index]) {
      throw new TypeError("Dublin boundary rings must be closed.");
    }
  }

  let secondDistinctPosition: DublinBoundaryPosition | undefined;
  let hasThirdDistinctPosition = false;
  for (const candidate of positions) {
    if (candidate[0] === first[0] && candidate[1] === first[1]) { continue; }
    if (secondDistinctPosition === undefined) {
      secondDistinctPosition = candidate;
      continue;
    }
    if (
      candidate[0] !== secondDistinctPosition[0] ||
      candidate[1] !== secondDistinctPosition[1]
    ) {
      hasThirdDistinctPosition = true;
    }
  }
  if (secondDistinctPosition === undefined || !hasThirdDistinctPosition) {
    throw new TypeError("Dublin boundary rings must contain at least three distinct positions.");
  }
  return positions;
}

function parsePolygonCoordinates(value: unknown): DublinBoundaryPolygonCoordinates {
  if (!Array.isArray(value) || value.length === 0) {
    throw new TypeError("Dublin boundary polygons must contain at least one ring.");
  }
  const rings: DublinBoundaryLinearRing[] = [];
  for (const ring of value) { rings.push(parseLinearRing(ring)); }
  return rings;
}

function validateBoundaryGeometry(value: unknown): DublinBoundaryGeometry {
  if (!isRecord(value)) {
    throw new TypeError("Dublin boundary geometry must be a GeoJSON geometry object.");
  }

  const type = value["type"];
  const coordinates = value["coordinates"];
  if (type === "Polygon") {
    return { type, coordinates: parsePolygonCoordinates(coordinates) };
  }
  if (type === "MultiPolygon") {
    if (!Array.isArray(coordinates) || coordinates.length === 0) {
      throw new TypeError("Dublin boundary multipolygons must contain at least one polygon.");
    }
    const polygons: DublinBoundaryPolygonCoordinates[] = [];
    for (const polygon of coordinates) {
      polygons.push(parsePolygonCoordinates(polygon));
    }
    return { type, coordinates: polygons };
  }
  throw new TypeError("Dublin boundary geometry must be a Polygon or MultiPolygon.");
}

export async function loadDublinBoundary(
  fetchImpl: typeof fetch,
): Promise<DublinBoundaryGeometry> {
  const response = await fetchImpl(DUBLIN_BOUNDARY_SOURCE_URL);
  if (!response.ok) {
    throw new Error(`Dublin boundary request failed with HTTP ${response.status}.`);
  }

  const payload = JSON.parse(await response.text()) as unknown;
  if (!isRecord(payload) || payload["type"] !== "FeatureCollection") {
    throw new TypeError("Dublin boundary response must be a GeoJSON FeatureCollection.");
  }
  const features = payload["features"];
  if (!Array.isArray(features) || features.length === 0) {
    throw new TypeError("Dublin boundary response must contain at least one feature.");
  }

  const polygons: DublinBoundaryPolygonCoordinates[] = [];
  for (const value of features) {
    if (!isRecord(value) || value["type"] !== "Feature") {
      throw new TypeError("Dublin boundary response contains an invalid feature.");
    }
    const properties = value["properties"];
    if (
      !isRecord(properties) ||
      typeof properties["ENG_NAME_VALUE"] !== "string" ||
      properties["ENG_NAME_VALUE"].trim().toUpperCase() !== "DUBLIN"
    ) {
      throw new TypeError("Dublin boundary response does not identify County Dublin.");
    }
    const geometry = validateBoundaryGeometry(value["geometry"]);
    if (geometry.type === "Polygon") {
      polygons.push(geometry.coordinates);
    } else {
      polygons.push(...geometry.coordinates);
    }
  }
  const onlyPolygon = polygons.at(0);
  if (polygons.length === 1 && onlyPolygon !== undefined) {
    return { type: "Polygon", coordinates: onlyPolygon };
  }
  return { type: "MultiPolygon", coordinates: polygons };

}
function validateCoordinates(value: unknown): Wgs84Coordinates {
  if (!isRecord(value)) {
    throw new TypeError("Coordinates must provide WGS84 latitude and longitude.");
  }
  const latitude = value["latitude"];
  const longitude = value["longitude"];
  if (
    typeof latitude !== "number" ||
    typeof longitude !== "number" ||
    !Number.isFinite(latitude) ||
    !Number.isFinite(longitude)
  ) {
    throw new TypeError("Latitude and longitude must be finite numbers.");
  }
  if (
    latitude < -90 ||
    latitude > 90 ||
    longitude < -180 ||
    longitude > 180
  ) {
    throw new RangeError("Coordinates must be within the WGS84 latitude and longitude ranges.");
  }
  return { latitude, longitude };
}

function shortestLongitudeDelta(from: number, to: number): number {
  return ((to - from + 540) % 360) - 180;
}

function isPointOnCoordinateSegment(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
): boolean {
  const deltaX = x2 - x1;
  const deltaY = y2 - y1;
  const lengthSquared = deltaX * deltaX + deltaY * deltaY;
  if (lengthSquared === 0) {
    return Math.hypot(x1, y1) <= 1e-12;
  }

  const projection = -(x1 * deltaX + y1 * deltaY) / lengthSquared;
  if (projection < 0 || projection > 1) {
    return false;
  }
  const crossProduct = x1 * deltaY - y1 * deltaX;
  const tolerance = 1e-9 * Math.sqrt(lengthSquared) + 1e-12;
  return Math.abs(crossProduct) <= tolerance;
}

// County boundary vertices are short segments; project each onto a great-circle arc,
// then measure the selected point with the WGS84 ellipsoidal inverse.

function updateNearestSphericalPoint(
  pointX: number,
  pointY: number,
  pointZ: number,
  start: DublinBoundaryPosition,
  end: DublinBoundaryPosition,
  nearest: NearestBoundaryPoint,
): void {
  const startLongitude = start[0] * DEGREES_TO_RADIANS;
  const startLatitude = start[1] * DEGREES_TO_RADIANS;
  const endLongitude = end[0] * DEGREES_TO_RADIANS;
  const endLatitude = end[1] * DEGREES_TO_RADIANS;
  const startX = Math.cos(startLatitude) * Math.cos(startLongitude);
  const startY = Math.cos(startLatitude) * Math.sin(startLongitude);
  const startZ = Math.sin(startLatitude);
  const endX = Math.cos(endLatitude) * Math.cos(endLongitude);
  const endY = Math.cos(endLatitude) * Math.sin(endLongitude);
  const endZ = Math.sin(endLatitude);

  const normalX = startY * endZ - startZ * endY;
  const normalY = startZ * endX - startX * endZ;
  const normalZ = startX * endY - startY * endX;
  const normalLength = Math.hypot(normalX, normalY, normalZ);

  let closestX = startX;
  let closestY = startY;
  let closestZ = startZ;
  let closestLongitude = start[0];
  let closestLatitude = start[1];

  if (normalLength > 1e-15) {
    const unitNormalX = normalX / normalLength;
    const unitNormalY = normalY / normalLength;
    const unitNormalZ = normalZ / normalLength;
    const pointNormal =
      pointX * unitNormalX + pointY * unitNormalY + pointZ * unitNormalZ;
    const projectedX = pointX - pointNormal * unitNormalX;
    const projectedY = pointY - pointNormal * unitNormalY;
    const projectedZ = pointZ - pointNormal * unitNormalZ;
    const projectedLength = Math.hypot(projectedX, projectedY, projectedZ);

    if (projectedLength > 1e-15) {
      const candidateX = projectedX / projectedLength;
      const candidateY = projectedY / projectedLength;
      const candidateZ = projectedZ / projectedLength;
      const startCandidateX = startY * candidateZ - startZ * candidateY;
      const startCandidateY = startZ * candidateX - startX * candidateZ;
      const startCandidateZ = startX * candidateY - startY * candidateX;
      const candidateEndX = candidateY * endZ - candidateZ * endY;
      const candidateEndY = candidateZ * endX - candidateX * endZ;
      const candidateEndZ = candidateX * endY - candidateY * endX;
      const followsSegment =
        startCandidateX * unitNormalX +
          startCandidateY * unitNormalY +
          startCandidateZ * unitNormalZ >=
          -1e-14 &&
        candidateEndX * unitNormalX +
          candidateEndY * unitNormalY +
          candidateEndZ * unitNormalZ >=
          -1e-14;

      if (followsSegment) {
        closestX = candidateX;
        closestY = candidateY;
        closestZ = candidateZ;
        closestLongitude =
          Math.atan2(candidateY, candidateX) * RADIANS_TO_DEGREES;
        closestLatitude =
          Math.atan2(candidateZ, Math.hypot(candidateX, candidateY)) *
          RADIANS_TO_DEGREES;
      } else if (
        pointX * endX + pointY * endY + pointZ * endZ >
        pointX * startX + pointY * startY + pointZ * startZ
      ) {
        closestX = endX;
        closestY = endY;
        closestZ = endZ;
        closestLongitude = end[0];
        closestLatitude = end[1];
      }
    } else if (
      pointX * endX + pointY * endY + pointZ * endZ >
      pointX * startX + pointY * startY + pointZ * startZ
    ) {
      closestX = endX;
      closestY = endY;
      closestZ = endZ;
      closestLongitude = end[0];
      closestLatitude = end[1];
    }
  } else if (
    pointX * endX + pointY * endY + pointZ * endZ >
    pointX * startX + pointY * startY + pointZ * startZ
  ) {
    closestX = endX;
    closestY = endY;
    closestZ = endZ;
    closestLongitude = end[0];
    closestLatitude = end[1];
  }

  const cosine = Math.max(
    -1,
    Math.min(1, pointX * closestX + pointY * closestY + pointZ * closestZ),
  );
  const crossX = pointY * closestZ - pointZ * closestY;
  const crossY = pointZ * closestX - pointX * closestZ;
  const crossZ = pointX * closestY - pointY * closestX;
  const angularDistance = Math.atan2(Math.hypot(crossX, crossY, crossZ), cosine);
  if (angularDistance < nearest.bestAngularDistance) {
    nearest.bestAngularDistance = angularDistance;
    nearest.longitude = closestLongitude;
    nearest.latitude = closestLatitude;
  }
}

function inspectRing(
  ring: DublinBoundaryLinearRing,
  pointLongitude: number,
  pointLatitude: number,
  pointX: number,
  pointY: number,
  pointZ: number,
  nearest: NearestBoundaryPoint,
): RingRelation {
  const anchor = ring.at(0);
  if (anchor === undefined) { throw new TypeError("Dublin boundary rings cannot be empty."); }
  const anchorLongitude = anchor[0];
  const pointXFromAnchor = shortestLongitudeDelta(
    anchorLongitude,
    pointLongitude,
  );
  let startX = 0;
  let isInside = false;
  let isBoundary = false;

  for (let index = 0; index < ring.length - 1; index += 1) {
    const start = ring.at(index);
    const end = ring.at(index + 1);
    if (start === undefined || end === undefined) {
      throw new TypeError("Dublin boundary ring segments must have two endpoints.");
    }
    const endX = startX + shortestLongitudeDelta(start[0], end[0]);
    const relativeStartX = startX - pointXFromAnchor;
    const relativeEndX = endX - pointXFromAnchor;
    const startY = start[1] - pointLatitude;
    const endY = end[1] - pointLatitude;

    if (
      isPointOnCoordinateSegment(
        relativeStartX,
        startY,
        relativeEndX,
        endY,
      )
    ) {
      isBoundary = true;
      nearest.bestAngularDistance = 0;
      nearest.longitude = pointLongitude;
      nearest.latitude = pointLatitude;
    }

    if ((startY > 0) !== (endY > 0)) {
      const crossingLongitude =
        relativeStartX +
        ((-startY) * (relativeEndX - relativeStartX)) / (endY - startY);
      if (crossingLongitude > 0) {isInside = !isInside;}
    }

    updateNearestSphericalPoint(pointX, pointY, pointZ, start, end, nearest);
    startX = endX;
  }

  if (isBoundary) {return "boundary";}
  return isInside ? "inside" : "outside";
}

function polygonContainsPoint(
  rings: DublinBoundaryPolygonCoordinates,
  pointLongitude: number,
  pointLatitude: number,
  pointX: number,
  pointY: number,
  pointZ: number,
  nearest: NearestBoundaryPoint,
): boolean {
  const outerRing = rings.at(0);
  if (outerRing === undefined) { throw new TypeError("Dublin boundary polygons cannot be empty."); }
  const outerRelation = inspectRing(
    outerRing,
    pointLongitude,
    pointLatitude,
    pointX,
    pointY,
    pointZ,
    nearest,
  );
  let liesInHole = false;
  let liesOnHoleBoundary = false;
  for (let index = 1; index < rings.length; index += 1) {
    const ring = rings.at(index);
    if (ring === undefined) { throw new TypeError("Dublin boundary rings cannot be sparse."); }
    const relation = inspectRing(
      ring,
      pointLongitude,
      pointLatitude,
      pointX,
      pointY,
      pointZ,
      nearest,
    );
    if (relation === "inside") {liesInHole = true;}
    if (relation === "boundary") {liesOnHoleBoundary = true;}
  }

  if (outerRelation === "outside") {return false;}
  if (outerRelation === "boundary") {return true;}
  return !liesInHole || liesOnHoleBoundary;
}

function haversineDistanceKm(
  longitude1: number,
  latitude1: number,
  longitude2: number,
  latitude2: number,
): number {
  const latitude1Radians = latitude1 * DEGREES_TO_RADIANS;
  const latitude2Radians = latitude2 * DEGREES_TO_RADIANS;
  const latitudeDelta = (latitude2 - latitude1) * DEGREES_TO_RADIANS;
  const longitudeDelta =
    shortestLongitudeDelta(longitude1, longitude2) * DEGREES_TO_RADIANS;
  const haversine =
    Math.sin(latitudeDelta / 2) ** 2 +
    Math.cos(latitude1Radians) *
      Math.cos(latitude2Radians) *
      Math.sin(longitudeDelta / 2) ** 2;
  const centralAngle =
    2 * Math.atan2(Math.sqrt(haversine), Math.sqrt(Math.max(0, 1 - haversine)));
  return centralAngle * MEAN_EARTH_RADIUS_KM;
}

// Vincenty's inverse is precise for local distances; antipodal cases use a spherical fallback.

function geodesicDistanceKm(
  longitude1: number,
  latitude1: number,
  longitude2: number,
  latitude2: number,
): number {
  if (longitude1 === longitude2 && latitude1 === latitude2) {return 0;}

  const semiMajor = WGS84_SEMI_MAJOR_AXIS_METRES;
  const semiMinor = WGS84_SEMI_MINOR_AXIS_METRES;
  const flattening = WGS84_FLATTENING;
  const latitude1Radians = latitude1 * DEGREES_TO_RADIANS;
  const latitude2Radians = latitude2 * DEGREES_TO_RADIANS;
  const longitudeDifference =
    shortestLongitudeDelta(longitude1, longitude2) * DEGREES_TO_RADIANS;
  const reducedLatitude1 = Math.atan((1 - flattening) * Math.tan(latitude1Radians));
  const reducedLatitude2 = Math.atan((1 - flattening) * Math.tan(latitude2Radians));
  const sinReducedLatitude1 = Math.sin(reducedLatitude1);
  const cosReducedLatitude1 = Math.cos(reducedLatitude1);
  const sinReducedLatitude2 = Math.sin(reducedLatitude2);
  const cosReducedLatitude2 = Math.cos(reducedLatitude2);

  let longitude = longitudeDifference;
  let sinSigma = 0;
  let cosSigma = 0;
  let sigma = 0;
  let sinAzimuth: number;
  let cosSquaredAzimuth = 0;
  let cosDoubleSigmaMiddle = 0;
  let converged = false;

  for (let iteration = 0; iteration < 100; iteration += 1) {
    const sinLongitude = Math.sin(longitude);
    const cosLongitude = Math.cos(longitude);
    const firstTerm = cosReducedLatitude2 * sinLongitude;
    const secondTerm =
      cosReducedLatitude1 * sinReducedLatitude2 -
      sinReducedLatitude1 * cosReducedLatitude2 * cosLongitude;
    sinSigma = Math.hypot(firstTerm, secondTerm);
    if (sinSigma === 0) {return 0;}
    cosSigma =
      sinReducedLatitude1 * sinReducedLatitude2 +
      cosReducedLatitude1 * cosReducedLatitude2 * cosLongitude;
    sigma = Math.atan2(sinSigma, cosSigma);
    sinAzimuth =
      (cosReducedLatitude1 * cosReducedLatitude2 * sinLongitude) / sinSigma;
    cosSquaredAzimuth = 1 - sinAzimuth * sinAzimuth;
    cosDoubleSigmaMiddle =
      cosSquaredAzimuth > 1e-15
        ? cosSigma -
          (2 * sinReducedLatitude1 * sinReducedLatitude2) / cosSquaredAzimuth
        : 0;
    const coefficient =
      (flattening / 16) *
      cosSquaredAzimuth *
      (4 + flattening * (4 - 3 * cosSquaredAzimuth));
    const nextLongitude =
      longitudeDifference +
      (1 - coefficient) *
        flattening *
        sinAzimuth *
        (sigma +
          coefficient *
            sinSigma *
            (cosDoubleSigmaMiddle +
              coefficient *
                cosSigma *
                (-1 + 2 * cosDoubleSigmaMiddle * cosDoubleSigmaMiddle)));
    if (!Number.isFinite(nextLongitude)) {break;}
    if (Math.abs(nextLongitude - longitude) < 1e-12) {

      converged = true;
      break;
    }
    longitude = nextLongitude;
  }

  if (!converged) {
    return haversineDistanceKm(longitude1, latitude1, longitude2, latitude2);
  }

  const squaredReducedAxisDifference =
    cosSquaredAzimuth *
    (semiMajor * semiMajor - semiMinor * semiMinor) /
    (semiMinor * semiMinor);
  const seriesA =
    1 +
    (squaredReducedAxisDifference / 16384) *
      (4096 +
        squaredReducedAxisDifference *
          (-768 + squaredReducedAxisDifference * (320 - 175 * squaredReducedAxisDifference)));
  const seriesB =
    (squaredReducedAxisDifference / 1024) *
    (256 +
      squaredReducedAxisDifference *
        (-128 + squaredReducedAxisDifference * (74 - 47 * squaredReducedAxisDifference)));
  const deltaSigma =
    seriesB *
    sinSigma *
    (cosDoubleSigmaMiddle +
      (seriesB / 4) *
        (cosSigma *
          (-1 + 2 * cosDoubleSigmaMiddle * cosDoubleSigmaMiddle) -
          (seriesB / 6) *
            cosDoubleSigmaMiddle *
            (-3 + 4 * sinSigma * sinSigma) *
            (-3 + 4 * cosDoubleSigmaMiddle * cosDoubleSigmaMiddle)));
  return (semiMinor * seriesA * (sigma - deltaSigma)) / 1_000;
}

export function classifyDublinBoundary(
  coordinates: unknown,
  geometry: unknown,
): DublinBoundaryClassification {
  const point = validateCoordinates(coordinates);
  const boundary = validateBoundaryGeometry(geometry);
  const pointLongitude = point.longitude;
  const pointLatitude = point.latitude;
  const longitudeRadians = pointLongitude * DEGREES_TO_RADIANS;
  const latitudeRadians = pointLatitude * DEGREES_TO_RADIANS;
  const pointX = Math.cos(latitudeRadians) * Math.cos(longitudeRadians);
  const pointY = Math.cos(latitudeRadians) * Math.sin(longitudeRadians);
  const pointZ = Math.sin(latitudeRadians);
  const nearest: NearestBoundaryPoint = {
    bestAngularDistance: Number.POSITIVE_INFINITY,
    longitude: pointLongitude,
    latitude: pointLatitude,
  };

  let insideCounty = false;
  if (boundary.type === "Polygon") {
    insideCounty = polygonContainsPoint(
      boundary.coordinates,
      pointLongitude,
      pointLatitude,
      pointX,
      pointY,
      pointZ,
      nearest,
    );
  } else {
    for (const polygon of boundary.coordinates) {
      if (
        polygonContainsPoint(
          polygon,
          pointLongitude,
          pointLatitude,
          pointX,
          pointY,
          pointZ,
          nearest,
        )
      ) {
        insideCounty = true;
      }
    }
  }

  const nearestBoundaryDistanceKm =
    nearest.bestAngularDistance === 0
      ? 0
      : geodesicDistanceKm(
          pointLongitude,
          pointLatitude,
          nearest.longitude,
          nearest.latitude,
        );
  return {
    insideCounty,
    nearestBoundaryDistanceKm,
    withinDublin20Km: insideCounty || nearestBoundaryDistanceKm <= DUBLIN_PROXIMITY_KM,
  };
}
