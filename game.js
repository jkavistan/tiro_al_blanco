// Reglas fáciles de cambiar:
// 3 disparos por nivel. Menos de 18 puntos = pierdes.
// El nivel 1 es el campo. Si apruebas, el nivel 2 es la ciudad.
const MAX_SHOTS = 3;
const PASS_SCORE = 18;
const SHOT_GAP = 340;
const BEST_KEY = "tiro-al-blanco-mejor";
const STREAK_KEY = "tiro-al-blanco-racha";

const ZONES = [
  { id: "centro", label: "Centro", points: 10, radius: 0.18, color: "#e6b23c" },
  { id: "rojo", label: "Rojo", points: 8, radius: 0.4, color: "#d04532" },
  { id: "azul", label: "Azul", points: 6, radius: 0.64, color: "#2d74a8" },
  { id: "negro", label: "Negro", points: 4, radius: 0.9, color: "#1c1c1c" },
  { id: "blanco", label: "Blanco", points: 2, radius: 1.15, color: "#f3eee4" },
];

const OUTER = ZONES[ZONES.length - 1].radius;
const TARGET_Z = -4.35;
const BASE_Y = 1.68;

const $ = (id) => document.getElementById(id);
const hud = $("hud");
const menu = $("menu");
const result = $("result");
const crosshair = $("crosshair");
const hint = $("hint");
const flash = $("flash");
const live = $("live");

const game = {
  phase: "menu",
  test: 1,
  streak: 0,
  score: 0,
  shots: [],
  lastShotAt: -Infinity,
  finishTimer: 0,
  reduceMotion: window.matchMedia("(prefers-reduced-motion: reduce)").matches,
};

const aim = new THREE.Vector2(0, 0);
const held = new Set();
let spaceDown = false;

const audio = createAudio();
const world = createWorld();
buildLegend();
showBest($("best"));
bindInput();
world.renderer.setAnimationLoop(tick);
$("start").disabled = false;
$("start").textContent = "Comenzar prueba";

function createAudio() {
  let ctx = null;
  let muted = false;

  function context() {
    if (!ctx) ctx = new AudioContext();
    if (ctx.state === "suspended") ctx.resume();
    return ctx;
  }

  function tone(freq, when, dur, type, volume) {
    const c = context();
    const osc = c.createOscillator();
    const gain = c.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, when);
    gain.gain.setValueAtTime(volume, when);
    gain.gain.exponentialRampToValueAtTime(0.001, when + dur);
    osc.connect(gain).connect(c.destination);
    osc.start(when);
    osc.stop(when + dur + 0.02);
  }

  return {
    get muted() {
      return muted;
    },
    toggle() {
      muted = !muted;
      $("sound").textContent = muted ? "Silencio" : "Sonido";
      return muted;
    },
    unlock() {
      try {
        context();
      } catch {
        muted = true;
      }
    },
    shoot() {
      if (muted || !ctx) return;
      const c = context();
      const now = c.currentTime;
      const length = Math.floor(c.sampleRate * 0.12);
      const buffer = c.createBuffer(1, length, c.sampleRate);
      const data = buffer.getChannelData(0);
      for (let i = 0; i < length; i += 1) {
        data[i] = (Math.random() * 2 - 1) * (1 - i / length) ** 2;
      }
      const source = c.createBufferSource();
      source.buffer = buffer;
      const filter = c.createBiquadFilter();
      filter.type = "lowpass";
      filter.frequency.value = 880;
      const gain = c.createGain();
      gain.gain.value = 0.28;
      source.connect(filter).connect(gain).connect(c.destination);
      source.start(now);
      tone(130, now, 0.1, "sine", 0.16);
    },
    hit(points) {
      if (muted || !ctx) return;
      const now = context().currentTime;
      tone(210 + points * 26, now, 0.13, "triangle", 0.1);
      tone(420 + points * 18, now + 0.045, 0.16, "sine", 0.05);
    },
    miss() {
      if (muted || !ctx) return;
      tone(86, context().currentTime, 0.18, "sine", 0.09);
    },
    win() {
      if (muted || !ctx) return;
      const now = context().currentTime;
      [523, 659, 784].forEach((freq, i) => tone(freq, now + i * 0.09, 0.18, "triangle", 0.07));
    },
    lose() {
      if (muted || !ctx) return;
      const now = context().currentTime;
      [330, 247, 196].forEach((freq, i) => tone(freq, now + i * 0.11, 0.2, "sine", 0.06));
    },
  };
}

