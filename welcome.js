/* NOIR Willkommens-Animation — personalisierte Begrüßung nach dem Login */
(function () {
  const overlay = document.getElementById("welcomeOverlay");
  const nameEl = document.getElementById("welcomeName");
  const avatarEl = document.getElementById("welcomeAvatar");
  const particlesEl = document.getElementById("welcomeParticles");

  const USERS = {
    "andi.selmani@stud.sek-ds.ch":    { name: "Andi",    avatar: "assets/andi.png" },
    "david.salgado@stud.sek-ds.ch":  { name: "David",   avatar: "assets/david.png" },
    "david.rosario@stud.sek-ds.ch":  { name: "David",   avatar: "assets/david.png" },
    "lisian.ademi@stud.sek-ds.ch":   { name: "Lisian",  avatar: "assets/lisian.png" },
    "matteo.retortillo@stud.sek-ds.ch": { name: "Matteo", avatar: "assets/matteo.png" },
  };

  function spawnParticles() {
    for (let i = 0; i < 18; i++) {
      const p = document.createElement("div");
      p.className = "welcome-particle";
      p.style.left = Math.random() * 100 + "%";
      p.style.bottom = "-4px";
      p.style.animationDuration = (3 + Math.random() * 4) + "s";
      p.style.animationDelay = (Math.random() * 2) + "s";
      p.style.width = p.style.height = (1 + Math.random() * 2) + "px";
      particlesEl.appendChild(p);
    }
  }

  function decodeEmail() {
    try {
      const token = localStorage.getItem("noir_code") || "";
      if (!token.startsWith("noir1.")) return null;
      const payload = token.split(".")[1];
      const json = JSON.parse(atob(payload.replace(/-/g, "+").replace(/_/g, "/")));
      return (json.e || "").toLowerCase();
    } catch { return null; }
  }

  function showNoirSplash(onDone) {
    const splash = document.getElementById("splash");
    if (!splash) { onDone(); return; }
    splash.classList.remove("done");
    splash.style.display = "";
    splash.style.opacity = "";
    splash.style.pointerEvents = "";
    const stage = document.getElementById("splashStage");
    if (stage) stage.style.transform = "";
    const letters = splash.querySelectorAll(".sl");
    letters.forEach(l => { l.style.animation = "none"; l.offsetHeight; l.style.animation = ""; });
    const line = document.getElementById("splashLine");
    if (line) { line.style.animation = "none"; line.offsetHeight; line.style.animation = ""; }
    const tag = document.getElementById("splashTag");
    if (tag) { tag.style.animation = "none"; tag.offsetHeight; tag.style.animation = ""; }
    setTimeout(() => {
      splash.classList.add("done");
      setTimeout(() => { splash.style.display = "none"; onDone(); }, 900);
    }, 2800);
  }

  window.showWelcome = function (onDone) {
    const email = decodeEmail();
    const user = USERS[email] || { name: "Gast", avatar: "assets/avatar.jpg" };

    avatarEl.src = user.avatar;
    nameEl.textContent = "Willkommen, " + user.name + "!";
    overlay.classList.remove("hidden", "exiting");
    overlay.classList.add("visible");
    overlay.setAttribute("aria-hidden", "false");
    spawnParticles();

    setTimeout(function () {
      overlay.classList.add("exiting");
      setTimeout(function () {
        overlay.classList.remove("visible", "exiting");
        overlay.classList.add("hidden");
        overlay.setAttribute("aria-hidden", "true");
        particlesEl.innerHTML = "";
        showNoirSplash(onDone || function () {});
      }, 700);
    }, 2800);
  };
})();
