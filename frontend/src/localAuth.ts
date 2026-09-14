import * as Crypto from "expo-crypto";
import { pbkdf2Async } from "@noble/hashes/pbkdf2.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { utf8ToBytes } from "@noble/hashes/utils.js";

import { storage } from "@/src/utils/storage";
import type { AuthUser } from "@/src/types";

/**
 * Fully on-device accounts. No server, no network, works offline forever.
 * Passwords are stored as salted PBKDF2-HMAC-SHA256 hashes.
 */

const ITERATIONS = 60_000;
const KEY_BYTES = 32;
const SALT_BYTES = 16;
const ACCOUNT_PREFIX = "local_account_";
const ID_PREFIX = "local_account_id_";
const SESSION_KEY = "local_session";

interface Account {
  id: string;
  full_name: string;
  email: string; // normalized
  saltHex: string;
  hashHex: string;
  iterations: number;
  createdAt: string;
}

const hex = (bytes: Uint8Array) => Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
const bytesFromHex = (v: string) => new Uint8Array(v.match(/.{2}/g)!.map((x) => parseInt(x, 16)));
const normalizeEmail = (email: string) => email.trim().toLocaleLowerCase("en-US");
const validEmail = (email: string) => email.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);

async function derive(password: string, saltHex: string, iterations: number): Promise<string> {
  const out = await pbkdf2Async(sha256, utf8ToBytes(password), bytesFromHex(saltHex), {
    c: iterations,
    dkLen: KEY_BYTES,
  });
  return hex(out);
}

/**
 * SecureStore only accepts keys made of letters, digits, ".", "-" and "_", so the
 * email is hashed into a hex key. (An email-derived key with "@"/"%" fails to save
 * silently, which used to lose the account as soon as the user logged out.)
 */
const accountKey = (email: string) => ACCOUNT_PREFIX + hex(sha256(utf8ToBytes(email)));

async function writeRecord(key: string, value: string): Promise<boolean> {
  if (await storage.secureSet(key, value)) {
    const back = await storage.secureGet<string>(key, "");
    if (back === value) return true;
  }
  // Keychain unavailable (e.g. web) — fall back to regular storage.
  return storage.setItem(key, value);
}

async function readRecord(key: string): Promise<string> {
  const secure = await storage.secureGet<string>(key, "");
  if (secure) return secure;
  return (await storage.getItem<string>(key, "")) ?? "";
}

async function removeRecord(key: string): Promise<void> {
  await storage.secureRemove(key);
  await storage.removeItem(key);
}

async function readAccountByEmail(email: string): Promise<Account | null> {
  const raw = await readRecord(accountKey(email));
  if (!raw) return null;
  try {
    return JSON.parse(raw) as Account;
  } catch {
    return null;
  }
}

const publicUser = (a: Account): AuthUser => ({ id: a.id, full_name: a.full_name, email: a.email });

// Serialises writes so a double-tap cannot create two accounts.
let chain: Promise<unknown> = Promise.resolve();
function serialized<T>(work: () => Promise<T>): Promise<T> {
  const next = chain.then(work, work);
  chain = next.then(
    () => undefined,
    () => undefined,
  );
  return next as Promise<T>;
}

export async function localSignUp(fullName: string, emailInput: string, password: string): Promise<AuthUser> {
  const name = fullName.trim();
  const email = normalizeEmail(emailInput);
  if (!name) throw new Error("Please enter your full name.");
  if (!validEmail(email)) throw new Error("Please enter a valid email address.");
  if (password.length < 8) throw new Error("Password must be at least 8 characters.");

  return serialized(async () => {
    if (await readAccountByEmail(email)) {
      throw new Error("An account with this email already exists on this device.");
    }
    const saltHex = hex(await Crypto.getRandomBytesAsync(SALT_BYTES));
    const account: Account = {
      id: Crypto.randomUUID(),
      full_name: name,
      email,
      saltHex,
      hashHex: await derive(password, saltHex, ITERATIONS),
      iterations: ITERATIONS,
      createdAt: new Date().toISOString(),
    };
    const key = accountKey(email);
    const record = JSON.stringify(account);
    await writeRecord(key, record);
    await writeRecord(ID_PREFIX + account.id, key);

    // Make sure the account really persisted — otherwise the user would be
    // unable to log back in after signing out.
    const check = await readAccountByEmail(email);
    if (!check) {
      await removeRecord(key);
      await removeRecord(ID_PREFIX + account.id);
      throw new Error("Could not save your account on this device. Please try again.");
    }

    await storage.setItem(SESSION_KEY, account.id);
    return publicUser(account);
  });
}

export async function localSignIn(emailInput: string, password: string): Promise<AuthUser> {
  const account = await verifyAccount(emailInput, password);
  if (!account) throw new Error("Email or password is incorrect.");
  await storage.setItem(SESSION_KEY, account.id);
  return publicUser(account);
}

async function verifyAccount(emailInput: string, password: string): Promise<Account | null> {
  const email = normalizeEmail(emailInput);
  const account = await readAccountByEmail(email);
  if (!account) return null;
  const candidate = await derive(password, account.saltHex, account.iterations);
  if (candidate !== account.hashHex) return null;
  return account;
}

/** Checks credentials against the on-device store WITHOUT starting a session. */
export async function localVerify(emailInput: string, password: string): Promise<AuthUser | null> {
  const account = await verifyAccount(emailInput, password);
  return account ? publicUser(account) : null;
}

/**
 * Creates or refreshes the on-device account for an account that the backend
 * has authenticated, then starts the session. Used when someone signs in with
 * an account that was created on the server or on another phone, and when a
 * legacy local-only account is migrated. The account id is preserved so
 * nothing keyed to it is lost.
 */
export async function localUpsertAccount(
  fullName: string,
  emailInput: string,
  password: string,
): Promise<AuthUser> {
  const email = normalizeEmail(emailInput);
  const name = fullName.trim();

  return serialized(async () => {
    const existing = await readAccountByEmail(email);
    const saltHex = hex(await Crypto.getRandomBytesAsync(SALT_BYTES));
    const account: Account = {
      id: existing?.id ?? Crypto.randomUUID(),
      full_name: name || existing?.full_name || email.split("@")[0],
      email,
      saltHex,
      hashHex: await derive(password, saltHex, ITERATIONS),
      iterations: ITERATIONS,
      createdAt: existing?.createdAt ?? new Date().toISOString(),
    };
    const key = accountKey(email);
    await writeRecord(key, JSON.stringify(account));
    await writeRecord(ID_PREFIX + account.id, key);
    await storage.setItem(SESSION_KEY, account.id);
    return publicUser(account);
  });
}

export async function localGetSession(): Promise<AuthUser | null> {
  const id = await storage.getItem<string>(SESSION_KEY, "");
  if (!id) return null;
  const key = await readRecord(ID_PREFIX + id);
  if (!key) return null;
  const raw = await readRecord(key);
  if (!raw) return null;
  try {
    return publicUser(JSON.parse(raw) as Account);
  } catch {
    return null;
  }
}

export async function localSignOut(): Promise<void> {
  await storage.removeItem(SESSION_KEY);
}
