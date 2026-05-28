// Bilingual support (Chinese / English)

export type Language = 'zh' | 'en';

let currentLang: Language = 'zh';

export function setLanguage(lang: Language): void {
    currentLang = lang;
}

export function getCurrentLang(): Language {
    return currentLang;
}

export function t(key: string, vars?: Record<string, string>): string {
    const dict = currentLang === 'en' ? en : zh;
    let text = dict[key] ?? key;
    if (vars) {
        for (const [k, v] of Object.entries(vars)) {
            text = text.replace(`{${k}}`, v);
        }
    }
    return text;
}

const zh: Record<string, string> = {
    // Settings
    'settings.title': 'SimpleDraw 设置',
    'settings.showGrid.name': '显示画板纹路',
    'settings.showGrid.desc': '在画板上显示网格纹路，方便感知画板拖拽与放大缩小',
    'settings.arrowStrokeWidth.name': '箭头线粗细',
    'settings.arrowStrokeWidth.desc': '设置箭头线条的宽度（1-5像素）',
    'settings.arrowHeadSize.name': '箭头大小',
    'settings.arrowHeadSize.desc': '设置箭头首尾的大小（6-20像素）',
    'settings.arrowShape.name': '箭头形状',
    'settings.arrowShape.desc': '选择箭头首尾的形状样式',
    'settings.language.name': '语言',
    'settings.language.desc': '选择界面显示语言',
    'settings.shortcuts.header': '文本编辑快捷键',
    'settings.shortcuts.add': '添加快捷键',
    'settings.shortcuts.delete': '删除',
    'settings.shortcuts.recording': '请按组合键...',
    'settings.shortcuts.keyLabel': '按键: ',
    'settings.shortcuts.confirm': '确认',
    'settings.shortcuts.cancel': '取消',

    // Arrow shapes
    'arrowShape.triangle': '实心三角',
    'arrowShape.open-triangle': '空心三角',
    'arrowShape.v-shape': 'V型',
    'arrowShape.circle': '圆点',

    // Shortcut actions
    'shortcutAction.bold': '加粗',
    'shortcutAction.italic': '斜体',
    'shortcutAction.strikethrough': '删除线',
    'shortcutAction.code': '代码',
    'shortcutAction.link': '链接',
    'shortcutAction.highlight': '高亮标记',
    'shortcutAction.inline-math': '行内公式',
    'shortcutAction.display-math': '行外公式',

    // Link prompt
    'link.prompt.label': '输入链接 URL',
    'link.prompt.placeholder': 'https://...',
    'link.fallbackText': '链接',

    // Main (ribbon, commands, menus)
    'ribbon.insert': '插入 SimpleDraw',
    'command.create': '创建新的 SimpleDraw',
    'fileMenu.insert': '插入 SimpleDraw',
    'leafMenu.export': '导出为 PNG',

    // Toolbar
    'toolbar.insertTextbox': '插入文本框',
    'toolbar.insertArrow': '插入箭头',
    'toolbar.fitView': '定位所有元素视图',
    'toolbar.clear': '清空画板',
    'toolbar.toggleSnap': '吸附对齐切换',

    // Direction menu
    'directionMenu.label': '箭头默认方向',

    // Context menu
    'contextMenu.bringToFront': '置顶',
    'contextMenu.sendToBack': '置底',
    'contextMenu.unlock': '🔓 解锁',

    // Textbox editor
    'textboxEditor.toggleVisibility': '显隐切换 (边框+填充)',
    'textboxEditor.toggleFill': '填充切换',
    'textboxEditor.align.top': '靠上',
    'textboxEditor.align.middle': '垂直居中',
    'textboxEditor.align.bottom': '靠下',
    'textboxEditor.align.left': '靠左',
    'textboxEditor.align.center': '水平居中',
    'textboxEditor.align.right': '靠右',
    'textboxEditor.writingMode': '竖排文字切换',
    'textboxEditor.writingModeLabel': '竖',
    'textboxEditor.shape.rectangle': '矩形',
    'textboxEditor.shape.ellipse': '椭圆形',
    'textboxEditor.shape.diamond': '菱形',
    'textboxEditor.confirm': '确认',
    'textboxEditor.fontSize.shrink': '缩小字体',
    'textboxEditor.fontSize.grow': '放大字体',
    'textboxEditor.fontSize.reset': '重置字体大小',
    'textboxEditor.lock': '锁定文本框',
    'textboxEditor.unlock': '解锁文本框',

    // Arrow editor
    'arrowEditor.toggleStart': '尾部箭头显隐切换',
    'arrowEditor.toggleEnd': '首部箭头显隐切换',
    'arrowEditor.toggleDash': '实线/虚线切换',
    'arrowEditor.toggleLabel': '文字框开关切换',
    'arrowEditor.delete': '删除',
    'arrowLabelEditor.confirm': '确认',
    'arrowLabelEditor.placeholder': '请输入 markdown 文本',

    // Export modal
    'export.title': '导出为 PNG',
    'export.path.name': '保存路径',
    'export.path.desc': 'PNG 文件的保存路径（vault 相对路径 或 系统绝对路径）',
    'export.path.browse': '浏览...',
    'export.grid.name': '显示网格',
    'export.grid.desc': '导出图片中是否包含画板网格',
    'export.transparent.name': '透明背景',
    'export.transparent.desc': '导出图片背景为透明（仅保留绘制元素）',
    'export.exportBtn': '导出',
    'export.cancelBtn': '取消',

    // Collapsible section headers
    'settings.section.basic': '基础设置',
    'settings.section.arrow': '箭头设置',
    'settings.section.textbox': '文本框设置',
    'settings.section.shortcuts': '快捷键',
    'settings.section.snap': '吸附功能',

    // New settings
    'settings.showAnchorDots.name': '显示箭头连接点',
    'settings.showAnchorDots.desc': '在箭头与文本框连接处显示小圆点标记',
    'settings.textboxDefaultFontSize.name': '默认字号',
    'settings.textboxDefaultFontSize.desc': '新建文本框的默认字体大小（8-72px）',

    'settings.anchorScheme.name': '锚点方案',
    'settings.anchorScheme.desc': '选择文本框的锚点布局方案',
    'settings.anchorScheme.scheme1': '方案一：角点 + 边中点（8锚点）',
    'settings.anchorScheme.scheme2': '方案二：边中点 + 四分之一点（12锚点）',
    'settings.snapPreviewRadius.name': '吸附预览圆圈大小',
    'settings.snapPreviewRadius.desc': '箭头插入模式下吸附预览圆圈的大小（4-20px）',

    // Notices
    'notice.emptyCanvas': '画板为空，无内容可导出',
    'notice.exported': '已导出 {name}',

    // Language options
    'language.zh': '中文',
    'language.en': 'English',
};

