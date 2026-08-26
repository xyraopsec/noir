// NOIR server v3 - zero dependencies, multi-provider router
const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const ROOT = process.env.NOIR_ROOT || path.join(__dirname, "..");
const CONFIG_PATH = process.env.NOIR_CONFIG || path.join(ROOT, "config.json");
const UI_DIR = __dirname;
const WORKSPACE = process.env.NOIR_WORKSPACE || path.join(ROOT, "workspace");

try { fs.mkdirSync(WORKSPACE, { recursive: true }); } catch {}

const MIME = {
  ".html": "text/html", ".css": "text/css", ".js": "application/javascript",
  ".json": "application/json", ".png": "image/png", ".jpg": "image/jpeg",
  ".svg": "image/svg+xml", ".ico": "image/x-icon", ".woff2": "font/woff2"
};

const loadConfig = () => JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8").replace(/^\uFEFF/, ""));
const readBody = (req) => new Promise((res, rej) => {
  let d = ""; req.on("data", c => { d += c; if (d.length > 60e6) req.destroy(); });
  req.on("end", () => res(d)); req.on("error", rej);
});

/* ---------------- access gate (stateless) ----------------
   Two valid credentials:
   1. Google-issued noir token:  "noir1.<payload>.<hmac>"   (email allowlist)
   2. Legacy access code:        "K9M-Q2X" etc.             (config.codes)
*/
function b64url(buf) { return Buffer.from(buf).toString("base64url"); }
function sign(payload) {
  const secret = (loadConfig().google || {}).secret || "noir-dev-secret";
  return crypto.createHmac("sha256", secret).update(payload).digest("base64url");
}
function googleToken(email) {
  const role = email === "andi.selmani@stud.sek-ds.ch" ? "owner" : "friend";
  const payload = b64url(JSON.stringify({ e: email, r: role, exp: Date.now() + 30 * 24 * 3600 * 1000 }));
  return "noir1." + payload + "." + sign(payload);
}
function readToken(token) {
  if (!token || !token.startsWith("noir1.")) return null;
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const payload = parts[1];
  let data;
  try { data = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")); } catch { return null; }
  if (!data.e || !data.exp || Date.now() > data.exp) return null;
  let sig; try { sig = sign(payload); } catch { return null; }
  if (sig.length !== parts[2].length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(parts[2]))) return null;
  return data;
}
function codeRole(req) {
  const given = String(req.headers["x-noir-code"] || "").trim();
  // 1) google token
  const tok = readToken(given);
  if (tok) return tok.r;
  // 2) legacy code
  const up = given.toUpperCase();
  if (!up) return null;
  const i = codes().indexOf(up);
  return i === -1 ? null : (i === 0 ? "owner" : "friend");
}
async function handleAuthGoogle(req, res) {
  if (req.method !== "POST") { res.writeHead(405).end(); return; }
  let body;
  try { body = JSON.parse((await readBody(req)) || "{}"); } catch { res.writeHead(400).end(); return; }
  const cred = String(body.credential || "");
  if (!cred) { res.writeHead(400).end(); return; }
  const cfg = loadConfig();
  const g = cfg.google || {};
  let info;
  try {
    const r = await fetch("https://oauth2.googleapis.com/tokeninfo?id_token=" + encodeURIComponent(cred));
    if (!r.ok) throw new Error("tokeninfo " + r.status);
    info = await r.json();
  } catch {
    res.writeHead(401, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "could not verify with google" }));
    return;
  }
  if (g.clientId && info.aud !== g.clientId) {
    res.writeHead(401, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "wrong audience" }));
    return;
  }
  const email = String(info.email || "").toLowerCase();
  const allowed = (g.allowed || []).map(a => a.toLowerCase());
  if (info.email_verified !== "true" && info.email_verified !== true) {
    res.writeHead(401, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "email not verified" }));
    return;
  }
  if (!allowed.includes(email)) {
    res.writeHead(403, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "this account is not on the guest list" }));
    return;
  }
  res.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-store" });
  res.end(JSON.stringify({ ok: true, token: googleToken(email), email, role: email === "andi.selmani@stud.sek-ds.ch" ? "owner" : "friend" }));
}
function handleAuthConfig(req, res) {
  const cfg = loadConfig();
  res.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-store" });
  res.end(JSON.stringify({ clientId: (cfg.google || {}).clientId || "" }));
}
function codes() {
  const c = loadConfig().codes;
  return Array.isArray(c) ? c.map(x => String(x).trim().toUpperCase()).filter(Boolean) : [];
}
function gate(req, res, ownerOnly = false) {
  const role = codeRole(req);
  if (!role) {
    res.writeHead(401, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "access code required" }));
    return false;
  }
  if (ownerOnly && role !== "owner") {
    res.writeHead(403, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "owner access required" }));
    return false;
  }
  return true;
}
async function handleAccess(req, res) {
  if (req.method !== "POST") { res.writeHead(405).end(); return; }
  let body;
  try { body = JSON.parse((await readBody(req)) || "{}"); } catch { res.writeHead(400).end(); return; }
  const given = String(body.code || "").trim().toUpperCase();
  const i = codes().indexOf(given);
  if (i === -1) {
    res.writeHead(401, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "invalid code" }));
    return;
  }
  res.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-store" });
  res.end(JSON.stringify({ ok: true, role: i === 0 ? "owner" : "friend" }));
}

