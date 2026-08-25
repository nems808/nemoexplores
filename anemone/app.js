/* ---------------------------------------------------------------------------
   ANEMONE explainer.

   Two kinds of computation live here:

   1. LIVE — the bathtub, the two-box exchange, and the seawater carbonate
      system. These are cheap enough to recompute while a slider is moving.
      The carbonate system is the real thing: carbonate.js is a direct port of
      carbonate.py, agreeing to ~1e-12.

   2. PRECOMPUTED — every airborne-fraction curve. Those come from integrating
      a stiff 8-state system across a million years, which belongs in Python.
      data/anemone-runs.json is written by data/export.py running against
      model.py, so the numbers on this page cannot drift from the model.
--------------------------------------------------------------------------- */

import { eqConstants, speciate, revelle } from "./carbonate.js";

const $ = (s) => document.querySelector(s);
const clamp = (v, a, b) => Math.min(Math.max(v, a), b);
const C = {
  ink: "#f3eedf", muted: "#aaa99f", dim: "#7d8078", line: "#ffffff1c",
  green: "#a5d66f", amber: "#f2b84b", coral: "#ef715e", ice: "#d9edf2",
  violet: "#c8a6f0", panel: "#0b0f0d",
};
const MONO = '"DM Mono", ui-monospace, monospace';

/* ------------------------------------------------------------------ canvas */

/** Size a canvas to its CSS box at device resolution. Returns {ctx,w,h}. */
function fit(canvas, cssHeight) {
  const dpr = window.devicePixelRatio || 1;
  const w = canvas.clientWidth || 600;
  const h = cssHeight ?? canvas.height;
  canvas.width = Math.round(w * dpr);
  canvas.height = Math.round(h * dpr);
  canvas.style.height = h + "px";
  const ctx = canvas.getContext("2d");
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);
  return { ctx, w, h };
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function label(ctx, text, x, y, { size = 11, color = C.dim, align = "left", font = MONO } = {}) {
  ctx.font = `${size}px ${font}`;
  ctx.fillStyle = color;
  ctx.textAlign = align;
  ctx.textBaseline = "middle";
  ctx.fillText(text, x, y);
}

/** Re-run a draw function on resize, debounced. */
const redraws = [];
function onResize(fn) { redraws.push(fn); fn(); }
let rt;
window.addEventListener("resize", () => {
  clearTimeout(rt);
  rt = setTimeout(() => redraws.forEach((f) => f()), 150);
});

/* ------------------------------------------------- 01. one box, animated */

function oneBox() {
  const cv = $("#c-onebox");
  if (!cv) return;
  let particles = [];
  let last = 0;

  const draw = (t) => {
    const { ctx, w, h } = fit(cv, 240);
    const bw = Math.min(300, w * 0.42), bh = 110;
    const bx = (w - bw) / 2, by = (h - bh) / 2;

    // the box
    ctx.strokeStyle = C.line;
    ctx.fillStyle = "#12181499";
    ctx.lineWidth = 1;
    roundRect(ctx, bx, by, bw, bh, 10);
    ctx.fill(); ctx.stroke();
    label(ctx, "THE BOX", bx + bw / 2, by + bh / 2 - 10, { align: "center", color: C.muted, size: 11 });
    label(ctx, "one number", bx + bw / 2, by + bh / 2 + 10, { align: "center", color: C.dim, size: 10 });

    // arrows
    ctx.strokeStyle = C.green; ctx.lineWidth = 1.2;
    ctx.beginPath(); ctx.moveTo(20, h / 2); ctx.lineTo(bx - 8, h / 2); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(bx + bw + 8, h / 2); ctx.lineTo(w - 20, h / 2); ctx.stroke();
    label(ctx, "IN", 20, h / 2 - 18, { color: C.green });
    label(ctx, "OUT", w - 20, h / 2 - 18, { color: C.amber, align: "right" });

    // flowing particles
    if (t - last > 260) { particles.push({ x: 20, born: t }); last = t; }
    particles = particles.filter((p) => p.x < w - 18);
    for (const p of particles) {
      p.x += 1.15;
      const inBox = p.x > bx && p.x < bx + bw;
      ctx.beginPath();
      ctx.arc(p.x, h / 2 + (inBox ? Math.sin(p.x * 0.09) * 16 : 0), 3, 0, Math.PI * 2);
      ctx.fillStyle = p.x > bx + bw ? C.amber : C.green;
      ctx.globalAlpha = inBox ? 0.55 : 0.95;
      ctx.fill();
      ctx.globalAlpha = 1;
    }
  };

  let raf;
  const loop = (t) => { draw(t); raf = requestAnimationFrame(loop); };
  const io = new IntersectionObserver(([e]) => {
    if (e.isIntersecting) { if (!raf) raf = requestAnimationFrame(loop); }
    else { cancelAnimationFrame(raf); raf = null; }
  }, { threshold: 0.1 });
  io.observe(cv);
  redraws.push(() => draw(performance.now()));
}

/* ------------------------------------------------------- 02. bathtub, live */

function bathtub() {
  const cv = $("#c-bathtub");
  if (!cv) return;
  const state = { fin: 10, tau: 20, pulse: 0 };

  /** N(t) for a step input plus an optional pulse, both analytic. */
  const series = () => {
    const { fin, tau, pulse } = state;
    const eq = fin * tau;
    const pts = [];
    for (let i = 0; i <= 240; i++) {
      const t = (i / 240) * 200;
      let n = eq * (1 - Math.exp(-t / tau));
      if (pulse > 0 && t > 100) n += pulse * Math.exp(-(t - 100) / tau);
      pts.push([t, n]);
    }
    return { pts, eq };
  };

  const draw = () => {
    const { ctx, w, h } = fit(cv, 260);
    const P = { l: 52, r: 16, t: 18, b: 34 };
    const iw = w - P.l - P.r, ih = h - P.t - P.b;
    const { pts, eq } = series();
    const ymax = Math.max(eq * 1.5, 300);
    const X = (t) => P.l + (t / 200) * iw;
    const Y = (n) => P.t + ih - (n / ymax) * ih;

    // grid
    ctx.strokeStyle = C.line; ctx.lineWidth = 1;
    for (let i = 0; i <= 4; i++) {
      const y = P.t + (ih / 4) * i;
      ctx.beginPath(); ctx.moveTo(P.l, y); ctx.lineTo(w - P.r, y); ctx.stroke();
      label(ctx, Math.round(ymax * (1 - i / 4)), P.l - 8, y, { align: "right", size: 10 });
    }
    label(ctx, "years →", w - P.r, h - 12, { align: "right", size: 10 });

    // equilibrium
    ctx.setLineDash([4, 4]); ctx.strokeStyle = C.amber; ctx.globalAlpha = 0.75;
    ctx.beginPath(); ctx.moveTo(P.l, Y(eq)); ctx.lineTo(w - P.r, Y(eq)); ctx.stroke();
    ctx.setLineDash([]); ctx.globalAlpha = 1;
    label(ctx, `settles at F×τ = ${Math.round(eq)}`, w - P.r - 6, Y(eq) - 12, { align: "right", color: C.amber, size: 10 });

    // curve
    ctx.strokeStyle = C.green; ctx.lineWidth = 2; ctx.beginPath();
    pts.forEach(([t, n], i) => (i ? ctx.lineTo(X(t), Y(n)) : ctx.moveTo(X(t), Y(n))));
    ctx.stroke();
  };

  const sync = () => {
    $("#o-bfin").textContent = state.fin;
    $("#o-btau").textContent = state.tau;
    draw();
  };
  $("#r-bfin").addEventListener("input", (e) => { state.fin = +e.target.value; sync(); });
  $("#r-btau").addEventListener("input", (e) => { state.tau = +e.target.value; sync(); });
  $("#b-bpulse").addEventListener("click", () => {
    state.pulse = state.pulse > 0 ? 0 : state.fin * state.tau * 0.6;
    $("#b-bpulse").textContent = state.pulse > 0 ? "Remove pulse" : "Add a pulse";
    draw();
  });
  onResize(sync);
}

