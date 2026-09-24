// 判定层：Cue 触发、撞车挂起、渐变推进、缩短重排等全部规则。
// 纯函数：输入旧状态 + 当前时间，返回新状态；不碰 React 与 localStorage。

import type { ActiveFade, CueDef, CueStatus, StageState } from "./data";

const clone = (s: StageState): StageState => JSON.parse(JSON.stringify(s)) as StageState;

function addLog(s: StageState, now: number, text: string): void {
  s.log.push({ at: now, text });
  if (s.log.length > 60) s.log.splice(0, s.log.length - 60);
}

export function cueTargetIds(cue: CueDef): string[] {
  return Object.keys(cue.targets);
}

/** 当前正在变化中的灯位 */
export function busyLightIds(s: StageState): string[] {
  return Object.keys(s.fades);
}

/** 这条 Cue 此刻若启动，会撞上哪些灯 */
export function conflictingLights(s: StageState, cue: CueDef): string[] {
  return cueTargetIds(cue).filter((id) => s.fades[id]);
}

/** 灯位在某时刻的亮度：进行中的渐变按时间线性插值 */
export function levelAt(s: StageState, lightId: string, now: number): number {
  const f = s.fades[lightId];
  if (!f) return s.levels[lightId] ?? 0;
  const span = f.endAt - f.startAt;
  if (span <= 0) return f.to;
  const t = Math.min(1, Math.max(0, (now - f.startAt) / span));
  return f.from + (f.to - f.from) * t;
}

export function remainingFadeSec(f: ActiveFade | undefined, now: number): number {
  if (!f) return 0;
  return Math.max(0, (f.endAt - now) / 1000);
}

export function remainingWaitSec(s: StageState, cueId: string, now: number): number {
  const until = s.waiting[cueId];
  return until === undefined ? 0 : Math.max(0, (until - now) / 1000);
}

/** 启动一条已到点的 Cue；目标灯忙则挂起，舞台保持上一帧 */
function launchCue(s: StageState, cue: CueDef, now: number): void {
  const clash = conflictingLights(s, cue);
  if (clash.length > 0) {
    s.statuses[cue.id] = "held";
    s.held[cue.id] = now;
    addLog(s, now, `⛔ ${cue.name} 撞车挂起：${clash.join("、")} 仍在变化`);
    return;
  }

  for (const [lightId, to] of Object.entries(cue.targets)) {
    const from = s.levels[lightId] ?? 0;
    const span = Math.max(0, cue.fade) * 1000;
    s.fades[lightId] = {
      cueId: cue.id,
      from,
      to,
      startAt: now,
      endAt: now + span,
    };
  }
  s.statuses[cue.id] = "fading";
  s.scene = cue.name;
  addLog(s, now, `▶ ${cue.name} 开始渐变（${cue.fade}s）`);
}

/** 尝试让挂起的 Cue 重新排队；freeSet 给定时只看引用这些灯的 Cue */
function retryHeld(s: StageState, now: number, freeSet: Set<string> | null): void {
  for (const cue of s.cues) {
    if (s.statuses[cue.id] !== "held") continue;
    const refs = cueTargetIds(cue);
    if (freeSet && !refs.some((id) => freeSet.has(id))) continue;
    if (refs.some((id) => s.fades[id])) continue;

    delete s.held[cue.id];
    if (cue.wait > 0) {
      s.waiting[cue.id] = now + cue.wait * 1000;
      s.statuses[cue.id] = "waiting";
      addLog(s, now, `↪ ${cue.name} 解除挂起，等待 ${cue.wait}s`);
    } else {
      addLog(s, now, `↪ ${cue.name} 解除挂起`);
      launchCue(s, cue, now);
    }
  }
}

/**
 * 时间推进：等待到点 → 渐变插值/完成 → 唤醒挂起 Cue → 收尾状态。
 * 挂起 Cue 唤醒时舞台与场景未变，画面始终来自上一帧。
 */
export function advance(prev: StageState, now: number): StageState {
  const s = clone(prev);

  // 1. 等待中的 Cue 到点
  for (const cue of s.cues) {
    const until = s.waiting[cue.id];
    if (until !== undefined && now >= until) {
      delete s.waiting[cue.id];
      launchCue(s, cue, now);
    }
  }

  // 2. 渐变完成，落实亮度
  const freed = new Set<string>();
  for (const [lightId, f] of Object.entries(s.fades)) {
    if (now >= f.endAt) {
      s.levels[lightId] = f.to;
      delete s.fades[lightId];
      freed.add(lightId);
      addLog(s, now, `✔ ${lightId} 渐变到位（${f.to}%）`);
    }
  }

  // 3. 只重排引用了刚空闲灯的挂起 Cue
  if (freed.size > 0) retryHeld(s, now, freed);

  // 4. 所有灯都到位的 fading Cue 标记完成
  for (const cue of s.cues) {
    if (s.statuses[cue.id] !== "fading") continue;
    const stillMoving = Object.values(s.fades).some((f) => f.cueId === cue.id);
    if (!stillMoving) {
      s.statuses[cue.id] = "done";
      addLog(s, now, `■ ${cue.name} 完成`);
    }
  }

  return s;
}

