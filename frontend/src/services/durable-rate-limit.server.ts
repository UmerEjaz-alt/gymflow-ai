import "server-only";

import { createHmac } from "node:crypto";

import { createSystemSupabaseClient } from "@/lib/supabase/system";

type RateLimitResult =
  | { allowed: boolean; remaining: number; resetAt: string; error: null }
  | { allowed: false; remaining: 0; resetAt: null; error: string };

function rateLimitSecret(): string {
  const secret = process.env.RATE_LIMIT_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error("RATE_LIMIT_SECRET must contain at least 32 characters.");
  }
  return secret;
}

/** Hashes identifiers before persistence so IP addresses and phone numbers are not stored. */
export function rateLimitBucket(scope: string, ...identifiers: string[]): string {
  return `${scope}:${createHmac("sha256", rateLimitSecret())
    .update(identifiers.join("\u0000"))
    .digest("hex")}`;
}

export async function consumeDurableRateLimit(input: {
  bucket: string;
  limit: number;
  windowSeconds: number;
}): Promise<RateLimitResult> {
  try {
    const supabase = createSystemSupabaseClient();
    const { data, error } = await supabase.rpc("consume_rate_limit", {
      p_bucket_key: input.bucket,
      p_limit: input.limit,
      p_window_seconds: input.windowSeconds,
    });
    const row = Array.isArray(data) ? data[0] : null;
    if (error || !row) {
      return {
        allowed: false,
        remaining: 0,
        resetAt: null,
        error: error?.message ?? "Rate-limit state was unavailable.",
      };
    }
    return {
      allowed: row.allowed === true,
      remaining: Number(row.remaining ?? 0),
      resetAt: String(row.reset_at),
      error: null,
    };
  } catch (error) {
    return {
      allowed: false,
      remaining: 0,
      resetAt: null,
      error: error instanceof Error ? error.message : "Rate-limit check failed.",
    };
  }
}
