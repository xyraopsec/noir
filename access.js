/* NOIR access gate — Google-Anmeldung (Allowlist) mit Zugangscode-Fallback. Stateless. */
(function () {
  const gate = document.getElementById("accessGate");
  const googleWrap = document.getElementById("googleBtnWrap");
  const googleMsg = document.getElementById("googleMsg");
  const codeToggle = document.getElementById("codeToggle");
  const form = document.getElementById("accessForm");
  const input = document.getElementById("accessCode");
  const error = document.getElementById("accessError");

  const origFetch = window.fetch.bind(window);
  window.fetch = (url, opts = {}) => {
    const u = String(url);
    if (u.startsWith("/api/") || u.startsWith("/workspace")) {
      opts.headers = Object.assign({}, opts.headers, { "X-Noir-Code": localStorage.getItem("noir_code") || "" });
    }
    return origFetch(url, opts);
  };

  function grant() {
    window.noirAccessGranted = true;
    document.body.classList.add("access-granted");
    gate.setAttribute("aria-hidden", "true");
    if (typeof window.showWelcome === "function") {
      window.showWelcome(function () {
        window.dispatchEvent(new Event("noir:accessGranted"));
      });
    } else {
      window.dispatchEvent(new Event("noir:accessGranted"));
    }
  }

  /* ---- Google-Fluss ---- */
  let clientId = "";
  origFetch("/api/auth/config").then(r => r.json()).then(c => {
    clientId = c.clientId || "";
    if (!clientId) {
      googleMsg.textContent = "Google-Anmeldung nicht konfiguriert — Inhaber muss die Client-ID in den Einstellungen eintragen";
      return;
    }
    if (!window.google || !window.google.accounts) {
      googleMsg.textContent = "Google-Anmeldung hier nicht verfügbar — Zugangscode verwenden";
      return;
    }
    window.google.accounts.id.initialize({
      client_id: clientId,
      callback: async (resp) => {
        googleMsg.textContent = "Überprüfung…";
        try {
          const r = await origFetch("/api/auth/google", {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ credential: resp.credential })
          });
          const j = await r.json();
          if (r.ok && j.ok) {
            localStorage.setItem("noir_code", j.token);
            grant();
          } else {
            googleMsg.textContent = j.error || "Anmeldung abgelehnt";
          }
        } catch { googleMsg.textContent = "Server nicht erreichbar"; }
      }
    });
    window.google.accounts.id.renderButton(document.getElementById("googleBtn"), {
      theme: "filled_black", size: "large", shape: "pill", text: "signin_with", width: 260
    });
  }).catch(() => { googleMsg.textContent = "Server nicht erreichbar"; });

  /* ---- Code-Fallback ---- */
  codeToggle.onclick = () => {
    form.classList.toggle("hidden");
    codeToggle.textContent = form.classList.contains("hidden") ? "Zugangscode verwenden" : "Google-Anmeldung verwenden";
    if (!form.classList.contains("hidden")) input.focus();
  };

  const formatCode = value => { const c = value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 6); return c.length > 3 ? c.slice(0, 3) + "-" + c.slice(3) : c; };
  input.addEventListener("input", () => { input.value = formatCode(input.value); error.textContent = ""; });

  async function verifyCode(code, silent) {
    try {
      const r = await origFetch("/api/access", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ code }) });
      if (r.ok) { localStorage.setItem("noir_code", code); grant(); return true; }
      localStorage.removeItem("noir_code");
      if (!silent) { error.textContent = "Dieser Code ist nicht bekannt."; input.select(); }
    } catch {
      if (!silent) error.textContent = "Server nicht erreichbar.";
    }
    return false;
  }

  const stored = localStorage.getItem("noir_code") || "";
  if (stored && !stored.startsWith("noir1.")) verifyCode(stored, true);
  else if (stored) {
    grant();
  }
  else setTimeout(() => { try { input.focus(); } catch {} }, 150);

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const code = input.value.trim();
    if (!/^[A-Z0-9]{3}-[A-Z0-9]{3}$/.test(code)) { error.textContent = "Format: XXX-XXX"; input.focus(); return; }
    const button = form.querySelector("button"); button.disabled = true; button.textContent = "…";
    const ok = await verifyCode(code, false);
    if (!ok) input.select();
    button.disabled = false; button.textContent = "→";
  });
})();
