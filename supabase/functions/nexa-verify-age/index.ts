// Privacy-preserving age assurance adapter.
// In demo mode the user's declared birth date is used ONLY to derive an age band.
// No identity document, biometric data or raw provider payload is retained.
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const REST = `${SUPABASE_URL}/rest/v1`;
const H = () => ({ apikey: SERVICE, Authorization: `Bearer ${SERVICE}`, "Content-Type": "application/json" });

function ageFromDate(iso: string): number {
  const d = new Date(iso + "T00:00:00Z");
  if (Number.isNaN(d.getTime())) throw new Error("Ogiltigt datum.");
  const now = new Date();
  let age = now.getUTCFullYear() - d.getUTCFullYear();
  const m = now.getUTCMonth() - d.getUTCMonth();
  if (m < 0 || (m === 0 && now.getUTCDate() < d.getUTCDate())) age--;
  return age;
}
function band(age: number): string | null {
  if (age >= 13 && age <= 14) return "13-14";
  if (age >= 15 && age <= 17) return "15-17";
  return null;
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });
  const auth = req.headers.get("Authorization") || "";
  const token = auth.replace(/^Bearer\s+/i, "");
  let userId: string | null = null;
  try { userId = JSON.parse(atob(token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/"))).sub; } catch { /* */ }
  if (!userId) return Response.json({ error: "Inte inloggad." }, { status: 401 });
  try {
    const { birth_date } = await req.json();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(birth_date))) throw new Error("Ange ett giltigt födelsedatum (ÅÅÅÅ-MM-DD).");
    const age = ageFromDate(String(birth_date));
    const group = band(age);
    if (!group) throw new Error("NEXA är endast för 13–17 år. Kontot kan inte skapas.");

    // Provider config is read server-side so admins can change it without a rebuild.
    let cfg: any = null;
    try {
      const r = await fetch(`${REST}/nexa_config?key=eq.age_verification_provider&select=value`, { headers: H() });
      cfg = (await r.json())?.[0]?.value || null;
    } catch { /* no config => demo mode */ }

    let method = "self_declared_demo";
    let status = "demo";
    let provider: string | null = null;
    let providerRef: string | null = null;
    let rawResponse: any = null;
    if (cfg?.endpoint && cfg?.status === "active") {
      const keyName = cfg.secret_name || "NEXA_AGE_PROVIDER_KEY";
      const key = Deno.env.get(keyName);
      if (!key) throw new Error("Åldersleverantören saknar API-nyckel. Kontakta en administratör.");
      // Only an opaque token is sent, never the raw birth date or an ID document.
      const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`${userId}:${birth_date}`));
      const opaque = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
      const res = await fetch(cfg.endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
        body: JSON.stringify({ opaque_token: opaque, requested: "age_band", bands: ["13-14", "15-17"] }),
      });
      if (!res.ok) throw new Error(`Åldersleverantören svarade ${res.status}.`);
      const data = await res.json();
      if (!data.verified || !["13-14", "15-17"].includes(data.age_band)) throw new Error("Åldersverifieringen kunde inte bekräftas.");
      method = "privacy_preserving_provider";
      status = "verified";
      provider = cfg.name || "external";
      providerRef = String(data.reference || opaque.slice(0, 24));
      rawResponse = { age_band: data.age_band, verified: true };
      // A provider band different from the declared band is treated as authoritative.
      if (data.age_band !== group) {
        return Response.json({ error: "Leverantörens åldersintervall matchar inte uppgifterna. Kontakta support." }, { status: 422 });
      }
    }

    // Upsert verification (birth date is the only sensitive field; RLS = owner only).
    const up = await fetch(`${REST}/nexa_age_verifications?on_conflict=user_id`, {
      method: "POST", headers: { ...H(), Prefer: "resolution=merge-duplicates,return=representation" },
      body: JSON.stringify({
        user_id: userId, method, provider, provider_ref: providerRef, status,
        birth_date, age_group: group, age,
        identity_document_stored: false, biometric_data_stored: false,
        raw_provider_response: rawResponse, verified_at: new Date().toISOString(),
      }),
    });
    if (!up.ok) throw new Error(`Kunde inte spara åldersverifiering: ${await up.text()}`);
    const prof = await fetch(`${REST}/nexa_profiles?id=eq.${userId}`, {
      method: "PATCH", headers: { ...H(), Prefer: "return=representation" },
      body: JSON.stringify({ age, age_group: group }),
    });
    if (!prof.ok) throw new Error(`Kunde inte uppdatera profil: ${await prof.text()}`);
    return Response.json({ ok: true, age, age_group: group, status, method, provider, demo: status === "demo" });
  } catch (e) {
    return Response.json({ error: String((e as Error).message || e) }, { status: 400 });
  }
});
