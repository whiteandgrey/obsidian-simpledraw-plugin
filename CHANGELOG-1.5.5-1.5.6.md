# SimpleDraw Obsidian Plugin — 更新日志 v1.5.5 → v1.5.6

## 概述

v1.5.6 修复了标签层级不再跟随箭头的问题，同时保留双击功能。

## 改动清单

### 1. 标签层级跟随箭头

**根因**：v1.5.4 为了修复双击，将原本每帧执行的 `insertBefore` 代码块完全删除。标签退回到 `createDiv` 的默认位置（`elementsLayer` 末尾），不再跟随箭头 z-order。

**修复**：将 `insertBefore` 移入标签**首次创建**的代码块内（`if (!labelEl)` 大括号中）。创建时定位一次，后续帧不再移动 DOM 节点。

```diff
 if (!labelEl) {
     labelEl = this.elementsLayer.createDiv('simpledraw-arrow-label');
     // ... styles, content ...
+    // 仅创建时执行一次 insertBefore，定位到所连最高 z-order 文本框后面
+    insertBefore(labelEl, ref.nextSibling);
 }
 // 后续帧不移动 labelEl → 不破坏浏览器双击检测
```

`rebuildAll()` 会 `innerHTML = ''` 清除所有标签 → 下次渲染时 `!labelEl` 为 true → 重新创建 + `insertBefore` 定位 → 之后帧保持不动 → z-order 与双击同时正确。

---

## 修改文件统计

| 文件 | 改动 | 说明 |
|------|------|------|
| `src/view.ts` | +14 行 | insertBefore 移入创建块内 |
| `manifest.json` | +1 行 / -1 行 | 版本号 1.5.5 → 1.5.6 |
| `main.js` | 自动 | 构建产物 |

---

## 版本

- 当前版本：1.5.6
- 此前版本：1.5.5
