# SimpleDraw Obsidian Plugin — 更新日志 v1.4.4 → v1.5.0

## 概述

v1.5.0 新增**线段文字标签功能**：在箭头上附加可编辑的文字标签，标签始终自动定位在箭头路径的中点，随箭头和文本框移动而自动跟随。

---

## 代码改动清单

### 1. `src/types.ts` — 数据模型扩展

**ArrowData 新增 4 个可选字段：**

| 字段 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `labelContent` | `string?` | `undefined` | 标签文本（Markdown 格式） |
| `labelVisible` | `boolean?` | `false` | 标签显隐开关 |
| `labelFontSize` | `number?` | `16` | 标签字号 |
| `labelWritingMode` | `'horizontal-tb' \| 'vertical-rl'?` | `'horizontal-tb'` | 文字书写方向 |

所有字段均为可选，兼容旧版本 `.simpledraw` 文件。

---

### 2. `src/engine.ts` — 新增路径中点算法

**新增方法 `getArrowMidpoint(arrow: ArrowData): { x: number; y: number }`**

算法：
```
1. 调用 buildArrowPath() 获取箭头路径的所有转折点
2. 计算每段路径的欧几里得距离 → 累加得到总长度
3. 从起点开始累计分段长度，找到 50% 总长度的位置
4. 在该段内按比例线性插值 → 返回精确 (x, y)
```

**设计思路对比：**

| 方案 | 描述 | 优劣 |
|------|------|------|
| 几何中点（路径包围盒） | 取路径点集 (minX+maxX)/2, (minY+maxY)/2 | 对 L/Z 形路径误差大，视觉上偏离 |
| 第一段中点 | 取第一段路径的中点 | 仅对单线段有效 |
| 路径总长度 50% 位置 ✅ | 按路径长度精确 1/2 处 | 任何路径形状均视觉自然 |
| 中间转折点 | 取路径中间的拐点 | 多段线路径不准确 |

最终采用**路径总长度 50% 位置**，因为它对 L 形、Z 形、多段线等所有箭头形态均能给出视觉上最自然的标签位置。

---

### 3. `src/view.ts` — 视图交互与渲染

#### 3.1 箭头编辑菜单新增按钮（`showArrowEditor()`）

按钮布局（共 5 个）：

```
[◀] [▶] [━] [🏷] [🗑]
  ↑    ↑    ↑    ↑    ↑
 尾   首   线   文字  删除
 部   部   型   框
 箭   箭   切   开
 头   头   换   关
```

- 点击 🏷 按钮 → 切换 `arrow.labelVisible`
- 首次开启且 `labelContent` 为空 → 直接打开标签编辑器
- 未保存历史时自动记录历史状态

#### 3.2 标签渲染（`renderArrows()` 末尾新增）

渲染流程：
```
每帧渲染循环 → renderArrows() → 渲染全部箭头路径后 →
遍历所有箭头：
  if arrow.labelVisible && arrow.labelContent:
    1. getArrowMidpoint() → 计算中点
    2. 在 elementsLayer 查找/创建 [data-arrow-label-id] 元素
    3. 定位到中点（transform: translate(-50%, -50%) 居中）
    4. 渲染 Markdown 内容
    5. 移除无效标签 DOM
```

**标签 DOM 结构：**
```html
<div class="simpledraw-arrow-label" data-arrow-label-id="ar_xxx">
  <div class="simpledraw-arrow-label-content">
    <!-- Obsidian MarkdownRenderer 渲染结果 -->
  </div>
</div>
```

**跟随机制**：标签位置在 `render()` 循环中每帧重算，连接文本框移动/缩放 → `notifyChange()` → `requestRender()` → `renderArrows()` → `getArrowMidpoint()` 返回新坐标 → 自动更新。无需额外事件监听。

#### 3.3 简化编辑器（`startArrowLabelEditor()`）

**交互触发方式（两种）：**
1. 箭头编辑菜单中点击 🏷 后首次开启
2. 双击已可见的标签文本

**编辑器 UI 对比：**

| 功能 | 完整文本框编辑器 | 箭头标签编辑器 |
|------|----------------|----------------|
| textarea | ✓ | ✓ |
| 字号 A- | ✓ | ✓ |
| 字号 A+ | ✓ | ✓ |
| 字号 R | ✓ | ✓ |
| ✓ 确认 | ✓ | ✓ |
| 显隐切换 👁 | ✓ | ✗ |
| 填充切换 ▣/□ | ✓ | ✗ |
| 垂直对齐 (⊤⊟⊥) | ✓ | ✗ |
| 水平对齐 (⊏⊜⊐) | ✓ | ✗ |
| 竖排文字 竖 | ✓ | ✗ |
| 形状 (□○◇) | ✓ | ✗ |
| 🔒 锁定 | ✓ | ✗ |
| 插入图片（桌面版独有） | ✗ | ✗ |

**编辑器定位**：在箭头中点的屏幕坐标附近浮动（如靠边缘则自动调整方向）。

#### 3.4 `closeEditors()` 扩展

新增标签编辑器的清理逻辑：
- 读取 textarea 内容 → 写入 `arrow.labelContent`
- 移除编辑器的 DOM 元素
- 重置 `labelEditorArrowId` / `labelEditorEl`

#### 3.5 `onDblClick()` 改造

在原有检测逻辑前新增：

```typescript
if (target.closest('[data-arrow-label-id]')) {
    startArrowLabelEditor(arrowId);
    return;
}
```

确保双击标签文本直接进入编辑，不与下方箭头碰撞检测冲突。

#### 3.6 鼠标事件跳过（`onMouseDown()`）

在 skip 检测列表中新增：
- `.simpledraw-arrow-label` — 避免标签拖拽干扰
- `.simpledraw-arrow-label-editor` — 编辑器覆盖层

#### 3.7 剪贴板复制扩展（`pasteElements()`）

复制箭头时同步复制标签属性：
- `arrow.labelContent`
- `arrow.labelVisible`
- `arrow.labelFontSize`

---

### 4. `src/styles.css` — 标签样式

```css
.simpledraw-arrow-label {
    position: absolute;
    pointer-events: auto;
    background: transparent;  /* 无填充 */
    border: none;             /* 无边框 */
    text-align: center;
    cursor: pointer;
    z-index: 22;
    max-width: 200px;
    word-break: break-word;
}
.simpledraw-arrow-label-content p { margin: 0; background: transparent; }
```

默认透明背景、无边框、文字居中。

---

### 5. `src/locale.ts` — 新翻译键

| 键 | 中文 | English |
|----|------|---------|
| `arrowEditor.toggleLabel` | 文字框开关切换 | Toggle Label |
| `arrowLabelEditor.confirm` | 确认 | Done |

---

## 最终功能呈现

### 创建流程

```
1. 创建箭头连接两个文本框
2. 双击箭头 → 弹出 5 按钮编辑栏
3. 点击 🏷 按钮 → 线段中点出现透明文字框
4. 首次开启自动进入编辑，输入任意 Markdown 文字
5. 确认后，文字始终跟随箭头移动
6. 再次点击 🏷 → 隐藏文字（保留内容）
7. 双击可见文字 → 重新编辑
```

### 视觉效果

```
  ┌─────────┐          ┌─────────┐
  │ 开始    │          │ 结束    │
  └────┬────┘          └────▲────┘
       │ "转到步骤2"       │
       └───────────────────┘
          (箭头中点标签)
```

标签在箭头路径的中点居中显示，无边框无填充，纯文本叠加在箭头上方。

---

## 版本

- 当前版本：1.5.0
- 此前版本：1.4.4
- 下次更新：TBD
