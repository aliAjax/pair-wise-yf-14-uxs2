import { useEffect, useRef, useState } from "react";
import "./styles.css";
import {
  createInitialState,
  loadState,
  saveState,
  type StageState,
} from "./data";
import {
  STATUS_LABEL,
  advance,
  busyLightIds,
  cueTargetIds,
  conflictingLights,
  fireCue,
  levelAt,
  remainingFadeSec,
  remainingWaitSec,
  selectCue,
  setCueTarget,
  shortenFade,
  updateCue,
} from "./engine";

const TICK_MS = 200;
const AUTO_GAP_MS = 4000;

function fmtClock(ts: number): string {
  return new Date(ts).toLocaleTimeString("zh-CN", { hour12: false });
}

function NumField(props: {
  value: number;
  step?: number;
  min?: number;
  suffix?: string;
  onCommit: (v: number) => void;
}) {
  const { value, step = 1, min = 0, suffix, onCommit } = props;
  return (
    <span className="numfield">
      <input
        type="number"
        value={value}
        step={step}
        min={min}
        onChange={(e) => {
          const v = parseFloat(e.target.value);
          if (!Number.isNaN(v)) onCommit(v);
        }}
      />
      {suffix ? <em>{suffix}</em> : null}
    </span>
  );
}

function App() {
  const [state, setState] = useState<StageState>(loadState);
  const [auto, setAuto] = useState(false);
  const playheadRef = useRef(0);
  const lastFireRef = useRef(0);
  const autoRef = useRef(false);
  const stateRef = useRef(state);
  stateRef.current = state;
  autoRef.current = auto;

  // 主时钟：推进等待 / 渐变 / 挂起重排；切 Cue、切页面都不清零
  useEffect(() => {
    const timer = setInterval(() => {
      const now = Date.now();
      setState((s) => advance(s, now));
      if (autoRef.current) {
        if (now - lastFireRef.current >= AUTO_GAP_MS) {
          const next = playheadRef.current + 1;
          if (next >= stateRef.current.cues.length) {
            autoRef.current = false;
            setAuto(false);
          } else {
            playheadRef.current = next;
            lastFireRef.current = now;
            setState((s) => fireCue(s, s.cues[next].id, now));
          }
        }
      }
    }, TICK_MS);
    return () => clearInterval(timer);
  }, []);

  // 记录存浏览器：任何变化（含计时推进）都落盘
  useEffect(() => {
    saveState(state);
  }, [state]);

  const now = Date.now();
  const selected = state.cues.find((c) => c.id === state.selectedId) ?? state.cues[0];
  const heldCount = Object.values(state.statuses).filter((x) => x === "held").length;
  const busyIds = busyLightIds(state);

  const go = (cueId: string) => setState((s) => fireCue(s, cueId, Date.now()));
  const choose = (cueId: string) => setState((s) => selectCue(s, cueId));

  const startAuto = () => {
    const t = Date.now();
    playheadRef.current = 0;
    lastFireRef.current = t;
    autoRef.current = true;
    setAuto(true);
    setState((s) => fireCue(s, s.cues[0].id, t));
  };
  const stopAuto = () => {
    autoRef.current = false;
    setAuto(false);
  };
  const reset = () => {
    stopAuto();
    setState(createInitialState(Date.now()));
  };

  return (
    <main className="app">
      <header className="topbar">
        <div>
          <p>GRADIENT PREVIEW CONSOLE · 排练用</p>
          <h1>渐变预演台</h1>
        </div>
        <div className="transport">
          {auto ? (
            <button className="warn" onClick={stopAuto}>■ 停止连排</button>
          ) : (
            <button className="primary" onClick={startAuto}>▶ 连排预演（每 4s 下一 Cue）</button>
          )}
          <button onClick={reset}>↺ 复位预置</button>
        </div>
      </header>

      <section className="metrics">
        <article><small>灯位数量</small><strong>{state.lights.length}</strong></article>
        <article><small>Cue 数量</small><strong>{state.cues.length}</strong></article>
        <article><small>当前场景</small><strong className="scene-name">{state.scene}</strong></article>
        <article className={heldCount > 0 ? "danger" : ""}>
          <small>撞车挂起</small><strong>{heldCount}</strong>
        </article>
      </section>

      <section className="workspace">
        {/* 左：舞台平面图 + 变化中灯位 */}
        <div className="left-col">
          <section className="panel stage-panel">
            <div className="heading">
              <h2>舞台平面灯位图</h2>
              <span className="scene-tag">场景：{state.scene}</span>
            </div>
            <div className="stage">
              <div className="stage-floor" />
              {state.lights.map((l) => {
                const lvl = levelAt(state, l.id, now);
                const fade = state.fades[l.id];
                const remain = remainingFadeSec(fade, now);
                return (
                  <div
                    key={l.id}
                    className={"fixture" + (fade ? " busy" : "")}
                    style={{ left: `${l.x}%`, top: `${l.y}%` }}
                  >
                    <div
                      className="beam"
                      style={{
                        background: `radial-gradient(circle, ${l.color} 0%, transparent 70%)`,
                        opacity: 0.15 + (lvl / 100) * 0.85,
                        transform: `scale(${0.55 + (lvl / 100) * 0.9})`,
                      }}
                    />
                    <span className="dot" style={{ borderColor: l.color }}>
                      {l.id}
                    </span>
                    {fade ? (
                      <span className="countdown">
                        {remain.toFixed(1)}s
                        <small>→ {fade.to}%</small>
                      </span>
                    ) : null}
                    <span className="level-tag">{Math.round(lvl)}%</span>
                  </div>
                );
              })}
            </div>
          </section>

          <section className="panel">
            <h2>变化中的灯（{busyIds.length}）</h2>
            {busyIds.length === 0 ? (
              <p className="empty">当前没有灯在渐变，登记 Cue 后这里会显示剩余时间。</p>
            ) : (
              <div className="shorten-list">
                {busyIds.map((id) => {
                  const l = state.lights.find((x) => x.id === id)!;
                  const f = state.fades[id];
                  const cue = state.cues.find((c) => c.id === f.cueId);
                  return (
                    <div key={id} className="shorten-row">
                      <div>
                        <b style={{ color: l.color }}>{l.id}</b>
                        <span>{l.name} · {cue?.name ?? "—"}</span>
                        <small>
                          目标 {f.to}% · 剩余 <em>{remainingFadeSec(f, now).toFixed(1)}s</em>
                        </small>
                      </div>
                      <div className="shorten-actions">
                        {[4, 2, 0].map((sec) => (
                          <button
                            key={sec}
                            onClick={() =>
                              setState((s) => shortenFade(s, id, sec, Date.now()))
                            }
                          >
                            {sec === 0 ? "立即到位" : `缩到 ${sec}s`}
                          </button>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
            <p className="hint">
              缩短只影响这盏灯；灯位空出后，只重新排队引用它的挂起 Cue。
            </p>
          </section>
        </div>

        {/* 中：Cue 列表 */}
        <section className="panel cue-panel">
          <div className="heading">
            <h2>Cue 表（{state.cues.length} 条）</h2>
            <span className="hint">GO 登记后撞车的 Cue 挂起，舞台保持上一帧</span>
          </div>
          <div className="cue-list">
            {state.cues.map((cue, idx) => {
              const status = state.statuses[cue.id];
              const clash = status === "held" ? conflictingLights(state, cue) : [];
              const active = selected?.id === cue.id;
              return (
                <article
                  key={cue.id}
                  className={"cue-row " + status + (active ? " selected" : "")}
                  onClick={() => choose(cue.id)}
                >
                  <b className="cue-no">{String(idx + 1).padStart(2, "0")}</b>
                  <div className="cue-main">
                    <h3>{cue.name}</h3>
                    <p>
                      等待 {cue.wait}s · 渐变 {cue.fade}s · 灯位{" "}
                      {cueTargetIds(cue).join(" / ") || "（空）"}
                    </p>
                    {status === "held" ? (
                      <p className="clash">⛔ 等 {clash.join("、")} 空闲后重新排队</p>
                    ) : null}
                    {status === "waiting" ? (
                      <p className="wait-info">
                        ◷ {remainingWaitSec(state, cue.id, now).toFixed(1)}s 后启动
                      </p>
                    ) : null}
                  </div>
                  <div className="cue-side">
                    <span className={"badge " + status}>{STATUS_LABEL[status]}</span>
                    <button
                      className="go-btn"
                      disabled={status === "waiting" || status === "fading" || status === "held"}
                      onClick={(e) => {
                        e.stopPropagation();
                        go(cue.id);
                      }}
                    >
                      GO
                    </button>
                  </div>
                </article>
              );
            })}
          </div>
        </section>

        {/* 右：登记表 + 日志 */}
        <div className="right-col">
          <section className="panel editor">
            <div className="heading">
              <h2>Cue 登记 · {selected?.id}</h2>
            </div>
            {selected ? (
              <>
                <label className="field">
                  <span>Cue 名称</span>
                  <input
                    value={selected.name}
                    onChange={(e) =>
                      setState((s) =>
                        updateCue(s, selected.id, { name: e.target.value }, Date.now())
                      )
                    }
                  />
                </label>
                <div className="field-row">
                  <label className="field">
                    <span>等待时间</span>
                    <NumField
                      value={selected.wait}
                      suffix="s"
                      onCommit={(v) =>
                        setState((s) => updateCue(s, selected.id, { wait: v }, Date.now()))
                      }
                    />
                  </label>
                  <label className="field">
                    <span>渐变时长</span>
                    <NumField
                      value={selected.fade}
                      suffix="s"
                      onCommit={(v) =>
                        setState((s) => updateCue(s, selected.id, { fade: v }, Date.now()))
                      }
                    />
                  </label>
                </div>

                <div className="targets">
                  <span>目标亮度（勾选即引用该灯）</span>
                  {state.lights.map((l) => {
                    const referenced = l.id in selected.targets;
                    const val = selected.targets[l.id] ?? 0;
                    return (
                      <div key={l.id} className={"target-row" + (referenced ? "" : " off")}>
                        <label className="check">
                          <input
                            type="checkbox"
                            checked={referenced}
                            onChange={(e) =>
                              setState((s) =>
                                setCueTarget(
                                  s,
                                  selected.id,
                                  l.id,
                                  e.target.checked ? val || 50 : null,
                                  Date.now()
                                )
                              )
                            }
                          />
                          <b style={{ color: l.color }}>{l.id}</b>
                          <small>{l.type}</small>
                        </label>
                        <input
                          className="range"
                          type="range"
                          min={0}
                          max={100}
                          disabled={!referenced}
                          value={val}
                          onChange={(e) =>
                            setState((s) =>
                              setCueTarget(
                                s,
                                selected.id,
                                l.id,
                                parseInt(e.target.value, 10),
                                Date.now()
                              )
                            )
                          }
                        />
                        <NumField
                          value={val}
                          suffix="%"
                          onCommit={(v) =>
                            referenced &&
                            setState((s) =>
                              setCueTarget(s, selected.id, l.id, v, Date.now())
                            )
                          }
                        />
                      </div>
                    );
                  })}
                </div>

                <label className="field">
                  <span>排练备注</span>
                  <textarea
                    rows={2}
                    value={selected.note}
                    onChange={(e) =>
                      setState((s) =>
                        updateCue(s, selected.id, { note: e.target.value }, Date.now())
                      )
                    }
                  />
                </label>
              </>
            ) : null}
          </section>

          <section className="panel log-panel">
            <h2>运行记录</h2>
            <ul>
              {state.log.slice(-12).reverse().map((entry, i) => (
                <li key={state.log.length - i}>
                  <time>{fmtClock(entry.at)}</time>
                  <span>{entry.text}</span>
                </li>
              ))}
            </ul>
          </section>
        </div>
      </section>
    </main>
  );
}

export default App;
