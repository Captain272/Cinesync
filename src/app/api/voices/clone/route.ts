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

const MAX_BYTES = 10 * 1024 * 1024; // stay under ElevenLabs' per-sample cap

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

// Compress a sample only if it exceeds the cap; otherwise pass it through
// untouched to preserve the best possible cloning quality.
async function compressSample(file: File): Promise<File> {
  const raw = Buffer.from(await file.arrayBuffer());
  if (raw.byteLength <= MAX_BYTES) return file;

  const work = await mkdtemp(join(tmpdir(), "cinesync-clone-"));
  const inFile = join(work, "in.bin");
  try {
    await writeFile(inFile, raw);
    // Mono 44.1kHz keeps voice fidelity high; step bitrate down until it fits.
    for (const kbps of [128, 96, 64, 48]) {
      const outFile = join(work, `out-${kbps}.mp3`);
      await runFfmpeg([
        "-y", "-i", inFile,
        "-vn", "-ac", "1", "-ar", "44100",
        "-c:a", "libmp3lame", "-b:a", `${kbps}k`,
        outFile,
      ]);
      const buf = await readFile(outFile);
      if (buf.byteLength <= MAX_BYTES) {
        const base = (file.name || "sample").replace(/\.[^.]+$/, "");
        return new File([new Uint8Array(buf)], `${base}.mp3`, { type: "audio/mpeg" });
      }
    }
    throw new Error(`Sample "${file.name}" is too long even after compression. Trim it to a shorter clip.`);
  } finally {
    await rm(work, { recursive: true, force: true }).catch(() => {});
  }
}

export async function POST(req: Request) {
  if (!process.env.ELEVENLABS_API_KEY) {
    return NextResponse.json({ error: "ELEVENLABS_API_KEY not configured" }, { status: 500 });
  }
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let inForm: FormData;
  try {
    inForm = await req.formData();
  } catch {
    return NextResponse.json({ error: "Expected multipart/form-data" }, { status: 400 });
  }

  const name = (inForm.get("name") as string | null)?.trim();
  const description = (inForm.get("description") as string | null)?.trim() || null;
  const language = (inForm.get("language") as string | null)?.trim() || null;
  const consent = inForm.get("consent") === "true";
  const files = inForm.getAll("files").filter((f): f is File => f instanceof File);

  if (!name) return NextResponse.json({ error: "Missing name" }, { status: 400 });
  if (files.length === 0) return NextResponse.json({ error: "Attach at least one audio sample" }, { status: 400 });
  if (!consent) return NextResponse.json({ error: "Consent is required to clone a voice" }, { status: 400 });

  const elForm = new FormData();
  elForm.append("name", name);
  if (description) elForm.append("description", description);
  try {
    for (const f of files) {
      const prepared = await compressSample(f);
      elForm.append("files", prepared, prepared.name || "sample.mp3");
    }
  } catch (e: any) {
    return NextResponse.json({ error: e.message ?? "Failed to prepare samples" }, { status: 400 });
  }
  if (language) elForm.append("labels", JSON.stringify({ language }));

  const elRes = await fetch("https://api.elevenlabs.io/v1/voices/add", {
    method: "POST",
    headers: { "xi-api-key": process.env.ELEVENLABS_API_KEY! },
    body: elForm,
  });
  if (!elRes.ok) {
    const text = await elRes.text().catch(() => "");
    return NextResponse.json(
      { error: `ElevenLabs (${elRes.status}): ${text.slice(0, 500)}` },
      { status: 502 }
    );
  }
  const { voice_id } = (await elRes.json()) as { voice_id: string };

  const admin = createAdminClient();
  const { data: row, error } = await admin
    .from("voices")
    .upsert(
      {
        elevenlabs_voice_id: voice_id,
        name,
        description,
        language,
        is_licensed: true,
      },
      { onConflict: "elevenlabs_voice_id" }
    )
    .select()
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  await admin.from("voice_consents").upsert(
    {
      user_id: user.id,
      voice_id: row.id,
      consent_document: `User confirmed they own or have permission to clone voice "${name}" at ${new Date().toISOString()}`,
    },
    { onConflict: "user_id,voice_id" }
  );

  return NextResponse.json({ voice: row });
}
