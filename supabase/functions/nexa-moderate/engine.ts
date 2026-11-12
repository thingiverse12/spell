// NEXA AI Safety Engine — server-side moderation service.
// Runs inside a Supabase Edge Function with the service role key.
// Every persisted decision is written to nexa_moderation_decisions and is
// required by database triggers before any message/post/comment can be saved.

type Decision = "ALLOW" | "WARN" | "HOLD_FOR_REVIEW" | "BLOCK" | "ESCALATE";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const REST = `${SUPABASE_URL}/rest/v1`;

const serviceHeaders = () => ({
  apikey: SERVICE,
  Authorization: `Bearer ${SERVICE}`,
  "Content-Type": "application/json",
});

async function rest(path: string, init?: RequestInit): Promise<any> {
  const res = await fetch(`${REST}/${path}`, {
    ...init,
    headers: { ...serviceHeaders(), ...(init?.headers || {}) },
  });
  const txt = await res.text();
  if (!res.ok) throw new Error(`REST ${res.status}: ${txt.slice(0, 400)}`);
  return txt ? JSON.parse(txt) : null;
}

// ---------------------------------------------------------------------
// 1. Text normalization / obfuscation detection
// ---------------------------------------------------------------------
const HOMOGLYPHS: Record<string, string> = {
  "а": "a", "б": "b", "в": "b", "г": "g", "д": "d", "е": "e", "ё": "e",
  "ж": "zh", "з": "z", "и": "i", "й": "i", "к": "k", "л": "l", "м": "m",
  "н": "n", "о": "o", "п": "p", "р": "p", "с": "c", "т": "t", "у": "u",
  "ф": "f", "х": "x", "ц": "c", "ч": "ch", "ш": "sh", "щ": "sch", "ъ": "",
  "ы": "y", "ь": "", "э": "e", "ю": "u", "я": "ya", "і": "i", "ї": "i",
  "ј": "j", "ѕ": "s", "һ": "h", "ԁ": "d", "ο": "o", "α": "a", "ε": "e",
  "ρ": "p", "τ": "t", "υ": "u", "κ": "k", "ν": "v", "χ": "x",
  "０": "0", "１": "1", "２": "2", "３": "3", "４": "4", "５": "5", "６": "6",
  "７": "7", "８": "8", "９": "9", "＠": "@", "ａ": "a", "ｂ": "b", "ｃ": "c",
  "ｄ": "d", "ｅ": "e", "ｆ": "f", "ｇ": "g", "ｈ": "h", "ｉ": "i", "ｊ": "j",
  "ｋ": "k", "ｌ": "l", "ｍ": "m", "ｎ": "n", "ｏ": "o", "ｐ": "p", "ｑ": "q",
  "ｒ": "r", "ｓ": "s", "ｔ": "t", "ｕ": "u", "ｖ": "v", "ｗ": "w", "ｘ": "x",
  "ｙ": "y", "ｚ": "z", "ſ": "s", "ı": "i", "ꜱ": "s", "ᴇ": "e", "ᴏ": "o",
};
const LEET: Record<string, string> = {
  "0": "o", "1": "i", "3": "e", "4": "a", "5": "s", "7": "t", "8": "b",
  "9": "g", "@": "a", "$": "s", "!": "i", "|": "i", "€": "e", "£": "e",
  "¢": "c", "(": "c", "¥": "y", "²": "2", "³": "3",
};
const ZERO_WIDTH = /[\u200B-\u200D\u2060\uFEFF\u00AD\u0300-\u036F]/g;

interface Analysis {
  raw: string;
  squashed: string;
  spaced: string;
  fuzzy: string;
  phonetic: string;
  combined: string;
  combinedSpaced: string;
  flags: string[];
  obfuscationScore: number;
}

