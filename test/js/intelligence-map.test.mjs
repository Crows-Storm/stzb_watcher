import assert from "node:assert/strict";
import test from "node:test";

import {
  LEVEL_COLORS,
  clipSegment,
  marchArrowTriangle,
  marchArrows,
  gridFrame,
  levelColor,
  panBounds,
  tileDrawPlan,
  relationFor,
  cityFrames,
  holdRelation,
  ownershipFill,
  structureKind,
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

test("march arrows point from the current tile toward the next hop", () => {
  assert.deepEqual(marchArrows(0, 0, 7, 0), []);
  const forward = marchArrows(0, 0, 120, 0);
  assert.ok(forward.length >= 10);
  assert.ok(forward.every((arrow) => arrow.angle === 0 && arrow.x > 0 && arrow.x < 120));
  const backward = marchArrows(120, 40, 0, 40);
  assert.ok(backward.every((arrow) => arrow.angle === Math.PI || arrow.angle === -Math.PI));
  const triangle = marchArrowTriangle(forward[0], 8, 6);
  const baseX = (triangle[1].x + triangle[2].x) / 2;
  assert.ok(triangle[0].x > baseX);
  const down = marchArrowTriangle(marchArrows(10, 0, 10, 90)[0], 8, 6);
  const baseY = (down[1].y + down[2].y) / 2;
  assert.ok(down[0].y > baseY);
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

test("a city footprint collapses to one icon frame", () => {
  const center = { wid: 7460979, row: 746, col: 979, city_type: 8, name: "濮阳", union_id: 1016 };
  const cells = [];
  for (let row = 744; row <= 748; row += 1) {
    for (let col = 977; col <= 981; col += 1) {
      const wid = row * 10000 + col;
      cells.push(wid === center.wid ? center : {
        wid, row, col, city_type: 7, belong_city: center.wid, user_id: 10,
      });
    }
  }
  const frames = cityFrames(cells);
  assert.equal(frames.length, 1);
  assert.equal(frames[0].cells, 25);
  assert.deepEqual(
    [frames[0].rowUp, frames[0].rowDown, frames[0].colLeft, frames[0].colRight],
    [744, 748, 977, 981],
  );
  assert.equal(structureKind({ city_type: 9, name: "要塞" }), "fortress");
  assert.equal(structureKind({ city_type: 8, name: "攻城营垒" }), "");
  assert.equal(structureKind({ city_type: 3, name: "昌国分城" }), "branch");
});

test("structure squares use side color and leave an empty fortress uncolored", () => {
  const viewer = { userId: 7, unionId: 1006 };
  const enemyFort = { city_type: 4, user_id: 9, ownerUnionId: 2000 };
  const allyFort = { city_type: 4, user_id: 8, ownerUnionId: 1006 };
  const bareFort = { city_type: 9, name: "要塞", user_id: 0, union_id: 0 };
  const city = { city_type: 8, name: "濮阳", user_id: 99, union_id: 1016 };
  assert.equal(ownershipFill(holdRelation(enemyFort, viewer)), "#f05267");
  assert.equal(ownershipFill(holdRelation(allyFort, viewer)), "#54a6ff");
  assert.equal(ownershipFill(holdRelation(bareFort, viewer)), "");
  assert.equal(holdRelation(city, viewer), "enemy");
});
