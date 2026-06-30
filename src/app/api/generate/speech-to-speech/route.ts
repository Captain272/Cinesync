import { NextResponse } from "next/server";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import ffmpegPath from "ffmpeg-static";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const maxDuration = 300;

const MAX_BYTES = 10 * 1024 * 1024; // ElevenLabs STS input cap (~11MB); stay safely under.

function runFfmpeg(args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    if (!ffmpegPath) return reject(new Error("ffmpeg binary not available"));
    const p = spawn(ffmpegPath as unknown as string, args, { stdio: ["ignore", "ignore", "pipe"] });
    let stderr = "";
    p.stderr.on("data", (c) => (stderr += c.toString()));
    p.on("error", reject);
    p.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`ffmpeg exited ${code}: ${stderr.slice(-500)}`));
    });
  });
}

// Transcode input to a compact mono MP3 so we never exceed the API's size cap.
// Performance/timing is preserved; only file size drops. Drops bitrate further
// for very large inputs.
async function compressForSts(input: Buffer, contentType: string): Promise<Buffer> {
  const work = await mkdtemp(join(tmpdir(), "cinesync-sts-"));
  const inFile = join(work, "in.bin");
  try {
    await writeFile(inFile, input);
    for (const kbps of [96, 64, 48, 32]) {
      const outFile = join(work, `out-${kbps}.mp3`);
      await runFfmpeg([
        "-y", "-i", inFile,
        "-vn", "-ac", "1", "-ar", "22050",
        "-c:a", "libmp3lame", "-b:a", `${kbps}k`,
        outFile,
      ]);
      const buf = await readFile(outFile);
      if (buf.byteLength <= MAX_BYTES) return buf;
    }
    throw new Error("Input audio is too long to fit the conversion size limit. Trim the clip and try again.");
  } finally {
    await rm(work, { recursive: true, force: true }).catch(() => {});
  }
}

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
  inputAudioPath: string;
  modelId?: string;
  voiceSettings?: VoiceSettings;
  removeBackgroundNoise?: boolean;
};

export async function POST(req: Request) {
  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { projectId, dubLineId, voiceDbId, elevenlabsVoiceId, inputAudioPath } = body;
  if (!projectId || !dubLineId || !voiceDbId || !elevenlabsVoiceId || !inputAudioPath) {
    return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
  }

  if (!process.env.ELEVENLABS_API_KEY) {
    return NextResponse.json({ error: "ELEVENLABS_API_KEY not configured" }, { status: 500 });
  }

  // Authenticate caller and verify ownership.
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data: project, error: pErr } = await supabase
    .from("projects").select("id, user_id").eq("id", projectId).single();
  if (pErr || !project || project.user_id !== user.id) {
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }

  // Use admin client to read private storage + write generated audio,
  // so this route doesn't depend on storage RLS being permissive enough.
  const admin = createAdminClient();

  // 1) Download input audio from Supabase Storage (input-performances)
  const { data: inputBlob, error: dlErr } = await admin.storage
    .from("input-performances")
    .download(inputAudioPath);
  if (dlErr || !inputBlob) {
    return NextResponse.json({ error: `Failed to read input audio: ${dlErr?.message}` }, { status: 500 });
  }

  // 2) Send to ElevenLabs Speech-to-Speech / Voice Changer
  // Endpoint: POST https://api.elevenlabs.io/v1/speech-to-speech/{voice_id}
  // Body: multipart/form-data with file=<audio>, model_id, voice_settings (optional)
  const form = new FormData();
  // Transcode to a compact mono MP3 so large WAV/long clips don't exceed the API cap.
  let audioFile: File;
  try {
    const rawBuf = Buffer.from(await inputBlob.arrayBuffer());
    const compressed = await compressForSts(rawBuf, inputBlob.type || "audio/webm");
    audioFile = new File([new Uint8Array(compressed)], "input.mp3", { type: "audio/mpeg" });
  } catch (e: any) {
    return NextResponse.json({ error: e.message ?? "Failed to prepare audio" }, { status: 400 });
  }
  form.append("audio", audioFile);
  const modelId = body.modelId || "eleven_multilingual_sts_v2";
  form.append("model_id", modelId);
  if (body.voiceSettings) {
    form.append("voice_settings", JSON.stringify(body.voiceSettings));
  }
  if (body.removeBackgroundNoise) {
    form.append("remove_background_noise", "true");
  }

  const elRes = await fetch(
    `https://api.elevenlabs.io/v1/speech-to-speech/${encodeURIComponent(elevenlabsVoiceId)}?output_format=mp3_44100_128`,
    {
      method: "POST",
      headers: {
        "xi-api-key": process.env.ELEVENLABS_API_KEY!,
        Accept: "audio/mpeg",
      },
      body: form,
    }
  );

  if (!elRes.ok) {
    const text = await elRes.text().catch(() => "");
    return NextResponse.json(
      { error: `ElevenLabs error (${elRes.status}): ${text.slice(0, 500)}` },
      { status: 502 }
    );
  }

  const mp3Buffer = Buffer.from(await elRes.arrayBuffer());

  // 3) Upload MP3 to generated-audio bucket
  const outPath = `${user.id}/${projectId}/${dubLineId}/${Date.now()}-converted.mp3`;
  const { error: upErr } = await admin.storage
    .from("generated-audio")
    .upload(outPath, mp3Buffer, { contentType: "audio/mpeg", upsert: false });
  if (upErr) {
    return NextResponse.json({ error: `Failed to save audio: ${upErr.message}` }, { status: 500 });
  }

  // 4) Insert audio_versions row
  const { data: version, error: vErr } = await admin
    .from("audio_versions")
    .insert({
      dub_line_id: dubLineId,
      generation_type: "speech_to_speech",
      voice_id: voiceDbId,
      audio_path: outPath,
      metadata: {
        elevenlabs_voice_id: elevenlabsVoiceId,
        model_id: modelId,
        voice_settings: body.voiceSettings ?? null,
        remove_background_noise: !!body.removeBackgroundNoise,
      },
    })
    .select()
    .single();
  if (vErr) {
    return NextResponse.json({ error: `Failed to record version: ${vErr.message}` }, { status: 500 });
  }

  await admin.from("dub_lines").update({ status: "done" }).eq("id", dubLineId);

  // 5) Return a signed URL the client can play immediately
  const { data: signed } = await admin.storage
    .from("generated-audio")
    .createSignedUrl(outPath, 3600);

  return NextResponse.json({
    versionId: version.id,
    audioPath: outPath,
    audioUrl: signed?.signedUrl ?? null,
  });
}
