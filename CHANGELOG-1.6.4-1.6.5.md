# SimpleDraw Obsidian Plugin — 更新日志 v1.6.4 → v1.6.5

## 概述

v1.6.5 继续修复 Obsidian 社区审查的 `no-static-styles-assignment` 违规，将大量 `el.style.xxx = 'yyy'` 替换为 CSS class 或 `setCssProps()` API。

## 改动清单

### 1. CSS class 新增

`styles.css` 新增 `.simpledraw-editor-overlay`、`.simpledraw-editor-toolbar`、`.simpledraw-editor-textarea`、`.simpledraw-dir-menu/btn`、`.simpledraw-textbox/inner/content/resize-handle/lock-icon` 等 CSS class，覆盖编辑器覆盖层、方向菜单、文本框内部元素的静态样式。

### 2. view.ts 批量修复

| 方法 | 改动 |
|------|------|
| `startEditingTextbox()` | 编辑器容器使用 `simpledraw-editor-overlay` class；toolbar 移除冗余 inline style；textarea 使用 `simpledraw-editor-textarea` class + `setCssProps` 动态值 |
| `showArrowEditor()` | 编辑器容器使用 `simpledraw-editor-overlay is-arrow` class；位置使用 `setCssProps` |
| `startArrowLabelEditor()` | 编辑器容器使用 `simpledraw-editor-overlay is-label` class；toolbar 简化；textarea 使用 class |
| `positionTextboxEditor()` | `style.left/top` → `setCssProps` |
| `applyTextAlignment()` | 所有 `el.style.xxx` → `el.setCssProps({ xxx })` |
| `renderTextboxDOM()` | wrapper 创建静态样式移入 CSS；wrapper 位置使用 `setCssProps`；lock icon 使用 CSS class |
| `buildDOM()` | `gridEl.top/left` 保留（动态值）；`selectionBox.display` → `setCssProps` |
| 按钮状态 | confirmBtn、alignGroup 等 → `setCssProps` |

### 3. settingsTab.ts 修复

`createCollapsibleSection()` 和 `startAddShortcut()` 中的 `style.xxx` → `setCssProps`。

---

## 修改文件统计

| 文件 | 改动行数 |
|------|---------|
| `styles.css` | +60 |
| `src/view.ts` | ~120 |
| `src/settingsTab.ts` | ~10 |
| `manifest.json` | 版本号 1.6.4 → 1.6.5 |
| `main.js` | 自动 |

---

## 版本

- 当前版本：1.6.5
- 此前版本：1.6.4
