# SimpleDraw — Obsidian 插件

> 轻量级流程图绘制插件，在 Obsidian 中直接创建和编辑 `.simpledraw` 文件。
> A lightweight flowchart drawing plugin that creates and edits `.simpledraw` files directly in Obsidian.

## 功能 Features

- **文本框 Textboxes**：支持矩形/椭圆/菱形形状、Markdown 渲染、填充开关、竖排文字、字号调整。
- Rectangle/ellipse/diamond shapes, Markdown rendering, fill toggle, vertical text, font size adjustment.
- **箭头 Arrows**：正交路由避让、4 种箭头形状、虚线/实线、首尾箭头显隐。
- Orthogonal routing with obstacle avoidance, 4 arrow shapes, dashed/solid, start/end arrow toggles.
- **交互 Interaction**：拖拽移动、角点缩放、框选、吸附对齐、撤销/重做。
- Drag to move, corner resize, box select, snap alignment, undo/redo.
- **导出 Export**：PNG 导出（DOM 截图，所见即所得），支持网格和透明背景。
- PNG export (DOM screenshot, WYSIWYG) with grid and transparent background options.
- **编辑 Editing**：Markdown 快捷键（加粗/斜体/代码/链接/公式等）。
- Markdown shortcut keys (bold/italic/code/link/math, etc.).
- **多语言 i18n**：中文 / English。

## 安装 Installation

复制 `main.js`、`manifest.json`、`styles.css`(非必须) 到 `.obsidian/plugins/simple-draw/`。
Copy these files into `.obsidian/plugins/simple-draw/`.

## 使用 Usage

在文件夹菜单中右键点击「插入 SimpleDraw」创建 `.simpledraw` 文件，或通过点击左侧工具栏图标新建。工具栏支持插入文本框、箭头、定位视图、清空画布、吸附切换。
Right-click a folder → "New SimpleDraw", or use the Ribbon icon. The toolbar provides insert textbox/arrow, fit view, clear canvas, and snap toggle.
