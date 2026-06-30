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

function runFfmpeg(args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    if (!ffmpegPath) return reject(new Error("ffmpeg binary not available"));
    const p = spawn(ffmpegPath as unknown as string, args, { stdio: ["ignore", "ignore", "pipe"] });
    let stderr = "";
    p.stderr.on("data", (c) => (stderr += c.toString()));
    p.on("error", reject);
    p.on("close", (code) => code === 0 ? resolve() : reject(new Error(`ffmpeg ${code}: ${stderr.slice(-400)}`)));
  });
}

type Body = {
  projectId: string;
  sourceLang: string; // ISO code or "auto"
  targetLang: string; // ISO code
  numSpeakers?: number;
};

export async function POST(req: Request) {
  if (!process.env.ELEVENLABS_API_KEY) {
    return NextResponse.json({ error: "ELEVENLABS_API_KEY not configured" }, { status: 500 });
  }
  let body: Body;
  try { body = (await req.json()) as Body; }
  catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }

  const { projectId, sourceLang, targetLang, numSpeakers } = body;
  if (!projectId || !targetLang) {
    return NextResponse.json({ error: "Missing projectId or targetLang" }, { status: 400 });
  }

  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data: project } = await supabase
    .from("projects").select("*").eq("id", projectId).single();
  if (!project || project.user_id !== user.id) {
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }
  if (!project.video_path) {
    return NextResponse.json({ error: "Project has no video" }, { status: 400 });
  }

  const admin = createAdminClient();
  const { data: blob, error: dlErr } = await admin.storage
    .from("project-videos").download(project.video_path);
  if (dlErr || !blob) {
    return NextResponse.json({ error: `Download video: ${dlErr?.message}` }, { status: 500 });
  }

  // Extract audio only — the video frames don't change, so we dub the audio and
  // later mux it back onto the untouched original video (no re-encode).
  const work = await mkdtemp(join(tmpdir(), "cinesync-dub-"));
  const videoFile = join(work, "video.bin");
  const audioFile = join(work, "audio.mp3");
  let audioBuf: Buffer;
  try {
    await writeFile(videoFile, Buffer.from(await blob.arrayBuffer()));
    await runFfmpeg(["-y", "-i", videoFile, "-vn", "-c:a", "libmp3lame", "-b:a", "192k", audioFile]);
    audioBuf = await readFile(audioFile);
  } catch (e: any) {
    return NextResponse.json({ error: `Audio extract failed: ${e.message}` }, { status: 500 });
  } finally {
    await rm(work, { recursive: true, force: true }).catch(() => {});
  }

  const form = new FormData();
  form.append("file", new File([new Uint8Array(audioBuf)], "audio.mp3", { type: "audio/mpeg" }));
  if (sourceLang && sourceLang !== "auto") form.append("source_lang", sourceLang);
  form.append("target_lang", targetLang);
  if (numSpeakers && numSpeakers > 0) form.append("num_speakers", String(numSpeakers));
  form.append("watermark", "false");

  const res = await fetch("https://api.elevenlabs.io/v1/dubbing", {
    method: "POST",
    headers: { "xi-api-key": process.env.ELEVENLABS_API_KEY! },
    body: form,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    return NextResponse.json(
      { error: `ElevenLabs (${res.status}): ${text.slice(0, 500)}` },
      { status: 502 }
    );
  }
  const json = (await res.json()) as { dubbing_id: string; expected_duration_sec?: number };
  return NextResponse.json({
    dubbingId: json.dubbing_id,
    expectedDurationSec: json.expected_duration_sec ?? null,
    targetLang,
  });
}
