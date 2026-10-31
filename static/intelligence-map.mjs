export const LEVEL_COLORS = Object.freeze([
  "#18232d", "#263746", "#24536a", "#167a78", "#199f69",
  "#75b83b", "#d1b52c", "#e87e25", "#ed4936", "#ff174f",
]);

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

export const STRUCTURE_FILLS = Object.freeze({
  self: "#54a6ff",
  ally: "#54a6ff",
  enemy: "#f05267",
});

export function structureKind(tile) {
  const type = Number(tile?.city_type ?? tile?.cityType);
  const name = String(tile?.name || "");
  const param = Number(tile?.city_param ?? tile?.cityParam) || 0;
  if (type === 1) return "main";
  if (type === 3) return "branch";
  if (type === 4 || type === 12) return "fortress";
  if (type === 9 && (name === "要塞" || param === 71001)) return "fortress";
  if (type === 8 && name && name !== "攻城营垒" && name !== "沃土") return "city";
  if (type === 7 && Number(tile?.belong_city || tile?.belongCity) > 0) return "city-cell";
  return "";
}

export function holdRelation(tile, viewer) {
  const kind = structureKind(tile);
  if (!kind) return "unknown";
  const allianceOnly = kind === "city";
  const user = allianceOnly ? 0 : (Number(tile?.user_id ?? tile?.userId) || 0);
  const union = allianceOnly
    ? (Number(tile?.union_id ?? tile?.unionId) || 0)
    : (Number(tile?.ownerUnionId ?? tile?.union_id ?? tile?.unionId) || 0);
  const selfUser = Number(viewer?.userId) || 0;
  const selfUnion = Number(viewer?.unionId) || 0;
  if (!user && !union) return "unowned";
  if (selfUser && user && user === selfUser) return "self";
  if (selfUnion && union && union === selfUnion) return "ally";
  if (allianceOnly && selfUnion && union && union !== selfUnion) return "enemy";
  if (
    user
    && selfUser
    && user !== selfUser
    && selfUnion
    && union
    && union !== selfUnion
  ) {
    return "enemy";
  }
  return "unknown";
}

export function ownershipFill(relation) {
  return STRUCTURE_FILLS[relation] || "";
}

export function cityFrames(tiles) {
  const list = tiles || [];
  const frames = [];
  for (const tile of list) {
    if (structureKind(tile) !== "city") continue;
    const wid = Number(tile.wid);
    const cells = list.filter((item) => (
      Number(item.wid) === wid || Number(item.belong_city || item.belongCity) === wid
    ));
    const rows = cells.map((item) => Number(item.row));
    const cols = cells.map((item) => Number(item.col));
    frames.push({
      wid,
      name: String(tile.name || ""),
      rowUp: Math.min(...rows),
      rowDown: Math.max(...rows),
      colLeft: Math.min(...cols),
      colRight: Math.max(...cols),
      cells: cells.length,
    });
  }
  return frames;
}

export function wheelAction(input = {}) {
  const deltaMode = Number(input.deltaMode) || 0;
  const deltaX = Number(input.deltaX) || 0;
  const deltaY = Number(input.deltaY) || 0;
  const scale = deltaMode === 1 ? 16 : deltaMode === 2 ? 120 : 1;
  const dx = deltaX * scale;
  const dy = deltaY * scale;
  if (input.ctrlKey || input.metaKey) {
    return { type: "zoom", source: "pinch", dx, dy, zoom: dy };
  }
  const wheelDeltaY = Number(input.wheelDeltaY);
  const mouseNotch = deltaMode !== 0 || (
    deltaX === 0
    && Number.isFinite(wheelDeltaY)
    && Math.abs(wheelDeltaY) >= 120
    && Math.abs(wheelDeltaY) % 120 === 0
  ) || (
    deltaMode === 0
    && deltaX === 0
    && Number.isInteger(deltaY)
    && Math.abs(deltaY) >= 100
  );
  if (mouseNotch) {
    return { type: "zoom", source: "mouse", dx: 0, dy, zoom: dy || wheelDeltaY };
  }
  return { type: "pan", source: "trackpad", dx, dy, zoom: 0 };
}

