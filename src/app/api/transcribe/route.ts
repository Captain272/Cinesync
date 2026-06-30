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

type Body = {
  projectId: string;
  mode?: "auto" | "full";
  duration?: number;
};

type ScribeWord = {
  text: string;
  start: number;
  end: number;
  type: "word" | "spacing" | "audio_event";
  speaker_id?: string;
};

type Segment = {
  start: number;
  end: number;
  text: string;
  speaker?: string;
};

const MAX_SEG = 15;
const MIN_SEG = 6;
const PAUSE_SPLIT = 1.0;
const PAD_HEAD = 0;
const PAD_TAIL = 0;

function groupWords(words: ScribeWord[]): Segment[] {
  const segs: Segment[] = [];
  let cur: { start: number; end: number; parts: string[]; speaker?: string } | null = null;
  let lastEnd = 0;

  const flush = () => {
    if (!cur) return;
    const text = cur.parts.join("").replace(/\s+/g, " ").trim();
    if (text) segs.push({ start: cur.start, end: cur.end, text, speaker: cur.speaker });
    cur = null;
  };

  for (const w of words) {
    if (w.type === "audio_event") continue;
    if (w.type === "spacing") {
      if (cur) cur.parts.push(w.text || " ");
      continue;
    }
    const gap = cur ? w.start - lastEnd : 0;
    const speakerChange = cur && w.speaker_id && cur.speaker && w.speaker_id !== cur.speaker;
    const tooLong = cur && w.end - cur.start > MAX_SEG;
    const longEnough = !!cur && cur.end - cur.start >= MIN_SEG;
    const pauseSplit = longEnough && gap > PAUSE_SPLIT;

    if (cur && (speakerChange || tooLong || pauseSplit)) {
      flush();
    }

    if (!cur) {
      cur = { start: w.start, end: w.end, parts: [w.text], speaker: w.speaker_id };
    } else {
      cur.parts.push(w.text);
      cur.end = w.end;
    }
    lastEnd = w.end;
  }
  flush();
  return segs;
}

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

