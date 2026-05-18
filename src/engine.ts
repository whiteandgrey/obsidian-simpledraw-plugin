// Core engine for SimpleDraw - manages canvas, elements, and interactions

import {
    SimpleDrawData, ElementData, TextBoxData, ArrowData,
    ArrowConnection, FreePoint, AnchorType, ArrowDirection,
    InteractionMode, ViewState, HistoryEntry,
    GRID_SIZE, ANCHOR_SIZE, SNAP_DISTANCE,
    MIN_TEXTBOX_WIDTH, MIN_TEXTBOX_HEIGHT,
    DEFAULT_TEXTBOX_WIDTH, DEFAULT_TEXTBOX_HEIGHT,
    DEFAULT_DATA,
} from './types';
import { SimpleDrawSettings } from './settings';

type MarkdownRendererFn = (markdown: string, el: HTMLElement, sourcePath: string) => Promise<void>;

export class SimpleDrawEngine {
    public data: SimpleDrawData;
    public settings: SimpleDrawSettings;
    public mode: InteractionMode = InteractionMode.None;

    // Interaction state
    public textBoxInsertState: { firstClick: { x: number; y: number } | null } = { firstClick: null };
    public arrowInsertState: { firstClick: { x: number; y: number } | null; mouseX: number; mouseY: number } = { firstClick: null, mouseX: 0, mouseY: 0 };
    public selectionState: { startX: number; startY: number; currentX: number; currentY: number; active: boolean } | null = null;
    public selectedIds: Set<string> = new Set();
    public editingTextboxId: string | null = null;
    public editingArrowId: string | null = null;
    public arrowDirection: ArrowDirection = 'right';

    // Alignment snap state (for preview lines)
    public alignmentSnap: {
        active: boolean;
        lines: { x1: number; y1: number; x2: number; y2: number }[];
        hasCandidate: boolean;
    } = { active: false, lines: [], hasCandidate: false };

    // Edge-level cache: "fromId->toId:fromEdgeIdx->toEdgeIdx"
    private arrowEdgeCache: Set<string> = new Set();
    private anchorToEdgeIdx(anchor: AnchorType): number {
        switch (anchor) {
            case 'top': case 'top-left': case 'top-right': return 0;
            case 'bottom': case 'bottom-left': case 'bottom-right': return 1;
            case 'left': return 2;
            case 'right': return 3;
        }
    }

    // Drag state
    public dragging: {
        type: 'move' | 'resize' | 'pan';
        elementIds?: Set<string>;
        startMouseX: number;
        startMouseY: number;
        startX: number;
        startY: number;
        startWidth?: number;
        startHeight?: number;
        resizeHandle?: string;
        textboxId?: string;
    } | null = null;

    // Undo/redo
    public history: HistoryEntry[] = [];
    public historyIndex: number = -1;

    // Callbacks
    public onChange: (() => void) | null = null;
    public onModeChange: (() => void) | null = null;
    public onSelectionChange: (() => void) | null = null;
    public onEditTextbox: ((id: string) => void) | null = null;
    public onEditArrow: ((id: string) => void) | null = null;
    public renderMarkdown: MarkdownRendererFn | null = null;
    public sourcePath: string = '';

    // DOM references (set by View)
    public container: HTMLElement | null = null;
    public svgLayer: SVGElement | null = null;
    public elementsLayer: HTMLElement | null = null;
    public previewLayer: HTMLElement | null = null;
    public selectionBox: HTMLElement | null = null;

    // Pending markdown re-renders
    public pendingMarkdownRender: Map<string, { content: string; el: HTMLElement; rendered: boolean }> = new Map();

    constructor(settings: SimpleDrawSettings) {
        this.settings = settings;
        this.data = JSON.parse(JSON.stringify(DEFAULT_DATA));
        this.saveHistory();
    }

    // --- History Management ---

    saveHistory(): void {
        // Remove any future history after current index
        this.history = this.history.slice(0, this.historyIndex + 1);
        this.history.push({ data: JSON.parse(JSON.stringify(this.data)) });
        this.historyIndex = this.history.length - 1;
        // Keep history size manageable
        if (this.history.length > 100) {
            this.history.shift();
            this.historyIndex--;
        }
    }

    undo(): boolean {
        if (this.historyIndex > 0) {
            this.historyIndex--;
            this.data = JSON.parse(JSON.stringify(this.history[this.historyIndex]!.data));
            this.selectedIds.clear();
            this.notifyChange();
            return true;
        }
        return false;
    }

    redo(): boolean {
        if (this.historyIndex < this.history.length - 1) {
            this.historyIndex++;
            this.data = JSON.parse(JSON.stringify(this.history[this.historyIndex]!.data));
            this.selectedIds.clear();
            this.notifyChange();
            return true;
        }
        return false;
    }

    // --- Data Management ---

    loadData(data: SimpleDrawData): void {
        this.data = data;
        this.history = [];
        this.historyIndex = -1;
        this.saveHistory();
        this.selectedIds.clear();
        this.exitAllModes();
    }

    getData(): SimpleDrawData {
        return this.data;
    }

    public notifyChange(): void {
        if (this.onChange) this.onChange();
    }

    private notifyModeChange(): void {
        if (this.onModeChange) this.onModeChange();
    }

    // --- Coordinate Transforms ---

    screenToCanvas(screenX: number, screenY: number): { x: number; y: number } {
        if (!this.container) return { x: screenX, y: screenY };
        const rect = this.container.getBoundingClientRect();
        const x = (screenX - rect.left - this.data.viewState.panX) / this.data.viewState.zoom;
        const y = (screenY - rect.top - this.data.viewState.panY) / this.data.viewState.zoom;
        return { x, y };
    }

    canvasToScreen(canvasX: number, canvasY: number): { x: number; y: number } {
        const x = canvasX * this.data.viewState.zoom + this.data.viewState.panX;
        const y = canvasY * this.data.viewState.zoom + this.data.viewState.panY;
        return { x, y };
    }

    // --- View Operations ---

