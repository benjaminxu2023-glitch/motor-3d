import * as THREE from './vendor/three.module.min.js';
import * as P from './physics.js';

// ---------- 尺寸（单位任意，定子外径 = 2） ----------
const L = 1.2, R_OUT = 1.0, R_BORE = 0.58, R_SLOT = 0.8, SLOT_W = 0.085, NS = 24;
const R_ROT = 0.52, NBARS = 18, R_BAR = 0.45, BAR_R = 0.03, R_SHAFT = 0.11;
const R_GAP = (R_ROT + R_BORE) / 2;
const ZF = L / 2;                 // 前端面
const BASE_F = 0.2;               // 动画 1× 时的电频率（Hz）
const PH_HEX = [0xd9a000, 0x2e9a48, 0xd23a2e]; // A 黄 B 绿 C 红
const PH_CSS = ['#b88600', '#25803b', '#c4302a'];
const FIELD_HEX = 0x6a32b0;

// ---------- 渲染基础 ----------
const view = document.getElementById('view');
const canvas = document.getElementById('c');
const labelsEl = document.getElementById('labels');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.setClearColor(0xf2f2f2, 1);
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(36, 1, 0.1, 60);
scene.add(new THREE.HemisphereLight(0xffffff, 0x8a8a8a, 2.0));
const dl = new THREE.DirectionalLight(0xffffff, 2.2); dl.position.set(3, 4, 6); scene.add(dl);
const dl2 = new THREE.DirectionalLight(0xffffff, 0.8); dl2.position.set(-4, -2, 3); scene.add(dl2);

const std = (color, o = {}) => new THREE.MeshStandardMaterial({ color, metalness: 0.3, roughness: 0.55, ...o });
const M = {
  stator: std(0x7d838a), rotor: std(0xb9bdc2), al: std(0xbfc3c8, { metalness: 0.55, roughness: 0.35 }),
  shaft: std(0x5a5f66, { metalness: 0.6, roughness: 0.35 }), mark: std(0x222222),
  housing: std(0xaeb4ba, { transparent: true, opacity: 0.3, side: THREE.DoubleSide, depthWrite: false }),
  magN: std(0xc0392b, { roughness: 0.45 }), magS: std(0x2c5aa0, { roughness: 0.45 }),
};
const phaseMat = PH_HEX.map((c) => std(c, { roughness: 0.45 }));
const phaseFull = PH_HEX.map((c) => new THREE.Color(c));
const phasePale = PH_HEX.map((c) => new THREE.Color(c).lerp(new THREE.Color(0xffffff), 0.72));

const motor = new THREE.Group(); scene.add(motor);

// ---------- 定子：硅钢片叠压铁心 + 槽 ----------
function statorShape() {
  const sh = new THREE.Shape(); sh.absarc(0, 0, R_OUT, 0, Math.PI * 2, false);
  const pts = [], hw = SLOT_W / 2, rb = Math.sqrt(R_BORE * R_BORE - hw * hw), da = Math.asin(hw / R_BORE);
  for (let i = 0; i < NS; i++) {
    const c = ((i + 0.5) * Math.PI * 2) / NS, cu = Math.cos(c), su = Math.sin(c);
    const Pt = (r, t) => new THREE.Vector2(cu * r - su * t, su * r + cu * t);
    pts.push(Pt(rb, -hw), Pt(R_SLOT, -hw));
    for (let k = 1; k < 6; k++) { const b = (Math.PI * k) / 6; pts.push(Pt(R_SLOT + hw * Math.sin(b), -hw * Math.cos(b))); }
    pts.push(Pt(R_SLOT, hw), Pt(rb, hw));
    const a0 = c + da, a1 = ((i + 1.5) * Math.PI * 2) / NS - da;
    for (let k = 1; k < 4; k++) { const a = a0 + ((a1 - a0) * k) / 4; pts.push(new THREE.Vector2(R_BORE * Math.cos(a), R_BORE * Math.sin(a))); }
  }
  const hole = new THREE.Path(); hole.setFromPoints(pts); sh.holes.push(hole);
  return sh;
}
function laminated(shape, length, mat, slices = 20) {
  const g = new THREE.Group(), gap = 0.006, t = length / slices - gap;
  const geo = new THREE.ExtrudeGeometry(shape, { depth: t, bevelEnabled: false, curveSegments: 48 });
  for (let i = 0; i < slices; i++) { const m = new THREE.Mesh(geo, mat); m.position.z = -length / 2 + i * (length / slices) + gap / 2; g.add(m); }
  return g;
}
const stator = new THREE.Group(); motor.add(stator);
stator.add(laminated(statorShape(), L, M.stator, 24));

