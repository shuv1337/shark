export interface SshuvDestination {
  url: string;
  reference: string;
}

// The prefix is operator-supplied build configuration, never notification data.
// A versioned path and opaque reference keep agent state out of public links.
export function parseSshuvDestination(
  value: unknown,
  configuredPrefix: string | undefined,
): SshuvDestination | null {
  if (
    !configuredPrefix ||
    configuredPrefix.length > 1_800 ||
    typeof value !== "string" ||
    value.length > 2_048
  ) {
    return null;
  }
  try {
    const prefix = new URL(configuredPrefix);
    if (
      prefix.protocol !== "https:" ||
      prefix.username ||
      prefix.password ||
      prefix.search ||
      prefix.hash ||
      prefix.href !== configuredPrefix ||
      !/^(?:\/[A-Za-z0-9_-]+)*\/v1\/$/.test(prefix.pathname) ||
      !value.startsWith(configuredPrefix)
    ) {
      return null;
    }
    const reference = value.slice(configuredPrefix.length);
    // No percent decoding, path normalization, query strings, or fragments.
    if (!/^[A-Za-z0-9_-]{22,128}$/.test(reference)) return null;
    return { url: value, reference };
  } catch {
    return null;
  }
}