    fitToView(): void {
        if (this.data.elements.length === 0) {
            this.data.viewState.panX = 0;
            this.data.viewState.panY = 0;
            this.data.viewState.zoom = 1;
            this.notifyChange();
            return;
        }

        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        for (const el of this.data.elements) {
            const bounds = this.getElementBounds(el);
            minX = Math.min(minX, bounds.x);
            minY = Math.min(minY, bounds.y);
            maxX = Math.max(maxX, bounds.x + bounds.width);
            maxY = Math.max(maxY, bounds.y + bounds.height);
        }

        const padding = 50;
        minX -= padding;
        minY -= padding;
        maxX += padding;
        maxY += padding;

        if (!this.container) return;
        const containerWidth = this.container.clientWidth;
        const containerHeight = this.container.clientHeight;

        const contentWidth = maxX - minX;
        const contentHeight = maxY - minY;

        const zoomX = containerWidth / contentWidth;
        const zoomY = containerHeight / contentHeight;
        const zoom = Math.min(zoomX, zoomY, 2);

        const centerX = (minX + maxX) / 2;
        const centerY = (minY + maxY) / 2;

        this.data.viewState.zoom = zoom;
        this.data.viewState.panX = containerWidth / 2 - centerX * zoom;
        this.data.viewState.panY = containerHeight / 2 - centerY * zoom;

        this.notifyChange();
    }

    clearCanvas(): void {
        this.data.elements = [];
        this.selectedIds.clear();
        this.exitAllModes();
        this.saveHistory();
        this.notifyChange();
    }

    getElementBounds(el: ElementData): { x: number; y: number; width: number; height: number } {
        if (el.type === 'textbox') {
            return { x: el.x, y: el.y, width: el.width, height: el.height };
        } else {
            const startCoords = this.resolveConnection(el.startConnection);
            const endCoords = this.resolveConnection(el.endConnection);
            const x = Math.min(startCoords.x, endCoords.x);
            const y = Math.min(startCoords.y, endCoords.y);
            const width = Math.abs(endCoords.x - startCoords.x);
            const height = Math.abs(endCoords.y - startCoords.y);
            return { x, y, width: Math.max(width, 1), height: Math.max(height, 1) };
        }
    }

    // --- Connection Resolution ---

    resolveConnection(conn: ArrowConnection | FreePoint): { x: number; y: number } {
        if ('elementId' in conn) {
            const el = this.data.elements.find(e => e.id === conn.elementId && e.type === 'textbox') as TextBoxData | undefined;
            if (el) {
                return this.getAnchorPosition(el, conn.anchor);
            }
            return { x: 0, y: 0 };
        }
        return { x: conn.x, y: conn.y };
    }

    getAnchorPosition(textbox: TextBoxData, anchor: AnchorType): { x: number; y: number } {
        const { x, y, width, height } = textbox;
        switch (anchor) {
            case 'top-left': return { x, y };
            case 'top': return { x: x + width / 2, y };
            case 'top-right': return { x: x + width, y };
            case 'right': return { x: x + width, y: y + height / 2 };
            case 'bottom-right': return { x: x + width, y: y + height };
            case 'bottom': return { x: x + width / 2, y: y + height };
            case 'bottom-left': return { x, y: y + height };
            case 'left': return { x, y: y + height / 2 };
        }
    }

    getAnchorDirection(conn: ArrowConnection | FreePoint): ArrowDirection | null {
        if (!('elementId' in conn)) return null;
        const anchor = conn.anchor;
        if (anchor === 'left' || anchor === 'top-left' || anchor === 'bottom-left') return 'left';
        if (anchor === 'right' || anchor === 'top-right' || anchor === 'bottom-right') return 'right';
        if (anchor === 'top') return 'up';
        if (anchor === 'bottom') return 'down';
        return null;
    }

    getExitDirection(conn: ArrowConnection | FreePoint, defaultDir?: ArrowDirection): ArrowDirection {
        const dir = this.getAnchorDirection(conn);
        if (dir) return dir;
        return defaultDir ?? this.arrowDirection;
    }