// ---------- 三相绕组 ----------
const slots = P.slotLayout(NS);
const condR0 = R_BORE + 0.03, condR1 = R_SLOT + 0.01, condRc = (condR0 + condR1) / 2;
const condGeo = new THREE.BoxGeometry(condR1 - condR0, SLOT_W - 0.02, L + 0.04);
const frontEnds = new THREE.Group(), backEnds = new THREE.Group(); stator.add(frontEnds, backEnds);
for (const s of slots) {
  const m = new THREE.Mesh(condGeo, phaseMat[s.phase]);
  m.position.set(condRc * Math.cos(s.angle), condRc * Math.sin(s.angle), 0); m.rotation.z = s.angle; stator.add(m);
}
// 端部：每相 4 个整距线圈，去线槽 → 相隔 180° 的回线槽
for (let k = 0; k < 3; k++) {
  const plus = slots.filter((s) => s.phase === k && s.sign > 0);
  plus.forEach((s, j) => {
    for (const side of [1, -1]) {
      const pts = [], re = 0.74 + 0.075 * k, ze = ZF + 0.1 + 0.035 * j + 0.02 * k;
      for (let n = 0; n <= 48; n++) {
        const u = n / 48, a = s.angle + Math.PI * u, sn = Math.sin(Math.PI * u);
        const r = condRc + (re - condRc) * Math.min(1, sn * 2.5), z = ZF + 0.02 + (ze - ZF - 0.02) * Math.min(1, sn * 3.2);
        pts.push(new THREE.Vector3(r * Math.cos(a), r * Math.sin(a), side * z));
      }
      const tube = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 64, 0.02, 6), phaseMat[k]);
      (side > 0 ? frontEnds : backEnds).add(tube);
    }
  });
}

// ---------- ⊙ / ⊗ 符号 ----------
function symTex(kind) {
  const cv = document.createElement('canvas'); cv.width = cv.height = 128; const g = cv.getContext('2d');
  g.fillStyle = '#fff'; g.strokeStyle = '#111'; g.lineWidth = 10;
  g.beginPath(); g.arc(64, 64, 54, 0, Math.PI * 2); g.fill(); g.stroke();
  if (kind === 'dot') { g.fillStyle = '#111'; g.beginPath(); g.arc(64, 64, 17, 0, Math.PI * 2); g.fill(); }
  else { g.lineWidth = 11; g.beginPath(); g.moveTo(32, 32); g.lineTo(96, 96); g.moveTo(96, 32); g.lineTo(32, 96); g.stroke(); }
  const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; return t;
}
function textTex(txt, color) {
  const cv = document.createElement('canvas'); cv.width = cv.height = 128; const g = cv.getContext('2d');
  g.fillStyle = color; g.font = 'bold 96px Arial'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(txt, 64, 70);
  const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; return t;
}
const TEX = { dot: symTex('dot'), cross: symTex('cross') };
function makeSym(parent, x, y, z) {
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: TEX.dot, transparent: true, depthTest: false }));
  sp.position.set(x, y, z); sp.renderOrder = 10; parent.add(sp); return sp;
}
const statorSyms = slots.map((s) => makeSym(stator, condRc * Math.cos(s.angle), condRc * Math.sin(s.angle), ZF + 0.05));
function setSym(sp, v, base) {
  const a = Math.min(1, Math.abs(v));
  sp.material.map = v >= 0 ? TEX.dot : TEX.cross;
  sp.scale.setScalar(base * (0.45 + 0.55 * a));
  sp.material.opacity = a < 0.04 ? 0 : 0.35 + 0.65 * a;
}

// ---------- 机壳（剖切） ----------
const housing = new THREE.Group(); motor.add(housing);
{
  const g = new THREE.CylinderGeometry(1.1, 1.1, L + 0.5, 64, 1, true, Math.PI * 0.75, Math.PI * 1.5);
  const m = new THREE.Mesh(g, M.housing); m.rotation.x = Math.PI / 2; m.renderOrder = 5; housing.add(m);
}

// ---------- 转子 ----------
const rotorAxial = new THREE.Group(); motor.add(rotorAxial);   // 爆炸视图沿轴向移动
const rotorSpin = new THREE.Group(); rotorAxial.add(rotorSpin); // 绕 z 轴旋转
const shaftBack = new THREE.Mesh(new THREE.CylinderGeometry(R_SHAFT, R_SHAFT, ZF + 1.1, 32), M.shaft);
shaftBack.rotation.x = Math.PI / 2; shaftBack.position.z = (ZF - 1.1) / 2; rotorSpin.add(shaftBack);
const shaftFront = new THREE.Group(); rotorSpin.add(shaftFront); // 轴伸端，截面视图时隐藏
{ const m = new THREE.Mesh(new THREE.CylinderGeometry(R_SHAFT, R_SHAFT, 1.0, 32), M.shaft); m.rotation.x = Math.PI / 2; m.position.z = ZF + 0.5; shaftFront.add(m);
  const key = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.035, 0.6), M.mark); key.position.set(R_SHAFT, 0, ZF + 0.65); shaftFront.add(key); }
const stripe = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.03, 0.01), M.mark); stripe.position.set(0.26, 0, ZF + 0.006);

