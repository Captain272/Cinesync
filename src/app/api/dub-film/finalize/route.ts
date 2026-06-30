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
  dubbingId: string;
  targetLang: string;
};

export async function POST(req: Request) {
  if (!process.env.ELEVENLABS_API_KEY) {
    return NextResponse.json({ error: "ELEVENLABS_API_KEY not configured" }, { status: 500 });
  }
  let body: Body;
  try { body = (await req.json()) as Body; }
  catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }

  const { projectId, dubbingId, targetLang } = body;
  if (!projectId || !dubbingId || !targetLang) {
    return NextResponse.json({ error: "Missing fields" }, { status: 400 });
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

  // Pull the dubbed audio from ElevenLabs.
  const elRes = await fetch(
    `https://api.elevenlabs.io/v1/dubbing/${encodeURIComponent(dubbingId)}/audio/${encodeURIComponent(targetLang)}`,
    { headers: { "xi-api-key": process.env.ELEVENLABS_API_KEY! } }
  );
  if (!elRes.ok) {
    const text = await elRes.text().catch(() => "");
    return NextResponse.json(
      { error: `ElevenLabs (${elRes.status}): ${text.slice(0, 500)}` },
      { status: 502 }
    );
  }
  const dubbedAudio = Buffer.from(await elRes.arrayBuffer());

  const admin = createAdminClient();

  // Mux the dubbed audio onto the ORIGINAL video (video copied, not re-encoded).
  const { data: vBlob, error: vErr } = await admin.storage
    .from("project-videos").download(project.video_path);
  if (vErr || !vBlob) {
    return NextResponse.json({ error: `Download original video: ${vErr?.message}` }, { status: 500 });
  }

  const work = await mkdtemp(join(tmpdir(), "cinesync-mux-"));
  const videoFile = join(work, "video.bin");
  const audioFile = join(work, "dub.mp3");
  const outFile = join(work, "out.mp4");
  let outBuf: Buffer;
  try {
    await writeFile(videoFile, Buffer.from(await vBlob.arrayBuffer()));
    await writeFile(audioFile, dubbedAudio);
    await runFfmpeg([
      "-y", "-i", videoFile, "-i", audioFile,
      "-map", "0:v", "-map", "1:a",
      "-c:v", "copy", "-c:a", "aac", "-b:a", "192k",
      "-shortest", outFile,
    ]);
    outBuf = await readFile(outFile);
  } catch (e: any) {
    return NextResponse.json({ error: `Mux failed: ${e.message}` }, { status: 500 });
  } finally {
    await rm(work, { recursive: true, force: true }).catch(() => {});
  }

  const outPath = `${user.id}/${projectId}/film-dub-${targetLang}-${Date.now()}.mp4`;
  const { error: upErr } = await admin.storage
    .from("project-videos")
    .upload(outPath, outBuf, { contentType: "video/mp4", upsert: false });
  if (upErr) return NextResponse.json({ error: upErr.message }, { status: 500 });

  const { data: signed } = await admin.storage
    .from("project-videos").createSignedUrl(outPath, 3600);

  return NextResponse.json({ path: outPath, url: signed?.signedUrl ?? null });
}
