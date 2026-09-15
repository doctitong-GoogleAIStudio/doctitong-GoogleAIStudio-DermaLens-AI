import { pbkdf2Async } from "@noble/hashes/pbkdf2.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { utf8ToBytes } from "@noble/hashes/utils.js";
import { xchacha20poly1305 } from "@noble/ciphers/chacha.js";
import * as Crypto from "expo-crypto";

/**
 * Backup files hold medical data, so they are always encrypted with a password
 * the user chooses: PBKDF2-HMAC-SHA256 for the key, XChaCha20-Poly1305 for the
 * payload (authenticated, so a tampered or wrong-password file is rejected).
 */

export const BACKUP_FORMAT = "dermalens-backup";
export const BACKUP_VERSION = 1;
const KDF_ITERATIONS = 60_000;
const SALT_BYTES = 16;
const NONCE_BYTES = 24;

const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

export function bytesToBase64(bytes: Uint8Array): string {
  let out = "";
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i];
    const b1 = bytes[i + 1];
    const b2 = bytes[i + 2];
    out += B64[b0 >> 2];
    out += B64[((b0 & 3) << 4) | ((b1 ?? 0) >> 4)];
    out += b1 === undefined ? "=" : B64[((b1 & 15) << 2) | ((b2 ?? 0) >> 6)];
    out += b2 === undefined ? "=" : B64[b2 & 63];
  }
  return out;
}

export function base64ToBytes(text: string): Uint8Array {
  const clean = text.replace(/[^A-Za-z0-9+/]/g, "");
  const out = new Uint8Array(Math.floor((clean.length * 3) / 4));
  let p = 0;
  for (let i = 0; i < clean.length; i += 4) {
    const n0 = B64.indexOf(clean[i]);
    const n1 = B64.indexOf(clean[i + 1]);
    const n2 = B64.indexOf(clean[i + 2]);
    const n3 = B64.indexOf(clean[i + 3]);
    out[p++] = (n0 << 2) | (n1 >> 4);
    if (n2 >= 0) out[p++] = ((n1 & 15) << 4) | (n2 >> 2);
    if (n3 >= 0) out[p++] = ((n2 & 3) << 6) | n3;
  }
  return out.subarray(0, p);
}

const toHex = (bytes: Uint8Array) => Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
const fromHex = (v: string) => new Uint8Array(v.match(/.{2}/g)!.map((x) => parseInt(x, 16)));

function bytesToUtf8(bytes: Uint8Array): string {
  if (typeof TextDecoder !== "undefined") return new TextDecoder().decode(bytes);
  // Hermes without TextDecoder: decode in chunks to avoid blowing the stack.
  let out = "";
  for (let i = 0; i < bytes.length; ) {
    const codes: number[] = [];
    while (i < bytes.length && codes.length < 8192) {
      const b = bytes[i++];
      if (b < 0x80) codes.push(b);
      else if (b < 0xe0) codes.push(((b & 0x1f) << 6) | (bytes[i++] & 0x3f));
      else if (b < 0xf0) codes.push(((b & 0x0f) << 12) | ((bytes[i++] & 0x3f) << 6) | (bytes[i++] & 0x3f));
      else {
        const cp =
          ((b & 0x07) << 18) | ((bytes[i++] & 0x3f) << 12) | ((bytes[i++] & 0x3f) << 6) | (bytes[i++] & 0x3f);
        const s = cp - 0x10000;
        codes.push(0xd800 + (s >> 10), 0xdc00 + (s & 0x3ff));
      }
    }
    out += String.fromCharCode(...codes);
  }
  return out;
}

export interface BackupEnvelope {
  format: string;
  version: number;
  app: string;
  createdAt: string;
  scans: number;
  kdf: { name: "pbkdf2-sha256"; iterations: number; salt: string };
  cipher: "xchacha20poly1305";
  nonce: string;
  payload: string;
}

async function deriveKey(password: string, saltHex: string, iterations: number): Promise<Uint8Array> {
  return pbkdf2Async(sha256, utf8ToBytes(password), fromHex(saltHex), { c: iterations, dkLen: 32 });
}

export async function sealBackup(plaintext: string, password: string, scans: number): Promise<string> {
  const salt = Crypto.getRandomValues(new Uint8Array(SALT_BYTES));
  const nonce = Crypto.getRandomValues(new Uint8Array(NONCE_BYTES));
  const saltHex = toHex(salt);
  const key = await deriveKey(password, saltHex, KDF_ITERATIONS);
  const sealed = xchacha20poly1305(key, nonce).encrypt(utf8ToBytes(plaintext));

  const envelope: BackupEnvelope = {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    app: "DermaLens AI",
    createdAt: new Date().toISOString(),
    scans,
    kdf: { name: "pbkdf2-sha256", iterations: KDF_ITERATIONS, salt: saltHex },
    cipher: "xchacha20poly1305",
    nonce: toHex(nonce),
    payload: bytesToBase64(sealed),
  };
  return JSON.stringify(envelope);
}

export async function openBackup(fileText: string, password: string): Promise<string> {
  let envelope: BackupEnvelope;
  try {
    envelope = JSON.parse(fileText);
  } catch {
    throw new Error("That file is not a DermaLens backup.");
  }
  if (envelope?.format !== BACKUP_FORMAT || !envelope?.payload || !envelope?.nonce) {
    throw new Error("That file is not a DermaLens backup.");
  }
  if (envelope.version > BACKUP_VERSION) {
    throw new Error("This backup was made by a newer version of the app. Please update first.");
  }

  const key = await deriveKey(password, envelope.kdf.salt, envelope.kdf.iterations);
  try {
    const opened = xchacha20poly1305(key, fromHex(envelope.nonce)).decrypt(base64ToBytes(envelope.payload));
    return bytesToUtf8(opened);
  } catch {
    throw new Error("Wrong password, or the backup file is damaged.");
  }
}
