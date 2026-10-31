import { MARCH_ARROW_COLOR, marchArrowTriangle, marchArrows } from "./intelligence-map.mjs";

const STATE_SHAPES = Object.freeze({
  normal: "circle",
  expedition: "arrow",
  "reside-going": "arrow",
  "reinforce-going": "arrow",
  returning: "return",
  reside: "shield",
  reinforce: "shield",
  stay: "circle",
  unknown: "diamond",
});

const STATE_COLORS = Object.freeze({
  normal: "#94a3b8",
  expedition: "#f05267",
  "reside-going": "#38bdf8",
  "reinforce-going": "#8b6cff",
  returning: "#f5b84b",
  reside: "#34d399",
  reinforce: "#54a6ff",
  stay: "#9aabca",
  unknown: "#c98555",
});

export const RELATION_COLORS = Object.freeze({
  self: "#34d399",
  ally: "#54a6ff",
  enemy: "#f05267",
  unknown: "#94a3b8",
});

export function relationFor(userId, unionId, viewer) {
  const user = Number(userId) || 0;
  const union = Number(unionId) || 0;
  const selfUser = Number(viewer?.userId) || 0;
  const selfUnion = Number(viewer?.unionId) || 0;
  if (selfUser && user && user === selfUser) return "self";
  if (selfUnion && union && union === selfUnion) return "ally";
  if (
    selfUser
    && user
    && user !== selfUser
    && selfUnion
    && union
    && union !== selfUnion
  ) {
    return "enemy";
  }
  return "unknown";
}

export function wheelZoomFactor(deltaY) {
  const clamped = Math.max(-48, Math.min(48, Number(deltaY) || 0));
  return Math.min(1.08, Math.max(0.93, Math.exp(clamped * 0.0011)));
}

export function widToPoint(wid) {
  const value = Number(wid) || 0;
  if (value <= 0) return { row: 0, col: 0 };
  return {
    row: Math.floor(value / 10000),
    col: value % 10000,
  };
}

export function boundsForArmies(armies, fallback = null) {
  const points = [];
  for (const army of armies || []) {
    const location = army?.location || {};
    for (const key of ["currentWid", "nextWid", "targetWid"]) {
      const point = widToPoint(location[key]);
      if (point.row > 0 || point.col > 0) points.push(point);
    }
  }
  if (!points.length) {
    return fallback
      ? normalizeBounds(fallback)
      : { rowUp: 0, rowDown: 19, colLeft: 0, colRight: 19 };
  }
  const rows = points.map((point) => point.row);
  const cols = points.map((point) => point.col);
  const rowSpan = Math.max(...rows) - Math.min(...rows) + 1;
  const colSpan = Math.max(...cols) - Math.min(...cols) + 1;
  const padding = Math.max(4, Math.ceil(Math.max(rowSpan, colSpan) * 0.08));
  return {
    rowUp: Math.max(0, Math.min(...rows) - padding),
    rowDown: Math.max(...rows) + padding,
    colLeft: Math.max(0, Math.min(...cols) - padding),
    colRight: Math.max(...cols) + padding,
  };
}

export function buildArmyDrawPlan(
  armies,
  selectedArmyId,
  bounds,
  viewport = { width: 800, height: 560 },
  options = {},
) {
  const normalizedBounds = normalizeBounds(bounds);
  const mapRect = {
    x: 28,
    y: 28,
    width: Math.max(1, Number(viewport.width || 800) - 56),
    height: Math.max(1, Number(viewport.height || 560) - 56),
  };
  const markers = [];
  const routes = [];
  const viewer = options?.viewer || null;
  for (const army of armies || []) {
    const location = army?.location || {};
    const current = projectWid(
      location.currentWid,
      normalizedBounds,
      mapRect,
    );
    if (!current) continue;
    const next = projectWid(location.nextWid, normalizedBounds, mapRect);
    const target = projectWid(location.targetWid, normalizedBounds, mapRect);
    const offline = Boolean(army.offline);
    const stale = !offline && Boolean(army?.source?.isStale);
    const shape = stale
      ? "diamond"
      : STATE_SHAPES[army.stateKey] || "diamond";
    const relation = relationFor(
      army.userId,
      army.ownerUnionId,
      viewer,
    );
    const color = RELATION_COLORS[relation] || RELATION_COLORS.unknown;
    const evidenceColor = offline
      ? "#7183a7"
      : stale
        ? "#f5b84b"
        : STATE_COLORS[army.stateKey] || STATE_COLORS.unknown;
    markers.push({
      armyId: Number(army.armyId) || 0,
      x: current.x,
      y: current.y,
      shape,
      color,
      relation,
      evidenceColor,
      stateKey: army.stateKey || "unknown",
      stateLabel: army.stateLabel || "状态未知",
      selected: Number(army.armyId) === Number(selectedArmyId),
      offline,
      stale,
      hitRadius: 15,
      label: String(army.armyId || "").slice(-5),
    });

    let routeKind = "stationary";
    const routePoints = [current];
    if (stale) {
      routeKind = "stale";
      if (target && !samePoint(current, target)) routePoints.push(target);
    } else if (offline) {
      routeKind = "offline";
      if (target && !samePoint(current, target)) routePoints.push(target);
    } else if (army.isMoving && next && target) {
      routeKind = "complete";
      routePoints.push(next);
      if (!samePoint(next, target)) routePoints.push(target);
    } else if (
      army.isMoving &&
      target &&
      !samePoint(current, target)
    ) {
      routeKind = "incomplete";
      routePoints.push(target);
    }
    routes.push({
      armyId: Number(army.armyId) || 0,
      kind: routeKind,
      color,
      relation,
      selected: Number(army.armyId) === Number(selectedArmyId),
      points: routePoints,
    });
  }
  return {
    bounds: normalizedBounds,
    mapRect,
    markers,
    routes,
  };
}

