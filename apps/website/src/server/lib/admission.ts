import { eq } from "drizzle-orm";
import { db } from "../db";
import { user } from "../db/schema";
import { env, normalizeEmail } from "../env";

export function isEmailAllowed(
  email: string,
  allowedEmails: readonly string[] = env.ALLOWED_EMAILS,
): boolean {
  // Local development and tests may run without external identity credentials.
  // Production startup separately requires a non-empty allowlist.
  if (allowedEmails.length === 0 && env.NODE_ENV !== "production") return true;
  const normalized = normalizeEmail(email);
  return allowedEmails.some((candidate) => normalizeEmail(candidate) === normalized);
}

export async function isUserAllowed(userId: string): Promise<boolean> {
  const [owner] = await db
    .select({ email: user.email })
    .from(user)
    .where(eq(user.id, userId))
    .limit(1);
  return Boolean(owner && isEmailAllowed(owner.email));
}

export const ADMISSION_DENIED_MESSAGE = "This account is not authorized.";
