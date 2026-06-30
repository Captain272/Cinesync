import { NextResponse } from "next/server";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import ffmpegPath from "ffmpeg-static";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const maxDuration = 120;

type Body = {
  dubLineId?: string;
  projectId?: string;
  start: number;
  end: number;
  attachToLineId?: string;
};

function runFfmpeg(args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    if (!ffmpegPath) return reject(new Error("ffmpeg binary not available"));
    const p = spawn(ffmpegPath as unknown as string, args, { stdio: ["ignore", "ignore", "pipe"] });
    let stderr = "";
    p.stderr.on("data", (c) => (stderr += c.toString()));
    p.on("error", reject);
    p.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`ffmpeg exited ${code}: ${stderr.slice(-600)}`));
    });
  });
}

export async function POST(req: Request) {
  let body: Body;
  try { body = (await req.json()) as Body; }
  catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }

  const { start, end } = body;
  if (typeof start !== "number" || typeof end !== "number" || end <= start || start < 0) {
    return NextResponse.json({ error: "Invalid start/end" }, { status: 400 });
  }

  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let projectId = body.projectId;
  let attachLineId = body.attachToLineId ?? body.dubLineId ?? null;

  if (body.dubLineId && !projectId) {
    const { data: line } = await supabase
      .from("dub_lines").select("project_id").eq("id", body.dubLineId).single();
    if (!line) return NextResponse.json({ error: "Line not found" }, { status: 404 });
    projectId = line.project_id as string;
  }
  if (!projectId) return NextResponse.json({ error: "Missing projectId" }, { status: 400 });

  const { data: project } = await supabase
    .from("projects").select("*").eq("id", projectId).single();
  if (!project || project.user_id !== user.id) {
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }
  if (!project.video_path) {
    return NextResponse.json({ error: "Project has no video" }, { status: 400 });
  }

  const admin = createAdminClient();
  const work = await mkdtemp(join(tmpdir(), "cinesync-extract-"));
  const videoFile = join(work, "video.bin");
  const audioFile = join(work, "slice.mp3");

  try {
    const { data: vBlob, error: vErr } = await admin.storage
      .from("project-videos").download(project.video_path);
    if (vErr || !vBlob) throw new Error(`Download video: ${vErr?.message}`);
    await writeFile(videoFile, Buffer.from(await vBlob.arrayBuffer()));

    const duration = end - start;
    await runFfmpeg([
      "-y",
      "-ss", start.toFixed(3),
      "-t", duration.toFixed(3),
      "-i", videoFile,
      "-vn", "-ac", "2", "-ar", "44100",
      "-c:a", "libmp3lame", "-b:a", "128k",
      audioFile,
    ]);

    const buf = await readFile(audioFile);
    const storagePath = `${user.id}/${projectId}/extract-${Date.now()}.mp3`;
    const { error: upErr } = await admin.storage
      .from("input-performances")
      .upload(storagePath, buf, { contentType: "audio/mpeg", upsert: false });
    if (upErr) throw new Error(`Upload: ${upErr.message}`);

    let lineId = attachLineId;
    if (lineId) {
      const { error: updErr } = await admin
        .from("dub_lines")
        .update({
          start_time: start,
          end_time: end,
          input_audio_path: storagePath,
          status: "ready",
        })
        .eq("id", lineId)
        .eq("project_id", projectId);
      if (updErr) throw new Error(`Update line: ${updErr.message}`);
    } else {
      const { data: row, error: insErr } = await admin
        .from("dub_lines")
        .insert({
          project_id: projectId,
          start_time: start,
          end_time: end,
          input_audio_path: storagePath,
          status: "ready",
        })
        .select("id")
        .single();
      if (insErr) throw new Error(`Insert line: ${insErr.message}`);
      lineId = row.id;
    }

    return NextResponse.json({ lineId, audioPath: storagePath });
  } catch (e: any) {
    return NextResponse.json({ error: e.message ?? "Extract failed" }, { status: 500 });
  } finally {
    await rm(work, { recursive: true, force: true }).catch(() => {});
  }
}
