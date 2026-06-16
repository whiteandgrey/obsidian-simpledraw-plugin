# SimpleDraw Obsidian Plugin — 更新日志 v1.7.3 → v1.8.0

## 概述

v1.8.0 修复了编辑框 auto-grow 触发画布滚动导致菜单消失、坐标错位的严重 bug。

## 改动

| 改动 | 文件 | 说明 |
|------|------|------|
| `positionTextboxEditor` 加最大高度限制（80% 视口） | `src/view.ts` | 防止编辑器无限扩大触发 Obsidian 滚动 |
| 两个 input handler 改用内部滚动切换 | `src/view.ts` | textarea 超过允许高度时自动溢出滚动 |
| 初始化 auto-grow 同理处理 | `src/view.ts` | 打开编辑框时即限制不超过视口 |
| 恢复 overflow 为普通 inline | `src/view.ts` | 移除无效的 `!important` 修复 |
| 版本号 | — | 1.7.3 → 1.8.0 |

## 根因

编辑器无限扩大 → 超出 `containerEl` 高度 → 虽然 `overflow:hidden` 裁切了视觉溢出，但 Obsidian 的焦点管理系统检测到 textarea 的 bounding box 超出视口 → 强制滚动工作区 → 菜单消失、坐标错位。

**修复**：编辑器最大高度限制在视口高度的 80%，textarea 超过该值时启用内部滚动。编辑器永远不会超出容器边界。

## 修改文件统计

| 文件 | 改动行数 |
|------|---------|
| `src/view.ts` | ~30 行 |
| `manifest.json` | +1 / -1 |
| `main.js` | 自动 |

## 版本

- 当前版本：1.8.0
- 此前版本：1.7.3
