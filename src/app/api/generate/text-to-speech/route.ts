import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const maxDuration = 120;

type VoiceSettings = {
  stability?: number;
  similarity_boost?: number;
  style?: number;
  use_speaker_boost?: boolean;
};

type Body = {
  projectId: string;
  dubLineId: string;
  voiceDbId: string;
  elevenlabsVoiceId: string;
  text: string;
  languageCode?: string;
  modelId?: string;
  voiceSettings?: VoiceSettings;
};

export async function POST(req: Request) {
  if (!process.env.ELEVENLABS_API_KEY) {
    return NextResponse.json({ error: "ELEVENLABS_API_KEY not configured" }, { status: 500 });
  }
  let body: Body;
  try { body = (await req.json()) as Body; }
  catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }

  const { projectId, dubLineId, voiceDbId, elevenlabsVoiceId, text } = body;
  if (!projectId || !dubLineId || !voiceDbId || !elevenlabsVoiceId || !text?.trim()) {
    return NextResponse.json({ error: "Missing fields" }, { status: 400 });
  }

  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data: project } = await supabase
    .from("projects").select("id, user_id").eq("id", projectId).single();
  if (!project || project.user_id !== user.id) {
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }

  const modelId = body.modelId || "eleven_multilingual_v2";
  const reqBody: Record<string, unknown> = {
    text: text.trim(),
    model_id: modelId,
  };
  if (body.voiceSettings) reqBody.voice_settings = body.voiceSettings;
  if (body.languageCode) reqBody.language_code = body.languageCode;

  const elRes = await fetch(
    `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(elevenlabsVoiceId)}?output_format=mp3_44100_128`,
    {
      method: "POST",
      headers: {
        "xi-api-key": process.env.ELEVENLABS_API_KEY!,
        "Content-Type": "application/json",
        Accept: "audio/mpeg",
      },
      body: JSON.stringify(reqBody),
    }
  );
  if (!elRes.ok) {
    const errTxt = await elRes.text().catch(() => "");
    return NextResponse.json(
      { error: `ElevenLabs (${elRes.status}): ${errTxt.slice(0, 500)}` },
      { status: 502 }
    );
  }
  const mp3 = Buffer.from(await elRes.arrayBuffer());

  const admin = createAdminClient();
  const outPath = `${user.id}/${projectId}/${dubLineId}/${Date.now()}-tts.mp3`;
  const { error: upErr } = await admin.storage
    .from("generated-audio")
    .upload(outPath, mp3, { contentType: "audio/mpeg", upsert: false });
  if (upErr) {
    return NextResponse.json({ error: `Save audio: ${upErr.message}` }, { status: 500 });
  }

  const { data: version, error: vErr } = await admin
    .from("audio_versions")
    .insert({
      dub_line_id: dubLineId,
      generation_type: "text_to_speech",
      voice_id: voiceDbId,
      audio_path: outPath,
      metadata: {
        elevenlabs_voice_id: elevenlabsVoiceId,
        model_id: modelId,
        language_code: body.languageCode ?? null,
        voice_settings: body.voiceSettings ?? null,
        source_text: text.trim(),
      },
    })
    .select()
    .single();
  if (vErr) {
    return NextResponse.json({ error: `Record version: ${vErr.message}` }, { status: 500 });
  }

  await admin.from("dub_lines").update({ status: "done" }).eq("id", dubLineId);

  const { data: signed } = await admin.storage
    .from("generated-audio").createSignedUrl(outPath, 3600);

  return NextResponse.json({
    versionId: version.id,
    audioPath: outPath,
    audioUrl: signed?.signedUrl ?? null,
  });
}