export function wheelZoomFactor(deltaY, source = "pinch") {
  const delta = Number(deltaY) || 0;
  if (!delta) return 1;
  if (source === "mouse") {
    const notches = Math.sign(delta) * Math.min(
      3,
      Math.max(1, Math.round(Math.abs(delta) / 100)),
    );
    return 1.25 ** notches;
  }
  const clamped = Math.max(-120, Math.min(120, delta));
  return Math.min(1.4, Math.max(0.72, Math.exp(clamped * 0.0032)));
}

export function routesFromArmies(armies, viewer) {
  const routes = [];
  for (const army of armies || []) {
    const location = army?.location || {};
    const points = [];
    for (const key of ["currentWid", "nextWid", "targetWid"]) {
      const wid = Number(location[key]) || 0;
      if (wid <= 0) continue;
      const row = Math.floor(wid / 10000);
      const col = wid % 10000;
      const last = points[points.length - 1];
      if (last && last.row === row && last.col === col) continue;
      points.push({ row, col, wid });
    }
    if (points.length < 2) continue;
    const relation = relationFor(army.userId, army.ownerUnionId, viewer);
    const hasNext = Number(location.nextWid) > 0
      && !army?.source?.isStale
      && !army?.offline;
    routes.push({
      relation,
      color: RELATION_COLORS[relation] || RELATION_COLORS.unknown,
      dashed: !hasNext,
      points,
    });
  }
  const order = { unknown: 0, enemy: 1, ally: 2, self: 3 };
  routes.sort(
    (left, right) => (order[left.relation] || 0) - (order[right.relation] || 0),
  );
  return routes;
}

export function levelColor(level) {
  const value = Number(level);
  return Number.isInteger(value) && value >= 0 && value <= 9
    ? LEVEL_COLORS[value]
    : LEVEL_COLORS[0];
}

export function panBounds(bounds, rowDelta, colDelta) {
  const rowSpan = bounds.rowDown - bounds.rowUp;
  const colSpan = bounds.colRight - bounds.colLeft;
  const rowUp = Math.max(0, Math.round(bounds.rowUp + rowDelta));
  const colLeft = Math.max(0, Math.round(bounds.colLeft + colDelta));
  return {
    rowUp,
    rowDown: rowUp + rowSpan,
    colLeft,
    colRight: colLeft + colSpan,
  };
}

export function zoomBounds(bounds, anchorRow, anchorCol, direction, placement = "center") {
  const currentRows = bounds.rowDown - bounds.rowUp + 1;
  const currentCols = bounds.colRight - bounds.colLeft + 1;
  const numeric = Number(direction);
  const factor = numeric === -1
    ? 0.5
    : numeric === 1
      ? 2
      : Math.min(1.45, Math.max(0.7, Number.isFinite(numeric) ? numeric : 1));
  const rows = Math.min(160, Math.max(5, Math.round(currentRows * factor)));
  const cols = Math.min(160, Math.max(5, Math.round(currentCols * factor)));
  if (rows === currentRows && cols === currentCols) return bounds;
  const rowFraction = placement === "anchor"
    ? (anchorRow - bounds.rowUp) / currentRows
    : 0.5;
  const colFraction = placement === "anchor"
    ? (anchorCol - bounds.colLeft) / currentCols
    : 0.5;
  const rowUp = Math.max(0, Math.round(anchorRow - rowFraction * rows));
  const colLeft = Math.max(0, Math.round(anchorCol - colFraction * cols));
  return {
    rowUp,
    rowDown: rowUp + rows - 1,
    colLeft,
    colRight: colLeft + cols - 1,
  };
}

export function tileDrawPlan(tile, size, layers = {}) {
  const plan = [{ kind: "level", color: levelColor(tile.landLevel) }];
  if (Number(tile.landLevel) >= 7 && size >= 8) plan.push({ kind: "high-level" });
  if (layers.ownership && tile.relation && tile.relation !== "unknown" && size >= 8) plan.push({ kind: "ownership" });
  if (layers.freshness && tile.freshness === "stale") plan.push({ kind: "stale" });
  if (layers.paths && tile.isPath) plan.push({ kind: "path" });
  if (layers.armies && Number(tile.armies || 0) > 0) plan.push({ kind: "armies" });
  if (tile.favorite) plan.push({ kind: "favorite" });
  if (tile.selected) plan.push({ kind: "selected" });
  if (size >= 14) plan.push({ kind: "label" });
  return plan;
}

