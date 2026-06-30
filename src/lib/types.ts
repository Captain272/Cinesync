export type Project = {
  id: string;
  user_id: string;
  name: string;
  description: string | null;
  video_path: string | null;
  created_at: string;
};

export type Voice = {
  id: string;
  elevenlabs_voice_id: string;
  name: string;
  description: string | null;
  sample_path: string | null;
  language: string | null;
  is_licensed: boolean;
  created_at: string;
};

export type DubLine = {
  id: string;
  project_id: string;
  start_time: number;
  end_time: number;
  dialogue_text: string | null;
  selected_voice_id: string | null;
  input_audio_path: string | null;
  status: "draft" | "ready" | "generating" | "done" | "approved" | "error";
  speaker_id: string | null;
  translated_text: string | null;
  created_at: string;
};

export type AudioVersion = {
  id: string;
  dub_line_id: string;
  generation_type: "speech_to_speech" | "text_to_speech";
  voice_id: string | null;
  audio_path: string;
  is_approved: boolean;
  metadata: Record<string, unknown> | null;
  created_at: string;
};
