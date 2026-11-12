// Multimodal moderation adapter: OCR / image analysis / voice transcription.
// No provider configured => HOLD_FOR_REVIEW and human review (never a fake "safe" result).
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const REST = `${SUPABASE_URL}/rest/v1`;
const H = () => ({ apikey: SERVICE, Authorization: `Bearer ${SERVICE}`, "Content-Type": "application/json" });

async function cfg(key: string): Promise<any> {
  try {
    const r = await fetch(`${REST}/nexa_config?key=eq.${key}&select=value`, { headers: H() });
    return (await r.json())?.[0]?.value || null;
  } catch { return null; }
}
async function callTextEngine(text: string, userId: string | null, unavailable = false, missing = ""): Promise<any> {
  const res = await fetch(`${SUPABASE_URL}/functions/v1/nexa-moderate`, {
    method: "POST",
    headers: { ...H(), Authorization: `Bearer ${SERVICE}` },
    body: JSON.stringify({
      text, content_type: "media", context: [], user_id: userId,
      unavailable_provider: unavailable, missing_provider: missing,
    }),
  });
  return res.json();
}
function base64(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i += 8192) s += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return btoa(s);
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });
  try {
    const { media_id } = await req.json();
    if (!media_id) throw new Error("media_id saknas.");
    const r = await fetch(`${REST}/nexa_media?id=eq.${media_id}&select=*`, { headers: H() });
    const media = (await r.json())?.[0];
    if (!media) throw new Error("Media hittades inte.");
    if (media.status === "approved" || media.status === "rejected") {
      return Response.json({ ok: true, already: media.status });
    }
    const providerKey = media.kind === "voice" ? "transcription_provider" : "vision_ocr_provider";
    const provider = await cfg(providerKey);
    let decision: any;
    if (!provider?.endpoint || provider?.status === "not_configured") {
      decision = await callTextEngine("", media.owner_id, true, providerKey);
    } else {
      const key = Deno.env.get(provider.secret_name || "NEXA_MEDIA_API_KEY");
      if (!key) {
        decision = await callTextEngine("", media.owner_id, true, providerKey);
      } else {
        const obj = await fetch(`${SUPABASE_URL}/storage/v1/object/nexa-media/${encodeURI(media.bucket_path)}`, { headers: H() });
        if (!obj.ok) throw new Error("Kunde inte läsa filen från privat lagring.");
        const buf = new Uint8Array(await obj.arrayBuffer());
        if (buf.length > 4_000_000) {
          decision = await callTextEngine("", media.owner_id, true, providerKey);
        } else {
          const ext = await fetch(provider.endpoint, {
            method: "POST",
            headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
            body: JSON.stringify({ kind: media.kind, mime: media.mime, base64: base64(buf) }),
          });
          if (!ext.ok) throw new Error(`Medialevarantören svarade ${ext.status}.`);
          const data = await ext.json();
          const extracted = String(data.text || data.transcript || "");
          if (data.flagged) {
            decision = await callTextEngine(extracted || "[flaggad av medialevarantör]", media.owner_id);
            decision.decision = "BLOCK";
            decision.category = data.category || "multimodal";
            decision.explanation = `Medialevarantören flaggade filen: ${data.explanation || "otillåtet innehåll"}. OCR/text: "${extracted.slice(0, 120)}"`;
            decision.human_review = true;
            decision.provider = provider.name || "external-vision";
          } else {
            decision = await callTextEngine(extracted, media.owner_id);
          }
          decision.signals = { ...(decision.signals || {}), multimodal: { kind: media.kind, extracted_text: extracted.slice(0, 300), labels: data.labels || [] } };
        }
      }
    }
    const status = decision.decision === "ALLOW" || decision.decision === "WARN" ? "approved"
      : decision.decision === "HOLD_FOR_REVIEW" ? "held" : "rejected";
    // Persist a media-specific decision row (content_type = media) and link it.
    const saved = await fetch(`${REST}/nexa_moderation_decisions?select=*`, {
      method: "POST", headers: { ...H(), Prefer: "return=representation" },
      body: JSON.stringify({
        user_id: media.owner_id, content_hash: decision.content_hash || media.bucket_path,
        content_type: "media", decision: decision.decision, category: decision.category,
        confidence: decision.confidence, policy_rule: decision.policy_rule,
        explanation: decision.explanation, recommended_action: decision.recommended_action,
        human_review: decision.human_review, signals: decision.signals,
        provider: decision.provider, latency_ms: decision.latency_ms,
      }),
    });
    const row = (await saved.json())?.[0];
    const upd = await fetch(`${REST}/nexa_media?id=eq.${media_id}`, {
      method: "PATCH", headers: H(),
      body: JSON.stringify({ status, moderation_decision_id: row?.id || decision.id || null }),
    });
    if (!upd.ok) throw new Error(`Kunde inte uppdatera media: ${await upd.text()}`);
    return Response.json({ ok: true, media_id, status, decision: decision.decision, explanation: decision.explanation });
  } catch (e) {
    return Response.json({ error: String((e as Error).message || e) }, { status: 400 });
  }
});
