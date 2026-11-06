// PROVIEW SIGNAGE — AI help chat.
// Answers questions from the dashboard's Help page using the Help guides (/help-kb.json).
// Needs the secret ANTHROPIC_API_KEY (Supabase → Edge Functions → Secrets).
// Signed-in people only; daily limit enforced by public.help_chat_tick() (migration 023).
import { createClient } from "npm:@supabase/supabase-js@2";

const MODEL = Deno.env.get("HELP_CHAT_MODEL") ?? "claude-haiku-5-5";
const KB_URL = Deno.env.get("HELP_KB_URL") ?? "https://app.proviewsignage.co.uk/help-kb.json";
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });

// The guides, refreshed every 10 minutes so Help page edits reach the chat without redeploying.
let kb = { text: "", at: 0 };
async function knowledge(): Promise<string> {
  if (kb.text && Date.now() - kb.at < 10 * 60_000) return kb.text;
  try {
    const r = await fetch(KB_URL, { headers: { "cache-control": "no-cache" } });
    if (r.ok) kb = { text: (await r.json()).text ?? "", at: Date.now() };
  } catch (_) { /* keep the last copy */ }
  return kb.text;
}

const RULES = `You are the help assistant inside the PROVIEW SIGNAGE dashboard (digital signage for UK businesses).
Answer questions about using PROVIEW SIGNAGE: the dashboard, the TV app, licences and prices.
- Use only the guide below. If it doesn't cover something, say you're not sure and suggest calling 020 8935 5495. Never invent features, buttons or prices.
- Write in plain British English for a busy shop owner. Be brief: a short answer, then numbered steps if needed.
- Put button and menu names in **bold**, exactly as the guide writes them.
- Politely decline topics unrelated to PROVIEW SIGNAGE or digital screens.
- Never ask for passwords, card details or other secrets.`;

type Msg = { role: "user" | "assistant"; content: string };

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "Use POST" }, 405);

  const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
  if (!apiKey) return json({ error: "The help chat isn't switched on yet (no AI key set)." }, 503);

  // Who is asking?
  const auth = req.headers.get("Authorization") ?? "";
  const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: auth } },
  });
  const { data: { user } } = await sb.auth.getUser();
  if (!user || user.is_anonymous) return json({ error: "Please sign in to use the help chat." }, 401);

  // Validate the conversation the page sent.
  let messages: Msg[] = [];
  // deno-lint-ignore no-explicit-any
  let body: any = {};
  try { body = await req.json(); } catch (_) { /* empty */ }
  try {
    messages = (Array.isArray(body?.messages) ? body.messages : [])
      .filter((m: Msg) => (m?.role === "user" || m?.role === "assistant") && typeof m.content === "string" && m.content.trim())
      .slice(-12)
      .map((m: Msg) => ({ role: m.role, content: m.content.slice(0, 2000) }));
  } catch (_) { /* fall through */ }
  while (messages.length && messages[0].role !== "user") messages.shift();
  if (!messages.length || messages[messages.length - 1].role !== "user") return json({ error: "Type a question first." }, 400);

  // Count it against today's limit only once we know it's a real question.
  const tick = await sb.rpc("help_chat_tick");
  if (tick.error) return json({ error: tick.error.message }, 429);

  const page = body?.page;
  const guide = await knowledge();
  const system = [
    { type: "text", text: `${RULES}\n\n<guide>\n${guide}\n</guide>`, cache_control: { type: "ephemeral" } },
    ...(typeof page === "string" && page ? [{ type: "text", text: `The person is on the dashboard page: ${page.slice(0, 60)}` }] : []),
  ];

  const r = await fetch(Deno.env.get("ANTHROPIC_URL") ?? "https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "x-api-key": apiKey, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({ model: MODEL, max_tokens: 700, system, messages }),
  });
  if (!r.ok) {
    console.error("AI error", r.status, await r.text());
    return json({ error: "The help assistant is busy. Please try again in a minute, or call 020 8935 5495." }, 502);
  }
  const out = await r.json();
  const reply = (out.content ?? []).filter((c: { type: string }) => c.type === "text").map((c: { text: string }) => c.text).join("\n").trim();
  return json({ reply: reply || "Sorry, I couldn't answer that. Please call 020 8935 5495.", remaining: tick.data });
});