function createWorld() {
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.12;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.domElement.id = "view";
  renderer.domElement.style.touchAction = "none";
  document.body.prepend(renderer.domElement);

  const rangeSky = makeSky([
    [0, "#24344d"],
    [0.42, "#c85b42"],
    [0.68, "#e8924e"],
    [0.84, "#f0c48a"],
    [1, "#f0c48a"],
  ]);
  const citySky = makeSky([
    [0, "#070b16"],
    [0.42, "#152038"],
    [0.74, "#243044"],
    [1, "#2c3848"],
  ]);

  const scene = new THREE.Scene();
  scene.background = rangeSky;
  scene.fog = new THREE.Fog(0xf0c48a, 16, 42);

  const camera = new THREE.PerspectiveCamera(50, window.innerWidth / window.innerHeight, 0.1, 80);
  camera.position.set(0, 1.56, 4.7);
  camera.lookAt(0, 1.58, TARGET_Z);
  scene.add(camera);

  const hemi = new THREE.HemisphereLight(0xffd7b0, 0x6a4e38, 1.15);
  scene.add(hemi);

  const sun = new THREE.DirectionalLight(0xfff0d2, 2.5);
  sun.position.set(7, 12, 6);
  sun.castShadow = true;
  sun.shadow.mapSize.set(1024, 1024);
  sun.shadow.camera.left = -10;
  sun.shadow.camera.right = 10;
  sun.shadow.camera.top = 10;
  sun.shadow.camera.bottom = -10;
  sun.shadow.camera.near = 1;
  sun.shadow.camera.far = 36;
  sun.shadow.bias = -0.00035;
  scene.add(sun);

  const spot = new THREE.SpotLight(0xfff4df, 28, 18, 0.55, 0.55, 1);
  spot.position.set(0.4, 4.4, -1.2);
  spot.target.position.set(0, BASE_Y, TARGET_Z);
  spot.castShadow = true;
  scene.add(spot, spot.target);

  const wood = new THREE.MeshStandardMaterial({
    map: makeWood(),
    roughness: 0.82,
    metalness: 0.02,
  });
  const sand = new THREE.MeshStandardMaterial({ color: 0xc4a37a, roughness: 1 });
  const dirt = new THREE.MeshStandardMaterial({ color: 0x7b6148, roughness: 1 });
  const hayMat = new THREE.MeshStandardMaterial({ map: makeHay(), roughness: 1 });
  const mountainMat = new THREE.MeshStandardMaterial({ color: 0x5a4d5c, flatShading: true, roughness: 1 });
  const mountainMatFar = new THREE.MeshStandardMaterial({ color: 0x3f4c5a, flatShading: true, roughness: 1 });

  const range = new THREE.Group();
  const city = new THREE.Group();
  city.visible = false;
  scene.add(range, city);

  const ground = new THREE.Mesh(new THREE.PlaneGeometry(70, 70), dirt);
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  range.add(ground);

  const lane = new THREE.Mesh(new THREE.PlaneGeometry(3.1, 12), sand);
  lane.rotation.x = -Math.PI / 2;
  lane.position.set(0, 0.012, -1);
  lane.receiveShadow = true;
  range.add(lane);

  const line = new THREE.Mesh(
    new THREE.PlaneGeometry(2.4, 0.06),
    new THREE.MeshStandardMaterial({ color: 0xf4efe6, roughness: 0.7 })
  );
  line.rotation.x = -Math.PI / 2;
  line.position.set(0, 0.02, 3.15);
  range.add(line);

  addMountains(range, mountainMat, mountainMatFar);
  addBench(range, wood);
  const hay = addHay(range, hayMat);

  const stand = new THREE.Group();
  range.add(stand);
  const postGeo = new THREE.BoxGeometry(0.14, 3.35, 0.14);
  [-3.05, 3.05].forEach((x) => {
    const post = new THREE.Mesh(postGeo, wood);
    post.position.set(x, 1.67, TARGET_Z - 0.18);
    post.castShadow = true;
    post.receiveShadow = true;
    stand.add(post);
  });
  const beam = new THREE.Mesh(new THREE.BoxGeometry(6.3, 0.12, 0.16), wood);
  beam.position.set(0, 3.28, TARGET_Z - 0.18);
  beam.castShadow = true;
  stand.add(beam);

  const mover = new THREE.Group();
  mover.position.set(0, BASE_Y, TARGET_Z);
  scene.add(mover);

  const board = new THREE.Mesh(
    new THREE.BoxGeometry(2.7, 2.7, 0.1),
    wood
  );
  board.position.z = -0.06;
  board.castShadow = true;
  board.receiveShadow = true;
  board.userData.kind = "board";
  mover.add(board);

  const frame = new THREE.Mesh(
    new THREE.RingGeometry(OUTER, OUTER + 0.12, 80),
    new THREE.MeshStandardMaterial({ color: 0x4a3120, roughness: 0.7 })
  );
  frame.position.z = 0.012;
  frame.userData.kind = "board";
  mover.add(frame);

  const paper = new THREE.Mesh(
    new THREE.CircleGeometry(OUTER, 80),
    new THREE.MeshStandardMaterial({
      map: makeTargetTexture(),
      roughness: 0.78,
      metalness: 0,
    })
  );
  paper.position.z = 0.02;
  paper.castShadow = true;
  paper.receiveShadow = true;
  paper.userData.kind = "paper";
  mover.add(paper);

  const hanger = new THREE.Mesh(
    new THREE.CylinderGeometry(0.015, 0.015, 1.15, 8),
    new THREE.MeshStandardMaterial({ color: 0x2c2c2c, metalness: 0.6, roughness: 0.35 })
  );
  hanger.position.y = 1.55;
  mover.add(hanger);

  const rangeFlag = addFlag(range);
  const cityBuilt = addCity(city);

  const tracer = new THREE.Mesh(
    new THREE.CylinderGeometry(0.012, 0.012, 1, 6),
    new THREE.MeshBasicMaterial({
      color: 0xffe3a6,
      transparent: true,
      opacity: 0,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    })
  );
  scene.add(tracer);

  const holeGeo = new THREE.CircleGeometry(0.045, 18);
  const holeMat = new THREE.MeshBasicMaterial({ color: 0x140e0a });
  const holeRingMat = new THREE.MeshBasicMaterial({ color: 0xf2e2b8 });
  const holes = [];
  const sparks = [];
  const sparkGeo = new THREE.SphereGeometry(0.025, 6, 6);
  const rangeColliders = [paper, board, frame, ...hay];
  const cityColliders = [paper, board, frame, ...cityBuilt.colliders];

  window.addEventListener("resize", () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
    placeCrosshair();
  });

  return {
    renderer,
    scene,
    camera,
    hemi,
    sun,
    spot,
    mover,
    paper,
    tracer,
    flag: rangeFlag,
    range,
    city,
    rangeFlag,
    cityFlag: cityBuilt.flag,
    rangeSky,
    citySky,
    rangeColliders,
    cityColliders,
    holes,
    sparks,
    sparkGeo,
    holeGeo,
    holeMat,
    holeRingMat,
    colliders: rangeColliders,
  };
}

