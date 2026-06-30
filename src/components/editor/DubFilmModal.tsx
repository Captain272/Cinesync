"use client";
import { useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X, Wand2, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { INDIAN_LANGUAGES, languageName } from "@/lib/languages";

type Phase = "idle" | "uploading" | "dubbing" | "finalizing" | "done" | "error";

export function DubFilmModal({
  open,
  onClose,
  projectId,
}: {
  open: boolean;
  onClose: () => void;
  projectId: string;
}) {
  const [sourceLang, setSourceLang] = useState<string>("auto");
  const [targetLang, setTargetLang] = useState<string>("hi");
  const [numSpeakers, setNumSpeakers] = useState<string>("");
  const [phase, setPhase] = useState<Phase>("idle");
  const [error, setError] = useState<string | null>(null);
  const [downloadUrl, setDownloadUrl] = useState<string | null>(null);
  const [dubbingId, setDubbingId] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, []);

  function reset() {
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
    setPhase("idle");
    setError(null);
    setDownloadUrl(null);
    setDubbingId(null);
  }

  async function start() {
    reset();
    setPhase("uploading");
    try {
      const res = await fetch("/api/dub-film/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectId,
          sourceLang,
          targetLang,
          numSpeakers: numSpeakers ? parseInt(numSpeakers, 10) : undefined,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Failed to start dubbing");
      setDubbingId(json.dubbingId);
      setPhase("dubbing");
      pollRef.current = setInterval(() => checkStatus(json.dubbingId), 5000);
    } catch (e: any) {
      setError(e.message ?? "Failed to start dubbing");
      setPhase("error");
    }
  }

  async function checkStatus(id: string) {
    try {
      const res = await fetch(`/api/dub-film/status?dubbingId=${encodeURIComponent(id)}`);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Status check failed");
      if (json.status === "dubbed") {
        if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
        await finalize(id);
      } else if (json.status === "failed") {
        if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
        setError(json.error || "Dubbing failed on ElevenLabs side");
        setPhase("error");
      }
    } catch (e: any) {
      if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
      setError(e.message ?? "Status check failed");
      setPhase("error");
    }
  }

  async function finalize(id: string) {
    setPhase("finalizing");
    try {
      const res = await fetch("/api/dub-film/finalize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId, dubbingId: id, targetLang }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Finalize failed");
      setDownloadUrl(json.url);
      setPhase("done");
    } catch (e: any) {
      setError(e.message ?? "Finalize failed");
      setPhase("error");
    }
  }

  const busy = phase === "uploading" || phase === "dubbing" || phase === "finalizing";

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur"
          initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
          onClick={() => !busy && onClose()}
        >
          <motion.div
            className="w-full max-w-lg rounded-xl border border-white/10 bg-ink-950 shadow-2xl"
            initial={{ opacity: 0, y: 16, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 8, scale: 0.98 }}
            transition={{ duration: 0.18 }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-white/5 px-5 py-3">
              <div className="font-display text-lg">Dub film (one-button)</div>
              <button
                onClick={onClose}
                disabled={busy}
                className="rounded p-1 text-white/60 hover:bg-white/5 hover:text-white disabled:opacity-40"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="space-y-4 p-5">
              <p className="text-xs text-white/55">
                Sends the whole video to ElevenLabs Dubbing. It isolates each speaker, translates dialogue, and re-renders in the original speakers&apos; voices. No per-line work needed.
              </p>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="mb-1 block text-[10px] uppercase tracking-wider text-white/50">Source language</label>
                  <select
                    value={sourceLang}
                    onChange={(e) => setSourceLang(e.target.value)}
                    disabled={busy}
                    className="h-10 w-full rounded-md border border-white/10 bg-ink-900/60 px-3 text-sm text-white"
                  >
                    <option value="auto">Auto-detect (recommended)</option>
                    {INDIAN_LANGUAGES.map((l) => (
                      <option key={l.code} value={l.code}>{l.name}</option>
                    ))}
                  </select>
                  <p className="mt-1 text-[10px] text-white/40">Leave on Auto-detect — ElevenLabs doesn&apos;t accept every language as an explicit source.</p>
                </div>
                <div>
                  <label className="mb-1 block text-[10px] uppercase tracking-wider text-white/50">Target language</label>
                  <select
                    value={targetLang}
                    onChange={(e) => setTargetLang(e.target.value)}
                    disabled={busy}
                    className="h-10 w-full rounded-md border border-white/10 bg-ink-900/60 px-3 text-sm text-white"
                  >
                    {INDIAN_LANGUAGES.map((l) => (
                      <option key={l.code} value={l.code}>{l.name}</option>
                    ))}
                  </select>
                </div>
              </div>

              <div>
                <label className="mb-1 block text-[10px] uppercase tracking-wider text-white/50">
                  Number of speakers <span className="text-white/30">(optional, helps separation)</span>
                </label>
                <input
                  type="number" min={1} max={10}
                  value={numSpeakers}
                  onChange={(e) => setNumSpeakers(e.target.value)}
                  disabled={busy}
                  placeholder="leave blank to auto-detect"
                  className="h-10 w-full rounded-md border border-white/10 bg-ink-900/60 px-3 text-sm text-white"
                />
              </div>

              {phase === "idle" && (
                <Button onClick={start} disabled={sourceLang === targetLang}>
                  <Wand2 className="h-4 w-4" /> Start dubbing
                </Button>
              )}
              {(phase === "uploading" || phase === "dubbing" || phase === "finalizing") && (
                <div className="rounded-md border border-gold-400/15 bg-gold-400/5 p-3 text-xs text-gold-100">
                  <div className="flex items-center gap-2">
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    <span>
                      {phase === "uploading" && "Uploading video to ElevenLabs…"}
                      {phase === "dubbing" && "ElevenLabs is dubbing. This usually takes a few minutes."}
                      {phase === "finalizing" && "Downloading the dubbed file…"}
                    </span>
                  </div>
                  {dubbingId && phase === "dubbing" && (
                    <p className="mt-2 font-mono text-[10px] text-white/40 break-all">job: {dubbingId}</p>
                  )}
                </div>
              )}
              {phase === "done" && downloadUrl && (
                <div className="rounded-md border border-emerald-400/20 bg-emerald-400/5 p-3 text-xs text-emerald-200">
                  Dubbed to {languageName(targetLang)}. Ready to download.
                  <div className="mt-2">
                    <a
                      href={downloadUrl}
                      download={`dub-${targetLang}.mp4`}
                      target="_blank" rel="noreferrer"
                      className="underline"
                    >
                      Download MP4
                    </a>
                  </div>
                </div>
              )}
              {phase === "error" && error && (
                <div className="rounded-md border border-red-500/20 bg-red-500/10 p-3 text-xs text-red-300">
                  {error}
                  {/source_lang|source language/i.test(error) && (
                    <p className="mt-2 text-amber-200">
                      Set <strong>Source language</strong> to <strong>Auto-detect</strong> and try again. If ElevenLabs still rejects the language, it isn&apos;t supported for one-button dubbing — use the per-line <strong>Translate all → Generate</strong> path instead (it supports Telugu via our own transcription).
                    </p>
                  )}
                  <div className="mt-2">
                    <Button size="sm" variant="secondary" onClick={reset}>Try again</Button>
                  </div>
                </div>
              )}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
