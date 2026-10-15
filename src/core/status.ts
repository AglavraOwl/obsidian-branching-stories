import { NodeStatus } from "./nodeDoc";

export type DisplayStatus = NodeStatus | "interrupted";

export const STALE_AFTER_MS = 5 * 60 * 1000;

/**
 * Status to show in the interface. A node still marked `generating` long after it was created, with
 * no generation running on this device, is shown as `interrupted`. Nothing is written for this:
 * another device may still be finishing it (sync can be hours late), so only the device that started
 * the request ever marks it failed.
 */
export function displayStatus(status: NodeStatus, createdIso: string, nowMs: number, runningHere: boolean): DisplayStatus {
  if (status !== "generating" || runningHere) return status;
  const created = Date.parse(createdIso);
  return Number.isFinite(created) && nowMs - created > STALE_AFTER_MS ? "interrupted" : status;
}