export function gridFrame(width, height, rows, cols) {
  const safeRows = Math.max(1, rows);
  const safeCols = Math.max(1, cols);
  const size = Math.max(3, Math.min(width / safeCols, height / safeRows));
  const gridWidth = safeCols * size;
  const gridHeight = safeRows * size;
  return {
    size,
    originX: Math.max(0, (width - gridWidth) / 2),
    originY: Math.max(0, (height - gridHeight) / 2),
    width: gridWidth,
    height: gridHeight,
  };
}

export const MARCH_ARROW_COLOR = "#9ad7ff";

export function marchArrows(x0, y0, x1, y1) {
  const dx = x1 - x0;
  const dy = y1 - y0;
  const length = Math.hypot(dx, dy);
  if (length < 8) return [];
  const angle = Math.atan2(dy, dx);
  const ux = dx / length;
  const uy = dy / length;
  const spacing = 10;
  const arrows = [];
  for (let distance = spacing; distance < length - 3; distance += spacing) {
    arrows.push({
      x: x0 + ux * distance,
      y: y0 + uy * distance,
      angle,
    });
  }
  return arrows;
}

export function marchArrowTriangle(arrow, length = 8, width = 6) {
  const cos = Math.cos(arrow.angle);
  const sin = Math.sin(arrow.angle);
  const tip = length * 0.62;
  const tail = length * 0.38;
  const half = width / 2;
  return [
    { x: arrow.x + cos * tip, y: arrow.y + sin * tip },
    { x: arrow.x - cos * tail - sin * half, y: arrow.y - sin * tail + cos * half },
    { x: arrow.x - cos * tail + sin * half, y: arrow.y - sin * tail - cos * half },
  ];
}

export function clipSegment(x0, y0, x1, y1, rect) {
  const left = rect.x;
  const right = rect.x + rect.width;
  const top = rect.y;
  const bottom = rect.y + rect.height;
  const code = (x, y) => (
    (x < left ? 1 : 0)
    | (x > right ? 2 : 0)
    | (y < top ? 4 : 0)
    | (y > bottom ? 8 : 0)
  );
  let c0 = code(x0, y0);
  let c1 = code(x1, y1);
  for (let step = 0; step < 8; step += 1) {
    if (!(c0 | c1)) return { x0, y0, x1, y1 };
    if (c0 & c1) return null;
    const outside = c0 || c1;
    let x = x0;
    let y = y0;
    if (outside & 8) {
      x = x0 + (x1 - x0) * (bottom - y0) / (y1 - y0 || 1);
      y = bottom;
    } else if (outside & 4) {
      x = x0 + (x1 - x0) * (top - y0) / (y1 - y0 || 1);
      y = top;
    } else if (outside & 2) {
      y = y0 + (y1 - y0) * (right - x0) / (x1 - x0 || 1);
      x = right;
    } else {
      y = y0 + (y1 - y0) * (left - x0) / (x1 - x0 || 1);
      x = left;
    }
    if (outside === c0) {
      x0 = x;
      y0 = y;
      c0 = code(x0, y0);
    } else {
      x1 = x;
      y1 = y;
      c1 = code(x1, y1);
    }
  }
  return null;
}

