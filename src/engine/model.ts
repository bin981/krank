export type Fuel = "benzin" | "dizel";
export type Aspiration = "atmosferik" | "turbo";
export type LayoutId = "i3" | "i4" | "i6" | "v6" | "v8";

export interface EngineSpec {
  fuel: Fuel;
  aspiration: Aspiration;
  layout: LayoutId;
  /** mm */
  bore: number;
  /** mm */
  stroke: number;
  compression: number;
  /** Hedef turbo basıncı, bar (gösterge). Atmosferikte yok sayılır. */
  boostTarget: number;
}

export interface LayoutDef {
  id: LayoutId;
  label: string;
  cylinders: number;
  /** Bankalar arası tam açı. Sıra motorda 0. */
  bankAngle: number;
  /** 0 = +açı tarafı, 1 = -açı tarafı */
  banks: number[];
  /** Krank pim açısı, derece. 0 = +Y. */
  pin: number[];
  /** Ateşleme ÜÖN'ü, krank derecesi 0..720. */
  fire: number[];
  firingOrder: number[];
}

/**
 * Krank kuralı: θ krank açısı, pim açısı α.
 * Pim konumu (y, z) = r (cos(θ+α), sin(θ+α)).
 * Silindir ekseni (0, cos β, sin β) ile aynı hizaya geldiğinde piston ÜÖN'dedir.
 * Ateşleme, bu ÜÖN'lerden biridir (720° çevrimin tek tarafı).
 */
export const LAYOUTS: Record<LayoutId, LayoutDef> = {
  i3: {
    id: "i3",
    label: "Sıra 3",
    cylinders: 3,
    bankAngle: 0,
    banks: [0, 0, 0],
    pin: [0, 120, 240],
    fire: [0, 240, 480],
    firingOrder: [1, 2, 3],
  },
  i4: {
    id: "i4",
    label: "Sıra 4",
    cylinders: 4,
    bankAngle: 0,
    banks: [0, 0, 0, 0],
    pin: [0, 180, 180, 0],
    fire: [0, 540, 180, 360],
    firingOrder: [1, 3, 4, 2],
  },
  i6: {
    id: "i6",
    label: "Sıra 6",
    cylinders: 6,
    bankAngle: 0,
    banks: [0, 0, 0, 0, 0, 0],
    pin: [0, 240, 120, 120, 240, 0],
    fire: [0, 480, 240, 600, 120, 360],
    firingOrder: [1, 5, 3, 6, 2, 4],
  },
  v6: {
    id: "v6",
    label: "V6",
    cylinders: 6,
    bankAngle: 60,
    banks: [0, 1, 0, 1, 0, 1],
    // 60° V6 düzgün ateş için ayrık pim (split-pin): aynı muyluda iki açı.
    pin: [30, 90, 270, 210, 30, 90],
    fire: [0, 240, 480, 120, 360, 600],
    firingOrder: [1, 4, 2, 5, 3, 6],
  },
  v8: {
    id: "v8",
    label: "V8",
    cylinders: 8,
    bankAngle: 90,
    banks: [0, 1, 0, 1, 0, 1, 0, 1],
    pin: [0, 0, 90, 90, 270, 270, 180, 180],
    fire: [45, 675, 315, 225, 495, 405, 585, 135],
    firingOrder: [1, 8, 4, 3, 6, 5, 7, 2],
  },
};

export interface Preset {
  name: string;
  blurb: string;
  spec: EngineSpec;
}

