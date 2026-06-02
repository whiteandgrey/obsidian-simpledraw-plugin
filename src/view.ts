// Custom View for SimpleDraw files

import { toCanvas } from 'html-to-image';
import { TextFileView, MarkdownRenderer, WorkspaceLeaf, Notice, Modal, Setting, App, Menu } from 'obsidian';
import { SimpleDrawEngine } from './engine';
import { SimpleDrawSettings, ShortcutBinding, actionToMarkdown } from './settings';
import { t } from './locale';
import {
    SimpleDrawData, InteractionMode, ElementData, TextBoxData, ArrowData,
    AnchorType, ArrowConnection, FreePoint, ArrowDirection,
    GRID_SIZE, ANCHOR_SIZE, SNAP_DISTANCE,
    MIN_TEXTBOX_WIDTH, MIN_TEXTBOX_HEIGHT,
    DEFAULT_TEXTBOX_WIDTH, DEFAULT_TEXTBOX_HEIGHT,
    DEFAULT_DATA,
} from './types';

export const VIEW_TYPE_SIMPLEDRAW = 'simple-draw-view';

export class SimpleDrawView extends TextFileView {
    public engine: SimpleDrawEngine;
    public settings: SimpleDrawSettings;

    // DOM elements
    public containerEl: HTMLElement;
    public viewportEl: HTMLElement;
    public gridEl: HTMLElement;
    public svgLayer: SVGElement;
    public elementsLayer: HTMLElement;
    public previewLayer: HTMLElement;
    public selectionBox: HTMLElement;
    public menuEl: HTMLElement;
    public textboxEditorEl: HTMLElement | null = null;
    public arrowEditorEl: HTMLElement | null = null;
    public labelEditorArrowId: string | null = null;
    public labelEditorEl: HTMLElement | null = null;

    // Menu buttons
    public btnInsertTextbox: HTMLElement;
    public btnInsertArrow: HTMLElement;
    public btnFitView: HTMLElement;
    public btnClear: HTMLElement;
    public btnSnapToggle: HTMLElement;

    private animFrameId: number = 0;
    private needsRender: boolean = true;
    private lastCanvasMouse: { x: number; y: number } = { x: 0, y: 0 };
    private _resizeObserver: ResizeObserver | null = null;
    private _fallbackChannel: MessageChannel | null = null;

    // --- Text Formatting Shortcuts ---

    private applyFormattingShortcut(e: KeyboardEvent, ta: HTMLTextAreaElement): boolean {
        const isCtrl = e.ctrlKey || e.metaKey;
        if (!isCtrl) return false;

        const shortcuts: any[] = (this.settings as any)?.shortcuts || [];
        const key = e.key.toLowerCase();
        const code = e.code.startsWith('Key') ? e.code.slice(3).toLowerCase() : key;
        const binding = shortcuts.find(
            b => b.ctrl === isCtrl && b.shift === e.shiftKey && b.alt === e.altKey && (b.key === key || b.key === code)
        );
        if (!binding) return false;

        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();

        const el = ta;
        const start = el.selectionStart;
        const end = el.selectionEnd;
        const val = el.value;
        const sel = val.substring(start, end);
        const meta = actionToMarkdown(binding.action, sel);

        if (meta.prompt) {
            const url = window.prompt(meta.prompt.label + ':', '');
            if (!url) return true;
            const result = '[' + (sel || t('link.fallbackText')) + '](' + url + ')';
            el.value = val.substring(0, start) + result + val.substring(end);
            el.selectionStart = start;
            el.selectionEnd = start + result.length;
        } else {
            const w = meta.wrap;
            const result = w + sel + w;
            el.value = val.substring(0, start) + result + val.substring(end);
            el.selectionStart = start + w.length;
            el.selectionEnd = start + w.length + sel.length;
        }
        return true;
    }

    // Document-level capture handler for text formatting shortcuts
    private onCaptureKeyDown = (e: KeyboardEvent): void => {
        if (!this.engine?.editingTextboxId) return;
        const ta = this.textboxEditorEl?.querySelector('textarea');
        if (!ta || document.activeElement !== ta) return;
        this.applyFormattingShortcut(e, ta as HTMLTextAreaElement);
    };

    constructor(leaf: WorkspaceLeaf, settings: SimpleDrawSettings) {
        super(leaf);
        this.settings = settings;
        this.engine = new SimpleDrawEngine(settings);
    }

    // Set by the plugin after construction
    public onSettingsSave: (() => Promise<void>) | null = null;

    getViewType(): string {
        return VIEW_TYPE_SIMPLEDRAW;
    }

    getDisplayText(): string {
        return this.file?.name ?? 'SimpleDraw';
    }

    getIcon(): string {
        return 'pencil';
    }

    // --- View Data (File I/O) ---

    getViewData(): string {
        return JSON.stringify(this.engine.getData(), null, 2);
    }

    setViewData(data: string, _clear: boolean): void {
        try {
            const parsed = JSON.parse(data) as SimpleDrawData;
            if (parsed && parsed.elements && parsed.viewState) {
                // Migrate old arrows without arrowDirection
                for (const el of parsed.elements) {
                    if (el.type === 'arrow' && !(el as any).arrowDirection) {
                        (el as any).arrowDirection = 'right';
                    }
                }
                this.engine.loadData(parsed);
            } else {
                this.engine.loadData(JSON.parse(JSON.stringify(DEFAULT_DATA)));
            }
        } catch {
            this.engine.loadData(JSON.parse(JSON.stringify(DEFAULT_DATA)));
        }
        if (this.elementsLayer) {
            this.rebuildAll();
        }
    }

    clear(): void {
        this.engine.loadData(JSON.parse(JSON.stringify(DEFAULT_DATA)));
        if (this.elementsLayer) {
            this.rebuildAll();
        }
    }

    // --- Lifecycle ---

    async onOpen(): Promise<void> {
        this.buildDOM();
        this.setupEventListeners();
        this.engine.onChange = () => {
            this.requestSave();
            this.requestRender();
        };
        this.engine.onModeChange = () => {
            this.updateMenuButtons();
            if (this.engine.mode !== InteractionMode.InsertArrow) {
                this.hideDirectionMenu();
            }
            this.requestRender();
        };
        this.engine.onSelectionChange = () => {
            this.updateSelectionDisplay();
            this.requestRender();
        };
        this.engine.onEditTextbox = (id: string) => {
            this.startEditingTextbox(id);
        };
        this.engine.onEditArrow = (id: string) => {
            this.showArrowEditor(id);
        };
        this.engine.renderMarkdown = (markdown: string, el: HTMLElement, sourcePath: string) => {
            return this.renderMarkdownInElement(markdown, el, sourcePath);
        };
        if (this.file) {
            this.engine.sourcePath = this.file.path;
        }

        // Capture keydown at document level for text formatting shortcuts
        document.addEventListener('keydown', this.onCaptureKeyDown, true);

        // Ensure clean state before initial render
        this.needsRender = true;
        this.animFrameId = 0;

        // Initial render
        this.rebuildAll();

        // Start render loop
        this.startRenderLoop();
        this.containerEl.focus();
    }

    async onClose(): Promise<void> {
        if (this.animFrameId) {
            cancelAnimationFrame(this.animFrameId);
            this.animFrameId = 0;
        }
        if (this._fallbackChannel) {
            this._fallbackChannel.port1.onmessage = null;
            this._fallbackChannel = null;
        }
        this.needsRender = false;
        this.closeEditors();
        this.hideDirectionMenu();
        if (this._resizeObserver) {
            this._resizeObserver.disconnect();
            this._resizeObserver = null;
        }
        document.removeEventListener('keydown', this.onCaptureKeyDown, true);
    }

    // --- DOM Construction ---

    buildDOM(): void {
        const contentEl = this.contentEl;
        contentEl.empty();
        contentEl.style.position = 'relative';
        contentEl.style.overflow = 'hidden';
        contentEl.style.width = '100%';
        contentEl.style.height = '100%';
        contentEl.style.userSelect = 'none';

        // Container
        this.containerEl = contentEl.createDiv('simpledraw-container');
        this.containerEl.style.width = '100%';
        this.containerEl.style.height = '100%';
        this.containerEl.style.position = 'relative';
        this.containerEl.style.overflow = 'hidden';
        this.containerEl.style.cursor = 'default';
        this.containerEl.setAttribute('tabindex', '0');
        this.containerEl.focus();

        // Viewport (for pan/zoom transform)
        this.viewportEl = this.containerEl.createDiv('simpledraw-viewport');
        this.viewportEl.style.position = 'absolute';
        this.viewportEl.style.transformOrigin = '0 0';
        this.viewportEl.style.width = '100%';
        this.viewportEl.style.height = '100%';

        // Grid background
        this.gridEl = this.viewportEl.createDiv('simpledraw-grid');
        this.gridEl.style.position = 'absolute';
        this.gridEl.style.top = '-5000px';
        this.gridEl.style.left = '-5000px';
        this.gridEl.style.width = '10000px';
        this.gridEl.style.height = '10000px';
        this.gridEl.style.pointerEvents = 'none';
        this.gridEl.style.zIndex = '0';

        // SVG layer for arrows
        this.svgLayer = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        this.svgLayer.classList.add('simpledraw-svg');
        this.svgLayer.style.position = 'absolute';
        this.svgLayer.style.top = '0';
        this.svgLayer.style.left = '0';
        this.svgLayer.style.width = '100%';
        this.svgLayer.style.height = '100%';
        this.svgLayer.style.pointerEvents = 'none';
        this.svgLayer.style.overflow = 'visible';
        this.viewportEl.appendChild(this.svgLayer);

        // Elements layer for textboxes
        this.elementsLayer = this.viewportEl.createDiv('simpledraw-elements');
        this.elementsLayer.style.position = 'absolute';
        this.elementsLayer.style.top = '0';
        this.elementsLayer.style.left = '0';
        this.elementsLayer.style.width = '100%';
        this.elementsLayer.style.height = '100%';
        this.elementsLayer.style.pointerEvents = 'none';
        this.elementsLayer.style.overflow = 'visible';
        this.elementsLayer.style.zIndex = '10';

        // Preview layer (temporary rectangles, dashed lines)
        this.previewLayer = this.viewportEl.createDiv('simpledraw-preview');
        this.previewLayer.style.position = 'absolute';
        this.previewLayer.style.top = '0';
        this.previewLayer.style.left = '0';
        this.previewLayer.style.width = '100%';
        this.previewLayer.style.height = '100%';
        this.previewLayer.style.pointerEvents = 'none';

        // Selection box
        this.selectionBox = this.viewportEl.createDiv('simpledraw-selection');
        this.selectionBox.style.position = 'absolute';
        this.selectionBox.style.border = '2px dashed #4a90d9';
        this.selectionBox.style.backgroundColor = 'rgba(74, 144, 217, 0.1)';
        this.selectionBox.style.display = 'none';
        this.selectionBox.style.pointerEvents = 'none';
        this.selectionBox.style.zIndex = '30';

        // Menu bar (top-left corner, outside viewport)
        this.menuEl = this.containerEl.createDiv('simpledraw-menu');
        this.menuEl.style.position = 'absolute';
        this.menuEl.style.top = '8px';
        this.menuEl.style.left = '8px';
        this.menuEl.style.zIndex = '100';
        this.menuEl.style.display = 'flex';
        this.menuEl.style.gap = '4px';
        this.menuEl.style.background = 'var(--background-primary)';
        this.menuEl.style.border = '1px solid var(--background-modifier-border)';
        this.menuEl.style.borderRadius = '6px';
        this.menuEl.style.padding = '4px';
        this.menuEl.style.boxShadow = '0 2px 8px rgba(0,0,0,0.15)';

        this.btnInsertTextbox = this.createMenuButton('T', t('toolbar.insertTextbox'));
        this.btnInsertArrow = this.createMenuButton('→', t('toolbar.insertArrow'));
        this.btnFitView = this.createMenuButton('⊞', t('toolbar.fitView'));
        this.btnClear = this.createMenuButton('✕', t('toolbar.clear'));
        this.btnSnapToggle = this.createMenuButton('⟷', t('toolbar.toggleSnap'));

        this.menuEl.appendChild(this.btnInsertTextbox);
        this.menuEl.appendChild(this.btnInsertArrow);
        this.menuEl.appendChild(this.btnFitView);
        this.menuEl.appendChild(this.btnClear);
        this.menuEl.appendChild(this.btnSnapToggle);

        // Store references in engine
        this.engine.container = this.containerEl;
        this.engine.svgLayer = this.svgLayer;
        this.engine.elementsLayer = this.elementsLayer;
        this.engine.previewLayer = this.previewLayer;
        this.engine.selectionBox = this.selectionBox;
    }

    createMenuButton(label: string, title: string): HTMLElement {
        const btn = document.createElement('button');
        btn.className = 'simpledraw-menu-btn';
        btn.textContent = label;
        btn.title = title;
        btn.style.width = '28px';
        btn.style.height = '28px';
        btn.style.border = '1px solid transparent';
        btn.style.borderRadius = '4px';
        btn.style.background = 'transparent';
        btn.style.cursor = 'pointer';
        btn.style.display = 'flex';
        btn.style.alignItems = 'center';
        btn.style.justifyContent = 'center';
        btn.style.fontSize = '14px';
        btn.style.color = 'var(--text-normal)';
        return btn;
    }

    // --- Event Listeners ---

    setupEventListeners(): void {
        // Mouse events on container
        this.containerEl.addEventListener('mousedown', this.onMouseDown.bind(this));
        this.containerEl.addEventListener('mousemove', this.onMouseMove.bind(this));
        this.containerEl.addEventListener('mouseup', this.onMouseUp.bind(this));
        this.containerEl.addEventListener('wheel', this.onWheel.bind(this), { passive: false });
        this.containerEl.addEventListener('dblclick', this.onDblClick.bind(this));
        this.containerEl.addEventListener('contextmenu', this.onContextMenu.bind(this));

        // Keyboard events
        this.containerEl.addEventListener('keydown', this.onKeyDown.bind(this));

        // Prevent native image drag from interfering with textbox drag
        this.elementsLayer.addEventListener('dragstart', (e) => {
            e.preventDefault();
        });

        // Menu buttons
        this.btnInsertTextbox.addEventListener('click', (e) => {
            e.stopPropagation();
            this.toggleTextboxMode();
        });
        this.btnInsertArrow.addEventListener('click', (e) => {
            e.stopPropagation();
            this.toggleArrowMode();
        });
        this.btnFitView.addEventListener('click', (e) => {
            e.stopPropagation();
            this.engine.fitToView();
            this.requestRender();
        });
        this.btnClear.addEventListener('click', (e) => {
            e.stopPropagation();
            this.engine.clearCanvas();
            this.rebuildAll();
        });

        // Snap toggle button
        this.updateSnapButton();
        this.btnSnapToggle.addEventListener('click', async (e) => {
            e.stopPropagation();
            this.settings.snapEnabled = !this.settings.snapEnabled;
            this.updateSnapButton();
            if (this.onSettingsSave) await this.onSettingsSave();
        });

        // Observe container size changes (e.g. fullscreen, window resize)
        if (!this._resizeObserver) {
            this._resizeObserver = new ResizeObserver(() => {
                this.requestRender();
            });
        }
        this._resizeObserver.observe(this.containerEl);
    }

