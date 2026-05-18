# AGENTS.md

## 交互要求

## 构建与开发

```bash
npm run dev      # 监听模式，仅esbuild（无类型检查）
npm run build    # 先执行 tsc -noEmit -skipLibCheck，再用 esbuild 生成生产版（压缩）
```

- `main.js` 是**生成后的捆绑包**（见 esbuild 标头）。切勿编辑它。所有源代码都在 `src/` 中。
- 入口点：`src/main.ts` → `main.js`（CommonJS 输出，es2018 目标）。
- `tsconfig.json` 设置了 `baseUrl: "src"` —— `src/` 内的导入相对于 `src/`，而不是仓库根目录。

## 架构

```
src/
  main.ts        插件入口——注册视图、命令、功能区、文件菜单、设置选项卡
  view.ts        自定义视图（TextFileView）——DOM、事件、渲染循环、编辑器、PNG 导出
  engine.ts      核心逻辑——选择、历史记录（撤销/重做）、坐标变换、吸附、箭头路由
  types.ts       数据类型、枚举、常量（GRID_SIZE、SNAP_DISTANCE 等）
  settings.ts    设置接口 + 默认值 + ShortcutBinding
  settingsTab.ts Obsidian 设置选项卡 UI
  locale.ts      双语 i18n（中文/英文）——t(key, vars?) 辅助函数
styles.css       插件样式（由 onload 加载）
manifest.json    Obsidian 插件清单（id: "simple-draw"）
versions.json    插件版本 → 最低 Obsidian 应用版本映射
```

- 插件注册 `.simpledraw` 文件扩展名，使用 `TextFileView` 进行内联编辑。
- 数据以 JSON 格式存储在 `.simpledraw` 文件中（从 `SimpleDrawData` 序列化）。
- 箭头渲染使用 SVG（`svgLayer`），文本框是 DOM 元素（`elementsLayer`）。
- MarkdownRenderer 用于文本框内容（异步渲染）。

## 箭头路由（engine.ts 中的 `buildArrowPath()`）

采用两遍正交障碍物避让策略。障碍物 = 相连的文本框（≤ 2），在所有方向上扩展 `EXT = max(arrowHeadSize, 20)`。

- **第一遍**：枚举最多 3 条轴对齐的候选路径（L 形、Z 形），转弯数递增。返回第一条无障碍路径。
- **第二遍**：如果第一遍失败，则生成 4 条边界逃逸候选路径（所有障碍物的上/下/左/右）。选择最短的无障碍路径。
- **回退**：标准正交路由（始终成功）。

### 历史冻结错误（已修复）
原来的 `ensureOutsideAnchoredBoxes` 在包含检查中使用了 `>=`/`<=`。推到边距边缘的转弯点仍被视为“内部”，导致无限拼接。已重写为使用严格 `<`/`>` 边界和一个带边界的一次性 while 循环。**未经仔细测试，请勿重新引入非严格比较。**

## 外部依赖

`obsidian`、`electron` 以及所有 `@codemirror/*`/`@lezer/*` 包在 esbuild 中均**标记为外部**——它们由 Obsidian 运行时提供，不进行捆绑。

## 导出 PNG

- 使用 **DOM 截图**方案（`html-to-image` 库的 `toCanvas()`），而非手动 Canvas 绘制。实现真正的"所见即所得"：数学公式、代码块、颜色、字体均与编辑视图完全一致。
- **工作原理**：将 `svgLayer`（箭头）和 `elementsLayer`（已渲染 Markdown 的文本框）克隆到隐藏的离线容器中，平移元素使包围盒对齐原点，然后以 `pixelRatio: 2` 调用 `toCanvas()` 输出高清图片。工具栏（`menuEl`）不在克隆范围内，无需操作可见 DOM。
- 网格层在离线容器中重新创建为 CSS 渐变 div，通过 `background-position` 偏移与全局坐标对齐。
- 通过三点（叶子）菜单触发——通过 `(this.app.workspace as any).on('leaf-menu', ...)` 注册，因为 `leaf-menu` 在 Obsidian 发布的类型重载中缺失。
- 使用 `app.vault.adapter.writeBinary()` 保存 PNG 文件。
- 一个 `SimpleDrawExportModal`（定义在 `view.ts` 中）允许用户切换网格可见性并选择保存文件夹。

## 约定

- UI 标签为中文（参见 `locale.ts` 的翻译）。
- 文本框吸附到角点/中心点（8 个锚点，`SNAP_DISTANCE = 10px`）。
- 通过手动 JSON 深克隆 `SimpleDrawData` 实现撤销/重做（最多 100 条历史记录）。
- 新文本框默认 `visible: true`、`fillEnabled: true`、`autoSize: true`。
- `DEFAULT_DATA` 定义初始空画布状态——使用前需深克隆。
- 右键单击文本框会打开上下文菜单（置顶/置底），用于控制文本框之间的 Z 轴顺序。箭头和画布不受影响。
- Z 轴顺序由 `elements` 数组中的位置决定。`engine.ts` 中的 `sendTextboxToFront()`/`sendTextboxToBack()` 会重新排列数组并调用 `rebuildAll()` 更新 DOM 顺序。
- 文本框编辑器（textarea）支持可配置的 Markdown 快捷键（Ctrl+B 加粗、Ctrl+I 斜体、Ctrl+U 删除线、Ctrl+Shift+C 代码、Ctrl+K 链接、Ctrl+Shift+H 高亮标记、Ctrl+M 行内公式、Ctrl+Shift+M 行外公式）。绑定以 `ShortcutBinding[]` 存储在设置中，通过设置选项卡中的按键录制 UI 进行配置。
- Ctrl+C 将选中的文本框+箭头以 JSON 格式复制到剪贴板；Ctrl+V 以偏移形式粘贴到当前鼠标位置。
- Ctrl+V 将外部纯文本粘贴到画布上，会在鼠标位置创建一个自动大小的新文本框。

## 开发过程中需参考Obsidian官方开发者文档
- 中文文档： https://raistlind.github.io/obsidian-dev-docs-zh/zh/home.html
- 英文文档： https://docs.obsidian.md/Home


