// Types for SimpleDraw Plugin

export interface SimpleDrawData {
    version: number;
    elements: ElementData[];
    viewState: ViewState;
}

export interface ViewState {
    panX: number;
    panY: number;
    zoom: number;
}

export interface TextBoxData {
    id: string;
    type: 'textbox';
    x: number;
    y: number;
    width: number;
    height: number;
    content: string;
    visible: boolean;
    fillEnabled: boolean;
    hAlign: 'left' | 'center' | 'right';
    vAlign: 'top' | 'middle' | 'bottom';
    autoSize: boolean;
    fontSize?: number;
    writingMode?: 'horizontal-tb' | 'vertical-rl';
    shape?: TextboxShape;
}

export type TextboxShape = 'rectangle' | 'ellipse' | 'diamond';

export interface ArrowConnection {
    elementId: string;
    anchor: AnchorType;
}

export type AnchorType = 'top' | 'bottom' | 'left' | 'right' | 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';

export interface FreePoint {
    x: number;
    y: number;
}

export interface ArrowData {
    id: string;
    type: 'arrow';
    startConnection: ArrowConnection | FreePoint;
    endConnection: ArrowConnection | FreePoint;
    showStartArrow: boolean;
    showEndArrow: boolean;
    arrowDirection: ArrowDirection;
    dashed?: boolean;
}

export type ArrowDirection = 'left' | 'right' | 'up' | 'down';

export type ElementData = TextBoxData | ArrowData;

export enum InteractionMode {
    None = 'none',
    InsertTextBox = 'insert-textbox',
    InsertArrow = 'insert-arrow',
    Selecting = 'selecting',
}

export interface TextBoxInsertState {
    firstClick: { x: number; y: number } | null;
}

export interface ArrowInsertState {
    firstClick: { x: number; y: number } | null;
    mouseX: number;
    mouseY: number;
}

export interface SelectionState {
    startX: number;
    startY: number;
    currentX: number;
    currentY: number;
    selectedIds: Set<string>;
}

export interface HistoryEntry {
    data: SimpleDrawData;
}

export const DEFAULT_DATA: SimpleDrawData = {
    version: 1,
    elements: [],
    viewState: {
        panX: 0,
        panY: 0,
        zoom: 1,
    },
};

export const GRID_SIZE = 20;
export const ANCHOR_SIZE = 6;
export const SNAP_DISTANCE = 10;
export const MIN_TEXTBOX_WIDTH = 50;
export const MIN_TEXTBOX_HEIGHT = 30;
export const DEFAULT_TEXTBOX_WIDTH = 200;
export const DEFAULT_TEXTBOX_HEIGHT = 100;
