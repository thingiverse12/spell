// Deployed entry point for the safety engine. The engine source is stored in
// nexa_engine_source so administrators can ship new moderation logic without
// redeploying the whole application.
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
let mod: any = null;
let loadedVersion = "";

Deno.serve(async (req: Request) => {
  try {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/nexa_engine_source?id=eq.moderation&select=source,version`, {
      headers: { apikey: SERVICE, Authorization: `Bearer ${SERVICE}` },
    });
    const row = (await r.json())?.[0];
    if (!row?.source) throw new Error("Säkerhetsmotorn saknas i databasen.");
    if (!mod || loadedVersion !== row.version) {
      mod = await import(`data:text/javascript,${encodeURIComponent(row.source)}`);
      loadedVersion = row.version;
    }
    return await mod.handle(req);
  } catch (e) {
    return Response.json({
      error: String(e), decision: "HOLD_FOR_REVIEW",
      explanation: "Säkerhetsmotorn kunde inte laddas – innehållet hålls för manuell granskning.",
    }, { status: 500 });
  }
});
