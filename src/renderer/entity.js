// AURELIUM particle entity.
// ~18k GPU-animated particles forming an abstract head-and-shoulders silhouette
// drawn as flowing horizontal contour lines, with a warm core inside the shell.
// All motion runs in the vertex shader so the CPU does almost nothing per frame.
import * as THREE from '../../node_modules/three/build/three.module.js';

const STATES = ['idle', 'listening', 'thinking', 'speaking'];

// Smoothstep helpers for building the silhouette profile.
const clamp01 = (v) => Math.max(0, Math.min(1, v));
const smooth = (a, b, x) => { const t = clamp01((x - a) / (b - a)); return t * t * (3 - 2 * t); };

// Half-width (rx) and half-depth (rz) of the body at height y. y runs from -1.0 (chest cut-off) to ~1.72 (crown).
function profile(y) {
  const headY = 1.1, headRy = 0.58, headRx = 0.5;
  let rx = 0, rz = 0;

  // Head: ellipsoid with a gentle jaw taper.
  const hy = (y - headY) / headRy;
  if (Math.abs(hy) < 1) {
    let r = headRx * Math.sqrt(1 - hy * hy);
    if (y < headY) r *= 0.88 + 0.12 * clamp01((y - (headY - headRy)) / headRy);
    rx = r; rz = r * 1.08;
  }
  // Neck + shoulders + chest, blended into the head underside.
  if (y < 0.56) {
    const s = smooth(0.3, -0.38, y);                   // 0 at neck, 1 at full shoulder width
    const bodyRx = 0.19 + 1.33 * s - 0.05 * smooth(-0.38, -1.0, y);
    const bodyRz = 0.17 + 0.30 * s;
    const blend = smooth(0.56, 0.44, y);               // fade neck in under the chin
    rx = Math.max(rx, bodyRx * blend);
    rz = Math.max(rz, bodyRz * blend);
  }
  return { rx, rz };
}