/* ---------------- web search (duckduckgo, no key) ---------------- */
const stripTags = (s) => s.replace(/<[^>]*>/g, "").replace(/&amp;/g, "&")
  .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"')
  .replace(/&#x27;|&#39;/g, "'").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim();

async function ddgSearch(q, n = 6) {
  const ua = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";
  const headers = { "User-Agent": ua, "Accept": "text/html", "Accept-Language": "en-US,en;q=0.9" };
  // Try lite endpoint first
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
    const r = await fetch("https://lite.duckduckgo.com/lite/?q=" + encodeURIComponent(q), { headers, signal: controller.signal });
    clearTimeout(timer);
    if (r.ok) {
      const html = await r.text();
      const out = [];
      const links = [...html.matchAll(/<a[^>]*href="([^"]*uddg=[^"]*)"[^>]*>([\s\S]*?)<\/a>/g)];
      const snips = [...html.matchAll(/<td[^>]*class=['"]result-snippet['"][^>]*>([\s\S]*?)<\/td>/g)];
      links.forEach((m, i) => {
        const u = m[1].match(/uddg=([^&]+)/);
        if (!u) return;
        const url = decodeURIComponent(u[1].replace(/&amp;/g, "&"));
        if (!/^https?:/.test(url)) return;
        out.push({ title: stripTags(m[2]), url, snippet: snips[i] ? stripTags(snips[i][1]) : "" });
      });
      if (out.length) return out.slice(0, n);
    }
  } catch {}
  // Fallback: html endpoint
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
    const r = await fetch("https://html.duckduckgo.com/html/?q=" + encodeURIComponent(q), { headers, signal: controller.signal });
    clearTimeout(timer);
    if (r.ok) {
      const html = await r.text();
      const out = [];
      const rx = /<a[^>]*href="([^"]+)"[^>]*class="result__a"[^>]*>([\s\S]*?)<\/a>|<a[^>]*class="result__a"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g;
      let m; while ((m = rx.exec(html)) !== null) {
        const url = (m[1] || m[3] || "").trim();
        const title = stripTags(m[2] || m[4] || "");
        if (!url || !title) continue;
        out.push({ title, url, snippet: "" });
      }
      if (out.length) return out.slice(0, n);
    }
  } catch {}
  // Fallback: Wikipedia API for factual queries
  try {
    const lang = /^[\u00C0-\u017F]/.test(q) ? "de" : "en";
    const r = await fetch(`https://${lang}.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(q)}`, { signal: AbortSignal.timeout(5000) });
    if (r.ok) {
      const d = await r.json();
      return [{ title: d.title || q, url: d.content_urls?.desktop?.page || "#", snippet: d.extract || "" }];
    }
  } catch {}
  return [];
}

