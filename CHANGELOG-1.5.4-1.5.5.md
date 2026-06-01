# SimpleDraw Obsidian Plugin — 更新日志 v1.5.4 → v1.5.5

## 概述

v1.5.5 修复了空内容未自动隐藏标签、重新输入文字变灰色两个 bug。

---

## 改动清单

### 1. 空内容自动隐藏标签

**问题**：删空标签内容后，`labelVisible` 仍为 `true`（仅✓按钮中 auto-hide，Escape/点击别处未处理），标签仍显示灰色占位符。

**修复**：将 auto-hide 逻辑恢复到 `closeEditors()` 中，无论通过何种方式关闭编辑器，空内容都会自动隐藏标签。✓ 确认按钮简化，冗余的 auto-hide 代码删除。

### 2. 重新输入文字变灰色

**问题**：`renderArrows()` 中为空内容设置了占位符的 inline 样式（`opacity: 0.5`、`color: var(--text-muted)`），但从未清除。即使后续内容变为非空，新渲染的文字仍继承这些灰色半透明样式。

**修复**：在 Markdown 渲染前清除这两个样式：
```typescript
contentEl.style.opacity = '';
contentEl.style.color = '';
```

---

## 修改文件统计

| 文件 | 改动 | 说明 |
|------|------|------|
| `src/view.ts` | ~8 行 | closeEditors 恢复 auto-hide + 确认按钮简化 + 样式清除 |
| `manifest.json` | +1 行 / -1 行 | 版本号 1.5.4 → 1.5.5 |
| `main.js` | 自动 | 构建产物 |

---

## 版本

- 当前版本：1.5.5
- 此前版本：1.5.4
