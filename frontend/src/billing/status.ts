import { FREE_ANALYSES } from "./products";

/**
 * One line describing what the user can do right now, for the Home, About and
 * Account screens. `warning: true` means they cannot run an analysis.
 */
export function describeCredits(args: {
  credits: number;
  freeLeft: number;
  available: boolean;
}): { label: string; detail: string; warning: boolean } {
  const { credits, freeLeft, available } = args;

  if (!available) {
    // No Play Billing here (web preview, iOS): nothing to sell, so nothing is gated.
    return { label: "Unlimited on this device", detail: "", warning: false };
  }
  if (credits > 0) {
    return {
      label: `${credits} credit${credits === 1 ? "" : "s"}`,
      detail: credits === 1 ? "One analysis left." : `${credits} analyses left.`,
      warning: false,
    };
  }
  if (freeLeft > 0) {
    return {
      label: `${freeLeft} free`,
      detail:
        freeLeft === 1
          ? "Your free analysis is ready to use."
          : `${freeLeft} of your ${FREE_ANALYSES} free analyses are left.`,
      warning: false,
    };
  }
  return {
    label: "No credits",
    detail: "Buy a credit pack to run another analysis.",
    warning: true,
  };
}
