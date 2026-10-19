// Adapted from dsh-pet/src/shared/physics.ts (MIT).
// Copyright (c) 2026 PC2005-cloud. See public/licenses/dsh-pet.txt.
// Upstream c6f96350d9307bd6c23bc6ea31974e76a719a8b6; single-screen physics retained.
interface PhysicsParams {
  gravity: number;
  restitution: number;
  groundFriction: number;
  ceilingBounce: boolean;
  throwPower: number;
  petCollision: boolean;
}
/** 拖拽轨迹保留窗口（ms）：只留最近这一段做初速估算 */
const TRAIL_KEEP_MS = 200;
/** 初速估算窗口（ms） */
const RELEASE_WINDOW_MS = 150;
/** 松手前停顿超过它 = 温柔放下（不带残余速度），即使之前甩过 */
const RELEASE_STALE_MS = 150;
/** 窗口太短视为不可估算（ms） */
const MIN_SPAN_MS = 20;
/** 分段速度的最小 dt（ms）：高回报率鼠标事件可低至 1ms，过小 dt 会把抖动放大成虚假峰值，短段向前合并 */
const SEG_MIN_DT_MS = 8;
/** 低于此速度 = 不抛（原地放下），px/s */
const DEAD_ZONE_SPEED = 500;
/** 甩出速度软上限（px/s）：cap*(1-e^(-s/cap))，任意力度下仍单调可区分，渐近不超过 cap */
export const MAX_THROW_SPEED = 3600;
/** 初速大小 = 端点均值*(1-w) + 窗口峰值*w（弥补快甩时位移集中在窗口内一小段的低估） */
const PEAK_WEIGHT = 0.5;
/** 参考加速度（px/s²）：末段加速达到它即吃满增益 */
const ACCEL_REF = 8000;
/** 加速度增益上限：仍在加速的甩动最多放大 60% */
const ACCEL_GAIN_MAX = 0.6;

// ---- 抛掷物理默认值（= assets/config.jsonc 的 physics 段；运行时以配置成品为准） ----
/** 抛掷重力（px/s²） */
const GRAVITY = 1400;
/** 碰边恢复系数：每次反弹保留约 78% 速度 */
const RESTITUTION = 0.78;
/** 地面水平摩擦（/s） */
const GROUND_FRICTION = 2.5;

/** 抛掷物理的默认参数（与内置配置一致；仅作配置缺失时的兜底） */
const DEFAULT_PHYSICS: PhysicsParams = {
  gravity: GRAVITY,
  restitution: RESTITUTION,
  groundFriction: GROUND_FRICTION,
  ceilingBounce: true,
  throwPower: 1,
  petCollision: false,
};

/** 落地时 |vy| 小于它直接停竖直 */
const REST_VY = 40;
/** 地面上 |vx| 小于它认为已静止 */
const REST_VX = 15;
/** 单步最大 dt（s）：防后台标签页/卡顿后恢复的巨帧跳变 */
const MAX_STEP_DT = 0.05;

/** 一次轨迹采样（t = performance.now() 时间戳 ms；x/y = 指针绝对坐标 px） */
export interface DragSample {
  t: number;
  x: number;
  y: number;
}

/** 抛掷边界：包围盒左上角的允许活动范围（与浏览器 rootStyle / 桌面 position 同一套「身体贴边」语义） */
export interface ThrowBounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

/** 抛体当前状态（包围盒左上角 px + 速度 px/s） */
export interface ThrowState {
  x: number;
  y: number;
  vx: number;
  vy: number;
}

export const trimTrail = (trail: DragSample[], now: number): DragSample[] => {
  const cutoff = now - TRAIL_KEEP_MS;
  let i = 0;
  while (i < trail.length && trail[i].t < cutoff) i++;
  return i === 0 ? trail : trail.slice(i);
};

/** 软钳速：`cap*(1-e^(-s/cap))`，任意速度下单调可区分、渐近不超过 cap。
 *  导出供抛掷指令（`POST /throw` 的 power）复用——接口抛掷与拖拽甩抛走同一条限速，手感一致。 */
const softClampSpeed = (speed: number): number => {
  if (speed <= 0) return 0;
  return MAX_THROW_SPEED * (1 - Math.exp(-speed / MAX_THROW_SPEED));
};

/**
 * 由拖拽轨迹估算松手初速 (vx, vy)，px/s。
 * 方向：窗口首末端点位移方向（抗抖）。大小：端点平均与峰值按 PEAK_WEIGHT 加权，
 * 末段仍在加速时按 ACCEL_REF 比例增益（最多 ACCEL_GAIN_MAX），软钳速封顶。
 * 总力度：软钳速**之后**整体 ×physics.throwPower —— 初速、软上限（3600×p）、
 * 死区判定（相对力度）三者一体线性缩放（p=1 即现状）。
 * 返回 null = 温柔放下（轨迹为空 / 停留过久 / 窗口太短 / 峰值速度低于死区），调用方不抛。
 */
