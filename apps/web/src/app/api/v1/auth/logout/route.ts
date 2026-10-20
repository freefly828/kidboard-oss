/**
 * POST /api/v1/auth/logout
 */

import { NextResponse } from "next/server";
import { destroySession } from "@/lib/session";
import { jsonError } from "@/lib/auth-guard";

export async function POST() {
  try {
    await destroySession();
    return NextResponse.json({ ok: true });
  } catch (err) {
    return jsonError(err);
  }
}
