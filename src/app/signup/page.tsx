"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export default function SignupPage() {
  const router = useRouter();
  const supabase = createClient();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true); setError(null); setInfo(null);
    const { data, error } = await supabase.auth.signUp({ email, password });
    setLoading(false);
    if (error) return setError(error.message);
    if (data.session) {
      router.push("/dashboard");
      router.refresh();
    } else {
      setInfo("Check your inbox to confirm your email.");
    }
  }

  return (
    <main className="relative z-10 mx-auto flex min-h-screen max-w-md flex-col justify-center px-6">
      <Link href="/" className="mb-8 text-xs uppercase tracking-[0.2em] text-white/50">← CineSync AI</Link>
      <div className="panel p-8">
        <h1 className="font-display text-3xl">Create your studio</h1>
        <p className="mt-1 text-sm text-white/55">Start dubbing with licensed voices in minutes.</p>
        <form onSubmit={handleSubmit} className="mt-6 space-y-3">
          <Input type="email" placeholder="you@studio.com" value={email} onChange={(e) => setEmail(e.target.value)} required />
          <Input type="password" minLength={6} placeholder="Password (min 6 chars)" value={password} onChange={(e) => setPassword(e.target.value)} required />
          {error && <p className="text-xs text-red-400">{error}</p>}
          {info && <p className="text-xs text-emerald-300">{info}</p>}
          <Button type="submit" size="lg" className="w-full" disabled={loading}>
            {loading ? "Creating…" : "Create account"}
          </Button>
        </form>
        <p className="mt-5 text-center text-xs text-white/50">
          Already have one? <Link href="/login" className="text-gold-300 hover:underline">Sign in</Link>
        </p>
      </div>
    </main>
  );
}
