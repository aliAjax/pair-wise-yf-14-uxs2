import assert from "node:assert";
import { createInitialState } from "../src/data.ts";
import {
  advance,
  busyLightIds,
  conflictingLights,
  cueTargetIds,
  fireCue,
  levelAt,
  remainingFadeSec,
  selectCue,
  setCueTarget,
  shortenFade,
  STATUS_LABEL,
} from "../src/engine.ts";

let t = 1_000_000; // 虚拟时间戳（毫秒）
let s = createInitialState(t);

// 预置：4 灯位 / 5 Cue
assert.equal(s.lights.length, 4);
assert.equal(s.cues.length, 5);

// Q1: L3/L4 fade 12s；立即触发
s = fireCue(s, "Q1", t);
assert.deepEqual(busyLightIds(s).sort(), ["L3", "L4"]);
assert.equal(s.statuses.Q1, "fading");
assert.equal(s.scene, "开场冷蓝");

// Q2 自带 1s 等待：登记后 waiting，到点才 launch
t += 1000;
s = fireCue(s, "Q2", t);
assert.equal(s.statuses.Q2, "waiting");
t += 1000;
s = advance(s, t);
assert.equal(s.statuses.Q2, "fading");

// 此刻触发 Q3（L1/L2）：L1 还在渐变（剩 3s）→ 整 Cue 挂起，舞台保持
const q3 = s.cues.find((c) => c.id === "Q3")!;
assert.deepEqual(conflictingLights(s, q3), ["L1"]);
s = fireCue(s, "Q3", t);
assert.equal(s.statuses.Q3, "held");
assert.deepEqual(busyLightIds(s).sort(), ["L1", "L3", "L4"]);

// 切到别的 Cue 不清零：切换选择后剩余时间仍在
s = selectCue(s, "Q5");
assert.equal(s.selectedId, "Q5");
assert.ok(remainingFadeSec(s.fades.L3, t) > 9.9);

// 提前把 L1 渐变缩到 1s（从当前亮度续接）
const l1Before = levelAt(s, "L1", t);
s = shortenFade(s, "L1", 1, t);
assert.ok(Math.abs(levelAt(s, "L1", t) - l1Before) < 0.01, "缩短瞬间亮度续接");
assert.ok(Math.abs(remainingFadeSec(s.fades.L1, t) - 1) < 1e-9);

// L3/L4 不受影响
assert.ok(remainingFadeSec(s.fades.L3, t) > 9.9);
assert.ok(remainingFadeSec(s.fades.L4, t) > 9.9);

// 此时挂起的 Q3 仍因 L1 忙而等待
assert.equal(s.statuses.Q3, "held");

// 再 1s：L1 到位 → 只唤醒引用 L1 的 Q3；Q4 尚未触发，状态不变
t += 1000;
s = advance(s, t);
assert.equal(s.statuses.Q2, "done");
assert.equal(s.statuses.Q3, "fading");
assert.deepEqual(busyLightIds(s).sort(), ["L1", "L2", "L3", "L4"]);
assert.equal(s.levels.L1, 90); // Q2 目标落实

// 触发 Q4（L4/L2，wait 2s）——此刻两灯都忙，登记进入 waiting
s = fireCue(s, "Q4", t);
assert.equal(s.statuses.Q4, "waiting");

// 2s 后等待到点，但 L2/L4 仍在渐变 → 挂起
t += 2000;
s = advance(s, t);
assert.equal(s.statuses.Q4, "held");

// 把 L2 立即到位：只重排引用 L2 的挂起 Cue（Q4 引用 L2 → 重新尝试，
// 但它还引用 L4，L4 仍忙，故继续挂起；舞台不变）
s = shortenFade(s, "L2", 0, t);
assert.equal(s.statuses.Q4, "held");
assert.equal(s.levels.L2, 75);
assert.ok(s.fades.L4, "L4 仍在渐变");

// 挂起 Cue 可“留待调整”：从 Q4 移除对 L4 的引用 → 立刻解除挂起（wait 2s 重新等待）
s = setCueTarget(s, "Q4", "L4", null, t);
assert.equal(s.statuses.Q4, "waiting");
const q4 = s.cues.find((c) => c.id === "Q4")!;
assert.deepEqual(cueTargetIds(q4), ["L2"]);

// 2s 后 Q4 启动（L2 空闲）
t += 2000;
s = advance(s, t);
assert.equal(s.statuses.Q4, "fading");

// Q5 撞 4 灯挂起；灯全空后只唤醒引用空闲灯的挂起 Cue（Q5 引用全部 → 被唤醒）
s = fireCue(s, "Q5", t);
assert.equal(s.statuses.Q5, "held");

// 跳到所有进行中渐变结束之后：Q1/Q3/Q4 完成，四灯同刻空闲唤醒 Q5（8s 渐变）
t += 30000;
s = advance(s, t);
assert.equal(s.statuses.Q1, "done");
assert.equal(s.statuses.Q3, "done");
assert.equal(s.statuses.Q4, "done");
assert.equal(s.statuses.Q5, "fading");

// 再等 Q5 的 8s 渐变走完
t += 10000;
s = advance(s, t);
assert.equal(s.statuses.Q5, "done");
assert.equal(s.levels.L1, 100);
assert.equal(s.levels.L2, 100);
assert.equal(s.levels.L3, 60);
assert.equal(s.levels.L4, 100);

console.log("全部判定规则推演通过 ✓");
console.log("状态标签：", Object.values(STATUS_LABEL).join(" / "));