function buildGeometry(total) {
  const shellCount = Math.round(total * 0.75);
  const coreCount = Math.round(total * 0.17);
  const haloCount = total - shellCount - coreCount;

  const data0 = new Float32Array(total * 4); // y, rx, rz, angle
  const data1 = new Float32Array(total * 4); // ring01, rand, type, rand2
  const pos = new Float32Array(total * 3);
  let i = 0;
  const push = (y, rx, rz, ang, ring, type) => {
    data0.set([y, rx, rz, ang], i * 4);
    data1.set([ring, Math.random(), type, Math.random()], i * 4);
    pos.set([rx * Math.cos(ang), y, rz * Math.sin(ang)], i * 3);
    i++;
  };

  // --- Shell: horizontal contour rings ---
  const yMin = -1.0, yMax = 1.68, rings = 76;
  const perims = [];
  let perimSum = 0;
  for (let r = 0; r < rings; r++) {
    const y = yMin + (yMax - yMin) * (r / (rings - 1));
    const { rx, rz } = profile(y);
    const p = 2 * Math.PI * Math.sqrt((rx * rx + rz * rz) / 2);
    perims.push({ y, rx, rz, p });
    perimSum += p;
  }
  for (let r = 0; r < rings; r++) {
    const { y, rx, rz, p } = perims[r];
    if (p < 0.01) continue;
    const n = Math.max(4, Math.round(shellCount * (p / perimSum)));
    const ring01 = r / (rings - 1);
    const offset = Math.random() * Math.PI * 2;
    for (let k = 0; k < n && i < shellCount; k++) {
      const ang = offset + (k / n) * Math.PI * 2 + (Math.random() - 0.5) * 0.02;
      push(y + (Math.random() - 0.5) * 0.004, rx, rz, ang, ring01, 0);
    }
  }
  while (i < shellCount) push(0, 0.19, 0.17, Math.random() * 6.283, 0.5, 0);

  // --- Core: warm glow in the chest and the head centre ---
  const clusters = [
    { y: -0.25, r: 0.36, w: 0.62 },
    { y: 1.10, r: 0.24, w: 0.38 }
  ];
  for (let k = 0; k < coreCount; k++) {
    const c = Math.random() < clusters[0].w ? clusters[0] : clusters[1];
    const rr = c.r * Math.pow(Math.random(), 0.75);
    const elev = (Math.random() - 0.5) * Math.PI;
    const radial = rr * Math.cos(elev);
    push(c.y + rr * Math.sin(elev), radial, radial, Math.random() * Math.PI * 2, Math.random(), 1);
  }

  // --- Halo: sparse dust around the figure for depth ---
  for (let k = 0; k < haloCount; k++) {
    const y = -1.3 + Math.random() * 3.3;
    const rr = 0.9 + Math.random() * 1.3;
    push(y, rr * 1.4, rr * 0.9, Math.random() * Math.PI * 2, Math.random(), 2);
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('aData0', new THREE.BufferAttribute(data0, 4));
  geo.setAttribute('aData1', new THREE.BufferAttribute(data1, 4));
  return geo;
}

const VERT = /* glsl */`
uniform float uTime, uIdle, uListen, uThink, uSpeak, uLevel, uPixelRatio, uBaseSize;
attribute vec4 aData0;
attribute vec4 aData1;
varying float vBright;
varying float vCore;
varying float vType;

void main() {
  float y0 = aData0.x, rx = aData0.y, rz = aData0.z, ang0 = aData0.w;
  float ring = aData1.x, rnd = aData1.y, type = aData1.z, rnd2 = aData1.w;
  float t = uTime;
  bool isShell = type < 0.5;
  bool isCore  = type > 0.5 && type < 1.5;
  bool isHalo  = type > 1.5;

  // Alternate flow direction per contour ring.
  float dir = mod(floor(ring * 76.0), 2.0) < 1.0 ? 1.0 : -1.0;
  float speed = 0.10 + 0.08 * rnd + uThink * (1.4 + 1.1 * rnd);
  float ang = ang0 + dir * speed * t;
  if (isCore) ang = ang0 + (0.3 + 0.5 * rnd) * t * (rnd2 > 0.5 ? 1.0 : -1.0) + uThink * t * 2.0;
  if (isHalo) ang = ang0 + 0.05 * t + uThink * t * 0.4;

  // Radial scale: breathing, pulling in, swirling out, pulsing with voice.
  float breath = 1.0 + 0.028 * sin(t * 0.8 + ring * 3.0) * uIdle;
  float listen = 1.0 - (0.27 + 0.08 * uLevel) * uListen;
  float think  = 1.0 + 0.16 * uThink * (0.6 + 0.4 * sin(t * 2.0 + ring * 12.0));
  float pulse  = 1.0 + uSpeak * uLevel * (0.10 + 0.16 * sin(t * 22.0 + ring * 8.0 + rnd * 3.0));
  float scale  = breath * listen * think * pulse;

  float wob = 0.012 * sin(t * 1.3 + ang0 * 3.0 + ring * 20.0) + 0.010 * sin(t * 0.7 + ring * 40.0);
  float rX = rx * scale + wob * (isHalo ? 0.0 : 1.0);
  float rZ = rz * scale + wob * (isHalo ? 0.0 : 1.0);
  float y = y0 + 0.02 * sin(t * 0.9 + ring * 6.0) * uIdle;
  y += uThink * 0.14 * sin(ang * 2.0 + t * 1.5);          // rings lift into a tilted orbit
  y = mix(y, 0.35 + (y - 0.35) * 0.92, uListen);            // gather slightly toward centre

  vec3 p = vec3(rX * cos(ang), y, rZ * sin(ang));
  if (isHalo) p *= 1.0 + 0.3 * uThink + 0.1 * uSpeak * uLevel;

  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mv;

  float size = uBaseSize * (isShell ? 1.0 : (isCore ? 1.4 : 0.9));
  size *= 1.0 + 0.3 * uListen + 0.45 * uSpeak * uLevel;
  gl_PointSize = size * uPixelRatio * (0.8 + 0.7 * rnd) / -mv.z;

  float bright = 0.95 + 0.55 * rnd;
  bright *= 1.0 + 0.7 * uListen + 0.5 * uListen * uLevel + 0.6 * uSpeak * uLevel + 0.25 * uThink;
  bright *= 0.8 + 0.2 * sin(t * 3.0 + ang * 6.0 + ring * 30.0);
  if (isShell) bright *= smoothstep(0.0, 0.14, ring);   // dissolve the chest cut-off
  vBright = bright;

  float heart = 1.0 - smoothstep(0.0, 0.72, length(p - vec3(0.0, -0.25, 0.0)));
  float headc = 1.0 - smoothstep(0.0, 0.58, length(p - vec3(0.0, 1.10, 0.0)));
  float core = max(heart, headc) * (isShell ? 0.5 : 1.0);
  if (isCore) core = max(core, 0.8);
  if (isHalo) core = 0.0;
  vCore = clamp(core, 0.0, 1.0);
  vType = type;
}
`;

const FRAG = /* glsl */`
precision highp float;
uniform vec3 uBlue, uBlueHi, uGold, uGoldHi;
varying float vBright;
varying float vCore;
varying float vType;

void main() {
  vec2 c = gl_PointCoord - 0.5;
  float d = length(c);
  if (d > 0.5) discard;
  float a = pow(smoothstep(0.5, 0.0, d), 1.7);
  vec3 cool = mix(uBlue, uBlueHi, clamp(vBright * 0.55, 0.0, 1.0));
  vec3 warm = mix(uGold, uGoldHi, clamp(vBright * 0.45, 0.0, 1.0));
  vec3 col = mix(cool, warm, vCore);
  float alpha = a * min(vBright, 1.6) * (vType > 1.5 ? 0.16 : 0.75);
  gl_FragColor = vec4(col * alpha, alpha);
}
`;

export class Entity {
  constructor(canvas, { count = 18000 } = {}) {
    this.canvas = canvas;
    this.count = count;
    this.state = 'idle';
    this.weights = { idle: 1, listening: 0, thinking: 0, speaking: 0 };
    this.targets = { ...this.weights };
    this.level = 0;
    this.levelTarget = 0;
    this.fps = 0;
    this.spin = 0;
    this._frames = 0;
    this._fpsClock = 0;
    this.clock = new THREE.Clock();

    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, alpha: false, powerPreference: 'high-performance' });
    this.renderer.setClearColor(0x000000, 1);
    this.pixelRatio = Math.min(window.devicePixelRatio || 1, 1.5);
    this.renderer.setPixelRatio(this.pixelRatio);

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(40, 1, 0.1, 50);
    this.camera.position.set(0, 0.35, 4.6);
    this.camera.lookAt(0, 0.35, 0);

    this.uniforms = {
      uTime: { value: 0 },
      uIdle: { value: 1 }, uListen: { value: 0 }, uThink: { value: 0 }, uSpeak: { value: 0 },
      uLevel: { value: 0 },
      uPixelRatio: { value: this.pixelRatio },
      uBaseSize: { value: 13.0 },
      uBlue: { value: new THREE.Color(0x1a6cff) },
      uBlueHi: { value: new THREE.Color(0x7cc8ff) },
      uGold: { value: new THREE.Color(0xff7a1a) },
      uGoldHi: { value: new THREE.Color(0xffd27a) }
    };
    const material = new THREE.ShaderMaterial({
      uniforms: this.uniforms, vertexShader: VERT, fragmentShader: FRAG,
      transparent: true, depthWrite: false, depthTest: false, blending: THREE.AdditiveBlending
    });
    this.points = new THREE.Points(buildGeometry(count), material);
    this.points.frustumCulled = false;
    this.group = new THREE.Group();
    this.group.add(this.points);
    this.scene.add(this.group);

    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  resize() {
    const w = this.canvas.clientWidth || window.innerWidth;
    const h = this.canvas.clientHeight || window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    // Keep the whole figure in frame on narrow windows.
    this.camera.position.z = w / h < 1.3 ? 5.6 : 4.6;
    this.camera.updateProjectionMatrix();
  }

  setState(name) {
    if (!STATES.includes(name)) return;
    this.state = name;
    for (const s of STATES) this.targets[s] = s === name ? 1 : 0;
  }

  // 0..1 loudness of the voice currently playing. Only matters in the speaking state.
  setLevel(v) { this.levelTarget = Math.max(0, Math.min(1, v)); }

  render() {
    const dt = Math.min(this.clock.getDelta(), 0.1);
    const t = this.clock.elapsedTime;
    const k = 1 - Math.exp(-dt * 3.2);
    for (const s of STATES) this.weights[s] += (this.targets[s] - this.weights[s]) * k;
    this.level += (this.levelTarget - this.level) * (1 - Math.exp(-dt * 14));

    const u = this.uniforms;
    u.uTime.value = t;
    u.uIdle.value = this.weights.idle;
    u.uListen.value = this.weights.listening;
    u.uThink.value = this.weights.thinking;
    u.uSpeak.value = this.weights.speaking;
    u.uLevel.value = this.level;

    // Gentle camera drift and a slow yaw sway so the figure feels alive.
    // Spin while thinking; afterwards ease back to the nearest front-facing angle.
    this.spin += dt * this.weights.thinking * 0.35;
    if (this.weights.thinking < 0.5) {
      const home = Math.round(this.spin / (Math.PI * 2)) * Math.PI * 2;
      this.spin += (home - this.spin) * (1 - Math.exp(-dt * 1.5));
    }
    this.group.rotation.y = Math.sin(t * 0.18) * 0.1 + this.spin;
    this.camera.position.x = Math.sin(t * 0.13) * 0.12;
    this.camera.position.y = 0.35 + Math.sin(t * 0.21) * 0.05;
    this.camera.lookAt(0, 0.35, 0);

    this.renderer.render(this.scene, this.camera);

    this._frames++;
    this._fpsClock += dt;
    if (this._fpsClock >= 1) { this.fps = Math.round(this._frames / this._fpsClock); this._frames = 0; this._fpsClock = 0; }
  }
}