/* ------------------------------------------------- 03. two boxes, animated */

function twoBox() {
  const cv = $("#c-twobox");
  if (!cv) return;

  const draw = (t) => {
    const { ctx, w, h } = fit(cv, 300);
    const bw = Math.min(340, w * 0.62), bh = 84;
    const bx = (w - bw) / 2;
    const y1 = 26, y2 = h - bh - 40;

    const box = (y, title, sub, tone) => {
      ctx.strokeStyle = C.line; ctx.fillStyle = "#12181499"; ctx.lineWidth = 1;
      roundRect(ctx, bx, y, bw, bh, 10); ctx.fill(); ctx.stroke();
      label(ctx, title, bx + 18, y + bh / 2 - 9, { color: tone, size: 12 });
      label(ctx, sub, bx + 18, y + bh / 2 + 11, { color: C.dim, size: 10 });
    };
    box(y1, "ATMOSPHERE", "596 GtC at 280 ppm", C.ice);
    box(y2, "SURFACE OCEAN", "carbon as dissolved gas and ions", C.green);

    // two-way exchange: gross fluxes both directions, net is the difference
    const cx = bx + bw / 2;
    const gap = [y1 + bh, y2];
    ctx.strokeStyle = C.line; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(cx - 40, gap[0]); ctx.lineTo(cx - 40, gap[1]); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(cx + 40, gap[0]); ctx.lineTo(cx + 40, gap[1]); ctx.stroke();

    const span = gap[1] - gap[0];
    for (let i = 0; i < 5; i++) {
      const ph = ((t / 2600) + i / 5) % 1;
      // downward (dissolving) is slightly denser: this is a net uptake picture
      ctx.beginPath();
      ctx.arc(cx - 40, gap[0] + ph * span, 3, 0, Math.PI * 2);
      ctx.fillStyle = C.green; ctx.globalAlpha = 0.85; ctx.fill();
      ctx.beginPath();
      ctx.arc(cx + 40, gap[1] - ((ph + 0.5) % 1) * span, 2.4, 0, Math.PI * 2);
      ctx.fillStyle = C.amber; ctx.globalAlpha = 0.5; ctx.fill();
      ctx.globalAlpha = 1;
    }
    label(ctx, "dissolving", cx - 52, gap[0] + span / 2, { align: "right", color: C.green, size: 10 });
    label(ctx, "outgassing", cx + 52, gap[0] + span / 2, { color: C.amber, size: 10 });
    label(ctx, "net flux = the difference between them",
          w / 2, h - 14, { align: "center", color: C.dim, size: 10 });
  };

  let raf;
  const loop = (t) => { draw(t); raf = requestAnimationFrame(loop); };
  const io = new IntersectionObserver(([e]) => {
    if (e.isIntersecting) { if (!raf) raf = requestAnimationFrame(loop); }
    else { cancelAnimationFrame(raf); raf = null; }
  }, { threshold: 0.1 });
  io.observe(cv);
  redraws.push(() => draw(performance.now()));
}

/* ------------------------------------------- 05. carbonate system, live */

function chemLab() {
  const cv = $("#c-chem");
  if (!cv) return;
  const state = { dic: 2030, ta: 2300, T: 13 };

  const compute = () => {
    const K = eqConstants(state.T, 35, 0);
    const Cm = state.dic * 1e-6, Am = state.ta * 1e-6;
    const s = speciate(Cm, Am, K);
    // Speciation into the three carbon forms, from [H+].
    const h = Math.pow(10, -s.pH);
    const denom = 1 + K.K1 / h + (K.K1 * K.K2) / (h * h);
    const co2aq = Cm / denom;
    const hco3 = (Cm * (K.K1 / h)) / denom;
    return { ...s, R: revelle(Cm, Am, K), co2aq, hco3, co3m: s.co3 };
  };

  const draw = () => {
    const { ctx, w, h } = fit(cv, 250);
    const r = compute();
    const total = r.co2aq + r.hco3 + r.co3m;
    const parts = [
      { k: "HCO₃⁻", v: r.hco3, c: C.green, note: "bicarbonate" },
      { k: "CO₃²⁻", v: r.co3m, c: C.amber, note: "carbonate" },
      { k: "CO₂(aq)", v: r.co2aq, c: C.coral, note: "dissolved gas" },
    ];

    label(ctx, "WHERE THE CARBON ACTUALLY IS", 0, 16, { color: C.dim, size: 10.5 });

    // stacked proportion bar
    const bx = 0, by = 36, bw = w, bh = 30;
    let x = bx;
    parts.forEach((p) => {
      const pw = (p.v / total) * bw;
      ctx.fillStyle = p.c; ctx.globalAlpha = 0.85;
      ctx.fillRect(x, by, Math.max(pw, 0.6), bh);
      ctx.globalAlpha = 1;
      x += pw;
    });

    // rows
    let ry = by + bh + 30;
    parts.forEach((p) => {
      const pct = (p.v / total) * 100;
      ctx.fillStyle = p.c;
      ctx.fillRect(0, ry - 5, 10, 10);
      label(ctx, p.k, 20, ry, { color: C.ink, size: 12 });
      label(ctx, p.note, 92, ry, { color: C.dim, size: 10 });
      label(ctx, pct >= 1 ? pct.toFixed(1) + "%" : pct.toFixed(2) + "%", w, ry,
            { align: "right", color: C.ink, size: 12 });
      label(ctx, (p.v * 1e6).toFixed(1) + " µmol/kg", w - 62, ry,
            { align: "right", color: C.dim, size: 10 });
      ry += 26;
    });

    // the punchline line
    ry += 12;
    ctx.strokeStyle = C.line;
    ctx.beginPath(); ctx.moveTo(0, ry - 12); ctx.lineTo(w, ry - 12); ctx.stroke();
    const pctGas = ((r.co2aq / total) * 100).toFixed(2);
    label(ctx, `Only ${pctGas}% is dissolved gas — the rest is ions, and ions do not`,
          0, ry + 6, { color: C.muted, size: 11, font: "Manrope, sans-serif" });
    label(ctx, `exert pressure. That is why the ocean holds so much carbon.`,
          0, ry + 24, { color: C.muted, size: 11, font: "Manrope, sans-serif" });

    // readout
    $("#v-pco2").textContent = (r.pco2 * 1e6).toFixed(1);
    $("#v-ph").textContent = r.pH.toFixed(3);
    $("#v-co3").textContent = (r.co3m * 1e6).toFixed(1);
    $("#v-rev").textContent = r.R.toFixed(2);
  };

  const sync = () => {
    $("#o-dic").textContent = state.dic;
    $("#o-ta").textContent = state.ta;
    $("#o-temp").textContent = state.T;
    draw();
  };
  $("#r-dic").addEventListener("input", (e) => { state.dic = +e.target.value; sync(); });
  $("#r-ta").addEventListener("input", (e) => { state.ta = +e.target.value; sync(); });
  $("#r-temp").addEventListener("input", (e) => { state.T = +e.target.value; sync(); });
  $("#b-preind").addEventListener("click", () => {
    state.dic = 2030; state.ta = 2300; state.T = 13;
    $("#r-dic").value = 2030; $("#r-ta").value = 2300; $("#r-temp").value = 13;
    sync();
  });
  onResize(sync);
}

