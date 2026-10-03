import assert from "node:assert/strict";
import test from "node:test";
import { requestUrl } from "./request-url.js";
import {
  classifyDublinBoundary,
  DUBLIN_BOUNDARY_ATTRIBUTION,
  DUBLIN_BOUNDARY_SOURCE_URL,
  loadDublinBoundary,
  type DublinBoundaryGeometry,
} from "../src/dublin-boundary.js";

const square: DublinBoundaryGeometry = {
  type: "Polygon",
  coordinates: [
    [
      [-1, -1],
      [1, -1],
      [1, 1],
      [-1, 1],
      [-1, -1],
    ],
  ],
};

const geoJsonResponse = (geometry: unknown): unknown => ({
  type: "FeatureCollection",
  features: [
    {
      type: "Feature",
      properties: { ENG_NAME_VALUE: "DUBLIN" },
      geometry,
    },
  ],
});

test("loads the official Dublin FeatureCollection through an injected fetch", async () => {
  const requestedUrls: string[] = [];
  const boundaryGeometry = {
    type: "Polygon",
    coordinates: [
      [
        [-7, 53],
        [-6, 53],
        [-6, 54],
        [-7, 54],
        [-7, 53],
      ],
    ],
  };

  const boundary = await loadDublinBoundary(async (input) => {
    requestedUrls.push(requestUrl(input));
    return new Response(JSON.stringify(geoJsonResponse(boundaryGeometry)), {
      status: 200,
      headers: { "content-type": "application/geo+json" },
    });
  });

  assert.deepEqual(requestedUrls, [DUBLIN_BOUNDARY_SOURCE_URL]);
  assert.deepEqual(boundary, boundaryGeometry);
  assert.match(DUBLIN_BOUNDARY_ATTRIBUTION, /Tailte Éireann/);
  assert.match(DUBLIN_BOUNDARY_ATTRIBUTION, /CC BY 4\.0/);
});

test("combines every Dublin feature into one multipolygon", async () => {
  const polygons = [
    {
      type: "Polygon",
      coordinates: [[[-7, 53], [-6, 53], [-6, 54], [-7, 54], [-7, 53]]],
    },
    {
      type: "Polygon",
      coordinates: [[[-6, 52], [-5, 52], [-5, 53], [-6, 53], [-6, 52]]],
    },
  ];
  const boundary = await loadDublinBoundary(async () =>
    new Response(JSON.stringify({
      type: "FeatureCollection",
      features: polygons.map((geometry) => ({
        type: "Feature",
        properties: { ENG_NAME_VALUE: "DUBLIN" },
        geometry,
      })),
    }), { status: 200 }),
  );
  assert.deepEqual(boundary, {
    type: "MultiPolygon",
    coordinates: polygons.map((polygon) => polygon.coordinates),
  });
});

test("rejects unsuccessful fetches and malformed feature geometry", async () => {
  await assert.rejects(
    loadDublinBoundary(async () => new Response("unavailable", { status: 503 })),
    /HTTP 503/,
  );

  const unclosedRing = {
    type: "Polygon",
    coordinates: [[[0, 0], [1, 0], [1, 1], [0, 1]]],
  };
  await assert.rejects(
    loadDublinBoundary(async () =>
      new Response(JSON.stringify(geoJsonResponse(unclosedRing)), { status: 200 }),
    ),
    /rings must be closed/,
  );

  await assert.rejects(
    loadDublinBoundary(async () =>
      new Response(JSON.stringify({ type: "FeatureCollection", features: [] }), {
        status: 200,
      }),
    ),
    /at least one feature/,
  );
});

test("classifies county interior and outside points with non-zero boundary distance", () => {
  const interior = classifyDublinBoundary(
    { latitude: 0, longitude: 0 },
    square,
  );
  assert.equal(interior.insideCounty, true);
  assert.equal(interior.withinDublin20Km, true);
  assert.ok(interior.nearestBoundaryDistanceKm > 100);

  const nearbyOutside = classifyDublinBoundary(
    { latitude: 0, longitude: 1.1 },
    square,
  );
  assert.equal(nearbyOutside.insideCounty, false);
  assert.equal(nearbyOutside.withinDublin20Km, true);
  assert.ok(nearbyOutside.nearestBoundaryDistanceKm > 10);
  assert.ok(nearbyOutside.nearestBoundaryDistanceKm < 12);

  const distantOutside = classifyDublinBoundary(
    { latitude: 0, longitude: 5 },
    square,
  );
  assert.equal(distantOutside.insideCounty, false);
  assert.equal(distantOutside.withinDublin20Km, false);
});