/* ---------------- provider routing ---------------- */
function upstreamFor(cfg, cand) {
  if (cand.provider === "ollama") {
    return { url: "http://localhost:11434/v1/chat/completions", headers: { "Content-Type": "application/json" } };
  }
  const p = (cfg.providers || {})[cand.provider];
  if (!p || !p.key) return null;
  const headers = { "Content-Type": "application/json", Authorization: "Bearer " + p.key };
  if (cand.provider === "openrouter") { headers["HTTP-Referer"] = "http://localhost"; headers["X-Title"] = "NOIR"; }
  return { url: p.base.replace(/\/$/, "") + "/chat/completions", headers };
}
  function buildChain(cfg, m, withImages) {
    const chain = [{ provider: m.provider, id: m.id }];
    for (const f of cfg.fallbacks || []) {
      if (cfg.models[f]) chain.push({ provider: cfg.models[f].provider, id: cfg.models[f].id });
      else if (f.includes("|")) { const parts = f.split("|"); chain.push({ provider: parts[0], id: parts[1] }); }
    }
    const seen = new Set();
    const uniq = chain.filter(c => { const k = c.provider + "|" + c.id; if (seen.has(k)) return false; seen.add(k); return true; });
    if (withImages) return uniq.filter(c => VISION_IDS.has(c.id));
    return uniq;
  }
const RETRYABLE = [403, 404, 429, 500, 502, 503, 504];

// models that accept image input
const VISION_IDS = new Set([
  "qwen/qwen3.6-27b", "qwen/qwen3.8-27b",
  "gemini-3.7-flash", "gemini-3.5-flash", "gemini-2.5-flash", "gemini-2.5-flash-lite",
  "gemini-3.1-pro-preview", "google/gemma-4-31b-it:free", "gemma-4-31b",
  "meta/llama-3.2-90b-vision-instruct", "meta/llama-3.2-11b-vision-instruct"
]);

/* ---------------- auto model selection ---------------- */
function pickAuto(cfg, body, mode) {
  const lastUser = [...(body.messages || [])].reverse().find(x => x.role === "user");
  const text = typeof (lastUser && lastUser.content) === "string" ? lastUser.content : "";
  const hasImages = Array.isArray(body.images) && body.images.length > 0;
  const tier = body.tier || "balanced";

  const has = (key) => { const m = cfg.models[key]; return m && (m.provider === "ollama" || upstreamFor(cfg, m)); };

  if (mode === "agent") {
    if (has("glm")) return "glm";
    if (has("groq120")) return "groq120";
    if (has("nv70")) return "nv70";
    return "gem37";
  }
  if (hasImages) {
    if (tier === "fast") {
      // Schnell: Groq Vision zuerst (~300 tok/s!)
      if (has("groqqwen")) return "groqqwen";
      if (has("gem35")) return "gem35";
      if (has("cbgemma")) return "cbgemma";
      if (has("gem37")) return "gem37";
      if (has("vision")) return "vision";
      if (has("nvvision")) return "nvvision";
      return "groqqwen";
    }
    if (has("gem37")) return "gem37";
    if (has("groqqwen")) return "groqqwen";
    if (has("vision")) return "vision";
    if (has("nvvision")) return "nvvision";
    if (has("gem35")) return "gem35";
    return "cbgemma";
  }

  // Text-only: tier-based selection
  if (tier === "fast") {
    // Schnell: Groq zuerst (~500 tok/s)
    if (has("groq20")) return "groq20";
    if (has("groq120")) return "groq120";
    if (has("gem35")) return "gem35";
    if (has("glm")) return "glm";
    return "gem37";
  }
  if (tier === "smart") {
    // Schlau: beste Modelle zuerst
    if (has("gem37")) return "gem37";
    if (has("groq120")) return "groq120";
    if (has("glm")) return "glm";
    if (has("gem35")) return "gem35";
    return "groq20";
  }
  // Balanciert: mix aus speed + quality
  if (has("groq120")) return "groq120";
  if (has("groq20")) return "groq20";
  if (has("gem35")) return "gem35";
  if (has("glm")) return "glm";
  return "gem37";
}

function buildBody(cand, messages, stream) {
  const body = { model: cand.id, messages, stream };
  if (cand.provider === "groq") {
    if (/qwen\/qwen3\.6/.test(cand.id)) body.reasoning_effort = "none";
    else if (/qwen\/qwen3\.8/.test(cand.id)) body.reasoning_effort = "low";
    else if (/openai\/gpt-oss/.test(cand.id)) body.reasoning_effort = "low";
  }
  return body;
}

