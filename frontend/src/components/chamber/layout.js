/**
 * Council chamber geometry. The chairman sits at the back (-z) on a dais;
 * seats form a horseshoe around the table, open toward the camera (+z).
 * Large councils (up to 20) get extra, raised rows behind the first, like
 * tiered parliament benches.
 */

export const TABLE_RADIUS = 2.4;
export const SEAT_RADIUS = 3.7;
export const CHAIR_POSITION = [0, 0.45, -5.1];

/** Seats look at this point: between the table center and the camera, so faces read on screen. */
export const SEAT_FOCUS = [0, 0, 3.2];

const ARC_START = (40 * Math.PI) / 180;
const ARC_END = (104 * Math.PI) / 180;
const ROW_GAP = 1.55; // radius added per row
const ROW_RISE = 0.5; // each row is this much higher than the one in front
const SEAT_SPACING = 1.3; // minimum distance between neighbours along a row

const rowRadius = (k) => SEAT_RADIUS + k * ROW_GAP;

/** How many seats fit in row k (both arms together). */
function rowCapacity(k) {
  const perArm = Math.floor(((ARC_END - ARC_START) * rowRadius(k)) / SEAT_SPACING) + 1;
  return 2 * perArm;
}

/** Number of rows needed for n seats. */
export function rowCount(n) {
  let rows = 1;
  let capacity = rowCapacity(0);
  while (capacity < n) {
    capacity += rowCapacity(rows);
    rows += 1;
  }
  return rows;
}

/** Split n seats across rows in proportion to each row's capacity. */
function seatsPerRow(n, rows) {
  const caps = Array.from({ length: rows }, (_, k) => rowCapacity(k));
  const total = caps.reduce((a, b) => a + b, 0);
  const counts = caps.map((c) => Math.min(c, Math.floor((n * c) / total)));
  for (let k = rows - 1; counts.reduce((a, b) => a + b, 0) < n; k = (k + rows - 1) % rows) {
    if (counts[k] < caps[k]) counts[k] += 1;
  }
  return counts;
}

function rowPositions(count, k) {
  const r = rowRadius(k);
  const y = k * ROW_RISE;
  const left = Math.ceil(count / 2);
  const right = count - left;
  const arm = (n, side) =>
    Array.from({ length: n }, (_, i) => {
      const t = n === 1 ? 0.5 : i / (n - 1);
      const angle = side * (ARC_START + t * (ARC_END - ARC_START));
      return [r * Math.sin(angle), y, -r * Math.cos(angle)];
    });
  // Interleave so seat order alternates sides, starting nearest the chairman.
  const l = arm(left, -1);
  const rr = arm(right, 1);
  const out = [];
  for (let i = 0; i < left; i++) {
    out.push(l[i]);
    if (i < right) out.push(rr[i]);
  }
  return out;
}

/** Positions [x, y, z] for n seats; y > 0 for raised back rows. */
export function seatPositions(n) {
  if (n === 0) return [];
  const rows = rowCount(n);
  return seatsPerRow(n, rows).flatMap((count, k) => rowPositions(count, k));
}