export const PRESETS: Preset[] = [
  {
    name: "1.0 Sıra-3",
    blurb: "Küçük turbo benzin",
    spec: { fuel: "benzin", aspiration: "turbo", layout: "i3", bore: 71, stroke: 84, compression: 10.2, boostTarget: 1.05 },
  },
  {
    name: "1.6 Atmosferik",
    blurb: "Günlük sıra-4",
    spec: { fuel: "benzin", aspiration: "atmosferik", layout: "i4", bore: 78, stroke: 83.6, compression: 11, boostTarget: 0.6 },
  },
  {
    name: "2.0 Turbo",
    blurb: "Benzin, yüksek doldurma",
    spec: { fuel: "benzin", aspiration: "turbo", layout: "i4", bore: 82.5, stroke: 92.8, compression: 9.6, boostTarget: 1.25 },
  },
  {
    name: "2.0 TDI",
    blurb: "Turbo dizel",
    spec: { fuel: "dizel", aspiration: "turbo", layout: "i4", bore: 81, stroke: 95.5, compression: 16.2, boostTarget: 1.45 },
  },
  {
    name: "3.0 Sıra-6",
    blurb: "Atmosferik benzin",
    spec: { fuel: "benzin", aspiration: "atmosferik", layout: "i6", bore: 84, stroke: 89.6, compression: 11, boostTarget: 0.6 },
  },
  {
    name: "3.0 V6 Dizel",
    blurb: "Turbo V6",
    spec: { fuel: "dizel", aspiration: "turbo", layout: "v6", bore: 83, stroke: 91.4, compression: 16, boostTarget: 1.55 },
  },
  {
    name: "5.0 V8",
    blurb: "Atmosferik benzin",
    spec: { fuel: "benzin", aspiration: "atmosferik", layout: "v8", bore: 94, stroke: 90, compression: 11.4, boostTarget: 0.5 },
  },
  {
    name: "6.7 V8 Dizel",
    blurb: "Ağır hizmet turbo",
    spec: { fuel: "dizel", aspiration: "turbo", layout: "v8", bore: 107, stroke: 93, compression: 16.8, boostTarget: 1.7 },
  },
];

export interface CylGeom {
  index: number;
  bank: 0 | 1;
  /** Radyan, dikeyden. Sıra motorda 0. */
  beta: number;
  journal: number;
  journalX: number;
  /** Piston ekseninin krank boyuna konumu, mm. */
  x: number;
  /** Radyan. */
  pin: number;
  /** Ateşleme ÜÖN'ü, radyan (0..4π). */
  fire: number;
  fireDeg: number;
}

export interface Dims {
  bore: number;
  stroke: number;
  r: number;
  rod: number;
  crown: number;
  skirt: number;
  clearance: number;
  /** Eksen boyunca blok üst yüzeyi. */
  deck: number;
  /** Bloğun altı, eksen boyunca. */
  boreBottom: number;
  headH: number;
  spacing: number;
  pinR: number;
  mainR: number;
  maxLift: number;
  /** Triger kopunca supabın indiği derinlik. */
  crashLift: number;
}

const deg = (d: number) => (d * Math.PI) / 180;

export function computeDims(spec: EngineSpec): Dims {
  const bore = spec.bore;
  const stroke = spec.stroke;
  const r = stroke / 2;
  const rod = stroke * 1.65;
  const crown = bore * 0.36;
  const skirt = bore * 0.32;
  const clearance = bore * (spec.fuel === "dizel" ? 0.075 : clamp(0.2 - (spec.compression - 8) * 0.012, 0.085, 0.2));
  const deck = rod + r + crown + clearance;
  const boreBottom = rod - r - skirt - bore * 0.06;
  return {
    bore,
    stroke,
    r,
    rod,
    crown,
    skirt,
    clearance,
    deck,
    boreBottom,
    headH: bore * 0.78,
    spacing: bore * (spec.layout === "v6" || spec.layout === "v8" ? 1.36 : 1.28),
    pinR: bore * 0.22,
    mainR: bore * 0.26,
    maxLift: clearance * 0.62,
    crashLift: clearance + bore * 0.12,
  };
}

export function buildCylinders(spec: EngineSpec, dims: Dims = computeDims(spec)): CylGeom[] {
  const layout = LAYOUTS[spec.layout];
  const v = layout.bankAngle > 0;
  const perJournal = v ? 2 : 1;
  const journalCount = layout.cylinders / perJournal;
  const stagger = v ? dims.bore * 0.27 : 0;
  const out: CylGeom[] = [];
  for (let i = 0; i < layout.cylinders; i++) {
    const journal = v ? Math.floor(i / 2) : i;
    const journalX = (journal - (journalCount - 1) / 2) * dims.spacing;
    const bank = (v ? layout.banks[i] : 0) as 0 | 1;
    const half = deg(layout.bankAngle / 2);
    const beta = v ? (bank === 0 ? half : -half) : 0;
    const side = bank === 0 ? -1 : 1;
    out.push({
      index: i,
      bank,
      beta,
      journal,
      journalX,
      x: journalX + (v ? side * stagger * 0.5 : 0),
      pin: deg(layout.pin[i]),
      fire: deg(layout.fire[i]),
      fireDeg: layout.fire[i],
    });
  }
  return out;
}

