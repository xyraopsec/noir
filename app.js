/* NOIR v3 — KI-Client im Grok-Stil */
const $ = (s) => document.querySelector(s);
const chatEl = $("#chat"), inputEl = $("#input"), sendBtn = $("#sendBtn");
const convList = $("#convList"), titleEl = $("#title"), statusLine = $("#statusLine");
const attachRow = $("#attachRow"), fileInput = $("#fileInput"), webBtn = $("#webBtn");
const composerWrap = $("#composerWrap"), mainEl = $("#main");

let MODELS = {};
let conversations = JSON.parse(localStorage.getItem("noir_convs") || "[]");
let currentId = null;
let busy = false, aborter = null, lastModalTrigger = null;
let pendingImgs = [], pendingFiles = [], webOn = false;
let modelTier = localStorage.getItem("noir_tier") || "balanced";
let lastSendText = "", lastSendImgs = [], lastSendFiles = [];

const currentConv = () => conversations.find(c => c.id === currentId);
const saveConvs = () => localStorage.setItem("noir_convs", JSON.stringify(conversations));

pdfjsLib.GlobalWorkerOptions.workerSrc = "https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.worker.min.js";

/* ---------------- markdown ---------------- */
marked.setOptions({
  gfm: true,
  breaks: true,
  pedantic: false,
  smartypants: false
});
function enhance(el) {
  el.querySelectorAll("pre code").forEach(code => {
    try { hljs.highlightElement(code); } catch {}
    const pre = code.parentElement;
    if (pre.parentElement?.classList.contains("code-block")) return;
    const block = document.createElement("div"); block.className = "code-block";
    const head = document.createElement("div"); head.className = "code-head";
    const lang = (code.className.match(/language-([\w+-]+)/) || [])[1] || "code";
    head.innerHTML = `<span>${lang.toUpperCase()}</span>`;
    const btn = document.createElement("button");
    btn.className = "copy-btn"; btn.textContent = "KOPIEREN";
    btn.onclick = () => { navigator.clipboard.writeText(code.textContent); btn.textContent = "KOPIERT ✓"; setTimeout(() => btn.textContent = "KOPIEREN", 1200); };
    head.appendChild(btn);
    pre.replaceWith(block); block.appendChild(head); block.appendChild(pre);
  });
}
const mdRender = (t) => DOMPurify.sanitize(marked.parse(t || "", { breaks: true, gfm: true }));

