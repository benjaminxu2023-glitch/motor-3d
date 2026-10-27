// 电机物理模型（纯函数，无 DOM 依赖，可在 node 中测试）
// 坐标：从轴伸端（+z）看，逆时针为正角度。2 极（p = 1），电角度 = 机械角度。
export const TWO_PI = Math.PI * 2;
export const PHASES = ['A', 'B', 'C'];
export const RETURNS = ['X', 'Y', 'Z'];
// 三相线圈磁轴在空间上依次错开 120°
export const PHASE_AXES = [0, TWO_PI / 3, (2 * TWO_PI) / 3];

export function wrapPi(a) {
  a = (a + Math.PI) % TWO_PI;
  if (a < 0) a += TWO_PI;
  return a - Math.PI;
}

// 线圈电流。swap = [i, j] 表示把第 i、j 两个线圈的电源线对调（null = 正常相序 A→B→C）
export function coilCurrents(thetaE, Imax = 1, swap = null) {
  const supply = [0, 1, 2];
  if (swap) { const t = supply[swap[0]]; supply[swap[0]] = supply[swap[1]]; supply[swap[1]] = t; }
  return supply.map((s) => Imax * Math.cos(thetaE - (s * TWO_PI) / 3));
}

// 合成磁场（磁动势）矢量：Σ i_k · û(α_k)
export function resultantField(currents) {
  let x = 0, y = 0;
  for (let k = 0; k < 3; k++) { x += currents[k] * Math.cos(PHASE_AXES[k]); y += currents[k] * Math.sin(PHASE_AXES[k]); }
  return { x, y, mag: Math.hypot(x, y), angle: Math.atan2(y, x) };
}

// 气隙中某圆周角 theta 处的径向磁场（向外为正）
export function gapField(theta, currents) {
  let b = 0;
  for (let k = 0; k < 3; k++) b += currents[k] * Math.cos(theta - PHASE_AXES[k]);
  return b;
}

// 24 槽、2 极、单层整距、每极每相 q = 4 槽的绕组排布
// 相 k 的去线带中心在 α_k + 90°，回线带在 α_k − 90°（这样 +i 时磁场指向 α_k）
export function slotLayout(nSlots = 24) {
  const out = [];
  for (let i = 0; i < nSlots; i++) {
    const angle = ((i + 0.5) * TWO_PI) / nSlots;
    for (let k = 0; k < 3; k++) {
      const c = PHASE_AXES[k] + Math.PI / 2;
      if (Math.abs(wrapPi(angle - c)) < Math.PI / 6) out.push({ index: i, angle, phase: k, sign: +1, name: PHASES[k] });
      else if (Math.abs(wrapPi(angle - c - Math.PI)) < Math.PI / 6) out.push({ index: i, angle, phase: k, sign: -1, name: RETURNS[k] });
    }
  }
  return out;
}

// 槽内导体电流（+z 即从屏幕流出为正，⊙）
export function conductorCurrent(slot, currents) { return slot.sign * currents[slot.phase]; }

export function syncSpeedRpm(f = 50, polePairs = 1) { return (60 * f) / polePairs; }
export function inductionRotorSpeed(nSync, slip) { return (1 - slip) * nSync; }
export function pmsmRotorSpeed(nSync) { return nSync; }

// 鼠笼导条感应电流（相对值）：正比于 导条相对磁场的速度 × 该处磁密
// relSpeed = (ω_磁场 − ω_转子) / ω_同步，稳态时 = dir · s
export function barCurrent(barAngle, fieldAngle, relSpeed) { return relSpeed * Math.cos(barAngle - fieldAngle); }

// 作用在全部导条上的电磁转矩（相对值，逆时针为正）：Σ i_bar · B_r
export function cageTorque(nBars, fieldAngle, relSpeed, fieldMag = 1.5) {
  let t = 0;
  for (let n = 0; n < nBars; n++) {
    const a = (n * TWO_PI) / nBars;
    t += barCurrent(a, fieldAngle, relSpeed) * fieldMag * Math.cos(a - fieldAngle);
  }
  return t;
}

export class MotorSim {
  constructor({ mode = 'cage', slip = 0.05, delta = 0, swap = null, inertiaE = 3 } = {}) {
    this.thetaE = 0; this.mode = mode; this.slip = slip; this.delta = delta; this.swap = swap;
    this.inertiaE = inertiaE;            // 转速跟随的“时间常数”，以电角度弧度计；0 = 无惯性
    this.fieldAngle = this.field().angle; // 展开（不回绕）的磁场角度
    this.rotorAngle = this.fieldAngle;
    this.rotorRatio = this.mode === 'cage' ? (1 - slip) * this.direction() : this.direction(); // 转子转速 / 同步转速（带符号）
  }
  currents() { return coilCurrents(this.thetaE, 1, this.swap); }
  field() { return resultantField(this.currents()); }
  // 磁场旋转方向：+1 逆时针（A→B→C），−1 顺时针
  direction() {
    const a0 = resultantField(coilCurrents(this.thetaE, 1, this.swap)).angle;
    const a1 = resultantField(coilCurrents(this.thetaE + 0.01, 1, this.swap)).angle;
    return Math.sign(wrapPi(a1 - a0)) || 1;
  }
  relSpeed() { return this.mode === 'cage' ? this.direction() - this.rotorRatio : 0; }
  step(dThetaE) {
    const a0 = this.field().angle;
    this.thetaE += dThetaE;
    const dF = wrapPi(this.field().angle - a0);
    // 与上一步展开角对齐（换相后磁场角会跳变，这里直接重新同步）
    const target = this.field().angle;
    this.fieldAngle = this.fieldAngle + wrapPi(target - this.fieldAngle);
    const dir = this.direction();
    if (this.mode === 'cage') {
      const goal = (1 - this.slip) * dir;
      const k = this.inertiaE > 0 ? 1 - Math.exp(-Math.abs(dThetaE) / this.inertiaE) : 1;
      this.rotorRatio += (goal - this.rotorRatio) * k;
      this.rotorAngle += this.rotorRatio * Math.abs(dF);
    } else {
      this.rotorRatio = dir;
      this.rotorAngle = this.fieldAngle - dir * this.delta; // 转子磁极落后负载角 δ
    }
    return dF;
  }
}
