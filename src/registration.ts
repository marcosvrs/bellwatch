import * as Effect from "effect/Effect";
import type { StateConfig } from "./config.js";
import {
  createStateStore,
  REGISTRATION_CONSENT_STATUSES,
  REGISTRATION_STATUSES,
  type RegistrationConsentStatus,
  type RegistrationStatus,
  type StateStore,
} from "./state.js";

export interface ManualRegistrationInput {
  readonly listingKey: string;
  readonly status: RegistrationStatus;
  readonly consentStatus: RegistrationConsentStatus;
  readonly evidence: string;
}
type ManualRegistrationAttempt = Omit<
  ManualRegistrationInput,
  "status" | "consentStatus"
> & {
  readonly status: string;
  readonly consentStatus: string;
};

const ARGUMENT_NAMES = ["listing", "status", "consent", "evidence"] as const;
type ArgumentName = (typeof ARGUMENT_NAMES)[number];

const argumentName = (value: string): ArgumentName | undefined =>
  ARGUMENT_NAMES.find((name) => name === value);

const isRegistrationStatus = (value: string): value is RegistrationStatus =>
  REGISTRATION_STATUSES.some((status) => status === value);

const isConsentStatus = (value: string): value is RegistrationConsentStatus =>
  REGISTRATION_CONSENT_STATUSES.some((status) => status === value);

const requiredArgument = (
  values: Partial<Record<ArgumentName, string>>,
  name: ArgumentName,
): string => {
  const value = values[name];
  if (value === undefined) { throw new Error(`Missing required argument: --${name}`); }
  return value;
};

export const parseManualRegistrationArguments = (
  args: readonly string[],
): ManualRegistrationInput => {
  const values: Partial<Record<ArgumentName, string>> = {};
  for (const argument of args) {
    const separator = argument.indexOf("=");
    const optionName = separator < 0 ? "" : argument.slice(2, separator);
    const option = argumentName(optionName);
    if (!argument.startsWith("--") || separator < 0 || option === undefined) {
      throw new Error(`Unexpected argument: ${argument}`);
    }
    if (values[option] !== undefined) {
      throw new Error(`Duplicate argument: --${option}`);
    }
    values[option] = argument.slice(separator + 1);
  }

  const listingKey = requiredArgument(values, "listing");
  const status = requiredArgument(values, "status");
  const consentStatus = requiredArgument(values, "consent");
  const evidence = requiredArgument(values, "evidence");
  if (!/^(?:daft|myhome):\S+$/.test(listingKey)) {
    throw new Error("--listing must be a namespaced key such as daft:123");
  }
  if (!isRegistrationStatus(status)) {
    throw new Error(`--status must be one of: ${REGISTRATION_STATUSES.join(", ")}`);
  }
  if (!isConsentStatus(consentStatus)) {
    throw new Error(`--consent must be one of: ${REGISTRATION_CONSENT_STATUSES.join(", ")}`);
  }
  if (evidence.trim() === "") {
    throw new Error("--evidence must contain the user's manual evidence note");
  }
  return { listingKey, status, consentStatus, evidence };
};

export const recordManualRegistration = (
  state: StateStore,
  input: ManualRegistrationAttempt,
): Effect.Effect<void, Error> =>
  Effect.gen(function* () {
    if (!isRegistrationStatus(input.status)) {
      return yield* Effect.fail(new Error("Invalid manual registration status"));
    }
    if (!isConsentStatus(input.consentStatus)) {
      return yield* Effect.fail(new Error("Invalid manual consent status"));
    }
    if (input.evidence.trim() === "") {
      return yield* Effect.fail(new Error("Manual evidence note cannot be empty"));
    }
    const listing = yield* state.getCurrentListing(input.listingKey);
    if (listing === undefined) {
      return yield* Effect.fail(
        new Error(`No current listing exists for ${input.listingKey}`),
      );
    }
    yield* state.recordRegistrationEvent(input.listingKey, {
      status: input.status,
      consentStatus: input.consentStatus,
      evidence: input.evidence,
    });
  });

export const runManualRegistrationCommand = async (
  args: readonly string[],
  stateConfig: StateConfig,
  output: (message: string) => void,
): Promise<void> => {
  const input = parseManualRegistrationArguments(args);
  const state = await Effect.runPromise(createStateStore(stateConfig));
  try {
    await Effect.runPromise(recordManualRegistration(state, input));
    output(
      `Recorded manual registration history for ${input.listingKey}: ${input.status}; consent=${input.consentStatus}`,
    );
  } finally {
    await Effect.runPromise(state.close());
  }
};
