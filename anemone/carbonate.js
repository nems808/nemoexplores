/* ---------------------------------------------------------------------------
   Seawater carbonate system — a direct port of carbonate.py from the ANEMONE
   model. Pure equilibrium algebra: no ODEs, no fitting, no free parameters.

   This is the part of the model that is *not* a modelling choice. Every
   constant below is a laboratory measurement of a thermodynamic equilibrium,
   published with its own uncertainty:

     K0    Weiss (1974)  Mar. Chem. 2, 203-215          CO2 solubility
     K1,K2 Lueker, Dickson & Keeling (2000)             carbonic acid
           Mar. Chem. 70, 105-119  (Mehrbach refit, total scale)
     KB    Dickson (1990) Deep-Sea Res. 37, 755-766     boric acid
     KW    Millero (1995) GCA 59, 661-677               water
     Ksp   Mucci (1983) Am. J. Sci. 283, 780-799        calcite solubility
     BT    Uppstrom (1974)                              total boron
     P-corr Millero (1995), Table 9

   All constants on the TOTAL pH scale, units mol/(kg-seawater), except K0
   which is mol/(kg-sw * atm).

   Validated against the Python original across a grid of temperature,
   salinity, pressure, DIC and alkalinity: 25 cases x 11 quantities, worst
   relative difference 1.7e-12. See README.md in this folder to re-run it.
--------------------------------------------------------------------------- */

const RGAS = 83.14472; // cm^3 bar mol^-1 K^-1

/** Millero (1995) pressure correction: returns K(P)/K(0). */
function pressureFactor(dV, dK, T, P) {
  return Math.exp(((-dV + 0.5 * dK * P) * P) / (RGAS * T));
}

/**
 * Equilibrium constants at temperature (degC), salinity, pressure (bar).
 * Returns { K0, K1, K2, KB, KW, Ksp, BT }.
 */
export function eqConstants(T_c, S, P_bar = 0) {
  const T = T_c + 273.15;
  const t = T_c;
  const sqS = Math.sqrt(S);
  const ln = Math.log;

  // K0, Henry's law solubility (Weiss 1974), mol/(kg atm)
  const T100 = T / 100;
  const K0 = Math.exp(
    -60.2409 + 93.4517 / T100 + 23.3585 * ln(T100) +
    S * (0.023517 - 0.023656 * T100 + 0.0047036 * T100 * T100)
  );

  // K1, K2 (Lueker et al. 2000, total scale)
  const pK1 = 3633.86 / T - 61.2172 + 9.6777 * ln(T) - 0.011555 * S + 0.0001152 * S * S;
  const pK2 = 471.78 / T + 25.929 - 3.16967 * ln(T) - 0.01781 * S + 0.0001122 * S * S;
  let K1 = Math.pow(10, -pK1);
  let K2 = Math.pow(10, -pK2);

  // KB (Dickson 1990, total scale)
  const lnKB =
    (-8966.9 - 2890.53 * sqS - 77.942 * S + 1.728 * Math.pow(S, 1.5) - 0.0996 * S * S) / T +
    148.0248 + 137.1942 * sqS + 1.62142 * S -
    (24.4344 + 25.085 * sqS + 0.2474 * S) * ln(T) +
    0.053105 * sqS * T;
  let KB = Math.exp(lnKB);

  // KW (Millero 1995, total scale)
  const lnKW =
    148.9802 - 13847.26 / T - 23.6521 * ln(T) +
    (-5.977 + 118.67 / T + 1.0495 * ln(T)) * sqS -
    0.01615 * S;
  let KW = Math.exp(lnKW);

  // Ksp calcite (Mucci 1983)
  const log10Ksp =
    -171.9065 - 0.077993 * T + 2839.319 / T + 71.595 * Math.log10(T) +
    (-0.77712 + 0.0028426 * T + 178.34 / T) * sqS -
    0.07711 * S + 0.0041249 * Math.pow(S, 1.5);
  let Ksp = Math.pow(10, log10Ksp);

  if (P_bar > 0) {
    K1 *= pressureFactor(-25.5 + 0.1271 * t, (-3.08 + 0.0877 * t) / 1000, T, P_bar);
    K2 *= pressureFactor(-15.82 - 0.0219 * t, (1.13 - 0.1475 * t) / 1000, T, P_bar);
    KB *= pressureFactor(-29.48 + 0.1622 * t - 0.002608 * t * t, -2.84 / 1000, T, P_bar);
    KW *= pressureFactor(-20.02 + 0.1119 * t - 0.001409 * t * t,
                         (-5.13 + 0.0794 * t) / 1000, T, P_bar);
    Ksp *= pressureFactor(-48.76 + 0.5304 * t, (-11.76 + 0.3692 * t) / 1000, T, P_bar);
  }

  return { K0, K1, K2, KB, KW, Ksp, BT: (0.0004157 * S) / 35 };
}

