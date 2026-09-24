// 数据层：灯位 / Cue 的预置数据、状态结构、浏览器持久化
// 纯数据，不含任何判定逻辑。

export type LightType = "面光" | "侧光" | "逆光" | "效果光";

export interface LightDef {
  id: string;
  name: string;
  type: LightType;
  channel: string;
  color: string; // 光束颜色
  x: number; // 舞台平面图坐标（百分比 0-100）
  y: number;
}

export interface CueDef {
  id: string;
  name: string;
  wait: number; // 等待时间（秒）
  fade: number; // 渐变时长（秒）
  targets: Record<string, number>; // 灯位 id -> 目标亮度 0-100
  note: string;
}

export type CueStatus = "idle" | "held" | "waiting" | "fading" | "done";

export interface ActiveFade {
  cueId: string;
  from: number; // 渐变起点亮度（缩短时会以当前亮度重置）
  to: number;
  startAt: number; // 毫秒时间戳
  endAt: number;
}

export interface LogEntry {
  at: number;
  text: string;
}

export interface StageState {
  version: number;
  lights: LightDef[];
  cues: CueDef[];
  levels: Record<string, number>; // 灯位当前（已落实）亮度
  statuses: Record<string, CueStatus>;
  waiting: Record<string, number>; // cueId -> 等待结束时间戳
  held: Record<string, number>; // cueId -> 被挂起的时间戳
  fades: Record<string, ActiveFade>; // lightId -> 进行中的渐变
  selectedId: string | null;
  scene: string;
  log: LogEntry[];
}

export const STORAGE_KEY = "fade-preview-console-v1";
const STATE_VERSION = 1;

export const DEFAULT_LIGHTS: LightDef[] = [
  { id: "L1", name: "面光·左", type: "面光", channel: "CH 01", color: "#f59e0b", x: 20, y: 15 },
  { id: "L2", name: "面光·右", type: "面光", channel: "CH 02", color: "#fbbf24", x: 80, y: 15 },
  { id: "L3", name: "侧光·左", type: "侧光", channel: "CH 03", color: "#06b6d4", x: 7, y: 52 },
  { id: "L4", name: "逆光排", type: "逆光", channel: "CH 04", color: "#7c3aed", x: 50, y: 88 },
];

export const DEFAULT_CUES: CueDef[] = [
  {
    id: "Q1",
    name: "开场冷蓝",
    wait: 0,
    fade: 12,
    targets: { L3: 80, L4: 55 },
    note: "二幕开场，观众落坐等收光",
  },
  {
    id: "Q2",
    name: "追光入场",
    wait: 1,
    fade: 4,
    targets: { L1: 90 },
    note: "焦点在上场门，需走位确认",
  },
  {
    id: "Q3",
    name: "面光铺开",
    wait: 0,
    fade: 10,
    targets: { L1: 75, L2: 75 },
    note: "双人对手戏",
  },
  {
    id: "Q4",
    name: "逆光转暖",
    wait: 2,
    fade: 6,
    targets: { L4: 80, L2: 40 },
    note: "暖色压台，L2 随收",
  },
  {
    id: "Q5",
    name: "谢幕全亮",
    wait: 0,
    fade: 8,
    targets: { L1: 100, L2: 100, L3: 60, L4: 100 },
    note: "版本 B，谢幕用",
  },
];

export function createInitialState(now = Date.now()): StageState {
  const cues = DEFAULT_CUES.map((c) => ({ ...c, targets: { ...c.targets } }));
  return {
    version: STATE_VERSION,
    lights: DEFAULT_LIGHTS.map((l) => ({ ...l })),
    cues,
    levels: Object.fromEntries(DEFAULT_LIGHTS.map((l) => [l.id, 0])),
    statuses: Object.fromEntries(cues.map((c) => [c.id, "idle" as CueStatus])),
    waiting: {},
    held: {},
    fades: {},
    selectedId: cues[0]?.id ?? null,
    scene: "黑场",
    log: [{ at: now, text: "预演台复位，预置 4 灯位 / 5 条 Cue" }],
  };
}

export function loadState(): StageState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return createInitialState();
    const parsed = JSON.parse(raw) as StageState;
    if (parsed.version !== STATE_VERSION) return createInitialState();
    // 简单结构校验，失败则回到预置
    if (!Array.isArray(parsed.lights) || !Array.isArray(parsed.cues)) return createInitialState();
    return parsed;
  } catch {
    return createInitialState();
  }
}

export function saveState(state: StageState): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // 隐私模式等场景下静默失败，不影响预演
  }
}
