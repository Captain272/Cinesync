"use client";
import { Pause, Play, SkipBack, Headphones, Loader2, Download } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Panel, PanelBody, PanelHeader, PanelTitle } from "@/components/ui/panel";
import { formatTime } from "@/lib/utils";
import { createClient } from "@/lib/supabase/client";
import type { DubLine } from "@/lib/types";

type Clip = { lineId: string; start: number; end: number; audio: HTMLAudioElement };

export function VideoPanel({
  videoUrl,
  videoRef,
  currentTime,
  projectId,
  lines,
}: {
  videoUrl: string | null;
  videoRef: React.MutableRefObject<HTMLVideoElement | null>;
  currentTime: number;
  projectId: string;
  lines: DubLine[];
}) {
  const supabase = createClient();
  const [playing, setPlaying] = useState(false);
  const [dubMode, setDubMode] = useState(false);
  const [loadingClips, setLoadingClips] = useState(false);
  const [clipMsg, setClipMsg] = useState<string | null>(null);
  const [rendering, setRendering] = useState(false);
  const [renderUrl, setRenderUrl] = useState<string | null>(null);
  const [renderError, setRenderError] = useState<string | null>(null);

  async function exportDub() {
    setRendering(true);
    setRenderError(null);
    setRenderUrl(null);
    try {
      const res = await fetch("/api/render", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Render failed");
      setRenderUrl(json.url);
    } catch (e: any) {
      setRenderError(e.message ?? "Render failed");
    } finally {
      setRendering(false);
    }
  }
  const clipsRef = useRef<Clip[]>([]);

  function toggle() {
    const v = videoRef.current;
    if (!v) return;
    if (v.paused) { v.play(); setPlaying(true); }
    else { v.pause(); setPlaying(false); }
  }

  function rewind() {
    if (videoRef.current) videoRef.current.currentTime = 0;
  }

  function stopAllClips() {
    for (const c of clipsRef.current) {
      c.audio.pause();
    }
  }

  async function loadClips(): Promise<Clip[]> {
    const ids = lines.map((l) => l.id);
    if (ids.length === 0) return [];
    const { data: versions } = await supabase
      .from("audio_versions")
      .select("dub_line_id, audio_path, is_approved, created_at")
      .in("dub_line_id", ids)
      .eq("is_approved", true);
    if (!versions || versions.length === 0) return [];

    const chosenByLine = new Map<string, string>();
    for (const v of versions) chosenByLine.set(v.dub_line_id, v.audio_path);

    const clips: Clip[] = [];
    for (const line of lines) {
      const path = chosenByLine.get(line.id);
      if (!path) continue;
      const { data: signed } = await supabase.storage
        .from("generated-audio")
        .createSignedUrl(path, 3600);
      if (!signed?.signedUrl) continue;
      const audio = new Audio(signed.signedUrl);
      audio.preload = "auto";
      clips.push({ lineId: line.id, start: line.start_time, end: line.end_time, audio });
    }
    return clips;
  }

  async function enableDub() {
    setLoadingClips(true);
    setClipMsg(null);
    try {
      const clips = await loadClips();
      stopAllClips();
      clipsRef.current = clips;
      if (clips.length === 0) {
        setClipMsg("No approved versions yet. On a line, click \"Use this\" on the version you want to play.");
      }
      setDubMode(true);
      if (videoRef.current) videoRef.current.muted = true;
    } finally {
      setLoadingClips(false);
    }
  }

  function disableDub() {
    setDubMode(false);
    stopAllClips();
    if (videoRef.current) videoRef.current.muted = false;
  }

  // Refresh clips when lines change while dub is on.
  useEffect(() => {
    if (!dubMode) return;
    let cancelled = false;
    (async () => {
      const clips = await loadClips();
      if (cancelled) return;
      stopAllClips();
      clipsRef.current = clips;
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dubMode, lines]);

  // Sync clip playback to video time.
  useEffect(() => {
    if (!dubMode) return;
    const v = videoRef.current;
    if (!v) return;

    const sync = () => {
      const t = v.currentTime;
      for (const c of clipsRef.current) {
        const inRange = t >= c.start && t < c.end;
        if (inRange && !v.paused) {
          const target = Math.max(0, t - c.start);
          if (Math.abs(c.audio.currentTime - target) > 0.25) c.audio.currentTime = target;
          if (c.audio.paused) c.audio.play().catch(() => {});
        } else if (!c.audio.paused) {
          c.audio.pause();
        }
      }
    };
    const onPause = () => stopAllClips();
    const onRateChange = () => {
      for (const c of clipsRef.current) c.audio.playbackRate = v.playbackRate;
    };

    v.addEventListener("timeupdate", sync);
    v.addEventListener("play", sync);
    v.addEventListener("seeking", sync);
    v.addEventListener("pause", onPause);
    v.addEventListener("ratechange", onRateChange);
    return () => {
      v.removeEventListener("timeupdate", sync);
      v.removeEventListener("play", sync);
      v.removeEventListener("seeking", sync);
      v.removeEventListener("pause", onPause);
      v.removeEventListener("ratechange", onRateChange);
    };
  }, [dubMode, videoRef]);

  useEffect(() => {
    return () => stopAllClips();
  }, []);

  return (
    <Panel className="flex h-[calc(100vh-13rem)] flex-col">
      <PanelHeader>
        <PanelTitle>Preview</PanelTitle>
        <div className="flex items-center gap-3">
          <button
            onClick={dubMode ? disableDub : enableDub}
            disabled={loadingClips}
            className={`inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-[10px] uppercase tracking-wider transition-colors ${
              dubMode
                ? "border-gold-400/50 bg-gold-400/10 text-gold-200"
                : "border-white/10 text-white/60 hover:border-white/20 hover:text-white"
            }`}
            title="Mute the original audio and play the generated voice in sync"
          >
            {loadingClips ? <Loader2 className="h-3 w-3 animate-spin" /> : <Headphones className="h-3 w-3" />}
            {dubMode ? "Dub on" : "Preview with dub"}
          </button>
          <button
            onClick={exportDub}
            disabled={rendering}
            className="inline-flex items-center gap-1.5 rounded-md border border-white/10 px-2 py-1 text-[10px] uppercase tracking-wider text-white/60 transition-colors hover:border-white/20 hover:text-white disabled:opacity-50"
            title="Render the video with all generated voices baked in"
          >
            {rendering ? <Loader2 className="h-3 w-3 animate-spin" /> : <Download className="h-3 w-3" />}
            {rendering ? "Rendering…" : "Export"}
          </button>
          <div className="font-mono text-[11px] text-white/50">{formatTime(currentTime)}</div>
        </div>
      </PanelHeader>
      <PanelBody className="flex min-h-0 flex-1 flex-col gap-3">
        <div className="relative min-h-0 flex-1 overflow-hidden rounded-lg border border-white/5 bg-black">
          {videoUrl ? (
            <video
              ref={videoRef}
              src={videoUrl}
              className="absolute inset-0 h-full w-full object-contain"
              onPlay={() => setPlaying(true)}
              onPause={() => setPlaying(false)}
              playsInline
              controls
            />
          ) : (
            <div className="flex h-full items-center justify-center px-6 text-center text-sm text-white/40">
              No video uploaded for this project.
            </div>
          )}
        </div>
        {clipMsg && (
          <div className="rounded-md border border-amber-400/20 bg-amber-400/5 px-3 py-2 text-[11px] text-amber-200">
            {clipMsg}
          </div>
        )}
        {renderError && (
          <div className="rounded-md border border-red-500/20 bg-red-500/10 px-3 py-2 text-[11px] text-red-300">
            {renderError}
          </div>
        )}
        {renderUrl && (
          <div className="flex items-center justify-between gap-3 rounded-md border border-emerald-400/20 bg-emerald-400/5 px-3 py-2 text-[11px] text-emerald-200">
            <span>Render ready.</span>
            <a href={renderUrl} download={`${projectId}-dub.mp4`} target="_blank" rel="noreferrer" className="underline">
              Download MP4
            </a>
          </div>
        )}
        <div className="flex items-center justify-between rounded-lg border border-white/5 bg-ink-900/60 px-3 py-2">
          <div className="flex items-center gap-2">
            <Button variant="secondary" size="icon" onClick={rewind}><SkipBack className="h-4 w-4" /></Button>
            <Button size="icon" onClick={toggle}>
              {playing ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
            </Button>
          </div>
          <div className="font-mono text-xs text-white/60">{formatTime(currentTime)}</div>
        </div>
      </PanelBody>
    </Panel>
  );
}