    // --- Mode Toggle ---

    toggleTextboxMode(): void {
        if (this.engine.mode === InteractionMode.InsertTextBox) {
            this.engine.setMode(InteractionMode.None);
        } else {
            this.engine.setMode(InteractionMode.InsertTextBox);
        }
        this.updateMenuButtons();
    }

    toggleArrowMode(): void {
        if (this.engine.mode === InteractionMode.InsertArrow) {
            this.engine.setMode(InteractionMode.None);
            this.hideDirectionMenu();
        } else {
            this.engine.setMode(InteractionMode.InsertArrow);
            this.showDirectionMenu();
        }
        this.updateMenuButtons();
    }

    // Direction menu for arrow default direction
    directionMenuEl: HTMLElement | null = null;
    directionBtns: Map<string, HTMLElement> = new Map();

    showDirectionMenu(): void {
        if (this.directionMenuEl) return;

        this.directionMenuEl = this.containerEl.createDiv('simpledraw-direction-menu');
        this.directionMenuEl.style.position = 'absolute';
        this.directionMenuEl.style.top = '48px';
        this.directionMenuEl.style.left = '8px';
        this.directionMenuEl.style.zIndex = '100';
        this.directionMenuEl.style.display = 'flex';
        this.directionMenuEl.style.flexDirection = 'column';
        this.directionMenuEl.style.gap = '2px';
        this.directionMenuEl.style.background = 'var(--background-primary)';
        this.directionMenuEl.style.border = '1px solid var(--background-modifier-border)';
        this.directionMenuEl.style.borderRadius = '6px';
        this.directionMenuEl.style.padding = '4px';
        this.directionMenuEl.style.boxShadow = '0 2px 8px rgba(0,0,0,0.15)';

        const label = this.directionMenuEl.createDiv();
        label.textContent = t('directionMenu.label');
        label.style.fontSize = '10px';
        label.style.color = 'var(--text-muted)';
        label.style.textAlign = 'center';
        label.style.marginBottom = '2px';

        const dirs: { dir: ArrowDirection; label: string }[] = [
            { dir: 'up', label: '↑' },
            { dir: 'down', label: '↓' },
            { dir: 'left', label: '←' },
            { dir: 'right', label: '→' },
        ];

        for (const d of dirs) {
            const btn = document.createElement('button');
            btn.textContent = d.label;
            btn.title = d.dir;
            btn.style.width = '28px';
            btn.style.height = '28px';
            btn.style.border = '1px solid transparent';
            btn.style.borderRadius = '4px';
            btn.style.background = this.engine.arrowDirection === d.dir ? 'var(--interactive-accent-hover)' : 'transparent';
            btn.style.cursor = 'pointer';
            btn.style.fontSize = '14px';
            btn.style.color = 'var(--text-normal)';
            btn.addEventListener('mousedown', (e) => {
                e.stopPropagation();
                e.preventDefault();
                this.engine.arrowDirection = d.dir;
                this.updateDirectionButtons();
            });
            this.directionMenuEl.appendChild(btn);
            this.directionBtns.set(d.dir, btn);
        }

        // Listen for arrow keys to change direction
        this.containerEl.addEventListener('keydown', this.onDirectionKey);
    }

    hideDirectionMenu(): void {
        if (this.directionMenuEl) {
            this.directionMenuEl.remove();
            this.directionMenuEl = null;
            this.directionBtns.clear();
        }
        this.containerEl.removeEventListener('keydown', this.onDirectionKey);
    }

    onDirectionKey = (e: KeyboardEvent): void => {
        if (this.engine.mode !== InteractionMode.InsertArrow) return;
        switch (e.key) {
            case 'ArrowUp': e.preventDefault(); this.engine.arrowDirection = 'up'; break;
            case 'ArrowDown': e.preventDefault(); this.engine.arrowDirection = 'down'; break;
            case 'ArrowLeft': e.preventDefault(); this.engine.arrowDirection = 'left'; break;
            case 'ArrowRight': e.preventDefault(); this.engine.arrowDirection = 'right'; break;
            default: return;
        }
        this.updateDirectionButtons();
    };

    updateDirectionButtons(): void {
        for (const [dir, btn] of this.directionBtns) {
            btn.style.background = this.engine.arrowDirection === dir ? 'var(--interactive-accent-hover)' : 'transparent';
        }
    }

    getTempConnection(x: number, y: number): ArrowConnection | FreePoint {
        const snapped = this.engine.findNearestAnchor(x, y);
        if (snapped) {
            return { elementId: snapped.elementId, anchor: snapped.anchor };
        }
        return { x, y };
    }

    updateMenuButtons(): void {
        const isTextboxMode = this.engine.mode === InteractionMode.InsertTextBox;
        const isArrowMode = this.engine.mode === InteractionMode.InsertArrow;

        this.btnInsertTextbox.style.borderColor = isTextboxMode ? 'var(--interactive-accent)' : 'transparent';
        this.btnInsertTextbox.style.background = isTextboxMode ? 'var(--interactive-accent-hover)' : 'transparent';

        this.btnInsertArrow.style.borderColor = isArrowMode ? 'var(--interactive-accent)' : 'transparent';
        this.btnInsertArrow.style.background = isArrowMode ? 'var(--interactive-accent-hover)' : 'transparent';
    }

    updateSnapButton(): void {
        const on = this.settings.snapEnabled;
        this.btnSnapToggle.style.borderColor = on ? 'var(--interactive-accent)' : 'transparent';
        this.btnSnapToggle.style.background = on ? 'var(--interactive-accent-hover)' : 'transparent';
        this.btnSnapToggle.style.opacity = on ? '1' : '0.5';
    }

    // --- Mouse Handlers ---

    onMouseDown(e: MouseEvent): void {
        const target = e.target as HTMLElement;

        // Skip clicks on menu or editor overlays (including textarea inside editor)
        // BUT allow clicks on label text and label resize handles to pass through
        if (target !== this.containerEl && target !== this.viewportEl &&
            !target.closest('.simpledraw-label-resize-handle') &&
            !target.closest('[data-arrow-label-id]') &&
            (target.closest('.simpledraw-menu') ||
             target.closest('.simpledraw-textbox-editor') ||
             target.closest('.simpledraw-arrow-editor') ||
             target.closest('.simpledraw-arrow-label-editor'))) {
            return;
        }

        this.containerEl.focus();

        const canvasPos = this.engine.screenToCanvas(e.clientX, e.clientY);

        // Middle mouse button for panning
        if (e.button === 1) {
            e.preventDefault();
            this.engine.dragging = {
                type: 'pan',
                startMouseX: e.clientX,
                startMouseY: e.clientY,
                startX: this.engine.data.viewState.panX,
                startY: this.engine.data.viewState.panY,
            };
            this.containerEl.style.cursor = 'grabbing';
            return;
        }

        // Left click
        if (e.button === 0) {
            this.handleLeftMouseDown(e, canvasPos);
        }
    }

    handleLeftMouseDown(e: MouseEvent, pos: { x: number; y: number }): void {
        const ctrlOrShift = e.ctrlKey || e.shiftKey;

        switch (this.engine.mode) {
            case InteractionMode.InsertTextBox:
                this.handleTextboxInsertDown(pos);
                break;

            case InteractionMode.InsertArrow:
                this.handleArrowInsertDown(pos);
                break;

            case InteractionMode.None:
                this.handleDefaultMouseDown(e, pos, ctrlOrShift);
                break;
        }
    }

    handleTextboxInsertDown(pos: { x: number; y: number }): void {
        if (!this.engine.textBoxInsertState.firstClick) {
            this.engine.textBoxInsertState.firstClick = { x: pos.x, y: pos.y };
            this.requestRender();
        } else {
            const first = this.engine.textBoxInsertState.firstClick;
            const x = Math.min(first.x, pos.x);
            const y = Math.min(first.y, pos.y);
            const w = Math.abs(pos.x - first.x);
            const h = Math.abs(pos.y - first.y);

            if (w < MIN_TEXTBOX_WIDTH && h < MIN_TEXTBOX_HEIGHT) {
                const cx = first.x;
                const cy = first.y;
                const id = this.engine.createTextBox(cx - DEFAULT_TEXTBOX_WIDTH/2, cy - DEFAULT_TEXTBOX_HEIGHT/2, DEFAULT_TEXTBOX_WIDTH, DEFAULT_TEXTBOX_HEIGHT);
                this.engine.setMode(InteractionMode.None);
                this.startEditingTextbox(id);
            } else {
                const id = this.engine.createTextBox(x, y, Math.max(w, MIN_TEXTBOX_WIDTH), Math.max(h, MIN_TEXTBOX_HEIGHT));
                this.engine.setMode(InteractionMode.None);
                this.startEditingTextbox(id);
            }
        }
    }

    handleArrowInsertDown(pos: { x: number; y: number }): void {
        if (!this.engine.arrowInsertState.firstClick) {
            // Check for snap
            const snapped = this.engine.findNearestAnchor(pos.x, pos.y);
            if (snapped) {
                this.engine.arrowInsertState.firstClick = { x: snapped.x, y: snapped.y };
            } else {
                this.engine.arrowInsertState.firstClick = { x: pos.x, y: pos.y };
            }
            this.engine.arrowInsertState.mouseX = pos.x;
            this.engine.arrowInsertState.mouseY = pos.y;
            this.requestRender();
        } else {
            const startX = this.engine.arrowInsertState.firstClick.x;
            const startY = this.engine.arrowInsertState.firstClick.y;

            // Check for snap on end
            const snapped = this.engine.findNearestAnchor(pos.x, pos.y);
            let endX = pos.x;
            let endY = pos.y;

            if (snapped) {
                endX = snapped.x;
                endY = snapped.y;
            }

            // Create start connection
            const startSnap = this.engine.findNearestAnchor(startX, startY);
            let startConn: ArrowConnection | FreePoint;
            if (startSnap) {
                startConn = { elementId: startSnap.elementId, anchor: startSnap.anchor };
            } else {
                startConn = { x: startX, y: startY };
            }

            // Create end connection
            let endConn: ArrowConnection | FreePoint;
            if (snapped) {
                endConn = { elementId: snapped.elementId, anchor: snapped.anchor };
            } else {
                endConn = { x: endX, y: endY };
            }

            this.engine.createArrow(startConn, endConn);
            this.engine.setMode(InteractionMode.None);
        }
    }

    handleDefaultMouseDown(e: MouseEvent, pos: { x: number; y: number }, additive: boolean): void {
        // Check label interactions FIRST (before closeEditors).
        // This ensures double-click on label can reach startArrowLabelEditor
        // without labelVisible being unexpectedly cleared by closeEditors.

        // 1. Arrow label resize handles
        const labelHandle = (e.target as HTMLElement).closest('[data-label-handle-id]') as HTMLElement | null;
        if (labelHandle) {
            const arrowId = labelHandle.dataset.labelHandleId!;
            const handle = labelHandle.dataset.handle!;
            const arrow = this.engine.data.elements.find(
                e => e.id === arrowId && e.type === 'arrow'
            ) as ArrowData | undefined;
            if (arrow && this.engine.selectedIds.has(arrowId)) {
                const labelDom = this.elementsLayer.querySelector(
                    `[data-arrow-label-id="${arrowId}"]`) as HTMLElement | null;
                const zoom = this.engine.data.viewState.zoom;
                const curW = labelDom ? labelDom.getBoundingClientRect().width / zoom : (arrow.labelWidth ?? 120);
                const curH = labelDom ? labelDom.getBoundingClientRect().height / zoom : (arrow.labelHeight ?? 30);
                this.engine.dragging = {
                    type: 'label-resize',
                    arrowId: arrowId,
                    startMouseX: pos.x,
                    startMouseY: pos.y,
                    startX: 0,
                    startY: 0,
                    startWidth: curW,
                    startHeight: curH,
                    resizeHandle: handle,
                };
                this.containerEl.style.cursor = 'nwse-resize';
                return;
            }
        }

        // 2. Label click → 逻辑双击：未选中则选中，已选中则编辑
        const labelArrow = this.engine.getLabelAt(pos.x, pos.y);
        if (labelArrow) {
            if (this.engine.selectedIds.has(labelArrow.id)) {
                this.startArrowLabelEditor(labelArrow.id);
            } else {
                this.engine.selectElement(labelArrow.id, additive);
                this.requestRender();
            }
            return;
        }

        // 3. Close any open editors (label interactions already handled above)
        this.closeEditors();

        // 4. Check all textboxes for resize handle hits
        for (const el of this.engine.data.elements) {
            if (el.type !== 'textbox') continue;
            const tb = el as TextBoxData;
            const handle = this.engine.getResizeHandle(tb, pos.x, pos.y);
            if (handle) {
                this.engine.selectElement(tb.id, additive);
                this.engine.dragging = {
                    type: 'resize',
                    startMouseX: pos.x,
                    startMouseY: pos.y,
                    startX: tb.x,
                    startY: tb.y,
                    startWidth: tb.width,
                    startHeight: tb.height,
                    resizeHandle: handle,
                    textboxId: tb.id,
                };
                this.containerEl.style.cursor = 'nwse-resize';
                return;
            }
        }

        // Check if clicking on an element
        const clickedEl = this.engine.getElementAt(pos.x, pos.y);

        // Locked textboxes — don't select, move, or resize
        if (clickedEl && clickedEl.type === 'textbox' && (clickedEl as TextBoxData).locked) return;

        if (clickedEl) {
            // Select element (preserve group when clicking an already-selected member)
            if (additive) {
                this.engine.selectElement(clickedEl.id, true);
            } else if (!this.engine.selectedIds.has(clickedEl.id)) {
                this.engine.selectElement(clickedEl.id, false);
            }

            // Start moving all selected elements
            const idsToMove = new Set(this.engine.selectedIds);
            this.engine.dragging = {
                type: 'move',
                elementIds: idsToMove,
                startMouseX: e.clientX,
                startMouseY: e.clientY,
                startX: pos.x,
                startY: pos.y,
            };
            this.containerEl.style.cursor = 'move';
            return;
        }

        // Click on empty area
        if (!additive) {
            this.engine.clearSelection();
        }

        // Start selection rectangle
        this.engine.selectionState = {
            startX: pos.x,
            startY: pos.y,
            currentX: pos.x,
            currentY: pos.y,
            active: true,
        };

        this.engine.dragging = {
            type: 'move',
            startMouseX: e.clientX,
            startMouseY: e.clientY,
            startX: pos.x,
            startY: pos.y,
        };

        this.containerEl.style.cursor = 'crosshair';
    }

