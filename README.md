# 渐变预演台（hxyfront-62002）

排练用的灯光渐变预演工具：预置 4 个灯位、5 条 Cue，检查多盏灯同时变化是否「撞车」。

## 规则

- 每条 Cue 登记**目标亮度、等待时间、渐变时长**，GO 后按登记执行。
- Cue 引用的某盏灯**上次变化还没结束**时，整条 Cue 挂起（held）留待调整，舞台图与场景保持上一帧。
- 在右侧登记表中去掉（或改小目标）撞车灯引用，挂起 Cue 立即重新排队。
- 「变化中的灯」面板可把任意进行中渐变缩短到 4s / 2s / 立即到位，从**当前亮度**续接；缩短后**只重新排队引用这盏灯的挂起 Cue**。
- 变化中的灯在舞台图与面板上显示剩余秒数；切换选中别的 Cue、切换浏览器标签都不清零。
- 全部状态（含进行中的渐变时间戳）自动存入浏览器 localStorage。

## 文件结构（数据 / 判定 / 页面三层）

- `src/data.ts` — 灯位、Cue 预置数据、状态类型、localStorage 读写。
- `src/engine.ts` — 纯函数判定：`fireCue` / `advance` / `shortenFade` / `setCueTarget` / `selectCue`，时间全部由参数传入，不依赖 React。
- `src/App.tsx` — 页面交互：舞台平面图、Cue 列表、登记表、200ms 主时钟。
- `scripts/verify-engine.ts` — 引擎规则推演脚本（撞车挂起、缩短重排、计时保留等断言）。

## 本地运行

```bash
npm install
npm run dev
```

开发端口：62002

## 验证

```bash
npx tsc --noEmit          # 类型检查
npm run build             # 生产构建
node 构建后运行 scripts/verify-engine.ts   # 引擎推演（经 esbuild 打包）
```
