const DEVELOPMENT_API_URL = "http://localhost:8787";
const PRODUCTION_API_URL = "https://shark.shuv.dev";

export function resolveApiUrl(configuredUrl: string | undefined, isDevelopment: boolean): string {
  const trimmedUrl = configuredUrl?.trim();
  if (trimmedUrl) return trimmedUrl;
  return isDevelopment ? DEVELOPMENT_API_URL : PRODUCTION_API_URL;
}