export function drawIntelligenceMap(canvas, tiles, options = {}) {
  const context = canvas.getContext("2d");
  const ratio = Math.min(2, window.devicePixelRatio || 1);
  const bounds = options.bounds || { rowUp: 0, rowDown: 0, colLeft: 0, colRight: 0 };
  const rows = Math.max(1, bounds.rowDown - bounds.rowUp + 1);
  const cols = Math.max(1, bounds.colRight - bounds.colLeft + 1);
  const width = canvas.clientWidth || 800;
  const height = canvas.clientHeight || 520;
  canvas.width = Math.round(width * ratio);
  canvas.height = Math.round(height * ratio);
  context.setTransform(ratio, 0, 0, ratio, 0, 0);
  context.clearRect(0, 0, width, height);
  context.fillStyle = "#080d22";
  context.fillRect(0, 0, width, height);
  const frame = gridFrame(width, height, rows, cols);
  const { size, originX, originY } = frame;
  context.fillStyle = "#10192e";
  context.fillRect(originX, originY, frame.width, frame.height);
  const tileMap = new Map(tiles.map((tile) => [Number(tile.wid), tile]));
  const hitAreas = [];
  for (let row = bounds.rowUp; row <= bounds.rowDown; row += 1) {
    for (let col = bounds.colLeft; col <= bounds.colRight; col += 1) {
      const wid = row * 10000 + col;
      const tile = tileMap.get(wid) || { wid, row, col, landLevel: 0, freshness: "unknown", relation: "unknown" };
      const x = originX + (col - bounds.colLeft) * size;
      const y = originY + (row - bounds.rowUp) * size;
      const kind = structureKind(tile);
      if (kind) {
        drawStructureCell(context, tile, options.viewer, x, y, size);
      } else {
        drawPlan(context, tileDrawPlan(tile, size, options.layers || {}), tile, x, y, size);
      }
      hitAreas.push({ wid, x, y, size });
    }
  }
  if (options.layers?.paths !== false) {
    drawRoutes(context, options.routes || [], bounds, frame);
  }
  context.save();
  context.beginPath();
  context.strokeStyle = "rgba(125, 164, 204, 0.28)";
  context.lineWidth = 1;
  for (let index = 0; index <= cols; index += 1) {
    const x = originX + index * size + 0.5;
    context.moveTo(x, originY);
    context.lineTo(x, originY + frame.height);
  }
  for (let index = 0; index <= rows; index += 1) {
    const y = originY + index * size + 0.5;
    context.moveTo(originX, y);
    context.lineTo(originX + frame.width, y);
  }
  context.stroke();
  context.strokeStyle = "#6f93b4";
  context.strokeRect(originX + 0.5, originY + 0.5, Math.max(0, frame.width - 1), Math.max(0, frame.height - 1));
  context.restore();
  if (size >= 7) {
    drawStructureIcons(context, tiles, bounds, frame);
  }
  return { bounds, size, originX, originY, frame, hitAreas };
}

function drawStructureCell(context, tile, viewer, x, y, size) {
  const fill = ownershipFill(holdRelation(tile, viewer));
  context.fillStyle = fill || "#10192e";
  context.fillRect(x + 1, y + 1, Math.max(1, size - 2), Math.max(1, size - 2));
  if (tile.selected) {
    context.strokeStyle = "#fff";
    context.lineWidth = 2;
    context.strokeRect(x + 1, y + 1, size - 2, size - 2);
    context.lineWidth = 1;
  }
}

function drawStructureIcons(context, tiles, bounds, frame) {
  context.save();
  context.beginPath();
  context.rect(frame.originX, frame.originY, frame.width, frame.height);
  context.clip();
  context.strokeStyle = "#f6f1e4";
  context.fillStyle = "#f6f1e4";
  context.lineJoin = "round";
  context.lineCap = "round";
  const covered = new Set();
  for (const city of cityFrames(tiles)) {
    covered.add(city.wid);
    const x = frame.originX + (city.colLeft - bounds.colLeft) * frame.size;
    const y = frame.originY + (city.rowUp - bounds.rowUp) * frame.size;
    const w = (city.colRight - city.colLeft + 1) * frame.size;
    const h = (city.rowDown - city.rowUp + 1) * frame.size;
    drawCityGlyph(context, x, y, w, h, city.name);
  }
  for (const tile of tiles) {
    const kind = structureKind(tile);
    if (!kind || kind === "city" || kind === "city-cell" || covered.has(Number(tile.wid))) continue;
    const x = frame.originX + (Number(tile.col) - bounds.colLeft) * frame.size;
    const y = frame.originY + (Number(tile.row) - bounds.rowUp) * frame.size;
    drawMarkGlyph(context, kind, x, y, frame.size, frame.size);
  }
  context.restore();
}

const FORTRESS_GLYPH = [
  ["M", 12, 56], ["L", 12, 14], ["L", 22, 14], ["L", 22, 28], ["L", 27, 28], ["L", 27, 14],
  ["L", 37, 14], ["L", 37, 28], ["L", 42, 28], ["L", 42, 14], ["L", 52, 14], ["L", 52, 56], ["Z"],
  ["M", 28, 56], ["L", 28, 46], ["Q", 32, 39, 36, 46], ["L", 36, 56], ["Z"],
];

const BRANCH_GLYPH = [
  ["M", 16, 56], ["L", 16, 40], ["L", 10, 40], ["L", 10, 32], ["L", 16, 32], ["L", 16, 26],
  ["L", 32, 12], ["L", 48, 26], ["L", 48, 32], ["L", 54, 32], ["L", 54, 40], ["L", 48, 40],
  ["L", 48, 56], ["Z"],
  ["M", 28, 56], ["L", 28, 46], ["L", 36, 46], ["L", 36, 56], ["Z"],
];