    buildArrowPath(startConn: ArrowConnection | FreePoint, endConn: ArrowConnection | FreePoint, arrowDir?: ArrowDirection): { x: number; y: number }[] {
        const start = this.resolveConnection(startConn);
        const end = this.resolveConnection(endConn);

        if (start.x === end.x && start.y === end.y) return [start, end];

        const startDir = this.getExitDirection(startConn, arrowDir);
        const endDir = this.getExitDirection(endConn, arrowDir);
        const endIsAnchored = 'elementId' in endConn;
        const entryDir: ArrowDirection = endIsAnchored
            ? (endDir === 'left' ? 'right' : endDir === 'right' ? 'left' : endDir === 'up' ? 'down' : 'up')
            : endDir;

        const isHoriz = (d: ArrowDirection) => d === 'left' || d === 'right';
        const baseExt = Math.max(this.settings.arrowHeadSize, 20);
        const anchorDist = Math.abs(start.x - end.x) + Math.abs(start.y - end.y);
        const EXT = anchorDist > 0 && anchorDist < baseExt * 2
            ? Math.max(this.settings.arrowHeadSize, Math.floor(anchorDist / 2))
            : baseExt;

        // Collect connected textboxes for avoidance (deduplicate)
        const obstacles: { tb: TextBoxData; marginL: number; marginR: number; marginT: number; marginB: number }[] = [];
        const addedIds = new Set<string>();
        const addObstacle = (conn: ArrowConnection | FreePoint) => {
            if (!('elementId' in conn)) return;
            if (addedIds.has(conn.elementId)) return;
            const el = this.data.elements.find(e => e.id === conn.elementId && e.type === 'textbox') as TextBoxData | undefined;
            if (!el) return;
            addedIds.add(conn.elementId);
            obstacles.push({
                tb: el,
                marginL: el.x - EXT,
                marginR: el.x + el.width + EXT,
                marginT: el.y - EXT,
                marginB: el.y + el.height + EXT,
            });
        };
        addObstacle(startConn);
        addObstacle(endConn);

        // Compute extension positions, clamped to clear connected textboxes.
        let sx = start.x, sy = start.y;
        switch (startDir) { case 'left': sx -= EXT; break; case 'right': sx += EXT; break; case 'up': sy -= EXT; break; case 'down': sy += EXT; break; }

        let ex = end.x, ey = end.y;
        switch (entryDir) { case 'left': ex += EXT; break; case 'right': ex -= EXT; break; case 'up': ey += EXT; break; case 'down': ey -= EXT; break; }

        const startAnchored = 'elementId' in startConn;
        if (startAnchored) {
            const tb = this.data.elements.find(e => e.id === (startConn as ArrowConnection).elementId) as TextBoxData | undefined;
            if (tb) {
                if (startDir === 'right')  sx = Math.max(sx, tb.x + tb.width  + EXT);
                if (startDir === 'left')   sx = Math.min(sx, tb.x               - EXT);
                if (startDir === 'down')   sy = Math.max(sy, tb.y + tb.height + EXT);
                if (startDir === 'up')     sy = Math.min(sy, tb.y               - EXT);
            }
        }
        if (endIsAnchored) {
            const tb = this.data.elements.find(e => e.id === (endConn as ArrowConnection).elementId) as TextBoxData | undefined;
            if (tb) {
                if (entryDir === 'left')   ex = Math.max(ex, tb.x + tb.width  + EXT);
                if (entryDir === 'right')  ex = Math.min(ex, tb.x               - EXT);
                if (entryDir === 'up')     ey = Math.max(ey, tb.y + tb.height + EXT);
                if (entryDir === 'down')   ey = Math.min(ey, tb.y               - EXT);
            }
        }

        // Helper: check if a point is inside any obstacle
        const inAny = (px: number, py: number) => {
            for (const o of obstacles) {
                if (px > o.marginL && px < o.marginR && py > o.marginT && py < o.marginB) return true;
            }
            return false;
        };

        // Helper: check if a horizontal segment at y intersects any obstacle
        const horizHits = (y: number, x1: number, x2: number) => {
            const mn = Math.min(x1, x2), mx = Math.max(x1, x2);
            for (const o of obstacles) {
                if (y > o.marginT && y < o.marginB && mx > o.marginL && mn < o.marginR) return true;
            }
            return false;
        };

        // Helper: check if a vertical segment at x intersects any obstacle
        const vertHits = (x: number, y1: number, y2: number) => {
            const mn = Math.min(y1, y2), mx = Math.max(y1, y2);
            for (const o of obstacles) {
                if (x > o.marginL && x < o.marginR && mx > o.marginT && mn < o.marginB) return true;
            }
            return false;
        };

        // Attempt 1: Try direct L-shapes first (2 intermediate points), then Z-shape (3).
        // Prefer routes that extend the "hard" start direction (no extra turn at the extension).
        const tryPath = () => {
            const pts: { x: number; y: number }[] = [start];

            if (isHoriz(startDir) && isHoriz(entryDir)) {
                // Direct L via endX:    (sx,sy)→(ex,sy)→(ex,ey)
                //   → continues startDir horizontally (0 extra turns at start)
                if (!inAny(ex, sy) && !horizHits(sy, sx, ex) && !vertHits(ex, sy, ey)) {
                    pts.push({ x: sx, y: sy });
                    pts.push({ x: ex, y: sy });
                    pts.push({ x: ex, y: ey });
                    return pts;
                }
                // Direct L via startX:  (sx,sy)→(sx,ey)→(ex,ey)
                //   → adds a turn immediately at (sx,sy)
                if (!inAny(sx, ey) && !vertHits(sx, sy, ey) && !horizHits(ey, sx, ex)) {
                    pts.push({ x: sx, y: sy });
                    pts.push({ x: sx, y: ey });
                    pts.push({ x: ex, y: ey });
                    return pts;
                }
                // Z-shape via midpoint
                const midX = (sx + ex) / 2;
                if (!inAny(midX, sy) && !inAny(midX, ey) &&
                    !horizHits(sy, sx, midX) && !vertHits(midX, sy, ey) && !horizHits(ey, midX, ex)) {
                    pts.push({ x: sx,   y: sy });
                    pts.push({ x: midX, y: sy });
                    pts.push({ x: midX, y: ey });
                    pts.push({ x: ex,   y: ey });
                    return pts;
                }
                return null;
            }
            if (!isHoriz(startDir) && !isHoriz(entryDir)) {
                // Direct L via endY:    (sx,sy)→(sx,ey)→(ex,ey)
                //   → continues startDir vertically (0 extra turns at start)
                if (!inAny(sx, ey) && !vertHits(sx, sy, ey) && !horizHits(ey, sx, ex)) {
                    pts.push({ x: sx, y: sy });
                    pts.push({ x: sx, y: ey });
                    pts.push({ x: ex, y: ey });
                    return pts;
                }
                // Direct L via startY:  (sx,sy)→(ex,sy)→(ex,ey)
                //   → adds a turn immediately at (sx,sy)
                if (!inAny(ex, sy) && !horizHits(sy, sx, ex) && !vertHits(ex, sy, ey)) {
                    pts.push({ x: sx, y: sy });
                    pts.push({ x: ex, y: sy });
                    pts.push({ x: ex, y: ey });
                    return pts;
                }
                // Z-shape via midpoint
                const midY = (sy + ey) / 2;
                if (!inAny(sx, midY) && !inAny(ex, midY) &&
                    !vertHits(sx, sy, midY) && !horizHits(midY, sx, ex) && !vertHits(ex, midY, ey)) {
                    pts.push({ x: sx, y: sy });
                    pts.push({ x: sx, y: midY });
                    pts.push({ x: ex, y: midY });
                    pts.push({ x: ex, y: ey });
                    return pts;
                }
                return null;
            }
            if (isHoriz(startDir) && !isHoriz(entryDir)) {
                // Via entryDir: (sx,sy)→(ex,sy)→(ex,ey) — first soft segment continues start HORIZ direction (0 turns at start)
                if (!inAny(ex, sy) && !horizHits(sy, sx, ex) && !vertHits(ex, sy, ey)) {
                    pts.push({ x: sx, y: sy });
                    pts.push({ x: ex, y: sy });
                    pts.push({ x: ex, y: ey });
                    return pts;
                }
                // Via startDir: (sx,sy)→(sx,ey)→(ex,ey) — turns immediately at start extension
                if (!inAny(sx, ey) && !vertHits(sx, sy, ey) && !horizHits(ey, sx, ex)) {
                    pts.push({ x: sx, y: sy });
                    pts.push({ x: sx, y: ey });
                    pts.push({ x: ex, y: ey });
                    return pts;
                }
                return null;
            }
            // !isHoriz(startDir) && isHoriz(entryDir)
            // Via startDir: (sx,sy)→(sx,ey)→(ex,ey) — first soft continues start VERT direction (0 turns at start)
            if (!inAny(sx, ey) && !vertHits(sx, sy, ey) && !horizHits(ey, sx, ex)) {
                pts.push({ x: sx, y: sy });
                pts.push({ x: sx, y: ey });
                pts.push({ x: ex, y: ey });
                return pts;
            }
            // Via entryDir: (sx,sy)→(ex,sy)→(ex,ey) — turns immediately
            if (!inAny(ex, sy) && !horizHits(sy, sx, ex) && !vertHits(ex, sy, ey)) {
                pts.push({ x: sx, y: sy });
                pts.push({ x: ex, y: sy });
                pts.push({ x: ex, y: ey });
                return pts;
            }
            return null;
        };

        let points = tryPath();
        if (points) {
            points.push(end);
            return points;
        }

        // Attempt 2: route via the bounding perimeter of all obstacles
        if (obstacles.length > 0) {
            const outerL = Math.min(...obstacles.map(o => o.marginL));
            const outerR = Math.max(...obstacles.map(o => o.marginR));
            const outerT = Math.min(...obstacles.map(o => o.marginT));
            const outerB = Math.max(...obstacles.map(o => o.marginB));

            // Four candidate escape routes: above, below, left, right
            type Route = { pts: { x: number; y: number }[]; len: number };
            const candidates: Route[] = [];

            if (isHoriz(startDir) && isHoriz(entryDir)) {
                // Via above both
                const routeY = outerT;
                candidates.push({
                    pts: [{ x: sx, y: sy }, { x: sx, y: routeY }, { x: ex, y: routeY }, { x: ex, y: ey }],
                    len: Math.abs(sy - routeY) + Math.abs(sx - ex) + Math.abs(routeY - ey),
                });
                // Via below both
                const routeY2 = outerB;
                candidates.push({
                    pts: [{ x: sx, y: sy }, { x: sx, y: routeY2 }, { x: ex, y: routeY2 }, { x: ex, y: ey }],
                    len: Math.abs(sy - routeY2) + Math.abs(sx - ex) + Math.abs(routeY2 - ey),
                });
            } else if (!isHoriz(startDir) && !isHoriz(entryDir)) {
                // Via left of both
                const routeX = outerL;
                candidates.push({
                    pts: [{ x: sx, y: sy }, { x: routeX, y: sy }, { x: routeX, y: ey }, { x: ex, y: ey }],
                    len: Math.abs(sx - routeX) + Math.abs(sy - ey) + Math.abs(routeX - ex),
                });
                // Via right of both
                const routeX2 = outerR;
                candidates.push({
                    pts: [{ x: sx, y: sy }, { x: routeX2, y: sy }, { x: routeX2, y: ey }, { x: ex, y: ey }],
                    len: Math.abs(sx - routeX2) + Math.abs(sy - ey) + Math.abs(routeX2 - ex),
                });
            } else if (isHoriz(startDir) && !isHoriz(entryDir)) {
                // Via outer boundary compatible with mixed directions
                candidates.push({
                    pts: [{ x: sx, y: sy }, { x: sx, y: outerT }, { x: end.x, y: outerT }, { x: end.x, y: ey }],
                    len: Math.abs(sy - outerT) + Math.abs(sx - end.x) + Math.abs(outerT - ey),
                });
                candidates.push({
                    pts: [{ x: sx, y: sy }, { x: sx, y: outerB }, { x: end.x, y: outerB }, { x: end.x, y: ey }],
                    len: Math.abs(sy - outerB) + Math.abs(sx - end.x) + Math.abs(outerB - ey),
                });
            } else {
                // start vertical, entry horizontal
                candidates.push({
                    pts: [{ x: sx, y: sy }, { x: outerL, y: sy }, { x: outerL, y: ey }, { x: ex, y: ey }],
                    len: Math.abs(sx - outerL) + Math.abs(sy - ey) + Math.abs(outerL - ex),
                });
                candidates.push({
                    pts: [{ x: sx, y: sy }, { x: outerR, y: sy }, { x: outerR, y: ey }, { x: ex, y: ey }],
                    len: Math.abs(sx - outerR) + Math.abs(sy - ey) + Math.abs(outerR - ex),
                });
            }

            // Pick shortest obstacle-free route
            candidates.sort((a, b) => a.len - b.len);
            for (const c of candidates) {
                let ok = true;
                for (let i = 0; i < c.pts.length - 1 && ok; i++) {
                    const a = c.pts[i]!, b = c.pts[i + 1]!;
                    if (Math.abs(a.x - b.x) < 1) {
                        if (vertHits(a.x, a.y, b.y)) ok = false;
                    } else {
                        if (horizHits(a.y, a.x, b.x)) ok = false;
                    }
                }
                if (ok) {
                    points = [start, ...c.pts];
                    points.push(end);
                    return points;
                }
            }
        }

        // Fallback: standard routing without avoidance
        points = [start];

        if (isHoriz(startDir) && isHoriz(entryDir)) {
            const midX = (sx + ex) / 2;
            points.push({ x: sx,   y: sy });
            points.push({ x: midX, y: sy });
            points.push({ x: midX, y: ey });
            points.push({ x: ex,   y: ey });
        } else if (!isHoriz(startDir) && !isHoriz(entryDir)) {
            const midY = (sy + ey) / 2;
            points.push({ x: sx, y: sy });
            points.push({ x: sx, y: midY });
            points.push({ x: ex, y: midY });
            points.push({ x: ex, y: ey });
        } else if (isHoriz(startDir) && !isHoriz(entryDir)) {
            points.push({ x: sx,    y: sy });
            points.push({ x: sx,    y: ey });
            points.push({ x: ex,    y: ey });
        } else {
            points.push({ x: sx, y: sy });
            points.push({ x: ex, y: sy });
            points.push({ x: ex, y: ey });
        }

        points.push(end);
        return points;
    }