function makeSky(stops) {
  const canvas = document.createElement("canvas");
  canvas.width = 32;
  canvas.height = 512;
  const g = canvas.getContext("2d");
  const gradient = g.createLinearGradient(0, 0, 0, 512);
  stops.forEach(([offset, color]) => gradient.addColorStop(offset, color));
  g.fillStyle = gradient;
  g.fillRect(0, 0, 32, 512);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function makeWood() {
  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 512;
  const g = canvas.getContext("2d");
  g.fillStyle = "#8b552f";
  g.fillRect(0, 0, 256, 512);
  for (let i = 0; i < 48; i += 1) {
    g.strokeStyle = `rgba(55, 28, 10, ${0.05 + Math.random() * 0.18})`;
    g.lineWidth = 1 + Math.random() * 3;
    const y = (i / 48) * 512;
    g.beginPath();
    g.moveTo(0, y);
    g.bezierCurveTo(70, y + 18, 170, y - 16, 256, y + 8);
    g.stroke();
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function makeHay() {
  const canvas = document.createElement("canvas");
  canvas.width = 128;
  canvas.height = 128;
  const g = canvas.getContext("2d");
  g.fillStyle = "#c9a15a";
  g.fillRect(0, 0, 128, 128);
  for (let i = 0; i < 90; i += 1) {
    g.strokeStyle = `rgba(110, 72, 24, ${0.15 + Math.random() * 0.4})`;
    g.lineWidth = 1;
    const y = Math.random() * 128;
    g.beginPath();
    g.moveTo(0, y);
    g.lineTo(128, y + (Math.random() * 8 - 4));
    g.stroke();
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function makeTargetTexture() {
  const size = 1024;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const g = canvas.getContext("2d");
  const center = size / 2;
  const maxR = size / 2;

  [...ZONES].reverse().forEach((zone) => {
    g.beginPath();
    g.arc(center, center, (zone.radius / OUTER) * maxR, 0, Math.PI * 2);
    g.fillStyle = zone.color;
    g.fill();
  });

  g.lineWidth = 4;
  g.strokeStyle = "rgba(20, 14, 8, 0.35)";
  ZONES.forEach((zone) => {
    g.beginPath();
    g.arc(center, center, (zone.radius / OUTER) * maxR, 0, Math.PI * 2);
    g.stroke();
  });

  g.beginPath();
  g.arc(center, center, 10, 0, Math.PI * 2);
  g.fillStyle = "#2a2114";
  g.fill();

  const texture = new THREE.CanvasTexture(canvas);
  texture.anisotropy = 8;
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function addMountains(scene, nearMat, farMat) {
  const specs = [
    [-16, -18, 9, 7, farMat],
    [-8, -16, 7, 5.5, nearMat],
    [2, -20, 11, 8, farMat],
    [12, -17, 8, 6, nearMat],
    [18, -21, 10, 7, farMat],
  ];
  specs.forEach(([x, z, radius, height, material]) => {
    const mesh = new THREE.Mesh(new THREE.ConeGeometry(radius, height, 5), material);
    mesh.position.set(x, height / 2 - 1.2, z);
    scene.add(mesh);
  });
}

function addBench(scene, wood) {
  const top = new THREE.Mesh(new THREE.BoxGeometry(2.8, 0.1, 0.7), wood);
  top.position.set(0, 1.02, 3.45);
  top.castShadow = true;
  top.receiveShadow = true;
  scene.add(top);
  const legGeo = new THREE.BoxGeometry(0.1, 1.02, 0.1);
  [
    [-1.2, 0.28],
    [1.2, 0.28],
    [-1.2, -0.22],
    [1.2, -0.22],
  ].forEach(([x, z]) => {
    const leg = new THREE.Mesh(legGeo, wood);
    leg.position.set(x, 0.51, 3.45 + z);
    leg.castShadow = true;
    scene.add(leg);
  });

  [-1.55, 1.55].forEach((x) => {
    const post = new THREE.Mesh(new THREE.BoxGeometry(0.12, 2.4, 0.12), wood);
    post.position.set(x, 1.2, 3.9);
    post.castShadow = true;
    scene.add(post);
  });
  const roof = new THREE.Mesh(new THREE.BoxGeometry(3.5, 0.1, 1.3), wood);
  roof.position.set(0, 2.45, 3.7);
  roof.castShadow = true;
  scene.add(roof);
}

function addHay(scene, material) {
  const bales = [];
  const geo = new THREE.BoxGeometry(1.15, 0.72, 0.8);
  for (let row = 0; row < 3; row += 1) {
    for (let col = -4; col <= 4; col += 1) {
      const bale = new THREE.Mesh(geo, material);
      const shift = row % 2 === 0 ? 0 : 0.45;
      bale.position.set(col * 1.18 + shift, 0.38 + row * 0.7, TARGET_Z - 1.55);
      bale.castShadow = true;
      bale.receiveShadow = true;
      bale.userData.kind = "miss";
      scene.add(bale);
      bales.push(bale);
    }
  }
  return bales;
}

function addFlag(scene) {
  const pole = new THREE.Mesh(
    new THREE.CylinderGeometry(0.03, 0.04, 2.4, 8),
    new THREE.MeshStandardMaterial({ color: 0x2a2d31, metalness: 0.5, roughness: 0.4 })
  );
  pole.position.set(-4.2, 1.2, -1.2);
  scene.add(pole);
  const cloth = new THREE.Mesh(
    new THREE.PlaneGeometry(0.85, 0.48),
    new THREE.MeshStandardMaterial({ color: 0xd4533a, side: THREE.DoubleSide, roughness: 0.7 })
  );
  cloth.position.set(-3.72, 2.15, -1.2);
  scene.add(cloth);
  return cloth;
}

function addCity(parent) {
  const asphalt = new THREE.Mesh(
    new THREE.PlaneGeometry(16, 36),
    new THREE.MeshStandardMaterial({ color: 0x2c333b, roughness: 0.95 })
  );
  asphalt.rotation.x = -Math.PI / 2;
  asphalt.position.set(0, 0.008, -4);
  asphalt.receiveShadow = true;
  parent.add(asphalt);

  [-5.6, 5.6].forEach((x) => {
    const walk = new THREE.Mesh(
      new THREE.PlaneGeometry(4.4, 36),
      new THREE.MeshStandardMaterial({ color: 0x6a717a, roughness: 0.9 })
    );
    walk.rotation.x = -Math.PI / 2;
    walk.position.set(x, 0.012, -4);
    walk.receiveShadow = true;
    parent.add(walk);
  });

  const paint = new THREE.MeshStandardMaterial({ color: 0xe7e2d6, roughness: 0.6 });
  for (let i = 0; i < 8; i += 1) {
    const dash = new THREE.Mesh(new THREE.PlaneGeometry(0.12, 0.7), paint);
    dash.rotation.x = -Math.PI / 2;
    dash.position.set(0, 0.02, 2.4 - i * 1.55);
    parent.add(dash);
  }
  for (let i = -4; i <= 4; i += 1) {
    const stripe = new THREE.Mesh(new THREE.PlaneGeometry(0.28, 1.3), paint);
    stripe.rotation.x = -Math.PI / 2;
    stripe.position.set(i * 0.46, 0.02, 2.7);
    parent.add(stripe);
  }

  const blocks = [
    [-7.4, 1.4, 3.4, 3.1, 5.6, "#3d4654", 0.45],
    [-6.6, -4.4, 3.8, 3.2, 8.4, "#2b3340", 0.62],
    [-8.1, -11, 4.2, 3.4, 11.5, "#222833", 0.35],
    [6.9, 0.6, 3.2, 3.2, 6.6, "#4a403c", 0.5],
    [7.3, -5.2, 3.6, 3.1, 9.2, "#313846", 0.58],
    [6.4, -11.4, 4.4, 3.5, 7.4, "#262c36", 0.4],
    [-2.2, -20, 2.4, 2.4, 14, "#1a202a", 0.7],
    [2.8, -22, 2.8, 2.6, 16, "#151b24", 0.55],
    [8.2, -18.5, 3.2, 3, 12, "#202632", 0.48],
  ];
  blocks.forEach(([x, z, w, d, h, wall, lit]) => addBuilding(parent, x, z, w, d, h, wall, lit));

  const wall = new THREE.Mesh(
    new THREE.BoxGeometry(8.6, 4.4, 0.4),
    new THREE.MeshStandardMaterial({ color: 0x4d555e, roughness: 0.88 })
  );
  wall.position.set(0, 2.15, TARGET_Z - 1.35);
  wall.castShadow = true;
  wall.receiveShadow = true;
  wall.userData.kind = "miss";
  parent.add(wall);

  const metal = new THREE.MeshStandardMaterial({ color: 0x2a3138, metalness: 0.65, roughness: 0.35 });
  const postGeo = new THREE.BoxGeometry(0.12, 3.35, 0.12);
  [-3.05, 3.05].forEach((x) => {
    const post = new THREE.Mesh(postGeo, metal);
    post.position.set(x, 1.67, TARGET_Z - 0.18);
    post.castShadow = true;
    parent.add(post);
  });
  const beam = new THREE.Mesh(new THREE.BoxGeometry(6.3, 0.1, 0.14), metal);
  beam.position.set(0, 3.28, TARGET_Z - 0.18);
  beam.castShadow = true;
  parent.add(beam);

  addStreetLamp(parent, -2.55, 1.1);
  addStreetLamp(parent, 2.55, -1.6);
  addCar(parent, -3.7, 1.8, 0xc23b3b);
  addCar(parent, 3.85, -0.4, 0x2f5f8a);

  const sign = new THREE.Mesh(
    new THREE.PlaneGeometry(1.6, 0.42),
    new THREE.MeshBasicMaterial({ color: 0x39d6c8 })
  );
  sign.position.set(-5.5, 3.15, -2.6);
  parent.add(sign);

  const pole = new THREE.Mesh(
    new THREE.CylinderGeometry(0.03, 0.04, 2.5, 8),
    metal
  );
  pole.position.set(4.35, 1.25, 1.4);
  parent.add(pole);
  const banner = new THREE.Mesh(
    new THREE.PlaneGeometry(0.9, 0.42),
    new THREE.MeshStandardMaterial({ color: 0xf0c14a, side: THREE.DoubleSide, roughness: 0.6 })
  );
  banner.position.set(3.85, 2.2, 1.4);
  parent.add(banner);

  return { flag: banner, colliders: [wall] };
}

function addBuilding(parent, x, z, w, d, h, wall, lit) {
  const map = makeWindows(wall, lit);
  map.wrapS = THREE.RepeatWrapping;
  map.wrapT = THREE.RepeatWrapping;
  map.repeat.set(Math.max(1, w / 2.4), Math.max(1, h / 2.8));
  const mesh = new THREE.Mesh(
    new THREE.BoxGeometry(w, h, d),
    new THREE.MeshStandardMaterial({
      map,
      emissive: 0xf2c56a,
      emissiveMap: map,
      emissiveIntensity: 0.42,
      roughness: 0.86,
    })
  );
  mesh.position.set(x, h / 2, z);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  parent.add(mesh);
}

function makeWindows(wall, litRatio) {
  const canvas = document.createElement("canvas");
  canvas.width = 96;
  canvas.height = 160;
  const g = canvas.getContext("2d");
  g.fillStyle = wall;
  g.fillRect(0, 0, 96, 160);
  for (let row = 0; row < 5; row += 1) {
    for (let col = 0; col < 2; col += 1) {
      const lit = Math.random() < litRatio;
      g.fillStyle = lit ? "#ffd98a" : "#1b2433";
      g.fillRect(14 + col * 40, 12 + row * 30, 24, 16);
    }
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function addStreetLamp(parent, x, z) {
  const metal = new THREE.MeshStandardMaterial({ color: 0x23282e, metalness: 0.5, roughness: 0.4 });
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.07, 3.1, 8), metal);
  pole.position.set(x, 1.55, z);
  pole.castShadow = true;
  parent.add(pole);
  const head = new THREE.Mesh(
    new THREE.SphereGeometry(0.14, 12, 10),
    new THREE.MeshBasicMaterial({ color: 0xffe1a8 })
  );
  head.position.set(x, 3.12, z);
  parent.add(head);
  const lamp = new THREE.PointLight(0xffc56a, 6, 9, 2);
  lamp.position.set(x, 3, z);
  parent.add(lamp);
}

function addCar(parent, x, z, color) {
  const paint = new THREE.MeshStandardMaterial({ color, roughness: 0.45, metalness: 0.25 });
  const glass = new THREE.MeshStandardMaterial({ color: 0x9fd4e8, roughness: 0.15, metalness: 0.1 });
  const body = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.42, 0.86), paint);
  body.position.set(x, 0.36, z);
  body.castShadow = true;
  parent.add(body);
  const cabin = new THREE.Mesh(new THREE.BoxGeometry(0.86, 0.34, 0.76), glass);
  cabin.position.set(x - 0.05, 0.7, z);
  parent.add(cabin);
}

function buildLegend() {
  const legend = $("legend");
  ZONES.forEach((zone) => {
    const item = document.createElement("span");
    item.className = "zone";
    item.innerHTML = `<i class="swatch" style="background:${zone.color}"></i>${zone.label} ${zone.points}`;
    legend.appendChild(item);
  });
}

function bindInput() {
  $("start").addEventListener("click", startGame);
  $("retry").addEventListener("click", continueOrRestart);
  $("restart").addEventListener("click", startGame);
  $("sound").addEventListener("click", () => audio.toggle());

  const view = world.renderer.domElement;
  view.addEventListener("pointermove", (event) => {
    if (game.phase !== "playing") return;
    setAimFromEvent(event);
  });
  view.addEventListener("pointerdown", (event) => {
    if (game.phase !== "playing" || event.button !== 0) return;
    setAimFromEvent(event);
    shoot();
  });

  window.addEventListener("keydown", (event) => {
    held.add(event.code);
    if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Space"].includes(event.code)) {
      event.preventDefault();
    }
    if (event.code === "Enter" && game.phase !== "playing") continueOrRestart();
    if (event.code === "Space" && !spaceDown) {
      spaceDown = true;
      if (game.phase === "playing") shoot();
      else continueOrRestart();
    }
  });
  window.addEventListener("keyup", (event) => {
    held.delete(event.code);
    if (event.code === "Space") spaceDown = false;
  });
}

function setAimFromEvent(event) {
  const rect = world.renderer.domElement.getBoundingClientRect();
  aim.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
  aim.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
  clampAim();
  placeCrosshair();
}

function clampAim() {
  aim.x = Math.min(0.94, Math.max(-0.94, aim.x));
  aim.y = Math.min(0.88, Math.max(-0.82, aim.y));
}

function placeCrosshair() {
  const rect = world.renderer.domElement.getBoundingClientRect();
  const x = (aim.x * 0.5 + 0.5) * rect.width;
  const y = (-aim.y * 0.5 + 0.5) * rect.height;
  crosshair.style.left = `${x}px`;
  crosshair.style.top = `${y}px`;
}

function motion() {
  if (game.reduceMotion) return { amp: 0.2, speed: 0.45, bob: 0.04 };
  if (game.test >= 2) return { amp: 0.98, speed: 1.08, bob: 0.17 };
  return { amp: 0.7, speed: 0.72, bob: 0.12 };
}

function applyLevel(level) {
  const city = level >= 2;
  world.range.visible = !city;
  world.city.visible = city;
  world.scene.background = city ? world.citySky : world.rangeSky;
  world.scene.fog.color.set(city ? 0x1a2436 : 0xf0c48a);
  world.scene.fog.near = city ? 12 : 16;
  world.scene.fog.far = city ? 40 : 42;
  world.hemi.color.set(city ? 0x8ea4c8 : 0xffd7b0);
  world.hemi.groundColor.set(city ? 0x1c242e : 0x6a4e38);
  world.hemi.intensity = city ? 0.78 : 1.15;
  world.sun.color.set(city ? 0xc9d6ef : 0xfff0d2);
  world.sun.intensity = city ? 0.95 : 2.5;
  world.spot.color.set(city ? 0xffe2a8 : 0xfff4df);
  world.spot.intensity = city ? 40 : 28;
  world.flag = city ? world.cityFlag : world.rangeFlag;
  world.colliders = city ? world.cityColliders : world.rangeColliders;
  world.renderer.toneMappingExposure = city ? 1.08 : 1.12;
}

function startGame() {
  game.test = 1;
  game.streak = 0;
  beginRound("Apunta y dispara");
  say("Nivel 1. Tienes 3 tiros.");
}

function nextTest() {
  game.test = 2;
  beginRound("Ciudad. El blanco se mueve más");
  say("Nivel 2, en la ciudad. Tienes 3 tiros.");
}

function continueOrRestart() {
  if (game.phase === "result" && game.score >= PASS_SCORE && game.test < 2) nextTest();
  else startGame();
}

function beginRound(callout) {
  audio.unlock();
  clearTimeout(game.finishTimer);
  game.phase = "playing";
  game.score = 0;
  game.shots = [];
  game.lastShotAt = -Infinity;
  clearHoles();
  applyLevel(game.test);
  aim.set(0, 0);
  placeCrosshair();
  menu.hidden = true;
  result.hidden = true;
  hud.hidden = false;
  crosshair.hidden = false;
  hint.hidden = false;
  updateHud(callout);
}

function shoot() {
  if (game.phase !== "playing") return;
  if (game.shots.length >= MAX_SHOTS) return;
  const now = performance.now();
  if (now - game.lastShotAt < SHOT_GAP) return;
  game.lastShotAt = now;

  world.mover.updateWorldMatrix(true, true);
  const raycaster = new THREE.Raycaster();
  raycaster.setFromCamera(aim, world.camera);
  const hit = raycaster.intersectObjects(world.colliders, false)[0];

  let entry;
  if (hit?.object.userData.kind === "paper") {
    const local = hit.object.worldToLocal(hit.point.clone());
    const distance = Math.hypot(local.x, local.y);
    const zone = ZONES.find((item) => distance <= item.radius) ?? ZONES[ZONES.length - 1];
    entry = { label: zone.label, points: zone.points, hit: true };
    stampHole(hit);
    burst(hit.point, zone.color);
  } else {
    entry = { label: "Fallo", points: 0, hit: false };
    if (hit) {
      stampHole(hit);
      burst(hit.point, "#c4a37a");
    }
  }

  game.shots.push(entry);
  game.score += entry.points;
  showTracer(hit?.point);
  pulseFlash();
  audio.shoot();
  if (entry.hit) audio.hit(entry.points);
  else audio.miss();

  const text = entry.hit ? `${entry.label} +${entry.points}` : "Fallo";
  updateHud(text);
  popText(text, entry.hit ? "hit" : "miss");
  say(entry.hit ? `${entry.label}, más ${entry.points}. Llevas ${game.score}.` : `Fallo. Llevas ${game.score}.`);

  if (game.shots.length >= MAX_SHOTS) {
    game.finishTimer = setTimeout(() => {
      if (game.phase === "playing") finish();
    }, 720);
  }
}

function stampHole(hit) {
  const ring = new THREE.Mesh(world.holeGeo, world.holeRingMat);
  const dot = new THREE.Mesh(new THREE.CircleGeometry(0.026, 14), world.holeMat);
  dot.position.z = 0.001;
  ring.add(dot);

  const normal = hit.face.normal.clone();
  const inverse = new THREE.Matrix4().copy(hit.object.matrixWorld).invert();
  normal.transformDirection(inverse);
  const localPoint = hit.object.worldToLocal(hit.point.clone());
  ring.position.copy(localPoint).addScaledVector(normal, 0.015);
  ring.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), normal.normalize());
  hit.object.add(ring);
  world.holes.push(ring);
}

function clearHoles() {
  world.holes.forEach((hole) => hole.parent?.remove(hole));
  world.holes.length = 0;
}

function burst(point, color) {
  for (let i = 0; i < 7; i += 1) {
    const material = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 1 });
    const mesh = new THREE.Mesh(world.sparkGeo, material);
    mesh.position.copy(point);
    world.scene.add(mesh);
    world.sparks.push({
      mesh,
      vel: new THREE.Vector3((Math.random() - 0.5) * 2.4, Math.random() * 2.2, (Math.random() - 0.5) * 2.4),
      life: 0.32,
    });
  }
}