/* ---------------- chat (streaming) ---------------- */
async function handleChat(req, res) {
  const cfg = loadConfig();
  let body;
  try { body = JSON.parse(await readBody(req)); }
  catch { res.writeHead(400).end("bad json"); return; }

  let autoNote = null;
  let m = cfg.models[body.chatModel] || cfg.models.glm;
  if (body.chatModel === "auto") {
    const picked = pickAuto(cfg, body, "chat");
    m = cfg.models[picked] || m;
    autoNote = "Auto -> " + (m.label || picked);
  }
  const modelLabel = m.label || m.id || "unknown";
  const modelProvider = m.provider || "unknown";
  let messages = Array.isArray(body.messages) ? body.messages.map(x => ({ role: x.role, content: x.content })) : [];

  if (Array.isArray(body.images) && body.images.length && messages.length) {
    const last = messages[messages.length - 1];
    if (last.role === "user") {
      last.content = [
        { type: "text", text: last.content },
        ...body.images.map(u => ({ type: "image_url", image_url: { url: u } }))
      ];
    }
  }

  if (Array.isArray(body.webResults) && body.webResults.length) {
    const block = "WEB SEARCH RESULTS (fresh) - cite them with [n] where used:\n" +
      body.webResults.map((r, i) => `[${i + 1}] ${r.title}\n${r.snippet}\nURL: ${r.url}`).join("\n\n");
    messages = [{ role: "system", content: "You have live web access. Use the following search results as ground truth for current facts." },
      ...messages.slice(0, -1),
      { role: "user", content: messages[messages.length - 1].content + "\n\n" + block }];
  }

  if (m.provider !== "ollama" && !upstreamFor(cfg, m)) {
    res.writeHead(200, { "Content-Type": "text/event-stream" });
    res.end(`data: ${JSON.stringify({ error: "No API key for " + m.provider + ". Settings -> paste a free key." })}\n\ndata: [DONE]\n\n`);
    return;
  }

  let ur = null, usedId = null, lastErr = "";
  const withImages = Array.isArray(body.images) && body.images.length > 0;
  for (const cand of buildChain(cfg, m, withImages)) {
    const up = upstreamFor(cfg, cand);
    if (!up) continue;
    try {
      const attempt = await fetch(up.url, {
        method: "POST", headers: up.headers,
        body: JSON.stringify(buildBody(cand, messages, true))
      });
      if (attempt.ok) { ur = attempt; usedId = cand.id; break; }
      const t = await attempt.text().catch(() => "");
      let msg = t.slice(0, 200);
      try { msg = JSON.parse(t).error?.message || msg; } catch {}
      lastErr = attempt.status + ": " + msg;
      if (!RETRYABLE.includes(attempt.status)) break;
    } catch (e) { lastErr = e.message; }
  }

  if (!ur) {
    res.writeHead(200, { "Content-Type": "text/event-stream" });
    res.end(`data: ${JSON.stringify({ error: lastErr || "all models unreachable" })}\n\ndata: [DONE]\n\n`);
    return;
  }

  res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" });
  if (autoNote) {
    res.write(`data: ${JSON.stringify({ notice: autoNote, modelInfo: { label: modelLabel, provider: modelProvider } })}\n\n`);
  }
  if (usedId !== m.id) {
    res.write(`data: ${JSON.stringify({ notice: "Wechsel zu " + usedId })}\n\n`);
  }
  const reader = ur.body.getReader();
  try { for (;;) { const { done, value } = await reader.read(); if (done) break; res.write(Buffer.from(value)); } } catch {}
  res.end();
}

/* ---------------- agent tools ---------------- */
async function readUrl(url) {
  if (!/^https?:\/\//.test(url)) return "invalid url";
  const r = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)" }, signal: AbortSignal.timeout(15000) });
  const html = await r.text();
  return stripHtml(html).slice(0, 6000);
}
function stripHtml(html) {
  return html.replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]*>/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"').replace(/&#x27;|&#39;/g, "'").replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ").trim();
}
function calculate(expr) {
  if (!/^[\d\s+\-*/().,%eE]+$/.test(expr)) return "rejected: unsafe expression";
  try { const v = Function('"use strict";return (' + expr + ")")(); return String(v); }
  catch { return "calculation error"; }
}