    getAnchors(textbox: TextBoxData): { anchor: AnchorType; x: number; y: number }[] {
        const anchors: AnchorType[] = ['top-left', 'top', 'top-right', 'right', 'bottom-right', 'bottom', 'bottom-left', 'left'];
        return anchors.map(a => ({ anchor: a, ...this.getAnchorPosition(textbox, a) }));
    }

    // Find nearest anchor to a point within snap distance
    findNearestAnchor(canvasX: number, canvasY: number): { elementId: string; anchor: AnchorType; x: number; y: number } | null {
        let best: { elementId: string; anchor: AnchorType; x: number; y: number; dist: number } | null = null;
        for (const el of this.data.elements) {
            if (el.type !== 'textbox') continue;
            const anchors = this.getAnchors(el as TextBoxData);
            for (const a of anchors) {
                const dist = Math.sqrt((canvasX - a.x) ** 2 + (canvasY - a.y) ** 2);
                if (dist < SNAP_DISTANCE) {
                    if (!best || dist < best.dist) {
                        best = { elementId: el.id, anchor: a.anchor, x: a.x, y: a.y, dist };
                    }
                }
            }
        }
        return best ? { elementId: best.elementId, anchor: best.anchor, x: best.x, y: best.y } : null;
    }

    // --- Mode Management ---