/** Total alkalinity implied by [H+] and DIC, minus the known TA. */
function alkResidual(h, C, A, K) {
  const carb = (C * K.K1 * (h + 2 * K.K2)) / (h * h + K.K1 * h + K.K1 * K.K2);
  const bor = (K.BT * K.KB) / (h + K.KB);
  return carb + bor + K.KW / h - h - A;
}

function alkResidualDeriv(h, C, A, K) {
  const { K1, K2, KB, KW, BT } = K;
  const D = h * h + K1 * h + K1 * K2;
  const dcarb = (C * K1 * (D - (h + 2 * K2) * (2 * h + K1))) / (D * D);
  const dbor = -(BT * KB) / Math.pow(h + KB, 2);
  return dcarb + dbor - KW / (h * h) - 1;
}

/**
 * [H+] on the total scale: bisection to bracket, then Newton to polish.
 *
 * The polish is not cosmetic. Bisection alone converges to a fixed tolerance,
 * which makes pCO2(DIC) a staircase at the 1e-14 level — enough to wreck a
 * stiff solver's finite-difference Jacobian in the Python original.
 */
export function solveH(C, A, K, lo = -10, hi = -4, nbis = 40, npol = 4) {
  let fLo = alkResidual(Math.pow(10, lo), C, A, K);
  const fHi = alkResidual(Math.pow(10, hi), C, A, K);
  if (fLo * fHi > 0) return fLo < 0 ? Math.pow(10, hi) : Math.pow(10, lo);

  for (let i = 0; i < nbis; i++) {
    const mid = 0.5 * (lo + hi);
    const fMid = alkResidual(Math.pow(10, mid), C, A, K);
    if (fMid * fLo > 0) { lo = mid; fLo = fMid; } else { hi = mid; }
  }
  let h = Math.pow(10, 0.5 * (lo + hi));
  for (let i = 0; i < npol; i++) {
    const hNew = h - alkResidual(h, C, A, K) / alkResidualDeriv(h, C, A, K);
    if (hNew <= 0) break;
    h = hNew;
  }
  return h;
}

/**
 * Given DIC and total alkalinity (both mol/kg), return
 * { pco2 (atm), co3 (mol/kg), pH (total scale) }.
 */
export function speciate(C, A, K) {
  const h = solveH(C, A, K);
  const denom = 1 + K.K1 / h + (K.K1 * K.K2) / (h * h);
  const co2aq = C / denom;
  const co3 = C / (1 + h / K.K2 + (h * h) / (K.K1 * K.K2));
  return { pco2: co2aq / K.K0, co3, pH: -Math.log10(h) };
}

/** Inverse: the DIC that yields a target pCO2 at fixed alkalinity. */
export function dicFromPco2(pco2, A, K, lo = 1e-4, hi = 5e-3) {
  for (let i = 0; i < 200; i++) {
    const mid = 0.5 * (lo + hi);
    if (speciate(mid, A, K).pco2 < pco2) lo = mid; else hi = mid;
  }
  return 0.5 * (lo + hi);
}

/**
 * Revelle factor: R = dln(pCO2)/dln(DIC) at constant alkalinity.
 *
 * This single number is why the ocean is not a bottomless sink. R ~ 10 means
 * a 1% rise in pCO2 buys only a 0.1% rise in dissolved carbon — and R itself
 * climbs as carbon goes in, so the ocean gets worse at absorbing the more it
 * absorbs.
 */
export function revelle(C, A, K, frac = 1e-4) {
  const d = C * frac;
  const pHi = speciate(C + d, A, K).pco2;
  const pLo = speciate(C - d, A, K).pco2;
  return (Math.log(pHi) - Math.log(pLo)) / (Math.log(C + d) - Math.log(C - d));
}
