"""Export real ANEMONE trajectories for the explainer page.

Every curve the page plots comes from here, so the page can never drift from
the model. This lives with the page rather than with the model because the
model does not depend on it.

Run it from the AnemoneModel repo root, where model.py can be imported:

    cd ~/code/AnemoneModel
    .venv/bin/python ~/code/nemoexplores/anemone/data/export.py

Takes a few minutes: it integrates five stages plus four pulse sizes across a
million years each, twice over (perturbed and control).
"""
import json, os
import numpy as np
import model as M
import carbonate as cb

OUT = os.path.expanduser("~/code/nemoexplores/anemone/data/anemone-runs.json")
DEC = 4  # plenty for plotting; keeps the file small

def thin(t, af, n=140):
    """Log-spaced subsample: the whole point is five decades of time."""
    keep = np.unique(np.concatenate(([0], np.geomspace(1, len(t) - 1, n).astype(int))))
    return t[keep], af[keep]

def r(a, d=DEC):
    return [round(float(v), d) for v in a]

p = M.calibrate(M.Params(), verbose=False)
Ks = cb.eq_constants(p.T_s, p.S, 0.0)
_, _, ph_s = cb.speciate(p.C_s0, p.A_s0, Ks)
oc_C = p.C_s0 * p.M_s + p.C_t0 * p.M_t + p.C_d0 * p.M_d

out = {
    "meta": {
        "model": "ANEMONE",
        "generated_by": "_export_web.py against model.py / carbonate.py",
        "pulse_reference_gtc": 1000.0,
        "note": "Airborne fraction is the perturbed-minus-control anomaly, "
                "exactly as run.py reports it.",
    },
    "calibrated": {
        "pco2_ppm": round(M.ppm(p.y0[M.IN]), 1),
        "atmosphere_gtc": round(M.gtc(p.y0[M.IN])),
        "surface_dic": round(p.C_s0 * 1e6, 1),
        "surface_ta": round(p.A_s0 * 1e6, 1),
        "surface_ph": round(float(ph_s), 3),
        "revelle": round(float(cb.revelle(p.C_s0, p.A_s0, Ks)), 2),
        "thermocline_dic": round(p.C_t0 * 1e6, 1),
        "thermocline_ta": round(p.A_t0 * 1e6, 1),
        "deep_dic": round(p.C_d0 * 1e6, 1),
        "deep_ta": round(p.A_d0 * 1e6, 1),
        "ocean_total_gtc": round(M.gtc(oc_C)),
        "ocean_over_atmosphere": round(float(oc_C / p.y0[M.IN])),
        "vent_thermocline_yr": round(float(p.M_t / p.Psi_st)),
        "vent_deep_yr": round(float(p.M_d / p.Psi_td)),
        "export_org_gtc": round(M.gtc(p.F_org), 2),
        "export_caco3_gtc": round(M.gtc(p.F_rain), 2),
        "rain_ratio": round(float(p.F_rain / p.F_org), 3),
        "burial_gtc": round(M.gtc(p.F_bur0), 3),
        "weathering_sil_gtc": round(M.gtc(p.F_sil0), 3),
        "weathering_carb_gtc": round(M.gtc(p.F_carb0), 3),
    },
    "stages": [],
    "pulses": [],
}

MARKS = [10, 100, 1000, 10000, 100000, 400000]

print("staged runs, 1000 GtC pulse")
for s in range(1, 6):
    res = M.run(p, s, pulse_gtc=1000.0, t_end=1.0e6, n_out=500)
    t, af = thin(res["t"], res["af"])
    out["stages"].append({
        "stage": s,
        "name": M.STAGES[s]["name"],
        "t": r(t, 3),
        "af": r(af),
        "marks": {str(m): round(float(M.af_at(res, [m])[0]), 3) for m in MARKS},
        "drift_ppm": round(float(res["drift_ppm"]), 3),
    })
    print(f"  stage {s}: {M.STAGES[s]['name']}  AF(100yr)="
          f"{out['stages'][-1]['marks']['100']}")

print("pulse sweep, stage 5")
for gtc in [500.0, 1000.0, 2000.0, 5000.0]:
    res = M.run(p, 5, pulse_gtc=gtc, t_end=1.0e6, n_out=500)
    t, af = thin(res["t"], res["af"])
    out["pulses"].append({
        "gtc": gtc,
        "t": r(t, 3),
        "af": r(af),
        "marks": {str(m): round(float(M.af_at(res, [m])[0]), 3) for m in MARKS},
    })
    print(f"  {gtc:6.0f} GtC: AF(100yr)={out['pulses'][-1]['marks']['100']}"
          f"  AF(1000yr)={out['pulses'][-1]['marks']['1000']}")

os.makedirs(os.path.dirname(OUT), exist_ok=True)
with open(OUT, "w") as fh:
    json.dump(out, fh, separators=(",", ":"))
print(f"\nwrote {OUT}  ({os.path.getsize(OUT)/1024:.0f} KB)")