function showTracer(point) {
  const from = new THREE.Vector3(0, 1.28, 3.5);
  const to = point ? point.clone() : from.clone().add(new THREE.Vector3(aim.x * 4, aim.y * 3, -8));
  const direction = new THREE.Vector3().subVectors(to, from);
  const length = direction.length();
  if (length < 0.05) return;
  world.tracer.scale.set(1, length, 1);
  world.tracer.position.copy(from).addScaledVector(direction, 0.5);
  world.tracer.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction.normalize());
  world.tracer.material.opacity = 0.85;
}

function pulseFlash() {
  flash.classList.remove("on");
  void flash.offsetWidth;
  flash.classList.add("on");
  crosshair.classList.add("hit");
  setTimeout(() => crosshair.classList.remove("hit"), 140);
}

function popText(text, kind) {
  const node = document.createElement("div");
  node.className = `pop ${kind}`;
  node.textContent = text;
  node.style.left = crosshair.style.left;
  node.style.top = crosshair.style.top;
  document.body.appendChild(node);
  node.addEventListener("animationend", () => node.remove());
}

function updateHud(callout) {
  const left = MAX_SHOTS - game.shots.length;
  $("round-label").textContent = `Nivel ${game.test}`;
  $("remain").textContent = left === 1 ? "1 tiro" : `${left} tiros`;
  $("remain").parentElement.classList.toggle("warn", left === 1);
  $("score").textContent = String(game.score);
  $("meter").style.width = `${Math.min(100, (game.score / PASS_SCORE) * 100)}%`;
  $("callout").textContent = callout;
  const bullets = $("bullets");
  bullets.replaceChildren();
  for (let i = 0; i < MAX_SHOTS; i += 1) {
    const bullet = document.createElement("i");
    bullet.className = i < left ? "bullet" : "bullet spent";
    bullets.appendChild(bullet);
  }
}

