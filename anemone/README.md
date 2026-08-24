# How to Model a Planet — ANEMONE explainer

A single-page vertical explainer that builds box models from one box up to
ANEMONE, a six-reservoir carbon-cycle model.

Source model: `~/code/AnemoneModel` (not vendored here — this page only needs
its *output*).

## Files

| File | What it is |
|---|---|
| `index.html` | The page. 14 sections plus hero and sources. |
| `app.css` | Styles. Self-contained: this page never imports from `../assets/`. |
| `app.js` | Diagrams, live models, charts. |
| `carbonate.js` | The seawater carbonate system, ported from `carbonate.py`. |
| `data/anemone-runs.json` | Precomputed model trajectories (13 KB). |
| `data/export.py` | Regenerates that JSON from the real model. |

## Live versus precomputed

Two kinds of computation, split on whether they are cheap:

**Live in the browser** — the bathtub, the two-box exchange, and the seawater
carbonate system in section 5. The carbonate system is the real thing:
`carbonate.js` is a direct port of `carbonate.py`, same published equilibrium
constants, no simplification.

**Precomputed** — every airborne-fraction curve. Those come from integrating a
stiff 8-state system across a million years with an implicit solver, which
belongs in Python. Porting it would create a second implementation of the
physics that could silently diverge from the model.

The upshot is that no number on this page is transcribed by hand. They are all
either computed live from published constants, or read from a JSON file the
model itself wrote.

## Regenerating the data

Run from the model repo, where `model.py` is importable:

```bash
cd ~/code/AnemoneModel
.venv/bin/python ~/code/nemoexplores/anemone/data/export.py
```

Takes a few minutes — five stages plus four pulse sizes, each integrated to a
million years twice (perturbed and control, so residual drift cancels).

Re-run it whenever the model changes. If the page starts disagreeing with the
model, this is why.

## Verifying the chemistry port

`carbonate.js` must agree with `carbonate.py`. To check, dump reference values
from Python across a grid of temperature, salinity, pressure, DIC and
alkalinity, then compare the JS against them.

Last checked: **25 cases × 11 quantities** (six equilibrium constants, pCO₂,
carbonate ion, pH, and the Revelle factor), worst relative difference
**1.7 × 10⁻¹²** — floating-point noise, not a porting error.

A quick sanity check without any tooling: open section 5, press *Preindustrial
surface*, and read the panel. It should show pCO₂ ≈ 279 µatm, pH ≈ 8.177,
Revelle ≈ 10.32. The model's own calibrated preindustrial state is 280.0 µatm,
pH 8.176, Revelle 10.33 — the small offset is only because the slider steps in
whole µmol/kg and the model's DIC is 2030.5.

## Serving

Needs HTTP, not `file://` — `app.js` is an ES module and fetches the JSON.

```bash
cd ~/code/nemoexplores && python3 -m http.server 8000
# http://127.0.0.1:8000/anemone/
```

The page detects a failed fetch and says so rather than rendering empty charts.