function deobfuscate(input: string): { text: string; flags: string[] } {
  const flags = new Set<string>();
  let s = input.normalize("NFKC").replace(ZERO_WIDTH, "").toLowerCase();
  if (/[^\x00-\x7F]/.test(s.replace(/[åäöéèêáàâùûüóòôíìîñçßæø]/g, ""))) flags.add("unicode");
  let out = "";
  for (const ch of s) {
    if (HOMOGLYPHS[ch] !== undefined) {
      out += HOMOGLYPHS[ch];
      if (/[^\x00-\x7F]/.test(ch)) flags.add("homoglyph");
    } else if (LEET[ch] !== undefined) {
      out += LEET[ch];
      flags.add("leet");
    } else out += ch;
  }
  s = out;
  if (/[._\-*#~+=/\\'"^,:;!?(){}\[\]<>|]/.test(s)) flags.add("punctuation");
  if (/\s/.test(s.trim())) {
    // single letters separated by whitespace = deliberate splitting
    if (/(^|\s)[a-zåäö](\s+[a-zåäö]){2,}(\s|$)/.test(s)) flags.add("spacing");
  }
  if (/([a-zåäö])\1{2,}/i.test(s)) flags.add("repeat");
  if (/[A-Z]{2,}/.test(input) && input !== input.toLowerCase() && input !== input.toUpperCase()) flags.add("unusual_caps");
  if (/[a-zåäö][\-\.][a-zåäö]/i.test(s)) flags.add("syllables");
  if (/(?:[a-zåäö][^\p{L}\p{N}\s]){2,}[a-zåäö]/u.test(s)) flags.add("letters_split");
  if (/[^\p{L}\p{N}\s]/u.test(s)) flags.add("symbols");
  return { text: s, flags: [...flags] };
}

function buildAnalysis(input: string, context: string[]): Analysis {
  const { text, flags } = deobfuscate(input);
  const spaced = text.replace(/[^\p{L}\p{N}]+/gu, " ").replace(/\s+/g, " ").trim();
  const squashed = text.replace(/[^\p{L}\p{N}]/gu, "");
  // vowel-repeat collapse + consonant simplification for phonetic variants
  const vowelCollapse = squashed.replace(/([aeiouyåäö])\1+/gi, "$1");
  const phonetic = vowelCollapse
    .replace(/ck/g, "k").replace(/ch/g, "k").replace(/q/g, "k")
    .replace(/x/g, "ks").replace(/w/g, "v").replace(/z/g, "s")
    .replace(/ph/g, "f").replace(/th/g, "t").replace(/sh/g, "s");
  const fuzzy = squashed.replace(/([bcdfghjklmnpqrstvwxz])\1+/gi, "$1");
  const ctx = context.slice(-4).map((c) => deobfuscate(c).text.replace(/[^\p{L}\p{N}]/gu, ""));
  const combined = ctx.join("") + squashed;
  const combinedSpaced = (context.slice(-4).join(" ") + " " + spaced).toLowerCase();
  const weights: Record<string, number> = {
    spacing: 1.5, punctuation: 0.5, homoglyph: 1, unicode: 1, syllables: 0.25,
    letters_split: 1, leet: 0.5, repeat: 0.5, symbols: 0.25, unusual_caps: 0.5,
  };
  const obfuscationScore = flags.reduce((n, f) => n + (weights[f] || 0.5), 0);
  return { raw: input, squashed, spaced, fuzzy, phonetic, combined, combinedSpaced, flags, obfuscationScore };
}

function normalizePhrase(p: string): string {
  return deobfuscate(p).text.replace(/[^\p{L}\p{N}]/gu, "");
}

// ---------------------------------------------------------------------
// 2. Policy loading and matching
// ---------------------------------------------------------------------
interface Policy { key: string; category: string; severity: number; pattern: string; signal_type: string; description: string }
interface Match { policy: Policy; phrase: string; exact: boolean; where: string }

function contains(hay: string, needle: string): boolean {
  return needle.length >= 2 && hay.includes(needle);
}

function matchPolicies(a: Analysis, policies: Policy[]): Match[] {
  const matches: Match[] = [];
  const surfaces: [string, string, boolean][] = [
    [a.squashed, "normalized", true],
    [a.spaced.replace(/\s/g, ""), "normalized", true],
    [a.fuzzy, "fuzzy", false],
    [a.phonetic, "phonetic", false],
    [a.combined, "cross_message", true],
  ];
  for (const p of policies) {
    if (p.signal_type === "regex") {
      try {
        const re = new RegExp(p.pattern, "iu");
        if (re.test(a.raw) || re.test(a.squashed) || re.test(a.combinedSpaced)) {
          matches.push({ policy: p, phrase: p.pattern, exact: true, where: "regex" });
          continue;
        }
      } catch { /* invalid admin pattern -> ignore */ }
      continue;
    }
    const phrases = p.pattern.split("|").map((x) => x.trim()).filter(Boolean);
    for (const phrase of phrases) {
      const n = normalizePhrase(phrase);
      const nf = n.replace(/([bcdfghjklmnpqrstvwxz])\1+/gi, "$1");
      let found = false;
      let exact = true;
      let where = "";
      for (const [surface, kind, isExact] of surfaces) {
        if (contains(surface, n)) { found = true; exact = isExact; where = kind; break; }
        if (!isExact || nf !== n) {
          if (contains(surface, nf)) { found = true; exact = false; where = "fuzzy"; break; }
        }
      }
      if (!found && contains(a.combinedSpaced.replace(/\s/g, ""), n)) {
        found = true; exact = true; where = "cross_message";
      }
      if (found) { matches.push({ policy: p, phrase, exact, where }); }
    }
  }
  // Repeated substring spam detection (hejhejhej / aaaaaaa / [word][word][word])
  if (!matches.some((m) => m.policy.category === "spam")) {
    if (/^(.{2,8}?)\1{3,}$/u.test(a.squashed) || /([a-zåäö])\1{6,}/iu.test(a.squashed)) {
      const spam = policies.find((p) => p.key === "P-SPAM-01") ||
        { key: "P-SPAM-01", category: "spam", severity: 2, pattern: "repeat", signal_type: "phrase", description: "Upprepning" };
      matches.push({ policy: spam, phrase: "upprepning", exact: true, where: "repeat" });
    }
  }
  return matches;
}

// ---------------------------------------------------------------------
// 3. Decision engine
// ---------------------------------------------------------------------
const CATEGORY_LABELS: Record<string, string> = {
  bullying: "Mobbning och trakasserier", threat: "Hot och våld", hate: "Hets och diskriminering",
  sexual_harassment: "Sexuella trakasserier", sexual_minors: "Sexuellt innehåll som rör minderåriga",
  grooming: "Grooming och manipulation", pii: "Förfrågan om privata uppgifter",
  external_platform: "Försök att flytta till extern plattform", scam: "Bedrägeri och spam",
  spam: "Spam", dangerous_challenge: "Farlig utmaning", evasion: "Försök att kringgå säkerheten",
  context: "Kontextberoende mönster", none: "Ingen överträdelse",
};

const ESCALATE_CATEGORIES = new Set(["grooming", "sexual_minors", "threat", "self_harm"]);
const BLOCK_CATEGORIES = new Set(["hate", "sexual_harassment", "pii", "dangerous_challenge"]);
const WARN_CATEGORIES = new Set(["external_platform", "scam", "spam", "evasion", "context"]);

interface Result {
  decision: Decision; category: string; confidence: number; policy_rule: string | null;
  explanation: string; recommended_action: string; human_review: boolean;
  signals: Record<string, unknown>; provider: string; latency_ms: number;
}

function decide(matches: Match[], a: Analysis, recent: any[], external: any): Omit<Result, "latency_ms"> {
  const signals: Record<string, unknown> = {
    obfuscation: a.flags, obfuscation_score: a.obfuscationScore,
    representations: { squashed: a.squashed.slice(0, 200), phonetic: a.phonetic.slice(0, 200) },
    matches: matches.map((m) => ({ rule: m.policy.key, phrase: m.phrase, exact: m.exact, where: m.where })),
    cross_message: a.combined.length > a.squashed.length,
  };

  if (matches.length === 0 && !external?.flagged) {
    return {
      decision: "ALLOW", category: "none", confidence: 0.93, policy_rule: null,
      explanation: "Ingen säkerhetsöverträdelse upptäcktes. Innehållet normaliserades och analyserades för dolda stavningar, fonetiska varianter och kontext.",
      recommended_action: "publicera", human_review: false, signals, provider: "builtin-engine",
    };
  }

  // Pick the strongest match
  const ranked = [...matches].sort((x, y) => y.policy.severity - x.policy.severity || Number(y.exact) - Number(x.exact));
  const top = ranked[0];
  const category = external?.flagged ? (external.category || top?.policy.category || "external_ai") : top.policy.category;
  let severity = top?.policy.severity || 3;
  if (external?.flagged) severity = Math.max(severity, 4);
  const topCategory = top?.policy.category || "none";
  const multiMatchBoost = (matches.length > 1 && !WARN_CATEGORIES.has(topCategory))
    ? Math.min(0.75, (matches.length - 1) * 0.4) : 0;
  const effSeverity = severity + Math.min(1.5, a.obfuscationScore) + multiMatchBoost;

  let confidence = 0.55;
  if (top?.exact) confidence += 0.28;
  confidence += Math.min(0.15, (matches.length - 1) * 0.05);
  if (a.obfuscationScore > 0) confidence += 0.06;
  if (top?.where === "fuzzy" || top?.where === "phonetic") confidence -= 0.2;
  if (external?.flagged) confidence = Math.max(confidence, Number(external.confidence) || 0.8);
  confidence = Math.max(0.15, Math.min(0.99, confidence));

  // Adversarial: spelling changes right after a warning
  const warnedRecently = recent.some((r) => r.decision !== "ALLOW");
  const changedSpelling = a.obfuscationScore >= 0.5;
  if (warnedRecently && changedSpelling) {
    signals.adversarial = "spelling_change_after_warning";
    confidence = Math.min(0.99, confidence + 0.08);
  }
  if (recent.filter((r) => r.decision !== "ALLOW").length >= 3) signals.adversarial = "repeated_evasion_attempt";

  let decision: Decision = "WARN";
  if (ESCALATE_CATEGORIES.has(category)) decision = "ESCALATE";
  else if (BLOCK_CATEGORIES.has(category) && (confidence >= 0.62 || severity >= 5)) decision = "BLOCK";
  else if (category === "bullying" && effSeverity >= 4.5) decision = "BLOCK";
  else if (effSeverity >= 4.5 && confidence >= 0.7) decision = "BLOCK";
  else if (effSeverity >= 4 || WARN_CATEGORIES.has(category)) decision = "WARN";
  else if (confidence < 0.6) decision = "HOLD_FOR_REVIEW";
  else decision = "WARN";

  // Explicit sexual content involving minors is never permitted.
  if (category === "sexual_minors") decision = "ESCALATE";
  // Uncertain predictions must never become a permanent ban.
  if (confidence < 0.55 && decision === "BLOCK") decision = "HOLD_FOR_REVIEW";
  if (external?.flagged && decision === "ALLOW") decision = "HOLD_FOR_REVIEW";

  const human_review = decision !== "ALLOW" && (severity >= 5 || confidence < 0.75 || decision === "ESCALATE" || !!signals.adversarial);
  const actionMap: Record<Decision, string> = {
    ALLOW: "publicera", WARN: "publicera_med_utbildande_varning",
    HOLD_FOR_REVIEW: "håll_innehållet_för_mänsklig_granskning",
    BLOCK: "blockera_innehållet_och_logga", ESCALATE: "prioriterad_eskalering_till_utbildad_moderator",
  };
  const explanation = external?.flagged
    ? `Extern AI-leverantör flaggade innehållet (${external.explanation || category}). ` +
      `Inbyggd motor: ${CATEGORY_LABELS[category] || category}. NORMALISERAD: "${a.squashed.slice(0, 120)}".`
    : `Säkerhetsmotorn hittade ${CATEGORY_LABELS[category] || category} via regeln ${top?.policy.key || "extern"}. ` +
      `Träff: "${top?.phrase || external?.explanation || ""}". ` +
      (a.flags.length ? `Dold stavning: ${a.flags.join(", ")}. ` : "") +
      (a.combined.length > a.squashed.length ? "Analysen omfattade även föregående meddelanden. " : "") +
      "Beslutet är kopplat till innehållets hash och kan överklagas.";

  signals.provider_used = external?.flagged ? "external" : "builtin";
  signals.effective_severity = Number(effSeverity.toFixed(2));
  return {
    decision, category, confidence: Number(confidence.toFixed(4)),
    policy_rule: top?.policy.key || external?.policy_rule || null,
    explanation, recommended_action: actionMap[decision], human_review, signals,
    provider: external?.flagged ? (external.provider || "external-ai") : "builtin-engine",
  };
}

// ---------------------------------------------------------------------
// 4. Optional external AI moderation provider
// ---------------------------------------------------------------------
async function loadProvider(): Promise<any> {
  try {
    const rows = await rest("nexa_config?key=eq.moderation_provider&select=value");
    return rows?.[0]?.value || null;
  } catch { return null; }
}

async function callExternal(text: string, cfg: any): Promise<any> {
  if (!cfg?.endpoint || cfg?.status === "not_configured") return null;
  const keyName = cfg.secret_name || "NEXA_MODERATION_API_KEY";
  const key = Deno.env.get(keyName);
  if (!key) return null;
  const isOpenAI = (cfg.name || "").toLowerCase().includes("openai");
  const body = isOpenAI ? { model: cfg.model || "omni-moderation-latest", input: text } : { text, languages: ["sv", "en"] };
  const res = await fetch(cfg.endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`external provider ${res.status}`);
  const data = await res.json();
  if (isOpenAI) {
    const r = data.results?.[0] || {};
    const cats = Object.entries(r.category_scores || {}).sort((x: any, y: any) => y[1] - x[1])[0];
    return {
      flagged: !!r.flagged, provider: "openai-omni", confidence: cats ? Number((cats[1] as number).toFixed(4)) : 0.8,
      category: cats?.[0] || "external_ai", explanation: r.flagged ? "OpenAI moderation flaggade innehållet" : "",
    };
  }
  return { flagged: !!data.flagged, provider: cfg.name || "external", confidence: data.confidence, category: data.category, explanation: data.explanation, policy_rule: data.policy_rule };
}

// ---------------------------------------------------------------------
// 5. Persistence
// ---------------------------------------------------------------------
async function sha256(text: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function persist(row: Record<string, unknown>): Promise<any> {
  const rows = await rest("nexa_moderation_decisions?select=*", {
    method: "POST",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify(row),
  });
  return Array.isArray(rows) ? rows[0] : rows;
}

// ---------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------
export async function handle(req: Request): Promise<Response> {
  const started = Date.now();
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });
  try {
    const body = await req.json();
    const rawText: string = String(body.text ?? "");
    const contentType: string = String(body.content_type || "message");
    const context: string[] = Array.isArray(body.context) ? body.context.map(String) : [];
    const jwt = parseJwt(req);
    const userId = contentType === "test" ? null : (jwt.role === "service_role" ? (body.user_id || null) : jwt.sub);
    const persistResult = body.persist !== false;
    const isTest = contentType === "test";
    const unavailable = !!body.unavailable_provider;

    const analysis = buildAnalysis(rawText, context);
    let external: any = null;
    let externalError: string | null = null;
    if (!isTest && !unavailable) {
      try {
        const cfg = await loadProvider();
        if (cfg?.endpoint) external = await callExternal(rawText, cfg);
      } catch (e) { externalError = String(e); }
    }

    let policies: Policy[] = [];
    try {
      policies = (await rest("nexa_moderation_policies?enabled=eq.true&select=key,category,severity,pattern,signal_type,description")) || [];
    } catch { /* fall back to empty -> ALLOW, but DB still records the decision */ }

    let recent: any[] = [];
    if (userId && !isTest) {
      try {
        recent = (await rest(`nexa_moderation_decisions?user_id=eq.${userId}&order=created_at.desc&limit=10&select=decision,signals,created_at`)) || [];
      } catch { /* ignore */ }
    }

    const matches = unavailable ? [] : matchPolicies(analysis, policies);
    let result: any;
    if (unavailable) {
      result = {
        decision: "HOLD_FOR_REVIEW", category: "multimodal", confidence: 0.99,
        policy_rule: "P-MEDIA-01", explanation: "Ingen OCR-/bild- eller transkriberingsleverantör är konfigurerad. Innehållet kan inte analyseras automatiskt och hålls för manuell granskning.",
        recommended_action: "mänsklig_granskning_krävs", human_review: true,
        signals: { missing_provider: body.missing_provider || "vision_or_transcription", obfuscation: analysis.flags },
        provider: "not_configured",
      };
    } else {
      result = decide(matches, analysis, recent, external);
    }
    if (externalError) result.signals.external_provider_error = externalError;
    result.latency_ms = Date.now() - started;

    const hash = await sha256(rawText);
    let saved: any = null;
    if (persistResult) {
      saved = await persist({
        user_id: userId, content_hash: hash, content_type: contentType,
        decision: result.decision, category: result.category, confidence: result.confidence,
        policy_rule: result.policy_rule, explanation: result.explanation,
        recommended_action: result.recommended_action, human_review: result.human_review,
        signals: result.signals, provider: result.provider, latency_ms: result.latency_ms,
      });
    }
    return Response.json({ ...result, id: saved?.id || null, content_hash: hash, content_type: contentType });
  } catch (e) {
    return Response.json({ error: String(e), decision: "HOLD_FOR_REVIEW" }, { status: 500 });
  }
}

function parseJwt(req: Request): { sub: string | null; role: string | null } {
  const auth = req.headers.get("Authorization") || "";
  const token = auth.replace(/^Bearer\s+/i, "");
  try {
    const payload = JSON.parse(atob(token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")));
    return { sub: payload.sub || null, role: payload.role || null };
  } catch { return { sub: null, role: null }; }
}
