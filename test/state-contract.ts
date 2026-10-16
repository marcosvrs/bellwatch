import assert from "node:assert/strict";
import test from "node:test";
import * as Effect from "effect/Effect";
import type { DiscoveryCandidate, SourcedListing } from "../src/listings.js";
import type { StateStore } from "../src/state.js";

export interface StateStoreHarness {
  readonly open: () => Promise<StateStore>;
  readonly close: () => Promise<void>;
}

export type StateStoreHarnessFactory = () => Promise<StateStoreHarness>;

export const registerStateStoreContract = (
  name: string,
  createHarness: StateStoreHarnessFactory,
  skip?: string,
): void => {
  test(`${name} state store contract persists Listing groups, candidates, and registration state`, {
    ...(skip === undefined ? {} : { skip }),
  }, async () => {
    const harness = await createHarness();
    let store: StateStore | undefined;
    try {
      store = await harness.open();
      assert.equal(await Effect.runPromise(store.isInitialized()), false);
      const listing: SourcedListing = {
        source: "daft",
        sourceId: "contract-101",
        facts: {
          title: "Contract home",
          developmentTitle: "Contract homes",
          priceText: "€315,000",
          bedrooms: 3,
          propertyType: "Semi-detached house",
          address: "1 Contract Grove",
          url: "https://www.daft.ie/new-home-for-sale/contract/contract-101",
        },
      };
      const myhomeListing: SourcedListing = {
        source: "myhome",
        sourceId: "contract-202",
        facts: {
          title: "MyHome contract home",
          developmentTitle: "Contract homes",
          priceText: "€315,000",
          bedrooms: 3,
          propertyType: "Semi detached house",
          address: "1 Contract Grove",
          eircode: "D01 AB12",
          url: "https://www.myhome.ie/residential/contract/202",
        },
        myhomeEvidence: {
          typeVerified: true,
          daftPropertyTypes: ["houses"],
          priceState: "amount",
          priceEur: 315_000,
          openViewingDates: [],
          openViewingsVerified: false,
          facilities: [],
          facilitiesVerified: false,
          saleTypeVerified: false,
          onlineOffersVerified: false,
          searchableText: "MyHome contract home",
        },
      };
      await Effect.runPromise(store.observeFinding(listing));
      const initialDaft = await Effect.runPromise(
        store.getCurrentListing("daft:contract-101"),
      );
      assert.ok(initialDaft?.canonicalGroupKey);
      await Effect.runPromise(
        store.markSeen("daft:contract-101", initialDaft.canonicalGroupKey),
      );
      await Effect.runPromise(store.observeFinding(myhomeListing));
      const groupedDaft = await Effect.runPromise(
        store.getCurrentListing("daft:contract-101"),
      );
      const groupedMyHome = await Effect.runPromise(
        store.getCurrentListing("myhome:contract-202"),
      );
      assert.ok(groupedDaft?.canonicalGroupKey);
      assert.ok(groupedMyHome?.canonicalGroupKey);
      assert.equal(groupedMyHome.canonicalGroupKey, groupedDaft.canonicalGroupKey);
      assert.equal(
        await Effect.runPromise(
          store.isSeen("myhome:contract-202", groupedMyHome.canonicalGroupKey),
        ),
        true,
      );
      const candidate: DiscoveryCandidate = {
        source: "searxng",
        verified: false,
        url: "https://example.test/contract-home",
        title: "Possible contract home",
        snippet: "Candidate listing",
        discoveredAt: "2026-10-15T00:00:00.000Z",
      };
      await Effect.runPromise(store.recordCandidate(candidate));
      await Effect.runPromise(
        store.recordRegistrationEvent("daft:contract-101", {
          status: "confirmed",
          consentStatus: "consented",
          evidence: "contract test evidence",
        }),
      );
      await Effect.runPromise(store.markInitialized());
      await Effect.runPromise(store.close());
      store = undefined;

      store = await harness.open();
      assert.equal(await Effect.runPromise(store.isInitialized()), true);
      assert.equal(await Effect.runPromise(store.isSeen("daft:contract-101")), true);
      assert.equal(
        (await Effect.runPromise(store.getCurrentListing("daft:contract-101")))
          ?.facts.title,
        "Contract home",
      );
      const reopenedMyHome = await Effect.runPromise(
        store.getCurrentListing("myhome:contract-202"),
      );
      assert.ok(reopenedMyHome?.source === "myhome");
      assert.equal(
        reopenedMyHome.canonicalGroupKey,
        (await Effect.runPromise(store.getCurrentListing("daft:contract-101")))
          ?.canonicalGroupKey,
      );
      assert.equal(
        await Effect.runPromise(
          store.isSeen("myhome:contract-202", reopenedMyHome.canonicalGroupKey),
        ),
        true,
      );
      assert.equal(reopenedMyHome.myhomeEvidence?.typeVerified, true);
      assert.equal(
        (await Effect.runPromise(store.listListingObservations("daft:contract-101")))
          .length,
        1,
      );
      assert.equal((await Effect.runPromise(store.listCurrentCandidates())).length, 1);
      assert.equal(
        (await Effect.runPromise(store.listRegistrationEvents("daft:contract-101")))
          .at(0)?.status,
        "confirmed",
      );
    } finally {
      try {
        if (store !== undefined) {
          await Effect.runPromise(store.close());
        }
      } finally {
        await harness.close();
      }
    }
  });
};