const AGENT_SYSTEM = `Du bist NOIR, ein autonomer Agent mit Werkzeugen. Antworte NUR mit minifiziertem JSON, kein Markdown, keine Code-Fences.
Werkzeug benutzen: {"thought":"warum","tool":"web_search|read_url|calculate|now|write_file|read_file|list_files","args":{"query":"..."} oder {"url":"..."} oder {"expression":"..."} oder {"filename":"bericht.md","content":"voller Dateitext"}}
Finale Antwort: {"final":"deine komplette Markdown-Antwort mit [n] Quellenangaben wenn Web benutzt wurde"}
Regeln: Maximal 5 Werkzeugaufrufe, keine identischen Suchen. Wenn der User ein Dokument, einen Aufsatz, Code, eine Liste oder aehnliches will, ERSTELLE es mit write_file (voller Inhalt), erwaehne dann den Dateinamen in deiner Antwort. Immer mit {"final":...} beenden. Benutze calculate fuer Mathematik mit Zahlen aus den Suchergebnissen.`;

const runTool = async (name, args) => {
  try {
    if (name === "web_search") {
      const rs = await ddgSearch(String(args.query || ""), 5);
      return rs.map((r, i) => `[${i + 1}] ${r.title} - ${r.snippet} (${r.url})`).join("\n") || "no results";
    }
    if (name === "read_url") return await readUrl(String(args.url || ""));
    if (name === "calculate") return calculate(String(args.expression || ""));
    if (name === "now") return new Date().toString();
    if (name === "write_file") {
      const fname = String(args.filename || "file.txt").replace(/[^\w.\- ]/g, "_").slice(0, 60);
      const full = path.join(WORKSPACE, fname);
      if (!full.startsWith(WORKSPACE)) return "rejected: bad filename";
      fs.mkdirSync(WORKSPACE, { recursive: true });
      fs.writeFileSync(full, String(args.content || ""), "utf8");
      return `created ${fname} (${String(args.content || "").length} chars). Tell the user they can download it from the workspace.`;
    }
    if (name === "read_file") {
      const fname = String(args.filename || "").replace(/[^\w.\- ]/g, "_");
      const full = path.join(WORKSPACE, fname);
      if (!fs.existsSync(full)) return "file not found. Use list_files to see what exists.";
      return fs.readFileSync(full, "utf8").slice(0, 5000);
    }
    if (name === "list_files") {
      fs.mkdirSync(WORKSPACE, { recursive: true });
      const list = fs.readdirSync(WORKSPACE).map(f => {
        const st = fs.statSync(path.join(WORKSPACE, f));
        return `${f} (${st.size} bytes)`;
      });
      return list.join("\n") || "workspace is empty";
    }
    return "unknown tool";
  } catch (e) { return "tool error: " + e.message; }
};

async function callModel(cfg, modelId, messages) {
  let prov = "openrouter", id = modelId;
  if (modelId.includes("|")) { const parts = modelId.split("|"); prov = parts[0]; id = parts[1]; }
  const chain = [{ provider: prov, id }];
  for (const f of cfg.fallbacks || []) {
    if (cfg.models[f]) chain.push({ provider: cfg.models[f].provider, id: cfg.models[f].id });
    else if (f.includes("|")) { const parts = f.split("|"); chain.push({ provider: parts[0], id: parts[1] }); }
  }
  const seen = new Set();
  const uniq = chain.filter(c => { const k = c.provider + "|" + c.id; if (seen.has(k)) return false; seen.add(k); return true; });

  let lastErr = "all models busy";
  for (const cand of uniq) {
    if (cand.provider === "ollama") continue;
    const up = upstreamFor(cfg, cand);
    if (!up) continue;
    try {
      const r = await fetch(up.url, { method: "POST", headers: up.headers, body: JSON.stringify(buildBody(cand, messages, false)) });
      if (r.ok) { const j = await r.json(); return j.choices[0].message.content || ""; }
      lastErr = "model " + r.status;
      if (!RETRYABLE.includes(r.status)) break;
    } catch (e) { lastErr = e.message; }
  }
  throw new Error(lastErr);
}

