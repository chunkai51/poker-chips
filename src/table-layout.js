// src/table-layout.js
// Visual seat slots for the table. Slot 0 is the bottom-center anchor.

function createSeatPoint(left, top, side, mobileLeft = left, mobileTop = top) {
  return { left, top, side, mobileLeft, mobileTop };
}

// Ordered from the bottom-center seat clockwise around the table.
// Tune these arrays when adjusting the visual player-label layout.
export const TABLE_SEAT_LAYOUTS = {
  1: [
    createSeatPoint(50, 86, "seat-bottom", 50, 93)
  ],
  2: [
    createSeatPoint(50, 86, "seat-bottom", 50, 93),
    createSeatPoint(50, 14, "seat-top", 50, 7)
  ],
  3: [
    createSeatPoint(50, 86, "seat-bottom", 50, 93),
    createSeatPoint(16, 22, "seat-left", 23, 22),
    createSeatPoint(84, 22, "seat-right", 77, 22)
  ],
  4: [
    createSeatPoint(50, 86, "seat-bottom", 50, 93),
    createSeatPoint(12, 50, "seat-left", 21, 72),
    createSeatPoint(50, 14, "seat-top", 50, 7),
    createSeatPoint(88, 50, "seat-right", 79, 28)
  ],
  5: [
    createSeatPoint(50, 86, "seat-bottom", 50, 93),
    createSeatPoint(16, 62, "seat-left", 20, 75),
    createSeatPoint(24, 22, "seat-top", 23, 17.5),
    createSeatPoint(76, 22, "seat-top", 77, 17.5),
    createSeatPoint(84, 62, "seat-right", 80, 75)
  ],
  6: [
    createSeatPoint(50, 86, "seat-bottom", 50, 93),
    createSeatPoint(20, 78, "seat-bottom", 23, 75),
    createSeatPoint(20, 22, "seat-top", 23, 25),
    createSeatPoint(50, 14, "seat-top", 50, 7),
    createSeatPoint(80, 22, "seat-top", 77, 25),
    createSeatPoint(80, 78, "seat-bottom", 77, 75)
  ],
  7: [
    createSeatPoint(50, 88, "seat-bottom", 50, 93),
    createSeatPoint(28, 84, "seat-bottom", 23, 75),
    createSeatPoint(12, 42, "seat-left", 18, 25),
    createSeatPoint(35, 14, "seat-top", 25, 10),
    createSeatPoint(65, 14, "seat-top", 75, 10),
    createSeatPoint(88, 42, "seat-right", 82, 25),
    createSeatPoint(72, 84, "seat-bottom", 77, 75)
  ],
  8: [
    createSeatPoint(50, 86, "seat-bottom", 50, 93),
    createSeatPoint(22, 80, "seat-bottom", 23, 75),
    createSeatPoint(12, 50, "seat-left", 21, 28),
    createSeatPoint(22, 20, "seat-top", 25, 17.5),
    createSeatPoint(50, 14, "seat-top", 50, 7),
    createSeatPoint(78, 20, "seat-top", 75, 17.5),
    createSeatPoint(88, 50, "seat-right", 79, 28),
    createSeatPoint(78, 80, "seat-bottom", 77, 75)
  ],
  9: [
    createSeatPoint(50, 86, "seat-bottom", 50, 93),
    createSeatPoint(24, 82, "seat-bottom", 27, 82.5),
    createSeatPoint(12, 54, "seat-left", 21, 72),
    createSeatPoint(22, 20, "seat-top", 27, 17.5),
    createSeatPoint(50, 14, "seat-top", 50, 7),
    createSeatPoint(78, 20, "seat-top", 73, 17.5),
    createSeatPoint(88, 38, "seat-right", 79, 28),
    createSeatPoint(88, 68, "seat-right", 79, 72),
    createSeatPoint(76, 82, "seat-bottom", 73, 82.5)
  ],
  10: [
    createSeatPoint(50, 86, "seat-bottom", 50, 93),
    createSeatPoint(24, 82, "seat-bottom", 27, 82.5),
    createSeatPoint(12, 66, "seat-left", 21, 72),
    createSeatPoint(12, 34, "seat-left", 21, 28),
    createSeatPoint(24, 18, "seat-top", 27, 17.5),
    createSeatPoint(50, 14, "seat-top", 50, 7),
    createSeatPoint(76, 18, "seat-top", 73, 17.5),
    createSeatPoint(88, 34, "seat-right", 79, 28),
    createSeatPoint(88, 66, "seat-right", 79, 72),
    createSeatPoint(76, 82, "seat-bottom", 73, 82.5)
  ]
};

function clampSeatCount(count, maxSeats) {
  const numericCount = Number.isFinite(Number(count)) ? Math.trunc(Number(count)) : 1;
  return Math.min(Math.max(numericCount, 1), maxSeats);
}

export function getSeatLayout(count, { maxSeats = 10 } = {}) {
  const seatCount = clampSeatCount(count, maxSeats);
  return TABLE_SEAT_LAYOUTS[seatCount] || TABLE_SEAT_LAYOUTS[1];
}

export function normalizeRotationOffset(offset, length) {
  if (length <= 0) return 0;
  return ((offset % length) + length) % length;
}

export function getVisualSeatCoordinates({
  playerIndex,
  count,
  currentDevicePlayerIndex = -1,
  rotationOffset = 0,
  roomMode = false,
  maxSeats = 10
}) {
  const seatCount = clampSeatCount(count, maxSeats);
  const layout = getSeatLayout(seatCount, { maxSeats });
  if (seatCount <= 1) return layout[0];

  const manualOffset = normalizeRotationOffset(rotationOffset, seatCount);
  const anchorPlayerIndex = roomMode && currentDevicePlayerIndex >= 0
    ? currentDevicePlayerIndex
    : 0;
  const visualIndex = (playerIndex - anchorPlayerIndex + manualOffset + seatCount) % seatCount;
  return layout[visualIndex] || layout[0];
}
