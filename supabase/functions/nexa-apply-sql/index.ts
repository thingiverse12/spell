// Temporary installer: stores the compiled safety engine in the database.
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const TOKEN = Deno.env.get("NEXA_SETUP_TOKEN")!;
const BRANCH = "arena/40d29496-spell";
const RAW = `https://raw.githubusercontent.com/thingiverse12/spell/${BRANCH}/supabase/functions/nexa-moderate/engine.js`;

Deno.serve(async (req: Request) => {
  const u = new URL(req.url);
  if (!TOKEN || u.searchParams.get("token") !== TOKEN) return new Response("Unauthorized", { status: 401 });
  try {
    const r = await fetch(RAW);
    if (!r.ok) return Response.json({ error: "fetch", status: r.status }, { status: 500 });
    const source = await r.text();
    const res = await fetch(`${SUPABASE_URL}/rest/v1/nexa_engine_source?on_conflict=id`, {
      method: "POST",
      headers: {
        apikey: SERVICE, Authorization: `Bearer ${SERVICE}`, "Content-Type": "application/json",
        Prefer: "resolution=merge-duplicates,return=representation",
      },
      body: JSON.stringify({ id: "moderation", source, version: "1.0.0", updated_at: new Date().toISOString() }),
    });
    return Response.json({ ok: res.ok, bytes: source.length, status: res.status, body: (await res.text()).slice(0, 500) });
  } catch (e) { return Response.json({ error: String(e) }, { status: 500 }); }
});