    setMode(mode: InteractionMode): void {
        this.mode = mode;
        this.textBoxInsertState.firstClick = null;
        this.arrowInsertState.firstClick = null;
        this.selectionState = null;
        this.editingTextboxId = null;
        this.editingArrowId = null;
        this.notifyModeChange();
    }

    exitAllModes(): void {
        this.setMode(InteractionMode.None);
    }

    cancelCurrentMode(): void {
        const wasInMode = this.mode !== InteractionMode.None || this.editingTextboxId !== null || this.editingArrowId !== null;
        this.setMode(InteractionMode.None);
        if (!wasInMode) {
            this.selectedIds.clear();
            if (this.onSelectionChange) this.onSelectionChange();
        }
    }

    // --- Element Operations ---

    createTextBox(x: number, y: number, width: number, height: number): string {
        const id = 'tb_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5);
        const tb: TextBoxData = {
            id,
            type: 'textbox',
            x, y,
            width: Math.max(width, MIN_TEXTBOX_WIDTH),
            height: Math.max(height, MIN_TEXTBOX_HEIGHT),
            content: '',
            visible: true,
            fillEnabled: true,
            hAlign: 'center',
            vAlign: 'middle',
            autoSize: true,
            fontSize: this.settings?.textboxDefaultFontSize ?? 16,
            writingMode: 'horizontal-tb',
            shape: 'rectangle',
        };
        this.data.elements.push(tb);
        this.saveHistory();
        this.notifyChange();
        return id;
    }

    createArrow(startConn: ArrowConnection | FreePoint, endConn: ArrowConnection | FreePoint): string {
        const id = 'ar_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5);
        const arrow: ArrowData = {
            id,
            type: 'arrow',
            startConnection: startConn,
            endConnection: endConn,
            showStartArrow: false,
            showEndArrow: true,
            arrowDirection: this.arrowDirection,
        };
        this.data.elements.push(arrow);
        this.saveHistory();
        this.notifyChange();
        return id;
    }

    deleteElements(ids: Set<string>): void {
        // Also remove arrows connected to deleted textboxes
        const allIds = new Set(ids);
        for (const el of this.data.elements) {
            if (el.type === 'arrow') {
                const arrow = el as ArrowData;
                if ('elementId' in arrow.startConnection && ids.has(arrow.startConnection.elementId)) {
                    allIds.add(arrow.id);
                }
                if ('elementId' in arrow.endConnection && ids.has(arrow.endConnection.elementId)) {
                    allIds.add(arrow.id);
                }
            }
        }
        this.data.elements = this.data.elements.filter(e => !allIds.has(e.id));
        this.selectedIds.clear();
        this.saveHistory();
        this.notifyChange();
    }

    deleteElement(id: string): void {
        this.deleteElements(new Set([id]));
    }

    updateTextBox(id: string, updates: Partial<TextBoxData>): void {
        const idx = this.data.elements.findIndex(e => e.id === id && e.type === 'textbox');
        if (idx === -1) return;
        const tb = this.data.elements[idx] as TextBoxData;
        Object.assign(tb, updates);

        // Update connected arrow endpoints
        this.updateConnectedArrows(id);

        this.notifyChange();
    }

    moveElements(ids: Set<string>, dx: number, dy: number): void {
        for (const el of this.data.elements) {
            if (!ids.has(el.id)) continue;
            if (el.type === 'textbox') {
                const tb = el as TextBoxData;
                tb.x += dx;
                tb.y += dy;
            } else if (el.type === 'arrow') {
                const arrow = el as ArrowData;
                if (!('elementId' in arrow.startConnection)) {
                    (arrow.startConnection as FreePoint).x += dx;
                    (arrow.startConnection as FreePoint).y += dy;
                }
                if (!('elementId' in arrow.endConnection)) {
                    (arrow.endConnection as FreePoint).x += dx;
                    (arrow.endConnection as FreePoint).y += dy;
                }
            }
        }
        // Update connected arrow endpoints for moved textboxes
        for (const id of ids) {
            this.updateConnectedArrows(id);
        }
        this.notifyChange();
    }

    // Precompute arrow connections between textboxes
    private buildArrowCache(): void {
        this.arrowEdgeCache.clear();
        for (const el of this.data.elements) {
            if (el.type !== 'arrow') continue;
            const ar = el as ArrowData;
            if ('elementId' in ar.startConnection && 'elementId' in ar.endConnection) {
                const fromId = ar.startConnection.elementId;
                const toId = ar.endConnection.elementId;
                const fromEdge = this.anchorToEdgeIdx(ar.startConnection.anchor);
                const toEdge = this.anchorToEdgeIdx(ar.endConnection.anchor);
                // Store both directions for easy lookup
                this.arrowEdgeCache.add(`${fromId}->${toId}:${fromEdge}->${toEdge}`);
                this.arrowEdgeCache.add(`${toId}->${fromId}:${toEdge}->${fromEdge}`);
            }
        }
    }

    private areEdgesConnected(id1: string, id2: string, edge1: number, edge2: number): boolean {
        return this.arrowEdgeCache.has(`${id1}->${id2}:${edge1}->${edge2}`);
    }

