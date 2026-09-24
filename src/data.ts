// ============================================================
// 数据层：灯位与 Cue 的预置数据、类型定义、浏览器本地存储
// （判定逻辑在 engine.ts，页面交互在 App.tsx）
// ============================================================

export interface Light {
  id: string;
  name: string; // 灯位名称：面光 / 侧光 / 逆光 / 效果光
  fixture: string; // 灯具编号
  channel: string; // 通道号
  gel: string; // 色片颜色
  x: number; // 舞台平面图位置（百分比）
  y: number;
  baseLevel: number; // 亮度预设：开演前的常亮值（%）
}

export interface Cue {
  id: string;
  label: string;
  lightId: string; // 引用的灯位
  target: number; // 目标亮度（%）
  waitSec: number; // 等待时间（秒）：触发后多久开始渐变
  fadeSec: number; // 渐变时长（秒）
}

export type CueStatus = "ok" | "held"; // held = 撞车，留待调整

export interface CuePlan extends Cue {
  seq: number;
  triggerAt: number; // 触发时刻
  fadeStart: number; // 渐变开始时刻
  fadeEnd: number; // 渐变结束时刻
  status: CueStatus;
  heldReason: string | null;
}

export interface LightState {
  lightId: string;
  level: number; // 当前亮度（%）
  fading: boolean; // 是否正在变化
  remainingSec: number; // 剩余时间（秒），不随选中 Cue 切换而清零
  fromLevel: number;
  toLevel: number;
}

export interface LogEntry {
  time: string;
  text: string;
}

// ---------------- 预置：四个灯位 ----------------

export const PRESET_LIGHTS: Light[] = [
  { id: "L1", name: "面光", fixture: "FOH-01", channel: "CH 01", gel: "#f59e0b", x: 50, y: 10, baseLevel: 0 },
  { id: "L2", name: "侧光", fixture: "SL-02", channel: "CH 05", gel: "#06b6d4", x: 10, y: 52, baseLevel: 0 },
  { id: "L3", name: "逆光", fixture: "BL-03", channel: "CH 09", gel: "#7c3aed", x: 50, y: 88, baseLevel: 0 },
  { id: "L4", name: "效果光", fixture: "FX-04", channel: "CH 12", gel: "#ef4444", x: 90, y: 52, baseLevel: 15 },
];

// ---------------- 预置：五条 Cue ----------------
// 触发链规则：上一条开始渐变时触发下一条（等待时间驱动节奏）。
// Cue 3 与 Cue 1 同引用面光，Cue 1 渐变未结束 Cue 3 就要启动 → 预置即演示撞车。

export const PRESET_CUES: Cue[] = [
  { id: "C1", label: "Cue 1 · 开场面光", lightId: "L1", target: 80, waitSec: 0, fadeSec: 4 },
  { id: "C2", label: "Cue 2 · 冷蓝侧光", lightId: "L2", target: 65, waitSec: 1, fadeSec: 5 },
  { id: "C3", label: "Cue 3 · 面光转暗", lightId: "L1", target: 30, waitSec: 2, fadeSec: 3 },
  { id: "C4", label: "Cue 4 · 逆光铺底", lightId: "L3", target: 70, waitSec: 1, fadeSec: 4 },
  { id: "C5", label: "Cue 5 · 谢幕高光", lightId: "L1", target: 90, waitSec: 2, fadeSec: 3 },
];

// ---------------- 浏览器本地存储 ----------------

const CUE_KEY = "hxy62002:cues";
const LOG_KEY = "hxy62002:log";

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}

function sanitizeCue(raw: unknown): Cue | null {
  if (typeof raw !== "object" || raw === null) return null;
  const c = raw as Record<string, unknown>;
  if (typeof c.id !== "string" || typeof c.label !== "string") return null;
  if (!PRESET_LIGHTS.some((l) => l.id === c.lightId)) return null;
  const target = Number(c.target);
  const waitSec = Number(c.waitSec);
  const fadeSec = Number(c.fadeSec);
  if (![target, waitSec, fadeSec].every(Number.isFinite)) return null;
  return {
    id: c.id,
    label: c.label,
    lightId: String(c.lightId),
    target: clamp(Math.round(target), 0, 100),
    waitSec: clamp(waitSec, 0, 60),
    fadeSec: clamp(fadeSec, 0, 60),
  };
}

export function loadCues(): Cue[] {
  try {
    const raw = localStorage.getItem(CUE_KEY);
    if (!raw) return PRESET_CUES.map((c) => ({ ...c }));
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) throw new Error("bad cues");
    const cues = parsed.map(sanitizeCue);
    if (cues.some((c) => c === null) || cues.length === 0) throw new Error("bad cues");
    return cues as Cue[];
  } catch {
    return PRESET_CUES.map((c) => ({ ...c }));
  }
}

export function saveCues(cues: Cue[]): void {
  try {
    localStorage.setItem(CUE_KEY, JSON.stringify(cues));
  } catch {
    // 存储不可用时静默跳过，不影响排练
  }
}

export function loadLog(): LogEntry[] {
  try {
    const raw = localStorage.getItem(LOG_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(
        (e): e is LogEntry =>
          typeof e === "object" &&
          e !== null &&
          typeof (e as LogEntry).time === "string" &&
          typeof (e as LogEntry).text === "string"
      )
      .slice(0, 100);
  } catch {
    return [];
  }
}

export function saveLog(log: LogEntry[]): void {
  try {
    localStorage.setItem(LOG_KEY, JSON.stringify(log.slice(0, 100)));
  } catch {
    // 同上
  }
}

export function clearStoredCues(): void {
  try {
    localStorage.removeItem(CUE_KEY);
  } catch {
    // 同上
  }
}
