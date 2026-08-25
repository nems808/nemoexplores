# How to Model a Planet · ANEMONE explainer

A single-page vertical explainer that builds box models from one box up to
ANEMONE, a six-reservoir carbon-cycle model. Eighteen sections, ending with two
validation sections and an honest list of what the model gets wrong.

Source model: `~/code/AnemoneModel`. It is not vendored here, since this page
only needs its output.

## Files

| File | What it is |
|---|---|
| `index.html` | The page. 18 sections plus hero and references. |
| `app.css` | Styles. Self-contained: this page never imports from `../assets/`. |
| `app.js` | Diagrams, live models, charts. |
| `carbonate.js` | The seawater carbonate system, ported from `carbonate.py`. |
| `data/anemone-runs.json` | Precomputed model trajectories, including the historical run and the bomb-radiocarbon tracer (79 KB). |
| `data/export.py` | Regenerates that JSON from the real model. |

## Live versus precomputed

Two kinds of computation, split on whether they are cheap:

**Live in the browser.** The bathtub, the two-box exchange, the seawater
carbonate system in section 5, and the weathering thermostat in section 11. The
carbonate system is the real thing: `carbonate.js` is a direct port of
`carbonate.py`, same published equilibrium constants, no simplification. The
thermostat qualifies for the same reason: evaluating the WHAK law at one pCO₂
is algebra, not an integration, so the slider can recompute it directly. Its
constants are not copied into `app.js` — they are read from the
`weathering_law` block of the JSON, which `export.py` fills from the model's
own `Params`, so the slider cannot drift from the model either.

**Precomputed.** Every airborne-fraction curve. Those come from integrating a
stiff 8-state system across a million years with an implicit solver, which
belongs in Python. Porting it would create a second implementation of the
physics that could silently diverge from the model.

The `staircase` block belongs to the same category for a subtler reason. Those
are the times at which a pulse has half, three quarters, nine tenths, 95% and
99% gone, and section 18 is built on them. They are solved on a 20,000-point
run rather than reconstructed from the thinned curve the charts plot, because
the thinning is chosen to look right on a log axis and is far too coarse at the
tail to locate a 99% crossing: the samples either side of it differ by a factor
of five in airborne fraction.

The upshot is that no number on this page is transcribed by hand. They are all
either computed live from published constants, or read from a JSON file the
model itself wrote.

## Regenerating the data

Run from the model repo, where `model.py` is importable:

```bash
cd ~/code/AnemoneModel
.venv/bin/python ~/code/nemoexplores/anemone/data/export.py
```

Takes a few minutes: five stages plus four pulse sizes, each integrated to a
million years twice (perturbed and control, so residual drift cancels), then
the historical run over three climate sensitivities and the radiocarbon run.

Re-run it whenever the model changes. If the page starts disagreeing with the
model, this is why.

## Verifying the chemistry port

`carbonate.js` must agree with `carbonate.py`. To check, dump reference values
from Python across a grid of temperature, salinity, pressure, DIC and
alkalinity, then compare the JS against them.

Last checked: **25 cases × 11 quantities** (six equilibrium constants, pCO₂,
carbonate ion, pH, and the Revelle factor), worst relative difference
**1.7 × 10⁻¹²**, which is floating-point noise rather than a porting error.

A quick sanity check without any tooling: open section 5, press *Preindustrial
surface*, and read the panel. It should show pCO₂ ≈ 279 µatm, pH ≈ 8.177,
Revelle ≈ 10.32. The model's own calibrated preindustrial state is 280.0 µatm,
pH 8.176, Revelle 10.33. The small offset is only because the slider steps in
whole µmol/kg and the model's DIC is 2030.5.

## Serving

Needs HTTP rather than `file://`, because `app.js` is an ES module and fetches the JSON.

```bash
cd ~/code/nemoexplores && python3 -m http.server 8000
# http://127.0.0.1:8000/anemone/
```

The page detects a failed fetch and says so rather than rendering empty charts.
