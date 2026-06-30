import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { Editor } from "@/components/editor/Editor";

export const dynamic = "force-dynamic";

export default async function EditorPage({ params }: { params: { id: string } }) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: project, error } = await supabase
    .from("projects").select("*").eq("id", params.id).single();
  if (error || !project) notFound();

  const { data: voices } = await supabase
    .from("voices").select("*").order("name");

  const { data: lines } = await supabase
    .from("dub_lines").select("*").eq("project_id", project.id).order("start_time");

  let videoUrl: string | null = null;
  if (project.video_path) {
    const { data } = await supabase.storage
      .from("project-videos")
      .createSignedUrl(project.video_path, 60 * 60);
    videoUrl = data?.signedUrl ?? null;
  }

  return (
    <main className="relative z-10 min-h-screen">
      <header className="flex items-center justify-between border-b border-white/5 px-6 py-4">
        <div className="flex items-center gap-4">
          <Link href="/dashboard" className="text-xs uppercase tracking-[0.2em] text-white/50 hover:text-white/80">
            ← Studio
          </Link>
          <div className="font-display text-lg">{project.name}</div>
        </div>
        <div className="text-[10px] uppercase tracking-[0.2em] text-white/40">Speech-to-Speech POC</div>
      </header>

      <Editor
        project={project}
        videoUrl={videoUrl}
        initialLines={lines ?? []}
        voices={voices ?? []}
      />
    </main>
  );
}