    // Called each mousemove during drag — only shows preview lines, no snapping
    computeAlignmentPreview(ids: Set<string>): void {
        this.clearAlignmentSnap();

        const movingIds = new Set<string>();
        for (const el of this.data.elements) {
            if (el.type === 'textbox' && ids.has(el.id)) movingIds.add(el.id);
        }
        if (movingIds.size === 0) return;

        this.buildArrowCache();

        // Collect static textboxes
        const staticTbs: TextBoxData[] = [];
        for (const el of this.data.elements) {
            if (el.type === 'textbox' && !movingIds.has(el.id)) staticTbs.push(el);
        }
        if (staticTbs.length === 0) return;

        // Helper: compute 4 edge midpoints for a textbox
        const edgePts = (tb: TextBoxData) => [
            { x: tb.x + tb.width / 2, y: tb.y },         // top
            { x: tb.x + tb.width / 2, y: tb.y + tb.height }, // bottom
            { x: tb.x, y: tb.y + tb.height / 2 },         // left
            { x: tb.x + tb.width, y: tb.y + tb.height / 2 }, // right
        ];

        // Best candidates per axis
        type AlignCand = { off: number; mx: number; my: number; sx: number; sy: number; priority: number; };
        let bestX: AlignCand | null = null;
        let bestY: AlignCand | null = null;

        for (const el of this.data.elements) {
            if (el.type !== 'textbox' || !movingIds.has(el.id)) continue;
            const tb = el as TextBoxData;
            const movingPts = edgePts(tb);

            for (const otb of staticTbs) {
                const staticPts = edgePts(otb);

                for (let mi = 0; mi < 4; mi++) {
                    const mp = movingPts[mi]!;
                    for (let si = 0; si < 4; si++) {
                        const sp = staticPts[si]!;
                        const xOff = sp.x - mp.x;
                        const yOff = sp.y - mp.y;

                        let prio = 3;
                        if (this.areEdgesConnected(tb.id, otb.id, mi, si)) prio = 1;
                        else if (mi === si) prio = 2;

                        interface IC { off: number; mx: number; my: number; sx: number; sy: number; priority: number; }
                        if (Math.abs(xOff) < SNAP_DISTANCE) {
                            const cand: IC = { off: xOff, mx: mp.x, my: mp.y, sx: sp.x, sy: sp.y, priority: prio };
                            if (bestX === null || cand.priority < bestX.priority
                                || (cand.priority === bestX.priority && Math.abs(cand.off) < Math.abs(bestX.off))) {
                                bestX = cand;
                            }
                        }
                        if (Math.abs(yOff) < SNAP_DISTANCE) {
                            const cand: IC = { off: yOff, mx: mp.x, my: mp.y, sx: sp.x, sy: sp.y, priority: prio };
                            if (bestY === null || cand.priority < bestY.priority
                                || (cand.priority === bestY.priority && Math.abs(cand.off) < Math.abs(bestY.off))) {
                                bestY = cand;
                            }
                        }
                    }
                }
            }
        }

        if (bestX) {
            this.alignmentSnap.active = true;
            this.alignmentSnap.hasCandidate = true;
            const y1 = Math.min(bestX.my, bestX.sy) - 8;
            const y2 = Math.max(bestX.my, bestX.sy) + 8;
            this.alignmentSnap.lines.push({ x1: bestX.sx, y1, x2: bestX.sx, y2 });
        }
        if (bestY) {
            this.alignmentSnap.active = true;
            this.alignmentSnap.hasCandidate = true;
            const x1 = Math.min(bestY.mx, bestY.sx) - 8;
            const x2 = Math.max(bestY.mx, bestY.sx) + 8;
            this.alignmentSnap.lines.push({ x1, y1: bestY.sy, x2, y2: bestY.sy });
        }
    }

    // Called once on mouseup — applies the snap using the priority system
    applyAlignmentSnap(ids: Set<string>): void {
        if (!this.alignmentSnap.hasCandidate) return;

        const movingIds = new Set<string>();
        for (const el of this.data.elements) {
            if (el.type === 'textbox' && ids.has(el.id)) movingIds.add(el.id);
        }
        if (movingIds.size === 0) return;

        const staticTbs: TextBoxData[] = [];
        for (const el of this.data.elements) {
            if (el.type === 'textbox' && !movingIds.has(el.id)) staticTbs.push(el);
        }
        if (staticTbs.length === 0) return;

        const edgePts = (tb: TextBoxData) => [
            { x: tb.x + tb.width / 2, y: tb.y },
            { x: tb.x + tb.width / 2, y: tb.y + tb.height },
            { x: tb.x, y: tb.y + tb.height / 2 },
            { x: tb.x + tb.width, y: tb.y + tb.height / 2 },
        ];

        let snapByX = 0, snapByY = 0;
        type SnapCand = { off: number; priority: number; };
        let bestX: SnapCand | null = null;
        let bestY: SnapCand | null = null;

        this.buildArrowCache();

        for (const el of this.data.elements) {
            if (el.type !== 'textbox' || !movingIds.has(el.id)) continue;
            const tb = el as TextBoxData;
            const movingPts = edgePts(tb);

            for (const otb of staticTbs) {
                const staticPts = edgePts(otb);

                for (let mi = 0; mi < 4; mi++) {
                    const mp = movingPts[mi]!;
                    for (let si = 0; si < 4; si++) {
                        const sp = staticPts[si]!;
                        const xOff = sp.x - mp.x;
                        const yOff = sp.y - mp.y;

                        let prio = 3;
                        if (this.areEdgesConnected(tb.id, otb.id, mi, si)) prio = 1;
                        else if (mi === si) prio = 2;

                        interface IC2 { off: number; priority: number; }
                        if (Math.abs(xOff) < SNAP_DISTANCE) {
                            const cand: IC2 = { off: xOff, priority: prio };
                            if (bestX === null || cand.priority < bestX.priority
                                || (cand.priority === bestX.priority && Math.abs(cand.off) < Math.abs(bestX.off))) {
                                bestX = cand;
                            }
                        }
                        if (Math.abs(yOff) < SNAP_DISTANCE) {
                            const cand: IC2 = { off: yOff, priority: prio };
                            if (bestY === null || cand.priority < bestY.priority
                                || (cand.priority === bestY.priority && Math.abs(cand.off) < Math.abs(bestY.off))) {
                                bestY = cand;
                            }
                        }
                    }
                }
            }
        }

        // Apply both axes (dual-axis snap)
        if (bestX) snapByX = bestX.off;
        if (bestY) snapByY = bestY.off;

        if (snapByX !== 0 || snapByY !== 0) {
            for (const el of this.data.elements) {
                if (!ids.has(el.id)) continue;
                if (el.type === 'textbox') {
                    el.x += snapByX;
                    el.y += snapByY;
                } else if (el.type === 'arrow') {
                    const ar = el as ArrowData;
                    if (!('elementId' in ar.startConnection)) {
                        (ar.startConnection as FreePoint).x += snapByX;
                        (ar.startConnection as FreePoint).y += snapByY;
                    }
                    if (!('elementId' in ar.endConnection)) {
                        (ar.endConnection as FreePoint).x += snapByX;
                        (ar.endConnection as FreePoint).y += snapByY;
                    }
                }
            }
            this.notifyChange();
        }
    }

