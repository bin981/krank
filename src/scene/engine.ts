import * as THREE from "three";
import { CSS2DObject } from "three/addons/renderers/CSS2DRenderer.js";
import {
  type EngineSpec,
  type CylGeom,
  LAYOUTS,
  buildCylinders,
  computeDims,
  displacementCc,
  engineTitle,
  phaseDeg,
  camLift,
  lobesFor,
  nf0,
  nf1,
  type Dims,
} from "../engine/model";
import type { Simulation } from "../engine/sim";
import type { ViewState } from "../view";
import { ParticleField } from "./particles";

interface RodRig {
  pivot: THREE.Group;
  shaft: THREE.Object3D;
  big: THREE.Group;
}

interface LiveCyl {
  geom: CylGeom;
  axis: THREE.Vector3;
  exhaustDir: THREE.Vector3;
  intakeDir: THREE.Vector3;
  piston: THREE.Group;
  rod: RodRig;
  intake: THREE.Group;
  exhaust: THREE.Group;
  glow: THREE.Mesh;
  glowMat: THREE.MeshBasicMaterial;
  intakePort: THREE.Vector3;
  exhaustPort: THREE.Vector3;
  flying: boolean;
  flyV: THREE.Vector3;
}

interface BankRig {
  q: THREE.Quaternion;
  pivot: THREE.Group;
  head: THREE.Group;
  cover: THREE.Group;
  cams: THREE.Object3D[];
  exhaustSign: number;
}

interface Chunk {
  mesh: THREE.Object3D;
  v: THREE.Vector3;
  av: THREE.Vector3;
  age: number;
  embed: null | { dur: number; from: THREE.Vector3; to: THREE.Vector3; dir: THREE.Vector3 };
}

const COL_EXH = new THREE.Color(0.42, 0.36, 0.32);
const COL_HOT = new THREE.Color(1, 0.42, 0.12);
const COL_WHITE = new THREE.Color(0.92, 0.94, 0.93);
const COL_BLUE = new THREE.Color(0.35, 0.48, 0.95);
const COL_AIR = new THREE.Color(0.62, 0.82, 1);

function roundedRect(shape: THREE.Shape, x: number, y: number, w: number, h: number, r: number): void {
  const rr = Math.max(0.5, Math.min(r, w / 2 - 0.2, h / 2 - 0.2));
  shape.moveTo(x + rr, y);
  shape.lineTo(x + w - rr, y);
  shape.quadraticCurveTo(x + w, y, x + w, y + rr);
  shape.lineTo(x + w, y + h - rr);
  shape.quadraticCurveTo(x + w, y + h, x + w - rr, y + h);
  shape.lineTo(x + rr, y + h);
  shape.quadraticCurveTo(x, y + h, x, y + h - rr);
  shape.lineTo(x, y + rr);
  shape.quadraticCurveTo(x, y, x + rr, y);
}

export class EngineAssembly {
  readonly root = new THREE.Group();
  readonly basePos = new THREE.Vector3();
  readonly feetY: number;
  private readonly spec: EngineSpec;
  private readonly dims: Dims;
  private readonly cyls: LiveCyl[] = [];
  private readonly banks: BankRig[] = [];
  private readonly geos: THREE.BufferGeometry[] = [];
  private readonly mats: THREE.Material[] = [];
  private readonly housing: THREE.MeshStandardMaterial[] = [];
  private readonly hideInCut: THREE.Object3D[] = [];
  private readonly labels: CSS2DObject[] = [];
  private readonly chunks: Chunk[] = [];
  private readonly particles = new ParticleField();
  private readonly crank: THREE.Group;
  private readonly belt: THREE.Group;
  private readonly gasketMat: THREE.MeshStandardMaterial;
  private readonly exhaustMat: THREE.MeshStandardMaterial;
  private readonly turboMat: THREE.MeshStandardMaterial;
  private readonly glowPlugMats: THREE.MeshStandardMaterial[] = [];
  private turboWheels: THREE.Object3D[] = [];
  private turboAngle = 0;
  private pan: THREE.Object3D | null = null;
  private panBase = 0;
  private xrayOn = false;
  private rodGone = false;
  private holeMade = false;
  private pop = 0;
  private frozenCam: number | null = null;
  private impacted = false;
  private badgeTex: THREE.CanvasTexture | null = null;
  private badgeCanvas: HTMLCanvasElement | null = null;
  private bubbles: THREE.Mesh[] = [];
  private pulleyPoints: THREE.Vector3[] = [];
  private crankPulleyX = 0;
  private readonly v1 = new THREE.Vector3();
  private readonly v2 = new THREE.Vector3();
  private readonly v3 = new THREE.Vector3();
  private readonly q1 = new THREE.Quaternion();
  private readonly down = new THREE.Vector3(0, -1, 0);
  private fireLocal = new THREE.Vector3();
  private fireStrength = 0;
  hoverName = "";
  private vtecPin: THREE.Mesh | null = null;

  constructor(spec: EngineSpec) {
    this.spec = spec;
    this.dims = computeDims(spec);
    this.root.scale.setScalar(0.01);
    this.root.name = "engine";
    this.crank = new THREE.Group();
    this.belt = new THREE.Group();
    this.gasketMat = this.housingMat(0x2a2c28, 0.55, 0.15);
    this.exhaustMat = this.housingMat(spec.fuel === "dizel" ? 0x6a463c : 0x7a5144, 0.42, 0.72);
    this.exhaustMat.emissive = new THREE.Color(0xff4a16);
    this.turboMat = this.housingMat(0x8a8f96, 0.28, 0.92);
    this.turboMat.emissive = new THREE.Color(0xff5a22);
    this.build();
    this.root.add(this.particles.points);
    this.feetY = -Math.max(this.dims.bore * 1.42, this.dims.r * 2.6);
    this.buildStands();
    this.root.traverse((obj) => {
      obj.frustumCulled = false;
    });
  }

  refreshBadge(): void {
    if (!this.badgeCanvas || !this.badgeTex) return;
    paintBadge(this.badgeCanvas, this.spec);
    this.badgeTex.needsUpdate = true;
  }

