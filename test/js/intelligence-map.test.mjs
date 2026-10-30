import assert from "node:assert/strict";
import test from "node:test";

import {
  LEVEL_COLORS,
  clipSegment,
  gridFrame,
  levelColor,
  panBounds,
  tileDrawPlan,
  relationFor,
  routesFromArmies,
  wheelAction,
  wheelZoomFactor,
  zoomBounds,
} from "../../static/intelligence-map.mjs";

test("land level colors match the intelligence rules", () => {
  assert.equal(LEVEL_COLORS[0], "#18232d");
  assert.equal(LEVEL_COLORS[7], "#e87e25");
  assert.equal(LEVEL_COLORS[9], "#ff174f");
  assert.equal(levelColor(-1), "#18232d");
  assert.equal(levelColor(10), "#18232d");
});

test("draw plan preserves tactical overlay order", () => {
  const plan = tileDrawPlan(
    {
      landLevel: 8,
      relation: "enemy",
      freshness: "stale",
      isPath: true,
      armies: 2,
      selected: true,
    },
    16,
    {
      ownership: true,
      freshness: true,
      paths: true,
      armies: true,
    },
  );
  assert.deepEqual(
    plan.map((item) => item.kind),
    ["level", "high-level", "ownership", "stale", "path", "armies", "selected", "label"],
  );
});

test("bounds pan and zoom stay deterministic", () => {
  assert.deepEqual(
    panBounds(
      { rowUp: 10, rowDown: 19, colLeft: 20, colRight: 29 },
      2,
      -3,
    ),
    { rowUp: 12, rowDown: 21, colLeft: 17, colRight: 26 },
  );
  assert.deepEqual(
    zoomBounds(
      { rowUp: 1, rowDown: 20, colLeft: 1, colRight: 20 },
      10,
      10,
      -1,
    ),
    { rowUp: 5, rowDown: 14, colLeft: 5, colRight: 14 },
  );
  assert.deepEqual(
    zoomBounds(
      { rowUp: 5, rowDown: 14, colLeft: 5, colRight: 14 },
      10,
      10,
      1,
    ),
    { rowUp: 0, rowDown: 19, colLeft: 0, colRight: 19 },
  );
  const factor = wheelZoomFactor(36);
  assert.ok(factor > 1.08 && factor < 1.25);
  const nudged = zoomBounds(
    { rowUp: 1, rowDown: 80, colLeft: 1, colRight: 80 },
    40,
    40,
    factor,
  );
  const span = nudged.rowDown - nudged.rowUp + 1;
  assert.ok(span > 80 && span < 100);
  assert.equal(wheelZoomFactor(120, "mouse"), 1.25);
  assert.equal(wheelZoomFactor(-100, "mouse"), 0.8);
});

test("wheel distinguishes mouse zoom, pinch zoom, and trackpad pan", () => {
  assert.equal(wheelAction({ deltaY: 100, wheelDeltaY: -120 }).type, "zoom");
  assert.equal(wheelAction({ deltaY: 100, wheelDeltaY: -120 }).source, "mouse");
  assert.equal(wheelAction({ deltaMode: 1, deltaY: 3 }).source, "mouse");
  assert.equal(wheelAction({ ctrlKey: true, deltaY: -12, deltaX: 1 }).source, "pinch");
  assert.equal(wheelAction({ deltaX: 4, deltaY: -18 }).type, "pan");
  assert.equal(wheelAction({ deltaY: -6.5 }).source, "trackpad");
});

test("a zoom that does not change the cell count does not slide the window", () => {
  const bounds = { rowUp: 684, rowDown: 703, colLeft: 840, colRight: 859 };
  assert.equal(zoomBounds(bounds, 690, 850, 1.02, "anchor"), bounds);
  const zoomed = zoomBounds(bounds, 690, 850, 1.25, "anchor");
  assert.equal(zoomed.rowDown - zoomed.rowUp + 1, 25);
  assert.ok(zoomed.rowUp < 690 && zoomed.rowDown > 690);
  assert.ok(zoomed.colLeft < 850 && zoomed.colRight > 850);
});

test("army routes use id comparison and do not invent enemies", () => {
  const viewer = { userId: 3, unionId: 9 };
  const routes = routesFromArmies([
    {
      userId: 3,
      ownerUnionId: 9,
      location: { currentWid: 10001, nextWid: 10002, targetWid: 10004 },
    },
    {
      userId: 4,
      ownerUnionId: 9,
      location: { currentWid: 20001, nextWid: 0, targetWid: 20008 },
    },
    {
      userId: 5,
      ownerUnionId: 0,
      location: { currentWid: 30001, nextWid: 30002, targetWid: 30003 },
    },
  ], viewer);
  assert.equal(relationFor(5, 0, viewer), "unknown");
  assert.deepEqual(routes.map((route) => route.relation), ["unknown", "ally", "self"]);
  assert.equal(routes.find((route) => route.relation === "ally").dashed, true);
  assert.equal(routes.find((route) => route.relation === "self").dashed, false);
});

test("near map grid is centered in a wide canvas", () => {
  const frame = gridFrame(900, 400, 20, 20);
  assert.equal(frame.size, 20);
  assert.equal(frame.width, 400);
  assert.equal(frame.height, 400);
  assert.equal(frame.originX, 250);
  assert.equal(frame.originY, 0);
});

test("route segments stop at the grid edge", () => {
  const rect = { x: 100, y: 20, width: 200, height: 200 };
  assert.equal(clipSegment(0, 40, 40, 40, rect), null);
  const inside = clipSegment(120, 40, 160, 80, rect);
  assert.deepEqual(inside, { x0: 120, y0: 40, x1: 160, y1: 80 });
  const clipped = clipSegment(80, 120, 400, 120, rect);
  assert.equal(clipped.x0, 100);
  assert.equal(clipped.x1, 300);
  assert.equal(clipped.y0, 120);
  assert.equal(clipped.y1, 120);
});
