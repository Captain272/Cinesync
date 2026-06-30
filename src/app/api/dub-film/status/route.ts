import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

export async function GET(req: Request) {
  if (!process.env.ELEVENLABS_API_KEY) {
    return NextResponse.json({ error: "ELEVENLABS_API_KEY not configured" }, { status: 500 });
  }
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const url = new URL(req.url);
  const dubbingId = url.searchParams.get("dubbingId");
  if (!dubbingId) return NextResponse.json({ error: "Missing dubbingId" }, { status: 400 });

  const res = await fetch(`https://api.elevenlabs.io/v1/dubbing/${encodeURIComponent(dubbingId)}`, {
    headers: { "xi-api-key": process.env.ELEVENLABS_API_KEY! },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    return NextResponse.json(
      { error: `ElevenLabs (${res.status}): ${text.slice(0, 300)}` },
      { status: 502 }
    );
  }
  const json = await res.json();
  return NextResponse.json({
    dubbingId,
    status: json.status as string, // "dubbing" | "dubbed" | "failed"
    targetLanguages: json.target_languages ?? [],
    error: json.error ?? null,
  });
}
