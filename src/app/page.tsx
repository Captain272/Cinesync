import Link from "next/link";
import { Button } from "@/components/ui/button";

export default function Home() {
  return (
    <main className="relative z-10 mx-auto flex min-h-screen max-w-6xl flex-col px-6">
      <nav className="flex items-center justify-between py-6">
        <div className="flex items-center gap-2">
          <div className="h-6 w-6 rounded-sm bg-gradient-to-br from-gold-300 to-gold-500" />
          <span className="font-display text-lg tracking-wide">CineSync</span>
          <span className="gold-text font-display text-lg">AI</span>
        </div>
        <div className="flex items-center gap-2">
          <Link href="/login"><Button variant="ghost" size="sm">Log in</Button></Link>
          <Link href="/signup"><Button size="sm">Get access</Button></Link>
        </div>
      </nav>

      <section className="flex flex-1 flex-col items-center justify-center py-24 text-center">
        <span className="mb-5 inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1 text-[11px] uppercase tracking-[0.2em] text-white/60">
          POC · Speech-to-Speech First
        </span>
        <h1 className="font-display text-5xl leading-tight md:text-7xl">
          Your performance.<br />
          <span className="gold-text">Their voice.</span>
        </h1>
        <p className="mt-6 max-w-2xl text-balance text-base text-white/60 md:text-lg">
          CineSync AI is a cinematic dub editor for Indian film teams. Record your line,
          choose a licensed target voice, and preserve every breath, pause and emotion —
          powered by ElevenLabs Voice Changer.
        </p>
        <div className="mt-10 flex flex-wrap items-center justify-center gap-3">
          <Link href="/signup"><Button size="lg">Start a project</Button></Link>
          <Link href="/login"><Button size="lg" variant="outline">I have an account</Button></Link>
        </div>

        <div className="mt-20 grid w-full grid-cols-1 gap-4 md:grid-cols-3">
          {[
            ["01", "Record your performance", "Use your own voice to set the emotion, pacing, and breath."],
            ["02", "Pick a licensed voice", "Cast from a curated library of ElevenLabs voices with proper consent."],
            ["03", "Generate Voice Transfer", "Speech-to-Speech keeps timing intact. Compare versions. Approve takes."],
          ].map(([n, t, d]) => (
            <div key={n} className="panel p-5 text-left">
              <div className="gold-text font-display text-2xl">{n}</div>
              <div className="mt-2 text-sm font-semibold">{t}</div>
              <div className="mt-1 text-xs text-white/55">{d}</div>
            </div>
          ))}
        </div>
      </section>

      <footer className="py-8 text-center text-xs text-white/40">
        Built for studios. Voices licensed via ElevenLabs. © CineSync AI.
      </footer>
    </main>
  );
}
