"use client";
import { useMemo } from "react";
import { CheckCircle2, Mic, Music3, Users } from "lucide-react";
import type { DubLine } from "@/lib/types";

export function ProjectStatus({
  lines,
  approvedCount,
}: {
  lines: DubLine[];
  approvedCount: number;
}) {
  const stats = useMemo(() => {
    const total = lines.length;
    const withAudio = lines.filter((l) => !!l.input_audio_path).length;
    const withVoice = lines.filter((l) => !!l.selected_voice_id).length;
    const speakers = new Set(lines.map((l) => l.speaker_id).filter(Boolean)).size;
    return { total, withAudio, withVoice, speakers };
  }, [lines]);

  const pct = stats.total === 0 ? 0 : Math.round((approvedCount / stats.total) * 100);

  return (
    <div className="flex flex-wrap items-center gap-x-6 gap-y-2 rounded-lg border border-white/8 bg-ink-900/40 px-4 py-2.5">
      <Stat icon={<Music3 className="h-3.5 w-3.5" />} label="Lines" value={`${stats.total}`} />
      <Stat icon={<Mic className="h-3.5 w-3.5" />} label="With audio" value={`${stats.withAudio}/${stats.total}`} />
      <Stat icon={<Users className="h-3.5 w-3.5" />} label="Speakers" value={`${stats.speakers || "—"}`} />
      <Stat icon={<CheckCircle2 className="h-3.5 w-3.5" />} label="Approved" value={`${approvedCount}/${stats.total}`} />
      <div className="ml-auto flex items-center gap-4">
        <div className="hidden gap-2 text-[10px] text-white/35 md:flex">
          <Hint k="↑↓" v="navigate" />
          <Hint k="Space" v="play" />
          <Hint k="J" v="jump" />
          <Hint k="G" v="generate" />
          <Hint k="A" v="approve" />
        </div>
        <div className="flex items-center gap-2">
          <div className="h-1.5 w-32 overflow-hidden rounded-full bg-white/8">
            <div
              className="h-full rounded-full bg-gradient-to-r from-gold-400 to-gold-300 transition-all duration-300"
              style={{ width: `${pct}%` }}
            />
          </div>
          <div className="font-mono text-[11px] text-white/60">{pct}%</div>
        </div>
      </div>
    </div>
  );
}

function Hint({ k, v }: { k: string; v: string }) {
  return (
    <span className="inline-flex items-center gap-1">
      <kbd className="rounded border border-white/15 bg-white/5 px-1 py-px font-mono text-[9px] text-white/60">{k}</kbd>
      <span className="uppercase tracking-wider">{v}</span>
    </span>
  );
}

function Stat({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="flex items-center gap-2 text-[11px]">
      <span className="text-white/40">{icon}</span>
      <span className="text-white/45 uppercase tracking-wider">{label}</span>
      <span className="font-mono text-white/85">{value}</span>
    </div>
  );
}