    clearAlignmentSnap(): void {
        this.alignmentSnap = { active: false, lines: [], hasCandidate: false };
    }

    // ---- Resize Snap (拖拽角点时吸附) ----

    public resizeSnap: {
        active: boolean;
        dx: number;
        dy: number;
        lines: { x1: number; y1: number; x2: number; y2: number }[];
    } = { active: false, dx: 0, dy: 0, lines: [] };

    computeResizeSnap(textboxId: string, handle: string): void {
        this.clearResizeSnap();
        const tb = this.data.elements.find(e => e.id === textboxId && e.type === 'textbox') as TextBoxData | undefined;
        if (!tb) return;

        const edgeMap: Record<string, { xEdge: 'left' | 'right'; yEdge: 'top' | 'bottom' }> = {
            'se': { xEdge: 'right', yEdge: 'bottom' },
            'sw': { xEdge: 'left',  yEdge: 'bottom' },
            'ne': { xEdge: 'right', yEdge: 'top' },
            'nw': { xEdge: 'left',  yEdge: 'top' },
        };
        const pair = edgeMap[handle];
        if (!pair) return;

        const curX = pair.xEdge === 'right' ? tb.x + tb.width : tb.x;
        const curY = pair.yEdge === 'bottom' ? tb.y + tb.height : tb.y;

        const others: TextBoxData[] = [];
        for (const el of this.data.elements) {
            if (el.type === 'textbox' && el.id !== textboxId) others.push(el);
        }
        if (others.length === 0) return;

        let bestDx = 0, bestXDist = Infinity;
        let lineY1 = 0, lineY2 = 0;
        for (const o of others) {
            const target = pair.xEdge === 'right' ? o.x + o.width : o.x;
            const dist = target - curX;
            const abs = Math.abs(dist);
            if (abs < SNAP_DISTANCE && abs < bestXDist) {
                bestXDist = abs;
                bestDx = dist;
                lineY1 = Math.min(tb.y, o.y);
                lineY2 = Math.max(tb.y + tb.height, o.y + o.height);
            }
        }

        let bestDy = 0, bestYDist = Infinity;
        let lineX1 = 0, lineX2 = 0;
        for (const o of others) {
            const target = pair.yEdge === 'bottom' ? o.y + o.height : o.y;
            const dist = target - curY;
            const abs = Math.abs(dist);
            if (abs < SNAP_DISTANCE && abs < bestYDist) {
                bestYDist = abs;
                bestDy = dist;
                lineX1 = Math.min(tb.x, o.x);
                lineX2 = Math.max(tb.x + tb.width, o.x + o.width);
            }
        }

        if (bestDx !== 0 || bestDy !== 0) {
            this.resizeSnap.active = true;
            this.resizeSnap.dx = bestDx;
            this.resizeSnap.dy = bestDy;
        }

        if (bestDx !== 0) {
            this.resizeSnap.lines.push({
                x1: curX + bestDx, y1: lineY1 - 8,
                x2: curX + bestDx, y2: lineY2 + 8,
            });
        }
        if (bestDy !== 0) {
            this.resizeSnap.lines.push({
                x1: lineX1 - 8, y1: curY + bestDy,
                x2: lineX2 + 8, y2: curY + bestDy,
            });
        }
    }

    applyResizeSnap(textboxId: string, handle: string): void {
        if (!this.resizeSnap.active) return;
        const el = this.data.elements.find(e => e.id === textboxId) as TextBoxData | undefined;
        if (!el) return;

        const { dx, dy } = this.resizeSnap;

        if (handle === 'se') {
            el.width  = Math.max(MIN_TEXTBOX_WIDTH,  el.width  + dx);
            el.height = Math.max(MIN_TEXTBOX_HEIGHT, el.height + dy);
        } else if (handle === 'sw') {
            el.x      = el.x + dx;
            el.width  = Math.max(MIN_TEXTBOX_WIDTH,  el.width  - dx);
            el.height = Math.max(MIN_TEXTBOX_HEIGHT, el.height + dy);
        } else if (handle === 'ne') {
            el.width  = Math.max(MIN_TEXTBOX_WIDTH,  el.width  + dx);
            el.y      = el.y + dy;
            el.height = Math.max(MIN_TEXTBOX_HEIGHT, el.height - dy);
        } else if (handle === 'nw') {
            el.x      = el.x + dx;
            el.width  = Math.max(MIN_TEXTBOX_WIDTH,  el.width  - dx);
            el.y      = el.y + dy;
            el.height = Math.max(MIN_TEXTBOX_HEIGHT, el.height - dy);
        }

        el.autoSize = false;
        this.notifyChange();
    }

    clearResizeSnap(): void {
        this.resizeSnap = { active: false, dx: 0, dy: 0, lines: [] };
    }

    updateConnectedArrows(textboxId: string): void {
        // When a textbox moves, arrows connected to its anchors just reference
        // the anchor position via resolveConnection - no need to update coordinates
        // since we resolve them dynamically
        this.notifyChange();
    }

    // --- Selection ---

    selectElementsInRect(x1: number, y1: number, x2: number, y2: number, additive: boolean): void {
        const minX = Math.min(x1, x2);
        const minY = Math.min(y1, y2);
        const maxX = Math.max(x1, x2);
        const maxY = Math.max(y1, y2);

        const found = new Set<string>();
        for (const el of this.data.elements) {
            const bounds = this.getElementBounds(el);
            if (bounds.x < maxX && bounds.x + bounds.width > minX &&
                bounds.y < maxY && bounds.y + bounds.height > minY) {
                found.add(el.id);
            }
        }

        if (additive) {
            for (const id of found) {
                if (this.selectedIds.has(id)) {
                    this.selectedIds.delete(id);
                } else {
                    this.selectedIds.add(id);
                }
            }
        } else {
            this.selectedIds = found;
        }
        if (this.onSelectionChange) this.onSelectionChange();
    }

