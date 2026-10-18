import type { ServiceDto, ServiceUpdateInput } from "@hark/contracts";

export interface ServiceFormValues {
  title: string;
  imageUrl: string;
  url: string;
}

export const SERVICE_FORM_FIELDS = ["title", "imageUrl", "url"] as const;
export type ServiceFormField = (typeof SERVICE_FORM_FIELDS)[number];
export type ServiceFieldErrors = Partial<Record<ServiceFormField, string>>;

function normalizedOptionalUrl(value: string): string | null {
  return value.trim() || null;
}

/** Build a PATCH body containing only values that differ from the loaded service. */
export function changedServiceFields(
  service: Pick<ServiceDto, "title" | "imageUrl" | "url">,
  values: ServiceFormValues,
): ServiceUpdateInput {
  const next = {
    title: values.title.trim(),
    imageUrl: normalizedOptionalUrl(values.imageUrl),
    url: normalizedOptionalUrl(values.url),
  };
  const input: ServiceUpdateInput = {};

  if (next.title !== service.title) input.title = next.title;
  if (next.imageUrl !== (service.imageUrl ?? null)) input.imageUrl = next.imageUrl;
  if (next.url !== (service.url ?? null)) input.url = next.url;

  return input;
}

/** Convert serialized zod issues into messages that can be shown beside form fields. */
export function serviceFieldErrors(issues: unknown): ServiceFieldErrors {
  if (!Array.isArray(issues)) return {};

  const errors: ServiceFieldErrors = {};
  for (const issue of issues) {
    if (!issue || typeof issue !== "object") continue;
    const path = "path" in issue ? issue.path : undefined;
    const field = Array.isArray(path) ? path[0] : undefined;
    const message = "message" in issue ? issue.message : undefined;
    if (
      typeof field !== "string" ||
      !SERVICE_FORM_FIELDS.includes(field as ServiceFormField) ||
      typeof message !== "string"
    ) {
      continue;
    }
    const typedField = field as ServiceFormField;
    if (errors[typedField] === undefined) errors[typedField] = message;
  }
  return errors;
}
