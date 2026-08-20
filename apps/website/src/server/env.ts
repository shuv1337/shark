import { z } from "zod";

const DEV_SECRET = "hark-insecure-dev-secret-change-me";

const optionalString = z.preprocess(
  (value) => (typeof value === "string" && value.trim() === "" ? undefined : value),
  z.string().trim().optional(),
);

export function normalizeEmail(value: string): string {
  return value.trim().toLowerCase();
}

const allowedEmails = z.preprocess((value) => {
  if (typeof value !== "string") return [];
  return [...new Set(value.split(",").map(normalizeEmail).filter(Boolean))];
}, z.array(z.email()));

export const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  DEPLOYMENT_MODE: z.literal("self_hosted").optional(),
  PORT: z.coerce.number().int().positive().default(8787),
  /** SQLite file path. Production containers should point this at /data/hark.sqlite. */
  DATABASE_URL: z.string().min(1).default("./data/hark.sqlite"),
  /** Public origin the browser uses. In dev this is the Vite server, which proxies /api. */
  APP_URL: z.url().default("http://localhost:5173"),
  BETTER_AUTH_SECRET: z.string().min(16).default(DEV_SECRET),
  ALLOWED_EMAILS: allowedEmails.default([]),
  /** Sign in with Apple Services ID used by the web OAuth flow. */
  APPLE_SIGN_IN_SERVICE_ID: optionalString,
  /** Native App ID / bundle identifier. This is also the native token audience. */
  APPLE_SIGN_IN_BUNDLE_ID: z.string().min(1).default("dev.shuv.shark"),
  APPLE_SIGN_IN_KEY_ID: optionalString,
  /** Sign in with Apple .p8 key. Accepts PEM text (with \n) or base64-encoded PEM. */
  APPLE_SIGN_IN_PRIVATE_KEY: optionalString,
  /** Authenticated requests to the Expo Push Service. Required in production. */
  EXPO_ACCESS_TOKEN: optionalString,
  /** Standards-based Web Push application-server credentials. */
  VAPID_PUBLIC_KEY: optionalString,
  VAPID_PRIVATE_KEY: optionalString,
  VAPID_SUBJECT: z.preprocess(
    (value) => (typeof value === "string" && value.trim() === "" ? undefined : value),
    z.union([z.email().transform((value) => `mailto:${value}`), z.url()]).optional(),
  ),
  /** Direct APNs credentials for Live Activity start/update/end delivery. */
  APNS_KEY_ID: optionalString,
  APPLE_TEAM_ID: optionalString,
  APNS_PRIVATE_KEY: optionalString,
  /** Environment-scoped APNs credentials used by development-signed device builds. */
  APNS_SANDBOX_KEY_ID: optionalString,
  APNS_SANDBOX_PRIVATE_KEY: optionalString,
  APNS_BUNDLE_ID: z.string().min(1).default("dev.shuv.shark"),
  APNS_MACOS_BUNDLE_ID: z.string().min(1).default("dev.shuv.shark.macos"),
  APNS_ENVIRONMENT: z.enum(["sandbox", "production"]).default("sandbox"),
  /**
   * Legacy only. A non-empty value is rejected so stale hosted-product
   * configuration cannot silently re-enable billing behavior.
   */
  AUTUMN_API_KEY: optionalString,
  /**
   * Header carrying the real client IP, set (and overwritten) by a trusted edge.
   * Leave unset for exe.dev v1 because its appended X-Forwarded-For chain is not
   * safe to trust as the first value.
   */
  TRUSTED_CLIENT_IP_HEADER: optionalString,
  SERVICE_RATE_LIMIT_PER_MINUTE: z.coerce.number().int().positive().default(300),
  ACCOUNT_RATE_LIMIT_PER_MINUTE: z.coerce.number().int().positive().default(1500),
});

export type RuntimeEnv = z.infer<typeof envSchema>;

export function parseEnv(input: NodeJS.ProcessEnv | Record<string, unknown>): RuntimeEnv {
  return envSchema.parse(input);
}

const parsed = envSchema.safeParse(process.env);
if (!parsed.success) {
  console.error("Invalid environment configuration:");
  console.error(z.prettifyError(parsed.error));
  process.exit(1);
}

export const env = parsed.data;

