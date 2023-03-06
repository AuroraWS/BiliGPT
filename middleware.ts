import { Redis } from "@upstash/redis";
import type { NextFetchEvent, NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { validateLicenseKey } from "./lib/lemon";
import { checkOpenaiApiKeys } from "./lib/openai/openai";
import { ratelimit } from "./lib/upstash";
import { isDev } from "./utils/env";

const redis = Redis.fromEnv();

export async function middleware(req: NextRequest, context: NextFetchEvent) {
  const { apiKey, bvId } = await req.json();

  // licenseKeys
  if (apiKey) {
    if (checkOpenaiApiKeys(apiKey)) {
      return NextResponse.next();
    }

    // 3. something-invalid-sdalkjfasncs-key
    if (!(await validateLicenseKey(apiKey, bvId))) {
      return NextResponse.redirect(new URL("/shop", req.url));
    }
  }
  // TODO: unique to a user (userid, email etc) instead of IP
  const identifier = req.ip ?? "127.0.0.7";
  const { success, remaining } = await ratelimit.limit(identifier);
  console.log(`======== ip ${identifier}, remaining: ${remaining} ========`);
  if (!apiKey && !success) {
    return NextResponse.redirect(new URL("/shop", req.url));
  }

  const result = await redis.get<string>(bvId);
  if (result) {
    console.log("hit cache for ", bvId);
    return NextResponse.json(result);
  }
}

export const config = {
  matcher: "/api/summarize",
};