    onMouseMove(e: MouseEvent): void {
        const canvasPos = this.engine.screenToCanvas(e.clientX, e.clientY);
        this.lastCanvasMouse = canvasPos;

        // Update arrow preview
        if (this.engine.mode === InteractionMode.InsertArrow) {
            this.engine.arrowInsertState.mouseX = canvasPos.x;
            this.engine.arrowInsertState.mouseY = canvasPos.y;
            if (this.engine.arrowInsertState.firstClick) {
                this.requestRender();
            } else {
                this.requestRender();
            }
        }

        // Update textbox insert preview
        if (this.engine.mode === InteractionMode.InsertTextBox && this.engine.textBoxInsertState.firstClick) {
            this.requestRender();
        }

        // Pan
        if (this.engine.dragging?.type === 'pan') {
            const dx = e.clientX - this.engine.dragging.startMouseX;
            const dy = e.clientY - this.engine.dragging.startMouseY;
            this.engine.data.viewState.panX = this.engine.dragging.startX + dx;
            this.engine.data.viewState.panY = this.engine.dragging.startY + dy;
            this.updateViewportTransform();
            return;
        }

        // Resize
        if (this.engine.dragging?.type === 'resize' && this.engine.dragging.textboxId) {
            const el = this.engine.data.elements.find(e => e.id === this.engine.dragging!.textboxId) as TextBoxData | undefined;
            if (el && this.engine.dragging.startWidth != null && this.engine.dragging.startHeight != null) {
                const handle = this.engine.dragging.resizeHandle;
                const dx = canvasPos.x - this.engine.dragging.startMouseX;
                const dy = canvasPos.y - this.engine.dragging.startMouseY;
                const origX = this.engine.dragging.startX;
                const origY = this.engine.dragging.startY;
                const origW = this.engine.dragging.startWidth;
                const origH = this.engine.dragging.startHeight;

                if (handle === 'se') {
                    el.width = Math.max(MIN_TEXTBOX_WIDTH, origW + dx);
                    el.height = Math.max(MIN_TEXTBOX_HEIGHT, origH + dy);
                } else if (handle === 'sw') {
                    const newW = Math.max(MIN_TEXTBOX_WIDTH, origW - dx);
                    el.x = origX + origW - newW;
                    el.width = newW;
                    el.height = Math.max(MIN_TEXTBOX_HEIGHT, origH + dy);
                } else if (handle === 'ne') {
                    el.width = Math.max(MIN_TEXTBOX_WIDTH, origW + dx);
                    const newH = Math.max(MIN_TEXTBOX_HEIGHT, origH - dy);
                    el.y = origY + origH - newH;
                    el.height = newH;
                } else if (handle === 'nw') {
                    const newW = Math.max(MIN_TEXTBOX_WIDTH, origW - dx);
                    el.x = origX + origW - newW;
                    el.width = newW;
                    const newH = Math.max(MIN_TEXTBOX_HEIGHT, origH - dy);
                    el.y = origY + origH - newH;
                    el.height = newH;
                }
                el.autoSize = false;
                if (this.settings.snapEnabled && handle) {
                    this.engine.computeResizeSnap(el.id, handle);
                }
                this.engine.notifyChange();
                this.requestRender();
            }
            return;
        }

        // Arrow label resize (symmetric around midpoint, delta-based with 2x factor)
        if (this.engine.dragging?.type === 'label-resize' && this.engine.dragging.arrowId) {
            const arrow = this.engine.data.elements.find(
                e => e.id === this.engine.dragging!.arrowId && e.type === 'arrow'
            ) as ArrowData | undefined;
            if (arrow && this.engine.dragging.startWidth != null && this.engine.dragging.startHeight != null) {
                const dx = canvasPos.x - this.engine.dragging.startMouseX;
                const dy = canvasPos.y - this.engine.dragging.startMouseY;
                const origW = this.engine.dragging.startWidth;
                const origH = this.engine.dragging.startHeight;
                arrow.labelWidth = Math.max(30, origW + 2 * dx);
                arrow.labelHeight = Math.max(12, origH + 2 * dy);
                this.engine.notifyChange();
                this.requestRender();
            }
            return;
        }

        // Update selection rectangle (always active when dragging on empty area)
        if (this.engine.selectionState?.active) {
            this.engine.selectionState.currentX = canvasPos.x;
            this.engine.selectionState.currentY = canvasPos.y;
            this.requestRender();
            return;
        }

        // Move elements
        if (this.engine.dragging?.type === 'move' && this.engine.dragging.elementIds) {
            const dx = canvasPos.x - this.engine.dragging.startX;
            const dy = canvasPos.y - this.engine.dragging.startY;

            if (Math.abs(dx) > 0.5 || Math.abs(dy) > 0.5) {
                this.engine.moveElements(this.engine.dragging.elementIds, dx, dy);
                this.engine.dragging.startX = canvasPos.x;
                this.engine.dragging.startY = canvasPos.y;
                if (this.settings.snapEnabled) {
                    this.engine.computeAlignmentPreview(this.engine.dragging.elementIds);
                }
                this.requestRender();
            }
            return;
        }
    }

    onMouseUp(e: MouseEvent): void {
        const canvasPos = this.engine.screenToCanvas(e.clientX, e.clientY);

        // Finish selection
        if (this.engine.selectionState?.active && this.engine.dragging) {
            const additive = e.ctrlKey || e.shiftKey;
            this.engine.selectElementsInRect(
                this.engine.selectionState.startX,
                this.engine.selectionState.startY,
                canvasPos.x,
                canvasPos.y,
                additive
            );
            this.engine.selectionState = null;
            this.containerEl.style.cursor = 'default';
        }

        // Apply alignment snap before saving history
        if (this.engine.dragging?.type === 'move' && this.engine.dragging.elementIds && this.settings.snapEnabled) {
            this.engine.applyAlignmentSnap(this.engine.dragging.elementIds);
        }

        // Apply resize snap
        if (this.engine.dragging?.type === 'resize' && this.engine.dragging.textboxId && this.engine.dragging.resizeHandle && this.settings.snapEnabled) {
            this.engine.applyResizeSnap(this.engine.dragging.textboxId, this.engine.dragging.resizeHandle);
        }

        // Save history after dragging
        if (this.engine.dragging && this.engine.dragging.type !== 'pan') {
            this.engine.saveHistory();
        }

        this.engine.clearAlignmentSnap();
        this.engine.clearResizeSnap();
        this.engine.dragging = null;
        this.containerEl.style.cursor = 'default';
        this.requestRender();
    }

    onWheel(e: WheelEvent): void {
        if (e.ctrlKey || e.metaKey) {
            e.preventDefault();
            this.engine.zoomAt(e.clientX, e.clientY, e.deltaY);
            this.updateViewportTransform();
        }
    }

    onDblClick(e: MouseEvent): void {
        const canvasPos = this.engine.screenToCanvas(e.clientX, e.clientY);

        // getLabelAt 兜底（仅用于浏览器仍能触达 dblclick 的场景）
        const labelArrow = this.engine.getLabelAt(canvasPos.x, canvasPos.y);
        if (labelArrow) {
            this.startArrowLabelEditor(labelArrow.id);
            return;
        }

        const el = this.engine.getElementAt(canvasPos.x, canvasPos.y);
        if (el && el.type === 'textbox') {
            if ((el as TextBoxData).locked) return;
            this.startEditingTextbox(el.id);
        } else if (el && el.type === 'arrow') {
            this.showArrowEditor(el.id);
        }
    }

    onContextMenu(e: MouseEvent): void {
        e.preventDefault();
        const canvasPos = this.engine.screenToCanvas(e.clientX, e.clientY);
        const el = this.engine.getElementAt(canvasPos.x, canvasPos.y);
        if (!el || el.type !== 'textbox') return;

        // Select the textbox on right-click
        if (!this.engine.selectedIds.has(el.id)) {
            this.engine.selectElement(el.id, false);
        }

        const menu = new Menu();
        if ((el as TextBoxData).locked) {
            menu.addItem((item) => {
                item.setTitle(t('contextMenu.unlock')).setIcon('lock').onClick(() => {
                    const tb = el as TextBoxData;
                    tb.locked = false;
                    this.engine.saveHistory();
                    this.engine.notifyChange();
                    this.requestRender();
                });
            });
        } else {
            menu.addItem((item) => {
                item.setTitle(t('contextMenu.bringToFront')).setIcon('arrow-up').onClick(() => {
                    this.engine.sendTextboxToFront(el.id);
                    this.rebuildAll();
                });
            });
            menu.addItem((item) => {
                item.setTitle(t('contextMenu.sendToBack')).setIcon('arrow-down').onClick(() => {
                    this.engine.sendTextboxToBack(el.id);
                    this.rebuildAll();
                });
            });
        }
        menu.showAtPosition({ x: e.clientX, y: e.clientY });
    }

    onKeyDown(e: KeyboardEvent): void {
        // Global shortcuts
        if (e.key === 'Escape') {
            this.engine.cancelCurrentMode();
            this.closeEditors();
            this.updateMenuButtons();
            this.requestRender();
            return;
        }

        // Delete selected
        if (e.key === 'Delete' || e.key === 'Backspace') {
            if (this.engine.editingTextboxId || this.engine.editingArrowId || this.labelEditorArrowId) return;
            if (this.engine.selectedIds.size > 0) {
                this.engine.deleteElements(this.engine.selectedIds);
                this.closeEditors();
                this.requestRender();
            }
            return;
        }

        // Undo/Redo
        if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey) {
            if (this.engine.editingTextboxId || this.engine.editingArrowId || this.labelEditorArrowId) return;
            e.preventDefault();
            this.engine.undo();
            this.rebuildAll();
            return;
        }
        if ((e.ctrlKey || e.metaKey) && e.key === 'z' && e.shiftKey) {
            if (this.engine.editingTextboxId || this.engine.editingArrowId || this.labelEditorArrowId) return;
            e.preventDefault();
            this.engine.redo();
            this.rebuildAll();
            return;
        }
        if ((e.ctrlKey || e.metaKey) && (e.key === 'Z')) {
            if (this.engine.editingTextboxId || this.engine.editingArrowId || this.labelEditorArrowId) return;
            e.preventDefault();
            this.engine.redo();
            this.rebuildAll();
            return;
        }

        // Text formatting shortcuts (only when editing textbox content)
        if (this.engine.editingTextboxId) {
            // Text formatting shortcuts handled at document capture level
            return;
        }

        // Copy selected elements
        if ((e.ctrlKey || e.metaKey) && e.key === 'c') {
            if (this.engine.editingTextboxId || this.engine.editingArrowId || this.labelEditorArrowId) return;
            if (this.engine.selectedIds.size > 0) {
                e.preventDefault();
                this.copySelectedElements();
            }
            return;
        }

