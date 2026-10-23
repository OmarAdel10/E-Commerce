import {
  type Readiness,
  type ReadinessIssue,
  type ReadinessStatus,
} from "@scalius/shared/readiness";

export type DeliveryProviderActivationRequirement = {
  source: "credentials" | "config";
  key: string;
  label: string;
};

export type DeliveryProviderActivationBlocker = DeliveryProviderActivationRequirement & {
  message: string;
};

/**
 * Where a provider sits on the setup path. This is a lifecycle position, not a
 * readiness verdict -- the verdict is the shared `status` on the summary below.
 * `configured`: set up but no connection test passed with these settings;
 * `tested`: a test passed; `active`: on and set up.
 */
export type DeliveryProviderLifecycle = "draft" | "configured" | "tested" | "active" | "blocked";

export type DeliveryProviderReadinessBlocker = ReadinessIssue & {
  code: "inactive" | "unconfigured" | "unreadable" | "untested" | "test_failed";
};

/**
 * The courier's last connection test, as its app keeps it: `none` when it
 * offers no test, `untested` when no test ran with its current settings (a
 * settings change resets it), else the outcome with the app's merchant-safe
 * answer. A test is a probe, never a gate: it decides what the merchant is
 * told, not whether a booking may be tried (an outage during a test must not
 * switch a courier off).
 */
export type DeliveryProviderConnection = {
  status: "none" | "untested" | "passed" | "failed";
  testedAt: string | null;
  message: string | null;
};

/**
 * The shared readiness vocabulary (`status` + `issues`) plus the typed extras
 * the delivery settings screen renders.
 */
export type DeliveryProviderReadinessSummary = Readiness & {
  issues: DeliveryProviderReadinessBlocker[];
  lifecycle: DeliveryProviderLifecycle;
  configured: boolean;
  /** A connection test passed with the current settings. */
  tested: boolean;
  active: boolean;
  activationBlockers: DeliveryProviderActivationBlocker[];
  connection: DeliveryProviderConnection;
  lastTestAttemptAt?: Date | number | string | null;
  lastTestSuccessAt?: Date | number | string | null;
  lastTestFailureAt?: Date | number | string | null;
};

type DeliveryProviderSummaryInput = {
  type: string;
  credentialsReadable?: boolean;
  /**
   * What keeps the setup from shipping, from the courier that reads it (an
   * app courier's setup lives in the app's settings). Absent: the row names
   * no courier this request can use.
   */
  activationBlockers?: DeliveryProviderActivationBlocker[];
  isActive?: boolean | null;
  /** The courier's stored connection test. Absent: nothing is known (`untested`). */
  connection?: DeliveryProviderConnection;
  lastTestAttemptAt?: Date | number | string | null;
  lastTestSuccessAt?: Date | number | string | null;
  lastTestFailureAt?: Date | number | string | null;
};

const UNTESTED: DeliveryProviderConnection = { status: "untested", testedAt: null, message: null };

export function getDeliveryProviderReadinessSummary(
  input: DeliveryProviderSummaryInput,
): DeliveryProviderReadinessSummary {
  const credentialsUnreadable = input.credentialsReadable === false;
  const activationBlockers = credentialsUnreadable
    ? [{
        source: "credentials" as const,
        key: "credentials",
        label: "Credentials",
        message: "Stored credentials cannot be decrypted with the configured credential key.",
      }]
    : input.activationBlockers ?? [{
      source: "config" as const,
      key: "type",
      label: "Provider type",
      message: `Unsupported delivery provider type: ${input.type}`,
    }];
  const configured = activationBlockers.length === 0;
  const connection = input.connection ?? UNTESTED;
  // Only a passing test proves a setup: configured is not tested.
  const tested = configured && connection.status === "passed";
  const active = Boolean(input.isActive) && configured;

  const blockers: DeliveryProviderReadinessBlocker[] = [];
  if (!input.isActive) {
    blockers.push({
      code: "inactive",
      message: "Delivery provider is inactive.",
    });
  }
  if (!configured) {
    blockers.push({
      code: credentialsUnreadable
        || activationBlockers.some((blocker) => blocker.key === "credentials" || blocker.key === "config")
        ? "unreadable"
        : "unconfigured",
      message: credentialsUnreadable
        ? "Delivery provider credentials cannot be decrypted with the configured credential key. Re-enter and retest the provider credentials."
        // The courier's own reason ("Activate Bangladesh pack in Apps to use it.").
        : activationBlockers[0]?.message ?? "Delivery provider setup is incomplete or unreadable.",
    });
  } else if (connection.status === "failed") {
    blockers.push({
      code: "test_failed",
      // The app's own answer: what failed and what to check, never a value.
      message: connection.message ?? "The last connection test failed.",
      fix: "Check the courier's settings in its app, then test the connection again.",
    });
  } else if (connection.status === "untested") {
    blockers.push({
      code: "untested",
      message: "Not tested with its current settings.",
      fix: "Test the connection to check that its settings work.",
    });
  }

  let lifecycle: DeliveryProviderLifecycle;
  if (active) {
    lifecycle = "active";
  } else if (input.isActive && !configured) {
    lifecycle = "blocked";
  } else if (!configured) {
    lifecycle = activationBlockers.some((blocker) => blocker.key === "type") ? "blocked" : "draft";
  } else {
    lifecycle = tested ? "tested" : "configured";
  }

  // Ready: on, set up, and proven by a passing test where the courier offers
  // one. A failed test is evidence it does not work, like unreadable secrets:
  // an error, not setup left undone.
  const status: ReadinessStatus = blockers.some((blocker) => blocker.code === "unreadable" || blocker.code === "test_failed")
    ? "error"
    : active && (connection.status === "passed" || connection.status === "none")
      ? "ready"
      : "incomplete";
  return {
    status,
    issues: blockers,
    lifecycle,
    configured,
    tested,
    active,
    activationBlockers,
    connection,
    // A courier's stored test is the one record of when it passed or failed.
    ...(input.connection
      ? {
          lastTestAttemptAt: connection.testedAt ?? input.lastTestAttemptAt,
          lastTestSuccessAt: connection.status === "passed" ? connection.testedAt : null,
          lastTestFailureAt: connection.status === "failed" ? connection.testedAt : null,
        }
      : {
          lastTestAttemptAt: input.lastTestAttemptAt,
          lastTestSuccessAt: input.lastTestSuccessAt,
          lastTestFailureAt: input.lastTestFailureAt,
        }),
  };
}