test("unwraps antimeridian rings continuously during point containment", () => {
  const antimeridianPolygon: DublinBoundaryGeometry = {
    type: "Polygon",
    coordinates: [
      [
        [179, -1],
        [-179, -1],
        [-179, 1],
        [179, 1],
        [179, -1],
      ],
    ],
  };

  const inside = classifyDublinBoundary(
    { latitude: 0, longitude: 180 },
    antimeridianPolygon,
  );
  assert.equal(inside.insideCounty, true);

  const oppositeMeridian = classifyDublinBoundary(
    { latitude: 0, longitude: 0 },
    antimeridianPolygon,
  );
  assert.equal(oppositeMeridian.insideCounty, false);
});

test("includes a point exactly 20 km away and excludes a point just beyond", () => {
  const proximityPolygon: DublinBoundaryGeometry = {
    type: "Polygon",
    coordinates: [
      [
        [0, -1],
        [0.1, -1],
        [0.1, 1],
        [0, 1],
        [0, -1],
      ],
    ],
  };
  const equatorialRadiusKm = 6_378.137;
  const longitudeForDistance = (distanceKm: number): number =>
    (distanceKm / equatorialRadiusKm) * (180 / Math.PI);

  const exactlyTwentyKm = classifyDublinBoundary(
    { latitude: 0, longitude: -longitudeForDistance(20) },
    proximityPolygon,
  );
  assert.equal(exactlyTwentyKm.insideCounty, false);
  assert.ok(Math.abs(exactlyTwentyKm.nearestBoundaryDistanceKm - 20) < 1e-7);
  assert.equal(exactlyTwentyKm.withinDublin20Km, true);

  const justOutside = classifyDublinBoundary(
    { latitude: 0, longitude: -longitudeForDistance(20.001) },
    proximityPolygon,
  );
  assert.equal(justOutside.insideCounty, false);
  assert.ok(justOutside.nearestBoundaryDistanceKm > 20);
  assert.equal(justOutside.withinDublin20Km, false);
});

test("handles Polygon holes, MultiPolygon members, and boundary points", () => {
  const polygonWithHole: DublinBoundaryGeometry = {
    type: "Polygon",
    coordinates: [
      [
        [-1, -1],
        [1, -1],
        [1, 1],
        [-1, 1],
        [-1, -1],
      ],
      [
        [-0.1, -0.1],
        [0.1, -0.1],
        [0.1, 0.1],
        [-0.1, 0.1],
        [-0.1, -0.1],
      ],
    ],
  };
  const inHole = classifyDublinBoundary(
    { latitude: 0, longitude: 0 },
    polygonWithHole,
  );
  assert.equal(inHole.insideCounty, false);
  assert.equal(inHole.withinDublin20Km, true);
  assert.ok(inHole.nearestBoundaryDistanceKm > 10);
  assert.ok(inHole.nearestBoundaryDistanceKm < 12);

  const multipolygon: DublinBoundaryGeometry = {
    type: "MultiPolygon",
    coordinates: [
      [
        [
          [0, 0],
          [1, 0],
          [1, 1],
          [0, 1],
          [0, 0],
        ],
      ],
      [
        [
          [2, 0],
          [3, 0],
          [3, 1],
          [2, 1],
          [2, 0],
        ],
      ],
    ],
  };
  const inSecondPolygon = classifyDublinBoundary(
    { latitude: 0.5, longitude: 2.5 },
    multipolygon,
  );
  assert.equal(inSecondPolygon.insideCounty, true);
  assert.ok(inSecondPolygon.nearestBoundaryDistanceKm > 20);

  const onBoundary = classifyDublinBoundary(
    { latitude: -1, longitude: 0 },
    square,
  );
  assert.equal(onBoundary.insideCounty, true);
  assert.equal(onBoundary.nearestBoundaryDistanceKm, 0);
});

test("rejects invalid or missing WGS84 coordinates and invalid geometry", () => {
  assert.throws(
    () =>
      classifyDublinBoundary(
        { latitude: 91, longitude: 0 },
        square,
      ),
    RangeError,
  );
  assert.throws(
    () =>
      classifyDublinBoundary(
        { latitude: 0, longitude: 181 },
        square,
      ),
    RangeError,
  );
  assert.throws(
    () =>
      classifyDublinBoundary(
        { latitude: 0, longitude: Number.NaN },
        square,
      ),
    TypeError,
  );
  assert.throws(
    () =>
      classifyDublinBoundary(
        undefined,
        square,
      ),
    TypeError,
  );
  assert.throws(
    () =>
      classifyDublinBoundary(
        { latitude: 0, longitude: 0 },
        { type: "Polygon", coordinates: [] },
      ),
    /at least one ring/,
  );
  assert.throws(
    () =>
      classifyDublinBoundary(
        { latitude: 0, longitude: 0 },
        {
          type: "Polygon",
          coordinates: [[[0, 0], [1, 0], [1, 1], [Number.NaN, 1], [0, 0]]],
        },
      ),
    TypeError,
  );
});
