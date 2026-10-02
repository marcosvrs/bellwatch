import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import * as Effect from "effect/Effect";
import { createStateStore } from "../src/state.js";
import type {
  DiscoveryCandidate,
  SourcedFinding,
} from "../src/listings.js";

const finding = {
  id: "101",
  title: "Example",
  developmentTitle: "Example",
  priceText: "€315,000",
  url: "https://www.daft.ie/new-home-for-sale/example/101",
};

test("SQLite state survives reopening and persists initialization separately", async () => {
  const directory = await mkdtemp(join(tmpdir(), "bellwatch-"));
  const file = join(directory, "state.sqlite");
  try {
    const first = await Effect.runPromise(createStateStore({ file }));
    assert.equal(await Effect.runPromise(first.isInitialized()), false);
    await Effect.runPromise(first.markSeen(finding));
    await Effect.runPromise(
      first.markSeen({ ...finding, id: "daft:101" }, "eircode:D01AB12"),
    );
    assert.equal(
      await Effect.runPromise(first.isSeen("myhome:101", "eircode:D01AB12")),
      true,
    );
    assert.equal(await Effect.runPromise(first.isSeen("myhome:102", "other")), false);
    assert.equal(await Effect.runPromise(first.isInitialized()), false);
    assert.equal(await Effect.runPromise(first.isSeen("101")), true);
    assert.equal(await Effect.runPromise(first.isSeen("102")), false);
    await Effect.runPromise(first.markInitialized());
    assert.equal(await Effect.runPromise(first.isInitialized()), true);
    await Effect.runPromise(first.close());

    const second = await Effect.runPromise(createStateStore({ file }));
    assert.equal(await Effect.runPromise(second.isInitialized()), true);
    assert.equal(await Effect.runPromise(second.isSeen("101")), true);
    assert.equal(
      await Effect.runPromise(second.isSeen("myhome:101", "eircode:D01AB12")),
      true,
    );
    await Effect.runPromise(second.close());
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("stores source-keyed current listings and only meaningful dated changes", async () => {
  const directory = await mkdtemp(join(tmpdir(), "bellwatch-inventory-"));
  const file = join(directory, "state.sqlite");
  const daftListing: SourcedFinding = {
    source: "daft",
    sourceId: "101",
    latitude: 53.35,
    longitude: -6.26,
    finding: {
      ...finding,
      bedrooms: 3,
      propertyType: "Semi-Detached House",
      floorSizeSqm: 110,
      eircode: "D01 AB12",
    },
  };
  const myhomeListing: SourcedFinding = {
    source: "myhome",
    sourceId: "101",
    finding: {
      ...finding,
      url: "https://www.myhome.ie/residential/example/101",
      bedrooms: 3,
      propertyType: "Semi detached house",
      eircode: "D01 AB12",
    },
  };
  const unlinkedListing: SourcedFinding = {
    source: "daft",
    sourceId: "unlinked-102",
    finding: {
      ...finding,
      id: "unlinked-102",
      title: "Unverified house details",
      url: "https://www.daft.ie/new-home-for-sale/example/102",
    },
  };
  const candidate: DiscoveryCandidate = {
    source: "searxng",
    verified: false,
    url: "https://example.test/new-home",
    title: "Unverified development",
    snippet: "Possible new home",
    engine: "test",
    discoveredAt: "2026-10-01T09:00:00.000Z",
  };

  try {
    const first = await Effect.runPromise(createStateStore({ file }));
    await Effect.runPromise(first.observeFinding(daftListing));
    await Effect.runPromise(first.observeFinding(myhomeListing));
    await Effect.runPromise(first.observeFinding(unlinkedListing));
    await Effect.runPromise(first.observeFinding(daftListing));
    await Effect.runPromise(
      first.observeFinding({
        ...daftListing,
        finding: { ...daftListing.finding, priceText: "POA" },
      }),
    );
    await Effect.runPromise(first.recordCandidate(candidate));
    await Effect.runPromise(first.recordCandidate(candidate));
    await Effect.runPromise(
      first.recordCandidate({ ...candidate, snippet: "Updated possible home" }),
    );
    await Effect.runPromise(
      first.recordRegistrationEvent("daft:101", {
        status: "confirmed",
        consentStatus: "consented",
        evidence: "User confirmed the HTB registration page.",
        recordedAt: "2026-10-01T09:30:00.000Z",
      }),
    );
    await Effect.runPromise(first.recordRegistrationEvent("daft:101", {
      status: "unconfirmed",
      consentStatus: "unknown",
      evidence: "Eligibility confirmation is pending.",
      recordedAt: "2026-10-01T09:31:00.000Z",
    }));
    await Effect.runPromise(first.recordRegistrationEvent("daft:101", {
      status: "failed",
      consentStatus: "declined",
      evidence: "Provider rejected the application.",
      recordedAt: "2026-10-01T09:32:00.000Z",
    }));
    await Effect.runPromise(first.recordRegistrationEvent("daft:101", {
      status: "skipped",
      consentStatus: "not-applicable",
      evidence: "Registration was not applicable to this property.",
      recordedAt: "2026-10-01T09:33:00.000Z",
    }));

    const daftKey = "daft:101";
    const myhomeKey = "myhome:101";
    const currentDaft = await Effect.runPromise(first.getCurrentListing(daftKey));
    assert.ok(currentDaft);
    const listings = await Effect.runPromise(first.listCurrentListings());
    assert.deepEqual(
      listings.map((listing) => listing.bellwatchKey).sort(),
      [daftKey, "daft:unlinked-102", myhomeKey].sort(),
    );
    const firstListing = listings.at(0);
    assert.ok(firstListing);
    assert.equal(currentDaft.finding.priceText, "POA");
    assert.equal(currentDaft.finding.url, finding.url);
    assert.equal(currentDaft.latitude, 53.35);
    assert.equal(currentDaft.firstSeenAt, firstListing.firstSeenAt);
    assert.ok(Date.parse(currentDaft.lastSeenAt) >= Date.parse(currentDaft.firstSeenAt));
    assert.equal(
      (await Effect.runPromise(first.getCurrentListing(myhomeKey)))?.latitude,
      undefined,
    );
    assert.equal(
      (await Effect.runPromise(first.getCurrentListing(daftKey)))?.canonicalGroupKey,
      (await Effect.runPromise(first.getCurrentListing(myhomeKey)))?.canonicalGroupKey,
    );
    const unlinked = await Effect.runPromise(
      first.getCurrentListing("daft:unlinked-102"),
    );
    assert.equal(unlinked?.canonicalGroupKey, undefined);
    assert.equal(unlinked?.latitude, undefined);

    const observations = await Effect.runPromise(
      first.listListingObservations(daftKey),
    );
    const firstObservation = observations.at(0);
    assert.ok(firstObservation);
    assert.ok(Number.isFinite(Date.parse(firstObservation.observedAt)));
    assert.deepEqual(
      observations.map((observation) => observation.listing.finding.priceText),
      ["€315,000", "POA"],
    );
    const currentCandidates = await Effect.runPromise(
      first.listCurrentCandidates(),
    );
    const currentCandidate = currentCandidates.at(0);
    assert.ok(currentCandidate);
    assert.equal(currentCandidate.candidateKey, "searxng:https://example.test/new-home");
    assert.equal(
      (await Effect.runPromise(
        first.listCandidateObservations(currentCandidate.candidateKey),
      )).length,
      2,
    );
    const registrations = await Effect.runPromise(
      first.listRegistrationEvents(daftKey),
    );
    assert.equal(registrations.length, 4);
    assert.deepEqual(
      registrations.map((event) => event.status),
      ["confirmed", "unconfirmed", "failed", "skipped"],
    );
    assert.deepEqual(
      registrations.map((event) => event.consentStatus),
      ["consented", "unknown", "declined", "not-applicable"],
    );
    assert.equal(registrations[0]?.evidence, "User confirmed the HTB registration page.");
    await Effect.runPromise(first.close());

    const second = await Effect.runPromise(createStateStore({ file }));
    const reopened = await Effect.runPromise(second.getCurrentListing(daftKey));
    assert.equal(reopened?.finding.priceText, "POA");
    assert.equal(reopened.firstSeenAt, currentDaft.firstSeenAt);
    assert.equal(
      (await Effect.runPromise(second.listListingObservations(daftKey))).length,
      2,
    );
    assert.equal(
      (await Effect.runPromise(second.listRegistrationEvents(daftKey))).length,
      4,
    );
    const reopenedOutbox = await Effect.runPromise(
      second.listPendingBaserowListings(),
    );
    assert.deepEqual(
      reopenedOutbox.map((row) => row.bellwatchKey).sort(),
      ["daft:101", "daft:unlinked-102", "myhome:101"],
    );
    assert.ok(reopenedOutbox.every((row) => row.rowId === null && row.revision > 0));
    await Effect.runPromise(second.close());
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
test("migrates existing registration history to explicit consent state", async () => {
  const directory = await mkdtemp(join(tmpdir(), "bellwatch-registration-migration-"));
  const file = join(directory, "state.sqlite");
  const legacy = new DatabaseSync(file);
  legacy.exec(`
    CREATE TABLE registration_events (
      event_id TEXT PRIMARY KEY,
      bellwatch_key TEXT NOT NULL,
      status TEXT NOT NULL,
      evidence TEXT NOT NULL,
      recorded_at TEXT NOT NULL
    );
    INSERT INTO registration_events
      (event_id, bellwatch_key, status, evidence, recorded_at)
    VALUES
      ('legacy-event', 'daft:legacy', 'unconfirmed', 'Legacy note', '2026-09-01T00:00:00.000Z');
  `);
  legacy.close();
  const state = await Effect.runPromise(createStateStore({ file }));
  try {
    const events = await Effect.runPromise(state.listRegistrationEvents("daft:legacy"));
    const event = events.at(0);
    assert.ok(event);
    assert.equal(event.status, "unconfirmed");
    assert.equal(event.consentStatus, "unknown");
    assert.equal(event.evidence, "Legacy note");
  } finally {
    await Effect.runPromise(state.close());
    await rm(directory, { recursive: true, force: true });
  }
});
test("migrates legacy seen IDs while preserving their cross-provider group", async () => {
  const directory = await mkdtemp(join(tmpdir(), "bellwatch-seen-migration-"));
  const file = join(directory, "state.sqlite");
  const legacy = new DatabaseSync(file);
  legacy.exec(`
    CREATE TABLE seen_listings (
      id TEXT PRIMARY KEY,
      first_seen_at TEXT NOT NULL,
      last_seen_at TEXT NOT NULL
    );
    INSERT INTO seen_listings (id, first_seen_at, last_seen_at)
    VALUES ('101', '2026-09-01T00:00:00.000Z', '2026-09-02T00:00:00.000Z');
  `);
  legacy.close();
  const state = await Effect.runPromise(createStateStore({ file }));
  try {
    assert.equal(await Effect.runPromise(state.isSeen("daft:101")), true);
    assert.equal(await Effect.runPromise(state.isSeen("101")), true);
    const listing: SourcedFinding = {
      source: "daft",
      sourceId: "101",
      finding: {
        ...finding,
        bedrooms: 3,
        propertyType: "Semi-Detached House",
        eircode: "D01 AB12",
      },
    };
    await Effect.runPromise(state.observeFinding(listing));
    const current = await Effect.runPromise(state.getCurrentListing("daft:101"));
    const canonicalGroupKey = current?.canonicalGroupKey;
    assert.ok(canonicalGroupKey);
    await Effect.runPromise(
      state.markSeen({ ...listing.finding, id: "daft:101" }, canonicalGroupKey),
    );
    assert.equal(
      await Effect.runPromise(state.isSeen("myhome:101", canonicalGroupKey)),
      true,
    );
  } finally {
    await Effect.runPromise(state.close());
    await rm(directory, { recursive: true, force: true });
  }
});
