"use client";
import { Trash2, Users } from "lucide-react";
import { motion } from "framer-motion";
import { useMemo } from "react";
import type { DubLine, Voice } from "@/lib/types";
import { Badge } from "@/components/ui/badge";
import { cn, formatTime } from "@/lib/utils";

const statusTone: Record<DubLine["status"], "default" | "gold" | "green" | "red" | "blue"> = {
  draft: "default",
  ready: "blue",
  generating: "gold",
  done: "green",
  approved: "green",
  error: "red",
};

const UNASSIGNED = "__unassigned__";

function prettySpeaker(id: string): string {
  if (id === UNASSIGNED) return "Unassigned";
  const m = id.match(/(\d+)/);
  if (m) return `Speaker ${parseInt(m[1], 10) + 1}`;
  return id;
}

export function LinesPanel({
  lines,
  voices,
  selectedId,
  currentTime,
  onSelect,
  onDelete,
  onAssignSpeakerVoice,
  approvedLineIds,
}: {
  lines: DubLine[];
  voices: Voice[];
  selectedId: string | null;
  currentTime: number;
  onSelect: (id: string) => void;
  onDelete: (id: string) => void;
  onAssignSpeakerVoice?: (speakerKey: string, voiceId: string | null) => void;
  approvedLineIds?: Set<string>;
}) {
  const groups = useMemo(() => {
    const map = new Map<string, DubLine[]>();
    for (const l of lines) {
      const k = l.speaker_id ?? UNASSIGNED;
      const arr = map.get(k) ?? [];
      arr.push(l);
      map.set(k, arr);
    }
    return Array.from(map.entries()).sort((a, b) => {
      if (a[0] === UNASSIGNED) return 1;
      if (b[0] === UNASSIGNED) return -1;
      return a[0].localeCompare(b[0]);
    });
  }, [lines]);

  const hasSpeakerInfo = groups.some(([k]) => k !== UNASSIGNED);

  if (lines.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center text-sm text-white/40">
        No dialogue lines yet. Add one to start dubbing.
      </div>
    );
  }

  function renderLine(line: DubLine) {
    const voice = voices.find((v) => v.id === line.selected_voice_id);
    const isPlaying = currentTime >= line.start_time && currentTime <= line.end_time;
    const isSelected = selectedId === line.id;
    const hasAudio = !!line.input_audio_path;
    const hasVoice = !!line.selected_voice_id;
    const isApproved = approvedLineIds?.has(line.id) ?? false;
    return (
      <motion.div
        key={line.id}
        layout
        onClick={() => onSelect(line.id)}
        className={cn(
          "group cursor-pointer rounded-lg border bg-ink-900/40 p-3 transition-all",
          isSelected ? "border-gold-400/40 shadow-gold" : "border-white/5 hover:border-white/10",
          isPlaying && !isSelected && "ring-1 ring-gold-400/20"
        )}
      >
        <div className="flex items-center justify-between text-[11px] text-white/40">
          <span className="font-mono">
            {formatTime(line.start_time)} → {formatTime(line.end_time)}
          </span>
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-1" title={`audio: ${hasAudio ? "yes" : "no"} · voice: ${hasVoice ? "yes" : "no"} · approved: ${isApproved ? "yes" : "no"}`}>
              <span className={cn("h-1.5 w-1.5 rounded-full", hasAudio ? "bg-sky-400" : "bg-white/15")} />
              <span className={cn("h-1.5 w-1.5 rounded-full", hasVoice ? "bg-gold-400" : "bg-white/15")} />
              <span className={cn("h-1.5 w-1.5 rounded-full", isApproved ? "bg-emerald-400" : "bg-white/15")} />
            </div>
            <Badge tone={statusTone[line.status]}>{line.status}</Badge>
            <button
              onClick={(e) => { e.stopPropagation(); onDelete(line.id); }}
              className="opacity-0 transition-opacity hover:text-red-400 group-hover:opacity-100"
              aria-label="Delete line"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
        <div className="mt-1.5 truncate text-sm text-white/85">
          {line.dialogue_text || <span className="text-white/40 italic">No text · performance only</span>}
        </div>
        <div className="mt-1 text-[11px] text-white/45">
          {voice ? <>Voice: <span className="text-gold-300">{voice.name}</span></> : "Voice: —"}
        </div>
      </motion.div>
    );
  }

  // Flat list when there's no speaker info at all.
  if (!hasSpeakerInfo) {
    return <div className="space-y-2">{lines.map(renderLine)}</div>;
  }

  return (
    <div className="space-y-5">
      {groups.map(([speakerKey, groupLines]) => {
        const commonVoiceId =
          groupLines.every((l) => l.selected_voice_id === groupLines[0].selected_voice_id)
            ? groupLines[0].selected_voice_id
            : "";
        return (
          <div key={speakerKey} className="space-y-2">
            <div className="flex items-center justify-between gap-3 rounded-md border border-white/8 bg-ink-900/60 px-3 py-2">
              <div className="flex items-center gap-2 text-xs">
                <Users className="h-3.5 w-3.5 text-white/40" />
                <span className="font-semibold text-white/85">{prettySpeaker(speakerKey)}</span>
                <span className="text-white/40">· {groupLines.length} line{groupLines.length === 1 ? "" : "s"}</span>
              </div>
              {onAssignSpeakerVoice && (
                <select
                  value={commonVoiceId ?? ""}
                  onChange={(e) => onAssignSpeakerVoice(speakerKey, e.target.value || null)}
                  onClick={(e) => e.stopPropagation()}
                  className="h-7 max-w-[14rem] rounded-md border border-white/10 bg-ink-950 px-2 text-[11px] text-white"
                  title="Apply this voice to every line by this speaker"
                >
                  <option value="">— Assign voice to all —</option>
                  {voices.map((v) => (
                    <option key={v.id} value={v.id}>
                      {v.name}{v.language ? ` · ${v.language}` : ""}
                    </option>
                  ))}
                </select>
              )}
            </div>
            <div className="space-y-2">{groupLines.map(renderLine)}</div>
          </div>
        );
      })}
    </div>
  );
}