export const estimateReleaseVelocity = (
  trail: DragSample[],
  now: number,
  physics: PhysicsParams = DEFAULT_PHYSICS,
): { vx: number; vy: number } | null => {
  if (trail.length === 0) return null;
  const last = trail[trail.length - 1];
  if (now - last.t > RELEASE_STALE_MS) return null;
  const win = trail.filter(s => now - s.t <= RELEASE_WINDOW_MS);
  if (win.length < 2) return null;
  const t0 = win[0].t;
  const x0 = win[0].x;
  const y0 = win[0].y;
  const t1 = win[win.length - 1].t;
  const x1 = win[win.length - 1].x;
  const y1 = win[win.length - 1].y;
  const spanMs = t1 - t0;
  if (spanMs < MIN_SPAN_MS) return null;
  const baseVx = ((x1 - x0) / spanMs) * 1000;
  const baseVy = ((y1 - y0) / spanMs) * 1000;
  const baseSpeed = Math.hypot(baseVx, baseVy);
  if (baseSpeed < 1e-6) return null; // 窗口内几乎纯抖动：没有可靠方向，按原地放下处理
  // 分段速度（过密采样向前合并，dt 下限 SEG_MIN_DT_MS）
  const segSpeeds: { speed: number; tEnd: number }[] = [];
  let px = x0;
  let py = y0;
  let pt = t0;
  for (const s of win.slice(1)) {
    const dt = s.t - pt;
    if (dt >= SEG_MIN_DT_MS) {
      segSpeeds.push({ speed: (Math.hypot(s.x - px, s.y - py) / dt) * 1000, tEnd: s.t });
      px = s.x;
      py = s.y;
      pt = s.t;
    }
  }
  const peakSpeed = segSpeeds.length ? Math.max(...segSpeeds.map(v => v.speed)) : baseSpeed;
  // 末段加速度：末段峰值速度相对首段的斜率（仍在加速的甩动放大初速）
  let accel = 0;
  if (segSpeeds.length >= 2) {
    const lastSeg = segSpeeds[segSpeeds.length - 1];
    const firstSeg = segSpeeds[0];
    accel =
      (lastSeg.speed - firstSeg.speed) /
      Math.max((lastSeg.tEnd - firstSeg.tEnd) / 1000, MIN_SPAN_MS / 1000);
  }
  const speedBeforeClamp =
    ((1 - PEAK_WEIGHT) * baseSpeed + PEAK_WEIGHT * peakSpeed) *
    (1 + Math.min(Math.max(accel, 0) / ACCEL_REF, 1) * ACCEL_GAIN_MAX);
  const speed = softClampSpeed(speedBeforeClamp) * physics.throwPower;
  if (speed < DEAD_ZONE_SPEED) return null;
  return { vx: (baseVx / baseSpeed) * speed, vy: (baseVy / baseSpeed) * speed };
};

/**
 * 抛体单步积分 + 边界反弹。返回更新后的状态与两个标志：
 * bounced = 本步是否碰边/落地；atRest = 贴地且低速（或碰边后整体低速），调用方应停止循环。
 * physics = 配置成品的抛掷物理参数（重力/弹性/地面摩擦/顶部反弹）；缺失时用默认值兜底。
 */
export const throwStep = (
  s: ThrowState,
  dtRaw: number,
  b: ThrowBounds,
  physics: PhysicsParams = DEFAULT_PHYSICS,
): ThrowState & { bounced: boolean; atRest: boolean } => {
  const dt = Math.min(Math.max(dtRaw, 0), MAX_STEP_DT);
  let { x, y, vx, vy } = s;
  vy += physics.gravity * dt;
  x += vx * dt;
  y += vy * dt;
  let bounced = false;
  if (x < b.minX) {
    x = b.minX;
    vx = Math.abs(vx) * physics.restitution;
    bounced = true;
  } else if (x > b.maxX) {
    x = b.maxX;
    vx = -Math.abs(vx) * physics.restitution;
    bounced = true;
  }
  if (y < b.minY) {
    // ceilingBounce=false：顶部无边界，不夹不弹——宠物飞出屏幕顶部，靠重力落回（y 保持越界状态）
    if (physics.ceilingBounce) {
      y = b.minY;
      vy = Math.abs(vy) * physics.restitution;
      bounced = true;
    }
  } else if (y >= b.maxY) {
    y = b.maxY;
    vx *= Math.max(0, 1 - physics.groundFriction * dt);
    if (Math.abs(vy) < REST_VY) vy = 0;
    else vy = -Math.abs(vy) * physics.restitution;
    bounced = true;
  }
  const speed = Math.hypot(vx, vy);
  const atRest =
    (y >= b.maxY - 1 && Math.abs(vy) < 1 && Math.abs(vx) < REST_VX) ||
    (bounced && speed < REST_VY && Math.abs(vy) < 1);
  return { x, y, vx, vy, bounced, atRest };
};