        // Paste elements or clipboard text
        if ((e.ctrlKey || e.metaKey) && e.key === 'v') {
            if (this.engine.editingTextboxId || this.engine.editingArrowId || this.labelEditorArrowId) return;
            e.preventDefault();
            this.pasteFromClipboard();
            return;
        }
    }

    // --- Textbox Editor ---

    startEditingTextbox(id: string): void {
        const el = this.engine.data.elements.find(e => e.id === id && e.type === 'textbox') as TextBoxData | undefined;
        if (!el) return;
        if (el.locked) return;

        this.closeEditors();
        this.engine.editingTextboxId = id;

        // Create editor overlay
        this.textboxEditorEl = this.containerEl.createDiv('simpledraw-textbox-editor');
        this.textboxEditorEl.style.position = 'absolute';
        this.textboxEditorEl.style.zIndex = '200';
        this.textboxEditorEl.style.background = 'var(--background-primary)';
        this.textboxEditorEl.style.border = '2px solid var(--interactive-accent)';
        this.textboxEditorEl.style.borderRadius = '4px';
        this.textboxEditorEl.style.padding = '8px';
        this.textboxEditorEl.style.boxShadow = '0 4px 16px rgba(0,0,0,0.2)';
        this.textboxEditorEl.style.minWidth = '250px';
        this.textboxEditorEl.style.maxWidth = '500px';

        this.positionTextboxEditor(el);

        // Toolbar
        const toolbar = this.textboxEditorEl.createDiv('simpledraw-editor-toolbar');
        toolbar.style.display = 'flex';
        toolbar.style.gap = '4px';
        toolbar.style.marginBottom = '8px';
        toolbar.style.flexWrap = 'wrap';
        toolbar.style.alignItems = 'center';

        // Visibility toggle
        const visBtn = this.createSmallButton(el.visible ? '👁' : '👁‍🗨', t('textboxEditor.toggleVisibility'));
        visBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            el.visible = !el.visible;
            visBtn.textContent = el.visible ? '👁' : '👁‍🗨';
            this.engine.saveHistory();
            this.engine.notifyChange();
            this.requestRender();
        });
        toolbar.appendChild(visBtn);

        // Fill toggle
        const fillBtn = this.createSmallButton(el.fillEnabled ? '▣' : '□', t('textboxEditor.toggleFill'));
        fillBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            el.fillEnabled = !el.fillEnabled;
            if (el.fillEnabled) {
                el.visible = true;
                visBtn.textContent = '👁';
            }
            fillBtn.textContent = el.fillEnabled ? '▣' : '□';
            this.engine.saveHistory();
            this.engine.notifyChange();
            this.requestRender();
        });
        toolbar.appendChild(fillBtn);

        // Alignment buttons
        const alignGroup = document.createElement('div');
        alignGroup.style.display = 'flex';
        alignGroup.style.gap = '2px';
        alignGroup.style.marginLeft = '8px';
        alignGroup.style.borderLeft = '1px solid var(--background-modifier-border)';
        alignGroup.style.paddingLeft = '8px';

        const vAligns: { label: string; value: 'top' | 'middle' | 'bottom'; title: string }[] = [
            { label: '⊤', value: 'top', title: t('textboxEditor.align.top') },
            { label: '⊟', value: 'middle', title: t('textboxEditor.align.middle') },
            { label: '⊥', value: 'bottom', title: t('textboxEditor.align.bottom') },
        ];
        const hAligns: { label: string; value: 'left' | 'center' | 'right'; title: string }[] = [
            { label: '⊏', value: 'left', title: t('textboxEditor.align.left') },
            { label: '⊜', value: 'center', title: t('textboxEditor.align.center') },
            { label: '⊐', value: 'right', title: t('textboxEditor.align.right') },
        ];

        const vAlignBtns: HTMLElement[] = [];
        const hAlignBtns: HTMLElement[] = [];

        const updateAlignHighlights = () => {
            for (let i = 0; i < vAligns.length; i++) {
                const btn = vAlignBtns[i];
                if (btn) btn.style.background = el.vAlign === vAligns[i]!.value ? 'var(--interactive-accent-hover)' : 'transparent';
            }
            for (let i = 0; i < hAligns.length; i++) {
                const btn = hAlignBtns[i];
                if (btn) btn.style.background = el.hAlign === hAligns[i]!.value ? 'var(--interactive-accent-hover)' : 'transparent';
            }
        };

        for (const a of vAligns) {
            const btn = this.createSmallButton(a.label, a.title);
            vAlignBtns.push(btn);
            btn.addEventListener('click', () => {
                el.vAlign = a.value;
                updateAlignHighlights();
                this.engine.notifyChange();
                this.requestRender();
            });
            alignGroup.appendChild(btn);
        }

        for (const a of hAligns) {
            const btn = this.createSmallButton(a.label, a.title);
            hAlignBtns.push(btn);
            btn.addEventListener('click', () => {
                el.hAlign = a.value;
                updateAlignHighlights();
                this.engine.notifyChange();
                this.requestRender();
            });
            alignGroup.appendChild(btn);
        }

        updateAlignHighlights();

        toolbar.appendChild(alignGroup);

        // Writing mode toggle
        const wmBtn = this.createSmallButton(t('textboxEditor.writingModeLabel'), t('textboxEditor.writingMode'));
        const updateWmBtn = () => {
            wmBtn.style.background = (el.writingMode ?? 'horizontal-tb') === 'vertical-rl'
                ? 'var(--interactive-accent-hover)' : 'transparent';
        };
        updateWmBtn();
        wmBtn.addEventListener('click', () => {
            el.writingMode = (el.writingMode ?? 'horizontal-tb') === 'vertical-rl'
                ? 'horizontal-tb' : 'vertical-rl';
            updateWmBtn();
            this.engine.saveHistory();
            this.engine.notifyChange();
            this.requestRender();
        });
        toolbar.appendChild(wmBtn);

        // Shape selector
        const shapes: { label: string; value: string; titleKey: string }[] = [
            { label: '□', value: 'rectangle', titleKey: 'textboxEditor.shape.rectangle' },
            { label: '○', value: 'ellipse', titleKey: 'textboxEditor.shape.ellipse' },
            { label: '◇', value: 'diamond', titleKey: 'textboxEditor.shape.diamond' },
        ];
        const shapeBtns: HTMLElement[] = [];
        const updateShapeHighlights = () => {
            const cur = el.shape ?? 'rectangle';
            for (let i = 0; i < shapes.length; i++) {
                shapeBtns[i]!.style.background = shapes[i]!.value === cur
                    ? 'var(--interactive-accent-hover)' : 'transparent';
            }
        };
        for (const s of shapes) {
            const btn = this.createSmallButton(s.label, t(s.titleKey));
            shapeBtns.push(btn);
            btn.addEventListener('click', () => {
                el.shape = s.value as any;
                updateShapeHighlights();
                this.engine.saveHistory();
                this.engine.notifyChange();
                this.requestRender();
            });
            toolbar.appendChild(btn);
        }
        updateShapeHighlights();

        // Lock button
        const lockBtn = this.createSmallButton(el.locked ? '🔒' : '🔓', el.locked ? t('textboxEditor.unlock') : t('textboxEditor.lock'));
        lockBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            el.locked = !el.locked;
            lockBtn.textContent = el.locked ? '🔒' : '🔓';
            lockBtn.title = el.locked ? t('textboxEditor.unlock') : t('textboxEditor.lock');
            if (el.locked) {
                this.engine.selectedIds.delete(el.id);
                if (this.engine.onSelectionChange) this.engine.onSelectionChange();
            }
            this.engine.saveHistory();
            this.engine.notifyChange();
            if (el.locked) {
                this.closeEditors();
                this.requestRender();
            }
        });
        toolbar.appendChild(lockBtn);

        // Confirm button
        const confirmBtn = this.createSmallButton('✓', t('textboxEditor.confirm'));
        confirmBtn.style.marginLeft = 'auto';
        confirmBtn.style.background = 'var(--interactive-accent)';
        confirmBtn.style.color = 'var(--text-on-accent)';
        confirmBtn.addEventListener('click', () => {
            this.closeEditors();
            this.requestRender();
        });
        toolbar.appendChild(confirmBtn);

        // Row 2: font size controls (styled like toolbar)
        const toolbar2 = this.textboxEditorEl.createDiv('simpledraw-editor-toolbar');
        toolbar2.style.display = 'flex';
        toolbar2.style.gap = '4px';
        toolbar2.style.marginBottom = '8px';
        toolbar2.style.alignItems = 'center';

        const sizeDisplay = toolbar2.createSpan();
        sizeDisplay.textContent = (el.fontSize ?? 16) + 'px';
        sizeDisplay.style.fontSize = '12px';
        sizeDisplay.style.color = 'var(--text-muted)';
        sizeDisplay.style.marginRight = '2px';
        sizeDisplay.style.minWidth = '30px';
        sizeDisplay.style.textAlign = 'right';

        const updateSizeDisplay = () => {
            sizeDisplay.textContent = (el.fontSize ?? 16) + 'px';
        };

        const shrinkBtn = this.createSmallButton('A-', t('textboxEditor.fontSize.shrink'));
        shrinkBtn.addEventListener('click', () => {
            el.fontSize = Math.max(8, (el.fontSize ?? 16) - 2);
            updateSizeDisplay();
            this.engine.saveHistory();
            this.engine.notifyChange();
            this.requestRender();
        });

        const growBtn = this.createSmallButton('A+', t('textboxEditor.fontSize.grow'));
        growBtn.addEventListener('click', () => {
            el.fontSize = Math.min(72, (el.fontSize ?? 16) + 2);
            updateSizeDisplay();
            this.engine.saveHistory();
            this.engine.notifyChange();
            this.requestRender();
        });

        const resetBtn = this.createSmallButton('R', t('textboxEditor.fontSize.reset'));
        resetBtn.addEventListener('click', () => {
            el.fontSize = this.settings.textboxDefaultFontSize ?? 16;
            updateSizeDisplay();
            this.engine.saveHistory();
            this.engine.notifyChange();
            this.requestRender();
        });

        toolbar2.appendChild(sizeDisplay);
        toolbar2.appendChild(shrinkBtn);
        toolbar2.appendChild(growBtn);
        toolbar2.appendChild(resetBtn);

        // Textarea for editing
        const textarea = this.textboxEditorEl.createEl('textarea');
        textarea.style.width = '100%';
        textarea.style.minHeight = '100px';
        textarea.style.resize = 'both';
        textarea.style.border = '1px solid var(--background-modifier-border)';
        textarea.style.borderRadius = '4px';
        textarea.style.padding = '6px';
        textarea.style.background = 'var(--background-primary)';
        textarea.style.color = 'var(--text-normal)';
        textarea.style.fontFamily = 'var(--font-text)';
        textarea.style.fontSize = (this.settings.textboxDefaultFontSize ?? 16) + 'px';
        textarea.value = el.content;
        // Immediately grow to fit existing content
        textarea.style.height = 'auto';
        textarea.style.height = Math.max(60, textarea.scrollHeight) + 'px';

        textarea.focus();

        textarea.addEventListener('keydown', (ev) => {
            if (ev.key === 'Escape') {
                ev.stopPropagation();
                this.closeEditors();
                this.requestRender();
                return;
            }
            // Fallback for formatting shortcuts — works in pop-out windows
            // where document-level capture may be blocked by Obsidian.
            if (this.applyFormattingShortcut(ev, textarea)) return;
        });

        // Live preview: re-render textbox as user types
        textarea.addEventListener('input', () => {
            el.content = textarea.value;
            // Auto-grow textarea to fit content
            textarea.style.height = 'auto';
            textarea.style.height = Math.max(60, textarea.scrollHeight) + 'px';
            this.requestRender();
        });

        // Ensure render loop is active after editor opens
        this.requestRender();
    }

    autoSizeTextbox(el: TextBoxData): void {
        // Create temporary element to measure content
        const temp = document.createElement('div');
        temp.style.position = 'absolute';
        temp.style.visibility = 'hidden';
        temp.style.width = el.width + 'px';
        temp.style.wordWrap = 'break-word';
        temp.style.fontFamily = 'var(--font-text)';
        temp.style.fontSize = (el.fontSize ?? 16) + 'px';
        temp.style.padding = '8px';
        temp.style.boxSizing = 'border-box';
        temp.textContent = el.content || ' ';
        document.body.appendChild(temp);

        const scrollHeight = temp.scrollHeight;
        const scrollWidth = temp.scrollWidth;
        document.body.removeChild(temp);

        el.width = Math.max(MIN_TEXTBOX_WIDTH, Math.min(scrollWidth + 20, 600));
        el.height = Math.max(MIN_TEXTBOX_HEIGHT, Math.min(scrollHeight + 10, 400));
    }

    positionTextboxEditor(el: TextBoxData): void {
        if (!this.textboxEditorEl) return;
        const screen = this.engine.canvasToScreen(el.x, el.y);
        const viewRect = this.containerEl.getBoundingClientRect();

        let left = Math.max(0, screen.x);
        const editorHeight = 200;
        let top = screen.y + el.height * this.engine.data.viewState.zoom + 5;
        if (top + editorHeight > viewRect.height) {
            top = screen.y - editorHeight;
        }
        top = Math.max(0, top);

        this.textboxEditorEl.style.left = left + 'px';
        this.textboxEditorEl.style.top = top + 'px';
    }

    createSmallButton(label: string, title: string): HTMLElement {
        const btn = document.createElement('button');
        btn.textContent = label;
        btn.title = title;
        btn.style.width = '24px';
        btn.style.height = '24px';
        btn.style.border = '1px solid transparent';
        btn.style.borderRadius = '3px';
        btn.style.background = 'transparent';
        btn.style.cursor = 'pointer';
        btn.style.fontSize = '12px';
        btn.style.display = 'flex';
        btn.style.alignItems = 'center';
        btn.style.justifyContent = 'center';
        btn.style.color = 'var(--text-normal)';
        return btn;
    }

    // --- Arrow Editor ---

    showArrowEditor(id: string): void {
        const el = this.engine.data.elements.find(e => e.id === id && e.type === 'arrow') as ArrowData | undefined;
        if (!el) return;

        this.closeEditors();
        this.engine.editingArrowId = id;

        const start = this.engine.resolveConnection(el.startConnection);
        const screen = this.engine.canvasToScreen(start.x, start.y);

        this.arrowEditorEl = this.containerEl.createDiv('simpledraw-arrow-editor');
        this.arrowEditorEl.style.position = 'absolute';
        this.arrowEditorEl.style.zIndex = '200';
        this.arrowEditorEl.style.background = 'var(--background-primary)';
        this.arrowEditorEl.style.border = '2px solid var(--interactive-accent)';
        this.arrowEditorEl.style.borderRadius = '4px';
        this.arrowEditorEl.style.padding = '4px';
        this.arrowEditorEl.style.display = 'flex';
        this.arrowEditorEl.style.gap = '4px';
        this.arrowEditorEl.style.boxShadow = '0 4px 16px rgba(0,0,0,0.2)';
        this.arrowEditorEl.style.left = Math.max(0, screen.x) + 'px';
        this.arrowEditorEl.style.top = Math.max(0, screen.y - 40) + 'px';

        // Start arrowhead toggle
        const startBtn = this.createSmallButton(el.showStartArrow ? '◀' : '—', t('arrowEditor.toggleStart'));
        startBtn.addEventListener('click', () => {
            el.showStartArrow = !el.showStartArrow;
            startBtn.textContent = el.showStartArrow ? '◀' : '—';
            this.engine.saveHistory();
            this.engine.notifyChange();
            this.requestRender();
        });
        this.arrowEditorEl.appendChild(startBtn);

        // End arrowhead toggle
        const endBtn = this.createSmallButton(el.showEndArrow ? '▶' : '—', t('arrowEditor.toggleEnd'));
        endBtn.addEventListener('click', () => {
            el.showEndArrow = !el.showEndArrow;
            endBtn.textContent = el.showEndArrow ? '▶' : '—';
            this.engine.saveHistory();
            this.engine.notifyChange();
            this.requestRender();
        });
        this.arrowEditorEl.appendChild(endBtn);

        // Solid / Dashed toggle
        const dashBtn = this.createSmallButton(el.dashed ? '┅' : '━', t('arrowEditor.toggleDash'));
        dashBtn.addEventListener('click', () => {
            el.dashed = !el.dashed;
            dashBtn.textContent = el.dashed ? '┅' : '━';
            this.engine.saveHistory();
            this.engine.notifyChange();
            this.requestRender();
        });
        this.arrowEditorEl.appendChild(dashBtn);

        // Label toggle
        const labelBtn = this.createSmallButton(el.labelVisible ? 'T' : 'T', t('arrowEditor.toggleLabel'));
        labelBtn.addEventListener('click', () => {
            el.labelVisible = !el.labelVisible;
            if (el.labelVisible && !el.labelContent) {
                el.labelContent = '';
                this.engine.saveHistory();
                this.engine.notifyChange();
                this.engine.editingArrowId = id;
                this.closeEditors();
                this.startArrowLabelEditor(id);
                return;
            }
            this.engine.saveHistory();
            this.engine.notifyChange();
            this.requestRender();
        });
        this.arrowEditorEl.appendChild(labelBtn);

        // Delete button
        const delBtn = this.createSmallButton('✕', t('arrowEditor.delete'));
        delBtn.addEventListener('click', () => {
            this.engine.deleteElement(id);
            this.closeEditors();
            this.requestRender();
        });
        this.arrowEditorEl.appendChild(delBtn);
    }

    closeEditors(): void {
        // Save textarea content before destroying the editor
        if (this.textboxEditorEl && this.engine.editingTextboxId) {
            const textarea = this.textboxEditorEl.querySelector('textarea') as HTMLTextAreaElement | null;
            if (textarea) {
                const el = this.engine.data.elements.find(
                    e => e.id === this.engine.editingTextboxId && e.type === 'textbox'
                ) as TextBoxData | undefined;
                if (el) {
                    const newContent = textarea.value;
                    if (el.content !== newContent) {
                        el.content = newContent;
                        if (el.autoSize && newContent.trim()) {
                            this.autoSizeTextbox(el);
                        }
                        this.engine.saveHistory();
                        this.engine.notifyChange();
                    }
                }
            }
        }

        if (this.textboxEditorEl) {
            this.textboxEditorEl.remove();
            this.textboxEditorEl = null;
        }
        if (this.arrowEditorEl) {
            this.arrowEditorEl.remove();
            this.arrowEditorEl = null;
        }
        // Save label editor content
        if (this.labelEditorEl && this.labelEditorArrowId) {
            const textarea = this.labelEditorEl.querySelector('textarea') as HTMLTextAreaElement | null;
            if (textarea) {
                const arrow = this.engine.data.elements.find(
                    e => e.id === this.labelEditorArrowId && e.type === 'arrow'
                ) as ArrowData | undefined;
                if (arrow) {
                    const newContent = textarea.value;
                    if (arrow.labelContent !== newContent) {
                        arrow.labelContent = newContent;
                        this.engine.saveHistory();
                        this.engine.notifyChange();
                    }
                    if (!textarea.value.trim()) {
                        arrow.labelVisible = false;
                        this.engine.saveHistory();
                        this.engine.notifyChange();
                    }
                }
            }
        }
        if (this.labelEditorEl) {
            this.labelEditorEl.remove();
            this.labelEditorEl = null;
        }
        this.engine.editingTextboxId = null;
        this.engine.editingArrowId = null;
        this.labelEditorArrowId = null;
    }

    startArrowLabelEditor(id: string): void {
        const arrow = this.engine.data.elements.find(e => e.id === id && e.type === 'arrow') as ArrowData | undefined;
        if (!arrow) return;

        this.closeEditors();
        this.labelEditorArrowId = id;

        const mid = this.engine.getArrowMidpoint(arrow);
        const screen = this.engine.canvasToScreen(mid.x, mid.y);

        this.labelEditorEl = this.containerEl.createDiv('simpledraw-arrow-label-editor');
        this.labelEditorEl.style.position = 'absolute';
        this.labelEditorEl.style.zIndex = '200';
        this.labelEditorEl.style.background = 'var(--background-primary)';
        this.labelEditorEl.style.border = '2px solid var(--interactive-accent)';
        this.labelEditorEl.style.borderRadius = '4px';
        this.labelEditorEl.style.padding = '8px';
        this.labelEditorEl.style.boxShadow = '0 4px 16px rgba(0,0,0,0.2)';
        this.labelEditorEl.style.minWidth = '200px';
        this.labelEditorEl.style.maxWidth = '500px';

        const viewRect = this.containerEl.getBoundingClientRect();
        let left = Math.max(0, screen.x - 100);
        let top = screen.y + 10;
        if (top + 180 > viewRect.height) {
            top = screen.y - 180;
        }
        top = Math.max(0, top);
        this.labelEditorEl.style.left = left + 'px';
        this.labelEditorEl.style.top = top + 'px';

        // Toolbar: font size + position + confirm
        const toolbar = this.labelEditorEl.createDiv('simpledraw-editor-toolbar');
        toolbar.style.display = 'flex';
        toolbar.style.gap = '4px';
        toolbar.style.marginBottom = '8px';
        toolbar.style.alignItems = 'center';

        const sizeDisplay = toolbar.createSpan();
        sizeDisplay.textContent = (arrow.labelFontSize ?? this.settings.labelDefaultFontSize) + 'px';
        sizeDisplay.style.fontSize = '12px';
        sizeDisplay.style.color = 'var(--text-muted)';
        sizeDisplay.style.minWidth = '30px';
        sizeDisplay.style.textAlign = 'right';

        const updateSizeDisplay = () => {
            sizeDisplay.textContent = (arrow.labelFontSize ?? this.settings.labelDefaultFontSize) + 'px';
        };

        const shrinkBtn = this.createSmallButton('A-', t('textboxEditor.fontSize.shrink'));
        shrinkBtn.addEventListener('click', () => {
            arrow.labelFontSize = Math.max(8, (arrow.labelFontSize ?? this.settings.labelDefaultFontSize) - 2);
            updateSizeDisplay();
            this.engine.saveHistory();
            this.engine.notifyChange();
            this.requestRender();
        });
        toolbar.appendChild(shrinkBtn);

        const growBtn = this.createSmallButton('A+', t('textboxEditor.fontSize.grow'));
        growBtn.addEventListener('click', () => {
            arrow.labelFontSize = Math.min(72, (arrow.labelFontSize ?? this.settings.labelDefaultFontSize) + 2);
            updateSizeDisplay();
            this.engine.saveHistory();
            this.engine.notifyChange();
            this.requestRender();
        });
        toolbar.appendChild(growBtn);

        const resetBtn = this.createSmallButton('R', t('textboxEditor.fontSize.reset'));
        resetBtn.addEventListener('click', () => {
            arrow.labelFontSize = this.settings.labelDefaultFontSize;
            updateSizeDisplay();
            this.engine.saveHistory();
            this.engine.notifyChange();
            this.requestRender();
        });
        toolbar.appendChild(resetBtn);

        toolbar.appendChild(sizeDisplay);

        // Position toggle buttons
        const positions: Array<{ key: 'overlap' | 'above' | 'below'; icon: string }> = [
            { key: 'overlap', icon: '⊥' },
            { key: 'above', icon: '↑' },
            { key: 'below', icon: '↓' },
        ];
        const currentPos = arrow.labelPosition ?? 'overlap';
        for (const p of positions) {
            const posBtn = this.createSmallButton(p.icon, t('arrowLabelEditor.position.' + p.key));
            posBtn.style.marginLeft = p.key === 'overlap' ? '8px' : '0';
            if (p.key === currentPos) {
                posBtn.style.background = 'var(--interactive-accent)';
                posBtn.style.color = 'var(--text-on-accent)';
            }
            posBtn.addEventListener('click', () => {
                arrow.labelPosition = p.key;
                this.engine.saveHistory();
                this.engine.notifyChange();
                this.requestRender();
                this.startArrowLabelEditor(id);
            });
            toolbar.appendChild(posBtn);
        }

        // Confirm button
        const confirmBtn = this.createSmallButton('✓', t('arrowLabelEditor.confirm'));
        confirmBtn.style.marginLeft = 'auto';
        confirmBtn.style.background = 'var(--interactive-accent)';
        confirmBtn.style.color = 'var(--text-on-accent)';
        confirmBtn.addEventListener('click', () => {
            this.closeEditors();
            this.requestRender();
        });
        toolbar.appendChild(confirmBtn);

        // Textarea
        const textarea = this.labelEditorEl.createEl('textarea');
        textarea.style.width = '100%';
        textarea.style.minHeight = '60px';
        textarea.style.resize = 'both';
        textarea.style.border = '1px solid var(--background-modifier-border)';
        textarea.style.borderRadius = '4px';
        textarea.style.padding = '6px';
        textarea.style.background = 'var(--background-primary)';
        textarea.style.color = 'var(--text-normal)';
        textarea.style.fontFamily = 'var(--font-text)';
        textarea.style.fontSize = 'var(--font-text-size)';
        textarea.value = arrow.labelContent ?? '';
        // Immediately grow to fit existing content
        textarea.style.height = 'auto';
        textarea.style.height = Math.max(60, textarea.scrollHeight) + 'px';
        textarea.placeholder = t('arrowLabelEditor.placeholder');
        textarea.focus();

        textarea.addEventListener('keydown', (ev) => {
            if (ev.key === 'Escape') {
                ev.stopPropagation();
                this.closeEditors();
                this.requestRender();
                return;
            }
        });

        textarea.addEventListener('input', () => {
            arrow.labelContent = textarea.value;
            // Auto-grow textarea to fit content
            textarea.style.height = 'auto';
            textarea.style.height = Math.max(60, textarea.scrollHeight) + 'px';
            this.requestRender();
        });

        this.requestRender();
    }

    // --- Markdown Rendering ---

    async renderMarkdownInElement(markdown: string, el: HTMLElement, sourcePath: string): Promise<void> {
        await MarkdownRenderer.render(this.app, markdown, el, sourcePath, this);
    }

    async rebuildTextboxContent(id: string): Promise<void> {
        const tb = this.engine.data.elements.find(e => e.id === id && e.type === 'textbox') as TextBoxData | undefined;
        if (tb) {
            this.renderTextboxDOM(tb);
        }
    }

    applyTextAlignment(el: HTMLElement, tb: TextBoxData): void {
        const parent = el.parentElement;
        if (parent) {
            parent.style.display = '';
            parent.style.justifyContent = '';
            parent.style.alignItems = '';
        }

        const isVertical = (tb.writingMode ?? 'horizontal-tb') === 'vertical-rl';
        el.style.writingMode = tb.writingMode ?? 'horizontal-tb';

        // Content div: use flex so children stack in the block direction
        el.style.display = 'flex';
        el.style.flexDirection = isVertical ? 'row' : 'column';
        el.style.width = '100%';
        el.style.height = '100%';

        // Alignment: in vertical mode main axis is row (horizontal), cross axis is column
        if (isVertical) {
            // vAlign maps to justify-content (main axis = horizontal for row)
            switch (tb.vAlign) {
                case 'top': el.style.justifyContent = 'flex-start'; break;
                case 'middle': el.style.justifyContent = 'center'; break;
                case 'bottom': el.style.justifyContent = 'flex-end'; break;
            }
            // hAlign maps to align-items (cross axis = vertical for row)
            switch (tb.hAlign) {
                case 'left': el.style.alignItems = 'flex-start'; break;
                case 'center': el.style.alignItems = 'center'; break;
                case 'right': el.style.alignItems = 'flex-end'; break;
            }
            // text-align only affects inline content, not flex children
            el.style.textAlign = 'start';
        } else {
            // Horizontal mode: vAlign = justify-content (main axis = column)
            switch (tb.vAlign) {
                case 'top': el.style.justifyContent = 'flex-start'; break;
                case 'middle': el.style.justifyContent = 'center'; break;
                case 'bottom': el.style.justifyContent = 'flex-end'; break;
            }
            // Horizontal alignment: text-align for inline content
            el.style.textAlign = tb.hAlign;
        }
    }

    // --- Rendering ---

    startRenderLoop(): void {
        if (this.animFrameId) {
            cancelAnimationFrame(this.animFrameId);
            this.animFrameId = 0;
        }

        // Main loop: requestAnimationFrame
        const loop = () => {
            if (this.needsRender) {
                this.needsRender = false;
                this.render();
            }
            this.animFrameId = requestAnimationFrame(loop);
        };
        this.animFrameId = requestAnimationFrame(loop);

        // Fallback: MessageChannel — unlike setTimeout, this is NOT throttled
        // by Chromium when the page is in background (main window hidden).
        // The loop is demand-driven: only awakened when there's work to do.
        if (!this._fallbackChannel) {
            const channel = new MessageChannel();
            this._fallbackChannel = channel;
            channel.port1.onmessage = () => {
                if (this.needsRender) {
                    this.needsRender = false;
                    this.render();
                    // Continue if more work may be coming (e.g. ongoing drag)
                    channel.port2.postMessage(null);
                }
            };
        }
    }

    requestRender(): void {
        if (!this.needsRender) {
            this.needsRender = true;
            // Wake up the MessageChannel fallback loop
            if (this._fallbackChannel) {
                this._fallbackChannel.port2.postMessage(null);
            }
        }
        if (!this.animFrameId) {
            this.startRenderLoop();
        }
    }

    updateViewportTransform(): void {
        const vs = this.engine.data.viewState;
        this.viewportEl.style.transform = `translate(${vs.panX}px, ${vs.panY}px) scale(${vs.zoom})`;
        this.updateGrid();
    }

    updateGrid(): void {
        const vs = this.engine.data.viewState;
        if (this.settings.showGrid) {
            const gs = GRID_SIZE * vs.zoom;
            this.gridEl.style.backgroundImage = `
                linear-gradient(rgba(128,128,128,0.1) 1px, transparent 1px),
                linear-gradient(90deg, rgba(128,128,128,0.1) 1px, transparent 1px)
            `;
            this.gridEl.style.backgroundSize = `${gs}px ${gs}px`;
            this.gridEl.style.display = 'block';
        } else {
            this.gridEl.style.display = 'none';
        }
    }

    render(): void {
        this.updateViewportTransform();
        this.renderTextboxes();
        this.renderArrows();
        this.renderPreviews();
        this.renderSelectionBox();
    }

    renderArrows(): void {
        this.svgLayer.innerHTML = '';
        // Clean up previously rendered anchored-arrow SVGs from the elements layer
        this.elementsLayer.querySelectorAll('.simpledraw-anchored-arrow').forEach(el => el.remove());

        const arrowW = this.settings.arrowStrokeWidth;
        const headSize = this.settings.arrowHeadSize;
        const accentColor = getComputedStyle(this.containerEl).getPropertyValue('--interactive-accent').trim() || '#4a90d9';
        const mutedColor = getComputedStyle(this.containerEl).getPropertyValue('--text-muted').trim() || '#888888';

        // Helper: find all textbox ids an arrow connects to
        const connectedIds = (arrow: ArrowData): string[] => {
            const ids: string[] = [];
            if ('elementId' in arrow.startConnection) ids.push(arrow.startConnection.elementId);
            if ('elementId' in arrow.endConnection)   ids.push(arrow.endConnection.elementId);
            return ids;
        };

        // Helper: render a single arrow's path + arrowheads + dots into a container SVG
        const renderInto = (svg: SVGElement, arrow: ArrowData, isSelected: boolean) => {
            const strokeColor = isSelected ? accentColor : mutedColor;
            const strokeW = isSelected ? arrowW + 1 : arrowW;
            const points = this.engine.buildArrowPath(arrow.startConnection, arrow.endConnection, arrow.arrowDirection);

            if (points.length >= 2) {
                const linePts = points.slice();
                if (arrow.showEndArrow) {
                    const last = points[points.length - 1]!;
                    const prev = points[points.length - 2]!;
                    const eAngle = Math.atan2(last.y - prev.y, last.x - prev.x);
                    linePts[linePts.length - 1] = {
                        x: last.x - Math.cos(eAngle) * headSize,
                        y: last.y - Math.sin(eAngle) * headSize,
                    };
                }
                const lineOrigin = linePts[0]!;
                const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
                const d = 'M ' + lineOrigin.x + ' ' + lineOrigin.y + linePts.slice(1).map(p => ' L ' + p.x + ' ' + p.y).join('');
                path.setAttribute('d', d);
                path.style.stroke = strokeColor;
                path.setAttribute('stroke-width', String(strokeW));
                if (arrow.dashed) {
                    path.setAttribute('stroke-dasharray', '6,4');
                }
                path.setAttribute('fill', 'none');
                path.setAttribute('stroke-linejoin', 'round');
                svg.appendChild(path);
            }

            // End arrowhead
            if (arrow.showEndArrow && points.length >= 2) {
                const last = points[points.length - 1]!;
                const prev = points[points.length - 2]!;
                this.drawArrowhead(last.x, last.y, prev.x, prev.y, strokeColor, headSize, false, svg);
            }

            // Start arrowhead
            if (arrow.showStartArrow && points.length >= 2) {
                const first = points[0]!;
                const next = points[1]!;
                this.drawArrowhead(first.x, first.y, next.x, next.y, strokeColor, headSize, true, svg);
            }

            // Anchor dots (conditional)
            if (this.settings.showAnchorDots) {
                const start = this.engine.resolveConnection(arrow.startConnection);
                const end = this.engine.resolveConnection(arrow.endConnection);
                this.drawAnchorDot(start.x, start.y, isSelected ? accentColor : mutedColor, svg);
                this.drawAnchorDot(end.x, end.y, isSelected ? accentColor : mutedColor, svg);
            }
        };

        for (const el of this.engine.data.elements) {
            if (el.type !== 'arrow') continue;
            const arrow = el as ArrowData;
            const isSelected = this.engine.selectedIds.has(arrow.id);

            const ids = connectedIds(arrow);
            if (ids.length > 0) {
                // Anchored arrow — render into a dedicated SVG inside elementsLayer
                // to follow the textbox z-order.
                const arrowSvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
                arrowSvg.classList.add('simpledraw-anchored-arrow');
                arrowSvg.style.position = 'absolute';
                arrowSvg.style.top = '0';
                arrowSvg.style.left = '0';
                arrowSvg.style.width = '100%';
                arrowSvg.style.height = '100%';
                arrowSvg.style.pointerEvents = 'none';
                arrowSvg.style.overflow = 'visible';

                renderInto(arrowSvg, arrow, isSelected);

                // Insert after the highest-z connected textbox wrapper.
                // Z-order is determined by array index: later index → later in DOM → higher z.
                let maxIdx = -1;
                let insertAfter: Element | null = null;
                for (const id of ids) {
                    const idx = this.engine.data.elements.findIndex(e => e.id === id);
                    if (idx > maxIdx) {
                        maxIdx = idx;
                        insertAfter = this.elementsLayer.querySelector(`[data-id="${id}"]`);
                    }
                }
                if (insertAfter && insertAfter.parentNode) {
                    insertAfter.parentNode.insertBefore(arrowSvg, insertAfter.nextSibling);
                } else {
                    this.elementsLayer.appendChild(arrowSvg);
                }
            } else {
                // Free arrow — render into the shared svgLayer (static z-index)
                renderInto(this.svgLayer, arrow, isSelected);
            }
        }

        // Diamond textbox borders (draw in svgLayer for reliable export)
        for (const el of this.engine.data.elements) {
            if (el.type !== 'textbox') continue;
            const tb = el as TextBoxData;
            if ((tb.shape ?? 'rectangle') !== 'diamond') continue;
            if (!tb.visible && !this.engine.selectedIds.has(tb.id)) continue;
            const isSelected = this.engine.selectedIds.has(tb.id);
            const strokeColor = isSelected ? accentColor : mutedColor;
            const strokeW = isSelected ? arrowW + 1 : arrowW;
            const w = tb.width;
            const h = tb.height;
            const poly = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
            poly.setAttribute('points', `${tb.x + w / 2},${tb.y} ${tb.x + w},${tb.y + h / 2} ${tb.x + w / 2},${tb.y + h} ${tb.x},${tb.y + h / 2}`);
            poly.setAttribute('fill', 'none');
            poly.style.stroke = strokeColor;
            poly.setAttribute('stroke-width', String(strokeW));
            poly.setAttribute('stroke-linejoin', 'round');
            this.svgLayer.appendChild(poly);
        }

        // Arrow labels
        const validArrowIds = new Set<string>();
        for (const el of this.engine.data.elements) {
            if (el.type !== 'arrow') continue;
            const arrow = el as ArrowData;
            if (!arrow.labelVisible) continue;
            validArrowIds.add(arrow.id);

            const mid = this.engine.getArrowMidpoint(arrow);
            const offset = this.engine.getLabelOffset(arrow, arrow.labelPosition ?? 'overlap');
            let labelEl = this.elementsLayer.querySelector(`[data-arrow-label-id="${arrow.id}"]`) as HTMLElement | null;
            if (!labelEl) {
                labelEl = this.elementsLayer.createDiv('simpledraw-arrow-label');
                labelEl.dataset.arrowLabelId = arrow.id;
                labelEl.style.position = 'absolute';
                labelEl.style.pointerEvents = 'auto';
                labelEl.style.transform = 'translate(-50%, -50%)';
                labelEl.style.background = 'transparent';
                labelEl.style.border = 'none';
                labelEl.style.borderRadius = '0';
                labelEl.style.padding = '2px 4px';
                labelEl.style.textAlign = 'center';
                labelEl.style.cursor = 'pointer';
                labelEl.style.wordBreak = 'break-word';
                labelEl.style.boxSizing = 'border-box';

                const content = labelEl.createDiv('simpledraw-arrow-label-content');
                content.style.fontSize = (arrow.labelFontSize ?? this.settings.labelDefaultFontSize) + 'px';
                content.style.lineHeight = '1.3';

                labelEl.appendChild(content);

                // z-order: insert after the highest-z connected textbox (one-time only on creation)
                const connectIds: string[] = [];
                if ('elementId' in arrow.startConnection) connectIds.push(arrow.startConnection.elementId);
                if ('elementId' in arrow.endConnection) connectIds.push(arrow.endConnection.elementId);
                if (connectIds.length > 0) {
                    let maxIdx = -1;
                    let ref: Element | null = null;
                    for (const cid of connectIds) {
                        const idx = this.engine.data.elements.findIndex(e => e.id === cid);
                        if (idx > maxIdx) { maxIdx = idx; ref = this.elementsLayer.querySelector(`[data-id="${cid}"]`); }
                    }
                    if (ref && ref.parentNode) {
                        ref.parentNode.insertBefore(labelEl, ref.nextSibling);
                    }
                }
            }

            labelEl.style.left = (mid.x + offset.x) + 'px';
            labelEl.style.top = (mid.y + offset.y) + 'px';

            // Apply explicit width/height if set
            if (arrow.labelWidth) {
                labelEl.style.width = arrow.labelWidth + 'px';
                labelEl.style.maxWidth = 'none';
            } else {
                labelEl.style.width = '';
                labelEl.style.maxWidth = '200px';
            }
            if (arrow.labelHeight) {
                labelEl.style.height = arrow.labelHeight + 'px';
                labelEl.style.overflow = 'hidden';
            } else {
                labelEl.style.height = '';
                labelEl.style.overflow = 'visible';
            }

            const contentEl = labelEl.querySelector('.simpledraw-arrow-label-content') as HTMLElement;
            if (contentEl) {
                const content = arrow.labelContent ?? '';
                const rendered = contentEl.getAttribute('data-rendered') ?? '';
                if (rendered !== content) {
                    contentEl.empty();
                    contentEl.setAttribute('data-rendered', content);
                    if (content.trim()) {
                        contentEl.style.opacity = '';
                        contentEl.style.color = '';
                        MarkdownRenderer.render(this.app, content, contentEl, this.file?.path ?? '', this);
                    } else {
                        contentEl.textContent = t('arrowLabelEditor.placeholder');
                        contentEl.style.opacity = '0.5';
                        contentEl.style.color = 'var(--text-muted)';
                    }
                }
                contentEl.style.fontSize = (arrow.labelFontSize ?? this.settings.labelDefaultFontSize) + 'px';
            }

            // Resize handles (only when arrow is selected and not actively in label editor)
            const isSelected = this.engine.selectedIds.has(arrow.id);
            const isEditingLabel = (this.labelEditorArrowId === arrow.id);
            if (isSelected && !isEditingLabel) {
                const handles = labelEl.querySelectorAll('.simpledraw-label-resize-handle');
                if (handles.length === 0) {
                    for (const pos of ['se', 'sw', 'ne', 'nw']) {
                        const h = document.createElement('div');
                        h.className = 'simpledraw-label-resize-handle';
                        h.dataset.labelHandleId = arrow.id;
                        h.dataset.handle = pos;
                        h.style.position = 'absolute';
                        h.style.width = '8px';
                        h.style.height = '8px';
                        h.style.background = 'var(--interactive-accent)';
                        h.style.cursor = pos === 'se' || pos === 'nw' ? 'nwse-resize' : 'nesw-resize';
                        h.style.zIndex = '10';
                        h.style.pointerEvents = 'auto';
                        switch (pos) {
                            case 'se': h.style.bottom = '-4px'; h.style.right = '-4px'; break;
                            case 'sw': h.style.bottom = '-4px'; h.style.left = '-4px'; break;
                            case 'ne': h.style.top = '-4px'; h.style.right = '-4px'; break;
                            case 'nw': h.style.top = '-4px'; h.style.left = '-4px'; break;
                        }
                        labelEl.appendChild(h);
                    }
                }
            } else {
                labelEl.querySelectorAll('.simpledraw-label-resize-handle').forEach(h => h.remove());
            }
        }
        // Remove stale label elements
        this.elementsLayer.querySelectorAll('[data-arrow-label-id]').forEach(el => {
            const id = (el as HTMLElement).dataset.arrowLabelId;
            if (id && !validArrowIds.has(id)) {
                el.remove();
            }
        });
    }

    drawArrowhead(tipX: number, tipY: number, fromX: number, fromY: number, color: string, size: number, reverse: boolean, parentSvg?: SVGElement): void {
        const angle = Math.atan2(tipY - fromY, tipX - fromX);
        // Base behind tip (toward 'from'). The path stops at 'from', arrowhead fills the gap.
        const baseX = tipX - Math.cos(angle) * size;
        const baseY = tipY - Math.sin(angle) * size;

        const shape = this.settings.arrowShape;
        const halfW = size * 0.45; // Half-width of arrow base

        if (shape === 'circle') {
            const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
            circle.setAttribute('cx', String(tipX));
            circle.setAttribute('cy', String(tipY));
            circle.setAttribute('r', String(size * 0.4));
            circle.style.fill = color;
            (parentSvg || this.svgLayer).appendChild(circle);
            return;
        }

        if (shape === 'v-shape') {
            // Extend arms so their forward projection reaches the base (eliminates gap)
            const armLen = size / Math.cos(0.6);
            const lx1 = tipX - Math.cos(angle + 0.6) * armLen;
            const ly1 = tipY - Math.sin(angle + 0.6) * armLen;
            const lx2 = tipX - Math.cos(angle - 0.6) * armLen;
            const ly2 = tipY - Math.sin(angle - 0.6) * armLen;

            const poly = document.createElementNS('http://www.w3.org/2000/svg', 'polyline');
            poly.setAttribute('points', `${lx1},${ly1} ${tipX},${tipY} ${lx2},${ly2}`);
            poly.style.stroke = color;
            poly.setAttribute('stroke-width', String(this.settings.arrowStrokeWidth));
            poly.setAttribute('fill', 'none');
            poly.setAttribute('stroke-linejoin', 'round');
            (parentSvg || this.svgLayer).appendChild(poly);
            return;
        }

        // Triangle (filled or open): base corners perpendicular to line at base
        const perpX = Math.cos(angle + Math.PI / 2);
        const perpY = Math.sin(angle + Math.PI / 2);

        const bx = baseX + perpX * halfW;
        const by = baseY + perpY * halfW;
        const cx = baseX - perpX * halfW;
        const cy = baseY - perpY * halfW;

        const poly = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
        poly.setAttribute('points', `${tipX},${tipY} ${bx},${by} ${cx},${cy}`);

        if (shape === 'open-triangle') {
            poly.style.stroke = color;
            poly.setAttribute('stroke-width', String(this.settings.arrowStrokeWidth));
            poly.style.fill = 'none';
            poly.setAttribute('stroke-linejoin', 'round');
        } else {
            poly.style.fill = color;
        }
        (parentSvg || this.svgLayer).appendChild(poly);
    }

    drawAnchorDot(x: number, y: number, color: string, parentSvg?: SVGElement): void {
        const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
        circle.setAttribute('cx', x.toString());
        circle.setAttribute('cy', y.toString());
        circle.setAttribute('r', '2.5');
        circle.style.fill = color;
        circle.style.stroke = '#fff';
        circle.setAttribute('stroke-width', '0.5');
        (parentSvg || this.svgLayer).appendChild(circle);
    }

    renderTextboxes(): void {
        for (const el of this.engine.data.elements) {
            if (el.type !== 'textbox') continue;
            const tb = el as TextBoxData;
            this.renderTextboxDOM(tb);
        }
        // Remove stale DOM elements
        const validIds = new Set(this.engine.data.elements.filter(e => e.type === 'textbox').map(e => e.id));
        this.elementsLayer.querySelectorAll('.simpledraw-textbox').forEach(el => {
            const id = (el as HTMLElement).dataset.id;
            if (id && !validIds.has(id)) {
                el.remove();
            }
        });
    }

    renderTextboxDOM(tb: TextBoxData): void {
        let wrapper = this.elementsLayer.querySelector(`[data-id="${tb.id}"]`) as HTMLElement | null;
        let container: HTMLElement | null;
        let content: HTMLElement | null;

        if (!wrapper) {
            // Create new
            wrapper = this.elementsLayer.createDiv('simpledraw-textbox');
            wrapper.dataset.id = tb.id;
            wrapper.style.position = 'absolute';
            wrapper.style.pointerEvents = 'auto';

            container = wrapper.createDiv('simpledraw-textbox-inner');
            container.style.position = 'relative';
            container.style.borderRadius = '0px';
            container.style.boxSizing = 'border-box';
            container.style.overflow = 'hidden';

            content = container.createDiv('simpledraw-textbox-content');
            content.style.padding = '4px';
            content.style.boxSizing = 'border-box';

            // Resize handles
            const positions = ['se', 'sw', 'ne', 'nw'] as const;
            for (const pos of positions) {
                const handle = wrapper.createDiv('simpledraw-resize-handle');
                handle.dataset.handle = pos;
                handle.style.position = 'absolute';
                handle.style.width = '8px';
                handle.style.height = '8px';
                handle.style.background = 'var(--interactive-accent)';
                handle.style.borderRadius = '0px';
                handle.style.pointerEvents = 'auto';
                handle.style.cursor = this.getResizeCursor(pos);
                handle.style.zIndex = '10';
                switch (pos) {
                    case 'se': handle.style.bottom = '-4px'; handle.style.right = '-4px'; break;
                    case 'sw': handle.style.bottom = '-4px'; handle.style.left = '-4px'; break;
                    case 'ne': handle.style.top = '-4px'; handle.style.right = '-4px'; break;
                    case 'nw': handle.style.top = '-4px'; handle.style.left = '-4px'; break;
                }
            }
        } else {
            container = wrapper.querySelector('.simpledraw-textbox-inner') as HTMLElement;
            content = wrapper.querySelector('.simpledraw-textbox-content') as HTMLElement;
        }

        if (!container || !content) return;

        const isSelected = this.engine.selectedIds.has(tb.id);
        const isEditing = this.engine.editingTextboxId === tb.id;

        // Position and size
        wrapper.style.left = tb.x + 'px';
        wrapper.style.top = tb.y + 'px';
        wrapper.style.width = tb.width + 'px';
        wrapper.style.height = tb.height + 'px';

        container.style.width = '100%';
        container.style.height = '100%';

        // Visibility (controls border + background)
        const isClipped = (tb.shape ?? 'rectangle') === 'diamond';
        // (ellipse uses border-radius + CSS border, which works correctly both in DOM and export)
        if (!tb.visible) {
            wrapper.style.setProperty('background', 'transparent', 'important');
            container.style.setProperty('background', 'transparent', 'important');
            content.style.setProperty('background', 'transparent', 'important');
            for (const child of Array.from(content.children)) {
                (child as HTMLElement).style.setProperty('background', 'transparent', 'important');
                (child as HTMLElement).style.setProperty('background-color', 'transparent', 'important');
            }
            if (isSelected || isEditing) {
                if (isClipped) {
                    container.style.border = 'none';
                } else {
                    container.style.borderColor = 'var(--interactive-accent)';
                    container.style.borderWidth = '2px';
                    container.style.borderStyle = 'solid';
                }
            } else {
                container.style.border = 'none';
            }
        } else if (tb.fillEnabled) {
            // Fill ON: solid background
            wrapper.style.setProperty('background', isClipped ? 'transparent' : 'var(--background-secondary, #f0f0f0)', 'important');
            if (isClipped) {
                container.style.border = 'none';
            } else {
                container.style.borderColor = isSelected || isEditing ? 'var(--interactive-accent)' : 'var(--text-muted)';
                container.style.borderWidth = (isSelected || isEditing) ? '2px' : '1px';
                container.style.borderStyle = 'solid';
            }
            container.style.setProperty('background', 'var(--background-secondary, #f0f0f0)', 'important');
            content.style.removeProperty('background');
            content.style.setProperty('background-color', 'transparent', 'important');
        } else {
            // Fill OFF: wireframe — transparent bg, visible border
            wrapper.style.setProperty('background', 'transparent', 'important');
            if (isClipped) {
                container.style.border = 'none';
            } else {
                container.style.borderColor = isSelected || isEditing ? 'var(--interactive-accent)' : 'var(--text-muted)';
                container.style.borderWidth = (isSelected || isEditing) ? '2px' : '1px';
                container.style.borderStyle = 'solid';
            }
            container.style.setProperty('background', 'transparent', 'important');
            content.style.setProperty('background', 'transparent', 'important');
            // Strip backgrounds from Obsidian-rendered children
            for (const child of Array.from(content.children)) {
                (child as HTMLElement).style.setProperty('background', 'transparent', 'important');
                (child as HTMLElement).style.setProperty('background-color', 'transparent', 'important');
            }
        }

        // Shape clipping
        const shape = tb.shape ?? 'rectangle';
        if (shape === 'ellipse') {
            container.style.borderRadius = '50%';
            container.style.clipPath = 'none';
            container.style.overflow = '';
            wrapper.style.borderRadius = '50%';
        } else if (shape === 'diamond') {
            container.style.borderRadius = '0';
            container.style.clipPath = 'polygon(50% 0%, 100% 50%, 50% 100%, 0% 50%)';
            container.style.overflow = 'visible';
        } else {
            container.style.borderRadius = '';
            container.style.clipPath = 'none';
            container.style.overflow = '';
        }

        // Content — always visible regardless of `visible` flag
        content.style.display = '';
        content.style.width = '100%';
        content.style.height = '100%';
        content.style.fontSize = (tb.fontSize ?? 16) + 'px';

        this.applyTextAlignment(content, tb);

        // Track what's currently rendered to avoid unnecessary re-renders
        const currentRendered = content.getAttribute('data-rendered-content') ?? '';
        if (currentRendered !== tb.content) {
            content.empty();
            content.setAttribute('data-rendered-content', tb.content);
            if (tb.content.trim()) {
                MarkdownRenderer.render(this.app, tb.content, content, this.file?.path ?? '', this);
            }
        }

        // Resize handles
        const handles = wrapper.querySelectorAll('.simpledraw-resize-handle');
        handles.forEach(h => {
            (h as HTMLElement).style.display = (isSelected && !isEditing) ? 'block' : 'none';
        });

        // Lock icon
        let lockIcon = wrapper.querySelector('.simpledraw-lock-icon') as HTMLElement | null;
        if (tb.locked) {
            if (!lockIcon) {
                lockIcon = wrapper.createDiv('simpledraw-lock-icon');
                lockIcon.style.position = 'absolute';
                lockIcon.style.top = '2px';
                lockIcon.style.right = '2px';
                lockIcon.style.fontSize = '12px';
                lockIcon.style.pointerEvents = 'none';
                lockIcon.style.zIndex = '15';
                lockIcon.style.opacity = '0.6';
                lockIcon.textContent = '🔒';
            }
        } else {
            if (lockIcon) lockIcon.remove();
        }
    }

    getResizeCursor(handle: string): string {
        switch (handle) {
            case 'se': case 'nw': return 'nwse-resize';
            case 'sw': case 'ne': return 'nesw-resize';
            default: return 'nwse-resize';
        }
    }

    renderPreviews(): void {
        this.previewLayer.innerHTML = '';
        // Clean up snap-preview SVGs that are direct children of viewportEl
        this.viewportEl.querySelectorAll('.simpledraw-snap-preview').forEach(el => el.remove());

        // Textbox insert preview: rectangle from first click to current mouse
        if (this.engine.mode === InteractionMode.InsertTextBox && this.engine.textBoxInsertState.firstClick) {
            const fc = this.engine.textBoxInsertState.firstClick;
            const mx = this.lastCanvasMouse.x;
            const my = this.lastCanvasMouse.y;
            const x = Math.min(fc.x, mx);
            const y = Math.min(fc.y, my);
            const w = Math.abs(mx - fc.x);
            const h = Math.abs(my - fc.y);

            const preview = this.previewLayer.createDiv('simpledraw-preview-rect');
            preview.style.position = 'absolute';
            preview.style.left = x + 'px';
            preview.style.top = y + 'px';
            preview.style.width = Math.max(w, 1) + 'px';
            preview.style.height = Math.max(h, 1) + 'px';
            preview.style.border = '2px dashed var(--interactive-accent)';
            preview.style.backgroundColor = 'rgba(74, 144, 217, 0.05)';
            preview.style.pointerEvents = 'none';
        }

        // Arrow snap preview before first click
        if (this.engine.mode === InteractionMode.InsertArrow && !this.engine.arrowInsertState.firstClick) {
            const mx = this.engine.arrowInsertState.mouseX;
            const my = this.engine.arrowInsertState.mouseY;
            const snapped = this.engine.findNearestAnchor(mx, my);
            if (snapped) {
                const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
                svg.style.position = 'absolute';
                svg.style.top = '0';
                svg.style.left = '0';
                svg.style.width = '100%';
                svg.style.height = '100%';
                svg.style.pointerEvents = 'none';
                svg.style.overflow = 'visible';
                svg.style.zIndex = '9999';
                svg.classList.add('simpledraw-snap-preview');
                const snapCircle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
                snapCircle.setAttribute('cx', String(snapped.x));
                snapCircle.setAttribute('cy', String(snapped.y));
                snapCircle.setAttribute('r', String(this.settings.snapPreviewRadius));
                snapCircle.style.fill = 'rgba(74, 144, 217, 0.3)';
                snapCircle.style.stroke = '#4a90d9';
                snapCircle.setAttribute('stroke-width', '2');
                svg.appendChild(snapCircle);
                this.viewportEl.appendChild(svg);
            }
        }

        // Arrow insert preview
        if (this.engine.mode === InteractionMode.InsertArrow && this.engine.arrowInsertState.firstClick) {
            const fc = this.engine.arrowInsertState.firstClick;
            let mx = this.engine.arrowInsertState.mouseX;
            let my = this.engine.arrowInsertState.mouseY;

            // Show snap highlight at current mouse position
            const snapped = this.engine.findNearestAnchor(mx, my);
            if (snapped) {
                mx = snapped.x;
                my = snapped.y;
                // Highlight snapped anchor
                {
                    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
                    svg.style.position = 'absolute';
                    svg.style.top = '0';
                    svg.style.left = '0';
                    svg.style.width = '100%';
                    svg.style.height = '100%';
                    svg.style.pointerEvents = 'none';
                    svg.style.overflow = 'visible';
                    svg.style.zIndex = '9999';
                    svg.classList.add('simpledraw-snap-preview');
                    const snapCircle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
                    snapCircle.setAttribute('cx', String(snapped.x));
                    snapCircle.setAttribute('cy', String(snapped.y));
                    snapCircle.setAttribute('r', String(this.settings.snapPreviewRadius));
                    snapCircle.style.fill = 'rgba(74, 144, 217, 0.3)';
                    snapCircle.style.stroke = '#4a90d9';
                    snapCircle.setAttribute('stroke-width', '2');
                    svg.appendChild(snapCircle);
                    this.viewportEl.appendChild(svg);
                }
            }

            // Draw start point dot to show first click is locked in
            {
                const startDot = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
                startDot.style.position = 'absolute';
                startDot.style.top = '0';
                startDot.style.left = '0';
                startDot.style.width = '100%';
                startDot.style.height = '100%';
                startDot.style.pointerEvents = 'none';
                startDot.style.overflow = 'visible';
                startDot.style.zIndex = '9999';
                startDot.classList.add('simpledraw-snap-preview');
                const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
                circle.setAttribute('cx', String(fc.x));
                circle.setAttribute('cy', String(fc.y));
                circle.setAttribute('r', '5');
                circle.style.fill = '#4a90d9';
                startDot.appendChild(circle);
                this.viewportEl.appendChild(startDot);
            }

            // Build preview path using the routing engine
            const tempStartConn: ArrowConnection | FreePoint = this.getTempConnection(fc.x, fc.y);
            const tempEndConn: ArrowConnection | FreePoint = snapped
                ? { elementId: snapped.elementId, anchor: snapped.anchor }
                : { x: mx, y: my };

            const previewPoints = this.engine.buildArrowPath(tempStartConn, tempEndConn, this.engine.arrowDirection);

            const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
            svg.style.position = 'absolute';
            svg.style.top = '0';
            svg.style.left = '0';
            svg.style.width = '100%';
            svg.style.height = '100%';
            svg.style.pointerEvents = 'none';
            svg.style.overflow = 'visible';
            svg.style.zIndex = '9999';
            svg.classList.add('simpledraw-snap-preview');

            // Draw preview path (extend to arrowhead base so no gap)
            {
                const pLinePts = previewPoints.slice();
                const pLast = previewPoints[previewPoints.length - 1]!;
                const pPrev = previewPoints[previewPoints.length - 2]!;
                const pEAngle = Math.atan2(pLast.y - pPrev.y, pLast.x - pPrev.x);
                pLinePts[pLinePts.length - 1] = {
                    x: pLast.x - Math.cos(pEAngle) * 8,
                    y: pLast.y - Math.sin(pEAngle) * 8,
                };
                if (pLinePts.length >= 1) {
                    const line = document.createElementNS('http://www.w3.org/2000/svg', 'path');
                    const d = 'M ' + pLinePts[0]!.x + ' ' + pLinePts[0]!.y + pLinePts.slice(1).map(p => ' L ' + p.x + ' ' + p.y).join('');
                    line.setAttribute('d', d);
                    line.style.stroke = '#4a90d9';
                    line.setAttribute('stroke-width', '2');
                    line.setAttribute('stroke-dasharray', '5,5');
                    line.setAttribute('fill', 'none');
                    svg.appendChild(line);
                }
            }

            // Draw arrowhead on preview end
            if (previewPoints.length >= 2) {
                const last = previewPoints[previewPoints.length - 1]!;
                const prev = previewPoints[previewPoints.length - 2]!;
                const pAngle = Math.atan2(last.y - prev.y, last.x - prev.x);
                const pSize = 8;
                const pHalfW = pSize * 0.45;
                const baseX = last.x - Math.cos(pAngle) * pSize;
                const baseY = last.y - Math.sin(pAngle) * pSize;
                const perpPX = Math.cos(pAngle + Math.PI / 2);
                const perpPY = Math.sin(pAngle + Math.PI / 2);

                const arrowPoly = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
                arrowPoly.setAttribute('points',
                    `${last.x},${last.y} ${baseX + perpPX * pHalfW},${baseY + perpPY * pHalfW} ${baseX - perpPX * pHalfW},${baseY - perpPY * pHalfW}`);
                arrowPoly.style.fill = '#4a90d9';
                svg.appendChild(arrowPoly);
            }

            this.viewportEl.appendChild(svg);
        }

        // Resize snap preview lines
        if (this.engine.resizeSnap.active) {
            const accentColor = getComputedStyle(this.containerEl).getPropertyValue('--interactive-accent').trim() || '#4a90d9';
            for (const line of this.engine.resizeSnap.lines) {
                const el = document.createElement('div');
                el.style.position = 'absolute';
                el.style.pointerEvents = 'none';
                el.style.background = accentColor;
                const isVert = Math.abs(line.x1 - line.x2) < 1;
                if (isVert) {
                    el.style.left = line.x1 + 'px';
                    el.style.top = line.y1 + 'px';
                    el.style.width = '1px';
                    el.style.height = (line.y2 - line.y1) + 'px';
                } else {
                    el.style.left = line.x1 + 'px';
                    el.style.top = line.y1 + 'px';
                    el.style.width = (line.x2 - line.x1) + 'px';
                    el.style.height = '1px';
                }
                el.style.opacity = '0.6';
                el.style.zIndex = '30';
                this.previewLayer.appendChild(el);
            }
        }

        // Alignment snap preview lines
        if (this.engine.alignmentSnap.active) {
            const accentColor = getComputedStyle(this.containerEl).getPropertyValue('--interactive-accent').trim() || '#4a90d9';
            for (const line of this.engine.alignmentSnap.lines) {
                const el = document.createElement('div');
                el.style.position = 'absolute';
                el.style.pointerEvents = 'none';
                el.style.background = accentColor;
                const isVert = Math.abs(line.x1 - line.x2) < 1;
                if (isVert) {
                    el.style.left = line.x1 + 'px';
                    el.style.top = line.y1 + 'px';
                    el.style.width = '1px';
                    el.style.height = (line.y2 - line.y1) + 'px';
                } else {
                    el.style.left = line.x1 + 'px';
                    el.style.top = line.y1 + 'px';
                    el.style.width = (line.x2 - line.x1) + 'px';
                    el.style.height = '1px';
                }
                el.style.opacity = '0.6';
                el.style.zIndex = '30';
                this.previewLayer.appendChild(el);
            }
        }
    }

    renderSelectionBox(): void {
        const ss = this.engine.selectionState;
        if (ss?.active) {
            const x = Math.min(ss.startX, ss.currentX);
            const y = Math.min(ss.startY, ss.currentY);
            const w = Math.abs(ss.currentX - ss.startX);
            const h = Math.abs(ss.currentY - ss.startY);
            this.selectionBox.style.display = 'block';
            this.selectionBox.style.left = x + 'px';
            this.selectionBox.style.top = y + 'px';
            this.selectionBox.style.width = w + 'px';
            this.selectionBox.style.height = h + 'px';
        } else {
            this.selectionBox.style.display = 'none';
        }
    }

    updateSelectionDisplay(): void {
        this.requestRender();
    }

    rebuildAll(): void {
        // Clear and rebuild all element DOM
        this.elementsLayer.innerHTML = '';
        this.updateMenuButtons();
        this.requestRender();
    }

    // --- Clipboard (Copy / Paste) ---

    private async copySelectedElements(): Promise<void> {
        const selected = this.engine.data.elements.filter(el => this.engine.selectedIds.has(el.id));
        if (selected.length === 0) return;
        const data = JSON.stringify({ _simpledraw: true, version: 1, elements: JSON.parse(JSON.stringify(selected)) });
        try {
            await navigator.clipboard.writeText(data);
        } catch { /* clipboard not available */ }
    }

    private async pasteFromClipboard(): Promise<void> {
        let text: string;
        try {
            text = await navigator.clipboard.readText();
        } catch { return; }
        if (!text) return;

        let data: any;
        try { data = JSON.parse(text); } catch { data = null; }

        if (data && data._simpledraw && Array.isArray(data.elements)) {
            await this.pasteElements(data.elements);
        } else {
            this.createTextboxFromContent(text);
        }
    }

    private async pasteElements(elements: ElementData[]): Promise<void> {
        const pos = this.lastCanvasMouse;
        let minX = Infinity, minY = Infinity;
        const oldIds: string[] = [];
        for (const el of elements) {
            if (el.type === 'textbox') {
                minX = Math.min(minX, el.x);
                minY = Math.min(minY, el.y);
                oldIds.push(el.id);
            }
        }
        if (minX === Infinity) return;

        const offX = pos.x - minX;
        const offY = pos.y - minY;
        const newIds: string[] = [];
        const idMap = new Map<string, string>();

        for (const el of elements) {
            if (el.type === 'textbox') {
                const tb = el as TextBoxData;
                const newId = this.engine.createTextBox(
                    tb.x + offX, tb.y + offY, tb.width, tb.height
                );
                const newTb = this.engine.data.elements.find(e => e.id === newId) as TextBoxData;
                if (newTb) {
                    newTb.content = tb.content;
                    newTb.visible = tb.visible;
                    newTb.fillEnabled = tb.fillEnabled;
                    newTb.hAlign = tb.hAlign;
                    newTb.vAlign = tb.vAlign;
                    newTb.autoSize = tb.autoSize;
                    newTb.shape = tb.shape;
                    newTb.fontSize = tb.fontSize;
                    newTb.writingMode = tb.writingMode;
                }
                idMap.set(tb.id, newId);
                newIds.push(newId);
            }
        }

        // Paste arrows, remapping textbox IDs
        for (const el of elements) {
            if (el.type !== 'arrow') continue;
            const ar = el as ArrowData;
            const mapConn = (conn: ArrowConnection | FreePoint): ArrowConnection | FreePoint => {
                if ('elementId' in conn && idMap.has(conn.elementId)) {
                    return { elementId: idMap.get(conn.elementId)!, anchor: conn.anchor };
                }
                if ('elementId' in conn) return conn;
                return { x: conn.x + offX, y: conn.y + offY };
            };
            this.engine.createArrow(mapConn(ar.startConnection), mapConn(ar.endConnection));
            // Copy per-arrow properties
            const newAr = this.engine.data.elements[this.engine.data.elements.length - 1] as ArrowData;
            newAr.arrowDirection = ar.arrowDirection;
            newAr.showStartArrow = ar.showStartArrow;
            newAr.showEndArrow = ar.showEndArrow;
            if (ar.dashed) newAr.dashed = true;
            if (ar.labelContent) newAr.labelContent = ar.labelContent;
            if (ar.labelVisible) newAr.labelVisible = ar.labelVisible;
            if (ar.labelFontSize) newAr.labelFontSize = ar.labelFontSize;
        }

        this.engine.selectedIds.clear();
        for (const id of newIds) this.engine.selectedIds.add(id);
        if (this.engine.onSelectionChange) this.engine.onSelectionChange();

        this.engine.saveHistory();
        this.engine.notifyChange();
        this.rebuildAll();
    }

    private createTextboxFromContent(content: string): void {
        const pos = this.lastCanvasMouse;
        const id = this.engine.createTextBox(
            pos.x - DEFAULT_TEXTBOX_WIDTH / 2,
            pos.y - DEFAULT_TEXTBOX_HEIGHT / 2,
            DEFAULT_TEXTBOX_WIDTH,
            DEFAULT_TEXTBOX_HEIGHT
        );
        const tb = this.engine.data.elements.find(e => e.id === id) as TextBoxData;
        if (tb) {
            tb.content = content;
            if (content.trim()) {
                this.autoSizeTextbox(tb);
            }
        }
        this.engine.saveHistory();
        this.engine.notifyChange();
        this.rebuildAll();
    }

    // --- Export ---

    async exportToPNG(): Promise<void> {
        const elements = this.engine.data.elements;
        if (elements.length === 0) {
            new Notice(t('notice.emptyCanvas'));
            return;
        }

        const folder = this.file?.parent?.path || '';
        const baseName = this.file?.name?.replace(/\.simpledraw$/i, '') || 'drawing';
        let defaultPath = folder ? `${folder}/${baseName}.png` : `${baseName}.png`;
        let counter = 1;
        while (await this.app.vault.adapter.exists(defaultPath)) {
            defaultPath = folder ? `${folder}/${baseName}_${counter}.png` : `${baseName}_${counter}.png`;
            counter++;
        }

        new SimpleDrawExportModal(this, defaultPath, this.settings.showGrid, false, (options) => {
            this.doExport(options);
        }).open();
    }

    private async doExport(options: ExportOptions): Promise<void> {
        const elements = this.engine.data.elements;
        if (elements.length === 0) return;

        // Compute bounding box of all elements
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        for (const el of elements) {
            const bounds = this.engine.getElementBounds(el);
            minX = Math.min(minX, bounds.x);
            minY = Math.min(minY, bounds.y);
            maxX = Math.max(maxX, bounds.x + bounds.width);
            maxY = Math.max(maxY, bounds.y + bounds.height);
        }

        const padding = 50;
        minX = Math.floor(minX - padding);
        minY = Math.floor(minY - padding);
        maxX = Math.ceil(maxX + padding);
        maxY = Math.ceil(maxY + padding);

        const w = Math.max(maxX - minX, 400);
        const h = Math.max(maxY - minY, 300);

        // Build offscreen container (live DOM stays invisible via 0-size; html-to-image overrides size/pos in the clone)
        const offscreen = document.createElement('div');
        offscreen.style.position = 'fixed';
        offscreen.style.left = '0';
        offscreen.style.top = '0';
        offscreen.style.width = '0';
        offscreen.style.height = '0';
        offscreen.style.overflow = 'hidden';
        offscreen.style.pointerEvents = 'none';
        offscreen.style.backgroundColor = 'transparent';
        document.body.appendChild(offscreen);

        // Clone grid layer
        if (options.showGrid) {
            const gs = this.settings.gridSize || GRID_SIZE;
            const grid = document.createElement('div');
            grid.style.position = 'absolute';
            grid.style.left = '0px';
            grid.style.top = '0px';
            grid.style.width = w + 'px';
            grid.style.height = h + 'px';
            grid.style.pointerEvents = 'none';
            grid.style.zIndex = '1';
            grid.style.backgroundImage = `
                linear-gradient(rgba(128,128,128,0.1) 1px, transparent 1px),
                linear-gradient(90deg, rgba(128,128,128,0.1) 1px, transparent 1px)
            `;
            grid.style.backgroundSize = `${gs}px ${gs}px`;
            const xOff = ((-minX % gs) + gs) % gs;
            const yOff = ((-minY % gs) + gs) % gs;
            grid.style.backgroundPosition = `${xOff}px ${yOff}px`;
            offscreen.appendChild(grid);
        }

        // Clone SVG layer (arrows)
        const svgClone = this.svgLayer.cloneNode(true) as SVGElement;
        svgClone.style.position = 'absolute';
        svgClone.style.left = '0px';
        svgClone.style.top = '0px';
        svgClone.style.width = w + 'px';
        svgClone.style.height = h + 'px';
        svgClone.style.transform = `translate(${-minX}px, ${-minY}px)`;
        svgClone.style.pointerEvents = 'none';
        svgClone.style.overflow = 'visible';
        offscreen.appendChild(svgClone);

        // Clone elements layer (textboxes with rendered markdown)
        const elementsClone = this.elementsLayer.cloneNode(true) as HTMLElement;
        // Strip lock icons from export
        elementsClone.querySelectorAll('.simpledraw-lock-icon').forEach(el => el.remove());
        elementsClone.style.position = 'absolute';
        elementsClone.style.left = '0px';
        elementsClone.style.top = '0px';
        elementsClone.style.width = w + 'px';
        elementsClone.style.height = h + 'px';
        elementsClone.style.transform = `translate(${-minX}px, ${-minY}px)`;
        elementsClone.style.pointerEvents = 'none';
        elementsClone.style.overflow = 'visible';
        offscreen.appendChild(elementsClone);

        // Wait for fonts
        offscreen.offsetHeight; // force reflow
        await document.fonts.ready;

        // Capture via html-to-image
        // Note: html-to-image copies getComputedStyle values into the SVG foreignObject clone.
        // We must override the offscreen container's 0-size / position via `style` option
        // so the clone renders at the correct size and location.
        const captureOpts: Record<string, any> = {
            width: w,
            height: h,
            pixelRatio: 2,
            style: {
                position: 'absolute',
                left: '0',
                top: '0',
                overflow: 'visible',
            },
        };
        if (!options.transparentBg) {
            const bgColor = getComputedStyle(this.containerEl)
                .getPropertyValue('--background-primary').trim() || '#ffffff';
            captureOpts.backgroundColor = bgColor;
        }
        const canvas = await toCanvas(offscreen, captureOpts);

        // Cleanup
        document.body.removeChild(offscreen);

        // Save PNG
        const blob = await new Promise<Blob>(resolve => canvas.toBlob(b => resolve(b!), 'image/png'));
        const buffer = await blob.arrayBuffer();

        const targetPath = options.filePath;
        if (this.isAbsolutePath(targetPath)) {
            const fs = (window as any).require('fs');
            await fs.promises.writeFile(targetPath, Buffer.from(buffer));
        } else {
            const folderPart = targetPath.includes('/') ? targetPath.substring(0, targetPath.lastIndexOf('/')) : '';
            if (folderPart && !(await this.app.vault.adapter.exists(folderPart))) {
                await this.app.vault.adapter.mkdir(folderPart);
            }
            await this.app.vault.adapter.writeBinary(targetPath, buffer);
        }
        new Notice(t('notice.exported', { name: targetPath.split(/[/\\]/).pop()! }));
    }

    private isAbsolutePath(path: string): boolean {
        return path.startsWith('/') || /^[a-zA-Z]:[\\/]/.test(path) || path.startsWith('\\');
    }

    async getNativeSavePath(defaultPath: string): Promise<string | null> {
        const tryDialog = async (modulePath: string, subPath?: string): Promise<string | null> => {
            const mod = (window as any).require(modulePath);
            const dialog = subPath ? mod[subPath]?.dialog : mod.dialog;
            if (!dialog?.showSaveDialog) return null;
            const result = await dialog.showSaveDialog({
                title: '导出为 PNG',
                defaultPath,
                filters: [{ name: 'PNG Images', extensions: ['png'] }],
            });
            if (result.canceled) return null;
            return result.filePath;
        };
        for (const [mod, sub] of [['@electron/remote', ''], ['electron', 'remote']] as const) {
            try {
                const p = await tryDialog(mod, sub);
                if (p) return p;
            } catch { /* try next */ }
        }
        return null;
    }


}

