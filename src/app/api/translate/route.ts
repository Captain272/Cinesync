import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { languageName } from "@/lib/languages";

export const runtime = "nodejs";
export const maxDuration = 60;

// Prefer Azure OpenAI when configured; otherwise fall back to any
// OpenAI-compatible provider via TRANSLATE_* vars (Novita, OpenRouter, NVIDIA…).
const AZURE_ENDPOINT = (process.env.AZURE_OPENAI_ENDPOINT || "").replace(/\/+$/, "");
const AZURE_KEY = process.env.AZURE_OPENAI_API_KEY;
const AZURE_DEPLOYMENT = process.env.AZURE_OPENAI_DEPLOYMENT;
const AZURE_VERSION = process.env.AZURE_OPENAI_API_VERSION || "2024-12-01-preview";
const USE_AZURE = !!(AZURE_ENDPOINT && AZURE_KEY && AZURE_DEPLOYMENT);

const BASE_URL = process.env.TRANSLATE_BASE_URL || "https://api.novita.ai/openai/v1";
const MODEL = process.env.TRANSLATE_MODEL || "moonshotai/kimi-k2.6";

type Body = {
  text?: string;
  items?: { id: string; text: string }[];
  targetLang: string; // ISO code
  sourceLang?: string; // optional ISO code, else auto
  context?: string; // optional surrounding-dialogue context for single text
};

const SYSTEM_PROMPT =
  "You are a professional film dubbing translator. You translate spoken movie dialogue between Indian languages and English. " +
  "Rules: (1) Preserve the emotion, tone, register, and intent of the original line. (2) Produce natural spoken dialogue, not literal word-for-word translation. (3) Keep it roughly the same spoken length so it fits the on-screen timing. (4) Use the surrounding lines only to get tone, pronouns, names, and references right — never translate or echo them. (5) Do not add quotes, notes, transliteration, or explanations. (6) Output ONLY the translated line text, nothing else.";

// Build a context window (a few lines before/after) for item i in a batch.
function batchContext(items: { text: string }[], i: number): string {
  const before = items.slice(Math.max(0, i - 3), i).map((x) => `  ${x.text}`);
  const after = items.slice(i + 1, i + 4).map((x) => `  ${x.text}`);
  if (before.length === 0 && after.length === 0) return "";
  return [...before, "  >>> [THIS LINE] <<<", ...after].join("\n");
}

function buildRequest(messages: { role: string; content: string }[]): { url: string; headers: Record<string, string>; body: string } {
  if (USE_AZURE) {
    return {
      url: `${AZURE_ENDPOINT}/openai/deployments/${AZURE_DEPLOYMENT}/chat/completions?api-version=${AZURE_VERSION}`,
      headers: { "api-key": AZURE_KEY!, "Content-Type": "application/json" },
      // gpt-5 / o-series deployments require max_completion_tokens and only
      // support default temperature, so we omit temperature here.
      body: JSON.stringify({ messages, max_completion_tokens: 2048 }),
    };
  }
  return {
    url: `${BASE_URL}/chat/completions`,
    headers: {
      Authorization: `Bearer ${process.env.TRANSLATE_API_KEY!}`,
      "Content-Type": "application/json",
      "X-Title": "CineSync AI",
    },
    body: JSON.stringify({ model: MODEL, max_tokens: 1024, temperature: 0.3, messages }),
  };
}

async function translateOne(
  text: string,
  targetName: string,
  sourceName: string | null,
  context?: string
): Promise<string> {
  const src = sourceName ? `from ${sourceName} ` : "";
  const ctxBlock = context
    ? `\n\nSurrounding dialogue for context only (do NOT translate these, they are just to get tone and references right):\n${context}\n`
    : "";
  const { url, headers, body } = buildRequest([
    { role: "system", content: SYSTEM_PROMPT },
    {
      role: "user",
      content: `Translate this movie dialogue line ${src}into ${targetName}.${ctxBlock}\nOutput only the translated line:\n\n${text}`,
    },
  ]);
  const res = await fetch(url, { method: "POST", headers, body });
  if (!res.ok) {
    const t = await res.text().catch(() => "");
    throw new Error(`Translate API (${res.status}): ${t.slice(0, 300)}`);
  }
  const json = await res.json();
  const out = (json.choices?.[0]?.message?.content ?? "").trim();
  if (!out) throw new Error("Empty translation");
  return out;
}

export async function POST(req: Request) {
  if (!USE_AZURE && !process.env.TRANSLATE_API_KEY) {
    return NextResponse.json({ error: "No translation provider configured (set AZURE_OPENAI_* or TRANSLATE_API_KEY)" }, { status: 500 });
  }
  let body: Body;
  try { body = (await req.json()) as Body; }
  catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }

  if (!body.targetLang) {
    return NextResponse.json({ error: "Missing targetLang" }, { status: 400 });
  }

  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const targetName = languageName(body.targetLang);
  const sourceName = body.sourceLang ? languageName(body.sourceLang) : null;

  try {
    if (body.items && body.items.length > 0) {
      const items = body.items;
      const results = await Promise.all(
        items.map(async (it, i) => ({
          id: it.id,
          text: await translateOne(it.text, targetName, sourceName, batchContext(items, i)),
        }))
      );
      return NextResponse.json({ translations: results });
    }
    if (body.text?.trim()) {
      const translated = await translateOne(body.text.trim(), targetName, sourceName, body.context);
      return NextResponse.json({ translated });
    }
    return NextResponse.json({ error: "Nothing to translate" }, { status: 400 });
  } catch (e: any) {
    return NextResponse.json({ error: e.message ?? "Translation failed" }, { status: 502 });
  }
}