function streamSafe(text) {
  const lines = text.split("\n");
  let inCode = false;
  let safe = [];
  let incomplete = [];
  for (const line of lines) {
    if (line.trimStart().startsWith("```")) {
      if (!inCode) { inCode = true; safe.push(line); }
      else { inCode = false; safe.push(line); }
    } else if (inCode) {
      safe.push(line);
    } else {
      incomplete.push(line);
    }
  }
  const joined = safe.join("\n");
  const tail = incomplete.join("\n");
  if (inCode) return joined + "\n" + tail;
  const openBold = (tail.match(/\*\*/g) || []).length % 2;
  const openItalic = (tail.match(/(?<!\*)\*(?!\*)/g) || []).length % 2;
  const openCode = (tail.match(/`/g) || []).length % 2;
  let clean = tail;
  if (openBold) clean = clean.replace(/\*\*[^*]*$/, "");
  if (openItalic) clean = clean.replace(/(?<!\*)\*[^*]*$/, "");
  if (openCode) clean = clean.replace(/`[^`]*$/, "");
  return joined + (joined && clean ? "\n" : "") + clean;
}

/* ---------------- layout ---------------- */
function isHero() { const c = currentConv(); return !c || !c.messages.length; }

function placeComposer() {
  const slot = $("#heroSlot");
  if (isHero() && slot) slot.appendChild(composerWrap);
  else mainEl.appendChild(composerWrap);
}

/* ---------------- rendering ---------------- */
function threadEl() {
  let t = chatEl.querySelector(".thread");
  if (!t) { t = document.createElement("div"); t.className = "thread"; chatEl.appendChild(t); }
  return t;
}

function addUserMsg(text, imgs = [], editable = false) {
  const t = threadEl();
  const m = document.createElement("div"); m.className = "msg user";
  const b = document.createElement("div"); b.className = "bubble"; b.textContent = text;
  m.appendChild(b);
  for (const u of imgs) { const i = document.createElement("img"); i.className = "attach-img"; i.src = u; m.appendChild(i); }
  if (editable) {
    const row = document.createElement("div"); row.className = "msg-actions";
    const ed = document.createElement("button"); ed.className = "act-btn"; ed.textContent = "Bearbeiten";
    ed.onclick = () => editAndResend(text);
    row.appendChild(ed); m.appendChild(row);
  }
  t.appendChild(m); chatEl.scrollTop = chatEl.scrollHeight;
}

function addAiMsg() {
  const t = threadEl();
  const m = document.createElement("div"); m.className = "msg ai";
  m.innerHTML = `<div class="who"><div class="glyph">N</div><div class="name">NOIR</div></div>
    <div class="body"><div class="thinking"><i></i><i></i><i></i></div></div>`;
  t.appendChild(m); chatEl.scrollTop = chatEl.scrollHeight;
  return m.querySelector(".body");
}

function statsRow(s) {
  const d = document.createElement("div"); d.className = "stats";
  d.innerHTML = `<span><b>${s.tps}</b> Tok/s</span><span><b>${s.ttft}s</b> bis zum ersten Token</span><span><b>${s.total}s</b> gesamt</span>`;
  return d;
}
function sourcesBlock(srcs) {
  const d = document.createElement("div"); d.className = "sources";
  const title = document.createElement("div"); title.className = "sources-title"; title.textContent = `${srcs.length} QUELLE${srcs.length === 1 ? "" : "N"}`;
  d.appendChild(title);
  const row = document.createElement("div"); row.className = "src-row";
  srcs.forEach((s, i) => {
    const a = document.createElement("a"); a.className = "src-bubble"; a.href = /^https?:\/\//i.test(s.url || "") ? s.url : "#"; a.target = "_blank"; a.rel = "noopener";
    const host = (() => { try { return new URL(s.url).hostname.replace("www.", ""); } catch { return "quelle"; } })();
    const fav = document.createElement("img"); fav.className = "src-fav"; fav.src = `https://www.google.com/s2/favicons?domain=${host}&sz=32`; fav.onerror = () => fav.style.display = "none";
    const span = document.createElement("span"); span.className = "src-name"; span.textContent = s.title || host;
    a.append(fav, span); row.appendChild(a);
  });
  d.appendChild(row);
  return d;
}
function addActions(el, m) {
  const row = document.createElement("div"); row.className = "msg-actions";
  const cp = document.createElement("button"); cp.className = "act-btn"; cp.textContent = "Kopieren";
  cp.onclick = () => { navigator.clipboard.writeText(m.content); cp.textContent = "Kopiert ✓"; setTimeout(() => cp.textContent = "Kopieren", 1200); };
  row.appendChild(cp);
  const listen = document.createElement("button"); listen.className = "act-btn"; listen.textContent = "Anhören";
  listen.onclick = () => {
    if (!("speechSynthesis" in window)) return toast("Audio-Wiedergabe hier nicht verfügbar");
    if (speechSynthesis.speaking) { speechSynthesis.cancel(); listen.textContent = "Anhören"; return; }
    const spoken = new SpeechSynthesisUtterance(m.content.replace(/[`#*_>]/g, " "));
    const voices = speechSynthesis.getVoices();
    const localVoice = voices.find(v => v.localService === true && v.lang.startsWith("de"))
      || voices.find(v => v.localService === true) || null;
    if (localVoice) spoken.voice = localVoice;
    spoken.lang = "de-DE"; spoken.rate = .96;
    spoken.onend = () => listen.textContent = "Anhören"; listen.textContent = "Stopp"; speechSynthesis.speak(spoken);
  };
  row.appendChild(listen);
  const c = currentConv();
  if (c && c.messages[c.messages.length - 1] === m) {
    const rg = document.createElement("button"); rg.className = "act-btn"; rg.textContent = "Erneut versuchen";
    rg.onclick = regenerate; row.appendChild(rg);
  }
  el.appendChild(row);
}

function renderChat() {
  chatEl.innerHTML = "";
  const c = currentConv();
  titleEl.textContent = c ? c.title : "";
  const contextBadge = $("#contextBadge");
  if (c?.messages?.length) {
    const msgCount = c.messages.length;
    const charCount = c.messages.reduce((s, m) => s + (m.content || "").length, 0);
    const estTokens = Math.round(charCount / 4);
    const warn = estTokens > 28000;
    contextBadge.textContent = `${msgCount} Nachrichten · ~${estTokens > 1000 ? (estTokens/1000).toFixed(1) + 'k' : estTokens} Tokens`;
    contextBadge.classList.toggle("context-warn", warn);
    contextBadge.classList.remove("hidden");
  }
  else contextBadge.classList.add("hidden");
  if (!c || !c.messages.length) {
    chatEl.innerHTML = `<div class="hero">
      <div class="hero-eyebrow"><i></i> PRIVATES INTELLIGENZSYSTEM</div>
      <div class="hero-mark">NOIR</div>
      <div class="hero-sub">Ein ruhiger Ort zum Nachdenken, Suchen, Bauen und Verstehen.</div>
      <div id="heroSlot" style="width:100%;display:flex;justify-content:center"></div>
      <div class="hero-hint"><span>⌘ K</span> Befehlspalette <b>·</b> <span>↵</span> Senden <b>·</b> <span>⇧ ↵</span> Neue Zeile</div>
      <div class="sugg-row">
        <button class="sugg" data-p="Erklaere mir Quantencomputer in 5 Saetzen"><div class="bg" style="background-image:url('assets/hero2.jpg')"></div><div class="fg"><div class="t">◈ Etwas erklaeren</div><div class="d">Einfach und verstaendlich</div></div></button>
        <button class="sugg" data-p="Hilf mir beim Lernen fuer "><div class="bg" style="background-image:url('assets/hero3.jpg')"></div><div class="fg"><div class="t">⌗ Lernen vorbereiten</div><div class="d">Fach, Themen, Zusammenfassung</div></div></button>
        <button class="sugg" data-p="Schreib mir eine E-Mail an "><div class="bg" style="background-image:url('assets/hero1.jpg')"></div><div class="fg"><div class="t">▤ E-Mail schreiben</div><div class="d">Professionell oder locker</div></div></button>
        <button class="sugg" data-p="Recherchiere die neuesten Entwicklungen in "><div class="bg" style="background-image:url('assets/hero1.jpg')"></div><div class="fg"><div class="t">⌕ Tiefenrecherche</div><div class="d">Live-Web + Quellenangaben</div></div></button>
      </div></div>`;
    chatEl.querySelectorAll(".sugg").forEach(b => b.onclick = () => { inputEl.value = b.dataset.p; inputEl.focus(); autosize(); });
  } else {
    for (const m of c.messages) {
      if (m.role === "user") addUserMsg(m.content, m.images || [], true);
      else {
        const el = addAiMsg();
        if (m.thinking) {
          const tw = document.createElement("div"); tw.className = "think-wrap";
          tw.innerHTML = `<details class="think"><summary>◦ Denkprozess</summary><div class="think-body"></div></details>`;
          tw.querySelector(".think-body").textContent = m.thinking;
          el.parentElement.insertBefore(tw, el);
        }
        el.innerHTML = mdRender(m.content); enhance(el);
        if (m.tools?.length) {
          const tr = document.createElement("div"); tr.className = "tool-trace";
          for (const tl of m.tools) {
            const ch = document.createElement("span"); ch.className = "tool-chip ok";
            ch.innerHTML = `<span class="spin"></span>` + tl;
            tr.appendChild(ch);
          }
          el.parentElement.insertBefore(tr, el);
        }
        if (m.files?.length) {
          const fr = document.createElement("div"); fr.className = "tool-trace";
          for (const f of m.files) {
            const a = document.createElement("a");
            a.className = "file-chip";
            a.href = "/workspace/" + encodeURIComponent(f);
            a.target = "_blank";
            a.innerHTML = `▤ ${f} <span class="dl">HERUNTERLADEN</span>`;
            fr.appendChild(a);
          }
          el.parentElement.insertBefore(fr, el);
        }
        if (m.model) {
          const mb = document.createElement("div"); mb.className = "model-badge";
          const tierIcon = modelTier === "fast" ? "⚡" : modelTier === "smart" ? "◈" : "◉";
          mb.innerHTML = `<span class="model-dot"></span>${tierIcon} ${m.model.label}${m.model.provider ? " · " + m.model.provider : ""}`;
          el.appendChild(mb);
        }
        if (m.stats) el.appendChild(statsRow(m.stats));
        if (m.sources?.length) el.appendChild(sourcesBlock(m.sources));
        addActions(el, m);
      }
    }
    chatEl.scrollTop = chatEl.scrollHeight;
  }
  placeComposer();
}

function renderConvs(filter = "") {
  convList.innerHTML = "";
  const visible = conversations.filter(c => !filter || c.title.toLowerCase().includes(filter.toLowerCase()));
  const count = $("#threadCount"); if (count) count.textContent = visible.length || "";
  for (const c of [...visible].sort((a, b) => Number(!!b.pinned) - Number(!!a.pinned) || b.id - a.id)) {
    const d = document.createElement("div");
    d.className = "conv-item" + (c.id === currentId ? " active" : "");
    const t = document.createElement("span"); t.className = "t"; t.textContent = c.title;
    const pin = document.createElement("button"); pin.className = "conv-pin" + (c.pinned ? " pinned" : ""); pin.title = c.pinned ? "Chat lösen" : "Chat anheften"; pin.setAttribute("aria-label", pin.title); pin.textContent = "⌁";
    pin.onclick = (e) => { e.stopPropagation(); c.pinned = !c.pinned; saveConvs(); renderConvs(convSearch.value); toast(c.pinned ? "Chat angeheftet" : "Chat gelöst"); };
    const x = document.createElement("button"); x.className = "conv-del"; x.textContent = "✕";
    x.onclick = (e) => { e.stopPropagation();
      conversations = conversations.filter(k => k.id !== c.id);
      if (currentId === c.id) currentId = conversations.length ? conversations[conversations.length - 1].id : null;
      saveConvs(); renderConvs(convSearch.value); renderChat(); };
    d.append(t, pin, x);
    d.onclick = () => { currentId = c.id;
      saveConvs(); renderConvs(convSearch.value); renderChat();
      if (window.innerWidth <= 700) closeSidebar(); };
    convList.appendChild(d);
  }
}

async function loadModels() {
  try {
    const h = await (await fetch("/api/health")).json();
    $("#dotOllama").classList.toggle("on", h.ollama);
    $("#dotKey").classList.toggle("on", h.hasKey);
  } catch {}
}

/* ---------------- attachments ---------------- */
function renderChips() {
  attachRow.innerHTML = "";
  const has = pendingImgs.length || pendingFiles.length;
  attachRow.classList.toggle("hidden", !has);
  for (const u of pendingImgs) {
    const chip = document.createElement("div"); chip.className = "chip";
    chip.innerHTML = `<img src="${u}"><span class="x">✕</span>`;
    chip.querySelector(".x").onclick = () => { pendingImgs = pendingImgs.filter(k => k !== u); renderChips(); };
    attachRow.appendChild(chip);
  }
  for (const f of pendingFiles) {
    const chip = document.createElement("div"); chip.className = "chip";
    chip.innerHTML = `<span>▤ ${f.name} · ${Math.round(f.text.length / 1000)}k</span><span class="x">✕</span>`;
    chip.querySelector(".x").onclick = () => { pendingFiles = pendingFiles.filter(k => k !== f); renderChips(); };
    attachRow.appendChild(chip);
  }
}
function resizeImg(dataUrl) {
  return new Promise((res) => {
    const im = new Image();
    im.onload = () => {
      const max = 512, sc = Math.min(1, max / Math.max(im.width, im.height));
      const cv = document.createElement("canvas");
      cv.width = im.width * sc; cv.height = im.height * sc;
      cv.getContext("2d").drawImage(im, 0, 0, cv.width, cv.height);
      res(cv.toDataURL("image/jpeg", 0.6));
    };
    im.src = dataUrl;
  });
}
async function extractPdf(file) {
  const buf = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: buf }).promise;
  let text = "";
  const pages = Math.min(pdf.numPages, 30);
  for (let i = 1; i <= pages; i++) {
    const page = await pdf.getPage(i);
    const c = await page.getTextContent();
    text += c.items.map(it => it.str).join(" ") + "\n\n";
  }
  return { name: file.name, text: text.slice(0, 80000) + (text.length > 80000 ? "…[truncated]" : "") };
}
fileInput.onchange = async () => {
  for (const f of fileInput.files) {
    if (f.type.startsWith("image/")) {
      const dataUrl = await new Promise(r => { const fr = new FileReader(); fr.onload = () => r(fr.result); fr.readAsDataURL(f); });
      pendingImgs.push(await resizeImg(dataUrl));
    } else if (f.name.endsWith(".pdf")) {
      try { pendingFiles.push(await extractPdf(f)); statusLine.textContent = "pdf extracted ✓"; }
      catch { statusLine.textContent = "pdf failed to parse"; }
    } else if (/\.(txt|md|csv|json|log)$/i.test(f.name)) {
      pendingFiles.push({ name: f.name, text: (await f.text()).slice(0, 80000) });
    }
  }
  fileInput.value = ""; renderChips();
};

/* ---------------- send ---------------- */
async function doSend(text, imgs, files) {
  let c = currentConv();
  if (!c) {
    c = { id: Date.now(), createdAt: new Date().toISOString(), title: text.slice(0, 40) || "Neuer Chat", messages: [] };
    conversations.push(c); currentId = c.id;
  }
  let content = text;
  for (const f of files) content += `\n\n--- FILE: ${f.name} ---\n${f.text}`;

  // Bilder werden direkt an Vision-Modell gesendet (kein Tesseract-OCR)
  const imgsToSend = imgs;

  c.messages.push({ role: "user", content, images: imgsToSend });
  renderConvs(convSearch.value); saveConvs();

  // leave hero mode
  chatEl.innerHTML = "";
  const t = threadEl();
  addUserMsg(text || "(Anhang)", imgs);
  placeComposer();

  const aiEl = addAiMsg();
  aiEl.innerHTML = `<div class="tool-trace"></div><div class="think-wrap"></div><div class="body"></div>`;
  const traceEl = aiEl.querySelector(".tool-trace");
  const thinkWrap = aiEl.querySelector(".think-wrap");
  const bodyEl = aiEl.querySelector(".body");
  aiEl.parentElement.classList.add("streaming");
  let acc = "", thinkAcc = "", filesMade = [], modelInfo = null;
  busy = true; sendBtn.classList.add("stop"); sendBtn.innerHTML = "■";
  aborter = new AbortController();

  let webResults = null;
  statusLine.textContent = "🔍 Durchsuche das Web…";
  try {
    const searchRes = await fetch("/api/search?q=" + encodeURIComponent(text.slice(0, 300)));
    const searchJson = await searchRes.json();
    webResults = Array.isArray(searchJson) ? searchJson : [];
    statusLine.textContent = webResults.length ? `✓ ${webResults.length} Quellen gefunden` : "Keine Quellen gefunden";
  } catch { statusLine.textContent = "Suche fehlgeschlagen"; webResults = []; }

  const sysPrompt = localStorage.getItem("noir_sys") ||
    "Du bist NOIR, ein Assistent fuer Schueler. Es ist 2026.\n\nSCHREIBSTIL:\nSchreib so, wie ein normaler Mensch in einem Chat schreiben wuerde. Natuerlich, direkt und locker, aber nicht kuenstlich jugendlich. Verwende einfache Woerter, wenn sie ausreichen. Keine unnötig komplizierten Formulierungen, keine aufgeblasene Sprache. Variiere die Satzlaenge. Manche Saetze duerfen sehr kurz sein. Andere duerfen etwas laenger sein. Vermeide, dass mehrere Saetze gleich aufgebaut sind. Beginne nicht staendig mit \"Das\", \"Dies\", \"Es ist\" oder \"Dabei\". Verwende natuerliche Uebergaenge oder gar keine Uebergaenge, wenn einer nicht noetig ist. Wiederhole die Frage des Users nicht einfach am Anfang. Komm direkt zum Punkt. Keine kuenstlichen Einleitungen wie \"Gerne helfe ich dir dabei\", \"Natuerlich!\", \"Das ist eine interessante Frage\" oder \"Zusammenfassend\". Keine uebertrieben professionellen Formulierungen. Keine Werbesprache und kein kuenstlicher Enthusiasmus. Keine erfundenen persoenlichen Erfahrungen, Meinungen oder Erlebnisse. Verwende Umgangssprache nur dort, wo sie natuerlich passt. Nicht zwanghaft Slang einbauen. Kleine menschliche Unvollkommenheiten im Rhythmus sind okay. Der Text muss nicht wie ein perfekt bearbeiteter Aufsatz klingen. Schreibe nicht jede Antwort nach demselben Muster. Wenn eine direkte Antwort reicht, gib nur die direkte Antwort. Wenn eine Erklaerung noetig ist, erklaere sie so, wie du sie einem Freund erklaeren wuerdest. Keine Floskeln und kein Fuelltext.\n\nWICHTIG:\nVersuche nicht, einen KI-Detektor auszutricksen oder gezielt Erkennungssysteme zu umgehen. Dein Ziel ist natuerliche, glaubwuerdige und gut lesbare Sprache. Behalte Fakten und Bedeutung bei. Erfinde niemals Quellen oder Informationen. Wenn du etwas nicht weisst, sag es kurz und ehrlich. Schreibe nicht absichtlich Fehler ein, nur damit der Text menschlicher wirkt.\n\nSPRACHE:\nStandardmaessig Deutsch. Kein Eszett. Schreibe immer \"ss\" statt \"ß\". Kein Em-Dash. Verwende stattdessen Kommas oder Punkte. Nutze Schweizer Schreibweise, wenn passend. Der Nutzer darf aber auch Englisch oder eine andere Sprache verwenden. Antworte dann in derselben Sprache.\n\nANTWORTLAENGE:\nNormalerweise kurz und direkt. 3-6 Saetze sind ein guter Standard. Bei einfachen Fragen reichen 1-3 Saetze. Wenn die Aufgabe mehr Erklaerung braucht, darf die Antwort deutlich laenger werden. Opfere niemals wichtige Informationen nur wegen einer festen Satzanzahl.\n\nFORMAT:\nVerwende Markdown, wenn es die Antwort wirklich besser lesbar macht. Nutze Listen fuer mehrere Punkte. Nutze Code-Bloecke mit Sprach-Tags fuer Code. Nutze Tabellen nur, wenn sie einen echten Vorteil bringen. Vermeide unnoetige Ueberschriften. Quellen aus dem Web direkt im Text mit [1], [2] usw. markieren. Unter der Antwort eine Quellenliste mit Titel und URL ausgeben, wenn Webquellen verwendet wurden.\n\nAKTUALITAET:\nBei aktuellen Themen wie Nachrichten, Kursen, Wetter, Ereignissen, Preisen, Releases oder anderen zeitabhaengigen Informationen IMMER eine Websuche verwenden.\n\nQUALITAETSCHECK:\nBevor du antwortest, pruefe still: Klingt die Antwort wie normale menschliche Sprache? Sind Satzlaenge und Satzaufbau nicht staendig gleich? Gibt es unnoetige Floskeln oder Wiederholungen? Ist die Antwort so kurz wie moeglich, aber so lang wie noetig? Wuerde jemand diese Antwort tatsaechlich so schreiben oder sagen? Anstatt \"Grundsätzlich gilt: blabla\" sagst du \"Grundsätzlich gilt bla bla\" oder \"grundsätzlich gilt, bla bla\". Kommas nur setzen wo noetig. Wenn etwas kuenstlich oder ueberformuliert klingt, formuliere es einfacher.";

  const apiMessages = [{ role: "system", content: sysPrompt },
    ...c.messages.map(m => ({ role: m.role, content: m.content }))];

  const t0 = performance.now();
  let ttft = null, chunks = 0;

  function addChip(label, spinning) {
    const chip = document.createElement("span");
    chip.className = "tool-chip" + (spinning ? "" : " ok");
    const icon = document.createElement("span"); icon.className = "spin";
    chip.append(icon, document.createTextNode(label));
    traceEl.appendChild(chip);
    chatEl.scrollTop = chatEl.scrollHeight;
    return chip;
  }

  function renderThink(open) {
    if (!thinkAcc) { thinkWrap.innerHTML = ""; return; }
    thinkWrap.innerHTML = `<details class="think"${open ? " open" : ""}><summary>◦ Nachdenken…</summary><div class="think-body"></div></details>`;
    thinkWrap.querySelector(".think-body").textContent = thinkAcc;
  }

  // live progress clock while waiting for the first token
  const waitTimer = setInterval(() => {
    if (ttft !== null) { clearInterval(waitTimer); return; }
    const elapsed = ((performance.now() - t0) / 1000).toFixed(0);
    const tierLabel = modelTier === "fast" ? "⚡" : modelTier === "smart" ? "◈" : "◉";
    statusLine.textContent = `${tierLabel} Denke nach… ${elapsed}s`;
  }, 500);

  // Streaming with auto-retry on connection drop
  const MAX_STREAM_RETRY = 2;
  for (let attempt = 0; attempt <= MAX_STREAM_RETRY; attempt++) {
    try {
      const res = await fetch("/api/chat", {
        method: "POST", signal: aborter.signal,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chatModel: "auto", tier: modelTier, messages: apiMessages, images: imgsToSend, webResults })
      });
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = "";
      if (!acc) bodyEl.innerHTML = `<span class="cursor">▋</span>`;

      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        const lines = buf.split("\n");
        buf = lines.pop();
        for (const line of lines) {
          const s = line.trim();
          if (!s.startsWith("data:")) continue;
          const data = s.slice(5).trim();
          if (data === "[DONE]") continue;
          let j; try { j = JSON.parse(data); } catch { continue; }
          if (j.notice) { statusLine.textContent = j.notice; if (j.modelInfo) modelInfo = j.modelInfo; continue; }
          if (j.toolStatus) { addChip(j.toolStatus, true); statusLine.textContent = "🔧 " + j.toolStatus; continue; }
          if (j.toolDone) {
            const spinning = [...traceEl.querySelectorAll(".tool-chip:not(.ok)")];
            if (spinning.length) spinning[spinning.length - 1].classList.add("ok");
            continue;
          }
          if (j.fileCreated) {
            filesMade.push(j.fileCreated);
            const a = document.createElement("a");
            a.className = "file-chip";
            a.href = "/workspace/" + encodeURIComponent(j.fileCreated);
            a.target = "_blank";
            a.innerHTML = `▤ ${j.fileCreated} <span class="dl">HERUNTERLADEN</span>`;
            traceEl.appendChild(a);
            toast("Datei erstellt: " + j.fileCreated);
            continue;
          }
          if (j.error) {
            clearInterval(waitTimer);
            const errMsg = typeof j.error === "string" ? j.error : JSON.stringify(j.error);
            bodyEl.innerHTML = `<div class="err-box"><span>⚠ ${errMsg}</span><button class="retry-btn" onclick="retryLast()">Erneut versuchen</button></div>`;
            c.messages.push({ role: "assistant", content: "⚠ " + errMsg });
            saveConvs(); finishSend(); return;
          }
          if (j.notice && j.notice.includes("Wechsel zu")) {
            toast("🔄 " + j.notice);
            modelInfo = j.modelInfo || { label: j.notice.replace("Wechsel zu ", "") };
          }
          const think = j.choices?.[0]?.delta?.reasoning || "";
          if (think) {
            if (ttft === null) { ttft = ((performance.now() - t0) / 1000).toFixed(1); clearInterval(waitTimer); }
            thinkAcc += think;
            renderThink(true);
            chatEl.scrollTop = chatEl.scrollHeight;
          }
          const piece = j.choices?.[0]?.delta?.content || j.delta || "";
          if (piece) {
            if (ttft === null) { ttft = ((performance.now() - t0) / 1000).toFixed(1); clearInterval(waitTimer); }
            chunks++;
            acc += piece;
            renderThink(false);
            bodyEl.innerHTML = mdRender(streamSafe(acc)) + `<span class="cursor">▋</span>`;
            enhance(bodyEl);
            chatEl.scrollTop = chatEl.scrollHeight;
          }
        }
      }
      break; // success — exit retry loop
    } catch (e) {
      if (e.name === "AbortError") break;
      if (attempt < MAX_STREAM_RETRY && !acc) {
        statusLine.textContent = "Verbindung verloren — versuche erneut… (" + (attempt + 1) + "/" + MAX_STREAM_RETRY + ")";
        await new Promise(r => setTimeout(r, 1500));
        continue;
      }
      acc += (acc ? "\n\n" : "") + "⚠ Verbindung verloren: " + e.message;
    }
  }
  clearInterval(waitTimer);

  const total = ((performance.now() - t0) / 1000).toFixed(1);
  const tps = total > 0 ? Math.round(chunks / total) : 0;
  const stats = { tps, ttft: ttft || "0", total };
  const badge = $("#perfBadge");
  badge.textContent = `${tps} tok/s · ${ttft}s ttft`;
  badge.classList.remove("hidden");

  bodyEl.innerHTML = mdRender(acc); enhance(bodyEl);
  aiEl.parentElement.classList.remove("streaming");
  aiEl.appendChild(statsRow(stats));
  if (webResults?.length) aiEl.appendChild(sourcesBlock(webResults));
  const aiMsg = { role: "assistant", content: acc, thinking: thinkAcc, stats, sources: webResults, files: filesMade, tools: traceEl ? [...traceEl.querySelectorAll(".tool-chip")].map(ch => ch.textContent) : [], model: modelInfo };
  c.messages.push(aiMsg);
  saveConvs(); renderConvs(convSearch.value);
  addActions(aiEl, aiMsg);
  finishSend();
  if (autoRead && acc) speakText(acc);
  autoTitle(c);
}

/* ---------------- auto title ---------------- */
async function autoTitle(c) {
  if (!c || c.titled || c.messages.length < 2) return;
  c.titled = true;
  try {
    const r = await (await fetch("/api/title", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messages: c.messages.slice(0, 2), fallback: c.title })
    })).json();
    if (r.title) {
      c.title = r.title; saveConvs(); renderConvs(convSearch.value);
      if (currentId === c.id) titleEl.textContent = r.title;
    }
  } catch {}
}

function finishSend() {
  busy = false; sendBtn.classList.remove("stop"); sendBtn.innerHTML =
    `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"><path d="M12 19V5M5 12l7-7 7 7"/></svg>`;
  inputEl.focus();
}

function send() {
  const text = inputEl.value.trim();
  if ((!text && !pendingImgs.length && !pendingFiles.length) || busy) return;
  const imgs = pendingImgs, files = pendingFiles;
  lastSendText = text; lastSendImgs = [...imgs]; lastSendFiles = [...files];
  pendingImgs = []; pendingFiles = []; renderChips();
  inputEl.value = ""; localStorage.removeItem("noir_draft"); autosize();
  doSend(text, imgs, files);
}

function retryLast() {
  if (busy) return;
  const c = currentConv();
  if (c && c.messages.length && c.messages[c.messages.length - 1].role === "assistant") {
    c.messages.pop(); saveConvs(); renderChat();
  }
  doSend(lastSendText, lastSendImgs, lastSendFiles);
}

function regenerate() {
  const c = currentConv();
  if (!c || busy) return;
  while (c.messages.length && c.messages[c.messages.length - 1].role === "assistant") c.messages.pop();
  saveConvs(); renderChat();
  doSend("", [], []);
}

function editAndResend(originalText) {
  const c = currentConv();
  if (!c || busy) return;
  // Find the user message index and truncate from there
  const idx = c.messages.findIndex(m => m.role === "user" && m.content === originalText);
  if (idx === -1) return;
  c.messages = c.messages.slice(0, idx);
  saveConvs();
  inputEl.value = originalText;
  localStorage.setItem("noir_draft", originalText);
  autosize();
  inputEl.focus();
  renderChat();
  toast("Nachricht bearbeiten — Enter zum Neusenden");
}

/* ---------------- voice chat (MediaRecorder + Groq Whisper) ---------------- */
let mediaRecorder = null, audioChunks = [], recordingStart = 0, recTimer = null;
const voiceBtn = $("#voiceBtn");

function setVoiceStatus(text, type) {
  const sl = $("#voiceStatus");
  if (!sl) return;
  sl.textContent = text;
  sl.className = "voice-status" + (type ? " " + type : "");
  sl.style.display = text ? "" : "none";
}

function fmtRecTime() {
  const s = Math.floor((Date.now() - recordingStart) / 1000);
  return Math.floor(s / 60) + ":" + String(s % 60).padStart(2, "0");
}

async function startRecording() {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    // Find a supported mime type
    const mimeTypes = [
      "audio/webm;codecs=opus",
      "audio/webm",
      "audio/mp4",
      "audio/ogg;codecs=opus",
      "audio/wav",
    ];
    let chosenMime = "";
    for (const mt of mimeTypes) {
      if (MediaRecorder.isTypeSupported(mt)) { chosenMime = mt; break; }
    }
    mediaRecorder = new MediaRecorder(stream, chosenMime ? { mimeType: chosenMime } : {});
    audioChunks = [];

    mediaRecorder.ondataavailable = (e) => { if (e.data.size > 0) audioChunks.push(e.data); };

    mediaRecorder.onstop = async () => {
      stream.getTracks().forEach(t => t.stop());
      if (audioChunks.length === 0) { setVoiceStatus("", ""); return; }
      setVoiceStatus("Transkribiere…", "listening");
      voiceBtn.classList.add("processing");
      try {
        const ext = (mediaRecorder.mimeType || "").includes("mp4") ? "mp4"
          : (mediaRecorder.mimeType || "").includes("ogg") ? "ogg"
          : (mediaRecorder.mimeType || "").includes("wav") ? "wav" : "webm";
        const blob = new Blob(audioChunks, { type: mediaRecorder.mimeType || "audio/webm" });
        const resp = await fetch("/api/transcribe?fmt=" + ext, { method: "POST", body: blob });
        const data = await resp.json();
        if (data.text && data.text.trim()) {
          inputEl.value = (inputEl.value ? inputEl.value + " " : "") + data.text.trim();
          autosize();
          setVoiceStatus("✓ Erkannt — Enter zum Senden", "success");
          setTimeout(() => setVoiceStatus("", ""), 3000);
        } else {
          setVoiceStatus("Keine Sprache erkannt — versuche es nochmal", "error");
          setTimeout(() => setVoiceStatus("", ""), 3000);
        }
      } catch (e) {
        console.warn("Transcribe error:", e);
        setVoiceStatus("Transkription fehlgeschlagen", "error");
        setTimeout(() => setVoiceStatus("", ""), 3000);
      }
      voiceBtn.classList.remove("on", "listening", "processing");
    };

    mediaRecorder.start(250); // collect in 250ms chunks
    recordingStart = Date.now();
    voiceBtn.classList.add("on", "listening");
    setVoiceStatus("Aufnahme läuft… tippe zum Stoppen", "listening");

    // Update timer
    recTimer = setInterval(() => {
      if (voiceBtn.classList.contains("listening")) {
        setVoiceStatus("● " + fmtRecTime() + " — tippe zum Stoppen", "listening");
      }
    }, 1000);
  } catch (err) {
    console.warn("Mic error:", err);
    if (err.name === "NotAllowedError" || err.name === "PermissionDeniedError") {
      toast("Mikrofon-Zugriff verweigert. Erlaube den Zugriff in den Browsereinstellungen.");
      setVoiceStatus("Mikrofon blockiert", "error");
    } else if (err.name === "NotFoundError" || err.name === "DevicesNotFoundError") {
      toast("Kein Mikrofon gefunden.");
      setVoiceStatus("Kein Mikrofon erkannt", "error");
    } else {
      toast("Mikrofon-Fehler: " + err.message);
      setVoiceStatus("Mikrofon-Fehler", "error");
    }
  }
}

function stopRecording() {
  if (mediaRecorder && mediaRecorder.state !== "inactive") {
    mediaRecorder.stop();
  }
  clearInterval(recTimer);
}

voiceBtn.onclick = () => {
  if (mediaRecorder && mediaRecorder.state === "recording") {
    stopRecording();
  } else {
    startRecording();
  }
};

let autoRead = localStorage.getItem("noir_autoread") === "true";
let fontSize = parseInt(localStorage.getItem("noir_fontsize") || "15", 10);

function applyFontSize() {
  document.documentElement.style.setProperty("--chat-font", fontSize + "px");
  const val = $("#fontSizeVal"); if (val) val.textContent = fontSize;
}
applyFontSize();

/* ---------------- model tier dropdown (composer) ---------------- */
const TIERS = { fast: { icon: "⚡", label: "Schnell" }, balanced: { icon: "◉", label: "Balanciert" }, smart: { icon: "◈", label: "Schlau" }, deep: { icon: "◆", label: "Deep" } };
const tierMenu = $("#modelMenu"), tierLabel = $("#tierLabel"), tierIcon = $("#tierIcon"), pickerWrap = $("#modelPickerWrap");
function syncTierUI() {
  if (!tierLabel) return;
  tierLabel.textContent = TIERS[modelTier].label;
  tierIcon.textContent = TIERS[modelTier].icon;
  tierMenu.querySelectorAll(".menu-item").forEach(b => {
    b.querySelector(".check").textContent = b.dataset.tier === modelTier ? "✓" : "";
  });
}
if (pickerWrap) {
  $("#tierPick").onclick = (e) => { e.stopPropagation(); tierMenu.classList.toggle("hidden"); };
  document.addEventListener("click", (e) => {
    if (!tierMenu.classList.contains("hidden") && !pickerWrap.contains(e.target)) tierMenu.classList.add("hidden");
  });
  tierMenu.querySelectorAll(".menu-item").forEach(b => b.onclick = () => {
    modelTier = b.dataset.tier;
    localStorage.setItem("noir_tier", modelTier);
    syncTierUI();
    tierMenu.classList.add("hidden");
    toast(TIERS[modelTier].icon + " Modus: " + TIERS[modelTier].label);
  });
  syncTierUI();
}

/* ---------------- profile card (logged-in user) ---------------- */
const isStandalone = window.matchMedia("(display-mode: standalone)").matches || window.navigator.standalone === true;
if (isStandalone) document.body.classList.add("noir-standalone");

const NOIR_USERS = {
  "andi.selmani@stud.sek-ds.ch":       ["Andi",   "Owner",  "assets/andi.png"],
  "david.salgado@stud.sek-ds.ch":      ["David S.","Friend","assets/david.png"],
  "david.rosario@stud.sek-ds.ch":      ["David R.","Friend","assets/david.png"],
  "lisian.ademi@stud.sek-ds.ch":       ["Lisian", "Friend", "assets/lisian.png"],
  "matteo.retortillo@stud.sek-ds.ch":  ["Matteo", "Friend", "assets/matteo.png"],
};
function applyProfile() {
  try {
    const t = localStorage.getItem("noir_code") || "";
    if (!t.startsWith("noir1.")) return;
    const j = JSON.parse(atob(t.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")));
    const u = NOIR_USERS[(j.e || "").toLowerCase()];
    if (!u) return;
    const av = $("#profileAvatar"), nm = $("#profileName"), role = u[1] === "Owner" ? "Besitzer" : "Mitglied";
    if (av) av.src = u[2];
    if (nm) nm.textContent = u[0] + " · " + role;
  } catch {}
}

function speakText(text) {
  if (!("speechSynthesis" in window)) return;
  speechSynthesis.cancel();
  const clean = text.replace(/[`#*_>\[\]]/g, " ").replace(/\s+/g, " ").trim();
  const spoken = new SpeechSynthesisUtterance(clean.slice(0, 3000));
  // Nur lokale Stimmen verwenden — kein Cloud-TTS
  const voices = speechSynthesis.getVoices();
  const localVoice = voices.find(v => v.localService === true && v.lang.startsWith("de"))
    || voices.find(v => v.localService === true)
    || null;
  if (localVoice) spoken.voice = localVoice;
  spoken.lang = "de-DE";
  spoken.rate = 0.95;
  speechSynthesis.speak(spoken);
}

/* ---------------- misc ---------------- */
function autosize() { inputEl.style.height = "auto"; inputEl.style.height = Math.min(inputEl.scrollHeight, 200) + "px"; }

sendBtn.onclick = () => { if (busy) aborter?.abort(); else send(); };
inputEl.addEventListener("keydown", (e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } });
inputEl.addEventListener("input", () => { localStorage.setItem("noir_draft", inputEl.value); autosize(); });
$("#newChatBtn").onclick = () => { currentId = null; renderChat(); renderConvs(convSearch.value); inputEl.focus();
  if (window.innerWidth <= 700) closeSidebar(); };
$("#attachBtn").onclick = () => fileInput.click();
webBtn.onclick = () => { webOn = !webOn; webBtn.classList.toggle("on", webOn);
  statusLine.textContent = webOn ? "Web-Recherche aktiviert" : ""; };

let toastTimer;
function toast(msg) {
  let t = document.getElementById("toast");
  if (!t) { t = document.createElement("div"); t.id = "toast"; document.body.appendChild(t); }
  t.textContent = msg; t.classList.add("show");
  clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove("show"), 2200);
}

$("#exportBtn").onclick = () => {
  const c = currentConv();
  if (!c || !c.messages.length) return toast("Noch nichts zum Exportieren");
  let md = `# ${c.title}\n\n> Exportiert aus NOIR · ${new Date().toLocaleString()}\n\n`;
  for (const m of c.messages) md += (m.role === "user" ? "## Du\n\n" : "## NOIR\n\n") + m.content + "\n\n---\n\n";
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([md], { type: "text/markdown" }));
  a.download = (c.title || "chat").replace(/[^\w\- ]/g, "").trim().slice(0, 40) + ".md";
  a.click();
  toast("Als Markdown exportiert ✓");
};
function toggleSidebar() {
  const sb = $("#sidebar");
  const bd = $("#sidebarBackdrop");
  sb.classList.toggle("collapsed");
  if (window.innerWidth <= 700) {
    const open = !sb.classList.contains("collapsed");
    if (bd) bd.classList.toggle("hidden", !open);
  }
}
function closeSidebar() {
  const sb = $("#sidebar");
  const bd = $("#sidebarBackdrop");
  sb.classList.add("collapsed");
  if (bd) bd.classList.add("hidden");
}
$("#menuBtn").onclick = closeSidebar;
$("#menuBtn2").onclick = toggleSidebar;
const convSearch = $("#convSearch");
convSearch.addEventListener("input", () => renderConvs(convSearch.value));

/* ---------------- long-thread navigation ---------------- */
const jumpLatest = $("#jumpLatest");
function updateJumpLatest() {
  const farFromLatest = chatEl.scrollHeight - chatEl.scrollTop - chatEl.clientHeight > 180;
  jumpLatest.classList.toggle("hidden", !farFromLatest || isHero());
}
chatEl.addEventListener("scroll", updateJumpLatest, { passive: true });
jumpLatest.onclick = () => chatEl.scrollTo({ top: chatEl.scrollHeight, behavior: "smooth" });

/* ---------------- command palette ---------------- */
const commandModal = $("#commandModal"), commandInput = $("#commandInput"), commandResults = $("#commandResults");
function openCommand(trigger = document.activeElement) { lastModalTrigger = trigger; commandModal.classList.remove("hidden"); commandInput.value = ""; renderCommandResults(); setTimeout(() => commandInput.focus(), 0); }
function closeCommand() { commandModal.classList.add("hidden"); lastModalTrigger?.focus?.(); }
function renderCommandResults() {
  const query = commandInput.value.trim().toLowerCase();
  commandResults.innerHTML = "";
  if (!query) return;
  const matches = conversations.filter(c => c.title.toLowerCase().includes(query)).slice(-5).reverse();
  if (!matches.length) { commandResults.innerHTML = '<div class="command-empty">Keine Gespräche passen zu “' + commandInput.value.replace(/</g, "&lt;") + '”</div>'; return; }
  commandResults.innerHTML = '<div class="command-section">GESPRäCHE</div>';
  matches.forEach(c => {
    const b = document.createElement("button"); b.className = "command-item command-thread";
    const icon = document.createElement("span"); icon.className = "command-icon"; icon.textContent = "◌";
    const copy = document.createElement("span"); const name = document.createElement("strong"); const detail = document.createElement("small");
    name.textContent = c.title; detail.textContent = `${c.messages?.length || 0} Nachrichten`; copy.append(name, detail); b.append(icon, copy);
    b.onclick = () => { currentId = c.id; renderConvs(convSearch.value); renderChat(); closeCommand(); };
    commandResults.appendChild(b);
  });
}
function runCommand(command) {
  closeCommand();
  if (command === "new") { currentId = null; renderChat(); renderConvs(convSearch.value); inputEl.focus(); }
  if (command === "research") { if (!webOn) webBtn.click(); inputEl.focus(); }
  if (command === "deep") { modelTier = "deep"; localStorage.setItem("noir_tier", modelTier); syncTierUI(); toast("◆ Deep Mode aktiviert"); }
  if (command === "export") $("#exportBtn").click();
  if (command === "settings") $("#settingsBtn").click();
}
$("#commandBtn").onclick = openCommand;
commandInput.addEventListener("input", renderCommandResults);
commandModal.addEventListener("click", e => { if (e.target === commandModal) closeCommand(); });
commandModal.querySelectorAll("[data-command]").forEach(b => b.onclick = () => runCommand(b.dataset.command));
commandInput.addEventListener("keydown", e => {
  const choices = [...commandModal.querySelectorAll(".command-item")];
  if (!choices.length) return;
  if (e.key === "ArrowDown" || e.key === "ArrowUp") { e.preventDefault(); const i = choices.indexOf(document.activeElement); choices[(i + (e.key === "ArrowDown" ? 1 : choices.length - 1)) % choices.length].focus(); }
  if (e.key === "Enter" && choices.length) { e.preventDefault(); choices[0].click(); }
});
document.addEventListener("keydown", e => {
  const meta = e.metaKey || e.ctrlKey;
  if (meta && e.key.toLowerCase() === "k") { e.preventDefault(); commandModal.classList.contains("hidden") ? openCommand(document.activeElement) : closeCommand(); }
  if (meta && e.key.toLowerCase() === "n") { e.preventDefault(); runCommand("new"); }
  if (meta && e.key.toLowerCase() === "r") { e.preventDefault(); runCommand("research"); }
  if (meta && e.key.toLowerCase() === "d") { e.preventDefault(); runCommand("deep"); }
  if (meta && e.key.toLowerCase() === "e") { e.preventDefault(); runCommand("export"); }
  if (meta && e.key === ",") { e.preventDefault(); $("#settingsBtn").click(); }
  if (meta && e.key === "/") { e.preventDefault(); inputEl.focus(); }
  if (e.key === "Escape" && !commandModal.classList.contains("hidden")) closeCommand();
});

/* settings */
const modal = $("#settingsModal");
$("#settingsBtn").onclick = async () => {
  lastModalTrigger = document.activeElement;
  $("#keyInput").value = "";
  $("#sysInput").value = localStorage.getItem("noir_sys") || "";
  $("#settAutoRead").checked = localStorage.getItem("noir_autoread") === "true";
  $("#settWebOn").checked = localStorage.getItem("noir_web_default") === "true";
  $("#fontSizeRange").value = fontSize;
  $("#fontSizeVal").textContent = fontSize;
  $("#settAgentOn").checked = localStorage.getItem("noir_agent_default") === "true";
  const cfg = await (await fetch("/api/config")).json();
  if (cfg.hasKey) $("#keyInput").placeholder = "Gespeichert — leer lassen zum Behalten";
  modal.classList.remove("hidden");
  setTimeout(() => $("#keyInput").focus(), 0);
};
function closeSettings() { modal.classList.add("hidden"); lastModalTrigger?.focus?.(); }
$("#closeSettings").onclick = closeSettings;
$("#closeSettingsX").onclick = closeSettings;
modal.addEventListener("click", e => { if (e.target === modal) closeSettings(); });
$("#saveSettings").onclick = async () => {
  const key = $("#keyInput").value.trim();
  const providerKeys = {};
  for (const [id, name] of [["keyGroq","groq"],["keyGemini","gemini"],["keyCerebras","cerebras"]]) {
    const v = $("#" + id).value.trim();
    if (v) providerKeys[name] = v;
  }
  if (key || Object.keys(providerKeys).length) {
    const payload = { providerKeys };
    if (key) payload.openrouterKey = key;
    const gcid = $("#keyGoogleClient") ? $("#keyGoogleClient").value.trim() : "";
    if (gcid) payload.googleClientId = gcid;
    await fetch("/api/config", { method: "PUT", headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload) });
    toast("Gespeichert ✓");
  }
  localStorage.setItem("noir_sys", $("#sysInput").value.trim());
  localStorage.setItem("noir_autoread", $("#settAutoRead").checked ? "true" : "false");
  localStorage.setItem("noir_web_default", $("#settWebOn").checked ? "true" : "false");
  localStorage.setItem("noir_fontsize", $("#fontSizeRange").value);
  fontSize = parseInt($("#fontSizeRange").value, 10);
  applyFontSize();
  localStorage.setItem("noir_agent_default", $("#settAgentOn").checked ? "true" : "false");
  autoRead = $("#settAutoRead").checked;
  if ($("#settWebOn").checked && !webOn) { webOn = true; webBtn.classList.add("on"); }
  if ($("#settAgentOn") && $("#settAgentOn").checked) { webOn = true; webBtn.classList.add("on"); }
  closeSettings(); loadModels();
};

/* Keep custom modals keyboard-complete: focus stays inside and Escape always restores flow. */
function trapFocus(e, overlay) {
  if (overlay.classList.contains("hidden") || e.key !== "Tab") return;
  const nodes = [...overlay.querySelectorAll('button:not([disabled]), input:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])')]
    .filter(node => node.offsetParent !== null);
  if (!nodes.length) return;
  const first = nodes[0], last = nodes[nodes.length - 1];
  if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
  else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
}
document.addEventListener("keydown", e => {
  trapFocus(e, commandModal); trapFocus(e, modal);
  if (e.key === "Escape" && !modal.classList.contains("hidden")) { e.preventDefault(); closeSettings(); }
});

/* Initialize only after the server-approved access session exists. */
function initNoir() {
  window.addEventListener("noir:splashDone", () => inputEl.focus(), { once: true });
  setTimeout(() => { const s = document.getElementById("splash"); if (s) s.style.display = "none"; }, 8000);
  inputEl.value = localStorage.getItem("noir_draft") || ""; autosize();
  autoRead = localStorage.getItem("noir_autoread") === "true";
  if (localStorage.getItem("noir_web_default") === "true") { webOn = true; webBtn.classList.add("on"); statusLine.textContent = "Web-Recherche aktiviert"; }
  if (localStorage.getItem("noir_agent_default") === "true") { webOn = true; webBtn.classList.add("on"); statusLine.textContent = "Web-Recherche aktiviert"; }
  loadModels().then(renderChat).catch(() => toast("Lokaler Modelldienst nicht erreichbar"));
  renderConvs();
  applyProfile();
  if (window.innerWidth <= 700) closeSidebar();
}
if (window.noirAccessGranted) initNoir();
else window.addEventListener("noir:accessGranted", initNoir, { once: true });
