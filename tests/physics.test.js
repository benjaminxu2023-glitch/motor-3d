import test from 'node:test';
import assert from 'node:assert/strict';
import * as P from '../physics.js';

const ts = Array.from({ length: 2000 }, (_, i) => (i / 2000) * 4 * Math.PI);
const swaps = [null, [0, 1], [1, 2], [0, 2]];

test('三相电流之和恒为 0（含任意两相对调）', () => {
  for (const sw of swaps) for (const t of ts) {
    const [a, b, c] = P.coilCurrents(t, 10, sw);
    assert.ok(Math.abs(a + b + c) < 1e-9);
  }
});

test('合成磁场幅值恒为 1.5·Imax', () => {
  for (const Imax of [1, 7.3]) for (const sw of swaps) for (const t of ts) {
    const f = P.resultantField(P.coilCurrents(t, Imax, sw));
    assert.ok(Math.abs(f.mag - 1.5 * Imax) < 1e-9 * Imax, `mag=${f.mag}`);
  }
});

test('三相线圈磁轴空间互差 120°', () => {
  for (let k = 0; k < 3; k++) {
    const d = P.wrapPi(P.PHASE_AXES[(k + 1) % 3] - P.PHASE_AXES[k]);
    assert.ok(Math.abs(d - (2 * Math.PI) / 3) < 1e-12);
  }
});

function totalRotation(sw) {
  let prev = P.resultantField(P.coilCurrents(0, 1, sw)).angle, sum = 0;
  for (const t of ts.slice(1)) { const a = P.resultantField(P.coilCurrents(t, 1, sw)).angle; sum += P.wrapPi(a - prev); prev = a; }
  return sum;
}

test('正常相序 A→B→C：磁场逆时针旋转，2 个电周期转 2 圈', () => {
  const r = totalRotation(null);
  assert.ok(r > 0 && Math.abs(r - 4 * Math.PI) < 0.01, `r=${r}`);
});

test('任意两相对调：磁场反转', () => {
  for (const sw of [[0, 1], [1, 2], [0, 2]]) {
    const r = totalRotation(sw);
    assert.ok(r < 0 && Math.abs(r + 4 * Math.PI) < 0.01, `swap ${sw} r=${r}`);
  }
});

test('合成磁场依次指向 A、B、C 相磁轴（A 电流最大时指向 A 轴）', () => {
  for (let k = 0; k < 3; k++) {
    const t = (k * 2 * Math.PI) / 3; // 此时第 k 相电流达到正峰值
    const f = P.resultantField(P.coilCurrents(t));
    assert.ok(Math.abs(P.wrapPi(f.angle - P.PHASE_AXES[k])) < 1e-9);
  }
});

test('气隙磁场为正弦分布，峰值处于合成磁场方向', () => {
  for (const t of ts.slice(0, 200)) {
    const c = P.coilCurrents(t);
    const f = P.resultantField(c);
    for (let th = 0; th < 2 * Math.PI; th += 0.3) {
      assert.ok(Math.abs(P.gapField(th, c) - 1.5 * Math.cos(th - f.angle)) < 1e-9);
    }
  }
});

test('绕组排布：24 槽，每相 4 去线 + 4 回线，去回线相隔 180°，顺序 A-Z-B-X-C-Y', () => {
  const s = P.slotLayout(24);
  assert.equal(s.length, 24);
  for (let k = 0; k < 3; k++) {
    const plus = s.filter((x) => x.phase === k && x.sign > 0), minus = s.filter((x) => x.phase === k && x.sign < 0);
    assert.equal(plus.length, 4); assert.equal(minus.length, 4);
    for (const p of plus) assert.ok(minus.some((m) => Math.abs(Math.abs(P.wrapPi(m.angle - p.angle)) - Math.PI) < 1e-9));
  }
  // 从 A 带开始逆时针读相带名称
  const startA = s.findIndex((x) => x.name === 'A');
  const seq = [];
  for (let i = 0; i < 24; i++) { const n = s[(startA + i) % 24].name; if (seq[seq.length - 1] !== n) seq.push(n); }
  assert.deepEqual(seq.slice(0, 6), ['A', 'Z', 'B', 'X', 'C', 'Y']);
});

