import type {
  IChartApi,
  IPrimitivePaneRenderer,
  IPrimitivePaneView,
  ISeriesApi,
  ISeriesPrimitive,
  ITimeScaleApi,
  PrimitiveHoveredItem,
  SeriesAttachedParameter,
  SeriesType,
  Time,
} from "lightweight-charts";

import {
  DRAWING_HANDLE_RADIUS_PX,
  hitsHorizontalLine,
  hitsTrendSegment,
} from "./geometry.ts";
import {
  EMPTY_DRAWING_STATE,
  type ChartDrawing,
  type DrawingColors,
  type DrawingDraft,
  type DrawingPoint,
  type DrawingPrimitiveState,
} from "./types.ts";

type BitmapRenderScope = {
  context: CanvasRenderingContext2D;
  mediaSize: { width: number; height: number };
  horizontalPixelRatio: number;
  verticalPixelRatio: number;
};

type ProjectedTrend = {
  kind: "trend-line";
  id: string;
  interactive: boolean;
  selected: boolean;
  hovered: boolean;
  draft: boolean;
  x1: number;
  y1: number;
  x2: number | null;
  y2: number | null;
};

type ProjectedHorizontal = {
  kind: "horizontal-line";
  id: string;
  interactive: boolean;
  selected: boolean;
  hovered: boolean;
  draft: boolean;
  y: number;
};

type ProjectedDrawing = ProjectedTrend | ProjectedHorizontal;

const VIEW_Z_ORDER = "top" as const;

function strokeColor(item: ProjectedDrawing, colors: DrawingColors): string {
  if (item.selected || item.hovered) {
    return colors.selected;
  }

  return colors.line;
}

function strokeWidthPx(item: ProjectedDrawing): number {
  return item.selected ? 2 : 1.5;
}

function strokeAlpha(item: ProjectedDrawing): number {
  if (item.draft) {
    return 0.7;
  }

  if (item.selected) {
    return 1;
  }

  if (item.hovered) {
    return 0.95;
  }

  return 0.85;
}

export class DrawingPrimitive implements ISeriesPrimitive {
  private chart: IChartApi | null = null;
  private series: ISeriesApi<SeriesType> | null = null;
  private requestUpdateFn: (() => void) | null = null;
  private state: DrawingPrimitiveState = {
    ...EMPTY_DRAWING_STATE,
    drawings: [],
    colors: { ...EMPTY_DRAWING_STATE.colors },
  };
  private projected: ProjectedDrawing[] = [];
  private readonly view: DrawingPaneView;
  private readonly views: IPrimitivePaneView[];

  constructor() {
    this.view = new DrawingPaneView(this);
    this.views = [this.view];
  }

  attached(param: SeriesAttachedParameter<Time, SeriesType>): void {
    this.chart = param.chart as IChartApi;
    this.series = param.series;
    this.requestUpdateFn = param.requestUpdate;
    this.requestUpdateFn();
  }

  detached(): void {
    this.chart = null;
    this.series = null;
    this.requestUpdateFn = null;
    this.projected = [];
  }

  setState(next: Partial<DrawingPrimitiveState>): void {
    this.state = {
      ...this.state,
      ...next,
      colors: next.colors ? { ...this.state.colors, ...next.colors } : this.state.colors,
      drawings: next.drawings ?? this.state.drawings,
    };
    this.requestUpdateFn?.();
  }

  getState(): DrawingPrimitiveState {
    return this.state;
  }

  paneViews(): readonly IPrimitivePaneView[] {
    return this.views;
  }

  updateAllViews(): void {
    this.project();
  }

  hitTest(x: number, y: number): PrimitiveHoveredItem | null {
    this.project();

    for (let index = this.projected.length - 1; index >= 0; index -= 1) {
      const item = this.projected[index];

      if (!item || !item.interactive) {
        continue;
      }

      if (!itemHits(item, x, y)) {
        continue;
      }

      return {
        externalId: item.id,
        cursorStyle: "pointer",
        zOrder: VIEW_Z_ORDER,
        itemType: "primitive",
      };
    }

    return null;
  }

  projectedDrawings(): readonly ProjectedDrawing[] {
    return this.projected;
  }

  private project(): void {
    const chart = this.chart;
    const series = this.series;

    if (!chart || !series) {
      this.projected = [];
      return;
    }

    const timeScale = chart.timeScale();
    const projected: ProjectedDrawing[] = [];
    const { selectedId, hoveredId } = this.state;

    for (const drawing of this.state.drawings) {
      const item = projectDrawing(drawing, timeScale, series, selectedId, hoveredId);

      if (item) {
        projected.push(item);
      }
    }

    const draftItem = projectDraft(this.state.draft, timeScale, series);

    if (draftItem) {
      projected.push(draftItem);
    }

    this.projected = projected;
  }

  renderItems(): readonly ProjectedDrawing[] {
    this.project();
    return this.projected;
  }

  colors(): DrawingColors {
    return this.state.colors;
  }
}

class DrawingPaneView implements IPrimitivePaneView {
  private readonly primitive: DrawingPrimitive;

  constructor(primitive: DrawingPrimitive) {
    this.primitive = primitive;
  }

  zOrder() {
    return VIEW_Z_ORDER;
  }

  update(): void {
    this.primitive.updateAllViews();
  }

  renderer(): IPrimitivePaneRenderer {
    return new DrawingPaneRenderer(this.primitive.renderItems(), this.primitive.colors());
  }
}

class DrawingPaneRenderer implements IPrimitivePaneRenderer {
  private readonly items: readonly ProjectedDrawing[];
  private readonly colors: DrawingColors;

