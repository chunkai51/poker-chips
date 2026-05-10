// src/approvals.js
// Pure confirmation-progress helpers used by settlement and next-hand flows.

import { normalizePlayerOwnerId } from "./identity.js";

export function normalizeApprovalMap(value = {}) {
  if (!value || typeof value !== "object") return {};
  return Object.fromEntries(Object.entries(value)
    .filter(([approverId, approved]) => normalizePlayerOwnerId(approverId) && Boolean(approved))
    .map(([approverId]) => [normalizePlayerOwnerId(approverId), true]));
}

export function getApprovalProgress(approvals, requiredIds = []) {
  const normalizedApprovals = normalizeApprovalMap(approvals);
  const approvedCount = requiredIds.filter(approverId => normalizedApprovals[approverId]).length;
  return {
    approvedCount,
    requiredCount: requiredIds.length,
    complete: requiredIds.length > 0 && approvedCount >= requiredIds.length,
    approved: normalizedApprovals
  };
}
