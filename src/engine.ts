// ============================================================
// 判定层：时间线编排、撞车判定、局部重排、场景与剩余时间计算
// 全部为纯函数，不依赖页面与浏览器环境
// ============================================================

import type { Cue, CuePlan, CueStatus, Light, LightState } from "./data";

function heldReason(prevLabel: string, prevEnd: number, start: number): string {
  return `${prevLabel} 的渐变到 ${prevEnd.toFixed(1)}s 才结束，本条 ${start.toFixed(1)}s 就要启动`;
}

// 全量编排：按 Cue 顺序计算触发链，并判定撞车。
// 规则：上一条开始渐变时触发下一条；某盏灯上次变化没结束时，
// 引用同一盏灯的新 Cue 留待调整（held），不执行、不进场景。
export function planAll(cues: Cue[]): CuePlan[] {
  const plans: CuePlan[] = [];
  let trigger = 0;
  const lastEndByLight = new Map<string, number>(); // 每盏灯最近一次“已执行”变化的结束时刻
  const lastLabelByLight = new Map<string, string>();

  cues.forEach((cue, i) => {
    const fadeStart = trigger + cue.waitSec;
    const fadeEnd = fadeStart + cue.fadeSec;
    let status: CueStatus = "ok";
    let reason: string | null = null;

    const prevEnd = lastEndByLight.get(cue.lightId);
    if (prevEnd !== undefined && prevEnd > fadeStart) {
      status = "held";
      reason = heldReason(lastLabelByLight.get(cue.lightId) ?? "", prevEnd, fadeStart);
    }

    plans.push({ ...cue, seq: i + 1, triggerAt: trigger, fadeStart, fadeEnd, status, heldReason: reason });

    if (status === "ok") {
      lastEndByLight.set(cue.lightId, fadeEnd);
      lastLabelByLight.set(cue.lightId, cue.label);
    }
    trigger = fadeStart; // 留待的 Cue 不占用灯，但等待时间照样走完，节奏不乱
  });

  return plans;
}

// 局部重排：缩短某条 Cue 的渐变后，只重排引用同一盏灯的后续 Cue。
// 缩短渐变不会改变任何触发时刻（触发链只由等待时间决定），
// 因此其余灯位、以及本灯之前的 Cue 都不需要重算。
export function replanLightChain(
  prevPlans: CuePlan[],
  cues: Cue[],
  changedCueId: string
): { plans: CuePlan[]; affected: CuePlan[] } {
  const changedIndex = cues.findIndex((c) => c.id === changedCueId);
  if (changedIndex === -1) {
    const plans = planAll(cues);
    return { plans, affected: plans };
  }

  const lightId = cues[changedIndex].lightId;
  // 同步登记字段（目标亮度 / 等待 / 渐变可能已被编辑）
  const plans = prevPlans.map((p, i) => ({ ...p, ...cues[i] }));

  // 被改 Cue 自身：只更新自己的渐变结束时刻，触发时刻不变
  const changed = plans[changedIndex];
  changed.fadeEnd = changed.fadeStart + changed.fadeSec;

  // 判定基准：这盏灯在被改 Cue 之前、最近一次已执行变化的结束时刻
  let lastEnd = -Infinity;
  let lastLabel = "";
  for (let i = 0; i < changedIndex; i++) {
    const p = plans[i];
    if (p.lightId === lightId && p.status === "ok") {
      lastEnd = p.fadeEnd;
      lastLabel = p.label;
    }
  }
  if (changed.status === "ok") {
    lastEnd = changed.fadeEnd;
    lastLabel = changed.label;
  }

  // 只扫描被改 Cue 之后、且引用同一盏灯的 Cue
  const affected: CuePlan[] = [];
  for (let i = changedIndex + 1; i < plans.length; i++) {
    const p = plans[i];
    if (p.lightId !== lightId) continue;
    const conflict = lastEnd > p.fadeStart;
    p.status = conflict ? "held" : "ok";
    p.heldReason = conflict ? heldReason(lastLabel, lastEnd, p.fadeStart) : null;
    if (!conflict) {
      lastEnd = p.fadeEnd;
      lastLabel = p.label;
    }
    affected.push(p);
  }

  return { plans, affected };
}

// 某盏灯在时刻 t 的状态：亮度、是否在变、剩余时间。
// 只依据全局时钟与编排结果，与当前选中哪条 Cue 无关——切换选中不清零。
export function lightStateAt(plans: CuePlan[], light: Light, t: number): LightState {
  let level = light.baseLevel;
  const idle = (): LightState => ({
    lightId: light.id,
    level,
    fading: false,
    remainingSec: 0,
    fromLevel: level,
    toLevel: level,
  });

  for (const p of plans) {
    if (t < p.fadeStart) break; // fadeStart 沿触发链单调不减，之后的都还没开始
    if (p.lightId !== light.id || p.status !== "ok") continue; // 留待的 Cue 不进场，画面保持上一帧
    if (p.fadeSec <= 0 || t >= p.fadeEnd) {
      level = p.target; // 已完成（或瞬时变化）
      continue;
    }
    const progress = (t - p.fadeStart) / p.fadeSec;
    return {
      lightId: light.id,
      level: level + (p.target - level) * progress,
      fading: true,
      remainingSec: p.fadeEnd - t,
      fromLevel: level,
      toLevel: p.target,
    };
  }
  return idle();
}

export function sceneAt(plans: CuePlan[], lights: Light[], t: number): LightState[] {
  return lights.map((l) => lightStateAt(plans, l, t));
}

export function totalDuration(plans: CuePlan[]): number {
  return plans.reduce((m, p) => Math.max(m, p.fadeEnd), 0);
}

export function formatSec(n: number): string {
  return `${n.toFixed(1)}s`;
}
