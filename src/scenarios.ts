import type { Simulation } from "./engine/sim";

export type Smoke = "none" | "white" | "blue" | "black";

export interface ScenarioDef {
  id: string;
  cat: "Elektrik" | "Yakıt" | "Ateşleme" | "Soğutma" | "Yağlama" | "Mekanik" | "Turbo/Emisyon" | "Çalıştırma";
  name: string;
  codes: string[];
  hint: string;
  smoke: Smoke;
  lamps: { bat?: boolean; oil?: boolean; temp?: boolean; cel?: boolean; glow?: boolean };
  prime?: (sim: Simulation) => void;
  tick?: (sim: Simulation, dt: number) => void;
}

export const SCENARIOS: ScenarioDef[] = [
  {
    id: "weak-battery",
    cat: "Elektrik",
    name: "Zayıf akü",
    codes: ["P0562"],
    hint: "Marş yavaş. Dinlenme voltajı 12 V’un altında, marşta 9 V’un altına düşer.",
    smoke: "none",
    lamps: { bat: true },
    prime: (s) => { s.batteryWeak = true; },
    tick: (s) => { s.voltage = s.cranking ? 8.6 : s.caught ? 13.2 : 12.0; },
  },
  {
    id: "dead-battery",
    cat: "Elektrik",
    name: "Bitik akü",
    codes: ["P0562"],
    hint: "Hiç marş yok. Voltaj 8 V altında, lamba sönük kalır.",
    smoke: "none",
    lamps: { bat: true },
    prime: (s) => { s.batteryWeak = true; s.noCrank = true; },
    tick: (s) => { s.voltage = 7.4; s.caught = false; s.targetRpm = 0; },
  },
  {
    id: "corroded",
    cat: "Elektrik",
    name: "Oksitli kutup",
    codes: ["P0562"],
    hint: "Marşta voltaj çöker, motor bazen tekler. Kutupta beyaz-yeşil tortu düşün.",
    smoke: "none",
    lamps: { bat: true },
    tick: (s) => { if (s.cranking || s.rpm > 1500) s.voltage = 9.1; },
  },
  {
    id: "bad-starter",
    cat: "Elektrik",
    name: "Marş motoru / selenoid",
    codes: ["P0615"],
    hint: "Kontak START’ta tek tık. Volan dönmez. Akü voltajı yerinde kalır.",
    smoke: "none",
    lamps: {},
    prime: (s) => { s.starterDead = true; },
  },
  {
    id: "alternator",
    cat: "Elektrik",
    name: "Alternatör arızası",
    codes: ["P0562"],
    hint: "Akü lambası yanar. Motor çalışırken voltaj 12 V’un altına iner.",
    smoke: "none",
    lamps: { bat: true, cel: true },
    prime: (s) => { s.alternatorDead = true; },
    tick: (s) => { if (s.caught && s.rpm > 600) s.voltage = Math.max(10.8, s.voltage - 0.015); },
  },
  {
    id: "misfire-coil",
    cat: "Ateşleme",
    name: "Buji / bobin teklemeleri",
    codes: ["P0300", "P0301"],
    hint: "Bir silindir ateşlemiyor. Egzoz patlaması, rölanti dalgalanır.",
    smoke: "none",
    lamps: { cel: true },
    prime: (s) => { s.misfireCyl = 0; },
    tick: (s) => { s.stft = 8; },
  },
  {
    id: "injector-clog",
    cat: "Yakıt",
    name: "Tıkalı enjektör",
    codes: ["P0201", "P0301"],
    hint: "Tek silindir fakir kalır. Çekiş düşer, o silindir soğuktur.",
    smoke: "none",
    lamps: { cel: true },
    prime: (s) => { s.misfireCyl = 0; },
    tick: (s) => { s.railBar *= 0.92; s.stft = 12; },
  },
  {
    id: "injector-leak",
    cat: "Yakıt",
    name: "Kaçak enjektör",
    codes: ["P0201"],
    hint: "Dizelde vuruntu ve siyah duman. Rail basıncı tutmuyor.",
    smoke: "black",
    lamps: { cel: true },
    tick: (s) => { s.railBar *= 0.7; s.knock = Math.max(s.knock, 0.45); s.stft = -15; },
  },
  {
    id: "glow-fail",
    cat: "Ateşleme",
    name: "Kızdırma bujisi",
    codes: ["P0380"],
    hint: "Soğuk dizel zor tutar, beyaz duman. Kızdırma lambası söner ama ısı yoktur.",
    smoke: "white",
    lamps: { glow: true, cel: true },
    prime: (s) => { s.cold = true; s.glow = 0; },
    tick: (s) => { s.coolant = Math.min(s.coolant, 40); if (s.cranking) s.crankAge = Math.min(s.crankAge, 0.4); },
  },
  {
    id: "dpf",
    cat: "Turbo/Emisyon",
    name: "Tıkalı DPF",
    codes: ["P2002", "P2463"],
    hint: "Limp modu, siyah duman, çekiş kesilir. Egzoz karşı basıncı yüksek.",
    smoke: "black",
    lamps: { cel: true },
    prime: (s) => { s.limp = true; },
  },
  {
    id: "egr",
    cat: "Turbo/Emisyon",
    name: "Tıkalı EGR",
    codes: ["P0401"],
    hint: "Rölanti kaba, egzoz kokusu. EGR akışı yetersiz.",
    smoke: "black",
    lamps: { cel: true },
    tick: (s) => { s.stft = 6; },
  },
  {
    id: "turbo-fail",
    cat: "Turbo/Emisyon",
    name: "Turbo arızası",
    codes: ["P0299"],
    hint: "Islık bozulur, mavi duman, boost sıfır. Yağ türbinden kaçar.",
    smoke: "blue",
    lamps: { cel: true },
    prime: (s) => { s.turboFail = true; },
  },
  {
    id: "boost-leak",
    cat: "Turbo/Emisyon",
    name: "Boost kaçağı",
    codes: ["P0299"],
    hint: "Turbo sağlam görünür ama basınç hortumdan kaçar. Çekiş yok.",
    smoke: "none",
    lamps: { cel: true },
    prime: (s) => { s.boostLeak = true; },
    tick: (s) => { s.boost *= 0.15; },
  },
  {
    id: "gasket",
    cat: "Soğutma",
    name: "Kapak contası",
    codes: ["P0217", "P0300"],
    hint: "Beyaz duman, hararet, depoda kabarcık, su eksilir.",
    smoke: "white",
    lamps: { temp: true, cel: true },
    prime: (s) => { s.gasket = true; s.leakCyls = new Set([0, 1]); },
    tick: (s) => { s.coolant = Math.min(140, s.coolant + 0.08); },
  },
  {
    id: "thermostat",
    cat: "Soğutma",
    name: "Termostat kapalı kaldı",
    codes: ["P0217", "P0128"],
    hint: "Hararet hızla çıkar, alt hortum soğuk kalır.",
    smoke: "none",
    lamps: { temp: true },
    tick: (s) => { s.coolant = Math.min(130, s.coolant + 0.12); },
  },
  {
    id: "water-pump",
    cat: "Soğutma",
    name: "Devirdaim pompası",
    codes: ["P0217"],
    hint: "Su dolaşmaz. Hararet, fan yetişemez, kayış tarafı kuru veya salgılıdır.",
    smoke: "white",
    lamps: { temp: true },
    tick: (s) => { s.coolant = Math.min(135, s.coolant + 0.1); },
  },
  {
    id: "low-oil",
    cat: "Yağlama",
    name: "Düşük yağ basıncı",
    codes: ["P0520"],
    hint: "Yağ lambası, vuruntu, sonra biyel yatağı dağılır.",
    smoke: "none",
    lamps: { oil: true },
    prime: (s) => { s.oilLevel = 0.12; },
    tick: (s) => {
      s.oil = Math.min(s.oil, 0.6);
      if (s.scenarioAge > 8 && s.rodStage === 0 && s.rpm > 1500) s.trigger("rod");
    },
  },
  {
    id: "timing",
    cat: "Mekanik",
    name: "Triger atlaması / kopması",
    codes: ["P0016"],
    hint: "Supap pistonla buluşur. Motor bir anda kilitlenir.",
    smoke: "none",
    lamps: { cel: true },
    prime: (s) => { s.timing = true; },
  },
  {
    id: "vtec-solenoid",
    cat: "Mekanik",
    name: "VTEC selenoidi / yağ",
    codes: ["P2646"],
    hint: "Geçiş devrinde kam değişmez. Çekiş kesilir, motor arıza lambası yanar.",
    smoke: "none",
    lamps: { cel: true, oil: true },
    prime: (s) => { s.vtecBlocked = true; },
  },
  {
    id: "vacuum",
    cat: "Yakıt",
    name: "Vakum kaçağı",
    codes: ["P0171"],
    hint: "Rölanti yüksek ve dalgalı. Kısa ve uzun yakıt düzeltmesi artı tarafta.",
    smoke: "none",
    lamps: { cel: true },
    tick: (s) => { s.stft = 18; s.ltft = 12; },
  },
  {
    id: "fuel-pump",
    cat: "Yakıt",
    name: "Yakıt pompası",
    codes: ["P0087"],
    hint: "Marş basar, tutmaz. Rail basıncı sıfıra yakın.",
    smoke: "none",
    lamps: { cel: true },
    prime: (s) => { s.noFuel = true; },
    tick: (s) => { s.railBar = 0; s.caught = false; s.targetRpm = Math.min(s.targetRpm, s.cranking ? 230 : 0); },
  },
  {
    id: "air-filter",
    cat: "Yakıt",
    name: "Tıkalı hava filtresi",
    codes: ["P0101"],
    hint: "Siyahımsı egzoz, güçsüzlük. Hava kütlesi düşük.",
    smoke: "black",
    lamps: { cel: true },
    tick: (s) => { s.stft = -8; s.boost *= 0.6; },
  },
  {
    id: "cold-start",
    cat: "Çalıştırma",
    name: "Soğuk çalıştırma",
    codes: [],
    hint: "Hararet düşük, yakıt düzeltmesi zengin. Dizelde kızdırma gerekir.",
    smoke: "white",
    lamps: { glow: true },
    prime: (s) => { s.cold = true; s.coolant = 18; },
    tick: (s) => { s.stft = 14; s.coolant = Math.min(90, s.coolant + 0.02); },
  },
  {
    id: "warm",
    cat: "Çalıştırma",
    name: "Sıcak motor",
    codes: [],
    hint: "İşletme sıcaklığı. Düzeltmeler sıfıra yakın, yağ basıncı oturmuş.",
    smoke: "none",
    lamps: {},
    prime: (s) => { s.coolant = 92; s.cold = false; },
  },
];

export function scenarioById(id: string): ScenarioDef | undefined {
  return SCENARIOS.find((s) => s.id === id);
}

export function applyScenario(sim: Simulation, dt: number): void {
  const def = scenarioById(sim.scenarioId);
  sim.smoke = def?.smoke ?? "none";
  sim.lamps = { bat: false, oil: false, temp: false, cel: false, glow: false, ...(def?.lamps ?? {}) };
  if (!def) return;
  sim.scenarioAge += dt;
  def.tick?.(sim, dt);
  if (sim.limp) sim.targetRpm = Math.min(sim.targetRpm, 2200);
}