  update(sim: Simulation, view: ViewState, dt: number, fireLight: THREE.PointLight): void {
    const dims = this.dims;
    const crankRad = (sim.crankDeg * Math.PI) / 180;
    this.crank.rotation.x = sim.seized && sim.rpm < 40 ? this.crank.rotation.x : crankRad;

    const targetPop = sim.rodStage === 2 ? dims.bore * 0.9 : 0;
    this.pop += (targetPop - this.pop) * (1 - Math.exp(-dt / 0.16));
    const shift = view.explode * dims.bore * 1.6 + this.pop;
    const pistonExtra = view.explode * dims.bore * 0.7;

    for (const bank of this.banks) {
      bank.head.position.y = shift;
      bank.cover.position.y = view.explode * dims.bore * 1.05;
      const camAngle = sim.timing ? (this.frozenCam ?? crankRad / 2) : crankRad / 2;
      for (const cam of bank.cams) cam.rotation.x = camAngle;
    }
    if (sim.timing && this.frozenCam === null) {
      this.frozenCam = crankRad / 2;
      this.belt.visible = false;
      this.spawnBeltBits();
    }
    if (this.pan) this.pan.position.y = this.panBase - view.explode * dims.bore * 0.85;
    for (const label of this.labels) {
      label.visible = view.labels;
      label.element.classList.toggle("on", !!this.hoverName && label.element.textContent === this.hoverName);
    }

    if (sim.rodStage === 2 && !this.rodGone) this.breakRod(sim.rodCylinder);
    if (sim.punch && !this.holeMade) this.punchBlock();

    this.fireStrength = 0;
    const timingCrash = sim.timing;
    const fault = sim.rodStage > 0 || sim.seized || sim.timing || sim.gasket || sim.heatSeize;
    const amp = sim.shake * (sim.rodStage === 2 ? 1.2 : fault ? 0.58 : 0.16);
    const hz = fault ? 36 : 13;
    this.root.position.x = this.basePos.x + Math.sin(sim.time * hz) * amp;
    this.root.position.y = this.basePos.y + Math.cos(sim.time * hz * 0.7) * amp * 0.28;
    this.root.position.z = this.basePos.z + Math.sin(sim.time * hz * 1.15) * amp * 0.18;
    this.root.rotation.z = Math.sin(sim.time * hz * 0.55) * amp * 0.015;

    for (const cyl of this.cyls) {
      const phase = phaseDeg(sim.crankDeg, cyl.geom.fireDeg);
      const lobes = lobesFor(sim.spec, sim.vtecEngaged > 0.55);
      const liftIn = timingCrash ? 1 : camLift(phase, lobes.intake);
      const liftEx = timingCrash ? 1 : camLift(phase, lobes.exhaust);
      const travel = timingCrash ? dims.crashLift : dims.maxLift;
      const faceIn = dims.deck - travel * liftIn;
      const faceEx = dims.deck - travel * liftEx;
      cyl.intake.position.y = faceIn + shift;
      cyl.exhaust.position.y = faceEx + shift;

      const psi = crankRad + cyl.geom.pin;
      const py = Math.cos(psi) * dims.r;
      const pz = Math.sin(psi) * dims.r;
      const ay = cyl.axis.y;
      const az = cyl.axis.z;
      const dot = ay * py + az * pz;
      const disc = dot * dot - py * py - pz * pz + dims.rod * dims.rod;
      const wristT = dot + Math.sqrt(Math.max(0, disc));

      if (!cyl.flying) {
        const shown = wristT + pistonExtra;
        cyl.piston.position.y = shown;
        this.v1.set(cyl.geom.x, shown, 0).applyQuaternion(this.bankOf(cyl).q);
        this.v2.set(cyl.geom.x, py, pz);
        this.placeRod(cyl.rod, this.v1, this.v2);
      } else {
        cyl.flyV.y -= 1700 * dt;
        cyl.piston.position.addScaledVector(cyl.flyV, dt);
        cyl.piston.rotation.z += dt * 3.2;
        cyl.piston.rotation.x += dt * 2.1;
        if (cyl.piston.position.y < this.feetY + 18) {
          cyl.piston.position.y = this.feetY + 18;
          cyl.flyV.y *= -0.28;
          cyl.flyV.x *= 0.7;
          cyl.flyV.z *= 0.7;
        }
      }

      const misfire = sim.isMisfire(cyl.geom.index);
      let burn = 0;
      if (!misfire && !cyl.flying && sim.rpm > 250 && !sim.seized) {
        if (phase < 150) {
          const rise = Math.min(1, phase / (sim.spec.fuel === "dizel" ? 22 : 12));
          burn = Math.sin(rise * Math.PI * 0.5) * Math.exp(-Math.max(0, phase - 6) / (sim.spec.fuel === "dizel" ? 52 : 30));
          burn *= 0.35 + sim.throttle * 0.75;
        }
      }
      const spark = sim.spec.fuel === "benzin" && phase > 700 && !misfire && sim.rpm > 250 && !sim.seized;
      cyl.glowMat.color.set(spark ? 0xeaf4ff : sim.spec.fuel === "dizel" ? 0xffb15a : 0xff6a1e);
      const s = (spark ? 0.55 : burn) * dims.bore * 0.45;
      cyl.glow.scale.setScalar(Math.max(0.001, s));
      cyl.glow.position.y = dims.deck - dims.clearance * 0.45 + shift;
      cyl.glow.visible = s > 1;
      if (burn + (spark ? 0.8 : 0) > this.fireStrength) {
        this.fireStrength = burn + (spark ? 0.8 : 0);
        this.fireLocal.set(cyl.geom.x, dims.deck - dims.clearance * 0.4 + shift, 0).applyQuaternion(this.bankOf(cyl).q);
      }

      if (timingCrash && !this.impacted && !cyl.flying) {
        const crown = wristT + dims.crown;
        if (crown >= Math.min(faceIn, faceEx) - 1.2) {
          cyl.intake.rotation.z = 0.65;
          cyl.exhaust.rotation.z = -0.55;
          this.burst(cyl.intake.position, cyl.axis, COL_HOT, 28);
          this.impacted = true;
          sim.impact("Supaplar pistona çarptı — motor kilitlendi");
        }
      }

      this.flow(sim, dt, cyl, liftIn, liftEx);
    }

    this.root.updateWorldMatrix(true, true);
    this.v3.copy(this.fireLocal);
    this.root.localToWorld(this.v3);
    fireLight.position.copy(this.v3);
    const hot = this.fireStrength * (0.6 + sim.throttle);
    fireLight.intensity = hot * 18;
    fireLight.distance = 2.4;
    fireLight.color.set(sim.spec.fuel === "dizel" ? 0xffa24a : 0xff6a2a);

    const heat = Math.min(1, sim.throttle * 0.75 + sim.rpm / 9000);
    if (this.vtecPin) {
      const t = sim.vtecEngaged;
      this.vtecPin.position.z = this.dims.bore * (0.02 + t * 0.16);
      const mat = this.vtecPin.material as THREE.MeshStandardMaterial;
      mat.emissive.set(t > 0.6 ? 0x9dff2a : 0x000000);
      mat.emissiveIntensity = t > 0.6 ? 0.8 : 0;
    }
    this.exhaustMat.emissiveIntensity = heat * 0.85;
    this.turboMat.emissiveIntensity = sim.turboFail ? 0.2 : heat * 0.55;
    this.gasketMat.emissiveIntensity = sim.gasket ? 0.65 + Math.sin(sim.time * 9) * 0.35 : 0;
    for (const m of this.glowPlugMats) {
      m.emissiveIntensity = sim.spec.fuel === "dizel" ? 0.7 + Math.sin(sim.time * 6) * 0.15 : 0;
    }

    if (sim.spec.aspiration === "turbo") {
      const wobble = sim.turboFail ? Math.sin(sim.time * 95) * 2.2 : 0;
      this.turboAngle += dt * (sim.rpm * 0.035 + sim.boost * 28) * (sim.turboFail ? 0.4 : 1) * 30;
      for (const w of this.turboWheels) {
        w.rotation.x = this.turboAngle;
        w.position.y = wobble;
      }
    }

    for (let i = 0; i < this.bubbles.length; i++) {
      const b = this.bubbles[i];
      b.visible = sim.gasket;
      if (!sim.gasket) continue;
      const u = (sim.time * 0.35 + i * 0.17) % 1;
      b.position.y = -18 + u * 42;
      b.scale.setScalar(0.6 + u * 0.8);
    }

    if (sim.gasket) {
      const a = [...sim.leakCyls][0] ?? 0;
      const c = this.cyls[a];
      if (c && Math.random() < dt * 40) {
        const p = this.v3.set(c.geom.x, dims.deck + shift, 0).applyQuaternion(this.bankOf(c).q);
        this.particles.spawn(p.x, p.y, p.z, (Math.random() - 0.5) * 80, 220, (Math.random() - 0.5) * 80, COL_WHITE, 2.4, 1.3, -80);
      }
    }
    if (sim.turboFail && Math.random() < dt * 50) {
      const t = this.turboPoint();
      this.particles.spawn(t.x, t.y, t.z, (Math.random() - 0.5) * 60, 160, 40, COL_BLUE, 2.8, 1.4, -40);
    }
    if ((sim.rodStage === 2 || sim.heatSeize) && Math.random() < dt * 70) {
      this.particles.spawn(
        (Math.random() - 0.5) * dims.bore,
        dims.bore * 0.2,
        this.dims.bore * 0.4,
        (Math.random() - 0.5) * 80,
        180 + Math.random() * 80,
        40,
        new THREE.Color(0.25, 0.25, 0.25),
        3.2,
        1.6,
        -30,
      );
    }

    this.updateChunks(dt);
    this.particles.update(dt);
    const cut = view.mode === "cutaway";
    for (const obj of this.hideInCut) obj.visible = !cut;
    this.setXray(view.mode === "xray");
  }

  dispose(): void {
    for (const label of this.labels) label.element.remove();
    for (const g of this.geos) g.dispose();
    for (const m of this.mats) m.dispose();
    this.badgeTex?.dispose();
    this.particles.dispose();
    this.root.clear();
  }

  private setXray(on: boolean): void {
    if (this.xrayOn === on) return;
    this.xrayOn = on;
    for (const m of this.housing) {
      m.transparent = on;
      m.opacity = on ? 0.13 : 1;
      m.depthWrite = !on;
      m.needsUpdate = true;
    }
  }