export async function POST(req: Request) {
  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  if (!body.projectId) return NextResponse.json({ error: "Missing projectId" }, { status: 400 });
  if (!process.env.ELEVENLABS_API_KEY) {
    return NextResponse.json({ error: "ELEVENLABS_API_KEY not configured" }, { status: 500 });
  }

  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data: project, error: pErr } = await supabase
    .from("projects").select("*").eq("id", body.projectId).single();
  if (pErr || !project || project.user_id !== user.id) {
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }
  if (!project.video_path) {
    return NextResponse.json({ error: "Project has no video uploaded" }, { status: 400 });
  }

  const admin = createAdminClient();
  const work = await mkdtemp(join(tmpdir(), "cinesync-"));
  const videoFile = join(work, "video.bin");
  const audioFile = join(work, "audio.mp3");

  try {
    const { data: videoBlob, error: dlErr } = await admin.storage
      .from("project-videos").download(project.video_path);
    if (dlErr || !videoBlob) throw new Error(`Download failed: ${dlErr?.message}`);
    await writeFile(videoFile, Buffer.from(await videoBlob.arrayBuffer()));

    await runFfmpeg([
      "-y", "-i", videoFile,
      "-vn", "-ac", "1", "-ar", "16000",
      "-b:a", "96k", audioFile,
    ]);

    if (body.mode === "full") {
      const fullMp3 = join(work, "full.mp3");
      await runFfmpeg([
        "-y", "-i", audioFile, "-c:a", "libmp3lame", "-b:a", "128k", fullMp3,
      ]);
      const fullBuf = await readFile(fullMp3);
      const storagePath = `${user.id}/${project.id}/full-${Date.now()}.mp3`;
      const { error: upErr } = await admin.storage
        .from("input-performances")
        .upload(storagePath, fullBuf, { contentType: "audio/mpeg", upsert: false });
      if (upErr) throw new Error(`Upload full clip: ${upErr.message}`);

      const dur = typeof body.duration === "number" && body.duration > 0 ? body.duration : 0;
      const { error: insErr } = await admin
        .from("dub_lines")
        .insert({
          project_id: project.id,
          start_time: 0,
          end_time: dur,
          dialogue_text: null,
          input_audio_path: storagePath,
          status: "ready",
        });
      if (insErr) throw new Error(`Insert full line: ${insErr.message}`);

      return NextResponse.json({ inserted: 1, mode: "full" });
    }

    const audioBuf = await readFile(audioFile);

    const form = new FormData();
    form.append("file", new File([audioBuf], "audio.mp3", { type: "audio/mpeg" }));
    form.append("model_id", "scribe_v1");
    form.append("timestamps_granularity", "word");
    form.append("diarize", "true");
    form.append("tag_audio_events", "false");

    const scribeRes = await fetch("https://api.elevenlabs.io/v1/speech-to-text", {
      method: "POST",
      headers: { "xi-api-key": process.env.ELEVENLABS_API_KEY! },
      body: form,
    });
    if (!scribeRes.ok) {
      const text = await scribeRes.text().catch(() => "");
      return NextResponse.json(
        { error: `Scribe error (${scribeRes.status}): ${text.slice(0, 500)}` },
        { status: 502 }
      );
    }
    const scribe = (await scribeRes.json()) as { words?: ScribeWord[] };
    const words = scribe.words ?? [];
    const segments = groupWords(words);
    if (segments.length === 0) {
      return NextResponse.json({ inserted: 0, message: "No speech detected" });
    }

    await admin.from("dub_lines").delete().eq("project_id", project.id).is("input_audio_path", null).eq("status", "draft");

    const inserted: string[] = [];
    for (let i = 0; i < segments.length; i++) {
      const seg = segments[i];
      const prevEnd = i > 0 ? segments[i - 1].end : 0;
      const nextStart = i < segments.length - 1 ? segments[i + 1].start : Number.POSITIVE_INFINITY;
      const paddedStart = Math.max(0, Math.max(prevEnd, seg.start - PAD_HEAD));
      const paddedEnd = Math.min(nextStart, seg.end + PAD_TAIL);
      const segPath = join(work, `seg-${i}.mp3`);
      const duration = Math.max(0.1, paddedEnd - paddedStart);
      await runFfmpeg([
        "-y", "-ss", paddedStart.toFixed(3), "-t", duration.toFixed(3),
        "-i", audioFile, "-c:a", "libmp3lame", "-b:a", "128k", segPath,
      ]);
      const segBuf = await readFile(segPath);
      const storagePath = `${user.id}/${project.id}/transcript-${Date.now()}-${i}.mp3`;
      const { error: upErr } = await admin.storage
        .from("input-performances")
        .upload(storagePath, segBuf, { contentType: "audio/mpeg", upsert: false });
      if (upErr) throw new Error(`Upload seg ${i}: ${upErr.message}`);

      const baseRow: Record<string, unknown> = {
        project_id: project.id,
        start_time: paddedStart,
        end_time: paddedEnd,
        dialogue_text: seg.text,
        input_audio_path: storagePath,
        status: "ready",
      };
      let { data: row, error: insErr } = await admin
        .from("dub_lines")
        .insert({ ...baseRow, speaker_id: seg.speaker ?? null })
        .select("id")
        .single();
      // Self-heal if the optional speaker_id column hasn't been migrated yet.
      if (insErr && /speaker_id/.test(insErr.message)) {
        ({ data: row, error: insErr } = await admin
          .from("dub_lines")
          .insert(baseRow)
          .select("id")
          .single());
      }
      if (insErr || !row) throw new Error(`Insert seg ${i}: ${insErr?.message ?? "no row"}`);
      inserted.push(row.id);
    }

    return NextResponse.json({ inserted: inserted.length });
  } catch (e: any) {
    return NextResponse.json({ error: e.message ?? "Transcription failed" }, { status: 500 });
  } finally {
    await rm(work, { recursive: true, force: true }).catch(() => {});
  }
}
