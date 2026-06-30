import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { Button } from "@/components/ui/button";
import { Panel } from "@/components/ui/panel";
import { Plus, Film } from "lucide-react";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: projects } = await supabase
    .from("projects")
    .select("id,name,description,created_at")
    .order("created_at", { ascending: false });

  return (
    <main className="relative z-10 mx-auto max-w-6xl px-6 py-10">
      <header className="mb-8 flex items-center justify-between">
        <div>
          <div className="text-xs uppercase tracking-[0.2em] text-white/40">Studio</div>
          <h1 className="font-display text-3xl">Your projects</h1>
        </div>
        <Link href="/projects/new"><Button><Plus className="h-4 w-4" /> New project</Button></Link>
      </header>

      {projects && projects.length > 0 ? (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
          {projects.map((p) => (
            <Link key={p.id} href={`/projects/${p.id}/editor`}>
              <Panel className="group cursor-pointer p-5 transition-all hover:border-gold-400/30 hover:shadow-gold">
                <div className="flex items-center gap-2 text-gold-300">
                  <Film className="h-4 w-4" />
                  <span className="text-[10px] uppercase tracking-[0.18em]">Project</span>
                </div>
                <div className="mt-2 font-display text-xl leading-tight">{p.name}</div>
                {p.description && (
                  <p className="mt-1 line-clamp-2 text-xs text-white/55">{p.description}</p>
                )}
                <div className="mt-4 text-[10px] text-white/30">
                  Created {new Date(p.created_at).toLocaleDateString()}
                </div>
              </Panel>
            </Link>
          ))}
        </div>
      ) : (
        <Panel className="flex flex-col items-center justify-center gap-3 px-6 py-20 text-center">
          <Film className="h-8 w-8 text-gold-400" />
          <h2 className="font-display text-2xl">No projects yet</h2>
          <p className="max-w-md text-sm text-white/55">
            Spin up your first project, upload a clip, and start dubbing in your own performance.
          </p>
          <Link href="/projects/new" className="mt-2"><Button>Create project</Button></Link>
        </Panel>
      )}
    </main>
  );
}
