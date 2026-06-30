"use client";
import { useCallback, useEffect, useState } from "react";

export type TuningDefaults = {
  modelId: string;
  stability: number;
  similarity: number;
  style: number;
  speakerBoost: boolean;
  denoise: boolean;
};

const KEY = "cinesync.tuning.v1";

const DEFAULTS: TuningDefaults = {
  modelId: "eleven_multilingual_sts_v2",
  stability: 0.3,
  similarity: 0.85,
  style: 0.25,
  speakerBoost: true,
  denoise: false,
};

// More expressive settings for text-to-speech, where delivery comes entirely
// from the model (no human performance to carry the emotion).
export const TTS_EMOTION = {
  stability: 0.28,
  similarity_boost: 0.8,
  style: 0.45,
  use_speaker_boost: true,
};

export function useTuningDefaults() {
  const [tuning, setTuning] = useState<TuningDefaults>(DEFAULTS);

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const raw = window.localStorage.getItem(KEY);
      if (raw) setTuning({ ...DEFAULTS, ...JSON.parse(raw) });
    } catch {}
  }, []);

  const update = useCallback((patch: Partial<TuningDefaults>) => {
    setTuning((prev) => {
      const next = { ...prev, ...patch };
      try { window.localStorage.setItem(KEY, JSON.stringify(next)); } catch {}
      return next;
    });
  }, []);

  return { tuning, update };
}
