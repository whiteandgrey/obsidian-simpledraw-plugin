# SimpleDraw Obsidian Plugin — 更新日志 v1.5.3 → v1.5.4

## 概述

v1.5.4 将线段标签的命中检测重构为与普通文本框一致的**坐标碰撞机制**，并修复了 `insertBefore` 每帧移动标签 DOM 节点导致浏览器无法生成 dblclick 事件的严重 bug。同时修复了 `closeEditors` 误隐藏标签的问题。

---

## 改动清单

### 1. 线段标签命中检测重构为坐标碰撞

**哲学**：线段标签底层应被当作"轻量文本框"对待，使用与 `getElementAt`/`isPointInElement` 完全同思路的坐标碰撞检测，而非 DOM 查询。

**新增方法**（`engine.ts`）：
- `getLabelAt(x, y) → ArrowData | null` — 逆序遍历所有 `labelVisible=true` 的箭头，计算标签边界盒，检查点是否落在盒内
- `isPointInLabel(arrow, x, y) → boolean` — 精确矩形碰撞（有 `labelWidth/Height` 时）或估算碰撞（140×36）

### 2. 修复 `insertBefore` 破坏双击（关键修复）

**根因**：v1.5.3 在 `renderArrows()` 中对每个锚定标签执行 `insertBefore` 以跟随箭头 z-order。每次鼠标事件后的异步渲染都会移动标签的 DOM 树位置，浏览器在两次单击间检测到 DOM 移动，**判定两次点击落在不同元素上 → 不生成 dblclick 事件**。

**修复**：
- 删除 `renderArrows()` 中的 `insertBefore` 逻辑，标签 DOM 不再每帧移动
- `handleDefaultMouseDown()` 实现**逻辑双击**：第二次单击已选中的标签直接打开编辑器，无需依赖浏览器的 dblclick 事件

```typescript
const labelArrow = this.engine.getLabelAt(pos.x, pos.y);
if (labelArrow) {
    if (this.engine.selectedIds.has(labelArrow.id)) {
        // 箭头已选中 → 第二次单击 → 逻辑双击 → 打开编辑器
        this.startArrowLabelEditor(labelArrow.id);
    } else {
        // 首次单击 → 选中箭头（与普通文本框行为一致）
        this.engine.selectElement(labelArrow.id, additive);
        this.requestRender();
    }
    return;
}
```

- `onDblClick()` 保留 `getLabelAt` 作为兜底（浏览器仍能正常触达 dblclick 的少数场景）

### 3. 修复 `closeEditors` 误隐藏标签

将 `closeEditors()` 中自动 `labelVisible=false` 的行为移至 ✓ 确认按钮内，使其仅在用户显式确认时触发。

---

## 行为对比

| 操作 | 效果 |
|------|------|
| 单击标签文字 | 选中父箭头（选中框 + resize 角点） |
| 再次单击标签文字 | 打开标签编辑器（逻辑双击，不依赖 dblclick） |
| 双击线段 | `getElementAt` → `showArrowEditor` |
| 双击文本框 | `getElementAt` → `startEditingTextbox` |

---

## 修改文件统计

| 文件 | 改动 | 说明 |
|------|------|------|
| `src/engine.ts` | +25 行 | 新增 getLabelAt / isPointInLabel |
| `src/view.ts` | ~30 行 | 逻辑双击 + 删除 insertBefore + closeEditors 去 auto-hide |
| `manifest.json` | +1 行 / -1 行 | 版本号 1.5.3 → 1.5.4 |
| `main.js` | 自动 | 构建产物 |

---

## 版本

- 当前版本：1.5.4
- 此前版本：1.5.3
