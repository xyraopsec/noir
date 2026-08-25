/* NOIR access gate — Google sign-in (allowlist) with access-code fallback. Stateless. */
(function () {
  const gate = document.getElementById("accessGate");
  const googleWrap = document.getElementById("googleBtnWrap");
  const googleMsg = document.getElementById("googleMsg");
  const codeToggle = document.getElementById("codeToggle");
  const form = document.getElementById("accessForm");
  const input = document.getElementById("accessCode");
  const error = document.getElementById("accessError");

  // attach the credential to every API/workspace call
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
  }

  /* ---- google flow ---- */
  let clientId = "";
  origFetch("/api/auth/config").then(r => r.json()).then(c => {
    clientId = c.clientId || "";
    if (!clientId) {
      googleMsg.textContent = "google sign-in not configured yet — owner must add the client id in settings";
      return;
    }
    if (!window.google || !window.google.accounts) {
      // gsi script blocked or not loaded yet
      googleMsg.textContent = "google sign-in unavailable here — use the access code";
      return;
    }
    window.google.accounts.id.initialize({
      client_id: clientId,
      callback: async (resp) => {
        googleMsg.textContent = "verifying…";
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
            googleMsg.textContent = j.error || "sign-in rejected";
          }
        } catch { googleMsg.textContent = "could not reach the server"; }
      }
    });
    window.google.accounts.id.renderButton(document.getElementById("googleBtn"), {
      theme: "filled_black", size: "large", shape: "pill", text: "signin_with", width: 260
    });
  }).catch(() => { googleMsg.textContent = "server unreachable"; });

  /* ---- code fallback ---- */
  codeToggle.onclick = () => {
    form.classList.toggle("hidden");
    codeToggle.textContent = form.classList.contains("hidden") ? "use access code instead" : "use google sign-in instead";
    if (!form.classList.contains("hidden")) input.focus();
  };

  const formatCode = value => { const c = value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 6); return c.length > 3 ? c.slice(0, 3) + "-" + c.slice(3) : c; };
  input.addEventListener("input", () => { input.value = formatCode(input.value); error.textContent = ""; });

  async function verifyCode(code, silent) {
    try {
      const r = await origFetch("/api/access", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ code }) });
      if (r.ok) { localStorage.setItem("noir_code", code); grant(); return true; }
      localStorage.removeItem("noir_code");
      if (!silent) { error.textContent = "That code is not recognized."; input.select(); }
    } catch {
      if (!silent) error.textContent = "Unable to reach the server.";
    }
    return false;
  }

  const stored = localStorage.getItem("noir_code") || "";
  if (stored && !stored.startsWith("noir1.")) verifyCode(stored, true);
  else if (stored) {
    // trust stored google token locally; server re-validates on every call
    grant();
  }
  else setTimeout(() => { try { input.focus(); } catch {} }, 150);

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const code = input.value.trim();
    if (!/^[A-Z0-9]{3}-[A-Z0-9]{3}$/.test(code)) { error.textContent = "Use the XXX-XXX format."; input.focus(); return; }
    const button = form.querySelector("button"); button.disabled = true; button.textContent = "…";
    const ok = await verifyCode(code, false);
    if (!ok) input.select();
    button.disabled = false; button.textContent = "→";
  });
})();
