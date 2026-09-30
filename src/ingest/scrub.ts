/**
 * Replaces personal data in recorded responses with fictional values (BRD 4.1, record mode).
 * Emails, phone numbers and LinkedIn slugs are replaced deterministically, so the same real
 * value always becomes the same fictional one and recorded fixtures stay internally consistent.
 * Names in free text cannot be found reliably; recorded files therefore land in a git-ignored
 * folder for review before any is promoted to /fixtures (DECISIONS.md).
 */
import { createHash } from "node:crypto";

const short = (value: string) => createHash("sha256").update(value.toLowerCase()).digest("hex").slice(0, 8);

export function scrub(text: string): string {
  return text
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, (email) => `person-${short(email)}@example.com`)
    .replace(/linkedin\.com\/in\/[A-Za-z0-9_%-]+/gi, (m) => `linkedin.com/in/example-${short(m)}`)
    .replace(/\+?\d[\d\s().-]{8,}\d/g, (phone) => (phone.replace(/\D/g, "").length >= 10 ? "+1 555 010 0000" : phone));
}
