import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";

type ElVoice = {
  voice_id: string;
  name: string;
  description?: string | null;
  category?: string;
  labels?: Record<string, string>;
  preview_url?: string | null;
  fine_tuning?: { language?: string | null } | null;
};

export async function POST() {
  if (!process.env.ELEVENLABS_API_KEY) {
    return NextResponse.json({ error: "ELEVENLABS_API_KEY not configured" }, { status: 500 });
  }
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const res = await fetch("https://api.elevenlabs.io/v1/voices", {
    headers: { "xi-api-key": process.env.ELEVENLABS_API_KEY! },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    return NextResponse.json(
      { error: `ElevenLabs (${res.status}): ${text.slice(0, 500)}` },
      { status: 502 }
    );
  }
  const json = (await res.json()) as { voices: ElVoice[] };

  const admin = createAdminClient();
  const rows = json.voices.map((v) => ({
    elevenlabs_voice_id: v.voice_id,
    name: v.name,
    description: v.description ?? v.labels?.description ?? v.category ?? null,
    language: v.fine_tuning?.language ?? v.labels?.language ?? null,
    is_licensed: true,
  }));

  if (rows.length === 0) return NextResponse.json({ synced: 0 });

  const { error } = await admin
    .from("voices")
    .upsert(rows, { onConflict: "elevenlabs_voice_id" });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ synced: rows.length });
}
