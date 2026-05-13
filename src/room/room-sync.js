// src/room-sync.js
// Thin Firebase Realtime Database adapter for room-level reads, writes, and transactions.

import {
  db,
  get,
  onValue,
  ref,
  runTransaction,
  update
} from "./firebase.js";

function getRoomRef(roomId) {
  return roomId ? ref(db, `rooms/${roomId}`) : null;
}

export async function roomExists(roomId) {
  const roomRef = getRoomRef(roomId);
  if (!roomRef) return false;
  const snapshot = await get(roomRef);
  return snapshot.exists();
}

export async function readRoom(roomId) {
  const roomRef = getRoomRef(roomId);
  if (!roomRef) return null;
  const snapshot = await get(roomRef);
  return snapshot.val();
}

export async function readRoomGameState(roomId) {
  const roomData = await readRoom(roomId);
  return roomData?.gameState || null;
}

export function listenRoom(roomId, { onData, onMissing, onError } = {}) {
  const roomRef = getRoomRef(roomId);
  if (!roomRef) return () => {};

  return onValue(roomRef, (snapshot) => {
    const roomData = snapshot.val();
    if (!roomData || !roomData.gameState) {
      if (typeof onMissing === "function") onMissing(roomData);
      return;
    }
    if (typeof onData === "function") onData(roomData);
  }, (error) => {
    if (typeof onError === "function") onError(error);
  });
}

export function transactRoom(roomId, updater, options = { applyLocally: false }) {
  const roomRef = getRoomRef(roomId);
  if (!roomRef) {
    return Promise.resolve({
      committed: false,
      snapshot: null
    });
  }
  return runTransaction(roomRef, updater, options);
}

export async function updateRoomMember(roomId, clientId, member) {
  if (!roomId || !clientId) return false;
  await update(ref(db, `rooms/${roomId}/members/${clientId}`), member);
  return true;
}

export async function updateJoinRequest(roomId, clientId, request) {
  if (!roomId || !clientId) return false;
  await update(ref(db, `rooms/${roomId}/joinRequests/${clientId}`), request);
  return true;
}
