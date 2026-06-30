"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Plus, Wand2, Loader2, Trash2 } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import type { DubLine, Project, Voice } from "@/lib/types";
import { Panel, PanelBody, PanelHeader, PanelTitle } from "@/components/ui/panel";
import { Button } from "@/components/ui/button";
import { formatTime } from "@/lib/utils";
import { VideoPanel } from "./VideoPanel";
import { LinesPanel } from "./LinesPanel";
import { LineEditor } from "./LineEditor";
import { VoiceManager } from "./VoiceManager";
import { DubFilmModal } from "./DubFilmModal";
import { ProjectStatus } from "./ProjectStatus";
import { useTuningDefaults, TTS_EMOTION } from "./useTuningDefaults";
import { Film, Sparkles, Languages, ChevronDown, Mic2, Type } from "lucide-react";
import { INDIAN_LANGUAGES } from "@/lib/languages";

export function Editor({
  project,
  videoUrl,
  initialLines,
  voices: initialVoices,
}: {
  project: Project;
  videoUrl: string | null;
  initialLines: DubLine[];
  voices: Voice[];
}) {
  const supabase = createClient();
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [voices, setVoices] = useState<Voice[]>(initialVoices);
  const [voiceManagerOpen, setVoiceManagerOpen] = useState(false);
  const [dubFilmOpen, setDubFilmOpen] = useState(false);
  const [lines, setLines] = useState<DubLine[]>(initialLines);
  const [selectedId, setSelectedId] = useState<string | null>(initialLines[0]?.id ?? null);
  const [currentTime, setCurrentTime] = useState(0);
  const [transcribing, setTranscribing] = useState(false);
  const [transcribeError, setTranscribeError] = useState<string | null>(null);
  const [bulkProgress, setBulkProgress] = useState<{ done: number; total: number } | null>(null);
  const [approvedCount, setApprovedCount] = useState(0);
  const [approvedLineIds, setApprovedLineIds] = useState<Set<string>>(new Set());
  const { tuning } = useTuningDefaults();

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (lines.length === 0) { setApprovedCount(0); return; }
      const { data } = await supabase
        .from("audio_versions")
        .select("dub_line_id, is_approved")
        .in("dub_line_id", lines.map((l) => l.id))
        .eq("is_approved", true);
      if (cancelled) return;
      const linesApproved = new Set((data ?? []).map((v) => v.dub_line_id as string));
      setApprovedCount(linesApproved.size);
      setApprovedLineIds(linesApproved);
    })();
    return () => { cancelled = true; };
  }, [lines, supabase]);

  async function generateOne(lineId: string): Promise<boolean> {
    const line = lines.find((l) => l.id === lineId);
    if (!line || !line.input_audio_path || !line.selected_voice_id) return false;
    const voice = voices.find((v) => v.id === line.selected_voice_id);
    if (!voice) return false;
    setLines((prev) => prev.map((l) => l.id === lineId ? { ...l, status: "generating" } : l));
    try {
      const res = await fetch("/api/generate/speech-to-speech", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectId: project.id,
          dubLineId: lineId,
          voiceDbId: voice.id,
          elevenlabsVoiceId: voice.elevenlabs_voice_id,
          inputAudioPath: line.input_audio_path,
          modelId: tuning.modelId,
          voiceSettings: {
            stability: tuning.stability,
            similarity_boost: tuning.similarity,
            style: tuning.style,
            use_speaker_boost: tuning.speakerBoost,
          },
          removeBackgroundNoise: tuning.denoise,
        }),
      });
      setLines((prev) => prev.map((l) => l.id === lineId ? { ...l, status: res.ok ? "done" : "error" } : l));
      return res.ok;
    } catch {
      setLines((prev) => prev.map((l) => l.id === lineId ? { ...l, status: "error" } : l));
      return false;
    }
  }

  async function approveLatest(lineId: string): Promise<boolean> {
    const { data: rows } = await supabase
      .from("audio_versions")
      .select("id")
      .eq("dub_line_id", lineId)
      .order("created_at", { ascending: false })
      .limit(1);
    const latest = rows?.[0];
    if (!latest) return false;
    await supabase.from("audio_versions").update({ is_approved: false }).eq("dub_line_id", lineId);
    await supabase.from("audio_versions").update({ is_approved: true }).eq("id", latest.id);
    setApprovedLineIds((prev) => new Set(prev).add(lineId));
    setApprovedCount((c) => c + 1);
    return true;
  }

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable || t.tagName === "SELECT")) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;

      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        if (lines.length === 0) return;
        const idx = selectedId ? lines.findIndex((l) => l.id === selectedId) : -1;
        const next = e.key === "ArrowDown"
          ? lines[Math.min(lines.length - 1, idx + 1)]
          : lines[Math.max(0, idx - 1)];
        if (next) {
          setSelectedId(next.id);
          seekTo(next.start_time);
        }
      } else if (e.key === " ") {
        e.preventDefault();
        const v = videoRef.current;
        if (v) { if (v.paused) v.play(); else v.pause(); }
      } else if (e.key === "j" || e.key === "J") {
        e.preventDefault();
        const sel = lines.find((l) => l.id === selectedId);
        if (sel) seekTo(sel.start_time);
      } else if (e.key === "g" || e.key === "G") {
        e.preventDefault();
        if (selectedId) generateOne(selectedId);
      } else if (e.key === "a" || e.key === "A") {
        e.preventDefault();
        if (selectedId) approveLatest(selectedId);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lines, selectedId, voices, tuning]);

  async function bulkGenerate() {
    const eligible = lines.filter(
      (l) => l.input_audio_path && l.selected_voice_id && l.status !== "generating"
    );
    if (eligible.length === 0) {
      alert("No eligible lines. Each line needs (1) input audio and (2) a target voice selected.");
      return;
    }
    if (!confirm(`Generate Voice Transfer for ${eligible.length} line${eligible.length === 1 ? "" : "s"}? This may take a few minutes.`)) return;

    setBulkProgress({ done: 0, total: eligible.length });
    for (let i = 0; i < eligible.length; i++) {
      const line = eligible[i];
      const voice = voices.find((v) => v.id === line.selected_voice_id);
      if (!voice) { setBulkProgress({ done: i + 1, total: eligible.length }); continue; }
      try {
        const res = await fetch("/api/generate/speech-to-speech", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            projectId: project.id,
            dubLineId: line.id,
            voiceDbId: voice.id,
            elevenlabsVoiceId: voice.elevenlabs_voice_id,
            inputAudioPath: line.input_audio_path,
            modelId: tuning.modelId,
            voiceSettings: {
              stability: tuning.stability,
              similarity_boost: tuning.similarity,
              style: tuning.style,
              use_speaker_boost: tuning.speakerBoost,
            },
            removeBackgroundNoise: tuning.denoise,
          }),
        });
        if (res.ok) {
          setLines((prev) => prev.map((l) => l.id === line.id ? { ...l, status: "done" } : l));
        } else {
          setLines((prev) => prev.map((l) => l.id === line.id ? { ...l, status: "error" } : l));
        }
      } catch {
        setLines((prev) => prev.map((l) => l.id === line.id ? { ...l, status: "error" } : l));
      }
      setBulkProgress({ done: i + 1, total: eligible.length });
    }
    setTimeout(() => setBulkProgress(null), 2000);
  }

  const selected = useMemo(() => lines.find((l) => l.id === selectedId) ?? null, [lines, selectedId]);

  const translateContext = useMemo(() => {
    const idx = lines.findIndex((l) => l.id === selectedId);
    if (idx < 0) return "";
    const before = lines.slice(Math.max(0, idx - 3), idx).map((l) => `  ${l.dialogue_text || ""}`);
    const after = lines.slice(idx + 1, idx + 4).map((l) => `  ${l.dialogue_text || ""}`);
    if (before.length === 0 && after.length === 0) return "";
    return [...before, "  >>> [THIS LINE] <<<", ...after].join("\n");
  }, [lines, selectedId]);

  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    const onTime = () => setCurrentTime(v.currentTime);
    v.addEventListener("timeupdate", onTime);
    return () => v.removeEventListener("timeupdate", onTime);
  }, [videoUrl]);

  async function addLine() {
    const start = videoRef.current?.currentTime ?? 0;
    const end = Math.min((videoRef.current?.duration ?? start + 3), start + 3);
    const { data, error } = await supabase
      .from("dub_lines")
      .insert({
        project_id: project.id,
        start_time: start,
        end_time: end,
        dialogue_text: "",
        status: "draft",
      })
      .select()
      .single();
    if (error) return alert(error.message);
    setLines((prev) => [...prev, data as DubLine].sort((a, b) => a.start_time - b.start_time));
    setSelectedId(data.id);
  }

  const [noSpeechDetected, setNoSpeechDetected] = useState(false);
  const [translateLang, setTranslateLang] = useState("hi");
  const [translatingAll, setTranslatingAll] = useState<{ done: number; total: number } | null>(null);
  const [genMenuOpen, setGenMenuOpen] = useState(false);

  async function bulkGenerateFromText() {
    const eligible = lines.filter(
      (l) => (l.translated_text || "").trim() && l.selected_voice_id && l.status !== "generating"
    );
    if (eligible.length === 0) {
      alert("No lines ready for AI dub. Each line needs translated text + a target voice. Run Translate all and assign voices first.");
      return;
    }
    if (!confirm(`Generate AI dub (from translated text) for ${eligible.length} line${eligible.length === 1 ? "" : "s"}? This speaks the translation in each line's voice.`)) return;

    setBulkProgress({ done: 0, total: eligible.length });
    for (let i = 0; i < eligible.length; i++) {
      const line = eligible[i];
      const voice = voices.find((v) => v.id === line.selected_voice_id);
      if (!voice) { setBulkProgress({ done: i + 1, total: eligible.length }); continue; }
      try {
        const res = await fetch("/api/generate/text-to-speech", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            projectId: project.id,
            dubLineId: line.id,
            voiceDbId: voice.id,
            elevenlabsVoiceId: voice.elevenlabs_voice_id,
            text: line.translated_text,
            languageCode: translateLang || undefined,
            voiceSettings: TTS_EMOTION,
          }),
        });
        setLines((prev) => prev.map((l) => l.id === line.id ? { ...l, status: res.ok ? "done" : "error" } : l));
      } catch {
        setLines((prev) => prev.map((l) => l.id === line.id ? { ...l, status: "error" } : l));
      }
      setBulkProgress({ done: i + 1, total: eligible.length });
    }
    setTimeout(() => setBulkProgress(null), 2000);
  }

  async function bulkTranslate() {
    const targets = lines.filter((l) => (l.dialogue_text || "").trim());
    if (targets.length === 0) {
      alert("No lines with transcript text to translate. Run Auto-transcribe first.");
      return;
    }
    const langName = INDIAN_LANGUAGES.find((l) => l.code === translateLang)?.name ?? translateLang;
    if (!confirm(`Translate ${targets.length} line${targets.length === 1 ? "" : "s"} into ${langName}? This fills the "spoken text" for AI dubbing.`)) return;

    setTranslatingAll({ done: 0, total: targets.length });
    try {
      const res = await fetch("/api/translate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          targetLang: translateLang,
          items: targets.map((l) => ({ id: l.id, text: (l.dialogue_text || "").trim() })),
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Translation failed");
      const map = new Map<string, string>((json.translations ?? []).map((t: any) => [t.id, t.text]));

      const updated = lines.map((l) => map.has(l.id) ? { ...l, translated_text: map.get(l.id)! } : l);
      setLines(updated);

      // Persist each translation.
      await Promise.all(
        Array.from(map.entries()).map(([id, text]) =>
          supabase.from("dub_lines").update({ translated_text: text }).eq("id", id)
        )
      );
      setTranslatingAll({ done: map.size, total: targets.length });
    } catch (e: any) {
      alert(e.message ?? "Translation failed");
    } finally {
      setTimeout(() => setTranslatingAll(null), 1500);
    }
  }

  async function autoTranscribe(mode: "auto" | "full" = "auto") {
    if (!videoUrl) return;
    if (mode === "auto" && lines.length > 0 && !confirm(`This will transcribe the video and append new dialogue lines. Continue?`)) return;
    setTranscribing(true);
    setTranscribeError(null);
    setNoSpeechDetected(false);
    try {
      const duration = videoRef.current?.duration;
      const res = await fetch("/api/transcribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectId: project.id,
          mode,
          duration: Number.isFinite(duration) ? duration : undefined,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Transcription failed");
      const { data } = await supabase
        .from("dub_lines")
        .select("*")
        .eq("project_id", project.id)
        .order("start_time");
      const fresh = (data ?? []) as DubLine[];
      setLines(fresh);
      setSelectedId(fresh[0]?.id ?? null);
      if (mode === "auto" && json.inserted === 0) setNoSpeechDetected(true);
    } catch (e: any) {
      setTranscribeError(e.message ?? "Transcription failed");
    } finally {
      setTranscribing(false);
    }
  }

  async function updateLine(id: string, patch: Partial<DubLine>) {
    setLines((prev) => prev.map((l) => (l.id === id ? { ...l, ...patch } : l)));
    const { error } = await supabase.from("dub_lines").update(patch).eq("id", id);
    if (error) console.error(error);
  }

  async function assignSpeakerVoice(speakerKey: string, voiceId: string | null) {
    const targetIds = lines
      .filter((l) => (l.speaker_id ?? "__unassigned__") === speakerKey)
      .map((l) => l.id);
    if (targetIds.length === 0) return;
    setLines((prev) =>
      prev.map((l) => (targetIds.includes(l.id) ? { ...l, selected_voice_id: voiceId } : l))
    );
    const { error } = await supabase
      .from("dub_lines")
      .update({ selected_voice_id: voiceId })
      .in("id", targetIds);
    if (error) console.error(error);
  }

  async function deleteAllLines() {
    if (lines.length === 0) return;
    if (!confirm(`Delete all ${lines.length} dialogue line${lines.length === 1 ? "" : "s"}? This also removes their input audio and every generated version. This cannot be undone.`)) return;

    const lineIds = lines.map((l) => l.id);
    const inputPaths = lines.map((l) => l.input_audio_path).filter((p): p is string => !!p);

    const { data: versions } = await supabase
      .from("audio_versions")
      .select("audio_path")
      .in("dub_line_id", lineIds);
    const versionPaths = (versions ?? []).map((v) => v.audio_path).filter(Boolean);

    if (inputPaths.length) await supabase.storage.from("input-performances").remove(inputPaths);
    if (versionPaths.length) await supabase.storage.from("generated-audio").remove(versionPaths);

    const { error } = await supabase.from("dub_lines").delete().in("id", lineIds);
    if (error) return alert(error.message);

    setLines([]);
    setSelectedId(null);
  }

  async function deleteLine(id: string) {
    if (!confirm("Delete this dialogue line?")) return;
    setLines((prev) => prev.filter((l) => l.id !== id));
    if (selectedId === id) setSelectedId(null);
    await supabase.from("dub_lines").delete().eq("id", id);
  }

  function seekTo(t: number) {
    if (videoRef.current) {
      videoRef.current.currentTime = t;
    }
  }

  return (
    <div className="flex flex-col gap-4 p-4 lg:gap-5 lg:p-5">
      <ProjectStatus lines={lines} approvedCount={approvedCount} />
      {bulkProgress && (
        <div className="flex items-center gap-3 rounded-md border border-gold-400/20 bg-gold-400/5 px-4 py-2 text-xs text-gold-100">
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          <span>Generating voice transfers · {bulkProgress.done}/{bulkProgress.total}</span>
          <div className="ml-auto h-1.5 w-32 overflow-hidden rounded-full bg-white/8">
            <div
              className="h-full bg-gold-400 transition-all"
              style={{ width: `${Math.round((bulkProgress.done / bulkProgress.total) * 100)}%` }}
            />
          </div>
        </div>
      )}
      {/* FULL-WIDTH ACTION TOOLBAR */}
      <div className="flex flex-wrap items-center gap-2 rounded-lg border border-white/8 bg-ink-900/40 px-3 py-2">
        <Button
          size="sm"
          variant="secondary"
          onClick={() => autoTranscribe("auto")}
          disabled={transcribing || !videoUrl}
          title={!videoUrl ? "Upload a video first" : "Auto-transcribe the video"}
        >
          {transcribing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Wand2 className="h-3.5 w-3.5" />}
          {transcribing ? "Transcribing…" : "Auto-transcribe"}
        </Button>
        <Button size="sm" onClick={addLine}><Plus className="h-3.5 w-3.5" /> Add line</Button>

        <div className="mx-1 hidden h-5 w-px bg-white/10 sm:block" />

        <div className="inline-flex items-center overflow-hidden rounded-md border border-white/10">
          <select
            value={translateLang}
            onChange={(e) => setTranslateLang(e.target.value)}
            disabled={!!translatingAll || lines.length === 0}
            className="h-8 bg-ink-900/60 px-2 text-[11px] text-white focus:outline-none"
            title="Target language for Translate all"
          >
            {INDIAN_LANGUAGES.map((l) => (
              <option key={l.code} value={l.code}>{l.name}</option>
            ))}
          </select>
          <button
            onClick={bulkTranslate}
            disabled={!!translatingAll || lines.length === 0}
            className="inline-flex h-8 items-center gap-1.5 border-l border-white/10 bg-transparent px-3 text-xs font-medium text-white/90 transition-colors hover:bg-white/5 disabled:opacity-50"
            title="Translate every line's transcript into the chosen language"
          >
            {translatingAll ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Languages className="h-3.5 w-3.5" />}
            {translatingAll ? `${translatingAll.done}/${translatingAll.total}` : "Translate all"}
          </button>
        </div>
        <div className="relative">
          <Button
            size="sm"
            onClick={() => setGenMenuOpen((o) => !o)}
            disabled={!!bulkProgress || lines.length === 0}
            title="Generate dubbed audio for all lines"
          >
            <Sparkles className="h-3.5 w-3.5" /> Generate all <ChevronDown className="h-3 w-3 opacity-70" />
          </Button>
          {genMenuOpen && (
            <>
              <div className="fixed inset-0 z-40" onClick={() => setGenMenuOpen(false)} />
              <div className="absolute left-0 z-50 mt-1 w-72 rounded-md border border-white/10 bg-ink-950 p-1 shadow-2xl">
                <button
                  onClick={() => { setGenMenuOpen(false); bulkGenerate(); }}
                  className="flex w-full items-start gap-2 rounded px-3 py-2 text-left hover:bg-white/5"
                >
                  <Mic2 className="mt-0.5 h-4 w-4 text-gold-400" />
                  <span>
                    <span className="block text-xs font-medium text-white">From performances</span>
                    <span className="block text-[10px] text-white/45">Voice transfer (STS) · needs recorded/extracted audio + voice</span>
                  </span>
                </button>
                <button
                  onClick={() => { setGenMenuOpen(false); bulkGenerateFromText(); }}
                  className="flex w-full items-start gap-2 rounded px-3 py-2 text-left hover:bg-white/5"
                >
                  <Type className="mt-0.5 h-4 w-4 text-sky-400" />
                  <span>
                    <span className="block text-xs font-medium text-white">From translated text</span>
                    <span className="block text-[10px] text-white/45">AI dub (TTS) · needs Translate all + voice</span>
                  </span>
                </button>
              </div>
            </>
          )}
        </div>

        <div className="ml-auto flex items-center gap-2">
          <Button
            size="sm"
            variant="secondary"
            onClick={() => setDubFilmOpen(true)}
            disabled={!videoUrl}
            title={!videoUrl ? "Upload a video first" : "Dub the whole film in one click (ElevenLabs Dubbing)"}
          >
            <Film className="h-3.5 w-3.5" /> Dub film
          </Button>
          <Button
            size="sm"
            variant="danger"
            onClick={deleteAllLines}
            disabled={lines.length === 0}
            title="Delete every dialogue line in this project"
          >
            <Trash2 className="h-3.5 w-3.5" /> Delete all
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)_minmax(0,1.1fr)] lg:gap-5">
      {/* LEFT — VIDEO */}
      <VideoPanel
        videoUrl={videoUrl}
        videoRef={videoRef}
        currentTime={currentTime}
        projectId={project.id}
        lines={lines}
      />

      {/* MIDDLE — DIALOGUE LIST */}
      <Panel className="flex h-[calc(100vh-13rem)] flex-col">
        <PanelHeader>
          <PanelTitle>Dialogue lines</PanelTitle>
          <div className="text-[10px] uppercase tracking-wider text-white/40">
            {lines.length} line{lines.length === 1 ? "" : "s"}
          </div>
        </PanelHeader>
        {transcribeError && (
          <div className="border-b border-red-500/20 bg-red-500/10 px-4 py-2 text-[11px] text-red-300">
            {transcribeError}
          </div>
        )}
        {noSpeechDetected && (
          <div className="flex items-center justify-between gap-3 border-b border-amber-400/20 bg-amber-400/5 px-4 py-2 text-[11px] text-amber-200">
            <span>No speech detected by transcription. Want to create a single line from the whole clip?</span>
            <Button size="sm" variant="secondary" onClick={() => autoTranscribe("full")} disabled={transcribing}>
              Use whole clip
            </Button>
          </div>
        )}
        <PanelBody className="flex-1 overflow-y-auto scrollbar-thin">
          <LinesPanel
            lines={lines}
            voices={voices}
            selectedId={selectedId}
            currentTime={currentTime}
            onSelect={(id) => { setSelectedId(id); const l = lines.find((x) => x.id === id); if (l) seekTo(l.start_time); }}
            onDelete={deleteLine}
            onAssignSpeakerVoice={assignSpeakerVoice}
            approvedLineIds={approvedLineIds}
          />
        </PanelBody>
      </Panel>

      {/* RIGHT — LINE EDITOR */}
      <Panel className="flex h-[calc(100vh-13rem)] flex-col">
        <PanelHeader>
          <PanelTitle>Line editor</PanelTitle>
          <div className="text-[10px] text-white/40">{formatTime(currentTime)}</div>
        </PanelHeader>
        <PanelBody className="flex-1 overflow-y-auto scrollbar-thin">
          <AnimatePresence mode="wait">
            {selected ? (
              <motion.div
                key={selected.id}
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -6 }}
                transition={{ duration: 0.18 }}
              >
                <LineEditor
                  project={project}
                  line={selected}
                  voices={voices}
                  onChange={(patch) => updateLine(selected.id, patch)}
                  onManageVoices={() => setVoiceManagerOpen(true)}
                  getPlayheadTime={() => videoRef.current?.currentTime ?? 0}
                  translateContext={translateContext}
                />
              </motion.div>
            ) : (
              <div className="flex h-full flex-col items-center justify-center py-20 text-center text-sm text-white/40">
                Select a line on the left, or add a new one.
              </div>
            )}
          </AnimatePresence>
        </PanelBody>
      </Panel>

        <VoiceManager
          open={voiceManagerOpen}
          onClose={() => setVoiceManagerOpen(false)}
          onVoicesChanged={setVoices}
        />

        <DubFilmModal
          open={dubFilmOpen}
          onClose={() => setDubFilmOpen(false)}
          projectId={project.id}
        />
      </div>
    </div>
  );
}
