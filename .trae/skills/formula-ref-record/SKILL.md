---
name: formula-ref-record
description: 在主系统公式的引出部件中引用子部件公式的历史计算记录。当需要把赫姆霍兹消音器等独立公式的完整模型接入进气系统等系统级公式、并复用已保存参数时使用。不用于普通表单联动或单位换算。
---

# 公式引用记录（refRecord）机制

把「主系统公式的引出部件直接采用子部件独立公式」这件事固化为可复用规则。典型场景：进气系统传递损失设计中的赫姆霍兹旁支，调用「赫姆霍兹消音器」公式保存过的计算记录。

## 何时使用

- 主系统公式（系统级 TL、整机管路等）含引出/旁支部件，而该部件另有独立公式
- 用户希望旁支采用独立公式的完整口径与已保存参数，而不是主系统内置简化式
- 需要两种模式并存，且默认模式不能改变既有数值

## 核心规则

1. **双模式、默认内置**：`mode=0` 内置公式，`mode=1` 调用记录。默认必须为 0，所有既有基准数值保持不变。
2. **快照固化**：引用记录经子部件公式派生后，把结果写入主系统 `hidden` 参数。**旁支**用 3 个标量（等效长度/流通面积/容积）；**管段等频域部件**用 `snapshot: Record<派生键, 参数键>` 映射任意多个模型参数。快照随主系统计算记录一起保存，保证历史回看可复现。
3. **solve 纯同步**：不得在 solve 内异步查库或读页面状态；加载记录、派生快照全部由页面完成。
4. **稳定标识**：下拉选项 `value` 用记录创建时间戳（数字），不用数组序号，避免新保存记录后旧引用漂移。
5. **只列当前用户记录**：按 `user.id` 过滤，不跨用户。
6. **失效回退**：记录被删除时清空快照，solve 自动回退内置公式，并 toast 提示「已回退为内置公式」；同一 key+值只提示一次。
7. **同源**：旁支传递矩阵、输出量（如 f0）必须使用同一组参数，禁止只改展示不改计算。
8. **口径差异显式声明**：子部件公式中主系统旁支模型无法承载的项（腔体模态、壳体耦合、薄壁小孔移频等）必须写进 assumptions。
9. **单位契约**：`derive` 返回值与快照 `hidden` 参数都使用**显示单位**（如 mm / mm² / L），页面原样写入 values，由单位管线换算为 SI 交给 solve。`derive` 若返回 SI 值会造成 1000 倍量级错误。
10. **摘要声明化**：下拉里显示哪个输出量由参数声明 `refRecord.labelOutput = { key, name, unit }` 决定，页面禁止硬编码输出键（否则换子部件公式后摘要变成 `—`）。
11. **本地时区显示**：历史记录 `createdAt` 是 UTC ISO 字符串，下拉 label 必须转本地时间格式化，禁止直接截断显示（会偏差时区，如中国早 8 小时）。
12. **非法派生值按失效处理**：`derive` 遇到缺字段、NaN、非正值时返回 `null`；页面把它当作记录失效（清空快照 + 回退 + 提示），禁止把 NaN 或 0 写入快照。
13. **快照是唯一事实来源**：主系统历史回看只按保存时的快照计算，不再回查子部件记录；记录被删不影响既有历史结果。
14. **多源隔离与禁止链式引用**：一个主系统可引用多个子部件公式，多个公式并行加载、单源失败不影响其他；子部件公式本身不得再引用记录（防循环与深度失控）。

## 实施步骤

### 1. 基础设施（仓库尚未具备时，一次配好）

- `ParamSpec` 增加：
  - `hidden?: boolean`（只算不显示，仍参与保存）
  - `refRecord?: { formulaId; labelOutput?: { key; name; unit? }; snapshot: { l; a; v }; derive(inputsSI) }`
- `ParamForm` 增加 `selectOptions?: Record<string, { value: number; label: string }[]>`；渲染时优先用动态选项；`visible` 过滤 `hidden` 参数。

### 2. 子部件公式

导出纯函数，接收 SI 输入，返回可映射为旁支等效参数的量（参考 `evalHelmholtzSummary` → `lEff / sArea / Vc`），**返回值按显示单位**。函数必须无副作用、不依赖 DOM 与全局异步状态。

### 3. 主系统公式

- 每个引出部件增加 5 个参数：
  - `xxxMode`（select：0 内置 / 1 引用记录）
  - `xxxRef`（select：选项由页面注入，自带占位 `{0, 未选择}`；`refRecord` 中声明 `labelOutput`）
  - `xxxRefL` / `xxxRefA` / `xxxRefV`（hidden，`unitGroup` 分别用 `length` / `area` / `volume`）
- 用工厂函数生成这组参数，避免在多个部件处重复（参考 `hbRefInputs`）。
- 内置几何参数的 `showIf` 追加 `{ key: xxxMode, max: 0 }`。
- solve 增加统一分支函数（参考 `hbParams`）：快照三项均大于 0 用快照，否则用内置；**矩阵、输出、校验全部走该函数**。
- 引用模式下放宽内置几何校验（不要因为 V/ln/dn 留空而拒绝计算）。
- 新增参数默认值必须为 0，保证旧记录无需迁移即可载入。