/* --------------------------------------------------- 08. the box diagram */

function boxDiagram(data) {
  const cv = $("#c-boxes");
  if (!cv) return;
  const cal = data.calibrated;

  const draw = () => {
    const { ctx, w, h } = fit(cv, 360);
    const bw = Math.min(420, w * 0.66);
    const bx = (w - bw) / 2;
    const rows = [
      { t: "ATMOSPHERE", s: `${cal.pco2_ppm} ppm · ${cal.atmosphere_gtc} GtC`, c: C.ice, hh: 46 },
      { t: "UPPER OCEAN", s: `0–450 m · DIC ${cal.surface_dic}`, c: C.green, hh: 46 },
      { t: "THERMOCLINE", s: `450–1000 m · ${cal.vent_thermocline_yr} yr ventilation`, c: C.green, hh: 46 },
      { t: "DEEP OCEAN", s: `below 1000 m · ${cal.vent_deep_yr} yr ventilation`, c: C.green, hh: 46 },
      { t: "REACTIVE SEDIMENT", s: "~1560 GtC of carbonate on the seafloor", c: C.violet, hh: 44 },
    ];
    const gap = (h - 30 - rows.reduce((a, r) => a + r.hh, 0)) / (rows.length - 1);
    let y = 14;
    const centres = [];

    rows.forEach((r) => {
      ctx.strokeStyle = C.line; ctx.fillStyle = "#12181499"; ctx.lineWidth = 1;
      roundRect(ctx, bx, y, bw, r.hh, 8); ctx.fill(); ctx.stroke();
      ctx.fillStyle = r.c;
      ctx.fillRect(bx, y + 10, 2, r.hh - 20);
      label(ctx, r.t, bx + 16, y + r.hh / 2 - 8, { color: r.c, size: 11 });
      label(ctx, r.s, bx + 16, y + r.hh / 2 + 10, { color: C.dim, size: 10 });
      centres.push([y, y + r.hh]);
      y += r.hh + gap;
    });

    // exchange arrows between consecutive boxes
    const cx = bx + bw / 2;
    ctx.strokeStyle = "#ffffff33"; ctx.lineWidth = 1;
    const names = ["air–sea exchange", "Ψ_st", "Ψ_td", "rain / dissolution"];
    for (let i = 0; i < rows.length - 1; i++) {
      const y0 = centres[i][1], y1 = centres[i + 1][0];
      ctx.beginPath(); ctx.moveTo(cx, y0 + 2); ctx.lineTo(cx, y1 - 2); ctx.stroke();
      [[cx, y1 - 2, 1], [cx, y0 + 2, -1]].forEach(([ax, ay, dir]) => {
        ctx.beginPath();
        ctx.moveTo(ax - 3.5, ay - 4 * dir);
        ctx.lineTo(ax, ay); ctx.lineTo(ax + 3.5, ay - 4 * dir);
        ctx.stroke();
      });
      label(ctx, names[i], cx + 12, (y0 + y1) / 2, { color: C.dim, size: 9.5 });
    }

    // geological in/out on the atmosphere
    label(ctx, "↑ volcanoes", bx - 12, centres[0][0] + 14, { align: "right", color: C.amber, size: 9.5 });
    label(ctx, "↓ weathering", bx - 12, centres[0][0] + 30, { align: "right", color: C.amber, size: 9.5 });
    label(ctx, "burial → crust", bx + bw + 12, centres[4][0] + 22, { color: C.violet, size: 9.5 });
  };
  onResize(draw);
}

/* ------------------------------------------------ log-time airborne charts */

/** Shared log-x / linear-y plot for airborne fraction. */
function afPlot(ctx, w, h, series, opts = {}) {
  const P = { l: 46, r: 18, t: 32, b: 40 };
  const iw = w - P.l - P.r, ih = h - P.t - P.b;
  const t0 = 1, t1 = 1e6;
  const X = (t) => P.l + (Math.log10(Math.max(t, t0)) / Math.log10(t1 / t0)) * iw;
  const Y = (v) => P.t + ih - clamp(v, 0, 1) * ih;

  // y grid
  ctx.strokeStyle = C.line; ctx.lineWidth = 1;
  for (let i = 0; i <= 5; i++) {
    const v = i / 5, y = Y(v);
    ctx.beginPath(); ctx.moveTo(P.l, y); ctx.lineTo(w - P.r, y); ctx.stroke();
    label(ctx, (v * 100).toFixed(0) + "%", P.l - 8, y, { align: "right", size: 10 });
  }
  // x decades
  const decs = [1, 10, 100, 1e3, 1e4, 1e5, 1e6];
  const names = ["1 yr", "10", "100", "1k", "10k", "100k", "1M"];
  decs.forEach((d, i) => {
    const x = X(d);
    ctx.strokeStyle = C.line;
    ctx.beginPath(); ctx.moveTo(x, P.t); ctx.lineTo(x, P.t + ih); ctx.stroke();
    label(ctx, names[i], x, P.t + ih + 16, { align: "center", size: 10 });
  });
  label(ctx, "time since the pulse (log scale) →", w - P.r, h - 8, { align: "right", size: 10 });
  label(ctx, opts.ylabel ?? "fraction still in the air", P.l - 38, 12, { size: 10, color: C.dim });

  series.forEach((s) => {
    if (s.hidden) return;
    ctx.strokeStyle = s.color;
    ctx.lineWidth = s.width ?? 2;
    ctx.globalAlpha = s.alpha ?? 1;
    if (s.dash) ctx.setLineDash(s.dash); else ctx.setLineDash([]);
    ctx.beginPath();
    let started = false;
    for (let i = 0; i < s.t.length; i++) {
      if (s.t[i] < t0) continue;
      const x = X(s.t[i]), y = Y(s.af[i]);
      started ? ctx.lineTo(x, y) : (ctx.moveTo(x, y), (started = true));
    }
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.globalAlpha = 1;
  });
  return { X, Y, P, iw, ih };
}

const STAGE_COLORS = [C.coral, C.amber, C.ice, C.violet, C.green];

function stage12Chart(data) {
  const cv = $("#c-stage12");
  if (!cv) return;
  const s1 = data.stages[0], s2 = data.stages[1];
  const draw = () => {
    const { ctx, w, h } = fit(cv, 300);
    const { X, Y } = afPlot(ctx, w, h, [
      { ...s1, color: C.coral },
      { ...s2, color: C.green },
    ]);
    label(ctx, "Henry's law only", X(3e4), Y(s1.marks["100"]) - 14, { color: C.coral, size: 11 });
    label(ctx, "+ carbonate chemistry", X(3e4), Y(s2.marks["100"]) - 14, { color: C.green, size: 11 });
  };
  onResize(draw);
}

function stagesChart(data) {
  const cv = $("#c-stages");
  if (!cv) return;
  const shown = new Set([1, 2, 3, 4, 5]);

  const draw = () => {
    const { ctx, w, h } = fit(cv, 420);
    const series = data.stages.map((s, i) => ({
      ...s, color: STAGE_COLORS[i], hidden: !shown.has(s.stage),
      width: s.stage === 5 ? 2.6 : 2,
    }));
    afPlot(ctx, w, h, series);
  };

  // legend
  const leg = $("#stageLegend");
  data.stages.forEach((s, i) => {
    const b = document.createElement("button");
    b.className = "on";
    b.style.color = STAGE_COLORS[i];
    b.innerHTML = `<span class="sw"></span>${s.stage}. ${s.name.replace(/^\+ /, "")}`;
    b.addEventListener("click", () => {
      shown.has(s.stage) ? shown.delete(s.stage) : shown.add(s.stage);
      b.classList.toggle("on", shown.has(s.stage));
      draw();
    });
    leg.appendChild(b);
  });
  onResize(draw);
}

