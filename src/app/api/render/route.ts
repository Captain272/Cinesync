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

type Body = { projectId: string };

function runFfmpeg(args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    if (!ffmpegPath) return reject(new Error("ffmpeg binary not available"));
    const p = spawn(ffmpegPath as unknown as string, args, { stdio: ["ignore", "ignore", "pipe"] });
    let stderr = "";
    p.stderr.on("data", (c) => (stderr += c.toString()));
    p.on("error", reject);
    p.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`ffmpeg exited ${code}: ${stderr.slice(-800)}`));
    });
  });
}

export async function POST(req: Request) {
  let body: Body;
  try { body = (await req.json()) as Body; }
  catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }
  if (!body.projectId) return NextResponse.json({ error: "Missing projectId" }, { status: 400 });

  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data: project, error: pErr } = await supabase
    .from("projects").select("*").eq("id", body.projectId).single();
  if (pErr || !project || project.user_id !== user.id) {
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }
  if (!project.video_path) {
    return NextResponse.json({ error: "Project has no video" }, { status: 400 });
  }

  const admin = createAdminClient();

  const { data: lines } = await admin
    .from("dub_lines")
    .select("id, start_time, end_time")
    .eq("project_id", project.id)
    .order("start_time");
  if (!lines || lines.length === 0) {
    return NextResponse.json({ error: "No dialogue lines in project" }, { status: 400 });
  }
  const lineIds = lines.map((l) => l.id);

  const { data: versions } = await admin
    .from("audio_versions")
    .select("dub_line_id, audio_path, is_approved")
    .in("dub_line_id", lineIds)
    .eq("is_approved", true);
  if (!versions || versions.length === 0) {
    return NextResponse.json(
      { error: 'No approved versions. On each line, click "Use this" on the version you want to render.' },
      { status: 400 }
    );
  }

  const chosen = new Map<string, string>();
  for (const v of versions) chosen.set(v.dub_line_id, v.audio_path);

  const work = await mkdtemp(join(tmpdir(), "cinesync-render-"));
  const videoFile = join(work, "video.bin");
  const outFile = join(work, "out.mp4");

  try {
    const { data: vBlob, error: vErr } = await admin.storage
      .from("project-videos").download(project.video_path);
    if (vErr || !vBlob) throw new Error(`Download video: ${vErr?.message}`);
    await writeFile(videoFile, Buffer.from(await vBlob.arrayBuffer()));

    const clips: { path: string; startMs: number }[] = [];
    let i = 0;
    for (const line of lines) {
      const path = chosen.get(line.id);
      if (!path) continue;
      const { data: aBlob, error: aErr } = await admin.storage
        .from("generated-audio").download(path);
      if (aErr || !aBlob) continue;
      const clipPath = join(work, `clip-${i}.mp3`);
      await writeFile(clipPath, Buffer.from(await aBlob.arrayBuffer()));
      clips.push({ path: clipPath, startMs: Math.max(0, Math.round(line.start_time * 1000)) });
      i++;
    }
    if (clips.length === 0) {
      return NextResponse.json({ error: "No audio clips could be loaded" }, { status: 500 });
    }

    const args: string[] = ["-y", "-i", videoFile];
    for (const c of clips) args.push("-i", c.path);

    const filterParts: string[] = [];
    clips.forEach((c, idx) => {
      filterParts.push(`[${idx + 1}:a]adelay=${c.startMs}|${c.startMs}[a${idx}]`);
    });
    const mixInputs = clips.map((_, idx) => `[a${idx}]`).join("");
    if (clips.length === 1) {
      filterParts.push(`${mixInputs}aformat=channel_layouts=stereo[dub]`);
    } else {
      filterParts.push(`${mixInputs}amix=inputs=${clips.length}:dropout_transition=0:normalize=0[dub]`);
    }
    const filter = filterParts.join(";");

    args.push(
      "-filter_complex", filter,
      "-map", "0:v",
      "-map", "[dub]",
      "-c:v", "copy",
      "-c:a", "aac",
      "-b:a", "192k",
      "-shortest",
      outFile,
    );

    await runFfmpeg(args);

    const outBuf = await readFile(outFile);
    const outPath = `${user.id}/${project.id}/render-${Date.now()}.mp4`;
    const { error: upErr } = await admin.storage
      .from("project-videos")
      .upload(outPath, outBuf, { contentType: "video/mp4", upsert: false });
    if (upErr) throw new Error(`Upload render: ${upErr.message}`);

    const { data: signed } = await admin.storage
      .from("project-videos").createSignedUrl(outPath, 3600);

    return NextResponse.json({
      path: outPath,
      url: signed?.signedUrl ?? null,
      clips: clips.length,
    });
  } catch (e: any) {
    return NextResponse.json({ error: e.message ?? "Render failed" }, { status: 500 });
  } finally {
    await rm(work, { recursive: true, force: true }).catch(() => {});
  }
}
