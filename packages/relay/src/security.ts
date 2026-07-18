// Security hardening (Module G).
// T-G1: one-time loopback token, constant-time compare (NOT requireBearerAuth — that needs expiry).
// T-G2: loopback bind + Origin/Host allowlist (DNS-rebinding protection).
//
// TODO(T-G1/G2): Express middleware + bind ws token <-> MCP session.

import { randomBytes, timingSafeEqual } from 'node:crypto';

export function mintToken(): string {
  return randomBytes(24).toString('base64url');
}

export function tokenMatches(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}

export const ALLOWED_HOSTS = ['127.0.0.1:7331', 'localhost:7331'];
export const ALLOWED_ORIGINS = ['http://localhost:5173', 'http://127.0.0.1:5173'];
