// Security hardening (Module G).
// T-G1: one-time loopback tokens, constant-time compare (NOT requireBearerAuth — needs expiry).
// T-G2: loopback bind + Origin/Host allowlist (DNS-rebinding protection, CVE-2025-49596 class).

import { randomBytes, timingSafeEqual } from 'node:crypto';

export function mintToken(): string {
  return randomBytes(24).toString('base64url');
}

export function tokenMatches(a: string | undefined, b: string | undefined): boolean {
  if (!a || !b) return false;
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}

export const ALLOWED_HOSTS = ['127.0.0.1:7331', 'localhost:7331'];
export const ALLOWED_ORIGINS = [
  'http://localhost:5173',
  'http://127.0.0.1:5173',
  // PocketBase's default standalone origin (embedded Admin UI).
  'http://localhost:8090',
  'http://127.0.0.1:8090',
  'http://localhost:8080',
  'http://127.0.0.1:8080',
];

// Host header must be a loopback:port we recognise (blunts DNS-rebinding).
export function hostAllowed(host: string | undefined): boolean {
  return !!host && ALLOWED_HOSTS.includes(host);
}

// Origin, when present, must be an allowed dev origin. Absent Origin (native/node client,
// direct navigation) is treated as trusted loopback.
export function originAllowed(origin: string | undefined): boolean {
  return !origin || ALLOWED_ORIGINS.includes(origin);
}
