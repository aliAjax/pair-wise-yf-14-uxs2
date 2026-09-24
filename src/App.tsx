// ============================================================
// 交互层：页面渲染、预演时钟、Cue 编辑与局部重排的触发
// 数据在 data.ts，判定在 engine.ts
// ============================================================

import { useEffect, useMemo, useState } from "react";
import {
  PRESET_LIGHTS,
  PRESET_CUES,
  loadCues,
  saveCues,
  loadLog,
  saveLog,
  clearStoredCues,
  type Cue,
  type CuePlan,
  type Light,
  type LogEntry,
} from "./data";
import { planAll, replanLightChain, sceneAt, totalDuration, formatSec } from "./engine";
import "./styles.css";

const lightById = (id: string): Light => PRESET_LIGHTS.find((l) => l.id === id)!;

function stamp(): string {
  return new Date().toLocaleTimeString("zh-CN", { hour12: false });
}

// ---------------- 舞台平面图 ----------------

function StageView({ scene, activeHeld }: { scene: ReturnType<typeof sceneAt>; activeHeld: CuePlan | null }) {
  return (
    <section className="panel stage-panel">
      <div className="heading">
        <div>
          <p>舞台平面图</p>
          <h2>灯位实时画面</h2>
        </div>
        {activeHeld && <span className="hold-banner">⏸ {activeHeld.label} 留待调整 · 保持上一帧</span>}
      </div>
      <div className="stage">
        <span className="audience">观众席</span>
        <div className="stage-floor" />
        {PRESET_LIGHTS.map((light) => {
          const s = scene.find((x) => x.lightId === light.id)!;
          const glow = 0.15 + (s.level / 100) * 0.85;
          return (
            <div key={light.id} className="light-dot" style={{ left: `${light.x}%`, top: `${light.y}%` }}>
              <span
                className={`beam ${s.fading ? "is-fading" : ""}`}
                style={{
                  background: light.gel,
                  opacity: glow,
                  boxShadow: `0 0 ${18 + s.level * 0.5}px ${light.gel}`,
                }}
              />
              <span className="light-tag">
                {light.name} {Math.round(s.level)}%
              </span>
              {s.fading && <span className="remain-badge">剩 {formatSec(s.remainingSec)}</span>}
            </div>
          );
        })}
      </div>
    </section>
  );
}

// ---------------- 当前场景 ----------------

