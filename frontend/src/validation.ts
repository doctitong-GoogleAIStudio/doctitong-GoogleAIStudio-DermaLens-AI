/**
 * One place for credential validation, so the sign-up screen, the sign-in
 * screen and the local (offline) account store all agree on what is valid.
 * The shape check mirrors the backend's; the backend additionally rejects
 * throwaway providers and domains with no mail server, and its message is
 * what the user sees for those.
 */

export const MIN_PASSWORD_LENGTH = 8;

// Labelled domain with an alphabetic TLD of 2+ characters — so "a@b", "a@b.c"
// and "jane@company" are rejected, unlike the old anything@anything.anything.
const EMAIL_RE =
  /^[A-Za-z0-9!#$%&'*+/=?^_`{|}~-]+(?:\.[A-Za-z0-9!#$%&'*+/=?^_`{|}~-]+)*@[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?)*\.[A-Za-z]{2,}$/;

export function normalizeEmail(email: string): string {
  return email.trim().toLocaleLowerCase("en-US");
}

export function isValidEmail(email: string): boolean {
  const value = normalizeEmail(email);
  if (!value || value.length > 254 || value.includes("..")) return false;
  if (value.split("@")[0].length > 64) return false;
  return EMAIL_RE.test(value);
}

/** Inline field message, or null when the value is fine (or still empty). */
export function emailError(email: string): string | null {
  if (!email.trim()) return null;
  return isValidEmail(email) ? null : "Please enter a valid email address.";
}

export function passwordError(password: string): string | null {
  if (!password) return null;
  return password.length < MIN_PASSWORD_LENGTH
    ? `Password must be at least ${MIN_PASSWORD_LENGTH} characters.`
    : null;
}

/** Shows the address in a message without spelling all of it out. */
export function maskEmail(email: string): string {
  const [local, domain] = normalizeEmail(email).split("@");
  if (!domain) return email;
  const shown = local.length <= 2 ? local.slice(0, 1) : local.slice(0, 2);
  return `${shown}${"•".repeat(Math.max(1, local.length - shown.length))}@${domain}`;
}