function unescapeJson(s) {
  return s.replace(/\\n/g, "\n").replace(/\\t/g, "\t").replace(/\\"/g, '"').replace(/\\\\/g, "\\");
}
function parseAgentReply(text) {
  const m = text.match(/\{[\s\S]*\}/);
  if (m) {
    try { return JSON.parse(m[0]); } catch {}
    const raw = m[0];
    const fin = raw.match(/"final"\s*:\s*"([\s\S]*)"/);
    if (fin) return { final: unescapeJson(fin[1]) };
    const tool = (raw.match(/"tool"\s*:\s*"(\w+)"/) || [])[1];
    if (tool) {
      const args = {};
      const grab = (k) => { const r = raw.match(new RegExp('"' + k + '"\\s*:\\s*"([^"]*)"')); if (r) args[k] = r[1]; };
      ["filename", "query", "url", "expression"].forEach(grab);
      const cm = raw.match(/"content"\s*:\s*"([\s\S]*)"/);
      if (cm) args.content = unescapeJson(cm[1]);
      return { thought: "", tool, args };
    }
  }
  return { final: text };
}

async function handleAgent(req, res) {
  const cfg = loadConfig();
  let body;
  try { body = JSON.parse(await readBody(req)); }
  catch { res.writeHead(400).end("bad json"); return; }
  const anyCloudKey = Object.values(cfg.providers || {}).some(p => p && p.key);
  if (!anyCloudKey) {
    res.writeHead(200, { "Content-Type": "text/event-stream" });
    res.end(`data: ${JSON.stringify({ error: "Agent needs a cloud API key. Settings -> paste a free key." })}\n\ndata: [DONE]\n\n`);
    return;
  }
  res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" });
  const send = (o) => res.write(`data: ${JSON.stringify(o)}\n\n`);

  const picked = body.chatModel === "auto" ? pickAuto(cfg, body, "agent") : body.chatModel;
  const m = cfg.models[picked] || cfg.models.glm;
  const history = (body.messages || []).slice(-8);
  const messages = [{ role: "system", content: AGENT_SYSTEM }, ...history];
  let toolsUsed = 0;
  send({ notice: "Agent → " + (m.label || picked), modelInfo: { label: m.label || picked, provider: m.provider || "unknown" } });

  try {
    for (let step = 0; step < 8; step++) {
      if (step === 4) {
        messages.push({ role: "system", content: 'Tool budget exhausted. You MUST reply now with {"final":"..."} using what you have gathered.' });
      }
      send({ toolStatus: step === 0 ? "thinking..." : "thinking next step..." });
      const reply = await callModel(cfg, m.provider + "|" + m.id, messages);
      const parsed = parseAgentReply(reply);

      if (parsed.final || !parsed.tool) {
        const finalText = parsed.final || reply;
        const words = finalText.split(/(\s+)/);
        for (const w of words) {
          send({ delta: w });
          if (w.trim()) await new Promise(r => setTimeout(r, 8));
        }
        send({ done: true, toolsUsed });
        res.end(); return;
      }

      toolsUsed++;
      const label = parsed.tool === "web_search" ? `searching: "${String(parsed.args?.query || "").slice(0, 40)}"`
        : parsed.tool === "read_url" ? "reading page..."
        : parsed.tool === "calculate" ? "calculating..."
        : parsed.tool === "write_file" ? `creating ${String(parsed.args?.filename || "file")}...`
        : parsed.tool === "read_file" ? "reading file..."
        : parsed.tool === "list_files" ? "listing workspace..." : parsed.tool;
      send({ toolStatus: label });
      const result = await runTool(parsed.tool, parsed.args || {});
      send({ toolDone: label });
      if (parsed.tool === "write_file") send({ fileCreated: String(parsed.args?.filename || "file") });
      messages.push({ role: "assistant", content: JSON.stringify(parsed) });
      messages.push({ role: "user", content: "TOOL_RESULT (" + parsed.tool + "):\n" + String(result).slice(0, 5000) + "\n\nContinue. Remember: JSON only." });
    }
    send({ error: "agent hit step limit" });
  } catch (e) { send({ error: e.message }); }
  res.end();
}

/* ---------------- auto title ---------------- */
async function handleTitle(req, res) {
  const cfg = loadConfig();
  try {
    const body = JSON.parse(await readBody(req));
    const text = (body.messages || []).map(m => m.role + ": " + String(m.content).slice(0, 300)).join("\n").slice(0, 1200);
    let title = "";
    const anyCloudKey = Object.values(cfg.providers || {}).some(p => p && p.key);
    if (anyCloudKey) {
      const out = await callModel(cfg, cfg.titleModel || "openrouter|nvidia/nemotron-3.5-lightning:free", [
        { role: "system", content: "Erstelle einen 2-5 woertigen Titel fuer dieses Gespraech. Antworte NUR mit dem Titel, keine Anfuehrungszeichen, kein Satzzeichen am Ende. Sprache wie der User." },
        { role: "user", content: text }
      ]);
      title = out.replace(/["'.]/g, "").trim().slice(0, 48);
    }
    if (!title) title = (body.fallback || "new chat").slice(0, 40);
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ title }));
  } catch { res.writeHead(500).end(); }
}

