# SimpleDraw Obsidian Plugin — 更新日志 v1.6.5 → v1.6.6

## 概述

v1.6.6 继续修复 `no-static-styles-assignment` 违规，将剩余动态 `style.xxx` 批量替换为 `setCssProps`。同时修复了 `will-change: transform` 导致 GPU 层降分辨率的问题。

---

## 改动清单

### 1. 修复 GPU 层降分辨率

**移除** `.simpledraw-viewport` 的 `will-change: transform`。在 Electron/Chromium 中，此属性会强制创建 GPU 合成层，某些情况下该层以低于物理像素的分辨率渲染 → 所有子元素（文本框、箭头、标签）变模糊。

**补** `.simpledraw-svg` 的 `overflow: visible`。SVG 默认 `overflow: hidden`，缺失此属性时箭头路径在视口边界被裁剪。

### 2. 批量 inline style → setCssProps

| 位置 | 说明 |
|------|------|
| `showDirectionMenu()` | 方向按钮创建改用 `simpledraw-dir-btn` CSS class + `setCssProps` 动态背景 |
| `updateDirectionButtons()` | 按钮高亮 → `setCssProps` |
| `updateMenuButtons()` | 菜单按钮状态 → `setCssProps` |
| `updateSnapButton()` | 吸附按钮状态 → `setCssProps` |
| `startEditingTextbox()` | 对齐/形状/文字方向按钮高亮 → `setCssProps` |
| `startArrowLabelEditor()` | 位置按钮/确认按钮 → `setCssProps` |
| `buildDOM()` | grid/selection 初始样式 → `setCssProps` |
| `renderSelectionBox()` | 选择框位置/显隐 → `setCssProps` |
| 各处光标变化 | 7 处 `containerEl.style.cursor` → `setCssProps` |

---

## 修改文件统计

| 文件 | 改动 |
|------|------|
| `styles.css` | `will-change` 移除 + `overflow:visible` 补充 |
| `src/view.ts` | ~60 行 style→setCssProps |
| `manifest.json` | 版本号 1.6.5 → 1.6.6 |
| `main.js` | 自动 |

---

## 版本

- 当前版本：1.6.6
- 此前版本：1.6.5
