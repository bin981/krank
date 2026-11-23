import * as THREE from "three";

/**
 * Enine motorlu kompakt hatchback ve garaj.
 * Birim: motorla aynı (1 = 100 mm). Motor dünya merkezine yakın, kaputun altında.
 */
export class Garage {
  readonly group = new THREE.Group();
  readonly hood: THREE.Group;
  private hoodOpen = 0;
  private hoodTarget = 1;

  constructor() {
    const concrete = new THREE.MeshStandardMaterial({ color: 0x5a574f, roughness: 0.94, metalness: 0.02 });
    const wall = new THREE.MeshStandardMaterial({ color: 0x6e685f, roughness: 0.9, metalness: 0 });
    const paint = new THREE.MeshPhysicalMaterial({
      color: 0x1a5168,
      roughness: 0.34,
      metalness: 0.02,
      clearcoat: 1,
      clearcoatRoughness: 0.08,
      envMapIntensity: 0.85,
    });
    const glass = new THREE.MeshPhysicalMaterial({
      color: 0x8eb8c6,
      roughness: 0.06,
      metalness: 0,
      transmission: 0.55,
      transparent: true,
      opacity: 0.45,
      thickness: 0.4,
    });
    const rubber = new THREE.MeshStandardMaterial({ color: 0x141414, roughness: 0.9, metalness: 0 });
    const plastic = new THREE.MeshStandardMaterial({ color: 0x2a2e32, roughness: 0.55, metalness: 0.04 });
    const steel = new THREE.MeshStandardMaterial({ color: 0xb7bcc2, roughness: 0.32, metalness: 0.9 });
    const brass = new THREE.MeshStandardMaterial({ color: 0xc6a15a, roughness: 0.35, metalness: 0.85 });

    const floor = new THREE.Mesh(new THREE.BoxGeometry(28, 0.08, 22), concrete);
    floor.position.set(0, -0.04, 0);
    floor.receiveShadow = true;
    this.group.add(floor);
    const pad = new THREE.Mesh(
      new THREE.BoxGeometry(8, 0.02, 12),
      new THREE.MeshStandardMaterial({ color: 0x3e3c38, roughness: 0.8, metalness: 0.05 }),
    );
    pad.position.set(0, 0.01, 0.4);
    pad.receiveShadow = true;
    this.group.add(pad);

    const back = new THREE.Mesh(new THREE.BoxGeometry(24, 7.2, 0.16), wall);
    back.position.set(0, 3.6, -8.2);
    back.receiveShadow = true;
    this.group.add(back);
    for (const x of [-11.2, 11.2]) {
      const side = new THREE.Mesh(new THREE.BoxGeometry(0.16, 7.2, 16), wall);
      side.position.set(x, 3.6, -1);
      side.receiveShadow = true;
      this.group.add(side);
    }

    const lampMat = new THREE.MeshStandardMaterial({
      color: 0xfff6e4,
      emissive: 0xffe2a8,
      emissiveIntensity: 0.8,
      roughness: 0.4,
    });
    for (const x of [-3.2, 3.2]) {
      const lamp = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.08, 0.45), lampMat);
      lamp.position.set(x, 6.7, 0.2);
      this.group.add(lamp);
      const light = new THREE.PointLight(0xfff1d4, 3.2, 16, 2);
      light.position.set(x, 6.3, 0.2);
      this.group.add(light);
    }

    const bench = new THREE.Mesh(
      new THREE.BoxGeometry(2.6, 0.08, 1.15),
      new THREE.MeshStandardMaterial({ color: 0x6a4632, roughness: 0.7, metalness: 0.05 }),
    );
    bench.position.set(6.6, 1.12, 1.1);
    bench.receiveShadow = true;
    bench.userData.part = "Tezgah";
    const leg = new THREE.Mesh(new THREE.BoxGeometry(0.08, 1.08, 0.08), steel);
    for (const sx of [-1.15, 1.15]) {
      for (const sz of [-0.45, 0.45]) {
        const l = leg.clone();
        l.position.set(6.6 + sx, 0.54, 1.1 + sz);
        this.group.add(l);
      }
    }
    this.group.add(bench);

    const car = new THREE.Group();
    const wheel = (x: number, z: number) => {
      const tire = new THREE.Mesh(new THREE.CylinderGeometry(1.42, 1.42, 0.46, 24), rubber);
      tire.rotation.z = Math.PI / 2;
      tire.position.set(x, 1.42, z);
      tire.castShadow = true;
      const rim = new THREE.Mesh(new THREE.CylinderGeometry(0.82, 0.82, 0.5, 16), steel);
      rim.rotation.z = Math.PI / 2;
      rim.position.copy(tire.position);
      car.add(tire, rim);
    };
    wheel(-2.85, 3.05);
    wheel(2.85, 3.05);
    wheel(-2.85, -3.35);
    wheel(2.85, -3.35);
    const archGeo = new THREE.TorusGeometry(1.62, 0.16, 8, 18, Math.PI);
    for (const [x, z] of [[-2.85, 3.05], [2.85, 3.05], [-2.85, -3.35], [2.85, -3.35]] as const) {
      const arch = new THREE.Mesh(archGeo, paint);
      arch.rotation.y = Math.PI / 2;
      arch.position.set(x, 1.5, z);
      arch.castShadow = true;
      car.add(arch);
    }

    const sill = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.5, 9.8), paint);
    sill.position.set(-2.55, 1.78, -0.1);
    sill.castShadow = true;
    const sillR = sill.clone();
    sillR.position.x = 2.55;
    car.add(sill, sillR);

    const rear = new THREE.Mesh(new THREE.BoxGeometry(5.4, 1.55, 3.5), paint);
    rear.position.set(0, 2.4, -3.2);
    rear.castShadow = true;
    rear.userData.part = "Kaporta";
    car.add(rear);

    const cabin = new THREE.Mesh(new THREE.BoxGeometry(5.05, 1.9, 2.7), paint);
    cabin.position.set(0, 3.95, -1.25);
    cabin.castShadow = true;
    car.add(cabin);
    const win = new THREE.Mesh(new THREE.BoxGeometry(4.55, 1.4, 2.25), glass);
    win.position.set(0, 4.05, -1.2);
    car.add(win);

    const windshield = new THREE.Mesh(new THREE.BoxGeometry(4.6, 1.35, 0.06), glass);
    windshield.position.set(0, 3.7, 0.15);
    windshield.rotation.x = -0.45;
    car.add(windshield);

    this.hood = new THREE.Group();
    this.hood.position.set(0, 4.2, 0.45);
    const hoodMesh = new THREE.Mesh(new THREE.BoxGeometry(5.15, 0.07, 3.55), paint);
    hoodMesh.position.set(0, 0.04, 1.7);
    hoodMesh.castShadow = true;
    hoodMesh.userData.part = "Kaput";
    this.hood.add(hoodMesh);
    car.add(this.hood);

    const bumper = new THREE.Mesh(new THREE.BoxGeometry(5.5, 0.7, 0.38), plastic);
    bumper.position.set(0, 1.15, 4.75);
    bumper.userData.part = "Tampon";
    car.add(bumper);
    const grille = new THREE.Mesh(new THREE.BoxGeometry(2.1, 0.42, 0.08), plastic);
    grille.position.set(0, 1.55, 4.55);
    car.add(grille);
    const lamp = new THREE.MeshStandardMaterial({
      color: 0xfff4d2,
      emissive: 0xfff1c4,
      emissiveIntensity: 0.35,
      roughness: 0.2,
    });
    for (const x of [-1.7, 1.7]) {
      const head = new THREE.Mesh(new THREE.BoxGeometry(0.85, 0.24, 0.08), lamp);
      head.position.set(x, 1.72, 4.58);
      head.userData.part = "Far";
      car.add(head);
    }

    const rad = new THREE.Mesh(
      new THREE.BoxGeometry(2.4, 0.9, 0.1),
      new THREE.MeshStandardMaterial({ color: 0x22262b, roughness: 0.45, metalness: 0.55 }),
    );
    rad.position.set(0, 1.65, 4.15);
    rad.userData.part = "Radyatör";
    car.add(rad);

    const strutMat = new THREE.MeshStandardMaterial({ color: 0x8a9096, roughness: 0.4, metalness: 0.7 });
    for (const x of [-1.85, 1.85]) {
      const strut = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.16, 1.7, 12), strutMat);
      strut.position.set(x, 2.9, 2.55);
      strut.userData.part = "Amortisör kulesi";
      car.add(strut);
    }

    const bay = new THREE.Mesh(new THREE.BoxGeometry(4.2, 0.08, 2.6), plastic);
    bay.position.set(0, 0.35, 1.5);
    bay.userData.part = "Motor yuvası";
    car.add(bay);

    const air = new THREE.Mesh(new THREE.BoxGeometry(0.85, 0.42, 0.62), plastic);
    air.position.set(1.7, 2.35, 1.85);
    air.userData.part = "Hava filtresi kutusu";
    const cover = new THREE.Mesh(
      new THREE.BoxGeometry(0.9, 0.06, 0.66),
      new THREE.MeshStandardMaterial({ color: 0x3a3e44, roughness: 0.5, metalness: 0.05 }),
    );
    cover.position.set(0, 0.24, 0);
    cover.userData.part = "Hava filtresi kapağı";
    for (const [bx, bz] of [[-0.32, -0.22], [0.32, -0.22], [-0.32, 0.22], [0.32, 0.22]] as const) {
      const bolt = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.05, 8), brass);
      bolt.position.set(bx, 0.05, bz);
      bolt.userData.bolt = true;
      cover.add(bolt);
    }
    air.add(cover);
    car.add(air);

    const fuse = new THREE.Mesh(new THREE.BoxGeometry(0.38, 0.28, 0.16), plastic);
    fuse.position.set(1.85, 3.15, 2.7);
    fuse.userData.part = "Sigorta kutusu";
    car.add(fuse);

    const bottle = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.14, 0.38, 12), plastic);
    bottle.position.set(-1.75, 2.15, 2.55);
    bottle.userData.part = "Genleşme kabı";
    car.add(bottle);

    const battery = new THREE.Group();
    battery.position.set(-1.65, 1.95, 1.7);
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.72, 0.48, 0.42), plastic);
    body.userData.part = "Akü";
    const hold = new THREE.Mesh(new THREE.BoxGeometry(0.78, 0.05, 0.1), steel);
    hold.position.set(0, 0.26, 0);
    hold.userData.part = "Akü kelepçesi";
    for (const bx of [-0.28, 0.28]) {
      const bolt = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.08, 8), brass);
      bolt.position.set(bx, 0.05, 0);
      bolt.userData.bolt = true;
      hold.add(bolt);
    }
    const neg = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.08, 10), steel);
    neg.position.set(-0.22, 0.28, 0.08);
    neg.userData.part = "Eksi kutup";
    const pos = neg.clone();
    pos.position.x = 0.22;
    pos.userData.part = "Artı kutup";
    pos.userData.part = "Artı kutup";
    const cable = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 1.3, 6), rubber);
    cable.rotation.z = Math.PI / 2;
    cable.position.set(0.7, 0.35, 0.4);
    cable.userData.part = "Akü kablosu";
    battery.add(body, hold, neg, pos, cable);
    battery.userData.part = "Akü";
    car.add(battery);

    this.group.add(car);
  }

  setHood(open: boolean): void {
    this.hoodTarget = open ? 1 : 0;
  }

  toggleHood(): void {
    this.hoodTarget = this.hoodTarget > 0.5 ? 0 : 1;
  }

  update(dt: number): void {
    this.hoodOpen += (this.hoodTarget - this.hoodOpen) * Math.min(1, dt * 4);
    this.hood.rotation.x = -this.hoodOpen * 1.05;
  }
}
