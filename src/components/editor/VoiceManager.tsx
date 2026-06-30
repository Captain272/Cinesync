"use client";
import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X, RefreshCw, Upload, Loader2, Sparkles } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input, Textarea } from "@/components/ui/input";
import type { Voice } from "@/lib/types";

export function VoiceManager({
  open,
  onClose,
  onVoicesChanged,
}: {
  open: boolean;
  onClose: () => void;
  onVoicesChanged: (voices: Voice[]) => void;
}) {
  const supabase = createClient();
  const [tab, setTab] = useState<"sync" | "clone">("sync");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  const [cloneName, setCloneName] = useState("");
  const [cloneDesc, setCloneDesc] = useState("");
  const [cloneLang, setCloneLang] = useState("");
  const [cloneFiles, setCloneFiles] = useState<File[]>([]);
  const [consent, setConsent] = useState(false);

  async function refreshVoices() {
    const { data } = await supabase.from("voices").select("*").order("name");
    onVoicesChanged((data ?? []) as Voice[]);
  }

  async function handleSync() {
    setBusy(true); setError(null); setInfo(null);
    try {
      const res = await fetch("/api/voices/sync", { method: "POST" });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Sync failed");
      await refreshVoices();
      setInfo(`Synced ${json.synced} voice${json.synced === 1 ? "" : "s"} from ElevenLabs.`);
    } catch (e: any) {
      setError(e.message ?? "Sync failed");
    } finally {
      setBusy(false);
    }
  }

  async function handleClone(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setError(null); setInfo(null);
    try {
      if (!cloneName.trim()) throw new Error("Name is required");
      if (cloneFiles.length === 0) throw new Error("Attach at least one audio sample");
      if (!consent) throw new Error("You must confirm consent");

      const form = new FormData();
      form.append("name", cloneName.trim());
      if (cloneDesc) form.append("description", cloneDesc);
      if (cloneLang) form.append("language", cloneLang);
      form.append("consent", "true");
      for (const f of cloneFiles) form.append("files", f);

      const res = await fetch("/api/voices/clone", { method: "POST", body: form });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Clone failed");
      await refreshVoices();
      setInfo(`Voice "${json.voice.name}" cloned and ready to use.`);
      setCloneName(""); setCloneDesc(""); setCloneLang(""); setCloneFiles([]); setConsent(false);
    } catch (e: any) {
      setError(e.message ?? "Clone failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur"
          initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
          onClick={onClose}
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
              <div className="font-display text-lg">Manage voices</div>
              <button onClick={onClose} className="rounded p-1 text-white/60 hover:bg-white/5 hover:text-white">
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="flex gap-1 border-b border-white/5 px-3 pt-3">
              {(["sync", "clone"] as const).map((t) => (
                <button
                  key={t}
                  onClick={() => { setTab(t); setError(null); setInfo(null); }}
                  className={`rounded-t-md px-3 py-2 text-xs uppercase tracking-wider ${
                    tab === t ? "bg-white/5 text-white" : "text-white/50 hover:text-white/80"
                  }`}
                >
                  {t === "sync" ? "Sync from ElevenLabs" : "Clone new voice"}
                </button>
              ))}
            </div>

            <div className="space-y-4 p-5">
              {tab === "sync" && (
                <div className="space-y-3">
                  <p className="text-sm text-white/60">
                    Pulls every voice from your ElevenLabs account (premade, library, and clones) and adds them to the dropdown.
                  </p>
                  <Button onClick={handleSync} disabled={busy}>
                    {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                    {busy ? "Syncing…" : "Sync now"}
                  </Button>
                </div>
              )}

              {tab === "clone" && (
                <form onSubmit={handleClone} className="space-y-3">
                  <div>
                    <label className="mb-1 block text-[10px] uppercase tracking-wider text-white/50">Voice name</label>
                    <Input value={cloneName} onChange={(e) => setCloneName(e.target.value)} placeholder="e.g. Maria — Spanish lead" />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="mb-1 block text-[10px] uppercase tracking-wider text-white/50">Language code</label>
                      <Input value={cloneLang} onChange={(e) => setCloneLang(e.target.value)} placeholder="en, es, fr…" />
                    </div>
                    <div>
                      <label className="mb-1 block text-[10px] uppercase tracking-wider text-white/50">Samples</label>
                      <input
                        type="file" accept="audio/*" multiple
                        onChange={(e) => setCloneFiles(Array.from(e.target.files ?? []))}
                        className="block h-10 w-full text-xs text-white/70 file:mr-2 file:h-full file:rounded-md file:border-0 file:bg-white/10 file:px-2 file:text-xs file:text-white"
                      />
                    </div>
                  </div>
                  <div>
                    <label className="mb-1 block text-[10px] uppercase tracking-wider text-white/50">Description (optional)</label>
                    <Textarea value={cloneDesc} onChange={(e) => setCloneDesc(e.target.value)} placeholder="Tone, accent, character notes…" />
                  </div>
                  <label className="flex items-start gap-2 rounded-md border border-white/8 bg-ink-900/60 p-3 text-xs text-white/70">
                    <input
                      type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)}
                      className="mt-0.5 h-3.5 w-3.5"
                    />
                    <span>I confirm that I own this voice or have written permission from its owner to clone it for use in this project.</span>
                  </label>
                  <Button type="submit" disabled={busy}>
                    {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
                    {busy ? "Cloning…" : "Clone voice"}
                  </Button>
                  <p className="text-[11px] text-white/40">
                    <Upload className="mr-1 inline h-3 w-3" />
                    Tip: 30–90 seconds of clean speech yields the best Instant Voice Clone.
                  </p>
                </form>
              )}

              {error && <p className="text-xs text-red-400">{error}</p>}
              {info && <p className="text-xs text-emerald-400">{info}</p>}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
