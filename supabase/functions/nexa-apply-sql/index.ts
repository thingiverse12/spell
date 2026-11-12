// Temporary migration runner. Deleted after the schema has been applied.
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const TOKEN = Deno.env.get("NEXA_SETUP_TOKEN")!;
const BRANCH = "arena/40d29496-spell";
const RAW = `https://raw.githubusercontent.com/thingiverse12/spell/${BRANCH}/supabase/migrations/0001_nexa.sql`;

Deno.serve(async (req: Request) => {
  const url = new URL(req.url);
  if (!TOKEN || url.searchParams.get("token") !== TOKEN) {
    return new Response("Unauthorized", { status: 401 });
  }
  try {
    const r = await fetch(RAW);
    if (!r.ok) {
      return Response.json({ error: "raw fetch failed", status: r.status, body: (await r.text()).slice(0, 300) }, { status: 500 });
    }
    const sql = await r.text();
    const chunks = sql.split(/^-- NEXA_CHUNK_BREAK$/m).map((s) => s.trim()).filter(Boolean);
    const results: unknown[] = [];
    for (let i = 0; i < chunks.length; i++) {
      const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/nexa_run_sql`, {
        method: "POST",
        headers: { apikey: SERVICE, Authorization: `Bearer ${SERVICE}`, "Content-Type": "application/json" },
        body: JSON.stringify({ q: chunks[i] }),
      });
      const txt = await res.text();
      results.push({ chunk: i + 1, bytes: chunks[i].length, status: res.status, body: txt.slice(0, 3000) });
      if (!res.ok) return Response.json({ error: "chunk failed", results }, { status: 500 });
    }
    return Response.json({ ok: true, chunks: results.length, results });
  } catch (e) {
    return Response.json({ error: String(e) }, { status: 500 });
  }
});
