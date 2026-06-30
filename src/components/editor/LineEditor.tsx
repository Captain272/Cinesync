"use client";
import { useEffect, useRef, useState } from "react";
import { Mic, Upload, Square, Sparkles, Loader2, Scissors, Trash2, Languages } from "lucide-react";
import { languageName } from "@/lib/languages";
import { INDIAN_LANGUAGES } from "@/lib/languages";
import { useTuningDefaults, TTS_EMOTION } from "./useTuningDefaults";
import { motion } from "framer-motion";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input, Textarea } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import type { AudioVersion, DubLine, Project, Voice } from "@/lib/types";
import { formatTime } from "@/lib/utils";

export function LineEditor({
  project,
  line,
  voices,
  onChange,
  onManageVoices,
  getPlayheadTime,
  translateContext,
}: {
  project: Project;
  line: DubLine;
  voices: Voice[];
  onChange: (patch: Partial<DubLine>) => void;
  onManageVoices?: () => void;
  getPlayheadTime?: () => number;
  translateContext?: string;
}) {
  const supabase = createClient();
  const [inputUrl, setInputUrl] = useState<string | null>(null);
  const [recording, setRecording] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [extracting, setExtracting] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [versions, setVersions] = useState<(AudioVersion & { signedUrl?: string })[]>([]);
  const [error, setError] = useState<string | null>(null);

  const [showTuning, setShowTuning] = useState(false);
  const { tuning, update: updateTuning } = useTuningDefaults();
  const { modelId, stability, similarity, style, speakerBoost, denoise } = tuning;
  const setModelId = (v: string) => updateTuning({ modelId: v });
  const setStability = (v: number) => updateTuning({ stability: v });
  const setSimilarity = (v: number) => updateTuning({ similarity: v });
  const setStyle = (v: number) => updateTuning({ style: v });
  const setSpeakerBoost = (v: boolean) => updateTuning({ speakerBoost: v });
  const setDenoise = (v: boolean) => updateTuning({ denoise: v });
  const [ttsText, setTtsText] = useState(line.translated_text ?? "");
  const [ttsLang, setTtsLang] = useState("");
  const [ttsGenerating, setTtsGenerating] = useState(false);
  const [translating, setTranslating] = useState(false);

  // Re-seed the spoken text when switching lines (or after a bulk translate).
  useEffect(() => { setTtsText(line.translated_text ?? ""); }, [line.id, line.translated_text]);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);

  useEffect(() => {
    (async () => {
      setError(null);
      // Resolve input performance signed URL
      if (line.input_audio_path) {
        const { data } = await supabase.storage
          .from("input-performances")
          .createSignedUrl(line.input_audio_path, 3600);
        setInputUrl(data?.signedUrl ?? null);
      } else setInputUrl(null);

      // Load versions
      const { data: rows } = await supabase
        .from("audio_versions")
        .select("*")
        .eq("dub_line_id", line.id)
        .order("created_at", { ascending: false });
      const resolved = await Promise.all(
        (rows ?? []).map(async (v) => {
          const { data } = await supabase.storage
            .from("generated-audio")
            .createSignedUrl(v.audio_path, 3600);
          return { ...(v as AudioVersion), signedUrl: data?.signedUrl };
        })
      );
      setVersions(resolved);
    })();
  }, [line.id, line.input_audio_path]);

  async function uploadPerformanceBlob(blob: Blob, fileName: string) {
    setUploading(true); setError(null);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Not authenticated");
      const path = `${user.id}/${project.id}/${line.id}/${Date.now()}-${fileName}`;
      const { error: upErr } = await supabase.storage
        .from("input-performances")
        .upload(path, blob, { upsert: true, contentType: blob.type || "audio/webm" });
      if (upErr) throw upErr;
      onChange({ input_audio_path: path, status: "ready" });
      const { data } = await supabase.storage
        .from("input-performances").createSignedUrl(path, 3600);
      setInputUrl(data?.signedUrl ?? null);
    } catch (e: any) {
      setError(e.message ?? "Upload failed");
    } finally {
      setUploading(false);
    }
  }

  async function startRecording() {
    setError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mr = new MediaRecorder(stream);
      chunksRef.current = [];
      mr.ondataavailable = (e) => { if (e.data.size > 0) chunksRef.current.push(e.data); };
      mr.onstop = async () => {
        const blob = new Blob(chunksRef.current, { type: "audio/webm" });
        stream.getTracks().forEach((t) => t.stop());
        await uploadPerformanceBlob(blob, "performance.webm");
      };
      mediaRecorderRef.current = mr;
      mr.start();
      setRecording(true);
    } catch (e: any) {
      setError(e.message ?? "Mic access denied");
    }
  }

  function stopRecording() {
    mediaRecorderRef.current?.stop();
    setRecording(false);
  }

  async function handleExtractFromVideo() {
    setError(null);
    if (line.end_time <= line.start_time) {
      setError("End time must be greater than start time.");
      return;
    }
    setExtracting(true);
    try {
      const res = await fetch("/api/extract-audio", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          dubLineId: line.id,
          attachToLineId: line.id,
          start: line.start_time,
          end: line.end_time,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Extract failed");
      onChange({ input_audio_path: json.audioPath, status: "ready" });
      const { data } = await supabase.storage
        .from("input-performances").createSignedUrl(json.audioPath, 3600);
      setInputUrl(data?.signedUrl ?? null);
    } catch (e: any) {
      setError(e.message ?? "Extract failed");
    } finally {
      setExtracting(false);
    }
  }

  async function handleUploadAudio(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;
    await uploadPerformanceBlob(f, f.name);
  }

  async function handleGenerate() {
    if (!line.input_audio_path) return setError("Record or upload a performance first.");
    if (!line.selected_voice_id) return setError("Select a target voice.");
    setGenerating(true); setError(null);
    onChange({ status: "generating" });
    try {
      const voice = voices.find((v) => v.id === line.selected_voice_id);
      if (!voice) throw new Error("Voice not found");
      const res = await fetch("/api/generate/speech-to-speech", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectId: project.id,
          dubLineId: line.id,
          voiceDbId: voice.id,
          elevenlabsVoiceId: voice.elevenlabs_voice_id,
          inputAudioPath: line.input_audio_path,
          modelId,
          voiceSettings: {
            stability,
            similarity_boost: similarity,
            style,
            use_speaker_boost: speakerBoost,
          },
          removeBackgroundNoise: denoise,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Generation failed");

      onChange({ status: "done" });

      // Reload versions
      const { data: rows } = await supabase
        .from("audio_versions").select("*")
        .eq("dub_line_id", line.id)
        .order("created_at", { ascending: false });
      const resolved = await Promise.all(
        (rows ?? []).map(async (v) => {
          const { data } = await supabase.storage
            .from("generated-audio").createSignedUrl(v.audio_path, 3600);
          return { ...(v as AudioVersion), signedUrl: data?.signedUrl };
        })
      );
      setVersions(resolved);
    } catch (e: any) {
      onChange({ status: "error" });
      setError(e.message ?? "Generation failed");
    } finally {
      setGenerating(false);
    }
  }

  async function deleteVersion(v: AudioVersion) {
    if (!confirm("Delete this version? This cannot be undone.")) return;
    await supabase.storage.from("generated-audio").remove([v.audio_path]);
    await supabase.from("audio_versions").delete().eq("id", v.id);
    setVersions((prev) => prev.filter((x) => x.id !== v.id));
  }

  async function handleTranslate() {
    setError(null);
    const source = (line.dialogue_text || "").trim();
    if (!source) return setError("This line has no transcript text to translate.");
    if (!ttsLang) return setError("Pick a target language to translate into.");
    setTranslating(true);
    try {
      const res = await fetch("/api/translate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: source, targetLang: ttsLang, context: translateContext || undefined }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Translation failed");
      setTtsText(json.translated);
      onChange({ translated_text: json.translated });
    } catch (e: any) {
      setError(e.message ?? "Translation failed");
    } finally {
      setTranslating(false);
    }
  }

  async function handleGenerateFromText() {
    setError(null);
    const text = (ttsText || line.dialogue_text || "").trim();
    if (!text) return setError("Type or paste the target-language text first.");
    if (!line.selected_voice_id) return setError("Select a target voice.");
    setTtsGenerating(true);
    onChange({ status: "generating" });
    try {
      const voice = voices.find((v) => v.id === line.selected_voice_id);
      if (!voice) throw new Error("Voice not found");
      const res = await fetch("/api/generate/text-to-speech", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectId: project.id,
          dubLineId: line.id,
          voiceDbId: voice.id,
          elevenlabsVoiceId: voice.elevenlabs_voice_id,
          text,
          languageCode: ttsLang || undefined,
          voiceSettings: TTS_EMOTION,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "TTS failed");
      onChange({ status: "done" });
      const { data: rows } = await supabase
        .from("audio_versions").select("*")
        .eq("dub_line_id", line.id)
        .order("created_at", { ascending: false });
      const resolved = await Promise.all(
        (rows ?? []).map(async (v) => {
          const { data } = await supabase.storage
            .from("generated-audio").createSignedUrl(v.audio_path, 3600);
          return { ...(v as AudioVersion), signedUrl: data?.signedUrl };
        })
      );
      setVersions(resolved);
    } catch (e: any) {
      onChange({ status: "error" });
      setError(e.message ?? "TTS failed");
    } finally {
      setTtsGenerating(false);
    }
  }

  async function approveVersion(v: AudioVersion) {
    await supabase.from("audio_versions").update({ is_approved: true }).eq("id", v.id);
    // Un-approve others for this line
    await supabase
      .from("audio_versions")
      .update({ is_approved: false })
      .eq("dub_line_id", line.id)
      .neq("id", v.id);
    onChange({ status: "approved" });
    setVersions((prev) => prev.map((x) => ({ ...x, is_approved: x.id === v.id })));
  }

  return (
    <div className="space-y-5">
      {/* Times */}
      <div className="grid grid-cols-2 gap-3">
        <TimeField
          label="Start time"
          value={line.start_time}
          onCommit={(v) => onChange({ start_time: v })}
          getPlayheadTime={getPlayheadTime}
        />
        <TimeField
          label="End time"
          value={line.end_time}
          onCommit={(v) => onChange({ end_time: v })}
          getPlayheadTime={getPlayheadTime}
        />
      </div>

      {/* Dialogue text */}
      <div>
        <label className="mb-1 block text-[10px] uppercase tracking-wider text-white/50">
          Dialogue text <span className="text-white/30">(optional reference)</span>
        </label>
        <Textarea
          value={line.dialogue_text ?? ""}
          onChange={(e) => onChange({ dialogue_text: e.target.value })}
          placeholder="The line as written in the script…"
        />
      </div>

      {/* Voice */}
      <div>
        <div className="mb-1 flex items-center justify-between">
          <label className="block text-[10px] uppercase tracking-wider text-white/50">Target voice</label>
          {onManageVoices && (
            <button
              type="button"
              onClick={onManageVoices}
              className="text-[10px] uppercase tracking-wider text-gold-400 hover:text-gold-300"
            >
              + Manage voices
            </button>
          )}
        </div>
        <select
          value={line.selected_voice_id ?? ""}
          onChange={(e) => onChange({ selected_voice_id: e.target.value || null })}
          className="h-10 w-full rounded-md border border-white/10 bg-ink-900/60 px-3 text-sm text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold-400/40"
        >
          <option value="">— Select a licensed voice —</option>
          {voices.map((v) => (
            <option key={v.id} value={v.id}>
              {v.name}{v.language ? ` · ${v.language}` : ""}
            </option>
          ))}
        </select>
      </div>

      {/* Performance */}
      <div className="rounded-lg border border-white/8 bg-ink-900/50 p-4">
        <div className="mb-3 flex items-center justify-between">
          <div className="text-xs font-semibold uppercase tracking-wider text-white/70">Your performance</div>
          {line.input_audio_path && <Badge tone="green">captured</Badge>}
        </div>
        <div className="flex flex-wrap gap-2">
          {!recording ? (
            <Button size="sm" variant="secondary" onClick={startRecording} disabled={uploading}>
              <Mic className="h-4 w-4" /> Record
            </Button>
          ) : (
            <Button size="sm" variant="danger" onClick={stopRecording}>
              <Square className="h-4 w-4" /> Stop
            </Button>
          )}
          <label className={`inline-flex h-8 cursor-pointer items-center gap-2 rounded-md border border-white/10 bg-transparent px-3 text-xs font-medium text-white/90 transition-all hover:bg-white/5 ${uploading || recording ? "pointer-events-none opacity-50" : ""}`}>
            <Upload className="h-4 w-4" /> Upload audio
            <input type="file" accept="audio/*" className="hidden" onChange={handleUploadAudio} disabled={uploading || recording} />
          </label>
          <Button
            size="sm"
            variant="secondary"
            onClick={handleExtractFromVideo}
            disabled={extracting || recording || uploading}
            title="Slice exactly this start→end range from the source video"
          >
            {extracting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Scissors className="h-4 w-4" />}
            Extract from video
          </Button>
          {uploading && <span className="inline-flex items-center gap-1 text-xs text-white/50"><Loader2 className="h-3 w-3 animate-spin" />Uploading…</span>}
        </div>
        {inputUrl && (
          <audio src={inputUrl} controls className="mt-3 w-full" />
        )}
      </div>

      {/* Tuning */}
      <div className="rounded-lg border border-white/8 bg-ink-900/50 p-4">
        <button
          type="button"
          onClick={() => setShowTuning((s) => !s)}
          className="flex w-full items-center justify-between text-xs font-semibold uppercase tracking-wider text-white/70 hover:text-white"
        >
          <span>Tuning</span>
          <span className="text-white/40">{showTuning ? "Hide" : "Show"}</span>
        </button>
        {showTuning && (
          <div className="mt-4 space-y-4">
            <div>
              <label className="mb-1 block text-[10px] uppercase tracking-wider text-white/50">Model</label>
              <select
                value={modelId}
                onChange={(e) => setModelId(e.target.value)}
                className="h-9 w-full rounded-md border border-white/10 bg-ink-900/60 px-3 text-xs text-white"
              >
                <option value="eleven_multilingual_sts_v2">eleven_multilingual_sts_v2 (recommended)</option>
                <option value="eleven_english_sts_v2">eleven_english_sts_v2</option>
              </select>
            </div>

            <Slider
              label="Stability"
              hint="Lower = more emotional and varied (less robotic). Try 0.30–0.45."
              value={stability} min={0} max={1} step={0.05}
              onChange={setStability}
            />
            <Slider
              label="Similarity"
              hint="How closely the output matches the target voice. Try 0.80–0.90."
              value={similarity} min={0} max={1} step={0.05}
              onChange={setSimilarity}
            />
            <Slider
              label="Style exaggeration"
              hint="Adds expressiveness but reduces stability. Keep low (0.0–0.25)."
              value={style} min={0} max={1} step={0.05}
              onChange={setStyle}
            />
            <div className="flex flex-col gap-2">
              <label className="flex items-center gap-2 text-xs text-white/70">
                <input type="checkbox" checked={speakerBoost} onChange={(e) => setSpeakerBoost(e.target.checked)} className="h-3.5 w-3.5" />
                Speaker boost (tighter voice match)
              </label>
              <label className="flex items-center gap-2 text-xs text-white/70">
                <input type="checkbox" checked={denoise} onChange={(e) => setDenoise(e.target.checked)} className="h-3.5 w-3.5" />
                Remove background noise from input
              </label>
            </div>
            <p className="text-[11px] text-white/40">
              Sharp/clipped endings usually mean the input segment was cut mid-breath. If you transcribed the video, try
              nudging the end time forward 0.2–0.4s on the line and regenerating.
            </p>
          </div>
        )}
      </div>

      {/* Generate */}
      <div className="rounded-lg border border-gold-400/15 bg-gradient-to-b from-gold-400/5 to-transparent p-4">
        <div className="mb-2 flex items-center justify-between">
          <div className="font-display text-base">Voice Transfer</div>
          {generating && <Badge tone="gold">processing</Badge>}
        </div>
        <p className="mb-3 text-[11px] text-white/55">
          Converts your captured performance into the selected target voice, preserving emotion, pauses and delivery.
        </p>
        <Button onClick={handleGenerate} disabled={generating || !line.input_audio_path || !line.selected_voice_id}>
          {generating ? <><Loader2 className="h-4 w-4 animate-spin" /> Generating…</> : <><Sparkles className="h-4 w-4" /> Generate Voice Transfer</>}
        </Button>
        {error && <p className="mt-3 text-xs text-red-400">{error}</p>}
      </div>

      {/* AI dubbing — no performer needed */}
      <div className="rounded-lg border border-white/8 bg-gradient-to-b from-white/5 to-transparent p-4">
        <div className="mb-2 flex items-center justify-between">
          <div className="font-display text-base">AI dubbing (no performer)</div>
          {ttsGenerating && <Badge tone="gold">processing</Badge>}
        </div>
        <p className="mb-3 text-[11px] text-white/55">
          Speak the line in the cloned voice. Pick a language, click Translate to convert the original transcript, then Generate. Useful when a hero&apos;s voice needs to deliver in a language they don&apos;t speak.
        </p>
        <div className="space-y-3">
          <div>
            <label className="mb-1 block text-[10px] uppercase tracking-wider text-white/50 flex items-center gap-1">
              <Languages className="h-3 w-3" /> Target language
            </label>
            <select
              value={ttsLang}
              onChange={(e) => setTtsLang(e.target.value)}
              className="h-9 w-full rounded-md border border-white/10 bg-ink-900/60 px-3 text-xs text-white"
            >
              <option value="">Auto-detect (no translation)</option>
              {INDIAN_LANGUAGES.map((l) => (
                <option key={l.code} value={l.code}>{l.name}</option>
              ))}
            </select>
          </div>
          <div>
            <div className="mb-1 flex items-center justify-between">
              <label className="block text-[10px] uppercase tracking-wider text-white/50">
                Spoken text {ttsLang ? `(${languageName(ttsLang)})` : ""}
              </label>
              <button
                type="button"
                onClick={handleTranslate}
                disabled={translating || !ttsLang || !line.dialogue_text}
                className="inline-flex items-center gap-1 text-[10px] uppercase tracking-wider text-gold-400 hover:text-gold-300 disabled:opacity-40"
                title={!ttsLang ? "Pick a target language first" : !line.dialogue_text ? "This line has no transcript to translate" : "Translate the transcript into the target language"}
              >
                {translating ? <Loader2 className="h-3 w-3 animate-spin" /> : <Languages className="h-3 w-3" />}
                {translating ? "Translating…" : "Translate transcript"}
              </button>
            </div>
            <Textarea
              value={ttsText}
              onChange={(e) => setTtsText(e.target.value)}
              onBlur={() => { if (ttsText !== (line.translated_text ?? "")) onChange({ translated_text: ttsText || null }); }}
              placeholder={line.dialogue_text ? `Click "Translate transcript", or type the line in the target language…` : "Type or paste the line in the target language…"}
            />
            <p className="mt-1 text-[10px] text-white/40">
              This exact text is spoken. It must be in the target language — Translate fills it for you, or edit it by hand.
            </p>
          </div>
          <Button
            onClick={handleGenerateFromText}
            disabled={ttsGenerating || !line.selected_voice_id}
            variant="secondary"
          >
            {ttsGenerating ? <><Loader2 className="h-4 w-4 animate-spin" /> Generating…</> : <><Sparkles className="h-4 w-4" /> Generate from text</>}
          </Button>
        </div>
      </div>

      {/* Versions */}
      <div>
        <div className="mb-2 text-[10px] uppercase tracking-wider text-white/50">Converted versions ({versions.length})</div>
        <div className="space-y-2">
          {versions.length === 0 && (
            <div className="rounded-lg border border-white/5 bg-ink-900/40 p-4 text-xs text-white/40">
              No versions yet. Generate one above.
            </div>
          )}
          {versions.map((v, idx) => (
            <motion.div
              key={v.id}
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: idx * 0.03 }}
              className={`rounded-lg border p-3 ${v.is_approved ? "border-emerald-400/40 bg-emerald-500/5" : "border-white/8 bg-ink-900/40"}`}
            >
              <div className="flex items-center justify-between text-[11px] text-white/50">
                <span>v{versions.length - idx} · {new Date(v.created_at).toLocaleString()}</span>
                {v.is_approved && <Badge tone="green">approved</Badge>}
              </div>
              {v.signedUrl && <audio src={v.signedUrl} controls className="mt-2 w-full" />}
              <div className="mt-2 flex flex-wrap gap-2">
                {v.signedUrl && (
                  <a href={v.signedUrl} download={`cinesync-${line.id}-v${versions.length - idx}.mp3`}>
                    <Button size="sm" variant="outline">Download</Button>
                  </a>
                )}
                {!v.is_approved && (
                  <Button size="sm" onClick={() => approveVersion(v)}>Use this</Button>
                )}
                <Button size="sm" variant="danger" onClick={() => deleteVersion(v)} title="Delete this version">
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
            </motion.div>
          ))}
        </div>
      </div>
    </div>
  );
}

