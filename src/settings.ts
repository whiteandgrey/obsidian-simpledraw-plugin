import { t } from './locale';

export type ArrowShape = 'triangle' | 'open-triangle' | 'v-shape' | 'circle';

export function getArrowShapes(): { value: ArrowShape; label: string }[] {
    return [
        { value: 'triangle', label: t('arrowShape.triangle') },
        { value: 'open-triangle', label: t('arrowShape.open-triangle') },
        { value: 'v-shape', label: t('arrowShape.v-shape') },
        { value: 'circle', label: t('arrowShape.circle') },
    ];
}

export type TextShortcutAction = 'bold' | 'italic' | 'strikethrough' | 'code' | 'link' | 'highlight' | 'inline-math' | 'display-math';

export function getShortcutActions(): { value: TextShortcutAction; label: string }[] {
    return [
        { value: 'bold', label: t('shortcutAction.bold') },
        { value: 'italic', label: t('shortcutAction.italic') },
        { value: 'strikethrough', label: t('shortcutAction.strikethrough') },
        { value: 'code', label: t('shortcutAction.code') },
        { value: 'link', label: t('shortcutAction.link') },
        { value: 'highlight', label: t('shortcutAction.highlight') },
        { value: 'inline-math', label: t('shortcutAction.inline-math') },
        { value: 'display-math', label: t('shortcutAction.display-math') },
    ];
}

export function actionToMarkdown(action: TextShortcutAction, sel: string): { wrap: string; prompt?: { label: string; placeholder: string } } {
    switch (action) {
        case 'bold': return { wrap: '**' };
        case 'italic': return { wrap: '*' };
        case 'strikethrough': return { wrap: '~~' };
        case 'code': return { wrap: '`' };
        case 'highlight': return { wrap: '==' };
        case 'link': return {
            wrap: '',
            prompt: { label: t('link.prompt.label'), placeholder: t('link.prompt.placeholder') },
        };
        case 'inline-math': return { wrap: '$' };
        case 'display-math': return { wrap: '$$' };
    }
}

export interface ShortcutBinding {
    ctrl: boolean;
    shift: boolean;
    alt: boolean;
    key: string;
    action: TextShortcutAction;
}

function shortcutKey(b: ShortcutBinding): string {
    const parts: string[] = [];
    if (b.ctrl) parts.push('Ctrl');
    if (b.shift) parts.push('Shift');
    if (b.alt) parts.push('Alt');
    parts.push(b.key.toUpperCase());
    return parts.join('+');
}

export function bindingLabel(b: ShortcutBinding): string {
    return shortcutKey(b);
}

export const DEFAULT_SHORTCUTS: ShortcutBinding[] = [
    { ctrl: true, shift: true,  alt: false, key: 'b', action: 'bold' },
    { ctrl: true, shift: true,  alt: false, key: 'i', action: 'italic' },
    { ctrl: true, shift: true,  alt: false, key: 'u', action: 'strikethrough' },
    { ctrl: true, shift: true,  alt: false, key: 'c', action: 'code' },
    { ctrl: true, shift: true,  alt: false, key: 'k', action: 'link' },
    { ctrl: true, shift: true,  alt: false, key: 'h', action: 'highlight' },
    { ctrl: true, shift: true,  alt: false, key: 'm', action: 'inline-math' },
    { ctrl: true, shift: true,  alt: true,  key: 'm', action: 'display-math' },
];

export interface SimpleDrawSettings {
    showGrid: boolean;
    gridSize: number;
    arrowStrokeWidth: number;
    arrowHeadSize: number;
    arrowShape: ArrowShape;
    shortcuts: ShortcutBinding[];
    language: 'zh' | 'en';
    snapEnabled: boolean;
    showAnchorDots: boolean;
    textboxDefaultFontSize: number;
}

export const DEFAULT_SETTINGS: SimpleDrawSettings = {
    showGrid: true,
    gridSize: 20,
    arrowStrokeWidth: 2,
    arrowHeadSize: 10,
    arrowShape: 'triangle',
    shortcuts: DEFAULT_SHORTCUTS,
    language: 'zh',
    snapEnabled: true,
    showAnchorDots: false,
    textboxDefaultFontSize: 16,
};