// 鼠笼转子
const cage = new THREE.Group(); rotorSpin.add(cage);
{
  const sh = new THREE.Shape(); sh.absarc(0, 0, R_ROT, 0, Math.PI * 2, false);
  const h0 = new THREE.Path(); h0.absarc(0, 0, R_SHAFT, 0, Math.PI * 2, true); sh.holes.push(h0);
  for (let n = 0; n < NBARS; n++) { const a = (n * Math.PI * 2) / NBARS, h = new THREE.Path(); h.absarc(R_BAR * Math.cos(a), R_BAR * Math.sin(a), BAR_R + 0.004, 0, Math.PI * 2, true); sh.holes.push(h); }
  cage.add(laminated(sh, L, M.rotor, 20));
  cage.add(stripe.clone());
}
const barMats = [], barSyms = [], barGeo = new THREE.CylinderGeometry(BAR_R, BAR_R, L + 0.1, 12);
for (let n = 0; n < NBARS; n++) {
  const a = (n * Math.PI * 2) / NBARS, mat = M.al.clone(); barMats.push(mat);
  const b = new THREE.Mesh(barGeo, mat); b.rotation.x = Math.PI / 2; b.position.set(R_BAR * Math.cos(a), R_BAR * Math.sin(a), 0); cage.add(b);
  barSyms.push(makeSym(cage, R_BAR * Math.cos(a), R_BAR * Math.sin(a), ZF + 0.07));
}
const ringShape = new THREE.Shape(); ringShape.absarc(0, 0, R_BAR + 0.055, 0, Math.PI * 2, false);
{ const h = new THREE.Path(); h.absarc(0, 0, R_BAR - 0.06, 0, Math.PI * 2, true); ringShape.holes.push(h); }
const ringGeo = new THREE.ExtrudeGeometry(ringShape, { depth: 0.06, bevelEnabled: false, curveSegments: 48 });
const ringF = new THREE.Mesh(ringGeo, M.al); ringF.position.z = ZF; cage.add(ringF);
const ringB = new THREE.Mesh(ringGeo, M.al); ringB.position.z = -ZF - 0.06; cage.add(ringB);

// 永磁转子（表贴式，2 极）
const pm = new THREE.Group(); rotorSpin.add(pm);
{
  const sh = new THREE.Shape(); sh.absarc(0, 0, R_ROT - 0.07, 0, Math.PI * 2, false);
  const h0 = new THREE.Path(); h0.absarc(0, 0, R_SHAFT, 0, Math.PI * 2, true); sh.holes.push(h0);
  pm.add(laminated(sh, L, M.rotor, 20));
  const mag = (a0, a1, mat) => {
    const s = new THREE.Shape(); s.absarc(0, 0, R_ROT, a0, a1, false); s.absarc(0, 0, R_ROT - 0.07, a1, a0, true);
    const m = new THREE.Mesh(new THREE.ExtrudeGeometry(s, { depth: L, bevelEnabled: false, curveSegments: 32 }), mat); m.position.z = -L / 2; pm.add(m);
  };
  const w = Math.PI * 0.44;
  mag(-w, w, M.magN); mag(Math.PI - w, Math.PI + w, M.magS);
  for (const [t, x, c] of [['N', -0.62, '#b0261b'], ['S', Math.PI - 0.62, '#1f4f99']]) {
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: textTex(t, c), transparent: true, depthTest: false }));
    sp.position.set(0.32 * Math.cos(x), 0.32 * Math.sin(x), ZF + 0.03); sp.scale.setScalar(0.2); sp.renderOrder = 11; pm.add(sp);
  }
  const s2 = stripe.clone(); s2.position.set(0.26, 0, ZF + 0.006); pm.add(s2);
}

// ---------- 箭头（磁场） ----------
function makeArrow(color, rShaft, rHead, overlay = true) {
  const mat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 1, depthTest: !overlay });
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.CylinderGeometry(rShaft, rShaft, 1, 10), mat); body.rotation.z = -Math.PI / 2; g.add(body);
  const head = new THREE.Mesh(new THREE.ConeGeometry(rHead, rHead * 2.6, 14), mat); head.rotation.z = -Math.PI / 2; g.add(head);
  g.renderOrder = 20; body.renderOrder = 20; head.renderOrder = 20;
  g.userData = { body, head, hl: rHead * 2.6, mat };
  g.setLen = (len) => { // 从原点沿 +x 长度 len（负值反向）
    const s = Math.sign(len) || 1, a = Math.abs(len), hl = Math.min(g.userData.hl, a * 0.6);
    body.scale.y = Math.max(1e-4, a - hl); body.position.x = (a - hl) / 2 * s;
    head.scale.set(1, hl / g.userData.hl, 1); head.position.x = (a - hl / 2) * s; head.rotation.z = -s * Math.PI / 2;
    g.visible = a > 0.005;
  };
  return g;
}
const fieldLayer = new THREE.Group(); fieldLayer.position.z = ZF + 0.14; motor.add(fieldLayer);
const resArrow = makeArrow(FIELD_HEX, 0.026, 0.06); fieldLayer.add(resArrow);
const compArrows = PH_HEX.map((c) => { const a = makeArrow(c, 0.012, 0.035); fieldLayer.add(a); return a; });
const ARROW_SCALE = 0.42 / 1.5;
const gapArrows = [];
const NG = 36;
for (let i = 0; i < NG; i++) { const a = makeArrow(FIELD_HEX, 0.006, 0.016); fieldLayer.add(a); gapArrows.push(a); }
// PM：转子磁极轴线 + 负载角弧
const rotAxis = makeArrow(0x8a1f15, 0.014, 0.04); fieldLayer.add(rotAxis);
const arcGeo = new THREE.BufferGeometry(); arcGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(33 * 3), 3));
const arcLine = new THREE.Line(arcGeo, new THREE.LineBasicMaterial({ color: 0x222222, depthTest: false })); arcLine.renderOrder = 21; fieldLayer.add(arcLine);