// --- Export Options Modal ---

interface ExportOptions {
    showGrid: boolean;
    filePath: string;
    transparentBg: boolean;
}

class SimpleDrawExportModal extends Modal {
    private opts: ExportOptions;
    private pathInputEl: HTMLInputElement | null = null;
    private view: SimpleDrawView;
    private onExport: (opts: ExportOptions) => void;

    constructor(view: SimpleDrawView, defaultPath: string, defaultShowGrid: boolean, defaultTransparentBg: boolean, onExport: (opts: ExportOptions) => void) {
        super(view.app);
        this.view = view;
        this.opts = { showGrid: defaultShowGrid, filePath: defaultPath, transparentBg: defaultTransparentBg };
        this.onExport = onExport;
    }

    onOpen(): void {
        const { contentEl } = this;
        contentEl.empty();
        contentEl.createEl('h2', { text: t('export.title') });

        // File path
        new Setting(contentEl)
            .setName(t('export.path.name'))
            .setDesc(t('export.path.desc'))
            .addText(text => {
                text.setValue(this.opts.filePath)
                    .setPlaceholder('path/to/file.png')
                    .onChange(value => this.opts.filePath = value)
                    .inputEl.style.width = '100%';
                this.pathInputEl = text.inputEl;
            })
            .addButton(btn => btn
                .setButtonText(t('export.path.browse'))
                .onClick(async () => {
                    const path = await this.view.getNativeSavePath(this.opts.filePath);
                    if (path) {
                        this.opts.filePath = path;
                        if (this.pathInputEl) this.pathInputEl.value = path;
                    }
                }));

        // Show grid
        new Setting(contentEl)
            .setName(t('export.grid.name'))
            .setDesc(t('export.grid.desc'))
            .addToggle(toggle => toggle
                .setValue(this.opts.showGrid)
                .onChange(value => this.opts.showGrid = value));

        // Transparent background
        new Setting(contentEl)
            .setName(t('export.transparent.name'))
            .setDesc(t('export.transparent.desc'))
            .addToggle(toggle => toggle
                .setValue(this.opts.transparentBg)
                .onChange(value => this.opts.transparentBg = value));

        // Buttons
        new Setting(contentEl)
            .addButton(btn => btn
                .setButtonText(t('export.exportBtn'))
                .setCta()
                .onClick(() => {
                    this.onExport(this.opts);
                    this.close();
                }))
            .addButton(btn => btn
                .setButtonText(t('export.cancelBtn'))
                .onClick(() => this.close()));
    }

    onClose(): void {
        this.contentEl.empty();
    }
}