function SceneList({ scene }: { scene: ReturnType<typeof sceneAt> }) {
  return (
    <section className="panel scene-panel">
      <div className="heading">
        <div>
          <p>当前场景</p>
          <h2>四路灯位输出</h2>
        </div>
        <span className="hint">剩余时间跟随预演时钟，切换选中 Cue 不清零</span>
      </div>
      <div className="scene-rows">
        {PRESET_LIGHTS.map((light) => {
          const s = scene.find((x) => x.lightId === light.id)!;
          return (
            <div key={light.id} className="scene-row">
              <div className="scene-meta">
                <b>{light.name}</b>
                <small>
                  {light.fixture} · {light.channel}
                </small>
              </div>
              <div className="bar-track">
                <div className="bar-fill" style={{ width: `${s.level}%`, background: light.gel }} />
              </div>
              <div className="scene-num">
                <strong>{Math.round(s.level)}%</strong>
                {s.fading ? (
                  <em className="fading-note">
                    → {s.toLevel}% · 剩 {formatSec(s.remainingSec)}
                  </em>
                ) : (
                  <em>{s.level > 0 ? "稳定" : "熄灭"}</em>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

// ---------------- 时间轴 ----------------

function Timeline({ plans, time, total }: { plans: CuePlan[]; time: number; total: number }) {
  const span = total || 1;
  return (
    <section className="panel">
      <div className="heading">
        <div>
          <p>时间轴</p>
          <h2>多灯变化对照</h2>
        </div>
        <span className="hint">色块 = 渐变窗口；斜纹 = 撞车留待，不占灯</span>
      </div>
      <div className="timeline">
        {PRESET_LIGHTS.map((light) => {
          const rows = plans.filter((p) => p.lightId === light.id);
          return (
            <div key={light.id} className="tl-row">
              <span className="tl-label">{light.name}</span>
              <div className="tl-track">
                {rows.map((p) => (
                  <div
                    key={p.id}
                    className={`tl-block ${p.status === "held" ? "is-held" : ""}`}
                    style={{
                      left: `${(p.fadeStart / span) * 100}%`,
                      width: `${Math.max(((p.fadeEnd - p.fadeStart) / span) * 100, 1.2)}%`,
                      background: p.status === "held" ? undefined : light.gel,
                    }}
                    title={`${p.label} · ${formatSec(p.fadeStart)} → ${formatSec(p.fadeEnd)}`}
                  >
                    {p.status === "held" ? "⚠" : ""}
                  </div>
                ))}
                <div className="playhead" style={{ left: `${Math.min((time / span) * 100, 100)}%` }} />
              </div>
            </div>
          );
        })}
        <div className="tl-ruler">
          {Array.from({ length: Math.ceil(total) + 1 }, (_, i) => (
            <span key={i} style={{ left: `${(i / span) * 100}%` }}>
              {i}s
            </span>
          ))}
        </div>
      </div>
    </section>
  );
}

// ---------------- Cue 检查器（选中后编辑） ----------------

function CueInspector({
  cue,
  heldHint,
  onApply,
}: {
  cue: CuePlan;
  heldHint: string | null;
  onApply: (next: Cue) => void;
}) {
  const [target, setTarget] = useState(String(cue.target));
  const [wait, setWait] = useState(String(cue.waitSec));
  const [fade, setFade] = useState(String(cue.fadeSec));

  const parse = (s: string, fallback: number) => {
    const n = Number(s);
    return s.trim() === "" || !Number.isFinite(n) ? fallback : n;
  };

  const apply = () => {
    onApply({
      id: cue.id,
      label: cue.label,
      lightId: cue.lightId,
      target: Math.min(100, Math.max(0, Math.round(parse(target, cue.target)))),
      waitSec: Math.min(60, Math.max(0, parse(wait, cue.waitSec))),
      fadeSec: Math.min(60, Math.max(0, parse(fade, cue.fadeSec))),
    });
  };

  return (
    <div className="inspector">
      <div className="field-grid three">
        <label>
          <span>目标亮度（%）</span>
          <input type="number" min={0} max={100} value={target} onChange={(e) => setTarget(e.target.value)} />
        </label>
        <label>
          <span>等待时间（秒）</span>
          <input type="number" min={0} max={60} step={0.5} value={wait} onChange={(e) => setWait(e.target.value)} />
        </label>
        <label>
          <span>渐变时长（秒）</span>
          <input type="number" min={0} max={60} step={0.5} value={fade} onChange={(e) => setFade(e.target.value)} />
        </label>
      </div>
      <div className="inspector-foot">
        <button className="primary" onClick={apply}>
          应用修改
        </button>
        {cue.status === "held" && <span className="held-reason">⚠ {cue.heldReason}，本条不执行，舞台保持上一帧</span>}
        {heldHint && <span className="hint">{heldHint}</span>}
      </div>
    </div>
  );
}

// ---------------- 主界面 ----------------

function App() {
  const [cues, setCues] = useState<Cue[]>(loadCues);
  const [plans, setPlans] = useState<CuePlan[]>(() => planAll(loadCues()));
  const [log, setLog] = useState<LogEntry[]>(loadLog);
  const [selectedId, setSelectedId] = useState("C1");
  const [running, setRunning] = useState(false);
  const [time, setTime] = useState(0);
  const [lastAffected, setLastAffected] = useState<string[]>([]);

  const total = useMemo(() => totalDuration(plans), [plans]);
  const scene = useMemo(() => sceneAt(plans, PRESET_LIGHTS, time), [plans, time]);
  const heldCount = plans.filter((p) => p.status === "held").length;
  const fadingCount = scene.filter((s) => s.fading).length;
  const selected = plans.find((p) => p.id === selectedId) ?? null;
  const activeHeld = plans.find((p) => p.status === "held" && time >= p.fadeStart && time < p.fadeEnd) ?? null;

  // 预演时钟：全局唯一，选中哪条 Cue 都不影响
  useEffect(() => {
    if (!running) return;
    const id = window.setInterval(() => setTime((t) => Math.min(t + 0.1, total)), 100);
    return () => window.clearInterval(id);
  }, [running, total]);

  useEffect(() => {
    if (running && time >= total) setRunning(false);
  }, [running, time, total]);

  // 记录存浏览器
  useEffect(() => saveCues(cues), [cues]);
  useEffect(() => saveLog(log), [log]);

  const appendLog = (text: string) => setLog((prev) => [{ time: stamp(), text }, ...prev].slice(0, 100));

  const applyCueEdit = (next: Cue) => {
    const oldCue = cues.find((c) => c.id === next.id);
    if (!oldCue) return;
    const nextCues = cues.map((c) => (c.id === next.id ? next : c));
    const fadeShortenedOnly =
      next.fadeSec < oldCue.fadeSec && next.target === oldCue.target && next.waitSec === oldCue.waitSec;

    if (fadeShortenedOnly) {
      // 只重排引用同一盏灯的后续 Cue
      const { plans: nextPlans, affected } = replanLightChain(plans, nextCues, next.id);
      const released = affected
        .filter((a) => a.status === "ok" && plans.find((p) => p.id === a.id)?.status === "held")
        .map((a) => a.label);
      setPlans(nextPlans);
      setLastAffected(affected.map((a) => a.id));
      let msg = `${next.label} 渐变 ${oldCue.fadeSec}s → ${next.fadeSec}s，只重排${lightById(next.lightId).name}后续 ${affected.length} 条`;
      if (affected.length > 0) msg += `（${affected.map((a) => a.label).join("、")}）`;
      msg += released.length > 0 ? `；解除留待：${released.join("、")}` : "；其余 Cue 未动";
      appendLog(msg);
    } else {
      // 等待时间等影响触发链的字段变了，才全量重排
      setPlans(planAll(nextCues));
      setLastAffected([]);
      appendLog(`${next.label} 参数更新，触发链变化，全量重排 ${nextCues.length} 条 Cue`);
    }
    setCues(nextCues);
  };

  const resetClock = () => {
    setRunning(false);
    setTime(0);
    appendLog("预演时钟已重置");
  };

  const restorePresets = () => {
    const presets = PRESET_CUES.map((c) => ({ ...c }));
    clearStoredCues();
    setCues(presets);
    setPlans(planAll(presets));
    setLastAffected([]);
    setRunning(false);
    setTime(0);
    appendLog("已恢复预置的 4 灯位 / 5 Cue 表");
  };

  const heldHintFor = (cue: CuePlan): string | null => {
    if (cue.status === "held") return null;
    const nextHeld = plans.find((p) => p.status === "held" && p.lightId === cue.lightId && p.seq > cue.seq);
    return nextHeld ? `缩短本条渐变（当前 ${cue.fadeSec}s）可解除 ${nextHeld.label} 的留待` : null;
  };

  return (
    <main className="app">
      <section className="hero">
        <p>hxyfront-62002 · 剧场灯光 · 排练模式</p>
        <h1>渐变预演台</h1>
        <span>
          预置 4 个灯位、5 条 Cue，每条登记目标亮度、等待时间与渐变时长。同一盏灯上一次变化未结束时，
          新 Cue 自动留待调整，舞台图与场景保持上一帧；缩短渐变后只重排引用该灯的后续 Cue。
        </span>
        <div className="transport">
          <strong className="clock">
            T+ {formatSec(time)} <small>/ {formatSec(total)}</small>
          </strong>
          <button
            className="primary"
            onClick={() => {
              setRunning((r) => !r);
              appendLog(running ? `预演暂停于 T+ ${formatSec(time)}` : "开始预演");
            }}
          >
            {running ? "暂停" : time > 0 && time < total ? "继续预演" : "开始预演"}
          </button>
          <button onClick={resetClock}>重置时钟</button>
          <button onClick={restorePresets}>恢复预置</button>
        </div>
      </section>

      <section className="metrics">
        <article>
          <small>灯位数量</small>
          <strong>{PRESET_LIGHTS.length}</strong>
        </article>
        <article>
          <small>Cue 数量</small>
          <strong>{plans.length}</strong>
        </article>
        <article>
          <small>留待调整</small>
          <strong className={heldCount > 0 ? "warn" : ""}>{heldCount}</strong>
        </article>
        <article>
          <small>变化中的灯</small>
          <strong>{fadingCount}</strong>
        </article>
      </section>

      <section className="workspace">
        <StageView scene={scene} activeHeld={activeHeld} />
        <SceneList scene={scene} />
      </section>

      <Timeline plans={plans} time={time} total={total} />

      <section className="panel">
        <div className="heading">
          <div>
            <p>Cue 列表</p>
            <h2>五条预置 Cue</h2>
          </div>
          <span className="hint">点击卡片选中并编辑；缩短渐变只重排同灯后续 Cue</span>
        </div>
        <div className="cue-list">
          {plans.map((p) => {
            const light = lightById(p.lightId);
            const isSelected = p.id === selectedId;
            return (
              <article
                key={p.id}
                className={`cue-card ${isSelected ? "is-selected" : ""} ${p.status === "held" ? "is-held" : ""}`}
                onClick={() => setSelectedId(p.id)}
              >
                <div className="cue-head">
                  <b>{String(p.seq).padStart(2, "0")}</b>
                  <div className="cue-title">
                    <h3>{p.label}</h3>
                    <p>
                      <i style={{ background: light.gel }} /> {light.name} · {light.fixture} · 目标 {p.target}% · 等待{" "}
                      {p.waitSec}s · 渐变 {p.fadeSec}s · 窗口 {formatSec(p.fadeStart)}→{formatSec(p.fadeEnd)}
                    </p>
                  </div>
                  <div className="cue-badges">
                    {lastAffected.includes(p.id) && <span className="replanned">本次重排</span>}
                    <span className={`status ${p.status}`}>{p.status === "held" ? "留待调整" : "正常"}</span>
                  </div>
                </div>
                {isSelected && (
                  <CueInspector key={p.id} cue={p} heldHint={heldHintFor(p)} onApply={(next) => applyCueEdit(next)} />
                )}
              </article>
            );
          })}
        </div>
      </section>

      <section className="panel">
        <div className="heading">
          <div>
            <p>预演记录</p>
            <h2>操作与重排日志</h2>
          </div>
          <button onClick={() => setLog([])}>清除记录</button>
        </div>
        {log.length === 0 ? (
          <p className="empty">暂无记录。修改 Cue、开始预演后会写入浏览器本地存储。</p>
        ) : (
          <div className="log-list">
            {log.map((entry, i) => (
              <div key={`${entry.time}-${i}`} className="log-row">
                <time>{entry.time}</time>
                <span>{entry.text}</span>
              </div>
            ))}
          </div>
        )}
      </section>
    </main>
  );
}

export default App;