export function axisFromBeta(beta: number): { y: number; z: number } {
  return { y: Math.cos(beta), z: Math.sin(beta) };
}

/** Pim ile eksen hizalı mı? 1 = tam ÜÖN. */
export function tdcAlignment(beta: number, pin: number, fireRad: number): number {
  const psi = fireRad + pin;
  const axisY = Math.cos(beta);
  const axisZ = Math.sin(beta);
  return axisY * Math.cos(psi) + axisZ * Math.sin(psi);
}

export function verifyLayouts(): string[] {
  const errors: string[] = [];
  (Object.keys(LAYOUTS) as LayoutId[]).forEach((id) => {
    const layout = LAYOUTS[id];
    const spec: EngineSpec = {
      fuel: "benzin",
      aspiration: "atmosferik",
      layout: id,
      bore: 86,
      stroke: 86,
      compression: 10,
      boostTarget: 1,
    };
    const cyls = buildCylinders(spec);
    cyls.forEach((c) => {
      const align = tdcAlignment(c.beta, c.pin, c.fire);
      if (align < 0.985) {
        errors.push(`${id} silindir ${c.index + 1} ÜÖN hizası ${align.toFixed(3)}`);
      }
    });
    const order = [...cyls].sort((a, b) => a.fireDeg - b.fireDeg).map((c) => c.index + 1);
    if (order.join("-") !== layout.firingOrder.join("-")) {
      errors.push(`${id} ateşleme ${order.join("-")} beklenen ${layout.firingOrder.join("-")}`);
    }
    const span = 720 / layout.cylinders;
    for (let i = 1; i < order.length; i++) {
      const a = cyls[order[i - 1] - 1].fireDeg;
      const b = cyls[order[i] - 1].fireDeg;
      if (Math.abs(b - a - span) > 1.5) {
        errors.push(`${id} ateş aralığı ${b - a}° (beklenen ${span}°)`);
      }
    }
    const first = cyls[order[0] - 1].fireDeg;
    const last = cyls[order[order.length - 1] - 1].fireDeg;
    if (Math.abs(first + 720 - last - span) > 1.5) {
      errors.push(`${id} çevrim kapanışı ${first + 720 - last}° (beklenen ${span}°)`);
    }
  });
  return errors;
}

export function displacementCc(spec: Pick<EngineSpec, "bore" | "stroke" | "layout">): number {
  const n = LAYOUTS[spec.layout].cylinders;
  const radius = spec.bore / 2;
  return (n * Math.PI * radius * radius * spec.stroke) / 1000;
}

export function redlineRpm(spec: EngineSpec): number {
  if (spec.fuel === "dizel") return spec.layout === "v8" ? 4200 : 4800;
  if (spec.layout === "i6") return 7800;
  if (spec.layout === "v8") return 6800;
  if (spec.layout === "i3") return 6500;
  return spec.aspiration === "turbo" ? 6500 : 7200;
}

export function peakTorqueRpm(spec: EngineSpec): number {
  if (spec.fuel === "dizel") return spec.aspiration === "turbo" ? 1900 : 2300;
  return spec.aspiration === "turbo" ? 3400 : 4600;
}

export interface PowerEstimate {
  torqueNm: number;
  powerKw: number;
  powerPs: number;
}

/** Basit ama ölçek olarak tanıdık bir BMEP modeli. Gaz kelebeği ve boost yükü belirler. */
export function estimatePower(spec: EngineSpec, rpm: number, throttle: number, boostBar: number): PowerEstimate {
  const liters = displacementCc(spec) / 1000;
  const red = redlineRpm(spec);
  const peakRpm = peakTorqueRpm(spec);
  let bmep = spec.fuel === "dizel" ? 11.2 : 10.4;
  bmep *= spec.fuel === "dizel" ? 0.9 + spec.compression / 90 : 0.9 + spec.compression / 55;
  if (spec.aspiration === "turbo") {
    const abs = (1.013 + Math.max(0, boostBar)) / 1.013;
    bmep *= abs * (spec.fuel === "dizel" ? 0.78 : 0.86);
  } else if (spec.fuel === "benzin") {
    bmep *= 1.12;
  }
  const load = spec.fuel === "dizel" ? 0.16 + 0.84 * throttle : 0.1 + 0.9 * throttle;
  let shape: number;
  if (rpm <= peakRpm) shape = Math.sin((rpm / Math.max(1, peakRpm)) * Math.PI * 0.5);
  else {
    const t = clamp((rpm - peakRpm) / Math.max(1, red - peakRpm), 0, 1.4);
    shape = Math.max(0.08, 1 - t * (spec.fuel === "dizel" ? 0.62 : 0.4));
  }
  const bmepPa = bmep * 1e5 * load * shape;
  const vd = liters / 1000;
  const torqueNm = (bmepPa * vd) / (4 * Math.PI);
  const powerKw = (torqueNm * rpm * 2 * Math.PI) / 60 / 1000;
  return { torqueNm, powerKw, powerPs: powerKw * 1.35962 };
}