  private build(): void {
    const spec = this.spec;
    const dims = this.dims;
    const geoms = buildCylinders(spec, dims);
    const gas = spec.fuel === "benzin";
    const blockMat = this.paint(gas ? 0xb5bac2 : 0x5c636a, 0.46, 0.86, true);
    const headMat = this.paint(gas ? 0xc5cad1 : 0x6a7178, 0.4, 0.84, true);
    const coverMat = this.paint(gas ? 0xc81e2c : 0x17190f, gas ? 0.32 : 0.48, gas ? 0.42 : 0.7, true);
    if (coverMat instanceof THREE.MeshPhysicalMaterial && gas) {
      coverMat.clearcoat = 0.65;
      coverMat.clearcoatRoughness = 0.28;
    }
    const steel = this.metal(0xd2d7de, 0.16, "steel");
    const steelDark = this.metal(0x6a727a, 0.4, "forged");
    const pistonMat = this.metal(0xdce1e7, 0.2, "alloy");
    const rodMat = this.metal(0xa7b0b8, 0.3, "forged");
    const intakeMat = this.housingMat(0x2e333a, 0.45, 0.55);

    this.buildCrank(geoms, steel, steelDark);
    this.crank.userData.part = "Krank mili";
    this.root.add(this.crank);

    const byBank = new Map<number, CylGeom[]>();
    for (const g of geoms) {
      const list = byBank.get(g.bank) ?? [];
      list.push(g);
      byBank.set(g.bank, list);
    }

    for (const list of byBank.values()) {
      const beta = list[0].beta;
      const y = new THREE.Vector3(0, Math.cos(beta), Math.sin(beta));
      const x = new THREE.Vector3(1, 0, 0);
      const z = new THREE.Vector3().crossVectors(x, y).normalize();
      const q = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(x, y, z));
      const exhaustSign = beta === 0 ? 1 : Math.sign(beta);
      const pivot = new THREE.Group();
      pivot.quaternion.copy(q);
      this.root.add(pivot);
      const head = new THREE.Group();
      const cover = new THREE.Group();
      head.add(cover);
      pivot.add(head);
      const bank: BankRig = { q, pivot, head, cover, cams: [], exhaustSign };
      this.banks.push(bank);

      const midX = list.reduce((s, c) => s + c.x, 0) / list.length;
      const length = (list.length - 1) * dims.spacing + dims.bore * 1.35;
      const width = dims.bore * 1.28;
      const blockH = dims.deck - dims.boreBottom;
      const boreHoles = list.map((c) => ({ x: c.x - midX, z: 0, r: dims.bore / 2 }));
      const block = this.mesh(this.slab(length, width, blockH, boreHoles, 6), blockMat, pivot, "Silindir bloğu");
      block.position.set(midX, dims.boreBottom, 0);
      this.hideInCut.push(block);

      const valveR = dims.bore * 0.11;
      const plugR = dims.bore * 0.05;
      const headHoles: { x: number; z: number; r: number }[] = [];
      for (const c of list) {
        const ez = exhaustSign * dims.bore * 0.28;
        headHoles.push({ x: c.x - midX, z: ez, r: valveR });
        headHoles.push({ x: c.x - midX, z: -ez, r: valveR });
        headHoles.push({ x: c.x - midX, z: 0, r: plugR });
      }
      const lowerH = dims.headH * 0.46;
      const headMesh = this.mesh(this.slab(length + 6, width + 8, lowerH, headHoles, 5), headMat, head, "Silindir kapağı");
      headMesh.position.set(midX, dims.deck, 0);
      this.hideInCut.push(headMesh);

      const gasket = this.mesh(
        this.slab(length + 10, width + 12, 2.2, boreHoles.map((h) => ({ ...h, r: h.r + 1 })), 4),
        this.gasketMat,
        pivot,
        "Silindir kapağı contası",
      );
      gasket.position.set(midX, dims.deck - 1.4, 0);
      this.hideInCut.push(gasket);

      const coverMesh = this.mesh(this.slab(length + 4, width * 0.92, dims.headH * 0.62, [], 10), coverMat, cover, "Supap kapağı");
      coverMesh.position.set(midX, dims.deck + dims.headH * 0.4, 0);
      this.hideInCut.push(coverMesh);
      const cap = this.mesh(new THREE.CylinderGeometry(dims.bore * 0.1, dims.bore * 0.11, 6, 16), this.metal(0x222, 0.4), cover, "Yağ kapağı");
      cap.position.set(midX, dims.deck + dims.headH * 1.02, 0);

      this.addBolts(head, list, dims, exhaustSign, lowerH);

      if (spec.valvetrain === "sohc8") {
        const cam = this.buildCam(list, dims, 0, steelDark, head, q, "Eksantrik mili");
        bank.cams.push(cam);
      } else {
        const intakeCam = this.buildCam(list, dims, -exhaustSign, steelDark, head, q, "Emme eksantrik mili");
        const exhaustCam = this.buildCam(list, dims, exhaustSign, steelDark, head, q, "Egzoz eksantrik mili");
        bank.cams.push(intakeCam, exhaustCam);
      }

      this.buildManifold(head, list, dims, exhaustSign, true, this.exhaustMat);
      this.buildManifold(head, list, dims, exhaustSign, false, intakeMat);

      for (const geom of list) {
        this.cyls.push(this.buildCylinder(geom, bank, dims, spec, pistonMat, rodMat, steel, steelDark));
      }

      this.label("Blok", pivot, midX, dims.deck * 0.45, width * 0.35);
      this.label("Kapak", cover, midX, dims.deck + dims.headH * 0.85, 0);
    }

