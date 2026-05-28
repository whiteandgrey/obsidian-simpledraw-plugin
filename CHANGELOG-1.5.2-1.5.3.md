# SimpleDraw Obsidian Plugin — 更新日志 v1.5.2 → v1.5.3

## 概述

v1.5.3 修复了线段文本显示层级不跟随线段的问题，以及编辑框 auto-grow 在重新打开后归零的问题。

---

## 改动清单

### 1. 线段文本显示层级跟随线段

**根因**：标签（`.simpledraw-arrow-label`）固定 `z-index: 22`，而锚定箭头 SVG 的层级由其 DOM 顺序决定（通过 `insertBefore` 插入到所连最高 z-order 文本框后面）。置顶/置底文本框后 `rebuildAll()` 重新排列了文本框和箭头 SVG 的顺序，但标签始终保持在最顶层。

**修复**：
- `styles.css`：移除 `.simpledraw-arrow-label { z-index: 22; }`
- `src/view.ts` 标签创建：移除 `labelEl.style.zIndex = '22'`
- `src/view.ts` 标签渲染循环：对每个锚定箭头（`connectedIds.length > 0`），用与箭头 SVG 相同的 `maxIdx/insertAfter` 逻辑，将标签 `insertBefore` 到同一个引用文本框后面

```
DOM 顺序：textboxA → arrow_A→B → label_A→B → textboxB → ...
```

标签现在完全靠 DOM 顺序决定层级，与箭头一致。

### 2. 编辑框 auto-grow 在重新打开后归零

**根因**：`textarea.value = content` 之后没有立刻触发 auto-grow，导致 textarea 始终以 `minHeight: 60px` 显示。虽然输入时 auto-grow 工作，但关闭编辑器再打开时高度恢复为 60px。

**修复**：在两个编辑器的 textarea 创建代码中，设置 value 后立即执行：
```typescript
textarea.style.height = 'auto';
textarea.style.height = Math.max(60, textarea.scrollHeight) + 'px';
```

受影响的方法：`startEditingTextbox()`（普通文本框编辑器）和 `startArrowLabelEditor()`（标签编辑器）。

---

## 修改文件统计

| 文件 | 改动 | 说明 |
|------|------|------|
| `styles.css` | -1 行 | 移除 `.simpledraw-arrow-label { z-index: 22 }` |
| `src/view.ts` | ~20 行 | 移除 inline zIndex + insertBefore DOM 定位 + 两处 auto-grow 触发 |
| `manifest.json` | +1 行 / -1 行 | 版本号 1.5.2 → 1.5.3 |
| `main.js` | 自动 | 构建产物 |

---

## 版本

- 当前版本：1.5.3
- 此前版本：1.5.2