test('毕奥-萨伐尔校验：按 ⊙/⊗ 约定，A 相正电流在中心产生的磁场指向 A 轴', () => {
  const s = P.slotLayout(24), R = 0.7;
  for (let k = 0; k < 3; k++) {
    const cur = [0, 0, 0]; cur[k] = 1;
    let bx = 0, by = 0;
    for (const sl of s) {
      const I = P.conductorCurrent(sl, cur); if (!I) continue;
      const rx = -R * Math.cos(sl.angle), ry = -R * Math.sin(sl.angle); // 观测点(原点) − 导体位置
      const r2 = rx * rx + ry * ry;
      bx += (I * -ry) / r2; by += (I * rx) / r2; // ẑ × r
    }
    assert.ok(Math.abs(P.wrapPi(Math.atan2(by, bx) - P.PHASE_AXES[k])) < 1e-9);
  }
});

test('同步转速 n1 = 60f/p', () => {
  assert.equal(P.syncSpeedRpm(50, 1), 3000);
  assert.equal(P.syncSpeedRpm(50, 2), 1500);
  assert.equal(P.syncSpeedRpm(60, 3), 1200);
});

test('异步电机转子转速 = (1−s)·n1（公式与仿真稳态一致）', () => {
  for (const s of [0, 0.02, 0.05, 0.1]) {
    assert.ok(Math.abs(P.inductionRotorSpeed(3000, s) - (1 - s) * 3000) < 1e-9);
    const sim = new P.MotorSim({ mode: 'cage', slip: s });
    for (let i = 0; i < 4000; i++) sim.step(0.01); // 预热
    const r0 = sim.rotorAngle, f0 = sim.fieldAngle;
    for (let i = 0; i < 4000; i++) sim.step(0.01);
    const ratio = (sim.rotorAngle - r0) / (sim.fieldAngle - f0);
    assert.ok(Math.abs(ratio - (1 - s)) < 1e-6, `s=${s} ratio=${ratio}`);
  }
});

test('换相后异步转子先减速再反转，最终 = −(1−s)·n1', () => {
  const sim = new P.MotorSim({ mode: 'cage', slip: 0.05 });
  for (let i = 0; i < 2000; i++) sim.step(0.01);
  sim.swap = [1, 2];
  let minRatio = Infinity;
  for (let i = 0; i < 6000; i++) { sim.step(0.01); minRatio = Math.min(minRatio, sim.rotorRatio); }
  assert.equal(sim.direction(), -1);
  assert.ok(Math.abs(sim.rotorRatio + 0.95) < 1e-6);
});

test('永磁同步电机转子转速 = n1，且落后磁场负载角 δ', () => {
  assert.equal(P.pmsmRotorSpeed(3000), 3000);
  for (const d of [0, 0.3, 1.0]) for (const sw of [null, [1, 2]]) {
    const sim = new P.MotorSim({ mode: 'pm', delta: d, swap: sw });
    sim.step(0.01);
    const r0 = sim.rotorAngle, f0 = sim.fieldAngle;
    for (let i = 0; i < 3000; i++) sim.step(0.01);
    assert.ok(Math.abs((sim.rotorAngle - r0) / (sim.fieldAngle - f0) - 1) < 1e-9);
    const lag = (sim.fieldAngle - sim.rotorAngle) * sim.direction();
    assert.ok(Math.abs(lag - d) < 1e-9);
  }
});

test('无滑差 → 导条无感应电流 → 无转矩；有滑差时转矩与磁场同向', () => {
  for (let fa = 0; fa < 6; fa += 0.7) {
    assert.ok(Math.abs(P.cageTorque(18, fa, 0)) < 1e-12);
    for (let n = 0; n < 18; n++) assert.ok(Math.abs(P.barCurrent((n * 2 * Math.PI) / 18, fa, 0)) < 1e-12);
    assert.ok(P.cageTorque(18, fa, +0.05) > 0);   // 磁场逆时针 → 转矩逆时针
    assert.ok(P.cageTorque(18, fa, -0.05) < 0);   // 换相后磁场顺时针 → 转矩顺时针
  }
});