    this.cyls.sort((a, b) => a.geom.index - b.geom.index);
    this.buildCase();
    this.buildBelt(dims);
    this.buildTurbo(dims);
    this.buildReservoir(dims);
    this.label("Krank mili", this.crank, 0, dims.r * 1.4, 0);
    this.label("Volan", this.crank, this.rearX(geoms) + dims.bore * 0.2, 0, 0);
  }

  private buildCylinder(
    geom: CylGeom,
    bank: BankRig,
    dims: Dims,
    spec: EngineSpec,
    pistonMat: THREE.Material,
    rodMat: THREE.Material,
    steel: THREE.Material,
    steelDark: THREE.Material,
  ): LiveCyl {
    const axis = new THREE.Vector3(0, Math.cos(geom.beta), Math.sin(geom.beta));
    const zBasis = new THREE.Vector3(0, -Math.sin(geom.beta), Math.cos(geom.beta)).normalize();
    const exhaustDir = zBasis.clone().multiplyScalar(bank.exhaustSign || 1);
    const intakeDir = exhaustDir.clone().multiplyScalar(-1);
    const ez = bank.exhaustSign * dims.bore * 0.28;

    const piston = this.makePiston(dims, pistonMat, steel);
    piston.position.set(geom.x, dims.rod, 0);
    piston.userData.part = "Piston";
    bank.pivot.add(piston);

    const rod = this.makeRod(dims, rodMat, steelDark);
    rod.pivot.userData.part = "Biyel";
    this.root.add(rod.pivot);

    const intake = this.makeValve(dims, steel, steelDark);
    intake.position.set(geom.x, dims.deck, -ez);
    intake.userData.part = "Emme supabı";
    const bucket = new THREE.Mesh(
      this.track(new THREE.CylinderGeometry(dims.bore * 0.09, dims.bore * 0.09, dims.bore * 0.055, 10)),
      this.metal(0xb7bdc4, 0.22, "steel"),
    );
    bucket.position.y = dims.headH * 0.62;
    bucket.userData.part = spec.valvetrain === "sohc8" ? "Piyano" : "Kovana";
    intake.add(bucket);
    if (spec.valvetrain === "dohc16-vtec" && geom.index === 0) {
      const pinMat = this.trackMat(new THREE.MeshStandardMaterial({
        color: 0xd6ff4a,
        metalness: 0.55,
        roughness: 0.32,
        emissive: new THREE.Color(0x000000),
      }));
      const pin = new THREE.Mesh(this.track(new THREE.CylinderGeometry(2.1, 2.1, dims.bore * 0.2, 8)), pinMat);
      pin.rotation.z = Math.PI / 2;
      pin.position.set(0, dims.headH * 0.62, dims.bore * 0.02);
      pin.userData.part = "VTEC pimi";
      intake.add(pin);
      this.vtecPin = pin;
    }
    bank.pivot.add(intake);
    const exhaust = this.makeValve(dims, steel, this.metal(0xc08a62, 0.35));
    exhaust.position.set(geom.x, dims.deck, ez);
    exhaust.userData.part = "Egzoz supabı";
    bank.pivot.add(exhaust);

    const glowMat = new THREE.MeshBasicMaterial({
      color: 0xff6a1e,
      transparent: true,
      opacity: 0.9,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    this.mats.push(glowMat);
    const glow = new THREE.Mesh(this.track(new THREE.SphereGeometry(1, 12, 10)), glowMat);
    glow.position.set(geom.x, dims.deck - dims.clearance * 0.4, 0);
    glow.visible = false;
    bank.pivot.add(glow);

    if (spec.fuel === "benzin") {
      const plug = this.makePlug(dims, false);
      plug.position.set(geom.x, dims.deck + dims.headH * 0.55, 0);
      bank.head.add(plug);
    } else {
      const injector = this.makePlug(dims, true);
      injector.position.set(geom.x, dims.deck + dims.headH * 0.58, 0);
      bank.head.add(injector);
      const glowPlug = this.makeGlowPlug(dims);
      glowPlug.position.set(geom.x + dims.bore * 0.16, dims.deck + dims.headH * 0.5, ez * 0.3);
      bank.head.add(glowPlug);
    }

    const portT = dims.deck + dims.headH * 0.22;
    const intakePort = new THREE.Vector3(geom.x, portT, -ez * 4.6);
    const exhaustPort = new THREE.Vector3(geom.x, portT, ez * 4.6);

    if (geom.index === 0) {
      this.label(spec.fuel === "benzin" ? "Buji" : "Enjektör", bank.head, geom.x, dims.deck + dims.headH * 0.7, 0);
      this.label("Piston", piston, 0, dims.crown, dims.bore * 0.2);
      this.label("Biyel", rod.pivot, 0, -dims.rod * 0.45, 0);
    }

    return {
      geom,
      axis,
      exhaustDir,
      intakeDir,
      piston,
      rod,
      intake,
      exhaust,
      glow,
      glowMat,
      intakePort,
      exhaustPort,
      flying: false,
      flyV: new THREE.Vector3(),
    };
  }

  private buildCrank(geoms: CylGeom[], steel: THREE.Material, dark: THREE.Material): void {
    const dims = this.dims;
    const segs = preferLite() ? 12 : 20;
    const pinLen = dims.bore * 0.28;
    const pinGeo = this.track(new THREE.CylinderGeometry(dims.pinR, dims.pinR, pinLen, segs));
    pinGeo.rotateZ(Math.PI / 2);
    const webGeo = this.track(crankWebGeometry(dims.r, dims.bore * 0.085, preferLite() ? 14 : 24));
    for (const c of geoms) {
      const pin = new THREE.Mesh(pinGeo, steel);
      pin.position.set(c.x, Math.cos(c.pin) * dims.r, Math.sin(c.pin) * dims.r);
      pin.castShadow = true;
      this.crank.add(pin);

      for (const side of [-1, 1]) {
        const web = new THREE.Mesh(webGeo, dark);
        web.position.set(c.x + side * pinLen * 0.5, 0, 0);
        web.rotation.x = c.pin;
        web.castShadow = true;
        this.crank.add(web);
      }
    }

    const xs = [...new Set(geoms.map((c) => c.journalX))].sort((a, b) => a - b);
    const mains = [xs[0] - dims.bore * 0.55, ...xs.map((x, i) => (i < xs.length - 1 ? (x + xs[i + 1]) / 2 : x)), xs[xs.length - 1] + dims.bore * 0.45];
    const mainGeo = this.track(new THREE.CylinderGeometry(dims.mainR, dims.mainR, dims.bore * 0.28, 18));
    mainGeo.rotateZ(Math.PI / 2);
    for (const x of mains) {
      const m = new THREE.Mesh(mainGeo, steel);
      m.position.set(x, 0, 0);
      m.castShadow = true;
      this.crank.add(m);
    }

    const front = xs[0] - dims.bore * 1.15;
    this.crankPulleyX = front;
    const rear = xs[xs.length - 1] + dims.bore * 0.95;
    const nose = new THREE.Mesh(this.track(new THREE.CylinderGeometry(dims.bore * 0.16, dims.mainR, dims.bore * 0.7, 16)), steel);
    nose.rotation.z = Math.PI / 2;
    nose.position.set(front + dims.bore * 0.15, 0, 0);
    this.crank.add(nose);
    const pulley = new THREE.Mesh(this.track(new THREE.CylinderGeometry(dims.bore * 0.38, dims.bore * 0.38, dims.bore * 0.16, 24)), dark);
    pulley.rotation.z = Math.PI / 2;
    pulley.position.set(front, 0, 0);
    pulley.userData.part = "Krank kasnağı";
    this.crank.add(pulley);

    const fly = new THREE.Mesh(this.track(new THREE.CylinderGeometry(dims.bore * 1.05, dims.bore * 1.05, dims.bore * 0.16, 32)), dark);
    fly.rotation.z = Math.PI / 2;
    fly.position.set(rear, 0, 0);
    fly.castShadow = true;
    fly.userData.part = "Volan";
    this.crank.add(fly);
    const teeth = new THREE.InstancedMesh(this.track(new THREE.BoxGeometry(4, 7, 5)), this.metal(0x9aa0a6, 0.4), 42);
    const dummy = new THREE.Object3D();
    const toothGeo = teeth.geometry as THREE.BoxGeometry;
    toothGeo.translate(0, dims.bore * 1.08, 0);
    for (let i = 0; i < 42; i++) {
      dummy.position.set(rear, 0, 0);
      dummy.rotation.set((i / 42) * Math.PI * 2, 0, 0);
      dummy.updateMatrix();
      teeth.setMatrixAt(i, dummy.matrix);
    }
    teeth.castShadow = true;
    this.crank.add(teeth);
  }

  private buildCam(
    list: CylGeom[],
    dims: Dims,
    sign: number,
    mat: THREE.Material,
    parent: THREE.Object3D,
    bankQ: THREE.Quaternion,
    part: string,
  ): THREE.Group {
    const cam = new THREE.Group();
    const z = sign * dims.bore * 0.28;
    const y = dims.deck + dims.headH * 0.74;
    cam.position.set(0, y, z);
    const mid = list.reduce((s, c) => s + c.x, 0) / list.length;
    const len = Math.abs(list[list.length - 1].x - list[0].x) + dims.bore * 0.8;
    const shaft = new THREE.Mesh(this.track(new THREE.CylinderGeometry(dims.bore * 0.07, dims.bore * 0.07, len, 12)), mat);
    shaft.rotation.z = Math.PI / 2;
    shaft.position.x = mid;
    shaft.userData.part = part;
    cam.add(shaft);
    const lobeGeo = this.track(camLobeGeometry(dims.bore * 0.16, dims.bore * 0.11));
    const centers = sign === 0 ? [450, 270] : [sign > 0 ? 270 : 450];
    for (const c of list) {
      centers.forEach((center, i) => {
        const phi = ((c.fireDeg + center) * Math.PI) / 360;
        const lobe = new THREE.Mesh(lobeGeo, mat);
        lobe.position.set(c.x + (centers.length > 1 ? (i === 0 ? -1 : 1) * dims.bore * 0.16 : 0), 0, 0);
        lobe.rotation.x = phi;
        lobe.castShadow = true;
        lobe.userData.part = center === 270 ? "Egzoz kam lobu" : "Emme kam lobu";
        cam.add(lobe);
      });
    }
    const pulley = new THREE.Mesh(this.track(new THREE.CylinderGeometry(dims.bore * 0.28, dims.bore * 0.28, 8, 20)), mat);
    pulley.rotation.z = Math.PI / 2;
    const pulleyX = list[0].x - dims.bore * 0.85;
    pulley.position.set(pulleyX, 0, 0);
    cam.add(pulley);
    this.pulleyPoints.push(new THREE.Vector3(pulleyX, y, z).applyQuaternion(bankQ));
    parent.add(cam);
    if (list[0].index === 0 || sign > 0) this.label(sign > 0 ? "Egzoz kamı" : "Emme kamı", cam, mid, dims.bore * 0.2, 0);
    return cam;
  }

  private buildManifold(
    parent: THREE.Object3D,
    list: CylGeom[],
    dims: Dims,
    exhaustSign: number,
    exhaust: boolean,
    mat: THREE.Material,
  ): void {
    const sign = exhaust ? exhaustSign : -exhaustSign;
    const z = sign * dims.bore * 0.78;
    const y = dims.deck + dims.headH * 0.24;
    const mid = list.reduce((s, c) => s + c.x, 0) / list.length;
    const len = Math.abs(list[list.length - 1].x - list[0].x) + dims.bore * 0.9;
    const log = new THREE.Mesh(this.track(new THREE.CylinderGeometry(dims.bore * 0.2, dims.bore * 0.2, len, 16, 1, true)), mat);
    log.rotation.z = Math.PI / 2;
    log.position.set(mid, y, z);
    log.userData.part = exhaust ? "Egzoz manifoldu" : "Emme manifoldu";
    parent.add(log);
    for (const c of list) {
      const runner = new THREE.Mesh(this.track(new THREE.BoxGeometry(dims.bore * 0.26, dims.bore * 0.2, dims.bore * 0.48)), mat);
      runner.position.set(c.x, y, sign * dims.bore * 0.5);
      parent.add(runner);
    }
  }

  private buildCase(): void {
    const dims = this.dims;
    const layout = LAYOUTS[this.spec.layout];
    const half = (layout.bankAngle / 2) * Math.PI / 180;
    const top = this.dims.boreBottom * Math.cos(half) + dims.bore * 0.05;
    const xs = this.cyls.map((c) => c.geom.x);
    const minX = Math.min(...xs) - dims.bore * 0.7;
    const maxX = Math.max(...xs) + dims.bore * 0.7;
    const len = maxX - minX;
    const mid = (minX + maxX) / 2;
    const width = dims.bore * (layout.bankAngle > 0 ? 3.1 : 1.85);
    const caseMat = this.paint(this.spec.fuel === "benzin" ? 0x8e949c : 0x4e555b, 0.5, 0.8, true);
    const crankcase = this.mesh(new THREE.BoxGeometry(len, top + dims.bore * 0.22, width), caseMat, this.root, "Karter");
    crankcase.position.set(mid, (top - dims.bore * 0.22) / 2, 0);
    this.hideInCut.push(crankcase);

    const panMat = this.housingMat(0x23262b, 0.55, 0.6);
    const pan = new THREE.Group();
    const upper = new THREE.Mesh(this.track(new THREE.BoxGeometry(len * 0.96, dims.bore * 0.18, width * 0.92)), panMat);
    const sump = new THREE.Mesh(this.track(new THREE.BoxGeometry(len * 0.62, dims.bore * 0.42, width * 0.55)), panMat);
    sump.position.y = -dims.bore * 0.28;
    pan.add(upper, sump);
    pan.position.set(mid, -dims.bore * 0.2, 0);
    pan.userData.part = "Yağ karteri";
    this.root.add(pan);
    this.pan = pan;
    this.panBase = pan.position.y;
    this.hideInCut.push(pan);

    const filter = this.mesh(new THREE.CylinderGeometry(dims.bore * 0.2, dims.bore * 0.2, dims.bore * 0.48, 18), this.paint(0x222831, 0.45, 0.4, false), this.root, "Yağ filtresi");
    filter.position.set(maxX - dims.bore * 0.2, -dims.bore * 0.05, width * 0.22);

    const plug = this.mesh(new THREE.CylinderGeometry(5, 5, 8, 8), this.metal(0xd7c07a, 0.35), this.root, "Karter tapası");
    plug.rotation.x = Math.PI / 2;
    plug.position.set(mid, this.panBase - dims.bore * 0.48, width * 0.18);
  }

  private buildBelt(dims: Dims): void {
    const front = this.crankPulleyX;
    const points = [new THREE.Vector3(front, 0, 0), ...this.pulleyPoints];
    if (points.length >= 2) {
      const curve = new THREE.CatmullRomCurve3(points, false, "catmullrom", 0.2);
      const belt = new THREE.Mesh(this.track(new THREE.TubeGeometry(curve, 64, 3.4, 6, false)), this.plain(0x141614, 0.72, 0.02));
      belt.userData.part = "Triger kayışı";
      this.belt.add(belt);
    }
    this.root.add(this.belt);
    this.label("Triger", this.belt, front, dims.bore * 0.5, 0);
  }

  private buildTurbo(dims: Dims): void {
    const anchor = this.turboPoint();
    if (this.spec.aspiration !== "turbo") {
      const tip = anchor.clone();
      tip.y -= dims.bore * 0.6;
      this.pipe(anchor, tip, dims.bore * 0.16, this.exhaustMat);
      return;
    }
    const g = new THREE.Group();
    g.position.copy(anchor);
    g.userData.part = "Turboşarj";
    const housing = new THREE.Mesh(this.track(new THREE.TorusGeometry(dims.bore * 0.34, dims.bore * 0.14, 12, 20)), this.turboMat);
    housing.rotation.y = Math.PI / 2;
    const hot = new THREE.Mesh(this.track(new THREE.TorusGeometry(dims.bore * 0.3, dims.bore * 0.13, 12, 20)), this.exhaustMat);
    hot.rotation.y = Math.PI / 2;
    hot.position.x = dims.bore * 0.38;
    const center = new THREE.Mesh(this.track(new THREE.CylinderGeometry(dims.bore * 0.16, dims.bore * 0.16, dims.bore * 0.42, 16)), this.metal(0x9aa1a8, 0.3));
    center.rotation.z = Math.PI / 2;
    g.add(housing, hot, center);

    const bladeMat = this.metal(0xd5d8de, 0.18);
    const mkWheel = (x: number, scale: number) => {
      const w = new THREE.Group();
      w.position.x = x;
      const geo = this.track(new THREE.BoxGeometry(dims.bore * 0.05, dims.bore * 0.28, dims.bore * 0.08));
      geo.translate(0, dims.bore * 0.16, 0);
      for (let i = 0; i < 9; i++) {
        const b = new THREE.Mesh(geo, bladeMat);
        b.rotation.x = (i / 9) * Math.PI * 2;
        w.add(b);
      }
      w.scale.setScalar(scale);
      g.add(w);
      this.turboWheels.push(w);
    };
    mkWheel(-dims.bore * 0.02, 1);
    mkWheel(dims.bore * 0.38, 0.86);
    this.root.add(g);
    this.label("Turbo", g, 0, dims.bore * 0.45, 0);

    for (const bank of this.banks) {
      const from = new THREE.Vector3(this.rearX(this.cyls.map((c) => c.geom)), dims.deck + dims.headH * 0.24, bank.exhaustSign * dims.bore * 0.78);
      from.applyQuaternion(bank.q);
      this.pipe(from, anchor.clone().add(new THREE.Vector3(dims.bore * 0.38, 0, 0)), dims.bore * 0.12, this.exhaustMat);
    }
    const outlet = anchor.clone().add(new THREE.Vector3(-dims.bore * 0.1, dims.bore * 0.7, -dims.bore * 0.2));
    this.pipe(anchor, outlet, dims.bore * 0.12, this.metal(0xd0d4da, 0.25));
  }

  private buildReservoir(dims: Dims): void {
    const glass = this.trackMat(new THREE.MeshPhysicalMaterial({
      color: 0xd5ebe8,
      roughness: 0.08,
      metalness: 0,
      transmission: 0.85,
      thickness: 0.4,
      transparent: true,
      opacity: 1,
    }));
    const tank = new THREE.Group();
    const shell = new THREE.Mesh(this.track(new THREE.BoxGeometry(dims.bore * 0.62, dims.bore * 0.78, dims.bore * 0.4)), glass);
    const liquidMat = this.trackMat(new THREE.MeshStandardMaterial({
      color: 0x16998f,
      transparent: true,
      opacity: 0.45,
      roughness: 0.15,
      metalness: 0.05,
    }));
    const liquid = new THREE.Mesh(this.track(new THREE.BoxGeometry(dims.bore * 0.5, dims.bore * 0.36, dims.bore * 0.28)), liquidMat);
    liquid.position.y = -dims.bore * 0.12;
    tank.add(shell, liquid);
    const cap = this.mesh(new THREE.CylinderGeometry(dims.bore * 0.1, dims.bore * 0.1, 6, 12), this.plain(0x20241c, 0.5, 0.2), tank, "Radyatör kapağı");
    cap.position.y = dims.bore * 0.42;
    tank.position.set(this.frontX() + dims.bore * 0.2, dims.bore * 0.55, -dims.bore * 0.15);
    tank.userData.part = "Soğutma suyu deposu";
    this.root.add(tank);
    this.label("Su deposu", tank, 0, dims.bore * 0.55, 0);
    const bubbleMat = this.trackMat(new THREE.MeshStandardMaterial({ color: 0xe8fff8, transparent: true, opacity: 0.65, roughness: 0.1 }));
    for (let i = 0; i < 6; i++) {
      const b = new THREE.Mesh(this.track(new THREE.SphereGeometry(3.2 + (i % 3), 8, 8)), bubbleMat);
      b.position.set((i - 3) * 6, -10, (i % 2) * 6);
      b.visible = false;
      liquid.add(b);
      this.bubbles.push(b);
    }
  }

  private buildStands(): void {
    const dims = this.dims;
    const mat = this.plain(0x2a2e28, 0.6, 0.35);
    const xs = this.cyls.map((c) => c.geom.x);
    const front = Math.min(...xs);
    const rear = Math.max(...xs);
    const top = -dims.bore * 0.55;
    for (const x of [front, rear]) {
      const g = new THREE.Group();
      const foot = new THREE.Mesh(this.track(new THREE.BoxGeometry(dims.bore * 0.7, 8, dims.bore * 1.3)), mat);
      foot.position.y = this.feetY;
      const legL = new THREE.Mesh(this.track(new THREE.BoxGeometry(dims.bore * 0.12, top - this.feetY, dims.bore * 0.12)), mat);
      legL.position.set(0, (top + this.feetY) / 2, dims.bore * 0.42);
      const legR = legL.clone();
      legR.position.z = -dims.bore * 0.42;
      const cradle = new THREE.Mesh(this.track(new THREE.BoxGeometry(dims.bore * 0.16, dims.bore * 0.12, dims.bore * 0.95)), this.metal(0x888, 0.45));
      cradle.position.y = top;
      g.add(foot, legL, legR, cradle);
      g.position.x = x;
      this.root.add(g);
    }
    const canvas = document.createElement("canvas");
    canvas.width = 1024;
    canvas.height = 256;
    paintBadge(canvas, this.spec);
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 8;
    this.badgeCanvas = canvas;
    this.badgeTex = tex;
    const plateMat = this.trackMat(new THREE.MeshStandardMaterial({ map: tex, roughness: 0.6, metalness: 0.25 }));
    const plate = new THREE.Mesh(this.track(new THREE.BoxGeometry(dims.bore * 1.7, dims.bore * 0.42, 3)), plateMat);
    plate.position.set((front + rear) / 2, this.feetY + 22, dims.bore * 0.72);
    plate.userData.part = "Motor plakası";
    this.root.add(plate);
  }

  private makePiston(dims: Dims, mat: THREE.Material, pinMat: THREE.Material): THREE.Group {
    const g = new THREE.Group();
    const segs = preferLite() ? 16 : 28;
    const skirtH = dims.skirt * 0.92;
    const skirt = new THREE.Mesh(this.track(new THREE.CylinderGeometry(dims.bore * 0.448, dims.bore * 0.43, skirtH, segs)), mat);
    skirt.position.y = dims.crown * 0.15 - skirtH * 0.45;
    skirt.castShadow = true;
    const crown = new THREE.Mesh(this.track(new THREE.CylinderGeometry(dims.bore * 0.455, dims.bore * 0.45, dims.crown * 0.7, segs)), mat);
    crown.position.y = dims.crown * 0.42;
    crown.castShadow = true;
    const dish = new THREE.Mesh(this.track(new THREE.SphereGeometry(dims.bore * 0.28, 14, 10, 0, Math.PI * 2, 0, Math.PI * 0.45)), this.metal(0x9aa3ab, 0.35, "alloy"));
    dish.position.y = dims.crown * 0.78;
    dish.scale.y = 0.35;
    g.add(skirt, crown, dish);
    const ringMat = this.metal(0x23272c, 0.32, "steel");
    for (let i = 0; i < 3; i++) {
      const y = dims.crown - dims.bore * 0.07 - i * dims.bore * 0.055;
      const groove = new THREE.Mesh(this.track(new THREE.CylinderGeometry(dims.bore * 0.432, dims.bore * 0.432, dims.bore * 0.028, segs)), mat);
      groove.position.y = y;
      const ring = new THREE.Mesh(this.track(new THREE.CylinderGeometry(dims.bore * 0.488, dims.bore * 0.488, dims.bore * 0.018, segs, 1, true)), ringMat);
      ring.position.y = y;
      g.add(groove, ring);
    }
    const bossGeo = this.track(new THREE.CylinderGeometry(dims.bore * 0.11, dims.bore * 0.11, dims.bore * 0.16, 10));
    bossGeo.rotateZ(Math.PI / 2);
    for (const side of [-1, 1]) {
      const boss = new THREE.Mesh(bossGeo, mat);
      boss.position.set(side * dims.bore * 0.16, -dims.skirt * 0.15, 0);
      g.add(boss);
    }
    const pin = new THREE.Mesh(this.track(new THREE.CylinderGeometry(dims.bore * 0.07, dims.bore * 0.07, dims.bore * 0.72, 12)), pinMat);
    pin.rotation.z = Math.PI / 2;
    pin.castShadow = true;
    g.add(pin);
    return g;
  }

  private makeRod(dims: Dims, mat: THREE.Material, boltMat: THREE.Material): RodRig {
    const pivot = new THREE.Group();
    const shaft = new THREE.Group();
    const flangeGeo = this.track(new THREE.BoxGeometry(dims.bore * 0.055, 1, dims.bore * 0.2));
    for (const side of [-1, 1]) {
      const flange = new THREE.Mesh(flangeGeo, mat);
      flange.position.x = side * dims.bore * 0.055;
      flange.castShadow = true;
      shaft.add(flange);
    }
    const web = new THREE.Mesh(this.track(new THREE.BoxGeometry(dims.bore * 0.11, 1, dims.bore * 0.055)), mat);
    web.castShadow = true;
    shaft.add(web);
    const big = new THREE.Group();
    const eye = new THREE.Mesh(this.track(new THREE.TorusGeometry(dims.pinR * 1.2, dims.pinR * 0.42, 8, 18)), mat);
    eye.rotation.y = Math.PI / 2;
    eye.castShadow = true;
    const cap = new THREE.Mesh(this.track(new THREE.BoxGeometry(dims.pinR * 2.1, dims.pinR * 0.72, dims.pinR * 1.55)), mat);
    cap.position.y = -dims.pinR * 1.22;
    cap.castShadow = true;
    big.add(eye, cap);
    for (const s of [-1, 1]) {
      const bolt = new THREE.Mesh(this.track(new THREE.CylinderGeometry(2.2, 2.2, dims.pinR * 1.55, 6)), boltMat);
      bolt.position.set(0, -dims.pinR * 1.05, s * dims.pinR * 0.72);
      big.add(bolt);
    }
    const small = new THREE.Mesh(this.track(new THREE.TorusGeometry(dims.bore * 0.11, dims.bore * 0.048, 8, 16)), mat);
    small.rotation.y = Math.PI / 2;
    small.castShadow = true;
    pivot.add(shaft, big, small);
    return { pivot, shaft, big };
  }

  private makeValve(dims: Dims, stemMat: THREE.Material, headMat: THREE.Material): THREE.Group {
    const g = new THREE.Group();
    const stemH = dims.headH * 0.62;
    const stem = new THREE.Mesh(this.track(new THREE.CylinderGeometry(dims.bore * 0.04, dims.bore * 0.04, stemH, 10)), stemMat);
    stem.position.y = stemH / 2;
    const head = new THREE.Mesh(this.track(new THREE.CylinderGeometry(dims.bore * 0.17, dims.bore * 0.12, dims.bore * 0.05, 16)), headMat);
    const tulip = new THREE.Mesh(this.track(new THREE.CylinderGeometry(dims.bore * 0.05, dims.bore * 0.16, dims.bore * 0.06, 16)), headMat);
    tulip.position.y = dims.bore * 0.04;
    g.add(stem, head, tulip);
    return g;
  }

  private makePlug(dims: Dims, injector: boolean): THREE.Group {
    const g = new THREE.Group();
    const body = new THREE.Mesh(this.track(new THREE.CylinderGeometry(dims.bore * 0.055, dims.bore * 0.06, dims.headH * 0.55, 8)), this.metal(0xc5c8cc, 0.3));
    body.position.y = dims.headH * 0.2;
    if (!injector) {
      const ceramic = new THREE.Mesh(this.track(new THREE.CylinderGeometry(dims.bore * 0.045, dims.bore * 0.05, dims.headH * 0.28, 12)), this.plain(0xf4f1ea, 0.35, 0.05));
      ceramic.position.y = dims.headH * 0.48;
      g.add(ceramic);
    } else {
      const rail = new THREE.Mesh(this.track(new THREE.CylinderGeometry(dims.bore * 0.04, dims.bore * 0.04, dims.bore * 0.22, 10)), this.metal(0x888, 0.3));
      rail.rotation.z = Math.PI / 2;
      rail.position.y = dims.headH * 0.48;
      g.add(rail);
    }
    g.add(body);
    g.userData.part = injector ? "Enjektör" : "Buji";
    return g;
  }

  private makeGlowPlug(dims: Dims): THREE.Group {
    const g = new THREE.Group();
    const shell = new THREE.Mesh(this.track(new THREE.CylinderGeometry(dims.bore * 0.035, dims.bore * 0.04, dims.headH * 0.4, 8)), this.metal(0xaaa, 0.35));
    const tipMat = this.trackMat(new THREE.MeshStandardMaterial({
      color: 0xffb15a,
      emissive: new THREE.Color(0xff7a20),
      emissiveIntensity: 0.8,
      roughness: 0.4,
      metalness: 0.4,
    }));
    this.glowPlugMats.push(tipMat);
    const tip = new THREE.Mesh(this.track(new THREE.CylinderGeometry(dims.bore * 0.02, dims.bore * 0.028, dims.bore * 0.12, 8)), tipMat);
    tip.position.y = -dims.headH * 0.18;
    g.add(shell, tip);
    g.userData.part = "Kızdırma bujisi";
    return g;
  }

  private addBolts(parent: THREE.Object3D, list: CylGeom[], dims: Dims, sign: number, headH: number): void {
    const geo = this.track(new THREE.CylinderGeometry(3.1, 3.1, 7, 6));
    const mat = this.metal(0xbfc3c8, 0.32);
    const count = list.length * 4;
    const mesh = new THREE.InstancedMesh(geo, mat, count);
    const dummy = new THREE.Object3D();
    let n = 0;
    for (const c of list) {
      for (const sx of [-0.32, 0.32]) {
        for (const sz of [-0.48, 0.48]) {
          dummy.position.set(c.x + sx * dims.bore, dims.deck + headH + 2, sz * dims.bore * (sign === 0 ? 1 : 1));
          dummy.rotation.set(0, 0, 0);
          dummy.updateMatrix();
          mesh.setMatrixAt(n++, dummy.matrix);
        }
      }
    }
    mesh.castShadow = true;
    parent.add(mesh);
  }

  private placeRod(rod: RodRig, small: THREE.Vector3, big: THREE.Vector3): void {
    this.v3.copy(big).sub(small);
    const len = Math.max(1, this.v3.length());
    this.v3.multiplyScalar(1 / len);
    this.q1.setFromUnitVectors(this.down, this.v3);
    rod.pivot.position.copy(small);
    rod.pivot.quaternion.copy(this.q1);
    const span = Math.max(8, len * 0.7);
    rod.shaft.scale.y = span;
    rod.shaft.position.y = -len / 2;
    rod.big.position.y = -len;
  }

  private breakRod(index: number): void {
    const cyl = this.cyls[index];
    if (!cyl) return;
    this.rodGone = true;
    this.root.updateWorldMatrix(true, true);
    this.root.attach(cyl.piston);
    cyl.flying = true;
    cyl.flyV.copy(cyl.axis).multiplyScalar(1500);
    cyl.flyV.x += 200;
    cyl.flyV.z += 180;
    cyl.rod.pivot.visible = false;
    cyl.glow.visible = false;
    const pin = cyl.piston.position.clone().addScaledVector(cyl.axis, -this.dims.rod * 0.8);
    for (let i = 0; i < 3; i++) {
      const chunk = new THREE.Mesh(this.track(new THREE.BoxGeometry(this.dims.bore * 0.12, this.dims.bore * 0.28, this.dims.bore * 0.08)), this.metal(0x8d9399, 0.35));
      chunk.position.copy(pin);
      chunk.userData.part = "Kırık biyel";
      this.root.add(chunk);
      const embed = i === 0;
      this.chunks.push({
        mesh: chunk,
        v: cyl.exhaustDir.clone().multiplyScalar(embed ? 0 : 700 + Math.random() * 500).add(new THREE.Vector3((Math.random() - 0.5) * 400, 400 + Math.random() * 600, 0)),
        av: new THREE.Vector3(Math.random() * 6, Math.random() * 4, Math.random() * 6),
        age: 0,
        embed: embed
          ? {
              dur: 0.34,
              from: pin.clone(),
              to: pin.clone().addScaledVector(cyl.exhaustDir, this.dims.bore * 1.15).setY(pin.y * 0.35),
              dir: cyl.exhaustDir.clone(),
            }
          : null,
      });
    }
    this.burst(pin, cyl.exhaustDir, COL_HOT, 36);
  }

  private punchBlock(): void {
    const index = this.spec ? this.cylIndex() : 1;
    const cyl = this.cyls[index];
    if (!cyl) return;
    this.holeMade = true;
    const dir = cyl.exhaustDir.clone().normalize();
    const at = new THREE.Vector3(cyl.geom.x, this.dims.r * 0.2, 0).applyQuaternion(this.bankOf(cyl).q).addScaledVector(dir, this.dims.bore * 0.72);
    const hole = new THREE.Mesh(this.track(new THREE.CylinderGeometry(this.dims.bore * 0.26, this.dims.bore * 0.34, 22, 16)), this.plain(0x0c0d0c, 0.85, 0.2));
    hole.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
    hole.position.copy(at);
    hole.userData.part = "Blok deliği";
    this.root.add(hole);
    this.burst(at, dir, new THREE.Color(0.2, 0.2, 0.2), 48);
  }

  private spawnBeltBits(): void {
    const p = new THREE.Vector3(this.frontX(), this.dims.bore * 0.4, 0);
    for (let i = 0; i < 2; i++) {
      const bit = new THREE.Mesh(this.track(new THREE.BoxGeometry(this.dims.bore * 0.55, 5, 8)), this.plain(0x161816, 0.7, 0.1));
      bit.position.copy(p);
      bit.userData.part = "Kopuk triger";
      this.root.add(bit);
      this.chunks.push({
        mesh: bit,
        v: new THREE.Vector3(-200 - i * 120, 500 + i * 80, (i ? 1 : -1) * 260),
        av: new THREE.Vector3(2, 4, 1),
        age: 0,
        embed: null,
      });
    }
  }

  private updateChunks(dt: number): void {
    for (const chunk of this.chunks) {
      chunk.age += dt;
      if (chunk.embed) {
        const u = Math.min(1, chunk.age / chunk.embed.dur);
        chunk.mesh.position.lerpVectors(chunk.embed.from, chunk.embed.to, u * u);
        chunk.mesh.rotateX(dt * 8);
        continue;
      }
      chunk.v.y -= 2000 * dt;
      chunk.mesh.position.addScaledVector(chunk.v, dt);
      chunk.mesh.rotation.x += chunk.av.x * dt;
      chunk.mesh.rotation.y += chunk.av.y * dt;
      chunk.mesh.rotation.z += chunk.av.z * dt;
      if (chunk.mesh.position.y < this.feetY + 8) {
        chunk.mesh.position.y = this.feetY + 8;
        chunk.v.y *= -0.25;
        chunk.v.x *= 0.7;
        chunk.v.z *= 0.7;
      }
    }
  }

  private flow(sim: Simulation, dt: number, cyl: LiveCyl, liftIn: number, liftEx: number): void {
    if (sim.rpm < 200) return;
    const bank = this.bankOf(cyl);
    if (liftEx > 0.12) {
      const n = this.count(dt * (16 + sim.throttle * 50) * liftEx);
      const smoke = sim.gasket ? COL_WHITE : sim.turboFail ? COL_BLUE : sim.throttle > 0.45 ? COL_HOT : COL_EXH;
      for (let i = 0; i < n; i++) {
        const p = cyl.exhaustPort.clone().applyQuaternion(bank.q);
        this.particles.spawn(
          p.x + (Math.random() - 0.5) * 8,
          p.y,
          p.z,
          cyl.exhaustDir.x * (500 + sim.throttle * 500) + (Math.random() - 0.5) * 80,
          cyl.exhaustDir.y * 400 + 80,
          cyl.exhaustDir.z * (500 + sim.throttle * 400),
          smoke,
          sim.gasket ? 2.6 : 1.5,
          sim.gasket ? 1.2 : 0.7,
          sim.gasket ? -60 : 40,
        );
      }
    }
    if (liftIn > 0.12 && sim.throttle > 0.05) {
      const n = this.count(dt * 30 * liftIn * sim.throttle);
      for (let i = 0; i < n; i++) {
        const p = cyl.intakePort.clone().applyQuaternion(bank.q).addScaledVector(cyl.intakeDir, 30);
        this.particles.spawn(
          p.x, p.y, p.z,
          -cyl.intakeDir.x * 700,
          -cyl.intakeDir.y * 500,
          -cyl.intakeDir.z * 700,
          COL_AIR,
          1.1,
          0.45,
          0,
        );
      }
    }
  }

  private burst(at: THREE.Vector3, dir: THREE.Vector3, color: THREE.Color, n: number): void {
    for (let i = 0; i < n; i++) {
      this.particles.spawn(
        at.x, at.y, at.z,
        dir.x * 300 + (Math.random() - 0.5) * 900,
        dir.y * 200 + Math.random() * 700,
        dir.z * 300 + (Math.random() - 0.5) * 900,
        color,
        1.4 + Math.random() * 2,
        0.5 + Math.random() * 0.8,
        200,
      );
    }
  }

  private count(expected: number): number {
    let n = Math.floor(expected);
    if (Math.random() < expected - n) n++;
    return n;
  }

  private pipe(a: THREE.Vector3, b: THREE.Vector3, radius: number, mat: THREE.Material): void {
    const dir = b.clone().sub(a);
    const len = dir.length();
    if (len < 1) return;
    const mesh = new THREE.Mesh(this.track(new THREE.CylinderGeometry(radius, radius, len, 10, 1, true)), mat);
    mesh.position.copy(a).add(b).multiplyScalar(0.5);
    mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize());
    this.root.add(mesh);
  }

  private turboPoint(): THREE.Vector3 {
    const dims = this.dims;
    const rear = Math.max(...this.cyls.map((c) => c.geom.x));
    const z = this.spec.layout === "v6" || this.spec.layout === "v8" ? 0 : dims.bore * 0.85;
    return new THREE.Vector3(rear + dims.bore * 0.55, dims.deck * 0.42, z);
  }

  private frontX(): number {
    return Math.min(...this.cyls.map((c) => c.geom.x)) - this.dims.bore * 1.15;
  }

  private rearX(geoms: { x: number }[]): number {
    return Math.max(...geoms.map((c) => c.x)) + this.dims.bore * 0.95;
  }

  private bankOf(cyl: LiveCyl): BankRig {
    return this.banks[Math.min(this.banks.length - 1, cyl.geom.bank)];
  }

  private cylIndex(): number {
    return Math.min(1, this.cyls.length - 1);
  }

  private slab(lengthX: number, widthZ: number, height: number, holes: { x: number; z: number; r: number }[], radius: number): THREE.BufferGeometry {
    const shape = new THREE.Shape();
    roundedRect(shape, -lengthX / 2, -widthZ / 2, lengthX, widthZ, radius);
    for (const h of holes) {
      const path = new THREE.Path();
      path.absarc(h.x, -h.z, h.r, 0, Math.PI * 2, true);
      shape.holes.push(path);
    }
    const geo = new THREE.ExtrudeGeometry(shape, { depth: height, bevelEnabled: false, curveSegments: 20, steps: 1 });
    geo.rotateX(-Math.PI / 2);
    geo.computeVertexNormals();
    return this.track(geo);
  }

  private mesh(geo: THREE.BufferGeometry, mat: THREE.Material, parent: THREE.Object3D, part?: string): THREE.Mesh {
    const m = new THREE.Mesh(geo, mat);
    m.castShadow = true;
    m.receiveShadow = true;
    if (part) m.userData.part = part;
    parent.add(m);
    return m;
  }

  private label(text: string, parent: THREE.Object3D, x: number, y: number, z: number): void {
    const div = document.createElement("div");
    div.className = "part-label";
    div.textContent = text;
    const obj = new CSS2DObject(div);
    obj.position.set(x, y, z);
    parent.add(obj);
    this.labels.push(obj);
  }

  private paint(color: number, roughness: number, metalness: number, housing: boolean): THREE.MeshPhysicalMaterial {
    const m = new THREE.MeshPhysicalMaterial({
      color,
      roughness,
      metalness,
      clearcoat: metalness > 0.7 ? 0.15 : 0.35,
      clearcoatRoughness: 0.4,
      side: housing ? THREE.DoubleSide : THREE.FrontSide,
    });
    return this.keep(m, housing);
  }

  private housingMat(color: number, roughness: number, metalness: number): THREE.MeshStandardMaterial {
    const m = new THREE.MeshStandardMaterial({
      color,
      roughness,
      metalness,
      side: THREE.DoubleSide,
    });
    return this.keep(m, true);
  }

  private metal(color: number, roughness: number, kind: "steel" | "alloy" | "forged" = "steel"): THREE.MeshPhysicalMaterial {
    const alloy = kind === "alloy";
    const forged = kind === "forged";
    const m = new THREE.MeshPhysicalMaterial({
      color,
      roughness,
      metalness: alloy ? 0.8 : 1,
      clearcoat: alloy ? 0.4 : forged ? 0.14 : 0.06,
      clearcoatRoughness: alloy ? 0.32 : 0.5,
      envMapIntensity: alloy ? 0.9 : 1.28,
    });
    this.mats.push(m);
    return m;
  }

  private plain(color: number, roughness: number, metalness: number): THREE.MeshStandardMaterial {
    const m = new THREE.MeshStandardMaterial({ color, roughness, metalness });
    this.mats.push(m);
    return m;
  }

  private keep<T extends THREE.MeshStandardMaterial>(m: T, housing: boolean): T {
    this.mats.push(m);
    if (housing) this.housing.push(m);
    return m;
  }

  private track(geo: THREE.BufferGeometry): THREE.BufferGeometry {
    this.geos.push(geo);
    return geo;
  }

  private trackMat<T extends THREE.Material>(m: T): T {
    this.mats.push(m);
    return m;
  }
}

