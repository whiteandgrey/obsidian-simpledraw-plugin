# SimpleDraw Obsidian Plugin — 更新日志 v1.5.6 → v1.5.7

## 概述

v1.5.7 在设置的"文本框设置"栏中新增"线段标签默认字号"选项，允许用户自定义线段标签的默认字体大小。

---

## 改动清单

### 1. 新增"线段标签默认字号"设置

| 文件 | 改动 | 说明 |
|------|------|------|
| `src/settings.ts` | +2 行 | `SimpleDrawSettings` 增加 `labelDefaultFontSize: number`，默认值 `16` |
| `src/locale.ts` | +4 行 | 新增 `settings.labelDefaultFontSize.name/desc` 中英文翻译 |
| `src/settingsTab.ts` | +10 行 | 文本框设置栏末尾添加滑块控件（范围 8-72，步进 2） |
| `src/view.ts` | ~10 行 | 所有硬编码的 `?? 16` 替换为 `?? this.settings.labelDefaultFontSize`；重置按钮使用设置值 |

---

## 修改文件统计

| 文件 | 改动 |
|------|------|
| `src/settings.ts` | +2 行 |
| `src/locale.ts` | +4 行 |
| `src/settingsTab.ts` | +10 行 |
| `src/view.ts` | ~10 行 |
| `manifest.json` | +1 行 / -1 行 |
| `main.js` | 自动 |

---

## 版本

- 当前版本：1.5.7
- 此前版本：1.5.6