// ---------- 标签（HTML 叠加，文字清晰） ----------
const labels = [];
function addLabel(text, obj, pos, when, cls = '', color) {
  const el = document.createElement('div'); el.className = 'lb ' + cls; el.textContent = text; if (color) el.style.color = color;
  labelsEl.appendChild(el); const a = new THREE.Object3D(); a.position.copy(pos); obj.add(a);
  const l = { el, a, when }; labels.push(l); return l;
}
const pol = (r, deg, z) => new THREE.Vector3(r * Math.cos((deg * Math.PI) / 180), r * Math.sin((deg * Math.PI) / 180), z);
const has = (k) => st.labelSet.includes(k);
addLabel('机壳', housing, pol(1.12, 150, -0.35), () => has('struct') && st.housing);
addLabel('定子铁心（硅钢片叠压）', stator, pol(0.98, -35, ZF), () => has('struct'));
addLabel('定子线圈', stator, pol(0.72, 125, -ZF - 0.05), () => has('struct'));
addLabel('线圈端部', stator, pol(0.9, 40, ZF + 0.2), () => (has('struct') || has('belts')) && !st.section);
addLabel('气隙（放大示意）', stator, pol(R_GAP, -15, ZF), () => (has('struct') || has('gap')) && explodeT < 0.05);
addLabel('转轴', rotorAxial, new THREE.Vector3(0, -0.14, ZF + 0.95), () => has('struct') && !st.section);
addLabel('鼠笼转子', rotorAxial, pol(0.3, 200, ZF + 0.06), () => has('struct') && st.mode === 'cage');
addLabel('端环', cage, pol(R_BAR, 120, ZF + 0.06), () => (has('struct') || has('cage')) && st.mode === 'cage' && !st.section && explodeT < 0.05);
addLabel('导条', cage, pol(R_BAR, 60, ZF + 0.07), () => (has('struct') || has('cage')) && st.mode === 'cage' && explodeT < 0.05);
addLabel('永磁体', pm, pol(R_ROT - 0.035, 90, ZF), () => (has('struct') || has('pm')) && st.mode === 'pm');
slots.forEach(() => {});
for (let k = 0; k < 3; k++) {
  const ax = (P.PHASE_AXES[k] * 180) / Math.PI;
  addLabel(P.PHASES[k], stator, pol(0.93, ax + 90, ZF + 0.02), () => has('belts'), 'ph', PH_CSS[k]);
  addLabel(P.RETURNS[k], stator, pol(0.93, ax - 90, ZF + 0.02), () => has('belts'), 'ph', PH_CSS[k]);
}
const resTip = new THREE.Object3D(); fieldLayer.add(resTip);
addLabel('合成磁场', resTip, new THREE.Vector3(), () => has('field') && st.field);
const deltaTip = new THREE.Object3D(); fieldLayer.add(deltaTip);
addLabel('δ', deltaTip, new THREE.Vector3(), () => st.mode === 'pm' && st.field && st.delta > 0.08);

// ---------- 状态 ----------
const sim = new P.MotorSim({ mode: 'cage', slip: 0.05 });
const st = {
  step: 0, playing: true, speed: 0.6, mode: 'cage', slip: 0.05, delta: (30 * Math.PI) / 180, swap: false,
  housing: true, section: false, explode: false, labels: true, comps: false, field: false, syms: false, barSyms: false, labelSet: ['struct'],
};
sim.delta = st.delta; sim.slip = st.slip;
let explodeT = 0;