function preferLite(): boolean {
  const nav = navigator as Navigator & { deviceMemory?: number };
  const coarse = window.matchMedia("(pointer: coarse)").matches;
  const cores = navigator.hardwareConcurrency ?? 8;
  const lowMemory = typeof nav.deviceMemory === "number" && nav.deviceMemory <= 4;
  return (lowMemory && (coarse || cores <= 4)) || (coarse && cores <= 4);
}

function camLobeGeometry(radius: number, thick: number): THREE.BufferGeometry {
  const shape = new THREE.Shape();
  const steps = 22;
  for (let i = 0; i <= steps; i++) {
    const a = (i / steps) * Math.PI * 2;
    const nose = Math.pow(Math.max(0, Math.cos(a)), 2.4);
    const rad = radius * (1 + nose * 0.95);
    const y = Math.cos(a) * rad;
    const z = Math.sin(a) * radius * (0.92 + nose * 0.15);
    if (i === 0) shape.moveTo(z, y);
    else shape.lineTo(z, y);
  }
  const geo = new THREE.ExtrudeGeometry(shape, { depth: thick, bevelEnabled: true, bevelThickness: 0.6, bevelSize: 0.5, bevelSegments: 1, curveSegments: 1 });
  geo.translate(0, 0, -thick / 2);
  geo.rotateY(Math.PI / 2);
  return geo;
}

