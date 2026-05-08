const admin = require("firebase-admin");
const { onValueCreated } = require("firebase-functions/v2/database");
const { logger } = require("firebase-functions");

admin.initializeApp();

const db = admin.database();

function toNonNegativeNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : fallback;
}

function normalizeCommand(value = {}) {
  return {
    uid: String(value.uid || ""),
    type: String(value.type || "").toUpperCase(),
    seatId: String(value.seatId || ""),
    handId: toNonNegativeNumber(value.handId, 0),
    payload: value.payload && typeof value.payload === "object" ? value.payload : {},
    createdAt: toNonNegativeNumber(value.createdAt, Date.now())
  };
}

function getPlayerBySeatId(players = [], seatId = "") {
  return players.find(player => String(player.id || "") === seatId) || null;
}

async function markCommand(commandRef, status, detail = {}) {
  await commandRef.update({
    status,
    processedAt: admin.database.ServerValue.TIMESTAMP,
    ...detail
  });
}

exports.processRoomCommand = onValueCreated(
  {
    ref: "/rooms/{roomId}/commands/{commandId}",
    region: "asia-southeast1"
  },
  async (event) => {
    const { roomId, commandId } = event.params;
    const command = normalizeCommand(event.data.val());
    const commandRef = db.ref(`/rooms/${roomId}/commands/${commandId}`);
    const roomRef = db.ref(`/rooms/${roomId}`);

    if (!command.uid || !command.type) {
      await markCommand(commandRef, "rejected", { reason: "invalid-command" });
      return;
    }

    try {
      const result = await roomRef.transaction((room) => {
        if (!room || !room.gameState || !Array.isArray(room.players)) return;
        if (String(room.gameState.handId || "0") !== String(command.handId || room.gameState.handId || 0)) return;

        const targetPlayer = getPlayerBySeatId(room.players, command.seatId);
        const isHost = String(room.hostClientId || room.operator || "") === command.uid;
        const isOwner = targetPlayer && String(targetPlayer.ownerClientId || "") === command.uid;
        const adminPlayerIds = Array.isArray(room.adminPlayerIds) ? room.adminPlayerIds.map(String) : [];
        const controlsAdminSeat = room.players.some(player => {
          return adminPlayerIds.includes(String(player.id || "")) && String(player.ownerClientId || "") === command.uid;
        });

        if (!isHost && !isOwner && !controlsAdminSeat) return;

        const logs = Array.isArray(room.gameState.logs) ? room.gameState.logs : [];
        room.gameState.logs = [
          ...logs,
          `[server] ${command.type} command accepted for ${command.seatId || command.uid}`
        ];
        room.gameState.stateVersion = toNonNegativeNumber(room.gameState.stateVersion, 0) + 1;
        room.gameState.updatedBy = "server";
        return room;
      }, { applyLocally: false });

      if (!result.committed) {
        await markCommand(commandRef, "rejected", { reason: "state-or-permission-mismatch" });
        return;
      }
      await markCommand(commandRef, "accepted");
    } catch (error) {
      logger.error("Command processing failed", { roomId, commandId, error });
      await markCommand(commandRef, "error", { reason: "function-error" });
    }
  }
);