// ---------- 导学步骤 ----------
const CAM = {
  overview: { az: 0.72, el: 0.36, dist: 5.2 }, three: { az: 0.42, el: 0.3, dist: 4.6 },
  front: { az: 0, el: 0, dist: 4.3 }, explode: { az: 1.42, el: 0.45, dist: 8.2, tz: 0.85 }, frontTilt: { az: 0.22, el: 0.16, dist: 4.4 },
};
const STEPS = [
  { t: '结构总览', cam: 'overview', set: { housing: true, section: false, comps: false, field: false, syms: false, barSyms: false, explode: false, labelSet: ['struct'] },
    html: '电机分两大部分：固定不动的<b>定子</b>（硅钢片叠成的铁心 + 嵌在槽里的三相线圈），和中间旋转的<b>转子</b>（装在转轴上，输出机械功率）。两者之间隔着一圈很窄的<b>气隙</b>，电能变机械能全靠气隙里的磁场传递。',
    act: ['tExplode', '爆炸视图：把转子抽出来看'] },
  { t: '定子与线圈排布', cam: 'three', set: { housing: false, section: false, comps: false, field: false, syms: false, barSyms: false, explode: false, labelSet: ['belts'] },
    html: '定子内圈开 24 个槽，导体嵌在槽里。这是 <b>2 极</b>电机：每相占两组正对的槽，每组 4 槽、跨 60°。<b>A 是去线、X 是回线</b>，相隔 180°，在两端（线圈端部）连成线圈；B‑Y、C‑Z 同理。三相在空间上依次错开 <b>120°</b>，沿圆周顺序是 A‑Z‑B‑X‑C‑Y。' },
  { t: '三相电流', cam: 'front', set: { housing: false, section: true, comps: true, field: false, syms: true, barSyms: false, explode: false, labelSet: ['belts'] },
    html: '三相电流幅值相同，时间上依次落后 <b>120°</b>（看下方波形）。任一时刻 i<sub>A</sub>+i<sub>B</sub>+i<sub>C</sub>=0。⊙ 电流流出屏幕、⊗ 流入，颜色越深电流越大。三根细箭头是每相线圈<b>单独</b>产生的磁场：方向固定在本相轴线上，只会变大变小、正负翻转——叫<b>脉振磁场</b>。' },
  { t: '合成旋转磁场', cam: 'front', set: { housing: false, section: true, comps: true, field: true, syms: true, barSyms: false, explode: false, labelSet: ['belts', 'field'] },
    html: '三个脉振磁场空间差 120°、时间差 120°，叠加后（粗紫箭头）<b>大小恒为单相峰值的 1.5 倍、方向匀速旋转</b>——这就是旋转磁场。气隙里的小箭头是磁场沿圆周的正弦分布，跟着一起转。转速叫同步转速 <b>n₁ = 60f / p</b>：50 Hz、2 极（p = 1）时为 3000 r/min。' },
  { t: '转子为什么会转（滑差）', cam: 'frontTilt', mode: 'cage', set: { housing: false, section: true, comps: false, field: true, syms: true, barSyms: true, explode: false, labelSet: ['cage', 'field'] },
    html: '鼠笼导条被两端端环短接成闭合回路。旋转磁场扫过导条 → 导条切割磁力线产生<b>感应电流</b>（⊙/⊗）→ 载流导条在磁场中<b>受力</b> → 转子被拖着同向转。转子必须比磁场慢：<b>滑差 s = (n₁−n)/n₁</b>，额定时一般 2–5%。把滑差拖到 0：导条与磁场无相对运动 → 无感应电流 → 无转矩，所以异步电机自己到不了同步转速。' },
  { t: '永磁转子对比', cam: 'front', mode: 'pm', set: { housing: false, section: true, comps: false, field: true, syms: true, barSyms: false, explode: false, labelSet: ['pm', 'field'] },
    html: '把转子换成永磁体（N/S）。它不靠感应，而像指南针一样被旋转磁场“牵着走”，<b>转速严格等于同步转速（s = 0）</b>，所以叫同步电机。带负载时，转子磁极（深红箭头）落后定子磁场一个<b>负载角 δ</b>，转矩 ∝ sin δ；δ 超过 90° 就会失步。永磁同步电机一般要变频器驱动，不能直接接 50 Hz 电网起动。' },
  { t: '反转：交换两相', cam: 'front', mode: 'cage', set: { housing: false, section: true, comps: false, field: true, syms: true, barSyms: true, explode: false, labelSet: ['belts', 'field'] },
    html: '任意对调两根电源线（这里对调 B、C），线圈电流的相序变成 A→C→B，<b>旋转磁场反向</b>，转子先减速、再反向加速。现场改电机转向就是对调任意两相接线。',
    act: ['tSwap', '交换 B、C 两相'] },
];

// ---------- 相机控制 ----------
const cam = { ...CAM.overview };
let tween = null;
function fitDist(d) { const a = camera.aspect || 1; return a < 1 ? d / Math.pow(a, 0.85) : d; }
function applyCam() {
  const d = fitDist(cam.dist), ce = Math.cos(cam.el);
  const tz = cam.tz ?? 0.15;
  camera.position.set(d * Math.sin(cam.az) * ce, d * Math.sin(cam.el), d * Math.cos(cam.az) * ce + tz);
  camera.lookAt(0, 0, tz);
}
function goCam(name) { tween = { from: { ...cam }, to: CAM[name], t0: performance.now(), dur: 650 }; }
const ptrs = new Map(); let lastTap = 0, pinch0 = 0, dist0 = 0;
const pdist = () => { const [a, b] = [...ptrs.values()]; return Math.hypot(a.x - b.x, a.y - b.y); };
canvas.addEventListener('pointerdown', (e) => {
  canvas.setPointerCapture(e.pointerId); ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY }); tween = null;
  if (ptrs.size === 2) { pinch0 = pdist(); dist0 = cam.dist; }
  if (ptrs.size === 1) { const t = performance.now(); if (t - lastTap < 320) { goCam(STEPS[st.step].cam); lastTap = 0; } else lastTap = t; }
  dirty = true;
});
canvas.addEventListener('pointermove', (e) => {
  const p = ptrs.get(e.pointerId); if (!p) return;
  const dx = e.clientX - p.x, dy = e.clientY - p.y; p.x = e.clientX; p.y = e.clientY;
  if (ptrs.size === 1) { cam.az -= dx * 0.009; cam.el = Math.max(-1.4, Math.min(1.4, cam.el + dy * 0.009)); if (Math.abs(dx) + Math.abs(dy) > 3) lastTap = 0; }
  else if (ptrs.size === 2 && pinch0 > 0) cam.dist = Math.max(2.2, Math.min(11, (dist0 * pinch0) / Math.max(10, pdist())));
  dirty = true;
});
const up = (e) => { ptrs.delete(e.pointerId); if (ptrs.size < 2) pinch0 = 0; };
canvas.addEventListener('pointerup', up); canvas.addEventListener('pointercancel', up);
canvas.addEventListener('wheel', (e) => { e.preventDefault(); cam.dist = Math.max(2.2, Math.min(11, cam.dist * (1 + e.deltaY * 0.001))); dirty = true; }, { passive: false });
document.addEventListener('gesturestart', (e) => e.preventDefault());

