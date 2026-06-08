# SimpleDraw Obsidian Plugin — 更新日志 v1.6.0 → v1.7.2

## 概述

v1.7.2 清理了社区审核 Warning，修复了未使用 import、废弃 API、command ID 等问题，并修复了编辑框 auto-grow 后位置不刷新的 bug。

---

## 改动清单

| 改动 | 文件 | 说明 |
|------|------|------|
| 移除未使用 import | `src/engine.ts` | `ViewState`, `GRID_SIZE`, `ANCHOR_SIZE`, `DEFAULT_TEXTBOX_WIDTH/HEIGHT` |
| 移除未使用 import | `src/main.ts` | `MarkdownView`, `TFile`, `Notice`, `SimpleDrawData` |
| 废弃 API | `src/engine.ts:712,736` | `substr(2,5)` → `substring(2,7)` |
| Command ID | `src/main.ts:37` | `'create-simple-draw'` → `'new-drawing'` |
| 版本号 | — | 1.6.0 → 1.7.2 |
| 编辑框位置 | `src/view.ts` | auto-grow 后重新定位 + 输入时实时跟随 + 使用实际高度计算 |

---

## 修改文件统计

| 文件 | 改动行数 |
|------|---------|
| `src/engine.ts` | -8 行 |
| `src/main.ts` | -5 行 |
| `src/view.ts` | +4 行 |
| `manifest.json` | +1 行 / -1 行 |
| `main.js` | 自动 |

---

## 版本

- 当前版本：1.7.2
- 此前版本：1.6.0
