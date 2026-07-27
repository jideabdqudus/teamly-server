import { createCipheriv, createDecipheriv, randomBytes } from "crypto";
import { env } from "../config/env";

const KEY = Buffer.from(env.CREDENTIALS_ENCRYPTION_KEY, "base64");
if (KEY.length !== 32) {
  throw new Error(
    "CREDENTIALS_ENCRYPTION_KEY must decode to 32 bytes (base64). Generate with: openssl rand -base64 32",
  );
}

const IV_BYTES = 12;

export interface EncryptedSecret {
  ciphertext: string;
  iv: string;
  authTag: string;
}

export function encryptSecret(plaintext: string): EncryptedSecret {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", KEY, iv);
  const ciphertext = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();
  return {
    ciphertext: ciphertext.toString("base64"),
    iv: iv.toString("base64"),
    authTag: authTag.toString("base64"),
  };
}

export function decryptSecret(secret: EncryptedSecret): string {
  const decipher = createDecipheriv(
    "aes-256-gcm",
    KEY,
    Buffer.from(secret.iv, "base64"),
  );
  decipher.setAuthTag(Buffer.from(secret.authTag, "base64"));
  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(secret.ciphertext, "base64")),
    decipher.final(),
  ]);
  return plaintext.toString("utf8");
}

export function maskSecret(plaintext: string): string {
  const tail = plaintext.slice(-4);
  const prefix = plaintext.slice(0, 3);
  return `${prefix}…${tail}`;
}
