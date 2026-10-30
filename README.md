# 慢慢岛 · Hana 内嵌 App 完整源码

最终用户说明：`app/manman-island/README.md`。正式安装包无需构建。下述目录用于完整复验与后续开发。

## 版本

### 1.1.0 · 海屿（当前）

这一版更新了什么：

- **乘船出海**：岸边新增小船，点击进入连续离岸过程（升帆、镜头拉远、逐步离岸）；家岛以 2.5D 原貌缩小为海中的岛，出航期间居民现场暂停。
- **海域探索**：新增灯塔岛、椰树岛等 3 座代码构造岛屿、6 处礁石、水面与水深寻路、昼夜五档变化（白天/黄昏/日落/月夜/黎明）。轻点海面/海图开船，拖动转视角，滚轮或双指缩放，右下 ϟ 或空格加速（有能量消耗）。
- **钓鱼**：20 群鱼、下竿/咬钩/1.4 秒内收竿、错过窗口逃鱼、8 种鱼图鉴；探索岛目前支持近岸观景和钓鱼，尚无下船登岛。
- **漂流瓶**：靠近自动拾取 12 封来信，收藏与图鉴写入记录本并随 Hana 存档与备份保存。
- **返航**：走安全航线回码头，靠岸后原岛继续运行，不是点按钮直接切回页面。
- **其他**：海龟海鸥生物、程序合成声音（默认关闭，可手动开启）、手机竖屏布局（390×844 无横向溢出）。
- **不变的**：App ID、存档主键、居民/成长/命名/记录本、Agent 思考/工作、四项权限、原 Canvas 美术与全部文案。升级安装不丢进度；建议先导出备份。旧 1.0.1 不认识航海字段，回退时用升级前备份。

### 1.0.1 · 修复

- 归档会话不可经扩展接口读取时，明确提示并继续分析可读会话，不再整次失败；7 天内只剩归档时给出可行动提示。

### 1.0.0 · 首版

- 单岛归属与只读参观、确认换岛；思考/工作读取本 Agent 最近 7 天会话并写入记录本；Hana 持久存档、多窗口冲突保护、JSON 备份导入导出。

更详细的升级说明与测试报告见 `docs/升级安装说明.md`、`docs/测试与兼容报告.md`，海屿设计见 `app/manman-island/README-海屿.md`。

## 目录

- `source-delivery/`：用户原始完整交付包，未改动，原 SHA-256 清单仍有效。
- `app/manman-island/`：可编辑 App 源码、官方 SDK、原始文案和画面。
- `artwork/`：由原标识延伸的图标源文件。
- `scripts/build.mjs`：生成干净运行目录，排除旧脚手架示例页。
- `tests/`：存档、会话采集、分析任务、浏览器组件集成、原包完整性及官方校验封装。
- `test-results/`：实际测试输出。组件测试截图含虚构测试会话/模型数据，不是用户的实际分析结果。
- `build/`：可重新生成的运行产物。
- `dist-extensions/`：官方打包器生成的 ZIP 及匹配 entry 元数据。

`test-runtime/` 和 `.test-work/` 只存测试用 Electron、临时资料，不装入 App，不随完整源码包分发。本产品在 Hana 内使用；开发测试窗口不构成另一个独立交付程序。

## 环境与复验

生产包没有 npm、Python、额外运行时或自设外网依赖。开发检查需要 Node（本轮使用宿主选定的 Node 26）以及 Hana 官方 author tools。`HANA_APP_TOOLS_ROOT` 指向包含 `APPS.md`、`scripts/validate-app.mjs`、`skills2set/hana-app-creator/scripts` 的 Hana Server 版本目录。

官方 UI smoke 需要独立 Electron，设置 `HANA_APP_ELECTRON` 为其可执行文件。本轮为 macOS ARM64、Electron 45.1.0；来源、官方 SHA-256 对照在 `tests/runtime-provenance.json`。不能用已安装的 Hana 主程序当脚本运行器。Hana 中下载任何测试依赖均使用 hana-downloader；没有测试运行时就明确记为未运行，不得记为通过。