function pulseChart(data) {
  const cv = $("#c-pulse");
  if (!cv) return;
  const runs = data.pulses;
  let idx = 1;

  const draw = () => {
    const { ctx, w, h } = fit(cv, 380);
    const series = runs.map((r, i) => ({
      ...r,
      color: i === idx ? C.green : C.dim,
      alpha: i === idx ? 1 : 0.28,
      width: i === idx ? 2.8 : 1.4,
    }));
    const { X, Y } = afPlot(ctx, w, h, series);
    const cur = runs[idx];
    label(ctx, `${cur.gtc} GtC`, X(4e5), Y(cur.marks["400000"]) - 14,
          { color: C.green, size: 12, align: "right" });

    $("#o-pulse").textContent = cur.gtc;
    $("#v-af100").textContent = (cur.marks["100"] * 100).toFixed(0) + "%";
    $("#v-af1k").textContent = (cur.marks["1000"] * 100).toFixed(0) + "%";
    $("#v-af400k").textContent = (cur.marks["400000"] * 100).toFixed(1) + "%";
  };

  $("#r-pulse").addEventListener("input", (e) => { idx = +e.target.value; draw(); });
  onResize(draw);
}

/* --------------------------------------------------- 04. provenance lists */

function provenance(data) {
  const c = data.calibrated;
  const IN = [
    ["280 ppm", "Preindustrial CO₂ — ice cores"],
    ["2300 µmol/kg", "Surface alkalinity — measured"],
    ["10 GtC/yr", "Export production — observed"],
    ["29 / 425 yr", "Ventilation — tuned to the observed impulse response"],
    ["K₀ K₁ K₂ K_B K_W K_sp", "Equilibrium constants — laboratory thermodynamics"],
  ];
  const OUT = [
    [`${c.surface_dic} µmol/kg`, "Surface dissolved carbon"],
    [`${c.deep_dic} µmol/kg`, "Deep dissolved carbon"],
    [`pH ${c.surface_ph}`, "Preindustrial surface pH"],
    [`Revelle ${c.revelle}`, "The buffer factor"],
    [`${c.ocean_total_gtc} GtC`, `Total ocean carbon — ${c.ocean_over_atmosphere}× the atmosphere`],
    [`${c.burial_gtc} GtC/yr`, "Carbonate burial into the crust"],
  ];
  const fill = (sel, rows) => {
    const ul = $(sel);
    rows.forEach(([v, n]) => {
      const li = document.createElement("li");
      li.innerHTML = `<span class="pv">${v}</span><span class="pn">${n}</span>`;
      ul.appendChild(li);
    });
  };
  fill("#prov-in", IN);
  fill("#prov-out", OUT);
  $("#pv-org").textContent = c.export_org_gtc;
  $("#pv-rain").textContent = c.rain_ratio;
}


/* ------------------------------------- 11. the geological budget, numbers */

/*
 * Every figure in section 11 is read from the model's calibrated steady state
 * rather than typed into the HTML, for the same reason as everywhere else on
 * this page: if the model changes, the prose must change with it.
 */
function geoBudget(data) {
  if (!$("#gb-volc")) return;
  const c = data.calibrated;
  const W = data.weathering_law;
  const set = (id, v) => { const el = $(id); if (el) el.textContent = v; };
  const f3 = (v) => v.toFixed(3);

  set("#gb-volc", f3(c.outgassing_gtc));
  set("#gb-carb", f3(c.weathering_carb_gtc));
  set("#gb-carb2", f3(c.weathering_carb_gtc));
  set("#gb-bur", f3(c.burial_gtc));
  set("#gb-bur2", f3(c.burial_gtc));
  [ "#gb-sil", "#gb-sil2", "#gb-sil3" ].forEach((id) => set(id, f3(c.weathering_sil_gtc)));

  // Turnover of the whole surface system through rock. This is the number the
  // 400,000-year mark on the later charts is really measuring.
  const inventory = c.atmosphere_gtc + c.ocean_total_gtc;
  const turnover = inventory / W.sil_gtc;
  set("#gb-inv", inventory.toLocaleString("en-US"));
  set("#gb-turn", (Math.round(turnover / 10000) * 10000).toLocaleString("en-US"));

  // Present-day emissions, from the same series the historical run is forced with.
  const emis = data.historical.emissions;
  const [year, rate] = emis[emis.length - 1];
  set("#gb-year", String(Math.round(year)));
  set("#gb-emis", rate.toFixed(1));
  set("#gb-ratio", String(Math.round(rate / W.sil_gtc / 10) * 10));

  // Stage 4 stalls; stage 5 is the only one that finishes.
  const pct = (v) => (v * 100).toFixed(v < 0.01 ? 1 : 0) + "%";
  set("#gb-af4", pct(data.stages[3].marks["400000"]));
  set("#gb-af5", pct(data.stages[4].marks["400000"]));
}

/* --------------------------------------- 11. the weathering thermostat, live */

/*
 * LIVE rather than precomputed, because unlike every other curve on this page
 * this one is algebra, not an integration: the WHAK law evaluated at a given
 * pCO2. The constants come from data.weathering_law, which export.py reads
 * straight off the model's Params, so the slider cannot drift from the model.
 *
 * The restoring-time readout is deliberately labelled an order of magnitude.
 * It divides the excess carbon of the whole surface system by the current
 * imbalance, which assumes the excess stays partitioned between air and sea
 * the way stage 2 says it does, and ignores the fact that the imbalance itself
 * shrinks as CO2 falls. It is a scale, not a prediction.
 */
