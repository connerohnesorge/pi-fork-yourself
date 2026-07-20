import { stat } from "node:fs/promises";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { CUSTOM_MESSAGE_TYPE, type ForkSnapshot } from "./types.js";

export async function appendVisibleMessageToSourceSession(
  snapshot: ForkSnapshot,
  content: string,
  details?: unknown,
): Promise<boolean> {
  if (!snapshot.sourceSessionFile) return false;

  const persisted = await stat(snapshot.sourceSessionFile).then((file) => file.size > 0).catch(() => false);
  if (!persisted) return false;

  SessionManager.open(snapshot.sourceSessionFile).appendCustomMessageEntry(CUSTOM_MESSAGE_TYPE, content, true, details);
  return true;
}
