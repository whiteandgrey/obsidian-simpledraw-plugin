# SimpleDraw Obsidian Plugin — 更新日志 v1.6.0 → v1.6.1

## 概述

v1.6.1 通过了 Obsidian 社区审核的规范检查，修复了三个 Error 级违规和多项 Warning。

---

## 改动清单

### Error 修复

| 检查项 | 问题 | 修复 |
|--------|------|------|
| `no-unsupported-api` | 使用高于 `minAppVersion: 0.15.0` 的 API | `manifest.json` → `minAppVersion: 1.0.0` |
| 设置页标题 | 使用 `createEl('h2')` 创建标题 | 改为 `new Setting().setName().setHeading()` |
| `no-static-styles-assignment` | 多处 inline style 赋值 | 迁移到 CSS class（见下方详述） |

### 其他清理

| 类型 | 修复内容 |
|------|---------|
| 未使用 import | `main.ts`: 移除 `MarkdownView, TFile, Notice, SimpleDrawData` |
| | `engine.ts`: 移除 `ViewState, GRID_SIZE, ANCHOR_SIZE, DEFAULT_TEXTBOX_WIDTH/HEIGHT` |
| | `view.ts`: 移除 `App, ShortcutBinding, AnchorType, SNAP_DISTANCE` |
| 废弃 API | `substr(2,5)` → `substring(2,7)`（`engine.ts:712,736`） |

### 迁移到 CSS class 详述

| 文件 | 原 inline line 样式 | 改为 CSS class |
|------|-----------------|---------------|
| `styles.css` | — | 新增 `.sd-settings-section/header/arrow/label/body/row/add-btn/rec-dropdown/rec-btn-row` |
| | — | 完善 `.simpledraw-container/viewport/grid/svg/elements/preview/selection/menu` |
| | — | 完善 `.simpledraw-menu-btn/small-btn` 含 `color` |
| `settingsTab.ts` | `display, alignItems, padding, cursor, gap, fontSize, fontWeight...` | 全部使用 `createDiv({ cls: '...' })` |
| `view.ts` | `buildDOM()` 中 ~40 行 redundant inline style | 全部删除，已由 CSS class 覆盖 |
| | `createMenuButton()` ~10 行 | `className: 'simpledraw-menu-btn'` |
| | `createSmallButton()` ~12 行 | `className: 'simpledraw-small-btn'` |

---

## 修改文件统计

| 文件 | 改动 |
|------|------|
| `manifest.json` | +1 行 / -1 行 |
| `styles.css` | +80 行 |
| `src/main.ts` | -5 行（移除 import） |
| `src/engine.ts` | -3 行（移除 import + substr 替换） |
| `src/settingsTab.ts` | -30 行 / +10 行 |
| `src/view.ts` | -80 行（移除 inline style + import） |
| `main.js` | 自动 |
| `CHANGELOG-1.6.0-1.6.1.md` | 新增 |

---

## 版本

- 当前版本：1.6.1
- 此前版本：1.6.0