const en: Record<string, string> = {
    // Settings
    'settings.title': 'SimpleDraw Settings',
    'settings.showGrid.name': 'Show Grid',
    'settings.showGrid.desc': 'Display grid lines on canvas for easier pan and zoom navigation',
    'settings.arrowStrokeWidth.name': 'Arrow Stroke Width',
    'settings.arrowStrokeWidth.desc': 'Set the width of arrow lines (1-5px)',
    'settings.arrowHeadSize.name': 'Arrow Head Size',
    'settings.arrowHeadSize.desc': 'Set the size of arrow heads (6-20px)',
    'settings.arrowShape.name': 'Arrow Shape',
    'settings.arrowShape.desc': 'Select the arrow head shape style',
    'settings.language.name': 'Language',
    'settings.language.desc': 'Select the display language',
    'settings.shortcuts.header': 'Text Editing Shortcuts',
    'settings.shortcuts.add': 'Add Shortcut',
    'settings.shortcuts.delete': 'Delete',
    'settings.shortcuts.recording': 'Press key combination...',
    'settings.shortcuts.keyLabel': 'Key: ',
    'settings.shortcuts.confirm': 'Confirm',
    'settings.shortcuts.cancel': 'Cancel',

    // Arrow shapes
    'arrowShape.triangle': 'Filled Triangle',
    'arrowShape.open-triangle': 'Open Triangle',
    'arrowShape.v-shape': 'V-Shape',
    'arrowShape.circle': 'Circle',

    // Shortcut actions
    'shortcutAction.bold': 'Bold',
    'shortcutAction.italic': 'Italic',
    'shortcutAction.strikethrough': 'Strikethrough',
    'shortcutAction.code': 'Code',
    'shortcutAction.link': 'Link',
    'shortcutAction.highlight': 'Highlight',
    'shortcutAction.inline-math': 'Inline Math',
    'shortcutAction.display-math': 'Display Math',

    // Link prompt
    'link.prompt.label': 'Enter link URL',
    'link.prompt.placeholder': 'https://...',
    'link.fallbackText': 'link',

    // Main (ribbon, commands, menus)
    'ribbon.insert': 'New SimpleDraw',
    'command.create': 'Create New SimpleDraw',
    'fileMenu.insert': 'New SimpleDraw',
    'leafMenu.export': 'Export as PNG',

    // Toolbar
    'toolbar.insertTextbox': 'Insert Textbox',
    'toolbar.insertArrow': 'Insert Arrow',
    'toolbar.fitView': 'Fit to View',
    'toolbar.clear': 'Clear Canvas',
    'toolbar.toggleSnap': 'Toggle Snap Alignment',

    // Direction menu
    'directionMenu.label': 'Arrow Direction',

    // Context menu
    'contextMenu.bringToFront': 'Bring to Front',
    'contextMenu.sendToBack': 'Send to Back',
    'contextMenu.unlock': '🔓 Unlock',

    // Textbox editor
    'textboxEditor.toggleVisibility': 'Toggle Visibility (Border+Fill)',
    'textboxEditor.toggleFill': 'Toggle Fill',
    'textboxEditor.align.top': 'Align Top',
    'textboxEditor.align.middle': 'Middle',
    'textboxEditor.align.bottom': 'Align Bottom',
    'textboxEditor.align.left': 'Align Left',
    'textboxEditor.align.center': 'Center',
    'textboxEditor.align.right': 'Align Right',
    'textboxEditor.writingMode': 'Toggle Vertical Text',
    'textboxEditor.writingModeLabel': '文',
    'textboxEditor.shape.rectangle': 'Rectangle',
    'textboxEditor.shape.ellipse': 'Ellipse',
    'textboxEditor.shape.diamond': 'Diamond',
    'textboxEditor.confirm': 'Done',
    'textboxEditor.fontSize.shrink': 'Decrease Font',
    'textboxEditor.fontSize.grow': 'Increase Font',
    'textboxEditor.fontSize.reset': 'Reset Font Size',
    'textboxEditor.lock': 'Lock Textbox',
    'textboxEditor.unlock': 'Unlock Textbox',

    // Arrow editor
    'arrowEditor.toggleStart': 'Toggle Start Arrow',
    'arrowEditor.toggleEnd': 'Toggle End Arrow',
    'arrowEditor.toggleDash': 'Toggle Solid/Dashed',
    'arrowEditor.toggleLabel': 'Toggle Label',
    'arrowEditor.delete': 'Delete',
    'arrowLabelEditor.confirm': 'Done',
    'arrowLabelEditor.placeholder': 'Enter markdown text',

    // Export modal
    'export.title': 'Export as PNG',
    'export.path.name': 'Save Path',
    'export.path.desc': 'Save path for the PNG file (vault relative or absolute system path)',
    'export.path.browse': 'Browse...',
    'export.grid.name': 'Show Grid',
    'export.grid.desc': 'Include grid lines in exported image',
    'export.transparent.name': 'Transparent Background',
    'export.transparent.desc': 'Export with transparent background (drawing elements only)',
    'export.exportBtn': 'Export',
    'export.cancelBtn': 'Cancel',

    // Collapsible section headers
    'settings.section.basic': 'Basic',
    'settings.section.arrow': 'Arrow',
    'settings.section.textbox': 'Textbox',
    'settings.section.shortcuts': 'Shortcuts',
    'settings.section.snap': 'Snap',

    // New settings
    'settings.showAnchorDots.name': 'Show Anchor Dots',
    'settings.showAnchorDots.desc': 'Show small dots at arrow connection points',
    'settings.textboxDefaultFontSize.name': 'Default Font Size',
    'settings.textboxDefaultFontSize.desc': 'Default font size for new textboxes (8-72px)',

    'settings.anchorScheme.name': 'Anchor Scheme',
    'settings.anchorScheme.desc': 'Select the anchor point layout scheme for textboxes',
    'settings.anchorScheme.scheme1': 'Scheme 1: Corners + Edge Midpoints (8 anchors)',
    'settings.anchorScheme.scheme2': 'Scheme 2: Edge Midpoints + Quarter Points (12 anchors)',
    'settings.snapPreviewRadius.name': 'Snap Preview Circle Size',
    'settings.snapPreviewRadius.desc': 'Size of the snap preview circle in arrow insert mode (4-20px)',

    // Notices
    'notice.emptyCanvas': 'Canvas is empty, nothing to export',
    'notice.exported': 'Exported {name}',

    // Language options
    'language.zh': '中文',
    'language.en': 'English',
};
