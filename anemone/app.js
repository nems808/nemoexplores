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
    document.querySelectorAll("[data-lab='stages'], [data-lab='pulse']").forEach((el) => {
      el.innerHTML = '<p class="aside">Model output could not be loaded. ' +
                     'This page needs to be served over HTTP, not opened as a file.</p>';
    });
    return;
  }

  provenance(data);
  boxDiagram(data);
  stage12Chart(data);
  stagesChart(data);
  pulseChart(data);
}

main();