const MAIN_GLYPH = [
  ["M", 6, 56], ["L", 6, 16], ["L", 16, 16], ["L", 16, 30], ["L", 22, 30], ["L", 32, 8],
  ["L", 42, 30], ["L", 48, 30], ["L", 48, 16], ["L", 58, 16], ["L", 58, 56], ["Z"],
  ["M", 26, 56], ["L", 26, 44], ["Q", 32, 34, 38, 44], ["L", 38, 56], ["Z"],
];

const CITY_GLYPH = [
  ["M", 4, 56], ["L", 4, 36], ["L", 8, 36], ["L", 8, 18], ["L", 18, 18], ["L", 18, 36],
  ["L", 22, 36], ["L", 22, 8], ["L", 42, 8], ["L", 42, 36], ["L", 46, 36], ["L", 46, 18],
  ["L", 56, 18], ["L", 56, 36], ["L", 60, 36], ["L", 60, 56], ["Z"],
  ["M", 27, 56], ["L", 27, 40], ["Q", 32, 28, 37, 40], ["L", 37, 56], ["Z"],
];

function fillGlyph(context, x, y, w, h, commands) {
  const px = (unit) => x + (unit / 64) * w;
  const py = (unit) => y + (unit / 64) * h;
  context.beginPath();
  for (const cmd of commands) {
    if (cmd[0] === "M") context.moveTo(px(cmd[1]), py(cmd[2]));
    else if (cmd[0] === "L") context.lineTo(px(cmd[1]), py(cmd[2]));
    else if (cmd[0] === "Q") context.quadraticCurveTo(px(cmd[1]), py(cmd[2]), px(cmd[3]), py(cmd[4]));
    else context.closePath();
  }
  context.fillStyle = "#f6f1e4";
  context.fill("evenodd");
}

function drawMarkGlyph(context, kind, x, y, w, h) {
  const pad = Math.max(1.5, Math.min(w, h) * 0.12);
  const box = [x + pad, y + pad, w - pad * 2, h - pad * 2];
  const glyph = { fortress: FORTRESS_GLYPH, branch: BRANCH_GLYPH, main: MAIN_GLYPH }[kind];
  if (glyph) fillGlyph(context, box[0], box[1], box[2], box[3], glyph);
}

function drawCityGlyph(context, x, y, w, h, name) {
  const showName = Boolean(name) && w >= 72;
  const label = showName ? Math.min(20, h * 0.12) : 0;
  const pad = Math.min(w, h) * 0.05;
  fillGlyph(context, x + pad, y + label, w - pad * 2, h - label - pad, CITY_GLYPH);
  if (!showName) return;
  context.fillStyle = "#f6f1e4";
  context.font = `600 ${Math.max(12, Math.min(18, w * 0.11))}px sans-serif`;
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.fillText(name, x + w / 2, y + label * 0.5);
}

function drawRoutes(context, routes, bounds, frame) {
  const rect = {
    x: frame.originX,
    y: frame.originY,
    width: frame.width,
    height: frame.height,
  };
  context.save();
  context.beginPath();
  context.rect(rect.x, rect.y, rect.width, rect.height);
  context.clip();
  context.lineWidth = 2;
  context.lineCap = "butt";
  for (const route of routes) {
    const points = (route.points || []).map((point) => ({
      x: frame.originX + (point.col - bounds.colLeft) * frame.size + frame.size / 2,
      y: frame.originY + (point.row - bounds.rowUp) * frame.size + frame.size / 2,
    }));
    if (points.length < 2) continue;
    context.beginPath();
    context.strokeStyle = route.color || RELATION_COLORS.unknown;
    context.setLineDash([]);
    let drawing = false;
    for (let index = 1; index < points.length; index += 1) {
      const clipped = clipSegment(
        points[index - 1].x,
        points[index - 1].y,
        points[index].x,
        points[index].y,
        rect,
      );
      if (!clipped) {
        drawing = false;
        continue;
      }
      if (!drawing) context.moveTo(clipped.x0, clipped.y0);
      context.lineTo(clipped.x1, clipped.y1);
      drawing = true;
    }
    context.stroke();
    context.setLineDash([]);
    const arrowLength = Math.max(6, Math.min(9, frame.size * 0.28));
    // 根据关系设置箭头颜色：敌方为红色箭头，我方/盟友为蓝色箭头
    const arrowColor = route.relation === "enemy" ? "#f05267" : "#54a6ff";
    context.fillStyle = arrowColor;
    for (let index = 1; index < points.length; index += 1) {
      const clipped = clipSegment(
        points[index - 1].x,
        points[index - 1].y,
        points[index].x,
        points[index].y,
        rect,
      );
      if (!clipped) continue;
      for (const arrow of marchArrows(clipped.x0, clipped.y0, clipped.x1, clipped.y1)) {
        const triangle = marchArrowTriangle(arrow, arrowLength, arrowLength * 0.72);
        context.beginPath();
        context.moveTo(triangle[0].x, triangle[0].y);
        context.lineTo(triangle[1].x, triangle[1].y);
        context.lineTo(triangle[2].x, triangle[2].y);
        context.closePath();
        context.fill();
      }
    }
  }
  context.restore();
}