/* ---------------- transcribe (Groq Whisper) ---------------- */
async function handleTranscribe(req, res) {
  try {
    const cfg = loadConfig();
    const groqKey = (cfg.providers?.groq || {}).key;
    if (!groqKey) {
      res.writeHead(503, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Groq API-Schlüssel nicht konfiguriert" }));
      return;
    }

    // Collect raw body (audio blob)
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const audioBuf = Buffer.concat(chunks);

    if (audioBuf.length < 100) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Aufnahme zu kurz" }));
      return;
    }

    // Determine content type from query param or default to webm
    const u = new URL(req.url, "http://x");
    const ext = u.searchParams.get("fmt") || "webm";
    const mimeMap = { webm: "audio/webm", mp3: "audio/mpeg", wav: "audio/wav", ogg: "audio/ogg", m4a: "audio/mp4" };
    const mime = mimeMap[ext] || "audio/webm";

    // Build multipart/form-data body properly
    const boundary = "----NOIRBoundary" + Date.now();
    const encoder = new TextEncoder();

    // Helper to build part
    function makePart(name, value, filename, contentType) {
      let header = `--${boundary}\r\nContent-Disposition: form-data; name="${name}"`;
      if (filename) header += `; filename="${filename}"`;
      header += "\r\n";
      if (contentType) header += `Content-Type: ${contentType}\r\n`;
      header += "\r\n";
      const headerBuf = encoder.encode(header);
      const valueBuf = typeof value === "string" ? encoder.encode(value) : value;
      return Buffer.concat([headerBuf, valueBuf, encoder.encode("\r\n")]);
    }

    const parts = [
      makePart("file", audioBuf, "audio." + ext, mime),
      makePart("model", "whisper-large-v3-turbo"),
      makePart("language", "de"),
      makePart("response_format", "json"),
    ];
    parts.push(encoder.encode(`--${boundary}--\r\n`));
    const body = Buffer.concat(parts);

    console.log(`[transcribe] Sending ${body.length} bytes to Groq Whisper (${audioBuf.length} byte audio, fmt=${ext})`);

    const resp = await fetch("https://api.groq.com/openai/v1/audio/transcriptions", {
      method: "POST",
      headers: {
        "Authorization": "Bearer " + groqKey,
        "Content-Type": `multipart/form-data; boundary=${boundary}`,
      },
      body,
      signal: AbortSignal.timeout(30000),
    });

    const respText = await resp.text();
    console.log(`[transcribe] Groq responded ${resp.status}: ${respText.slice(0, 300)}`);

    if (!resp.ok) {
      res.writeHead(502, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Transkription fehlgeschlagen (" + resp.status + ")", detail: respText.slice(0, 200) }));
      return;
    }

    let result;
    try { result = JSON.parse(respText); } catch { result = { text: respText }; }
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ text: result.text || "" }));
  } catch (e) {
    console.error("[transcribe] Error:", e.message);
    res.writeHead(500, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Server-Fehler: " + e.message }));
  }
}

