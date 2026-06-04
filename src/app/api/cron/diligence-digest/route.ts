import { NextRequest, NextResponse } from "next/server";
import { runDiligenceDigest } from "@/lib/diligence/digest";

// =============================================================================
// Scheduled outstanding-items digest (Increment 2)
// =============================================================================
// Hit on a schedule by Vercel Cron (see vercel.json). Sends each assignee a
// summary of their open diligence items (in-app always; email when Resend is
// configured). When CRON_SECRET is set, the request must carry
// `Authorization: Bearer <CRON_SECRET>` — Vercel Cron sends this automatically
// when the env var is present, and it lets us trigger manually too.
// =============================================================================

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const auth = request.headers.get("authorization");
    if (auth !== `Bearer ${secret}`) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

  try {
    const result = await runDiligenceDigest();
    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: (e as Error).message },
      { status: 500 }
    );
  }
}
