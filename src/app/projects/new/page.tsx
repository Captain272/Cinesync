"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input, Textarea } from "@/components/ui/input";
import { Panel } from "@/components/ui/panel";

export default function NewProjectPage() {
  const router = useRouter();
  const supabase = createClient();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true); setError(null);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Not authenticated");

      const { data: project, error: pErr } = await supabase
        .from("projects").insert({ user_id: user.id, name, description }).select().single();
      if (pErr) throw pErr;

      if (file) {
        const path = `${user.id}/${project.id}/video-${Date.now()}-${file.name}`;
        const { error: upErr } = await supabase.storage.from("project-videos").upload(path, file, {
          upsert: false,
          contentType: file.type || "video/mp4",
        });
        if (upErr) throw upErr;
        await supabase.from("projects").update({ video_path: path }).eq("id", project.id);
      }

      router.push(`/projects/${project.id}/editor`);
    } catch (err: any) {
      setError(err.message ?? "Failed to create project");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="relative z-10 mx-auto max-w-2xl px-6 py-10">
      <Link href="/dashboard" className="mb-6 inline-block text-xs uppercase tracking-[0.2em] text-white/50">← Dashboard</Link>
      <Panel className="p-8">
        <h1 className="font-display text-3xl">New project</h1>
        <p className="mt-1 text-sm text-white/55">Give it a name and upload a short clip to dub.</p>
        <form onSubmit={handleSubmit} className="mt-6 space-y-4">
          <div>
            <label className="mb-1 block text-xs uppercase tracking-wider text-white/50">Project name</label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Scene 14 — Cafe dialogue" required />
          </div>
          <div>
            <label className="mb-1 block text-xs uppercase tracking-wider text-white/50">Description</label>
            <Textarea value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Optional context, notes, language…" />
          </div>
          <div>
            <label className="mb-1 block text-xs uppercase tracking-wider text-white/50">Video clip</label>
            <input
              type="file"
              accept="video/*"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              className="block w-full text-sm text-white/70 file:mr-3 file:rounded-md file:border-0 file:bg-gold-500 file:px-3 file:py-2 file:text-xs file:font-semibold file:text-ink-950 hover:file:bg-gold-400"
            />
            <p className="mt-1 text-[11px] text-white/40">MP4/MOV recommended. Keep clips short for the POC.</p>
          </div>
          {error && <p className="text-xs text-red-400">{error}</p>}
          <Button type="submit" size="lg" disabled={loading || !name}>
            {loading ? "Creating…" : "Create project"}
          </Button>
        </form>
      </Panel>
    </main>
  );
}