function finish() {
  game.phase = "result";
  const passed = game.score >= PASS_SCORE;
  if (passed) {
    game.streak += 1;
    saveStreak(game.streak);
  }
  saveBest(game.score);
  hud.hidden = true;
  crosshair.hidden = true;
  hint.hidden = true;
  result.hidden = false;

  const gap = game.score - PASS_SCORE;
  const missing = PASS_SCORE - game.score;
  const pointsWord = (n) => (n === 1 ? "punto" : "puntos");
  const hasNext = passed && game.test < 2;
  $("stamp").textContent = passed ? "Aprobado" : "Reprobado";
  $("stamp").classList.toggle("win", passed);
  $("retry").textContent = hasNext ? "Nivel 2" : passed ? "Jugar de nuevo" : "Desde el principio";

  if (passed && game.test === 1) {
    const margin = gap === 0 ? "Llegaste justo a la meta." : `Superaste la meta por ${gap} ${pointsWord(gap)}.`;
    $("result-title").textContent = "Nivel 1 aprobado";
    $("result-copy").textContent = `${margin} El nivel 2 es en la ciudad y el blanco se mueve un poco más. Otra vez tienes 3 tiros.`;
  } else if (passed) {
    const margin = gap === 0 ? "Llegaste justo a la meta." : `Superaste la meta por ${gap} ${pointsWord(gap)}.`;
    $("result-title").textContent = "Ciudad superada";
    $("result-copy").textContent = `${margin} Completaste los dos niveles.`;
  } else if (game.test > 1) {
    $("result-title").textContent = "Se cortó en la ciudad";
    $("result-copy").textContent = `Aprobaste el nivel 1 y fallaste el nivel 2. Te faltaron ${missing} ${pointsWord(missing)}.`;
  } else {
    $("result-title").textContent = "Se agotaron los 3 tiros";
    $("result-copy").textContent = `Te faltaron ${missing} ${pointsWord(missing)} para aprobar.`;
  }
  $("result-score").textContent = String(game.score);
  $("log").replaceChildren(
    ...game.shots.map((shot, index) => {
      const item = document.createElement("li");
      item.innerHTML = `<span>Tiro ${index + 1} · ${shot.label}</span><b>${shot.hit ? `+${shot.points}` : "0"}</b>`;
      return item;
    })
  );
  showBest($("result-best"));
  if (passed) audio.win();
  else audio.lose();
  say(passed ? `Nivel ${game.test} aprobado.` : `Reprobado en el nivel ${game.test}.`);
}

