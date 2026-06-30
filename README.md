# CineSync AI — Speech-to-Speech Dub Editor (POC)

A cinematic dub editor for Indian film production teams. Actors record their own
performance, pick a licensed target voice, and the app converts the take into
that voice while preserving emotion, timing, pauses and delivery — powered by
ElevenLabs **Speech-to-Speech / Voice Changer**.

> **POC scope:** Speech-to-Speech only. TTS is intentionally deferred.

## Stack

- Next.js 14 (App Router) · TypeScript · Tailwind · Framer Motion
- Supabase (Auth · Postgres · Storage)
- ElevenLabs Speech-to-Speech (Voice Changer)

## Setup

### 1. Install

```bash
cd cinesync-ai
npm install
```

### 2. Supabase project

1. Create a new Supabase project.
2. In the SQL editor, run `supabase/schema.sql`. This creates all tables, RLS
   policies, the four storage buckets, and seeds a few sample voices.
3. (Optional) Replace the seed rows in `voices` with the real licensed ElevenLabs
   voice IDs your studio is approved to use.

### 3. Env

Copy `.env.example` to `.env.local` and fill in:

```
NEXT_PUBLIC_SUPABASE_URL=...
NEXT_PUBLIC_SUPABASE_ANON_KEY=...
SUPABASE_SERVICE_ROLE_KEY=...     # server-only
ELEVENLABS_API_KEY=...            # server-only
```

> `SUPABASE_SERVICE_ROLE_KEY` and `ELEVENLABS_API_KEY` are used **only** in the
> `/api/generate/speech-to-speech` route. They are never exposed to the browser.

### 4. Run

```bash
npm run dev
```

Visit http://localhost:3000.

## User flow

1. `/signup` → create account (or `/login`)
2. `/dashboard` → see your projects
3. `/projects/new` → name it + upload a short clip
4. `/projects/[id]/editor` →
   - Left: video preview with play/pause + timestamp
   - Middle: list of dialogue lines, with status badges
   - Right: line editor — set start/end, optional script text, pick a target
     voice, **record or upload** your performance, hit **Generate Voice
     Transfer**, compare versions, **approve** and **download**.

## Database

| Table             | Purpose                                                   |
| ----------------- | --------------------------------------------------------- |
| `projects`        | One per dubbing project. Owned by `auth.users`.           |
| `voices`          | Catalog of licensed ElevenLabs voices.                    |
| `dub_lines`       | A timestamped dialogue line within a project.             |
| `audio_versions`  | Each generated take (S2S today, TTS later).               |
| `voice_consents`  | Per-user consent records for licensed voices.             |

Storage buckets:

- `project-videos` — uploaded reference clips (private)
- `input-performances` — actor's own recordings (private)
- `generated-audio` — converted ElevenLabs output (private, signed URLs)
- `voice-samples` — public previews of available voices

All buckets are scoped per user via storage policies based on the path prefix
`<auth.uid()>/...`.

## API

### `POST /api/generate/speech-to-speech`

Server-only. Verifies the caller owns the project, downloads the input audio
from `input-performances`, calls ElevenLabs Speech-to-Speech, uploads the
returned mp3 to `generated-audio`, inserts an `audio_versions` row with
`generation_type = 'speech_to_speech'`, and returns the new version's audio URL.

**Request:**

```json
{
  "projectId": "uuid",
  "dubLineId": "uuid",
  "voiceDbId": "uuid",
  "elevenlabsVoiceId": "21m00Tcm4TlvDq8ikWAM",
  "inputAudioPath": "<user_id>/<project_id>/<line_id>/file.webm"
}
```

**Response:**

```json
{
  "versionId": "uuid",
  "audioPath": "<user_id>/<project_id>/<line_id>/converted.mp3",
  "audioUrl": "https://...signed..."
}
```

## What's intentionally out of scope (for now)

- TTS / text-to-speech (planned as fallback later)
- Full waveform timeline editor
- Multi-user collaboration / roles
- Voice cloning / fine-tuning UI
- Render-out of the final dubbed video (audio export only for the POC)

## Design language

Premium cinematic dark UI — black + charcoal, gold accents, subtle film grain,
studio panels, version cards, and Framer Motion micro-animations.

## License / consent

The `voices` table assumes a curated catalog of voices you are licensed to use.
The `voice_consents` table is wired up so you can capture and enforce per-user
consent before generation in a future iteration.