function drawPlan(context, plan, tile, x, y, size) {
  for (const step of plan) {
    if (step.kind === "level") {
      context.fillStyle = step.color;
      context.fillRect(x + 1, y + 1, size - 2, size - 2);
    } else if (step.kind === "high-level") {
      context.strokeStyle = "rgba(255,255,255,.32)";
      context.strokeRect(x + 2, y + 2, size - 4, size - 4);
    } else if (step.kind === "ownership") {
      context.fillStyle = { self: "#34d399", ally: "#54a6ff", enemy: "#f05267" }[tile.relation] || "#7183a7";
      context.beginPath();
      context.moveTo(x + size - 1, y + 1);
      context.lineTo(x + size - 1, y + Math.min(8, size / 3));
      context.lineTo(x + size - Math.min(8, size / 3), y + 1);
      context.fill();
    } else if (step.kind === "stale") {
      context.strokeStyle = "rgba(255,255,255,.22)";
      for (let offset = -size; offset < size; offset += 6) {
        context.beginPath();
        context.moveTo(x + Math.max(0, offset), y + Math.max(0, -offset));
        context.lineTo(x + Math.min(size, size + offset), y + Math.min(size, size - offset));
        context.stroke();
      }
    } else if (step.kind === "path") {
      context.strokeStyle = "#8cecff";
      context.lineWidth = 2;
      context.strokeRect(x + 2, y + 2, size - 4, size - 4);
    } else if (step.kind === "armies") {
      context.fillStyle = "#f4f7ff";
      context.beginPath();
      context.arc(x + size / 2, y + size / 2, Math.max(2, size / 7), 0, Math.PI * 2);
      context.fill();
    } else if (step.kind === "favorite") {
      context.strokeStyle = "#f5b84b";
      context.lineWidth = 2;
      context.strokeRect(x + 3, y + 3, size - 6, size - 6);
    } else if (step.kind === "selected") {
      context.strokeStyle = "#fff";
      context.lineWidth = 2;
      context.strokeRect(x + 1, y + 1, size - 2, size - 2);
      context.strokeStyle = "#061127";
      context.strokeRect(x + 4, y + 4, size - 8, size - 8);
    } else if (step.kind === "label") {
      context.fillStyle = "#f4f7ff";
      context.font = `${Math.max(9, size * .36)}px system-ui`;
      context.textAlign = "center";
      context.textBaseline = "middle";
      context.fillText(String(tile.landLevel || ""), x + size / 2, y + size / 2);
    }
  }
  context.lineWidth = 1;
}

export function hitTestMap(pointX, pointY, renderState) {
  return renderState?.hitAreas?.find((item) =>
    pointX >= item.x && pointX < item.x + item.size &&
    pointY >= item.y && pointY < item.y + item.size
  )?.wid || 0;
}

if (typeof window !== "undefined") {
  window.IntelligenceMap = Object.freeze({
    LEVEL_COLORS,
    RELATION_COLORS,
    levelColor,
    relationFor,
    structureKind,
    holdRelation,
    ownershipFill,
    cityFrames,
    routesFromArmies,
    wheelAction,
    wheelZoomFactor,
    panBounds,
    zoomBounds,
    tileDrawPlan,
    gridFrame,
    MARCH_ARROW_COLOR,
    marchArrows,
    marchArrowTriangle,
    clipSegment,
    drawIntelligenceMap,
    hitTestMap,
  });
  window.dispatchEvent(new CustomEvent("stzb:intelligence-map-ready"));
}