export function runtimeEnvIssues(runtime: RuntimeEnv): string[] {
  const issues: string[] = [];
  if (runtime.AUTUMN_API_KEY) {
    issues.push("AUTUMN_API_KEY must be unset; SHark has no billing runtime.");
  }
  if (
    !runtime.APPLE_SIGN_IN_SERVICE_ID ||
    !runtime.APPLE_TEAM_ID ||
    !runtime.APPLE_SIGN_IN_KEY_ID ||
    !runtime.APPLE_SIGN_IN_PRIVATE_KEY
  ) {
    issues.push(
      "APPLE_SIGN_IN_SERVICE_ID / APPLE_SIGN_IN_BUNDLE_ID / APPLE_TEAM_ID / APPLE_SIGN_IN_KEY_ID / APPLE_SIGN_IN_PRIVATE_KEY are not all set.",
    );
  }
  if (runtime.BETTER_AUTH_SECRET === DEV_SECRET) {
    issues.push("BETTER_AUTH_SECRET is using the insecure development default.");
  }
  if (!runtime.EXPO_ACCESS_TOKEN) {
    issues.push("EXPO_ACCESS_TOKEN is not set.");
  }
  if (!runtime.VAPID_PUBLIC_KEY || !runtime.VAPID_PRIVATE_KEY || !runtime.VAPID_SUBJECT) {
    issues.push("VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY / VAPID_SUBJECT are not all set.");
  } else {
    if (
      runtime.VAPID_PUBLIC_KEY.length !== 87 ||
      runtime.VAPID_PRIVATE_KEY.length !== 43 ||
      !/^[A-Za-z0-9_-]+$/.test(runtime.VAPID_PUBLIC_KEY) ||
      !/^[A-Za-z0-9_-]+$/.test(runtime.VAPID_PRIVATE_KEY)
    ) {
      issues.push("VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY are not valid base64url VAPID keys.");
    }
    if (
      !runtime.VAPID_SUBJECT.startsWith("mailto:") &&
      !runtime.VAPID_SUBJECT.startsWith("https://")
    ) {
      issues.push("VAPID_SUBJECT must use mailto: or https:.");
    }
  }
  if (!runtime.APNS_KEY_ID || !runtime.APPLE_TEAM_ID || !runtime.APNS_PRIVATE_KEY) {
    issues.push("APNS_KEY_ID / APPLE_TEAM_ID / APNS_PRIVATE_KEY are not all set.");
  }
  if (
    runtime.NODE_ENV === "production" &&
    (!runtime.APNS_SANDBOX_KEY_ID || !runtime.APNS_SANDBOX_PRIVATE_KEY)
  ) {
    issues.push("APNS_SANDBOX_KEY_ID / APNS_SANDBOX_PRIVATE_KEY are not all set.");
  }
  if (runtime.NODE_ENV === "production") {
    if (runtime.DEPLOYMENT_MODE !== "self_hosted") {
      issues.push("Production requires DEPLOYMENT_MODE=self_hosted.");
    }
    if (runtime.ALLOWED_EMAILS.length === 0) {
      issues.push("Production requires at least one ALLOWED_EMAILS address.");
    }
    if (!runtime.APP_URL.startsWith("https://")) {
      issues.push("Production APP_URL must use HTTPS.");
    }
  }
  return issues;
}

function hasPartialGroup(values: Array<string | undefined>): boolean {
  const configured = values.filter(Boolean).length;
  return configured > 0 && configured < values.length;
}

/** Warn in development and fail closed for any legacy billing key or production issue. */
export function assertRuntimeEnv(runtime: RuntimeEnv = env): void {
  const issues = runtimeEnvIssues(runtime);
  const partialApple = hasPartialGroup([
    runtime.APPLE_SIGN_IN_SERVICE_ID,
    runtime.APPLE_TEAM_ID,
    runtime.APPLE_SIGN_IN_KEY_ID,
    runtime.APPLE_SIGN_IN_PRIVATE_KEY,
  ]);
  const partialApns = hasPartialGroup([
    runtime.APNS_KEY_ID,
    runtime.APPLE_TEAM_ID,
    runtime.APNS_PRIVATE_KEY,
  ]);
  const partialSandboxApns = hasPartialGroup([
    runtime.APNS_SANDBOX_KEY_ID,
    runtime.APNS_SANDBOX_PRIVATE_KEY,
  ]);
  const partialVapid = hasPartialGroup([
    runtime.VAPID_PUBLIC_KEY,
    runtime.VAPID_PRIVATE_KEY,
    runtime.VAPID_SUBJECT,
  ]);
  if (
    runtime.AUTUMN_API_KEY ||
    partialApple ||
    partialApns ||
    partialSandboxApns ||
    partialVapid ||
    (runtime.NODE_ENV === "production" && issues.length > 0)
  ) {
    const partialIssues = [
      ...(partialApple ? ["Partially configured Sign in with Apple credential group."] : []),
      ...(partialApns ? ["Partially configured APNs credential group."] : []),
      ...(partialSandboxApns ? ["Partially configured sandbox APNs credential group."] : []),
      ...(partialVapid ? ["Partially configured Web Push VAPID credential group."] : []),
    ];
    throw new Error(
      `Invalid SHark runtime configuration:\n- ${[...new Set([...issues, ...partialIssues])].join("\n- ")}`,
    );
  }
  for (const issue of issues) {
    console.warn(`[env] ${issue}`);
  }
}