export function drawLiveArmyMap(
  canvas,
  plan,
  {
    devicePixelRatio = globalThis.devicePixelRatio || 1,
    reducedMotion = false,
  } = {},
) {
  if (!canvas?.getContext) return plan;
  const width = Math.max(1, canvas.clientWidth || canvas.width || 800);
  const height = Math.max(1, canvas.clientHeight || canvas.height || 560);
  const ratio = Math.max(1, Number(devicePixelRatio) || 1);
  canvas.width = Math.round(width * ratio);
  canvas.height = Math.round(height * ratio);
  canvas.style.width = `${width}px`;
  canvas.style.height = `${height}px`;
  const context = canvas.getContext("2d");
  context.setTransform(ratio, 0, 0, ratio, 0, 0);
  context.clearRect(0, 0, width, height);
  context.fillStyle = "#081226";
  context.fillRect(0, 0, width, height);
  drawGrid(context, plan.mapRect);

  const paintOrder = (item) => {
    const rank = { unknown: 0, enemy: 1, ally: 2, self: 3 }[item.relation] || 0;
    return rank + (item.selected ? 10 : 0);
  };
  const routes = [...(plan.routes || [])].sort(
    (left, right) => paintOrder(left) - paintOrder(right),
  );
  const markers = [...(plan.markers || [])].sort(
    (left, right) => paintOrder(left) - paintOrder(right),
  );
  for (const route of routes) drawRoute(context, route);
  for (const marker of markers) {
    drawMarker(context, marker, { reducedMotion });
  }
  return plan;
}

export function hitTestArmy(x, y, plan) {
  const markers = plan?.markers || [];
  for (let index = markers.length - 1; index >= 0; index -= 1) {
    const marker = markers[index];
    const radius = Number(marker.hitRadius || 14);
    if (
      Math.hypot(Number(x) - marker.x, Number(y) - marker.y) <= radius
    ) {
      return Number(marker.armyId) || 0;
    }
  }
  return 0;
}

export function panBounds(bounds, rowDelta, colDelta) {
  const current = normalizeBounds(bounds);
  const rows = current.rowDown - current.rowUp;
  const cols = current.colRight - current.colLeft;
  let rowUp = Math.round(current.rowUp + Number(rowDelta || 0));
  let colLeft = Math.round(current.colLeft + Number(colDelta || 0));
  rowUp = Math.max(0, rowUp);
  colLeft = Math.max(0, colLeft);
  return {
    rowUp,
    rowDown: rowUp + rows,
    colLeft,
    colRight: colLeft + cols,
  };
}

export function zoomBounds(bounds, row, col, direction) {
  const current = normalizeBounds(bounds);
  const currentRows = current.rowDown - current.rowUp + 1;
  const currentCols = current.colRight - current.colLeft + 1;
  const numeric = Number(direction);
  const factor = numeric === -1
    ? 0.72
    : numeric === 1
      ? 1.38
      : Math.min(1.12, Math.max(0.88, Number.isFinite(numeric) ? numeric : 1));
  const rows = Math.max(8, Math.min(1200, Math.round(currentRows * factor)));
  const cols = Math.max(8, Math.min(1200, Math.round(currentCols * factor)));
  const rowRatio = currentRows
    ? (Number(row) - current.rowUp) / currentRows
    : 0.5;
  const colRatio = currentCols
    ? (Number(col) - current.colLeft) / currentCols
    : 0.5;
  const rowUp = Math.max(0, Math.round(Number(row) - rows * rowRatio));
  const colLeft = Math.max(0, Math.round(Number(col) - cols * colRatio));
  return {
    rowUp,
    rowDown: rowUp + rows - 1,
    colLeft,
    colRight: colLeft + cols - 1,
  };
}

function normalizeBounds(bounds) {
  const value = bounds || {};
  let rowUp = Math.max(0, Math.round(Number(value.rowUp) || 0));
  let rowDown = Math.max(rowUp, Math.round(Number(value.rowDown) || rowUp + 19));
  let colLeft = Math.max(0, Math.round(Number(value.colLeft) || 0));
  let colRight = Math.max(
    colLeft,
    Math.round(Number(value.colRight) || colLeft + 19),
  );
  if (rowDown === rowUp) rowDown += 1;
  if (colRight === colLeft) colRight += 1;
  return { rowUp, rowDown, colLeft, colRight };
}