在源码根目录执行：

```sh
node tests/verify-source.mjs
node --test tests/storage.test.mjs tests/analysis-source.test.mjs tests/analysis-engine.test.mjs
node scripts/build.mjs
node tests/run-validation.mjs static build/manman-island
node tests/run-validation.mjs smoke build/manman-island
```

浏览器组件集成：

```sh
"$HANA_APP_ELECTRON" tests/browser-acceptance.mjs
```

组件测试创建自己的 localhost 页面、内存数据和独立 Electron 存储分区。真实 UI、保存仓库、会话采集与分析任务代码都参与，但 UI SDK 边界、会话数据和模型响应均为明确的测试替身。它不执行真实模型、不使用生产会话或凭据，也不证明生产权限链。正式产品 `connectIsland()` 默认使用官方 SDK；参数注入只供测试夹具。加速时钟和测试入口只注入临时页面，不写入正式 HTML。

官方打包及最终归档复验：

```sh
node "$HANA_APP_TOOLS_ROOT/skills2set/hana-app-creator/scripts/pack_app.mjs" \
  --dir build/manman-island --publisher mab --out dist-extensions
node tests/run-validation.mjs smoke dist-extensions/打包器实际返回的安装包文件名.zip
```

安装走 Hana 扩展管理器及用户审查。不要将源码 ZIP 直接安装，不要绕过管理器覆盖生产 apps 目录。最终交付安装包只包含可运行产物与本地 SDK，不运行包管理器。

## 归属与存档

宿主键 `manman-island-state.v2` 是 App 私有原子对象：游戏 revision/epoch/data、Agent notes、幂等请求指纹。`manman-island-before-replace.v2` 只保留最近一个明确替换前的恢复点。

当前岛的 `data` 沿用原始字符串键，但只允许 selected-theme 加所选岛的 residents/keeper 两键。参观岛不得写入。普通 save 不能更改已有归属；new-island 需要明确 confirmedAbandon、不同岛和仅选岛键；import 需要通过格式校验且当前无活动任务。替换重新分配 epoch；所有任务更新核对 epoch，旧结果不得写入新岛。

游戏版本号只跟随游戏写入递增。Agent notes 更新使用同一串行事务和同一个宿主原子存储对象，但不增加游戏版本号。这样后台笔记不会冲突或被游戏自动保存覆盖。后端读取校验、冲突判断和落盘处于同一队列，不使用最后写者覆盖。

备份数据格式为 v2，包含当前岛与 Agent notes。恢复时清除 taskId，把活动任务标为未完成，不重新花费模型用量。容量边界明确报错，不截断记录。

## 会话与推理边界

前端通过 `hana.sessions.getActive()` 获取宿主签发的主会话引用，并随用户点击传给后端。后端先 `sdk.sessions.get({scope:'all',sessionId})` 验证实际 agentId，再 `list({scope:'all',lifecycle:'all',agentId})` 和 `entries()` 读取当前分支。消息时间戳筛过去168小时，截至点击快照；没有时间戳、断链或读取失败时明确失败。没有固定会话数量截断。图片仅计数，不把 base64 发入模型。内部 thinking/reasoning 不纳入正文。

模型来自参考会话 `sdk.sessions.context().model`，与 `sdk.models.list()` 的 provider/id 精确匹配，不采用当前全局焦点猜测或第一可用模型降级。按目录公布的上下文容量分段，全部片段被处理；合并若无法收敛则明确失败。来源编号需合法，空回复、length、工具调用、流中断不作为完成结果。

任务使用 `sdk.tasks` 的 App 作用域、delivery:none；关闭页面后仍可读到结果。它不向用户主会话发消息，不开启新的主会话，不执行 Agent 工具。只有用户点击工作/思考才启动推理；启动恢复不会自动重跑中断任务。

四项权限：读取会话、模型推理、自有任务管理、导出备份写资源。App 无 Provider 凭据读取、原会话写入或系统命令权限。AI 输入通过宿主的配置提供方处理，可能联网和计费；没有 App network 声明不表示模型请求不联网。
