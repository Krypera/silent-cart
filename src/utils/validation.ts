import { ValidationError } from "../domain/errors.js";

export function sanitizePlainText(input: string, maxLength: number): string {
  const sanitized = input.replace(/[\u0000-\u0008\u000B-\u001F\u007F]/g, "").trim();
  if (sanitized.length === 0) {
    throw new ValidationError("Text cannot be empty.");
  }
  if (sanitized.length > maxLength) {
    throw new ValidationError(`Text is too long. Max length is ${maxLength}.`);
  }
  return sanitized;
}

export function validateUrl(input: string): string {
  const url = new URL(input.trim());
  if (!["http:", "https:"].includes(url.protocol)) {
    throw new ValidationError("Only http and https links are supported.");
  }
  return url.toString();
}