function showBest(node) {
  const parts = [];
  const best = readBest();
  const streak = readStreak();
  if (best > 0) parts.push(`Mejor marca: ${best}`);
  if (streak > 0) parts.push(`Mejor racha: ${streak}`);
  node.textContent = parts.join(" · ");
}

function readBest() {
  return readNumber(BEST_KEY);
}

function readStreak() {
  return readNumber(STREAK_KEY);
}

function readNumber(key) {
  try {
    return Number(localStorage.getItem(key) || 0);
  } catch {
    return 0;
  }
}

function saveBest(score) {
  return writeMax(BEST_KEY, score);
}

function saveStreak(streak) {
  return writeMax(STREAK_KEY, streak);
}

function writeMax(key, value) {
  const best = Math.max(readNumber(key), value);
  try {
    localStorage.setItem(key, String(best));
  } catch {
    /* sin almacenamiento, la marca solo vive en esta partida */
  }
  return best;
}

function say(text) {
  live.textContent = text;
}

function tick(time) {
  const t = time / 1000;
  const drift = motion();
  world.mover.position.x = Math.sin(t * drift.speed) * drift.amp + Math.sin(t * drift.speed * 0.41) * drift.amp * 0.28;
  world.mover.position.y = BASE_Y + Math.sin(t * drift.speed * 1.35) * drift.bob;
  world.spot.target.position.x = world.mover.position.x;
  world.spot.target.position.y = world.mover.position.y;
  if (world.flag) world.flag.rotation.y = Math.sin(t * 2.2) * 0.28;

  if (game.phase === "playing") {
    const step = 0.9 * 0.016;
    if (held.has("ArrowLeft")) aim.x -= step;
    if (held.has("ArrowRight")) aim.x += step;
    if (held.has("ArrowUp")) aim.y += step;
    if (held.has("ArrowDown")) aim.y -= step;
    if (held.has("ArrowLeft") || held.has("ArrowRight") || held.has("ArrowUp") || held.has("ArrowDown")) {
      clampAim();
      placeCrosshair();
    }
  }

  if (world.tracer.material.opacity > 0) {
    world.tracer.material.opacity = Math.max(0, world.tracer.material.opacity - 0.08);
  }

  for (let i = world.sparks.length - 1; i >= 0; i -= 1) {
    const spark = world.sparks[i];
    spark.life -= 0.016;
    spark.vel.y -= 5.5 * 0.016;
    spark.mesh.position.addScaledVector(spark.vel, 0.016);
    spark.mesh.material.opacity = Math.max(spark.life / 0.32, 0);
    if (spark.life <= 0) {
      spark.mesh.removeFromParent();
      spark.mesh.material.dispose();
      world.sparks.splice(i, 1);
    }
  }

  const knock = Math.max(0, 1 - (performance.now() - game.lastShotAt) / 180);
  world.camera.position.z = 4.7 + knock * 0.06;

  world.renderer.render(world.scene, world.camera);
}
