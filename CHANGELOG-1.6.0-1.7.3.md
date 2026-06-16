# SimpleDraw Obsidian Plugin — 更新日志 v1.6.0 → v1.7.3

## 概述

v1.7.3 修复了图片拖拽导致鼠标变为手型的问题。

---

## 改动清单

| 改动 | 文件 | 说明 |
|------|------|------|
| 阻止图片拖拽 | `src/view.ts` | `renderTextboxDOM` 中 Markdown 渲染后，给 `<img>` 设置 `webkitUserDrag:none;userSelect:none;pointerEvents:none` |
| 版本号 | — | 1.7.2 → 1.7.3 |

---

## 修改文件统计

| 文件 | 改动行数 |
|------|---------|
| `src/view.ts` | +8 行 |
| `manifest.json` | +1 行 / -1 行 |
| `main.js` | 自动 |

---

## 版本

- 当前版本：1.7.3
- 此前版本：1.6.0