// ---------- UI ----------
const $ = (id) => document.getElementById(id);
const dots = $('dots'); STEPS.forEach(() => dots.appendChild(document.createElement('span')));
function toggleBtn(id, keyName, after) {
  $(id).addEventListener('click', () => { st[keyName] = !st[keyName]; if (after) after(); syncUI(); dirty = true; });
}
toggleBtn('tHousing', 'housing'); toggleBtn('tSection', 'section'); toggleBtn('tLabels', 'labels');
toggleBtn('tComps', 'comps'); toggleBtn('tField', 'field'); toggleBtn('tExplode', 'explode', () => goCam(st.explode ? 'explode' : STEPS[st.step].cam));
toggleBtn('tSwap', 'swap', () => { sim.swap = st.swap ? [1, 2] : null; });
$('tReset').addEventListener('click', () => goCam(STEPS[st.step].cam));
$('play').addEventListener('click', () => { st.playing = !st.playing; syncUI(); dirty = true; });
$('speed').addEventListener('input', (e) => { st.speed = +e.target.value; syncUI(); });
$('slip').addEventListener('input', (e) => { st.slip = +e.target.value; sim.slip = st.slip; syncUI(); dirty = true; });
$('delta').addEventListener('input', (e) => { st.delta = (+e.target.value * Math.PI) / 180; sim.delta = st.delta; if (!st.playing) sim.step(0); syncUI(); dirty = true; });
function setMode(m) {
  if (st.mode === m) return; st.mode = m; sim.mode = m;
  if (m === 'cage') { sim.rotorRatio = sim.direction(); } // 从同步状态开始减速到 (1−s)
  sim.step(0); syncUI(); dirty = true;
}
$('mCage').addEventListener('click', () => setMode('cage')); $('mPm').addEventListener('click', () => setMode('pm'));
$('prev').addEventListener('click', () => applyStep(Math.max(0, st.step - 1)));
$('next').addEventListener('click', () => applyStep(Math.min(STEPS.length - 1, st.step + 1)));

function applyStep(i) {
  st.step = i; const s = STEPS[i];
  Object.assign(st, s.set);
  if (s.mode) setMode(s.mode);
  if (i !== STEPS.length - 1 && st.swap) { st.swap = false; sim.swap = null; }
  $('stepNo').textContent = `${i + 1}/${STEPS.length}`; $('stepTitle').textContent = s.t;
  $('stepText').innerHTML = s.html;
  const act = $('stepAct'); act.innerHTML = '';
  if (s.act) { const b = document.createElement('button'); b.textContent = s.act[1]; b.addEventListener('click', () => $(s.act[0]).click()); act.appendChild(b); b.id = 'actBtn'; }
  [...dots.children].forEach((d, k) => d.classList.toggle('cur', k === i));
  goCam(s.cam); syncUI(); dirty = true;
}
function syncUI() {
  for (const [id, k] of [['tHousing', 'housing'], ['tSection', 'section'], ['tExplode', 'explode'], ['tLabels', 'labels'], ['tComps', 'comps'], ['tField', 'field'], ['tSwap', 'swap']]) $(id).classList.toggle('on', !!st[k]);
  const ab = $('actBtn'), sa = STEPS[st.step].act; if (ab && sa) ab.classList.toggle('on', !!st[sa[0] === 'tSwap' ? 'swap' : 'explode']);
  $('play').textContent = st.playing ? '暂停' : '播放';
  $('speedV').textContent = st.speed.toFixed(2) + '×';
  $('slipV').textContent = (st.slip * 100).toFixed(1) + '%';
  $('deltaV').textContent = Math.round((st.delta * 180) / Math.PI) + '°';
  $('mCage').classList.toggle('on', st.mode === 'cage'); $('mPm').classList.toggle('on', st.mode === 'pm');
  $('slipRow').style.display = st.mode === 'cage' ? '' : 'none'; $('deltaRow').style.display = st.mode === 'pm' ? '' : 'none';
  $('prev').disabled = st.step === 0; $('next').disabled = st.step === STEPS.length - 1;
}