### 4. 页面（CalculatorPage）

- 扫描 `formula.inputs` 中的 `refRecord`，得到 `formulaId` 集合，加载当前用户 `api.history.list(user.id)`，按 `createdAt` 倒序分组。
- 构建 `selectOptions`：`label` = 本地时间 + `labelOutput` 摘要（如 `2026-11-20 18:30 · f0=119.0 Hz`）。
- 列表为空时显示「未选择（暂无已保存的记录）」，引导先去子部件页面保存。
- `useEffect` 监听引用参数值 → 找到记录 → 调 `derive(inputsSI)` → 只写变化的快照键（避免无限循环）。
- 失效检测：`ref > 0` 且列表已加载但匹配不到 → 清零快照 + toast。**加载失败或尚未加载时保持未知，不清空、不提示**。
- 历史回看若支持载入旧值，必须跳过快照回写，避免改写历史算例。

### 5. 文档与版本

- 参数 description、输出 description、TeX、assumptions 同步更新。
- 公式 `version` 做 minor bump（如 1.0.0 → 1.1.0）。

## 变体 B：管段 / 频域引用

被引用部件不是旁支而是串联管段（如编织管）时，不能套用「3 个标量」：

- 快照改为多参数映射：`snapshot: { fp: 'xxxRefFp', t: 'xxxRefTw', rho0: 'xxxRefRho', ... }`，`derive` 返回同键对象（显示单位）
- 子部件公式导出**逐频点纯函数**（如 `evalWovenTubeAt(inputsSI, f)`），主系统 solve 构建该段矩阵时按频点调用
- **重建原则：用能精确复现子部件总 TL 的等效量，不要只取壁面路径的复波数**。编织管案例中只取 `kx` 重建得 78.8 dB，而记录公式总 TL 为 31.4 dB——差额来自并联泄漏路径；正确做法是由总 TL 反算 `α = TL/(8.686·L)`，单段误差 <0.05 dB
- 渐变段按各子段长度/直径分别调用后级联；在 assumptions 注明属等效均匀化近似，不保留局部反射细节
- 失效路径与旁支一致：快照清零 + toast + 回退内置模型
- 单段引用完成后必须用记录公式自身的输出回归校验（差 <0.1 dB），不能只看「数值变了」

## 验收清单

- [ ] 默认模式：全部基准数值与改前完全一致
- [ ] 快照有效：即使把内置 V/ln/dn 改成无关值，结果仍由快照决定
- [ ] 快照缺失（记录失效）：自动回退内置公式，数值回到内置结果
- [ ] 下拉只含当前用户记录，时间为本地时区且带输出摘要
- [ ] 保存并回看主系统记录时快照已固化、可复现
- [ ] 旧记录（无 mode/ref/快照参数）可正常载入，按内置模式计算
- [ ] 至少一条正式单测固化「快照覆盖」与「快照缺失回退」
- [ ] 管段/频域引用：单段 TL 与子部件记录输出一致（差 <0.1 dB）
- [ ] `typecheck` 0 错误、全量测试通过

## 参考实现（本仓库）

- 类型定义：`src/formula/types.ts`（`ParamSpec.hidden` / `ParamSpec.refRecord` / `labelOutput`）
- 表单渲染：`src/components/ParamForm.tsx`（`selectOptions`、`hidden` 过滤）
- 主系统公式：`src/domains/acoustics/intakeSystemTransmissionLoss.ts`（旁支 `hbRefInputs` / `hbRecordSnapshot` / `hbParams`；管段 `wtRefInputs` / `wtRecordSnapshot`）
- 页面逻辑：`src/pages/CalculatorPage.tsx`（`refRecords` / `selectOptions` / `formatLocalTime` / 回填 effect）
- 子部件公式：`src/domains/acoustics/helmholtzMuffler.ts`（`evalHelmholtzSummary`）、`src/domains/acoustics/wovenTubeSilencer.ts`（`evalWovenTubeAt`）
- 回归测试：`tests/intakeRefRecord.test.ts`

## 反例

- 在 solve 里 `await api.history`：破坏纯函数，历史记录无法复现
- 用列表序号作下拉 `value`：新保存记录后旧引用指向错误记录
- 只改 f0 输出、不改旁支矩阵：展示与 TL 曲线不一致
- 引用模式仍强制校验内置 V/ln/dn：用户无法留空
- 记录失效时静默按 0 计算：得到无意义结果且无提示
- 页面硬编码 `outputs.fr` 之类的输出键：换子部件公式后摘要失效
- 直接截断 UTC 的 `createdAt` 显示：时区偏差且用户误判记录先后
- 把 NaN 或 0 写进快照：静默回退且无任何提示，排查困难
- 子部件公式再引用其他记录：形成循环或链式深度不可控
- 管段引用只取壁面路径复波数、忽略并联泄漏等路径：单段 TL 与记录公式相差数倍（编织管实测 78.8 vs 31.4 dB）