/* ---------------- server ---------------- */
const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, "http://x");

  if (u.pathname === "/api/access") return handleAccess(req, res);
  if (u.pathname === "/api/auth/config") return handleAuthConfig(req, res);
  if (u.pathname === "/api/auth/google" && req.method === "POST") return handleAuthGoogle(req, res);

  if (u.pathname.startsWith("/api/") && !gate(req, res, u.pathname === "/api/config" && req.method === "PUT")) return;
  if (u.pathname.startsWith("/workspace") && !gate(req, res)) return;

  if (u.pathname === "/api/ping") { res.writeHead(200).end("pong"); return; }

  if (u.pathname === "/api/chat" && req.method === "POST") return handleChat(req, res);
  if (u.pathname === "/api/agent" && req.method === "POST") return handleAgent(req, res);
  if (u.pathname === "/api/title" && req.method === "POST") return handleTitle(req, res);

  if (u.pathname === "/api/search") {
    const q = u.searchParams.get("q") || "";
    if (!q) { res.writeHead(200, { "Content-Type": "application/json" }); res.end("[]"); return; }
    try {
      const results = await ddgSearch(q);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(results));
    } catch (e) {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end("[]");
    }
    return;
  }

  if (u.pathname === "/api/transcribe" && req.method === "POST") return handleTranscribe(req, res);

  if (u.pathname === "/api/health") {
    const cfg = loadConfig();
    let ollama = false;
    try { await fetch("http://localhost:11434/api/tags", { signal: AbortSignal.timeout(1500) }); ollama = true; } catch {}
    const keyStatus = {};
    for (const [k, v] of Object.entries(cfg.providers || {})) {
      keyStatus[k] = v.key ? v.key.slice(0, 12) + "..." : "EMPTY";
    }
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ollama, hasKey: Object.values(cfg.providers || {}).some(p => p && p.key), keys: keyStatus }));
    return;
  }

  if (u.pathname === "/api/models") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(loadConfig().models));
    return;
  }

  if (u.pathname === "/api/config") {
    if (req.method === "GET") {
      const cfg = loadConfig();
      const provs = {};
      for (const [k, v] of Object.entries(cfg.providers || {})) provs[k] = !!v.key;
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ hasKey: Object.values(provs).some(Boolean), providers: provs }));
      return;
    }
    if (req.method === "PUT") {
      const b = JSON.parse((await readBody(req)) || "{}");
      const cfg = loadConfig();
      if (typeof b.openrouterKey === "string" && b.openrouterKey.trim()) {
        cfg.openrouterKey = b.openrouterKey.trim();
        if (cfg.providers && cfg.providers.openrouter) cfg.providers.openrouter.key = b.openrouterKey.trim();
      }
      if (b.providerKeys && typeof b.providerKeys === "object") {
        for (const [pk, pv] of Object.entries(b.providerKeys)) {
          if (typeof pv === "string" && pv.trim() && cfg.providers[pk]) cfg.providers[pk].key = pv.trim();
        }
      }
      if (typeof b.googleClientId === "string") {
        if (!cfg.google) cfg.google = { allowed: [] };
        cfg.google.clientId = b.googleClientId.trim();
      }
      fs.writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2));
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true }));
      return;
    }
  }

  if (u.pathname === "/workspace" && req.method === "GET") {
    fs.mkdirSync(WORKSPACE, { recursive: true });
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(fs.readdirSync(WORKSPACE)));
    return;
  }
  if (u.pathname.startsWith("/workspace/")) {
    const fname = decodeURIComponent(u.pathname.slice("/workspace/".length)).replace(/[\/\\]/g, "_");
    const full = path.join(WORKSPACE, fname);
    if (!full.startsWith(WORKSPACE) || !fs.existsSync(full)) { res.writeHead(404).end("not found"); return; }
    res.writeHead(200, { "Content-Type": "application/octet-stream", "Content-Disposition": `attachment; filename="${fname}"` });
    fs.createReadStream(full).pipe(res);
    return;
  }

  let file = u.pathname === "/" ? "/index.html" : decodeURIComponent(u.pathname);
  file = path.normalize(file).replace(/^(\.\.[\/\\])+/, "");
  const full = path.join(UI_DIR, file);
  if (!full.startsWith(UI_DIR)) { res.writeHead(403).end(); return; }
  fs.readFile(full, (err, data) => {
    if (err) { res.writeHead(404).end("not found"); return; }
    res.writeHead(200, { "Content-Type": MIME[path.extname(full)] || "application/octet-stream" });
    res.end(data);
  });
});

const port = (process.env.PORT && parseInt(process.env.PORT)) || (() => { try { return loadConfig().port; } catch { return 3000; } })();
server.listen(port, () => console.log("NOIR v3 multi-provider -> http://localhost:" + port));