    selectElement(id: string, additive: boolean): void {
        if (additive) {
            if (this.selectedIds.has(id)) {
                this.selectedIds.delete(id);
            } else {
                this.selectedIds.add(id);
            }
        } else {
            this.selectedIds.clear();
            this.selectedIds.add(id);
        }
        if (this.onSelectionChange) this.onSelectionChange();
    }

    clearSelection(): void {
        if (this.selectedIds.size > 0) {
            this.selectedIds.clear();
            if (this.onSelectionChange) this.onSelectionChange();
        }
    }

    // --- Element Hit Testing ---

    getElementAt(canvasX: number, canvasY: number): ElementData | null {
        // Check in reverse order (topmost first)
        for (let i = this.data.elements.length - 1; i >= 0; i--) {
            const el = this.data.elements[i]!;
            if (this.isPointInElement(el, canvasX, canvasY)) {
                return el;
            }
        }
        return null;
    }

    isPointInElement(el: ElementData, x: number, y: number): boolean {
        if (el.type === 'textbox') {
            const tb = el as TextBoxData;
            return x >= tb.x && x <= tb.x + tb.width && y >= tb.y && y <= tb.y + tb.height;
        } else {
            const arrow = el as ArrowData;
            const points = this.buildArrowPath(arrow.startConnection, arrow.endConnection, arrow.arrowDirection);
            const threshold = 5;
            for (let i = 1; i < points.length; i++) {
                const a = points[i - 1]!;
                const b = points[i]!;
                if (this.pointToSegmentDist(x, y, a.x, a.y, b.x, b.y) < threshold) {
                    return true;
                }
            }
            return false;
        }
    }

    pointToSegmentDist(px: number, py: number, x1: number, y1: number, x2: number, y2: number): number {
        const dx = x2 - x1;
        const dy = y2 - y1;
        const lenSq = dx * dx + dy * dy;
        if (lenSq === 0) return Math.sqrt((px - x1) ** 2 + (py - y1) ** 2);
        let t = ((px - x1) * dx + (py - y1) * dy) / lenSq;
        t = Math.max(0, Math.min(1, t));
        const closestX = x1 + t * dx;
        const closestY = y1 + t * dy;
        return Math.sqrt((px - closestX) ** 2 + (py - closestY) ** 2);
    }

    getResizeHandle(el: TextBoxData, canvasX: number, canvasY: number): string | null {
        const handles = [
            { name: 'se', x: el.x + el.width, y: el.y + el.height },
            { name: 'sw', x: el.x, y: el.y + el.height },
            { name: 'ne', x: el.x + el.width, y: el.y },
            { name: 'nw', x: el.x, y: el.y },
        ];
        const threshold = 8;
        for (const h of handles) {
            if (Math.abs(canvasX - h.x) < threshold && Math.abs(canvasY - h.y) < threshold) {
                return h.name;
            }
        }
        return null;
    }

    // --- Pan/Zoom ---

    pan(dx: number, dy: number): void {
        this.data.viewState.panX += dx;
        this.data.viewState.panY += dy;
        this.notifyChange();
    }

    zoomAt(centerX: number, centerY: number, delta: number): void {
        const oldZoom = this.data.viewState.zoom;
        const newZoom = Math.max(0.1, Math.min(5, oldZoom * (1 - delta * 0.001)));
        if (oldZoom === newZoom) return;

        // Zoom toward mouse position
        const mouseCanvasX = (centerX - this.data.viewState.panX) / oldZoom;
        const mouseCanvasY = (centerY - this.data.viewState.panY) / oldZoom;

        this.data.viewState.zoom = newZoom;
        this.data.viewState.panX = centerX - mouseCanvasX * newZoom;
        this.data.viewState.panY = centerY - mouseCanvasY * newZoom;

        this.notifyChange();
    }

    // --- Z-order (textboxes only) ---

    sendTextboxToFront(id: string): void {
        const idx = this.data.elements.findIndex(e => e.id === id);
        if (idx === -1 || this.data.elements[idx].type !== 'textbox') return;

        let lastTbIdx = -1;
        for (let i = 0; i < this.data.elements.length; i++) {
            if (this.data.elements[i].type === 'textbox') lastTbIdx = i;
        }
        if (idx === lastTbIdx) return;

        const [el] = this.data.elements.splice(idx, 1);
        const adj = lastTbIdx > idx ? lastTbIdx - 1 : lastTbIdx;
        this.data.elements.splice(adj + 1, 0, el);
        this.saveHistory();
        this.notifyChange();
    }

    sendTextboxToBack(id: string): void {
        const idx = this.data.elements.findIndex(e => e.id === id);
        if (idx === -1 || this.data.elements[idx].type !== 'textbox') return;

        let firstTbIdx = -1;
        for (let i = 0; i < this.data.elements.length; i++) {
            if (this.data.elements[i].type === 'textbox') {
                firstTbIdx = i;
                break;
            }
        }
        if (idx === firstTbIdx) return;

        const [el] = this.data.elements.splice(idx, 1);
        const adj = firstTbIdx > idx ? firstTbIdx - 1 : firstTbIdx;
        this.data.elements.splice(adj, 0, el);
        this.saveHistory();
        this.notifyChange();
    }

    // --- Auto-size textbox on first edit ---

    setTextboxContent(id: string, content: string): void {
        const el = this.data.elements.find(e => e.id === id && e.type === 'textbox') as TextBoxData | undefined;
        if (!el) return;
        el.content = content;
        this.notifyChange();
    }

    // --- Generate unique filename ---

    static generateFileName(): string {
        const now = new Date();
        const dateStr = now.getFullYear() + '-' +
            String(now.getMonth() + 1).padStart(2, '0') + '-' +
            String(now.getDate()).padStart(2, '0') + '_' +
            String(now.getHours()).padStart(2, '0') + '-' +
            String(now.getMinutes()).padStart(2, '0') + '-' +
            String(now.getSeconds()).padStart(2, '0');
        return 'drawing_' + dateStr + '.simpledraw';
    }
}