/** 手动 GO：登记一条 Cue。只有空闲/完成的 Cue 可登记 */
export function fireCue(prev: StageState, cueId: string, now: number): StageState {
  const cue = prev.cues.find((c) => c.id === cueId);
  if (!cue) return prev;
  const status = prev.statuses[cueId];
  if (status === "waiting" || status === "fading" || status === "held") return prev;

  const s = clone(prev);
  if (cue.wait > 0) {
    s.waiting[cue.id] = now + cue.wait * 1000;
    s.statuses[cue.id] = "waiting";
    addLog(s, now, `◷ ${cue.name} 已登记，等待 ${cue.wait}s`);
  } else {
    launchCue(s, cue, now);
  }
  return s;
}

/**
 * 缩短某盏灯正在进行的渐变：从当前亮度重新起算。
 * 之后只重排引用这盏灯的挂起 Cue，其余一律不动。
 */
export function shortenFade(
  prev: StageState,
  lightId: string,
  newFadeSec: number,
  now: number
): StageState {
  const old = prev.fades[lightId];
  if (!old) return prev;
  const fade = Math.max(0, newFadeSec);
  const s = clone(prev);
  const current = levelAt(prev, lightId, now);
  s.fades[lightId] = {
    cueId: old.cueId,
    from: current,
    to: old.to,
    startAt: now,
    endAt: now + fade * 1000,
  };
  addLog(s, now, `✂ ${lightId} 渐变缩短为 ${fade}s（从当前 ${Math.round(current)}% 续接）`);

  // 若缩短后立即到点，先落实亮度再唤醒
  if (fade === 0) {
    s.levels[lightId] = old.to;
    delete s.fades[lightId];
    const freed = new Set([lightId]);
    retryHeld(s, now, freed);
    for (const cue of s.cues) {
      if (s.statuses[cue.id] !== "fading") continue;
      const stillMoving = Object.values(s.fades).some((f) => f.cueId === cue.id);
      if (!stillMoving) {
        s.statuses[cue.id] = "done";
        addLog(s, now, `■ ${cue.name} 完成`);
      }
    }
  }
  return s;
}

/** 改 Cue 登记表：名称 / 等待 / 渐变时长 / 备注（不影响正在进行的变化） */
export function updateCue(
  prev: StageState,
  cueId: string,
  patch: Partial<Pick<CueDef, "name" | "wait" | "fade" | "note">>,
  now: number
): StageState {
  const s = clone(prev);
  const cue = s.cues.find((c) => c.id === cueId);
  if (!cue) return prev;
  if (patch.name !== undefined) cue.name = patch.name;
  if (patch.note !== undefined) cue.note = patch.note;
  if (patch.wait !== undefined) cue.wait = Math.max(0, patch.wait);
  if (patch.fade !== undefined) cue.fade = Math.max(0, patch.fade);
  addLog(s, now, `✎ ${cue.id} 登记表已更新`);
  return s;
}

/**
 * 调整某条 Cue 引用的灯：value 为数字时设目标亮度，null 时移除引用。
 * 对挂起中的 Cue，移除撞车灯后立即尝试重新排队（“留待调整”的调整入口）。
 */
export function setCueTarget(
  prev: StageState,
  cueId: string,
  lightId: string,
  value: number | null,
  now: number
): StageState {
  const s = clone(prev);
  const cue = s.cues.find((c) => c.id === cueId);
  if (!cue) return prev;
  if (value === null) {
    delete cue.targets[lightId];
  } else {
    cue.targets[lightId] = Math.min(100, Math.max(0, value));
  }

  if (s.statuses[cueId] === "held") {
    const refs = cueTargetIds(cue);
    if (!refs.some((id) => s.fades[id])) {
      delete s.held[cueId];
      if (cue.wait > 0) {
        s.waiting[cueId] = now + cue.wait * 1000;
        s.statuses[cueId] = "waiting";
      } else {
        launchCue(s, cue, now);
      }
    }
  }
  return s;
}

export function selectCue(prev: StageState, cueId: string): StageState {
  if (!prev.cues.some((c) => c.id === cueId)) return prev;
  const s = clone(prev);
  s.selectedId = cueId;
  return s; // 切换不清零任何计时
}

export const STATUS_LABEL: Record<CueStatus, string> = {
  idle: "待触发",
  held: "撞车挂起",
  waiting: "等待中",
  fading: "渐变中",
  done: "已完成",
};
