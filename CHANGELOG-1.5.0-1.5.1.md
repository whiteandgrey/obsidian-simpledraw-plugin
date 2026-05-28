# SimpleDraw Obsidian Plugin — 更新日志 v1.5.0 → v1.5.1

## 概述

v1.5.1 修复了线段文字标签功能的三个交互问题：按钮图标优化、编辑区复制粘贴被拦截、无内容时无法定位标签位置。

---

## 改动清单

### 1. 箭头编辑器按钮图标优化

**文件**：`src/view.ts` — `showArrowEditor()`

| 按钮 | 修改前 | 修改后 | 理由 |
|------|--------|--------|------|
| 文字框开关 | `🏷` | `T` | 与工具栏「插入文本框」按钮风格一致 |
| 删除 | `🗑` | `✕` | 与工具栏「清空画板」按钮风格一致 |

### 2. 标签编辑器中的复制粘贴被拦截

**根因**：`onKeyDown()` 中 Ctrl+C / Ctrl+V 的判断条件仅检查了 `editingTextboxId` 和 `editingArrowId`，**未检查** `labelEditorArrowId`，导致画布层拦截了键盘事件，textrea 无法收到。

**修复**：`src/view.ts` `onKeyDown()` — 所有涉及编辑区判定的条件（Ctrl+Z/Ctrl+Shift+Z/Ctrl+Z 替代/Ctrl+C/Ctrl+V）均补充 `|| this.labelEditorArrowId`。

### 3. 无内容时显示占位提示 + 空内容自动关闭

**3.1 画布占位提示** — `src/view.ts` `renderArrows()`

标签 `labelVisible = true` 但内容为空时，不再跳过渲染。画布上以**半透明灰色**显示占位文本，便于用户定位标签位置：

```
[箭头路径]
    ↓
（请输入 markdown 文本） ← 灰色半透明
```

当用户输入真实内容后，占位文本自动被 Markdown 渲染结果替换。

**3.2 textarea 占位** — `src/view.ts` `startArrowLabelEditor()`

编辑器 textarea 设置 `placeholder` 属性，提示用户输入内容。

**3.3 空内容自动关闭** — `src/view.ts` `closeEditors()`

关闭编辑器时，若 textarea 内容为空（`!value.trim()`），自动将 `arrow.labelVisible` 设为 `false`。

**3.4 翻译键** — `src/locale.ts`

| 键 | 中文 | English |
|----|------|---------|
| `arrowLabelEditor.placeholder` | 请输入 markdown 文本 | Enter markdown text |

---

## 修改文件统计

| 文件 | 改动 | 说明 |
|------|------|------|
| `src/locale.ts` | +4 行 | 2 个新翻译键（中英各 1） |
| `src/view.ts` | ~20 行 | 按钮文字 + onKeyDown 补充 + 渲染占位 + placeholder + 空内容自动关闭 |
| `main.js` | 自动 | 构建产物 |

---

## 版本

- 当前版本：1.5.1
- 此前版本：1.5.0
