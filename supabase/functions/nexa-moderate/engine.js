const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const REST = `${SUPABASE_URL}/rest/v1`;
const serviceHeaders = () => ({
  apikey: SERVICE,
  Authorization: `Bearer ${SERVICE}`,
  "Content-Type": "application/json"
});
async function rest(path, init) {
  const res = await fetch(`${REST}/${path}`, {
    ...init,
    headers: { ...serviceHeaders(), ...init?.headers || {} }
  });
  const txt = await res.text();
  if (!res.ok) throw new Error(`REST ${res.status}: ${txt.slice(0, 400)}`);
  return txt ? JSON.parse(txt) : null;
}
const HOMOGLYPHS = {
  "\u0430": "a",
  "\u0431": "b",
  "\u0432": "b",
  "\u0433": "g",
  "\u0434": "d",
  "\u0435": "e",
  "\u0451": "e",
  "\u0436": "zh",
  "\u0437": "z",
  "\u0438": "i",
  "\u0439": "i",
  "\u043A": "k",
  "\u043B": "l",
  "\u043C": "m",
  "\u043D": "n",
  "\u043E": "o",
  "\u043F": "p",
  "\u0440": "p",
  "\u0441": "c",
  "\u0442": "t",
  "\u0443": "u",
  "\u0444": "f",
  "\u0445": "x",
  "\u0446": "c",
  "\u0447": "ch",
  "\u0448": "sh",
  "\u0449": "sch",
  "\u044A": "",
  "\u044B": "y",
  "\u044C": "",
  "\u044D": "e",
  "\u044E": "u",
  "\u044F": "ya",
  "\u0456": "i",
  "\u0457": "i",
  "\u0458": "j",
  "\u0455": "s",
  "\u04BB": "h",
  "\u0501": "d",
  "\u03BF": "o",
  "\u03B1": "a",
  "\u03B5": "e",
  "\u03C1": "p",
  "\u03C4": "t",
  "\u03C5": "u",
  "\u03BA": "k",
  "\u03BD": "v",
  "\u03C7": "x",
  "\uFF10": "0",
  "\uFF11": "1",
  "\uFF12": "2",
  "\uFF13": "3",
  "\uFF14": "4",
  "\uFF15": "5",
  "\uFF16": "6",
  "\uFF17": "7",
  "\uFF18": "8",
  "\uFF19": "9",
  "\uFF20": "@",
  "\uFF41": "a",
  "\uFF42": "b",
  "\uFF43": "c",
  "\uFF44": "d",
  "\uFF45": "e",
  "\uFF46": "f",
  "\uFF47": "g",
  "\uFF48": "h",
  "\uFF49": "i",
  "\uFF4A": "j",
  "\uFF4B": "k",
  "\uFF4C": "l",
  "\uFF4D": "m",
  "\uFF4E": "n",
  "\uFF4F": "o",
  "\uFF50": "p",
  "\uFF51": "q",
  "\uFF52": "r",
  "\uFF53": "s",
  "\uFF54": "t",
  "\uFF55": "u",
  "\uFF56": "v",
  "\uFF57": "w",
  "\uFF58": "x",
  "\uFF59": "y",
  "\uFF5A": "z",
  "\u017F": "s",
  "\u0131": "i",
  "\uA731": "s",
  "\u1D07": "e",
  "\u1D0F": "o"
};
const LEET = {
  "0": "o",
  "1": "i",
  "3": "e",
  "4": "a",
  "5": "s",
  "7": "t",
  "8": "b",
  "9": "g",
  "@": "a",
  "$": "s",
  "!": "i",
  "|": "i",
  "\u20AC": "e",
  "\xA3": "e",
  "\xA2": "c",
  "(": "c",
  "\xA5": "y",
  "\xB2": "2",
  "\xB3": "3"
};
const ZERO_WIDTH = /[\u200B-\u200D\u2060\uFEFF\u00AD\u0300-\u036F]/g;
function deobfuscate(input) {
  const flags = /* @__PURE__ */ new Set();
  let s = input.normalize("NFKC").replace(ZERO_WIDTH, "").toLowerCase();
  if (/[^\x00-\x7F]/.test(s.replace(/[åäöéèêáàâùûüóòôíìîñçßæø]/g, ""))) flags.add("unicode");
  let out = "";
  for (const ch of s) {
    if (HOMOGLYPHS[ch] !== void 0) {
      out += HOMOGLYPHS[ch];
      if (/[^\x00-\x7F]/.test(ch)) flags.add("homoglyph");
    } else if (LEET[ch] !== void 0) {
      out += LEET[ch];
      flags.add("leet");
    } else out += ch;
  }
  s = out;
  if (/[._\-*#~+=/\\'"^,:;!?(){}\[\]<>|]/.test(s)) flags.add("punctuation");
  if (/\s/.test(s.trim())) {
    if (/(^|\s)[a-zåäö](\s+[a-zåäö]){2,}(\s|$)/.test(s)) flags.add("spacing");
  }
  if (/([a-zåäö])\1{2,}/i.test(s)) flags.add("repeat");
  if (/[A-Z]{2,}/.test(input) && input !== input.toLowerCase() && input !== input.toUpperCase()) flags.add("unusual_caps");
  if (/[a-zåäö][\-\.][a-zåäö]/i.test(s)) flags.add("syllables");
  if (/(?:[a-zåäö][^\p{L}\p{N}\s]){2,}[a-zåäö]/u.test(s)) flags.add("letters_split");
  if (/[^\p{L}\p{N}\s]/u.test(s)) flags.add("symbols");
  return { text: s, flags: [...flags] };
}
function buildAnalysis(input, context) {
  const { text, flags } = deobfuscate(input);
  const spaced = text.replace(/[^\p{L}\p{N}]+/gu, " ").replace(/\s+/g, " ").trim();
  const squashed = text.replace(/[^\p{L}\p{N}]/gu, "");
  const vowelCollapse = squashed.replace(/([aeiouyåäö])\1+/gi, "$1");
  const phonetic = vowelCollapse.replace(/ck/g, "k").replace(/ch/g, "k").replace(/q/g, "k").replace(/x/g, "ks").replace(/w/g, "v").replace(/z/g, "s").replace(/ph/g, "f").replace(/th/g, "t").replace(/sh/g, "s");
  const fuzzy = squashed.replace(/([bcdfghjklmnpqrstvwxz])\1+/gi, "$1");
  const ctx = context.slice(-4).map((c) => deobfuscate(c).text.replace(/[^\p{L}\p{N}]/gu, ""));
  const combined = ctx.join("") + squashed;
  const combinedSpaced = (context.slice(-4).join(" ") + " " + spaced).toLowerCase();
  const weights = {
    spacing: 1.5,
    punctuation: 0.5,
    homoglyph: 1,
    unicode: 1,
    syllables: 0.25,
    letters_split: 1,
    leet: 0.5,
    repeat: 0.5,
    symbols: 0.25,
    unusual_caps: 0.5
  };
  const obfuscationScore = flags.reduce((n, f) => n + (weights[f] || 0.5), 0);
  return { raw: input, squashed, spaced, fuzzy, phonetic, combined, combinedSpaced, flags, obfuscationScore };
}
function normalizePhrase(p) {
  return deobfuscate(p).text.replace(/[^\p{L}\p{N}]/gu, "");
}
function contains(hay, needle) {
  return needle.length >= 2 && hay.includes(needle);
}
function matchPolicies(a, policies) {
  const matches = [];
  const surfaces = [
    [a.squashed, "normalized", true],
    [a.spaced.replace(/\s/g, ""), "normalized", true],
    [a.fuzzy, "fuzzy", false],
    [a.phonetic, "phonetic", false],
    [a.combined, "cross_message", true]
  ];
  for (const p of policies) {
    if (p.signal_type === "regex") {
      try {
        const re = new RegExp(p.pattern, "iu");
        if (re.test(a.raw) || re.test(a.squashed) || re.test(a.combinedSpaced)) {
          matches.push({ policy: p, phrase: p.pattern, exact: true, where: "regex" });
          continue;
        }
      } catch {
      }
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
        if (contains(surface, n)) {
          found = true;
          exact = isExact;
          where = kind;
          break;
        }
        if (!isExact || nf !== n) {
          if (contains(surface, nf)) {
            found = true;
            exact = false;
            where = "fuzzy";
            break;
          }
        }
      }
      if (!found && contains(a.combinedSpaced.replace(/\s/g, ""), n)) {
        found = true;
        exact = true;
        where = "cross_message";
      }
      if (found) {
        matches.push({ policy: p, phrase, exact, where });
      }
    }
  }
  if (!matches.some((m) => m.policy.category === "spam")) {
    if (/^(.{2,8}?)\1{3,}$/u.test(a.squashed) || /([a-zåäö])\1{6,}/iu.test(a.squashed)) {
      const spam = policies.find((p) => p.key === "P-SPAM-01") || { key: "P-SPAM-01", category: "spam", severity: 2, pattern: "repeat", signal_type: "phrase", description: "Upprepning" };
      matches.push({ policy: spam, phrase: "upprepning", exact: true, where: "repeat" });
    }
  }
  return matches;
}
const CATEGORY_LABELS = {
  bullying: "Mobbning och trakasserier",
  threat: "Hot och v\xE5ld",
  hate: "Hets och diskriminering",
  sexual_harassment: "Sexuella trakasserier",
  sexual_minors: "Sexuellt inneh\xE5ll som r\xF6r minder\xE5riga",
  grooming: "Grooming och manipulation",
  pii: "F\xF6rfr\xE5gan om privata uppgifter",
  external_platform: "F\xF6rs\xF6k att flytta till extern plattform",
  scam: "Bedr\xE4geri och spam",
  spam: "Spam",
  dangerous_challenge: "Farlig utmaning",
  evasion: "F\xF6rs\xF6k att kringg\xE5 s\xE4kerheten",
  context: "Kontextberoende m\xF6nster",
  none: "Ingen \xF6vertr\xE4delse"
};
const ESCALATE_CATEGORIES = /* @__PURE__ */ new Set(["grooming", "sexual_minors", "threat", "self_harm"]);
const BLOCK_CATEGORIES = /* @__PURE__ */ new Set(["hate", "sexual_harassment", "pii", "dangerous_challenge"]);
const WARN_CATEGORIES = /* @__PURE__ */ new Set(["external_platform", "scam", "spam", "evasion", "context"]);
function decide(matches, a, recent, external) {
  const signals = {
    obfuscation: a.flags,
    obfuscation_score: a.obfuscationScore,
    representations: { squashed: a.squashed.slice(0, 200), phonetic: a.phonetic.slice(0, 200) },
    matches: matches.map((m) => ({ rule: m.policy.key, phrase: m.phrase, exact: m.exact, where: m.where })),
    cross_message: a.combined.length > a.squashed.length
  };
  if (matches.length === 0 && !external?.flagged) {
    return {
      decision: "ALLOW",
      category: "none",
      confidence: 0.93,
      policy_rule: null,
      explanation: "Ingen s\xE4kerhets\xF6vertr\xE4delse uppt\xE4cktes. Inneh\xE5llet normaliserades och analyserades f\xF6r dolda stavningar, fonetiska varianter och kontext.",
      recommended_action: "publicera",
      human_review: false,
      signals,
      provider: "builtin-engine"
    };
  }
  const ranked = [...matches].sort((x, y) => y.policy.severity - x.policy.severity || Number(y.exact) - Number(x.exact));
  const top = ranked[0];
  const category = external?.flagged ? external.category || top?.policy.category || "external_ai" : top.policy.category;
  let severity = top?.policy.severity || 3;
  if (external?.flagged) severity = Math.max(severity, 4);
  const topCategory = top?.policy.category || "none";
  const multiMatchBoost = matches.length > 1 && !WARN_CATEGORIES.has(topCategory) ? Math.min(0.75, (matches.length - 1) * 0.4) : 0;
  const effSeverity = severity + Math.min(1.5, a.obfuscationScore) + multiMatchBoost;
  let confidence = 0.55;
  if (top?.exact) confidence += 0.28;
  confidence += Math.min(0.15, (matches.length - 1) * 0.05);
  if (a.obfuscationScore > 0) confidence += 0.06;
  if (top?.where === "fuzzy" || top?.where === "phonetic") confidence -= 0.2;
  if (external?.flagged) confidence = Math.max(confidence, Number(external.confidence) || 0.8);
  confidence = Math.max(0.15, Math.min(0.99, confidence));
  const warnedRecently = recent.some((r) => r.decision !== "ALLOW");
  const changedSpelling = a.obfuscationScore >= 0.5;
  if (warnedRecently && changedSpelling) {
    signals.adversarial = "spelling_change_after_warning";
    confidence = Math.min(0.99, confidence + 0.08);
  }
  if (recent.filter((r) => r.decision !== "ALLOW").length >= 3) signals.adversarial = "repeated_evasion_attempt";
  let decision = "WARN";
  if (ESCALATE_CATEGORIES.has(category)) decision = "ESCALATE";
  else if (BLOCK_CATEGORIES.has(category) && (confidence >= 0.62 || severity >= 5)) decision = "BLOCK";
  else if (category === "bullying" && effSeverity >= 4.5) decision = "BLOCK";
  else if (effSeverity >= 4.5 && confidence >= 0.7) decision = "BLOCK";
  else if (effSeverity >= 4 || WARN_CATEGORIES.has(category)) decision = "WARN";
  else if (confidence < 0.6) decision = "HOLD_FOR_REVIEW";
  else decision = "WARN";
  if (WARN_CATEGORIES.has(category) && decision === "BLOCK" && severity < 5 && !external?.flagged) decision = "WARN";
  if (category === "sexual_minors") decision = "ESCALATE";
  if (confidence < 0.55 && decision === "BLOCK" && severity < 5) decision = "HOLD_FOR_REVIEW";
  if (external?.flagged && decision === "ALLOW") decision = "HOLD_FOR_REVIEW";
  const human_review = decision !== "ALLOW" && (severity >= 5 || confidence < 0.75 || decision === "ESCALATE" || !!signals.adversarial);
  const actionMap = {
    ALLOW: "publicera",
    WARN: "publicera_med_utbildande_varning",
    HOLD_FOR_REVIEW: "h\xE5ll_inneh\xE5llet_f\xF6r_m\xE4nsklig_granskning",
    BLOCK: "blockera_inneh\xE5llet_och_logga",
    ESCALATE: "prioriterad_eskalering_till_utbildad_moderator"
  };
  const explanation = external?.flagged ? `Extern AI-leverant\xF6r flaggade inneh\xE5llet (${external.explanation || category}). Inbyggd motor: ${CATEGORY_LABELS[category] || category}. NORMALISERAD: "${a.squashed.slice(0, 120)}".` : `S\xE4kerhetsmotorn hittade ${CATEGORY_LABELS[category] || category} via regeln ${top?.policy.key || "extern"}. Tr\xE4ff: "${top?.phrase || external?.explanation || ""}". ` + (a.flags.length ? `Dold stavning: ${a.flags.join(", ")}. ` : "") + (a.combined.length > a.squashed.length ? "Analysen omfattade \xE4ven f\xF6reg\xE5ende meddelanden. " : "") + "Beslutet \xE4r kopplat till inneh\xE5llets hash och kan \xF6verklagas.";
  signals.provider_used = external?.flagged ? "external" : "builtin";
  signals.effective_severity = Number(effSeverity.toFixed(2));
  return {
    decision,
    category,
    confidence: Number(confidence.toFixed(4)),
    policy_rule: top?.policy.key || external?.policy_rule || null,
    explanation,
    recommended_action: actionMap[decision],
    human_review,
    signals,
    provider: external?.flagged ? external.provider || "external-ai" : "builtin-engine"
  };
}
async function loadProvider() {
  try {
    const rows = await rest("nexa_config?key=eq.moderation_provider&select=value");
    return rows?.[0]?.value || null;
  } catch {
    return null;
  }
}
async function callExternal(text, cfg) {
  if (!cfg?.endpoint || cfg?.status === "not_configured") return null;
  const keyName = cfg.secret_name || "NEXA_MODERATION_API_KEY";
  const key = Deno.env.get(keyName);
  if (!key) return null;
  const isOpenAI = (cfg.name || "").toLowerCase().includes("openai");
  const body = isOpenAI ? { model: cfg.model || "omni-moderation-latest", input: text } : { text, languages: ["sv", "en"] };
  const res = await fetch(cfg.endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
    body: JSON.stringify(body)
  });
  if (!res.ok) throw new Error(`external provider ${res.status}`);
  const data = await res.json();
  if (isOpenAI) {
    const r = data.results?.[0] || {};
    const cats = Object.entries(r.category_scores || {}).sort((x, y) => y[1] - x[1])[0];
    return {
      flagged: !!r.flagged,
      provider: "openai-omni",
      confidence: cats ? Number(cats[1].toFixed(4)) : 0.8,
      category: cats?.[0] || "external_ai",
      explanation: r.flagged ? "OpenAI moderation flaggade inneh\xE5llet" : ""
    };
  }
  return { flagged: !!data.flagged, provider: cfg.name || "external", confidence: data.confidence, category: data.category, explanation: data.explanation, policy_rule: data.policy_rule };
}
async function sha256(text) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
async function persist(row) {
  const rows = await rest("nexa_moderation_decisions?select=*", {
    method: "POST",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify(row)
  });
  return Array.isArray(rows) ? rows[0] : rows;
}
async function handle(req) {
  const started = Date.now();
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });
  try {
    const body = await req.json();
    const rawText = String(body.text ?? "");
    const contentType = String(body.content_type || "message");
    const context = Array.isArray(body.context) ? body.context.map(String) : [];
    const jwt = parseJwt(req);
    const userId = contentType === "test" ? null : jwt.role === "service_role" ? body.user_id || null : jwt.sub;
    const persistResult = body.persist !== false;
    const isTest = contentType === "test";
    const unavailable = !!body.unavailable_provider;
    const analysis = buildAnalysis(rawText, context);
    let external = null;
    let externalError = null;
    if (!isTest && !unavailable) {
      try {
        const cfg = await loadProvider();
        if (cfg?.endpoint) external = await callExternal(rawText, cfg);
      } catch (e) {
        externalError = String(e);
      }
    }
    let policies = [];
    try {
      policies = await rest("nexa_moderation_policies?enabled=eq.true&select=key,category,severity,pattern,signal_type,description") || [];
    } catch {
    }
    let recent = [];
    if (userId && !isTest) {
      try {
        recent = await rest(`nexa_moderation_decisions?user_id=eq.${userId}&order=created_at.desc&limit=10&select=decision,signals,created_at`) || [];
      } catch {
      }
    }
    const matches = unavailable ? [] : matchPolicies(analysis, policies);
    let result;
    if (unavailable) {
      result = {
        decision: "HOLD_FOR_REVIEW",
        category: "multimodal",
        confidence: 0.99,
        policy_rule: "P-MEDIA-01",
        explanation: "Ingen OCR-/bild- eller transkriberingsleverant\xF6r \xE4r konfigurerad. Inneh\xE5llet kan inte analyseras automatiskt och h\xE5lls f\xF6r manuell granskning.",
        recommended_action: "m\xE4nsklig_granskning_kr\xE4vs",
        human_review: true,
        signals: { missing_provider: body.missing_provider || "vision_or_transcription", obfuscation: analysis.flags },
        provider: "not_configured"
      };
    } else {
      result = decide(matches, analysis, recent, external);
    }
    if (externalError) result.signals.external_provider_error = externalError;
    result.latency_ms = Date.now() - started;
    const hash = await sha256(rawText);
    let saved = null;
    if (persistResult) {
      saved = await persist({
        user_id: userId,
        content_hash: hash,
        content_type: contentType,
        decision: result.decision,
        category: result.category,
        confidence: result.confidence,
        policy_rule: result.policy_rule,
        explanation: result.explanation,
        recommended_action: result.recommended_action,
        human_review: result.human_review,
        signals: result.signals,
        provider: result.provider,
        latency_ms: result.latency_ms
      });
    }
    return Response.json({ ...result, id: saved?.id || null, content_hash: hash, content_type: contentType });
  } catch (e) {
    return Response.json({ error: String(e), decision: "HOLD_FOR_REVIEW" }, { status: 500 });
  }
}
function parseJwt(req) {
  const auth = req.headers.get("Authorization") || "";
  const token = auth.replace(/^Bearer\s+/i, "");
  try {
    const payload = JSON.parse(atob(token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")));
    return { sub: payload.sub || null, role: payload.role || null };
  } catch {
    return { sub: null, role: null };
  }
}
export {
  handle
};
