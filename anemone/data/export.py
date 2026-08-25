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
import json, os, sys
sys.path.insert(0, os.getcwd())   # model.py lives in the cwd
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
        "outgassing_gtc": round(M.gtc(p.F_volc), 3),
    },
    # Section 11 recomputes the weathering law live in the browser, so it needs
    # the model's own exponents rather than a second copy of them in app.js.
    "weathering_law": {
        "n_sil": float(p.n_sil),
        "dT_weath": float(p.dT_weath),
        "ecs": float(p.ecs),
        "pco2_0_ppm": round(float(p.pco2_0) * 1e6, 1),
        "sil_gtc": round(M.gtc(p.F_sil0), 6),
        "carb_gtc": round(M.gtc(p.F_carb0), 6),
        "volc_gtc": round(M.gtc(p.F_volc), 6),
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

# Section 18 reads the staircase off these. They are solved at full solver
# resolution rather than reconstructed from the thinned curve above, because
# the thinning is chosen for plotting and is far too coarse at the tail to
# locate a 99% crossing.
print("staircase, stage 5, 1000 GtC")
_st = M.run(p, 5, pulse_gtc=1000.0, t_end=1.0e6, n_out=20000)
_t, _af = np.asarray(_st["t"]), np.asarray(_st["af"])

def crossing(thr):
    """First time the airborne fraction falls to thr, interpolated in log t."""
    i = int(np.argmax(_af <= thr))
    if _af[i] > thr:
        return None
    t0, t1 = max(float(_t[i - 1]), 1e-6), max(float(_t[i]), 1e-6)
    a0, a1 = float(_af[i - 1]), float(_af[i])
    f = (a0 - thr) / (a0 - a1)
    return float(np.exp(np.log(t0) + f * (np.log(t1) - np.log(t0))))

out["staircase"] = {
    "pulse_gtc": 1000.0,
    "levels": [{"gone": g, "af": round(1.0 - g, 2), "t": round(crossing(1.0 - g), 1)}
               for g in [0.50, 0.75, 0.90, 0.95, 0.99]],
}
for _L in out["staircase"]["levels"]:
    print(f"  {_L['gone']*100:.0f}% gone at {_L['t']:,.0f} yr")

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

# ----------------------------------------------------------------------
# validation: the historical run and the bomb-radiocarbon tracer
# ----------------------------------------------------------------------
import historical as H
import radiocarbon as R

def sub(t, arrs, lo, hi, step):
    """Clip to a window and thin, keeping every array in step."""
    idx = [i for i in range(0, len(t), step) if lo <= t[i] <= hi]
    return [round(float(t[i]), 1) for i in idx], {
        k: [round(float(v[i]), 3) for i in idx] for k, v in arrs.items()
    }

print("historical run vs observations")
obs = H.load_observations()
res = H.run_historical(p, obs, ecs_values=H.ECS_LIKELY, t_start=1750.0,
                       duration=400.0, n_out=1601)
lo_p, hi_p = res["band"]["pco2_atm"]
lo_T, hi_T = res["band"]["dT"]
t_h, arrs = sub(res["t"], {
    "pco2": res["central"]["pco2_atm"], "pco2_lo": lo_p, "pco2_hi": hi_p,
    "dT": res["central"]["dT"], "dT_lo": lo_T, "dT_hi": hi_T,
    "ph": res["central"]["pH"],
}, 1850, 2100, 2)

def at(year, series):
    return float(np.interp(year, res["t"], series))

mlo = obs["co2_mlo"]; tobs = obs["temperature"]
hist = {
    "t": t_h, **arrs,
    "ecs_range": list(H.ECS_LIKELY),
    "emissions": [[round(float(y), 0), round(float(g), 3)]
                  for y, g in obs["emissions"][::4]],
    "obs_co2_ice": [[round(float(r[0]), 0), round(float(r[1]), 1)]
                    for r in obs["co2_ice"][::5] if r[0] >= 1850],
    "obs_co2_mlo": [[round(float(r[0]), 0), round(float(r[1]), 1)] for r in mlo],
    "obs_temp": [[round(float(r[0]), 0), round(float(r[1]), 3)]
                 for r in tobs if r[0] >= 1850],
    "y2024": {
        "pco2_model_lo": round(at(2024, lo_p), 1),
        "pco2_model_hi": round(at(2024, hi_p), 1),
        "pco2_obs": round(float(mlo[mlo[:, 0] == 2024, 1][0]), 1),
        "dT_model_lo": round(at(2024, lo_T), 2),
        "dT_model_hi": round(at(2024, hi_T), 2),
        "dT_obs": round(float(tobs[tobs[:, 0] == 2024, 1][0]), 2),
    },
}
print(f"  2024 pCO2 model {hist['y2024']['pco2_model_lo']}-{hist['y2024']['pco2_model_hi']}"
      f" vs {hist['y2024']['pco2_obs']} observed")
out["historical"] = hist

print("bomb radiocarbon")
rb = M.run_bomb(p, stage=5, t_start=1850.0, t_end=2030.0)
t_r, r_arrs = sub(rb["t"], {
    "atm": rb["d14c_atm"], "surf": rb["d14c_s"],
    "therm": rb["d14c_t"], "deep": rb["d14c_d"],
}, 1850, 2030, 2)
# The natural gradients are PREDICTIONS: solve the pre-bomb 14C steady state
# from the spun-up carbon state and read off each box.
y8 = M.spin_up(p, 5)
n0, _Q = M.radiocarbon_steady_state(p, 5, y8)
out["radiocarbon"] = {
    "t": t_r, **r_arrs,
    "obs_atm": [[int(y), int(v)] for y, v in R.OBS_ATM_D14C],
    "natural": {
        "surface_model": round(float(M.d14c(n0[1], y8[M.IC_S])), 1),
        "thermocline_model": round(float(M.d14c(n0[2], y8[M.IC_T])), 1),
        "deep_model": round(float(M.d14c(n0[3], y8[M.IC_D])), 1),
        "surface_obs": R.OBS_STEADY["surface"],
        "thermocline_obs": R.OBS_STEADY["thermocline"],
        "deep_obs": R.OBS_STEADY["deep"],
    },
}
print(f"  natural deep model {out['radiocarbon']['natural']['deep_model']} permil"
      f" vs {R.OBS_STEADY['deep']}")

os.makedirs(os.path.dirname(OUT), exist_ok=True)
with open(OUT, "w") as fh:
    json.dump(out, fh, separators=(",", ":"))
print(f"\nwrote {OUT}  ({os.path.getsize(OUT)/1024:.0f} KB)")
