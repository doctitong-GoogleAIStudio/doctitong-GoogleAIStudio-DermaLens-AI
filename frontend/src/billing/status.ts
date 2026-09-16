import type { ActivePlanInfo, SubscriptionStatus } from "./types";

export interface SubscriptionDescription {
  /** Short label for a status pill, e.g. "Active". */
  label: string;
  /** One-line detail shown under the plan name. */
  detail: string;
  /** Whether the state deserves a warning colour (payment problems). */
  warning: boolean;
}

const fmtDate = (ms?: number) =>
  ms ? new Date(ms).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" }) : "";

/** Plain-language explanation of a Google Play subscription state. */
export function describeSubscription(status: SubscriptionStatus, plan: ActivePlanInfo | null): SubscriptionDescription {
  const until = plan?.expiresAt ? fmtDate(plan.expiresAt) : "";
  switch (status) {
    case "trial":
      return {
        label: "Free trial",
        detail: until ? `Your trial converts to a paid plan on ${until} unless cancelled.` : "Your free trial is active.",
        warning: false,
      };
    case "active":
      return {
        label: "Active",
        detail: plan?.autoRenewing === false
          ? until
            ? `Cancelled — access continues until ${until}.`
            : "Cancelled — access continues until the end of the current period."
          : until
            ? `Renews automatically on ${until}.`
            : "Renews automatically.",
        warning: false,
      };
    case "cancelled":
      return {
        label: "Cancelled",
        detail: until
          ? `Will not renew. Access continues until ${until}.`
          : "Will not renew. Access continues until the end of the current paid or trial period.",
        warning: false,
      };
    case "grace_period":
      return {
        label: "Payment problem",
        detail: "Google Play could not charge your payment method. You keep access for a short grace period — update your payment details in Google Play.",
        warning: true,
      };
    case "on_hold":
      return {
        label: "On hold",
        detail: "Payment failed and access is paused. Fix your payment method in Google Play to restore the subscription.",
        warning: true,
      };
    case "paused":
      return {
        label: "Paused",
        detail: "You paused this subscription in Google Play. Resume it there to regain access.",
        warning: true,
      };
    case "pending":
      return {
        label: "Pending",
        detail: "Google Play is still completing this purchase. Access starts once the payment goes through.",
        warning: false,
      };
    case "expired":
      return {
        label: "Expired",
        detail: "Your previous subscription has ended. Subscribe again any time — Google Play restores it automatically on this device.",
        warning: false,
      };
    default:
      return { label: "Free", detail: "No active subscription.", warning: false };
  }
}