function thermostatLab(data) {
  const cv = $("#c-thermostat");
  if (!cv) return;
  const W = data.weathering_law;
  const c = data.calibrated;
  const PPM0 = W.pco2_0_ppm;
  const PPM_LO = 100, PPM_HI = 2000;
  const N_LO = 0.10, N_HI = 0.50;
  const Y_MAX = 0.6;

  // Equilibrium partitioning of a perturbation between air and sea, and the
  // GtC each ppm of air is worth. Both read off the model, not assumed.
  const AF_EQ = data.stages[1].marks["1000"];
  const GTC_PER_PPM = c.atmosphere_gtc / c.pco2_ppm;

  // Index space so the slider is logarithmic. I0 is wherever the model's own
  // preindustrial pCO2 falls in it, so 'back to 280' lands exactly on the setpoint.
  const STEPS = 1000;
  const ppmOf = (i) => PPM_LO * Math.pow(PPM_HI / PPM_LO, i / STEPS);
  const I0 = Math.round(STEPS * Math.log(PPM0 / PPM_LO) / Math.log(PPM_HI / PPM_LO));
  const state = { i: I0, n: W.n_sil };
  const warming = (ppm) => W.ecs * Math.log2(ppm / PPM0);
  const fsil = (ppm, n) =>
    W.sil_gtc * Math.pow(ppm / PPM0, n) * Math.exp(warming(ppm) / W.dT_weath);

  const draw = () => {
    const { ctx, w, h } = fit(cv, 300);
    const P = { l: 52, r: 16, t: 26, b: 40 };
    const iw = w - P.l - P.r, ih = h - P.t - P.b;
    const X = (ppm) =>
      P.l + (Math.log(ppm / PPM_LO) / Math.log(PPM_HI / PPM_LO)) * iw;
    const Y = (f) => P.t + ih - clamp(f / Y_MAX, 0, 1) * ih;

    // grid
    ctx.strokeStyle = C.line; ctx.lineWidth = 1;
    for (let v = 0; v <= Y_MAX + 1e-9; v += 0.1) {
      const y = Y(v);
      ctx.beginPath(); ctx.moveTo(P.l, y); ctx.lineTo(w - P.r, y); ctx.stroke();
      label(ctx, v.toFixed(1), P.l - 8, y, { align: "right", size: 10 });
    }
    [100, 200, 280, 500, 1000, 2000].forEach((d) => {
      const x = X(d);
      ctx.strokeStyle = C.line;
      ctx.beginPath(); ctx.moveTo(x, P.t); ctx.lineTo(x, P.t + ih); ctx.stroke();
      label(ctx, String(d), x, P.t + ih + 16, { align: "center", size: 10 });
    });
    label(ctx, "GtC/yr", P.l - 44, 12, { size: 10, color: C.dim });
    label(ctx, "atmospheric CO₂, ppm (log scale) →", w - P.r, h - 8,
          { align: "right", size: 10 });

    // the uncertainty band: the same law across the plausible exponent range
    ctx.fillStyle = C.green; ctx.globalAlpha = 0.14;
    ctx.beginPath();
    for (let px = 0; px <= iw; px++) {
      const ppm = PPM_LO * Math.pow(PPM_HI / PPM_LO, px / iw);
      px === 0 ? ctx.moveTo(P.l + px, Y(fsil(ppm, N_HI)))
               : ctx.lineTo(P.l + px, Y(fsil(ppm, N_HI)));
    }
    for (let px = iw; px >= 0; px--) {
      const ppm = PPM_LO * Math.pow(PPM_HI / PPM_LO, px / iw);
      ctx.lineTo(P.l + px, Y(fsil(ppm, N_LO)));
    }
    ctx.closePath(); ctx.fill();
    ctx.globalAlpha = 0.4; ctx.strokeStyle = C.green; ctx.lineWidth = 1;
    ctx.stroke(); ctx.globalAlpha = 1;
    label(ctx, "n = 0.1 … 0.5", X(2000) - 4, Y(fsil(2000, N_HI)) + 14,
          { align: "right", color: C.green, size: 9.5 });

    const ppm = ppmOf(state.i);
    const cur = fsil(ppm, state.n);
    const imb = cur - W.volc_gtc;          // positive means net drawdown

    // the imbalance, shaded between the curve and the volcanic line
    if (Math.abs(ppm - PPM0) > 1) {
      const a = Math.min(PPM0, ppm), b = Math.max(PPM0, ppm);
      ctx.fillStyle = imb > 0 ? C.green : C.coral;
      ctx.globalAlpha = 0.16;
      ctx.beginPath();
      ctx.moveTo(X(a), Y(W.volc_gtc));
      const steps = 90;
      for (let k = 0; k <= steps; k++) {
        const q = a * Math.pow(b / a, k / steps);
        ctx.lineTo(X(q), Y(fsil(q, state.n)));
      }
      ctx.lineTo(X(b), Y(W.volc_gtc));
      ctx.closePath(); ctx.fill(); ctx.globalAlpha = 1;
    }

    // volcanic outgassing: flat, because nothing about it responds to climate
    ctx.strokeStyle = C.amber; ctx.lineWidth = 2; ctx.setLineDash([5, 4]);
    ctx.beginPath();
    ctx.moveTo(P.l, Y(W.volc_gtc)); ctx.lineTo(w - P.r, Y(W.volc_gtc));
    ctx.stroke(); ctx.setLineDash([]);
    label(ctx, "volcanic outgassing", w - P.r - 4, Y(W.volc_gtc) - 12,
          { align: "right", color: C.amber, size: 10.5 });

    // silicate weathering at the chosen exponent
    ctx.strokeStyle = C.green; ctx.lineWidth = 2.6;
    ctx.beginPath();
    for (let px = 0; px <= iw; px++) {
      const q = PPM_LO * Math.pow(PPM_HI / PPM_LO, px / iw);
      px === 0 ? ctx.moveTo(P.l + px, Y(fsil(q, state.n)))
               : ctx.lineTo(P.l + px, Y(fsil(q, state.n)));
    }
    ctx.stroke();
    // Labelled out at 950 ppm: at the left-hand end the curve runs into the
    // outgassing line, which is exactly where the label must not sit.
    label(ctx, "silicate weathering", X(950), Y(fsil(950, state.n)) - 16,
          { align: "center", color: C.green, size: 10.5 });

    // the setpoint, where the two cross
    const xs = X(PPM0), ys = Y(W.volc_gtc);
    ctx.strokeStyle = C.ink; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.arc(xs, ys, 4.5, 0, Math.PI * 2); ctx.stroke();
    label(ctx, "setpoint", xs, ys + 18, { align: "center", color: C.muted, size: 10 });

    // where the reader has dragged to
    const xc = X(ppm), yc = Y(cur);
    ctx.strokeStyle = C.ink; ctx.globalAlpha = 0.35; ctx.lineWidth = 1;
    ctx.setLineDash([2, 3]);
    ctx.beginPath(); ctx.moveTo(xc, P.t); ctx.lineTo(xc, P.t + ih); ctx.stroke();
    ctx.setLineDash([]); ctx.globalAlpha = 1;
    ctx.fillStyle = imb > 0 ? C.green : C.coral;
    ctx.beginPath(); ctx.arc(xc, yc, 5, 0, Math.PI * 2); ctx.fill();

    // readout
    const dT = warming(ppm);
    $("#v-tsil").textContent = cur.toFixed(3);
    $("#v-tdt").textContent = (dT >= 0 ? "+" : "−") + Math.abs(dT).toFixed(1);
    // Sign is from the atmosphere's point of view: weathering ahead of the
    // volcanoes is carbon leaving the air, so it reads negative.
    const balanced = Math.abs(imb) < 5e-4;
    $("#v-timb").textContent =
      balanced ? "0.000" : (imb > 0 ? "−" : "+") + Math.abs(imb).toFixed(3);
    $("#v-timb").style.color = balanced ? C.ink : (imb > 0 ? C.green : C.coral);

    // Time to work the excess off, to one significant figure.
    const excessAir = (ppm - PPM0) * GTC_PER_PPM;
    const excessAll = excessAir / AF_EQ;
    const yrs = Math.abs(imb) > 1e-4 ? Math.abs(excessAll / imb) : Infinity;
    $("#v-ttime").textContent =
      !isFinite(yrs) || Math.abs(ppm - PPM0) < 2
        ? "—"
        : (yrs >= 1e6
            ? (yrs / 1e6).toFixed(1) + "M yr"
            : Math.round(yrs / 1000).toLocaleString("en-US") + "k yr");
  };

  const sync = () => {
    $("#o-tco2").textContent = Math.round(ppmOf(state.i));
    $("#o-tn").textContent = state.n.toFixed(2);
    draw();
  };
  $("#r-tco2").addEventListener("input", (e) => { state.i = +e.target.value; sync(); });
  $("#r-tn").addEventListener("input", (e) => { state.n = +e.target.value; sync(); });
  $("#r-tco2").value = I0;
  $("#b-tpreind").addEventListener("click", () => {
    state.i = I0; state.n = W.n_sil;
    $("#r-tco2").value = I0; $("#r-tn").value = W.n_sil;
    sync();
  });
  onResize(sync);
}

/* ------------------------------------------------------------- glossary */

/*
 * Definitions live here rather than in data-* attributes so each term is
 * written once and every mention picks it up. Wording aims at someone who
 * has never met the term, not at someone checking a textbook.
 */