function projectWid(wid, bounds, rect) {
  const point = widToPoint(wid);
  if (point.row <= 0 && point.col <= 0) return null;
  const rowSpan = Math.max(1, bounds.rowDown - bounds.rowUp);
  const colSpan = Math.max(1, bounds.colRight - bounds.colLeft);
  return {
    wid: Number(wid),
    x: rect.x + ((point.col - bounds.colLeft) / colSpan) * rect.width,
    y: rect.y + ((point.row - bounds.rowUp) / rowSpan) * rect.height,
  };
}

function samePoint(left, right) {
  return left?.wid === right?.wid;
}

function drawGrid(context, rect) {
  context.save();
  context.strokeStyle = "rgba(56,189,248,.07)";
  context.lineWidth = 1;
  const step = 28;
  for (let x = rect.x; x <= rect.x + rect.width; x += step) {
    context.beginPath();
    context.moveTo(x, rect.y);
    context.lineTo(x, rect.y + rect.height);
    context.stroke();
  }
  for (let y = rect.y; y <= rect.y + rect.height; y += step) {
    context.beginPath();
    context.moveTo(rect.x, y);
    context.lineTo(rect.x + rect.width, y);
    context.stroke();
  }
  context.restore();
}

function drawRoute(context, route) {
  if (!route.points || route.points.length < 2) return;
  context.save();
  context.strokeStyle = route.color;
  context.lineWidth = route.selected ? 3 : 1.5;
  context.globalAlpha = route.kind === "offline" ? 0.45 : 0.82;
  // 根据关系设置箭头颜色：敌方为红色箭头，我方/盟友为蓝色箭头
  const arrowColor = route.relation === "enemy" ? "#f05267" : "#54a6ff";
  context.fillStyle = arrowColor;
  for (let index = 1; index < route.points.length; index += 1) {
    const start = route.points[index - 1];
    const end = route.points[index];
    const arrows = marchArrows(start.x, start.y, end.x, end.y);
    context.beginPath();
    context.setLineDash([]);
    context.moveTo(start.x, start.y);
    context.lineTo(end.x, end.y);
    context.stroke();
    context.setLineDash([]);
    context.globalAlpha = route.kind === "offline" ? 0.7 : 1;
    for (const arrow of arrows) {
      const triangle = marchArrowTriangle(arrow, 8, 6);
      context.beginPath();
      context.moveTo(triangle[0].x, triangle[0].y);
      context.lineTo(triangle[1].x, triangle[1].y);
      context.lineTo(triangle[2].x, triangle[2].y);
      context.closePath();
      context.fill();
    }
  }
  context.restore();
}

function drawMarker(context, marker) {
  context.save();
  context.translate(marker.x, marker.y);
  context.globalAlpha = marker.offline ? 0.5 : 1;
  context.fillStyle = marker.color;
  context.strokeStyle = marker.stale || marker.offline
    ? marker.evidenceColor || marker.color
    : "#f4f7ff";
  context.lineWidth = marker.selected ? 2.5 : 1.5;
  if (marker.offline) context.setLineDash([3, 3]);
  drawShape(context, marker.shape);
  context.fill();
  context.stroke();
  context.setLineDash([]);
  if (marker.selected) {
    context.beginPath();
    context.strokeStyle = "#f4f7ff";
    context.lineWidth = 1;
    context.arc(0, 0, 16, 0, Math.PI * 2);
    context.stroke();
  }
  context.font = "700 8px ui-monospace, monospace";
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.fillStyle = marker.color;
  context.fillText(marker.label, 0, 0);
  context.restore();
}

function drawShape(context, shape) {
  context.beginPath();
  if (shape === "shield") {
    context.moveTo(0, -12);
    context.lineTo(11, -7);
    context.lineTo(9, 6);
    context.quadraticCurveTo(0, 13, -9, 6);
    context.lineTo(-11, -7);
    context.closePath();
  } else if (shape === "arrow") {
    context.moveTo(0, -13);
    context.lineTo(11, 8);
    context.lineTo(3, 5);
    context.lineTo(0, 12);
    context.lineTo(-3, 5);
    context.lineTo(-11, 8);
    context.closePath();
  } else if (shape === "return") {
    context.arc(0, 0, 11, Math.PI * 0.2, Math.PI * 1.75);
    context.lineTo(-5, -12);
    context.lineTo(2, -10);
  } else if (shape === "diamond") {
    context.moveTo(0, -12);
    context.lineTo(12, 0);
    context.lineTo(0, 12);
    context.lineTo(-12, 0);
    context.closePath();
  } else {
    context.arc(0, 0, 11, 0, Math.PI * 2);
  }
}
