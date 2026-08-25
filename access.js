/* NOIR access gate — Google-Anmeldung (Allowlist). Stateless. */
(function () {
  const gate = document.getElementById("accessGate");
  const googleMsg = document.getElementById("googleMsg");

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
    window.dispatchEvent(new Event("noir:accessGranted"));
    if (typeof window.showWelcome === "function") {
      window.showWelcome(function () {});
    }
  }

  /* ---- Google-Fluss ---- */
  let clientId = "";
  origFetch("/api/auth/config").then(r => r.json()).then(c => {
    clientId = c.clientId || "";
    if (!clientId) {
      googleMsg.textContent = "Google-Anmeldung nicht konfiguriert";
      return;
    }
    if (!window.google || !window.google.accounts) {
      googleMsg.textContent = "Google-Anmeldung nicht verfügbar";
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
      theme: "filled_black", size: "large", shape: "pill", text: "signin_with", width: 280
    });
  }).catch(() => { googleMsg.textContent = "Server nicht erreichbar"; });

  /* Auto-login */
  const stored = localStorage.getItem("noir_code") || "";
  if (stored && !stored.startsWith("noir1.")) {
    origFetch("/api/access", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ code: stored }) })
      .then(r => { if (r.ok) grant(); });
  } else if (stored) {
    grant();
  }
})();