// ---------- 波形面板 ----------
const wave = $('wave'), wctx = wave.getContext('2d');
function drawWave(cur) {
  const dpr = Math.min(window.devicePixelRatio || 1, 2), w = wave.clientWidth, h = wave.clientHeight;
  if (wave.width !== Math.round(w * dpr)) { wave.width = Math.round(w * dpr); wave.height = Math.round(h * dpr); }
  const g = wctx; g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, w, h);
  const x0 = 22, x1 = w - 4, ym = h / 2, A = h / 2 - 10;
  g.strokeStyle = '#ddd'; g.lineWidth = 1; g.beginPath(); g.moveTo(x0, ym); g.lineTo(x1, ym); g.stroke();
  g.fillStyle = '#888'; g.font = '10px Arial'; g.fillText('+Im', 0, ym - A + 4); g.fillText('0', 10, ym + 3); g.fillText('−Im', 0, ym + A + 3);
  for (let k = 0; k < 3; k++) {
    g.strokeStyle = PH_CSS[k]; g.lineWidth = 1.8; g.beginPath();
    for (let i = 0; i <= 120; i++) { const th = (i / 120) * Math.PI * 2, v = P.coilCurrents(th, 1, sim.swap)[k]; const x = x0 + (x1 - x0) * (i / 120), y = ym - A * v; i ? g.lineTo(x, y) : g.moveTo(x, y); }
    g.stroke();
  }
  const ph = ((sim.thetaE % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2), xc = x0 + (x1 - x0) * (ph / (Math.PI * 2));
  g.strokeStyle = '#333'; g.lineWidth = 1.2; g.beginPath(); g.moveTo(xc, 4); g.lineTo(xc, h - 4); g.stroke();
  for (let k = 0; k < 3; k++) { g.fillStyle = PH_CSS[k]; g.beginPath(); g.arc(xc, ym - A * cur[k], 3.5, 0, Math.PI * 2); g.fill(); }
}
const ro = $('ro');
function readouts(cur, f) {
  const n1 = P.syncSpeedRpm(50, 1), dir = sim.direction();
  const n = st.mode === 'cage' ? sim.rotorRatio * n1 : dir * P.pmsmRotorSpeed(n1);
  const sum = cur[0] + cur[1] + cur[2];
  const fmt = (v) => (v >= 0 ? '+' : '−') + Math.abs(v).toFixed(2);
  const rows = [
    `<div><span>i<sub>A</sub> i<sub>B</sub> i<sub>C</sub></span> ${fmt(cur[0])} ${fmt(cur[1])} ${fmt(cur[2])}</div>`,
    `<div><span>i<sub>A</sub>+i<sub>B</sub>+i<sub>C</sub> =</span> ${Math.abs(sum) < 5e-4 ? '0.00' : sum.toFixed(3)}</div>`,
    `<div><span>合成磁场 |B| =</span> ${f.mag.toFixed(2)}·Im</div>`,
    `<div><span>磁场转向</span> ${dir > 0 ? '逆时针 A→B→C' : '顺时针 A→C→B'}</div>`,
    `<div><span>同步转速 n₁ =</span> ${n1} r/min</div>`,
    `<div><span>转子转速 n =</span> ${Math.round(n)} r/min</div>`,
  ];
  if (st.mode === 'cage') { const sNow = (dir - sim.rotorRatio) * dir; rows.push(`<div><span>滑差 s =</span> ${(sNow * 100).toFixed(1)}%</div>`, `<div><span>转子看磁场</span> ${Math.round(Math.abs(sNow) * n1)} r/min 扫过</div>`); }
  else rows.push(`<div><span>负载角 δ =</span> ${Math.round((st.delta * 180) / Math.PI)}°</div>`, `<div><span>转矩 ∝ sin δ =</span> ${(Math.sin(st.delta) * 100).toFixed(0)}% 最大</div>`);
  ro.innerHTML = rows.join('');
}

