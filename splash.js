/* NOIR splash v3 — luxury text reveal + refined synth score */
(function () {
  const splash = document.getElementById("splash");
  if (!splash) return;
  let done = false;

  const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (reduced) return finish(200);

  /* ---------------- refined synth score ---------------- */
  let actx = null, master = null, soundOn = true, unlocked = false;
  function audio() {
    if (actx || !soundOn) return actx;
    try { actx = new (window.AudioContext || window.webkitAudioContext)(); } catch { return null; }
    master = actx.createGain(); master.gain.value = 0; master.connect(actx.destination);
    // warm low drone
    const lp = actx.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = 200;
    const dg = actx.createGain(); dg.gain.value = 0.14;
    [55, 55.6, 110.4].forEach((f, i) => {
      const o = actx.createOscillator(); o.type = i === 2 ? "sine" : "triangle";
      o.frequency.value = f; o.detune.value = i * 3; o.connect(lp); o.start();
    });
    lp.connect(dg); dg.connect(master);
    return actx;
  }
  function unlock() {
    if (unlocked) return; unlocked = true;
    const c = audio(); if (!c) return;
    c.resume().then(() => {
      master.gain.linearRampToValueAtTime(0.5, c.currentTime + 1.4);
      // if letters still ahead, play their pings; otherwise just drone
      const t = performance.now() - T0;
      const notes = [659.25, 830.61, 987.77, 1318.5];
      notes.forEach((f, i) => {
        const at = 500 + i * 170;
        if (t < at) setTimeout(() => ping(f), at - t);
      });
      if (t < 1600) setTimeout(() => swish(), 1600 - t);
    });
  }
  function ping(freq) {
    if (!actx || !soundOn) return;
    const t = actx.currentTime;
    const g = actx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.11, t + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 1.1);
    const o = actx.createOscillator(); o.type = "sine"; o.frequency.value = freq;
    const o2 = actx.createOscillator(); o2.type = "sine"; o2.frequency.value = freq * 2.01;
    const g2 = actx.createGain(); g2.gain.value = 0.25;
    o.connect(g); o2.connect(g2); g2.connect(g); g.connect(master);
    o.start(t); o2.start(t); o.stop(t + 1.15); o2.stop(t + 1.15);
  }
  function swish() {
    if (!actx || !soundOn) return;
    const t = actx.currentTime;
    const b = actx.createBuffer(1, actx.sampleRate, actx.sampleRate);
    const d = b.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    const s = actx.createBufferSource(); s.buffer = b;
    const bp = actx.createBiquadFilter(); bp.type = "bandpass"; bp.Q.value = 3;
    bp.frequency.setValueAtTime(500, t); bp.frequency.exponentialRampToValueAtTime(1600, t + 0.5);
    const g = actx.createGain(); g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.07, t + 0.15);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.6);
    s.connect(bp); bp.connect(g); g.connect(master); s.start(t); s.stop(t + 0.65);
  }
  addEventListener("pointerdown", unlock);

  const muteBtn = document.getElementById("splashMute");
  muteBtn.onclick = (e) => {
    e.stopPropagation(); soundOn = !soundOn;
    document.getElementById("sndOn").style.display = soundOn ? "" : "none";
    document.getElementById("sndOff").style.display = soundOn ? "none" : "";
    if (soundOn) { unlocked = false; unlock(); }
    else if (master) master.gain.linearRampToValueAtTime(0, actx.currentTime + 0.25);
  };

  /* ---------------- timeline ---------------- */
  const T0 = performance.now();
  const T_EXIT = 3950, T_REMOVE = 4800;

  setTimeout(() => { if (!done) { splash.classList.add("done"); } }, T_EXIT);
  setTimeout(() => finish(0), T_REMOVE);
  if (actx) master.gain.linearRampToValueAtTime(0, actx.currentTime + 0.9);

  document.getElementById("splashSkip").onclick = (e) => { e.stopPropagation(); finish(400); };

  function finish(fadeMs) {
    if (done) return; done = true;
    if (master && actx) master.gain.linearRampToValueAtTime(0, actx.currentTime + 0.6);
    splash.classList.add("done");
    setTimeout(() => splash.remove(), Math.max(fadeMs, 100) + 850);
    window.dispatchEvent(new Event("noir:splashDone"));
  }
})();