const GLOSSARY = {
  "box-model": ["Box model",
    "A model that divides the world into a few well-stirred compartments and tracks only how much of something is in each. It gives up all detail about location in exchange for being able to run very long simulations and for every term staying explainable."],
  "residence-time": ["Residence time",
    "The average length of time a molecule stays in a reservoir before leaving. If a lake holds 100 tonnes of water and 10 tonnes flow through per year, the residence time is 10 years."],
  "pco2": ["pCO₂, partial pressure",
    "How hard the CO₂ in a mixture is pushing to escape, measured in microatmospheres (µatm). Air and seawater exchange CO₂ until their partial pressures match, so pCO₂ decides which way the gas moves."],
  "dic": ["DIC, dissolved inorganic carbon",
    "The total carbon dissolved in seawater in all its chemical forms added together: CO₂ gas, bicarbonate and carbonate ions. Around 2,000 µmol per kilogram of seawater."],
  "alkalinity": ["Alkalinity",
    "A measure of seawater's capacity to neutralise acid, set mostly by dissolved carbonate and bicarbonate. It is what lets the ocean absorb CO₂ without its pH collapsing, and it is conserved when CO₂ dissolves, which makes it a useful bookkeeping quantity."],
  "revelle": ["Revelle factor",
    "How much harder seawater pushes back as you add carbon to it. A value of 10 means a 1% increase in dissolved carbon raises pCO₂ by about 10%. The higher it goes, the less willing the ocean is to take up more CO₂."],
  "thermocline": ["Thermocline",
    "The layer of ocean between roughly 450 and 1,000 metres where temperature drops away quickly with depth. It sits between the sunlit surface and the cold deep water and acts as a partial barrier to mixing between them."],
  "ventilation": ["Ventilation",
    "How quickly deeper water is replaced by water that has recently been in contact with the atmosphere. Expressed as a timescale: about 29 years for the thermocline in this model, about 425 years for the deep ocean."],
  "omega": ["Ω, saturation state",
    "Whether seawater will dissolve calcium carbonate or let it accumulate. Above 1, shells and sediment are stable. Below 1, the water is corrosive to them and they begin dissolving."],
  "weathering": ["Silicate weathering",
    "The slow chemical attack of rainwater on silicate rocks. Rain carries dissolved CO₂ which reacts with the rock, and the products wash to the ocean where they are eventually buried as carbonate, removing carbon from the air for millions of years."],
  "outgassing": ["Volcanic outgassing",
    "CO₂ returned to the atmosphere from the Earth's interior, at mid-ocean ridges, arc volcanoes and metamorphic belts. About 0.1 GtC per year, and for the purposes of this model it is a constant: it is the one arm of the geological cycle that does not respond to climate."],
  "carbonate-weathering": ["Carbonate weathering",
    "The dissolution of limestone by acidic rainwater. It looks like a CO₂ sink and is often mistaken for one, but the carbon it delivers to the ocean is buried again as carbonate and the CO₂ handed straight back, so over a full circuit it removes nothing. Only silicate weathering is a net sink."],
  "airborne-fraction": ["Airborne fraction",
    "Of a given amount of carbon released, the share still in the atmosphere at some later time. An airborne fraction of 0.4 after a century means 40% of what was emitted is still up there."],
  "irf": ["Impulse response function",
    "The standard way of summarising what happens to a sudden release of CO₂: a curve giving the fraction remaining in the air at every later time. Global Warming Potentials are calculated from it, which is why its shape matters well beyond this model."],
  "gtc": ["GtC, gigatonnes of carbon",
    "A billion tonnes of carbon. One part per million of atmospheric CO₂ corresponds to 2.13 GtC, and the preindustrial atmosphere held about 596 GtC."],
  "ecs": ["Equilibrium climate sensitivity",
    "How much the planet eventually warms if atmospheric CO₂ doubles and is then held there. The IPCC AR6 likely range is 2.5 to 4.0 K, and this remains the largest single uncertainty in translating carbon into temperature."],
  "radiocarbon": ["Radiocarbon, Δ14C",
    "A heavy, radioactive form of carbon produced naturally in the upper atmosphere and, briefly and enormously, by 1950s and 60s nuclear tests. Because it decays at a known rate, how depleted a water mass is tells you how long ago it left the surface. Measured in parts per thousand, written ‰."],
  "export-production": ["Export production",
    "The rate at which carbon fixed by plankton in sunlit surface water sinks out into the ocean interior. Roughly 10 GtC per year, and one of the reasons the deep ocean holds more carbon than the surface."],
  "rain-ratio": ["Rain ratio",
    "The proportion of sinking carbonate shell material to sinking organic matter. Around 0.12 in the real ocean, and a quantity this model reproduces without being asked to."],
};

function glossaryTips() {
  const tip = $("#tip");
  if (!tip) return;
  let hideTimer, shownAt = 0;

  const show = (el) => {
    const entry = GLOSSARY[el.dataset.term];
    if (!entry) return;
    clearTimeout(hideTimer);
    tip.innerHTML = `<b>${entry[0]}</b>${entry[1]}`;
    tip.classList.add("on");
    tip.setAttribute("aria-hidden", "false");
    shownAt = performance.now();

    // Position above the term, flipping below if there is no room.
    const r = el.getBoundingClientRect();
    const tr = tip.getBoundingClientRect();
    let x = r.left + r.width / 2 - tr.width / 2;
    x = clamp(x, 12, window.innerWidth - tr.width - 12);
    let y = r.top - tr.height - 10;
    if (y < 70) y = r.bottom + 10;
    tip.style.left = Math.round(x) + "px";
    tip.style.top = Math.round(y) + "px";
  };
  const hide = () => {
    hideTimer = setTimeout(() => {
      tip.classList.remove("on");
      tip.setAttribute("aria-hidden", "true");
    }, 90);
  };

  document.querySelectorAll(".term").forEach((el) => {
    el.setAttribute("tabindex", "0");
    el.setAttribute("role", "button");
    const entry = GLOSSARY[el.dataset.term];
    if (entry) el.setAttribute("aria-label", `${el.textContent}: ${entry[0]}. ${entry[1]}`);
    el.addEventListener("mouseenter", () => show(el));
    el.addEventListener("mouseleave", hide);
    el.addEventListener("focus", () => show(el));
    el.addEventListener("blur", hide);
    // Touch: tap to toggle, since there is no hover.
    el.addEventListener("click", (e) => {
      e.preventDefault();
      tip.classList.contains("on") ? hide() : show(el);
    });
  });
  // Bringing a term into view scrolls the page, so ignore scrolls that land
  // in the same instant the tooltip opened.
  addEventListener("scroll", () => {
    if (performance.now() - shownAt > 250) tip.classList.remove("on");
  }, { passive: true });
  addEventListener("keydown", (e) => { if (e.key === "Escape") tip.classList.remove("on"); });
}

/* --------------------------------------------- 14. historical vs observed */

/*
 * Two stacked panels sharing an x axis. CO2 and warming were tried on twin
 * y axes first; the curves tangle and the reader cannot tell which line
 * belongs to which scale.
 */
