import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

export interface EncryptedBlob {
  iv: string;
  authTag: string;
  ciphertext: string;
}

export class EncryptionService {
  private readonly key: Buffer;

  public constructor(hexKey: string) {
    this.key = Buffer.from(hexKey, "hex");
  }

  public encryptJson(value: unknown): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", this.key, iv);
    const plaintext = Buffer.from(JSON.stringify(value), "utf8");
    const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
    const authTag = cipher.getAuthTag();

    return JSON.stringify({
      iv: iv.toString("base64"),
      authTag: authTag.toString("base64"),
      ciphertext: ciphertext.toString("base64")
    } satisfies EncryptedBlob);
  }

  public decryptJson<T>(serialized: string): T {
    const parsed = JSON.parse(serialized) as EncryptedBlob;
    const decipher = createDecipheriv(
      "aes-256-gcm",
      this.key,
      Buffer.from(parsed.iv, "base64")
    );

    decipher.setAuthTag(Buffer.from(parsed.authTag, "base64"));

    const plaintext = Buffer.concat([
      decipher.update(Buffer.from(parsed.ciphertext, "base64")),
      decipher.final()
    ]);

    return JSON.parse(plaintext.toString("utf8")) as T;
  }
}