  constructor(items: readonly ProjectedDrawing[], colors: DrawingColors) {
    this.items = items;
    this.colors = colors;
  }

  draw(target: Parameters<IPrimitivePaneRenderer["draw"]>[0]): void {
    target.useBitmapCoordinateSpace((scope) => {
      const ctx = scope.context;
      ctx.save();
      try {
        for (const item of this.items) {
          drawProjected(ctx, scope, item, this.colors);
        }
      } finally {
        ctx.restore();
      }
    });
  }
}

function projectDrawing(
  drawing: ChartDrawing,
  timeScale: ITimeScaleApi<Time>,
  series: ISeriesApi<SeriesType>,
  selectedId: string | null,
  hoveredId: string | null,
): ProjectedDrawing | null {
  const selected = drawing.id === selectedId;
  const hovered = drawing.id === hoveredId && !selected;

  if (drawing.type === "trend-line") {
    return projectTrend(drawing.id, drawing.a, drawing.b, true, selected, hovered, false, timeScale, series);
  }

  const y = series.priceToCoordinate(drawing.price);

  if (y === null) {
    return null;
  }

  return {
    kind: "horizontal-line",
    id: drawing.id,
    interactive: true,
    selected,
    hovered,
    draft: false,
    y,
  };
}

function projectDraft(
  draft: DrawingDraft | null,
  timeScale: ITimeScaleApi<Time>,
  series: ISeriesApi<SeriesType>,
): ProjectedDrawing | null {
  if (!draft) {
    return null;
  }

  if (draft.type === "trend-line") {
    return projectTrend("draft", draft.a, draft.b, false, false, false, true, timeScale, series);
  }

  const y = series.priceToCoordinate(draft.price);

  if (y === null) {
    return null;
  }

  return {
    kind: "horizontal-line",
    id: "draft",
    interactive: false,
    selected: false,
    hovered: false,
    draft: true,
    y,
  };
}

function projectTrend(
  id: string,
  a: DrawingPoint,
  b: DrawingPoint | null,
  interactive: boolean,
  selected: boolean,
  hovered: boolean,
  draft: boolean,
  timeScale: ITimeScaleApi<Time>,
  series: ISeriesApi<SeriesType>,
): ProjectedTrend | null {
  const x1 = timeScale.timeToCoordinate(a.time);
  const y1 = series.priceToCoordinate(a.price);

  if (x1 === null || y1 === null) {
    return null;
  }

  let x2: number | null = null;
  let y2: number | null = null;

  if (b) {
    x2 = timeScale.timeToCoordinate(b.time);
    y2 = series.priceToCoordinate(b.price);

    if (x2 === null || y2 === null) {
      x2 = null;
      y2 = null;
    }
  }

  return {
    kind: "trend-line",
    id,
    interactive: interactive && x2 !== null && y2 !== null,
    selected,
    hovered,
    draft,
    x1,
    y1,
    x2,
    y2,
  };
}

function itemHits(item: ProjectedDrawing, x: number, y: number): boolean {
  if (item.kind === "horizontal-line") {
    return hitsHorizontalLine(y, item.y);
  }

  return hitsTrendSegment(x, y, item.x1, item.y1, item.x2, item.y2);
}

function drawProjected(
  ctx: CanvasRenderingContext2D,
  scope: BitmapRenderScope,
  item: ProjectedDrawing,
  colors: DrawingColors,
): void {
  const hr = scope.horizontalPixelRatio;
  const vr = scope.verticalPixelRatio;
  ctx.globalAlpha = strokeAlpha(item);
  ctx.strokeStyle = strokeColor(item, colors);
  ctx.lineWidth = Math.max(1, strokeWidthPx(item) * hr);
  ctx.lineCap = "round";
  ctx.setLineDash(item.draft ? [6 * hr, 4 * hr] : []);

  if (item.kind === "horizontal-line") {
    const y = Math.round(item.y * vr);
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(Math.round(scope.mediaSize.width * hr), y);
    ctx.stroke();
  } else if (item.x2 !== null && item.y2 !== null) {
    ctx.beginPath();
    ctx.moveTo(Math.round(item.x1 * hr), Math.round(item.y1 * vr));
    ctx.lineTo(Math.round(item.x2 * hr), Math.round(item.y2 * vr));
    ctx.stroke();
  }

  const showHandles = item.kind === "trend-line" && (item.selected || (item.draft && item.x2 === null));

  if (item.kind === "trend-line" && item.selected) {
    drawHandle(ctx, item.x1, item.y1, hr, vr, colors);
    if (item.x2 !== null && item.y2 !== null) {
      drawHandle(ctx, item.x2, item.y2, hr, vr, colors);
    }
  } else if (showHandles) {
    drawHandle(ctx, item.x1, item.y1, hr, vr, colors);
  }

  ctx.setLineDash([]);
  ctx.globalAlpha = 1;
}

function drawHandle(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  hr: number,
  vr: number,
  colors: DrawingColors,
): void {
  ctx.save();
  ctx.globalAlpha = 1;
  ctx.setLineDash([]);
  ctx.fillStyle = colors.handle;
  ctx.strokeStyle = colors.selected;
  ctx.lineWidth = Math.max(1, hr);
  ctx.beginPath();
  ctx.arc(
    Math.round(x * hr),
    Math.round(y * vr),
    DRAWING_HANDLE_RADIUS_PX * hr,
    0,
    Math.PI * 2,
  );
  ctx.fill();
  ctx.stroke();
  ctx.restore();
}