function historicalChart(data) {
  const cv = $("#c-hist");
  if (!cv || !data.historical) return;
  const H = data.historical;
  const show = { model: true, obs: true, temp: true };

  const draw = () => {
    const { ctx, w, h } = fit(cv, 470);
    const P = { l: 56, r: 20, t: 26, b: 40 };
    const gap = 34;
    const iw = w - P.l - P.r;
    const h1 = Math.round((h - P.t - P.b - gap) * 0.62);
    const h2 = h - P.t - P.b - gap - h1;
    const top2 = P.t + h1 + gap;
    const t0 = 1850, t1 = 2100;
    const X = (t) => P.l + ((t - t0) / (t1 - t0)) * iw;

    const panel = (top, ph, v0, v1, step, unit, caption) => {
      const Y = (v) => top + ph - ((v - v0) / (v1 - v0)) * ph;
      ctx.strokeStyle = C.line; ctx.lineWidth = 1;
      for (let v = v0; v <= v1 + 1e-9; v += step) {
        ctx.beginPath(); ctx.moveTo(P.l, Y(v)); ctx.lineTo(w - P.r, Y(v)); ctx.stroke();
        label(ctx, Math.round(v * 100) / 100 + unit, P.l - 8, Y(v), { align: "right", size: 10 });
      }
      for (let t = t0; t <= t1; t += 50) {
        ctx.beginPath(); ctx.moveTo(X(t), top); ctx.lineTo(X(t), top + ph); ctx.stroke();
      }
      label(ctx, caption, P.l, top - 11, { size: 10 });
      // emissions cease
      ctx.setLineDash([3, 4]); ctx.strokeStyle = C.dim;
      ctx.beginPath(); ctx.moveTo(X(2024), top); ctx.lineTo(X(2024), top + ph); ctx.stroke();
      ctx.setLineDash([]);
      return Y;
    };

    const band = (Y, lo, hi, fill) => {
      ctx.beginPath();
      H.t.forEach((t, i) => (i ? ctx.lineTo(X(t), Y(lo[i])) : ctx.moveTo(X(t), Y(lo[i]))));
      for (let i = H.t.length - 1; i >= 0; i--) ctx.lineTo(X(H.t[i]), Y(hi[i]));
      ctx.closePath(); ctx.fillStyle = fill; ctx.fill();
    };
    const line = (Y, ys, color, width) => {
      ctx.strokeStyle = color; ctx.lineWidth = width; ctx.beginPath();
      H.t.forEach((t, i) => (i ? ctx.lineTo(X(t), Y(ys[i])) : ctx.moveTo(X(t), Y(ys[i]))));
      ctx.stroke();
    };
    const pairs = (Y, arr, color, width) => {
      ctx.strokeStyle = color; ctx.lineWidth = width; ctx.beginPath();
      arr.forEach(([t, v], i) => (i ? ctx.lineTo(X(t), Y(v)) : ctx.moveTo(X(t), Y(v))));
      ctx.stroke();
    };

    // --- panel 1: CO2 ---
    const Yc = panel(P.t, h1, 260, 620, 60, "", "atmospheric CO2 (ppm)");
    if (show.model) { band(Yc, H.pco2_lo, H.pco2_hi, "#a5d66f22"); line(Yc, H.pco2, C.green, 2.4); }
    if (show.obs) {
      ctx.fillStyle = C.ice;
      H.obs_co2_ice.forEach(([t, v]) => { ctx.beginPath(); ctx.arc(X(t), Yc(v), 1.9, 0, 7); ctx.fill(); });
      pairs(Yc, H.obs_co2_mlo, C.ice, 2.2);
    }
    label(ctx, "emissions stop", X(2024) + 6, P.t + 12, { size: 9.5, color: C.dim });

    // --- panel 2: warming ---
    const Yt = panel(top2, h2, 0, 4, 1, " K", "warming above 1850–1900 (K)");
    if (show.temp) {
      band(Yt, H.dT_lo, H.dT_hi, "#f2b84b22");
      line(Yt, H.dT, C.amber, 2);
      pairs(Yt, H.obs_temp, C.ice, 1.4);
    }
    for (let t = t0; t <= t1; t += 50) {
      label(ctx, t, X(t), top2 + h2 + 16, { align: "center", size: 10 });
    }
  };

  const leg = $("#histLegend");
  [["model", "model CO₂, band over ECS 2.5–4.0", C.green],
   ["obs", "observations: ice core, then Mauna Loa", C.ice],
   ["temp", "warming, model band and HadCRUT5", C.amber]].forEach(([k, name, col]) => {
    const b = document.createElement("button");
    b.className = "on"; b.style.color = col;
    b.innerHTML = `<span class="sw"></span>${name}`;
    b.addEventListener("click", () => { show[k] = !show[k]; b.classList.toggle("on", show[k]); draw(); });
    leg.appendChild(b);
  });

  const y = H.y2024;
  $("#histScore").innerHTML = `
    <div class="score">
      <span class="k">CO₂ in 2024</span>
      <div class="row mod"><span>model</span><b>${y.pco2_model_lo}–${y.pco2_model_hi} ppm</b></div>
      <div class="row obs"><span>observed</span><b>${y.pco2_obs} ppm</b></div>
    </div>
    <div class="score">
      <span class="k">Warming in 2024</span>
      <div class="row mod"><span>model</span><b>${y.dT_model_lo}–${y.dT_model_hi} K</b></div>
      <div class="row obs"><span>observed</span><b>${y.dT_obs} K</b></div>
    </div>
    <div class="score">
      <span class="k">Tuned to any of this</span>
      <div class="row obs"><span>parameters fitted</span><b>none</b></div>
      <div class="row obs"><span>free knobs</span><b>0</b></div>
    </div>`;
  onResize(draw);
}

/* ------------------------------------------------ 15. bomb radiocarbon */

/*
 * The atmospheric spike reaches +1100 permil while the deep ocean moves by
 * about +7. On one axis the ocean response is a flat line, so the ocean gets
 * its own panel underneath at its own scale.
 */
function radiocarbonChart(data) {
  const cv = $("#c-c14");
  if (!cv || !data.radiocarbon) return;
  const R = data.radiocarbon;
  const show = { atm: true, obs: true, ocean: true };

  const draw = () => {
    const { ctx, w, h } = fit(cv, 470);
    const P = { l: 56, r: 20, t: 26, b: 40 };
    const gap = 36;
    const iw = w - P.l - P.r;
    const h1 = Math.round((h - P.t - P.b - gap) * 0.60);
    const h2 = h - P.t - P.b - gap - h1;
    const top2 = P.t + h1 + gap;
    const t0 = 1850, t1 = 2030;
    const X = (t) => P.l + ((t - t0) / (t1 - t0)) * iw;

    const panel = (top, ph, v0, v1, step, caption) => {
      const Y = (v) => top + ph - ((v - v0) / (v1 - v0)) * ph;
      ctx.strokeStyle = C.line; ctx.lineWidth = 1;
      for (let v = v0; v <= v1 + 1e-9; v += step) {
        ctx.beginPath(); ctx.moveTo(P.l, Y(v)); ctx.lineTo(w - P.r, Y(v)); ctx.stroke();
        label(ctx, v, P.l - 8, Y(v), { align: "right", size: 10 });
      }
      for (let t = 1850; t <= 2030; t += 30) {
        ctx.beginPath(); ctx.moveTo(X(t), top); ctx.lineTo(X(t), top + ph); ctx.stroke();
      }
      if (v0 < 0 && v1 > 0) {
        ctx.strokeStyle = "#ffffff2e";
        ctx.beginPath(); ctx.moveTo(P.l, Y(0)); ctx.lineTo(w - P.r, Y(0)); ctx.stroke();
      }
      label(ctx, caption, P.l, top - 11, { size: 10 });
      return Y;
    };
    const line = (Y, ys, color, width) => {
      ctx.strokeStyle = color; ctx.lineWidth = width; ctx.beginPath();
      R.t.forEach((t, i) => (i ? ctx.lineTo(X(t), Y(ys[i])) : ctx.moveTo(X(t), Y(ys[i]))));
      ctx.stroke();
    };

    // --- panel 1: atmosphere ---
    const Ya = panel(P.t, h1, -200, 1200, 200, "atmosphere Δ14C (‰)");
    if (show.atm) line(Ya, R.atm, C.coral, 2.4);
    if (show.obs) {
      ctx.strokeStyle = C.ink; ctx.lineWidth = 1.4;
      R.obs_atm.forEach(([t, v]) => { ctx.beginPath(); ctx.arc(X(t), Ya(v), 3.4, 0, 7); ctx.stroke(); });
    }
    label(ctx, "bomb tests", X(1963), Ya(1150), { size: 9.5, color: C.dim, align: "center" });

    // --- panel 2: the ocean, at its own scale ---
    const Yo = panel(top2, h2, -160, 40, 40, "ocean Δ14C (‰), note the scale change");
    if (show.ocean) {
      line(Yo, R.surf, C.green, 2);
      line(Yo, R.therm, C.violet, 1.7);
      line(Yo, R.deep, C.ice, 1.7);
      label(ctx, "surface", X(1858), Yo(R.surf[0]) - 11, { color: C.green, size: 9.5 });
      label(ctx, "thermocline", X(1858), Yo(R.therm[0]) - 11, { color: C.violet, size: 9.5 });
      label(ctx, "deep", X(1858), Yo(R.deep[0]) - 11, { color: C.ice, size: 9.5 });
    }
    for (let t = 1850; t <= 2030; t += 30) {
      label(ctx, t, X(t), top2 + h2 + 16, { align: "center", size: 10 });
    }
  };

  const leg = $("#c14Legend");
  [["atm", "model atmosphere", C.coral],
   ["obs", "observed atmosphere", C.ink],
   ["ocean", "ocean boxes", C.green]].forEach(([k, name, col]) => {
    const b = document.createElement("button");
    b.className = "on"; b.style.color = col;
    b.innerHTML = `<span class="sw"></span>${name}`;
    b.addEventListener("click", () => { show[k] = !show[k]; b.classList.toggle("on", show[k]); draw(); });
    leg.appendChild(b);
  });

  const n = R.natural;
  $("#c14Score").innerHTML = `
    <div class="score">
      <span class="k">Surface, preindustrial</span>
      <div class="row mod"><span>model</span><b>${n.surface_model}‰</b></div>
      <div class="row obs"><span>observed</span><b>${n.surface_obs}‰</b></div>
    </div>
    <div class="score">
      <span class="k">Thermocline</span>
      <div class="row mod"><span>model</span><b>${n.thermocline_model}‰</b></div>
      <div class="row obs"><span>observed</span><b>${n.thermocline_obs}‰</b></div>
    </div>
    <div class="score warn">
      <span class="k">Deep ocean</span>
      <div class="row mod"><span>model</span><b>${n.deep_model}‰</b></div>
      <div class="row obs"><span>observed</span><b>${n.deep_obs}</b></div>
    </div>`;
  onResize(draw);
}

