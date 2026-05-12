import { z } from "zod";

export const stringOrNumberAsString = z
  .union([z.string(), z.number()])
  .transform((value) => String(value).trim());

export const requiredText = z.preprocess(
  (value) => (value == null ? "" : String(value).trim()),
  z.string().min(1),
);

export const optionalText = z.preprocess((value) => {
  if (value == null) return undefined;
  const normalized = String(value).trim();
  return normalized.length > 0 ? normalized : undefined;
}, z.string().optional());

export const optionalStringOrNumberAsString = z.preprocess((value) => {
  if (value == null) return undefined;
  const normalized = String(value).trim();
  return normalized.length > 0 ? normalized : undefined;
}, z.string().optional());

