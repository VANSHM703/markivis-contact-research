/**
 * Envelope encryption for OAuth tokens and workspace secrets (BRD 18.3). Each value gets its own
 * random data key (AES-256-GCM); the data key is itself encrypted with the master key from
 * TOKEN_ENCRYPTION_KEY (32 bytes, base64). A KMS-backed master key replaces this module's
 * wrapKey/unwrapKey when KMS_KEY_ID is set (not implemented until a host is chosen; DECISIONS.md).
 */
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

const VERSION = 1;

export class EncryptionConfigError extends Error {}

function masterKey(env: Record<string, string | undefined> = process.env): { key: Buffer; id: string } {
  const raw = env.TOKEN_ENCRYPTION_KEY?.trim();
  if (!raw) throw new EncryptionConfigError("Set TOKEN_ENCRYPTION_KEY to a 32-byte base64 value to store secrets.");
  const key = Buffer.from(raw, "base64");
  if (key.length !== 32) throw new EncryptionConfigError("TOKEN_ENCRYPTION_KEY must decode to exactly 32 bytes.");
  return { key, id: `local:${createHash("sha256").update(key).digest("hex").slice(0, 12)}` };
}

function seal(key: Buffer, plain: Buffer): Buffer {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const body = Buffer.concat([cipher.update(plain), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), body]);
}

function open(key: Buffer, sealed: Buffer): Buffer {
  const iv = sealed.subarray(0, 12);
  const tag = sealed.subarray(12, 28);
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(sealed.subarray(28)), decipher.final()]);
}

/** Layout: version (1 byte), wrapped data key length (2 bytes), wrapped data key, sealed value. */
export function encryptSecret(plaintext: string, env?: Record<string, string | undefined>): { ciphertext: Buffer; keyId: string } {
  const master = masterKey(env);
  const dataKey = randomBytes(32);
  const wrapped = seal(master.key, dataKey);
  const header = Buffer.alloc(3);
  header.writeUInt8(VERSION, 0);
  header.writeUInt16BE(wrapped.length, 1);
  return { ciphertext: Buffer.concat([header, wrapped, seal(dataKey, Buffer.from(plaintext, "utf8"))]), keyId: master.id };
}

export function decryptSecret(ciphertext: Buffer, env?: Record<string, string | undefined>): string {
  const master = masterKey(env);
  if (ciphertext.readUInt8(0) !== VERSION) throw new Error("Unknown secret format.");
  const wrappedLength = ciphertext.readUInt16BE(1);
  const dataKey = open(master.key, ciphertext.subarray(3, 3 + wrappedLength));
  return open(dataKey, ciphertext.subarray(3 + wrappedLength)).toString("utf8");
}