function parseTimeInput(raw: string): number | null {
  const s = raw.trim();
  if (!s) return null;
  if (/^\d+(\.\d+)?$/.test(s)) return parseFloat(s);
  const m = s.match(/^(\d{1,2}):(\d{1,2})(?:\.(\d+))?$/);
  if (m) {
    const mm = parseInt(m[1], 10);
    const ss = parseInt(m[2], 10);
    const frac = m[3] ? parseFloat("0." + m[3]) : 0;
    if (ss >= 60) return null;
    return mm * 60 + ss + frac;
  }
  return null;
}

function TimeField({
  label, value, onCommit, getPlayheadTime,
}: {
  label: string;
  value: number;
  onCommit: (v: number) => void;
  getPlayheadTime?: () => number;
}) {
  const [text, setText] = useState(formatTime(value));
  const [error, setError] = useState(false);

  useEffect(() => { setText(formatTime(value)); }, [value]);

  function commit() {
    const parsed = parseTimeInput(text);
    if (parsed === null || parsed < 0) {
      setError(true);
      return;
    }
    setError(false);
    onCommit(parsed);
  }

  return (
    <div>
      <div className="mb-1 flex items-center justify-between">
        <label className="text-[10px] uppercase tracking-wider text-white/50">{label}</label>
        {getPlayheadTime && (
          <button
            type="button"
            onClick={() => onCommit(getPlayheadTime())}
            className="text-[10px] uppercase tracking-wider text-gold-400 hover:text-gold-300"
            title="Set to current video playhead"
          >
            use playhead
          </button>
        )}
      </div>
      <Input
        value={text}
        onChange={(e) => setText(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => { if (e.key === "Enter") { e.currentTarget.blur(); } }}
        className={error ? "border-red-500/50" : undefined}
        placeholder="mm:ss.ms or seconds"
      />
      <p className="mt-1 font-mono text-[10px] text-white/40">{value.toFixed(2)} s</p>
    </div>
  );
}

function Slider({
  label, hint, value, min, max, step, onChange,
}: {
  label: string;
  hint?: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (v: number) => void;
}) {
  return (
    <div>
      <div className="mb-1 flex items-center justify-between">
        <label className="text-[10px] uppercase tracking-wider text-white/50">{label}</label>
        <span className="font-mono text-[11px] text-white/60">{value.toFixed(2)}</span>
      </div>
      <input
        type="range"
        min={min} max={max} step={step} value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        className="w-full accent-gold-400"
      />
      {hint && <p className="mt-1 text-[10px] text-white/40">{hint}</p>}
    </div>
  );
}