/* --------------------------------------------- 18. the answer, restated */

/*
 * Nothing new is computed here. This is the stage-5 trajectory already plotted
 * in section 13, inverted: instead of reading the fraction off at a given
 * time, it solves for the time at which a given fraction has gone. The point
 * it makes is only visible on a log axis, which is that the crossings come out
 * roughly evenly spaced: each step down the staircase takes five to ten times
 * longer than the step before it.
 */
function answerChart(data) {
  const cv = $("#c-answer");
  if (!cv) return;
  const run = data.stages[4];               // + silicate weathering
  const NAMES = {
    0.50: "half of it",
    0.75: "three quarters",
    0.90: "nine tenths",
    0.95: "95%",
    0.99: "99%",
  };

  const yrs = (v) => {
    if (v == null) return "—";
    if (v >= 1e5) return Math.round(v / 1e4) * 10 + "k yr";
    if (v >= 1e3) return (Math.round(v / 100) / 10) + "k yr";
    return Math.round(v) + " yr";
  };

  // Solved in Python at full resolution. Reconstructing these from the thinned
  // curve would work by luck of where the samples fall, and stop working the
  // moment the thinning changes.
  const marks = data.staircase.levels.map((L) => ({
    thr: L.af, name: NAMES[L.gone] ?? `${L.gone * 100}%`, t: L.t,
  }));


  // the steps, as a readout beside the chart
  const box = $("#answerSteps");
  if (box && !box.childElementCount) {
    marks.forEach((m) => {
      const d = document.createElement("div");
      d.innerHTML = `<span>${m.name} gone</span><b>${yrs(m.t)}</b>` +
                    `<i>after the emissions stop</i>`;
      box.appendChild(d);
    });
  }

  const draw = () => {
    const { ctx, w, h } = fit(cv, 330);
    const { X, Y } = afPlot(ctx, w, h, [{ ...run, color: C.green, width: 2.8 }]);

    marks.forEach((m) => {
      if (m.t == null) return;
      const x = X(m.t), y = Y(m.thr);
      // drop lines to both axes, so the pairing is readable off the plot
      ctx.strokeStyle = C.amber; ctx.globalAlpha = 0.32;
      ctx.setLineDash([2, 3]); ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x, Y(0)); ctx.stroke();
      ctx.setLineDash([]); ctx.globalAlpha = 1;

      ctx.fillStyle = C.amber;
      ctx.beginPath(); ctx.arc(x, y, 4, 0, Math.PI * 2); ctx.fill();
      // Below and to the right: the curve descends from the upper left through
      // every marker, and the drop line runs straight down from it.
      label(ctx, yrs(m.t), x + 12, y + 13, { color: C.amber, size: 10.5 });
    });
    label(ctx, "each step down costs five to ten times the wait", X(1.4), Y(0.07),
          { color: C.muted, size: 10.5 });
  };
  onResize(draw);

  // How much of the staircase the size of the pulse actually moves.
  const lo = data.pulses[0], hi = data.pulses[data.pulses.length - 1];
  const pct = (v, d = 0) => (v * 100).toFixed(d) + "%";
  $("#ans-lo100").textContent = pct(lo.marks["100"]);
  $("#ans-hi100").textContent = pct(hi.marks["100"]);
  $("#ans-lo400k").textContent = pct(lo.marks["400000"], 1);
  $("#ans-hi400k").textContent = pct(hi.marks["400000"], 1);
}

/* ----------------------------------------------------------- page plumbing */

function reveals() {
  document.querySelectorAll(".reveal").forEach((r) => {
    r.querySelector(".btn").addEventListener("click", () => r.classList.add("open"));
  });
}

function scrollFx() {
  const io = new IntersectionObserver((es) => {
    es.forEach((e) => { if (e.isIntersecting) e.target.classList.add("seen"); });
  }, { threshold: 0.12, rootMargin: "0px 0px -8% 0px" });
  document.querySelectorAll(".sec").forEach((s) => io.observe(s));

  const bar = $("#progressBar");
  const onScroll = () => {
    const max = document.body.scrollHeight - innerHeight;
    bar.style.width = (max > 0 ? (scrollY / max) * 100 : 0) + "%";
  };
  addEventListener("scroll", onScroll, { passive: true });
  onScroll();
}

/* ------------------------------------------------------------------- boot */

async function main() {
  scrollFx();
  reveals();
  glossaryTips();
  oneBox();
  bathtub();
  twoBox();
  chemLab();

  let data;
  try {
    const res = await fetch("data/anemone-runs.json");
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    data = await res.json();
  } catch (err) {
    console.error("Could not load model output:", err);
    document.querySelectorAll("[data-lab='answer'], [data-lab='thermostat'], [data-lab='stages'], [data-lab='pulse'], [data-lab='historical'], [data-lab='c14']").forEach((el) => {
      el.innerHTML = '<p class="aside">Model output could not be loaded. ' +
                     'This page needs to be served over HTTP, not opened as a file.</p>';
    });
    return;
  }

  provenance(data);
  geoBudget(data);
  thermostatLab(data);
  boxDiagram(data);
  stage12Chart(data);
  stagesChart(data);
  pulseChart(data);
  historicalChart(data);
  radiocarbonChart(data);
  answerChart(data);
}

main();