function crankWebGeometry(radius: number, thick: number, steps: number): THREE.BufferGeometry {
  const shape = new THREE.Shape();
  for (let i = 0; i <= steps; i++) {
    const a = (i / steps) * Math.PI * 2;
    const lobe = Math.max(0, -Math.cos(a));
    const rad = radius * (0.42 + lobe * 0.62);
    const y = Math.cos(a) * rad;
    const z = Math.sin(a) * rad * (0.62 + lobe * 0.18);
    if (i === 0) shape.moveTo(z, y);
    else shape.lineTo(z, y);
  }
  const geo = new THREE.ExtrudeGeometry(shape, {
    depth: thick,
    bevelEnabled: true,
    bevelThickness: Math.min(1.3, thick * 0.2),
    bevelSize: Math.min(1.1, thick * 0.16),
    bevelSegments: 1,
    curveSegments: 1,
  });
  geo.translate(0, 0, -thick / 2);
  geo.rotateY(Math.PI / 2);
  return geo;
}

function paintBadge(canvas: HTMLCanvasElement, spec: EngineSpec): void {
  const g = canvas.getContext("2d");
  if (!g) return;
  g.clearRect(0, 0, canvas.width, canvas.height);
  g.fillStyle = "#14160f";
  g.fillRect(0, 0, canvas.width, canvas.height);
  g.strokeStyle = "#e2ff4d";
  g.lineWidth = 10;
  g.strokeRect(16, 16, canvas.width - 32, canvas.height - 32);
  g.fillStyle = "#e2ff4d";
  g.font = "600 46px Oswald, sans-serif";
  g.fillText("KRANK", 48, 84);
  g.fillStyle = "#f4f1e6";
  g.font = "500 58px Oswald, sans-serif";
  g.fillText(engineTitle(spec), 48, 158);
  const cc = displacementCc(spec);
  g.fillStyle = "#a39c8c";
  g.font = "500 32px Manrope, sans-serif";
  g.fillText(`${nf0.format(cc)} cc   ·   ${nf1.format(spec.compression)} : 1`, 48, 214);
}
