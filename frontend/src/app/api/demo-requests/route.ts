import { NextRequest, NextResponse } from "next/server";

import { createSystemSupabaseClient } from "@/lib/supabase/system";
import { sendDemoRequestNotification } from "@/services/demo-notification.server";

export const runtime = "nodejs";

type FieldName =
  "fullName" | "gymName" | "email" | "phone" | "city" | "country" | "message";

type DemoRequestBody = Partial<Record<FieldName | "website", unknown>> & {
  startedAt?: unknown;
};

type RateBucket = { count: number; resetAt: number };

const rateBuckets = new Map<string, RateBucket>();
const RATE_WINDOW_MS = 10 * 60 * 1000;
const RATE_LIMIT = 5;

function compact(value: unknown, maxLength: number): string {
  if (typeof value !== "string") return "";
  return value
    .trim()
    .replace(/\s+/g, " ")
    .slice(0, maxLength + 1);
}

function normalizeMessage(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.replace(/\r\n/g, "\n").trim();
  return normalized ? normalized.slice(0, 1001) : null;
}

function clientKey(request: NextRequest): string {
  return (
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    request.headers.get("x-real-ip") ||
    "unknown"
  );
}

function isRateLimited(key: string): boolean {
  const now = Date.now();
  const existing = rateBuckets.get(key);

  if (!existing || existing.resetAt <= now) {
    rateBuckets.set(key, { count: 1, resetAt: now + RATE_WINDOW_MS });
    return false;
  }

  existing.count += 1;
  if (rateBuckets.size > 500) {
    for (const [bucketKey, bucket] of rateBuckets) {
      if (bucket.resetAt <= now) rateBuckets.delete(bucketKey);
    }
  }
  if (rateBuckets.size > 1000) {
    const oldestKey = rateBuckets.keys().next().value as string | undefined;
    if (oldestKey) rateBuckets.delete(oldestKey);
  }
  return existing.count > RATE_LIMIT;
}

function validationErrors(body: DemoRequestBody) {
  const values = {
    fullName: compact(body.fullName, 120),
    gymName: compact(body.gymName, 160),
    email: compact(body.email, 254).toLowerCase(),
    phone: compact(body.phone, 40),
    city: compact(body.city, 120),
    country: compact(body.country, 120),
    message: normalizeMessage(body.message),
  };
  const errors: Partial<Record<FieldName, string>> = {};

  if (values.fullName.length < 2 || values.fullName.length > 120)
    errors.fullName = "Enter your full name.";
  if (values.gymName.length < 2 || values.gymName.length > 160)
    errors.gymName = "Enter your gym or studio name.";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(values.email))
    errors.email = "Enter a valid email address.";
  const phoneDigits = values.phone.replace(/\D/g, "");
  if (
    phoneDigits.length < 7 ||
    phoneDigits.length > 15 ||
    !/^[+()\d\s.-]+$/.test(values.phone)
  )
    errors.phone = "Enter a valid phone or WhatsApp number.";
  if (values.city.length < 2 || values.city.length > 120)
    errors.city = "Enter your city.";
  if (values.country.length < 2 || values.country.length > 120)
    errors.country = "Enter your country.";
  if (values.message && values.message.length > 1000)
    errors.message = "Keep your message under 1,000 characters.";

  return { values, errors };
}

function noStoreJson(body: unknown, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

export async function POST(request: NextRequest) {
  const contentLength = Number(request.headers.get("content-length") || 0);
  if (contentLength > 16_384)
    return noStoreJson({ error: "Request is too large." }, 413);

  const origin = request.headers.get("origin");
  if (origin && origin !== request.nextUrl.origin) {
    return noStoreJson({ error: "Invalid request origin." }, 403);
  }

  const rawBody = await request.text();
  if (rawBody.length > 16_384)
    return noStoreJson({ error: "Request is too large." }, 413);

  const body = (() => {
    try {
      return JSON.parse(rawBody) as DemoRequestBody;
    } catch {
      return null;
    }
  })();
  if (!body) return noStoreJson({ error: "Invalid request." }, 400);

  // Honeypot and minimum completion time: return a neutral success to bots
  // without creating database rows or exposing the protection mechanism.
  const startedAt = typeof body.startedAt === "number" ? body.startedAt : 0;
  const completionTime = Date.now() - startedAt;
  if (
    compact(body.website, 200) ||
    completionTime < 700 ||
    completionTime > 86_400_000
  ) {
    return noStoreJson({ ok: true });
  }

  if (isRateLimited(clientKey(request))) {
    return noStoreJson(
      { error: "Too many requests. Please wait a little before trying again." },
      429,
    );
  }

  const { values, errors } = validationErrors(body);
  if (Object.keys(errors).length) {
    return noStoreJson(
      { error: "Check the highlighted fields.", fieldErrors: errors },
      400,
    );
  }

  try {
    const supabase = createSystemSupabaseClient();
    const { data, error } = await supabase
      .from("demo_requests")
      .insert({
        full_name: values.fullName,
        gym_name: values.gymName,
        email: values.email,
        phone: values.phone,
        city: values.city,
        country: values.country,
        message: values.message,
        source: "public_homepage",
      })
      .select("id, created_at")
      .single();

    if (error || !data) {
      console.error("[demo-request] Database insert failed.", error?.code ?? "unknown");
      return noStoreJson(
        { error: "We couldn't save your request. Please try again." },
        500,
      );
    }

    try {
      const notification = await sendDemoRequestNotification({
        id: data.id,
        fullName: values.fullName,
        gymName: values.gymName,
        email: values.email,
        phone: values.phone,
        city: values.city,
        country: values.country,
        message: values.message,
        createdAt: data.created_at,
      });
      if (notification === "skipped") {
        console.warn(`[demo-request] Notification skipped for request ${data.id}.`);
      }
    } catch (notificationError) {
      console.error(
        `[demo-request] Notification failed for request ${data.id}.`,
        notificationError instanceof Error
          ? notificationError.message
          : "Unknown error",
      );
    }

    return noStoreJson({ ok: true });
  } catch (error) {
    console.error(
      "[demo-request] Unexpected submission failure.",
      error instanceof Error ? error.message : "Unknown error",
    );
    return noStoreJson(
      { error: "We couldn't save your request. Please try again." },
      500,
    );
  }
}
