import { createHmac } from "node:crypto";
import { env } from "../config/env.js";

export interface AuthTokenPayload {
  sub: string;
  nome: string;
  email: string;
  perfil: string;
  iat: number;
  exp: number;
}

function base64UrlEncode(input: string): string {
  return Buffer.from(input, "utf8")
    .toString("base64")
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
}

function base64UrlDecode(input: string): string {
  const normalized = input.replace(/-/g, "+").replace(/_/g, "/");
  const padding = normalized.length % 4 === 0 ? "" : "=".repeat(4 - (normalized.length % 4));
  return Buffer.from(`${normalized}${padding}`, "base64").toString("utf8");
}

function signRaw(value: string): string {
  return createHmac("sha256", env.JWT_SECRET_KEY)
    .update(value)
    .digest("base64")
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
}

export function signAuthToken(payload: Omit<AuthTokenPayload, "iat" | "exp">, expiresInSeconds = 8 * 60 * 60): string {
  const header = { alg: "HS256", typ: "JWT" };
  const now = Math.floor(Date.now() / 1000);
  const fullPayload: AuthTokenPayload = {
    ...payload,
    iat: now,
    exp: now + expiresInSeconds,
  };
  const encodedHeader = base64UrlEncode(JSON.stringify(header));
  const encodedPayload = base64UrlEncode(JSON.stringify(fullPayload));
  const signature = signRaw(`${encodedHeader}.${encodedPayload}`);
  return `${encodedHeader}.${encodedPayload}.${signature}`;
}

export function verifyAuthToken(token: string): AuthTokenPayload {
  const parts = token.split(".");
  if (parts.length !== 3) throw new Error("invalid token format");

  const [encodedHeader, encodedPayload, receivedSignature] = parts;
  const expectedSignature = signRaw(`${encodedHeader}.${encodedPayload}`);
  if (receivedSignature !== expectedSignature) throw new Error("invalid signature");

  const payload = JSON.parse(base64UrlDecode(encodedPayload)) as AuthTokenPayload;
  const now = Math.floor(Date.now() / 1000);
  if (!payload.exp || payload.exp <= now) throw new Error("token expired");

  return payload;
}