export function cylinderPressureBar(
  phaseDeg: number,
  spec: EngineSpec,
  boostBar: number,
  throttle: number,
  leak: boolean,
): number {
  const phase = wrap720(phaseDeg);
  const cr = spec.compression;
  const pIn = 0.98 + Math.max(0, boostBar) * 0.9;
  const leakK = leak ? 0.58 : 1;
  const pComp = pIn * Math.pow(cr, 1.28) * leakK;
  if (phase >= 360 && phase < 540) return pIn * (0.9 + 0.06 * throttle);
  if (phase >= 180 && phase < 360) return 1.05 + Math.max(0, boostBar) * 0.12 + throttle * 0.15;
  if (phase >= 540) {
    const t = (phase - 540) / 180;
    const ratio = 1 + (cr * leakK - 1) * Math.pow(t, 1.15);
    return Math.max(pIn, pIn * Math.pow(ratio, 1.28));
  }
  const rise = Math.min(1, phase / (spec.fuel === "dizel" ? 24 : 14));
  const burn = Math.sin(rise * Math.PI * 0.5) * Math.exp(-Math.max(0, phase - 8) / (spec.fuel === "dizel" ? 58 : 34));
  const peak = pComp * (spec.fuel === "dizel" ? 1.55 : 2.05) * (0.42 + 0.58 * throttle);
  const expansion = pComp * Math.pow(Math.max(0.18, 1 - phase / 210), 1.12);
  return Math.max(1, expansion * (1 - burn) + peak * burn);
}

export type StrokeId = "power" | "exhaust" | "intake" | "compression";

export function strokeOf(phaseDeg: number, fuel: Fuel): { id: StrokeId; label: string } {
  const phase = wrap720(phaseDeg);
  if (phase < 180) return { id: "power", label: fuel === "dizel" ? "Yanma" : "Ateşleme" };
  if (phase < 360) return { id: "exhaust", label: "Egzoz" };
  if (phase < 540) return { id: "intake", label: "Emme" };
  return { id: "compression", label: "Sıkıştırma" };
}

export function valveLift01(phaseDeg: number, center: number, openWidth: number): number {
  const phase = wrap720(phaseDeg);
  let d = Math.abs(phase - center);
  d = Math.min(d, 720 - d);
  const half = openWidth / 2;
  if (d >= half) return 0;
  const x = d / half;
  return Math.cos(x * Math.PI * 0.5) ** 1.35;
}

export function phaseDeg(crankDeg: number, fireDeg: number): number {
  return wrap720(crankDeg - fireDeg);
}

export function wrap720(d: number): number {
  return ((d % 720) + 720) % 720;
}

export function clamp(v: number, a: number, b: number): number {
  return Math.max(a, Math.min(b, v));
}

export function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = clamp((x - edge0) / Math.max(1e-6, edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}

export function engineTitle(spec: EngineSpec): string {
  const liters = displacementCc(spec) / 1000;
  const L = new Intl.NumberFormat("tr-TR", { minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(liters);
  const fuel = spec.fuel === "dizel" ? "Dizel" : "Benzin";
  const asp = spec.aspiration === "turbo" ? "Turbo" : "Atmosferik";
  return `${L} ${LAYOUTS[spec.layout].label} ${asp} ${fuel}`;
}

export function firingOrderLabel(layout: LayoutId): string {
  return LAYOUTS[layout].firingOrder.join(" – ");
}

export const nf0 = new Intl.NumberFormat("tr-TR", { maximumFractionDigits: 0 });
export const nf1 = new Intl.NumberFormat("tr-TR", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
export const nf2 = new Intl.NumberFormat("tr-TR", { minimumFractionDigits: 1, maximumFractionDigits: 2 });