// ---------- 每帧更新 ----------
const tmpV = new THREE.Vector3(), col = new THREE.Color(), barCol0 = new THREE.Color(0xbfc3c8), barCol1 = new THREE.Color(0xe07a10);
function updateScene() {
  const cur = sim.currents(), f = sim.field();
  for (let k = 0; k < 3; k++) phaseMat[k].color.copy(phasePale[k]).lerp(phaseFull[k], Math.min(1, Math.abs(cur[k])));
  slots.forEach((s, i) => { setSym(statorSyms[i], P.conductorCurrent(s, cur), 0.085); statorSyms[i].visible = st.syms; });
  housing.visible = st.housing;
  frontEnds.visible = !st.section; ringF.visible = !st.section; shaftFront.visible = !st.section;
  cage.visible = st.mode === 'cage'; pm.visible = st.mode === 'pm';
  rotorSpin.rotation.z = sim.rotorAngle;
  rotorAxial.position.z = 1.9 * explodeT; housing.position.z = -1.5 * explodeT;
  // 导条感应电流
  const rel = sim.relSpeed(), gain = 1 / 0.05;
  for (let n = 0; n < NBARS; n++) {
    const a = (n * Math.PI * 2) / NBARS + sim.rotorAngle;
    const v = Math.max(-1, Math.min(1, P.barCurrent(a, f.angle, rel) * gain));
    barMats[n].color.copy(barCol0).lerp(barCol1, Math.abs(v));
    setSym(barSyms[n], v, 0.075); barSyms[n].visible = st.barSyms && st.mode === 'cage';
  }
  // 磁场箭头
  fieldLayer.position.z = ZF + 0.14 + 1.9 * explodeT * 0; // 保持在定子前端面
  resArrow.visible = st.field; resArrow.rotation.z = f.angle; resArrow.setLen(f.mag * ARROW_SCALE); resArrow.visible = st.field;
  const tr = f.mag * ARROW_SCALE + 0.2; resTip.position.set(Math.cos(f.angle) * tr, Math.sin(f.angle) * tr, 0);
  for (let k = 0; k < 3; k++) { const a = compArrows[k]; a.rotation.z = P.PHASE_AXES[k]; a.setLen(cur[k] * ARROW_SCALE); a.visible = st.comps && Math.abs(cur[k]) > 0.02; }
  for (let i = 0; i < NG; i++) {
    const th = (i / NG) * Math.PI * 2, b = P.gapField(th, cur) / 1.5, a = gapArrows[i], len = 0.1 * Math.abs(b);
    a.rotation.z = th; a.position.set((R_GAP - (len / 2) * Math.sign(b)) * Math.cos(th), (R_GAP - (len / 2) * Math.sign(b)) * Math.sin(th), 0);
    a.setLen(len * Math.sign(b)); a.userData.mat.opacity = 0.3 + 0.7 * Math.abs(b); a.visible = st.field && len > 0.01;
  }
  const showPm = st.mode === 'pm' && st.field;
  rotAxis.visible = showPm; arcLine.visible = showPm && st.delta > 0.01;
  if (showPm) {
    rotAxis.rotation.z = sim.rotorAngle; rotAxis.setLen(0.36);
    const p = arcGeo.attributes.position, r = 0.22;
    for (let i = 0; i <= 32; i++) { const a = sim.rotorAngle + ((f.angle - sim.rotorAngle + Math.PI * 4 + Math.PI) % (Math.PI * 2) - Math.PI) * (i / 32); p.setXYZ(i, r * Math.cos(a), r * Math.sin(a), 0); }
    p.needsUpdate = true;
    const mid = sim.rotorAngle + P.wrapPi(f.angle - sim.rotorAngle) / 2; deltaTip.position.set(0.3 * Math.cos(mid), 0.3 * Math.sin(mid), 0);
  }
  return { cur, f };
}
function updateLabels() {
  const w = view.clientWidth, h = view.clientHeight;
  for (const l of labels) {
    let show = st.labels && l.when() && l.a.parent.visible !== false;
    if (show) {
      l.a.getWorldPosition(tmpV); tmpV.project(camera);
      if (tmpV.z > 1 || Math.abs(tmpV.x) > 1.05 || Math.abs(tmpV.y) > 1.05) show = false;
      else l.el.style.transform = `translate(${((tmpV.x + 1) / 2) * w}px, ${((1 - tmpV.y) / 2) * h}px) translate(-50%, -50%)`;
    }
    l.el.style.display = show ? '' : 'none';
  }
}

let dirty = true, last = performance.now();
function resize() {
  const w = view.clientWidth, h = view.clientHeight; renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix(); dirty = true;
}
new ResizeObserver(resize).observe(view); resize();
function frame(now) {
  const dt = Math.min(0.05, (now - last) / 1000); last = now;
  let active = false;
  if (st.playing) { sim.step(dt * Math.PI * 2 * BASE_F * st.speed); active = true; }
  if (tween) {
    const u = Math.min(1, (now - tween.t0) / tween.dur), e = u < 0.5 ? 2 * u * u : 1 - Math.pow(-2 * u + 2, 2) / 2;
    for (const k of ['az', 'el', 'dist', 'tz']) cam[k] = (tween.from[k] ?? 0.15) + ((tween.to[k] ?? 0.15) - (tween.from[k] ?? 0.15)) * e;
    if (u >= 1) tween = null; active = true;
  }
  const et = st.explode ? 1 : 0;
  if (Math.abs(explodeT - et) > 1e-3) { explodeT += (et - explodeT) * Math.min(1, dt * 6); active = true; } else explodeT = et;
  if (active || dirty) {
    applyCam(); const { cur, f } = updateScene(); renderer.render(scene, camera); updateLabels(); drawWave(cur); readouts(cur, f); dirty = false;
  }
  requestAnimationFrame(frame);
}
applyStep(0);
Object.assign(cam, CAM.overview); tween = null;
requestAnimationFrame(frame);
window.__motor = { sim, st, applyStep, setMode };
