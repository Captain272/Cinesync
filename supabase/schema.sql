-- CineSync AI — Database schema
-- Run this in the Supabase SQL editor.

create extension if not exists "uuid-ossp";

-- =========================================
-- TABLES
-- =========================================

create table if not exists public.projects (
  id          uuid primary key default uuid_generate_v4(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  name        text not null,
  description text,
  video_path  text,
  created_at  timestamptz not null default now()
);

create table if not exists public.voices (
  id                   uuid primary key default uuid_generate_v4(),
  elevenlabs_voice_id  text not null unique,
  name                 text not null,
  description          text,
  sample_path          text,
  language             text,
  is_licensed          boolean not null default true,
  created_at           timestamptz not null default now()
);

create table if not exists public.dub_lines (
  id                 uuid primary key default uuid_generate_v4(),
  project_id         uuid not null references public.projects(id) on delete cascade,
  start_time         numeric not null default 0,
  end_time           numeric not null default 0,
  dialogue_text      text,
  selected_voice_id  uuid references public.voices(id),
  input_audio_path   text,
  status             text not null default 'draft',
  speaker_id         text,
  translated_text    text,
  created_at         timestamptz not null default now()
);
alter table public.dub_lines add column if not exists speaker_id text;
alter table public.dub_lines add column if not exists translated_text text;

create table if not exists public.audio_versions (
  id              uuid primary key default uuid_generate_v4(),
  dub_line_id     uuid not null references public.dub_lines(id) on delete cascade,
  generation_type text not null check (generation_type in ('speech_to_speech','text_to_speech')),
  voice_id        uuid references public.voices(id),
  audio_path      text not null,
  is_approved     boolean not null default false,
  metadata        jsonb,
  created_at      timestamptz not null default now()
);

create table if not exists public.voice_consents (
  id                  uuid primary key default uuid_generate_v4(),
  user_id             uuid not null references auth.users(id) on delete cascade,
  voice_id            uuid not null references public.voices(id) on delete cascade,
  consent_document    text,
  signed_at           timestamptz not null default now(),
  unique (user_id, voice_id)
);

create index if not exists idx_projects_user        on public.projects(user_id);
create index if not exists idx_dub_lines_project    on public.dub_lines(project_id);
create index if not exists idx_audio_versions_line  on public.audio_versions(dub_line_id);

-- =========================================
-- ROW LEVEL SECURITY
-- =========================================
alter table public.projects        enable row level security;
alter table public.dub_lines       enable row level security;
alter table public.audio_versions  enable row level security;
alter table public.voice_consents  enable row level security;
alter table public.voices          enable row level security;

-- Projects: owner-only
drop policy if exists "projects_owner_rw" on public.projects;
create policy "projects_owner_rw" on public.projects
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- Dub lines: via project ownership
drop policy if exists "dub_lines_owner_rw" on public.dub_lines;
create policy "dub_lines_owner_rw" on public.dub_lines
  for all using (
    exists (select 1 from public.projects p where p.id = project_id and p.user_id = auth.uid())
  ) with check (
    exists (select 1 from public.projects p where p.id = project_id and p.user_id = auth.uid())
  );

-- Audio versions: via dub line -> project ownership
drop policy if exists "audio_versions_owner_rw" on public.audio_versions;
create policy "audio_versions_owner_rw" on public.audio_versions
  for all using (
    exists (
      select 1 from public.dub_lines d
      join public.projects p on p.id = d.project_id
      where d.id = dub_line_id and p.user_id = auth.uid()
    )
  ) with check (
    exists (
      select 1 from public.dub_lines d
      join public.projects p on p.id = d.project_id
      where d.id = dub_line_id and p.user_id = auth.uid()
    )
  );

-- Voices: read for any authenticated user
drop policy if exists "voices_read_all_auth" on public.voices;
create policy "voices_read_all_auth" on public.voices
  for select using (auth.role() = 'authenticated');

-- Voice consents: owner-only
drop policy if exists "voice_consents_owner_rw" on public.voice_consents;
create policy "voice_consents_owner_rw" on public.voice_consents
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- =========================================
-- STORAGE BUCKETS
-- =========================================
insert into storage.buckets (id, name, public) values
  ('project-videos',     'project-videos',     false),
  ('input-performances', 'input-performances', false),
  ('generated-audio',    'generated-audio',    false),
  ('voice-samples',      'voice-samples',      true)
on conflict (id) do nothing;

-- Storage policies — users can manage objects under their own auth.uid() folder.
-- Expect object paths formatted as `<auth.uid()>/<project_id>/<file>`.

drop policy if exists "user_rw_own_project_videos" on storage.objects;
create policy "user_rw_own_project_videos" on storage.objects
  for all using (
    bucket_id = 'project-videos' and (storage.foldername(name))[1] = auth.uid()::text
  ) with check (
    bucket_id = 'project-videos' and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "user_rw_own_input_performances" on storage.objects;
create policy "user_rw_own_input_performances" on storage.objects
  for all using (
    bucket_id = 'input-performances' and (storage.foldername(name))[1] = auth.uid()::text
  ) with check (
    bucket_id = 'input-performances' and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "user_r_own_generated_audio" on storage.objects;
create policy "user_r_own_generated_audio" on storage.objects
  for select using (
    bucket_id = 'generated-audio' and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "public_read_voice_samples" on storage.objects;
create policy "public_read_voice_samples" on storage.objects
  for select using (bucket_id = 'voice-samples');

-- =========================================
-- SEED VOICES (replace with real licensed voices)
-- =========================================
insert into public.voices (elevenlabs_voice_id, name, description, language, is_licensed) values
  ('21m00Tcm4TlvDq8ikWAM', 'Rachel — Neutral Female (EN)', 'Warm, neutral female reference voice', 'en', true),
  ('AZnzlk1XvdvUeBnXmlld', 'Domi — Strong Female (EN)',    'Confident, energetic',                'en', true),
  ('ErXwobaYiN019PkySvjV', 'Antoni — Warm Male (EN)',      'Smooth, friendly male voice',         'en', true)
on conflict (elevenlabs_voice_id) do nothing;
