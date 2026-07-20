import { stat } from "node:fs/promises";
import { SessionManager, withFileMutationQueue } from "@earendil-works/pi-coding-agent";
import { CUSTOM_MESSAGE_TYPE, type ForkSnapshot } from "./types.js";

export async function appendVisibleMessageToSourceSession(
  snapshot: ForkSnapshot,
  content: string,
  details?: unknown,
): Promise<boolean> {
  const sourceSessionFile = snapshot.sourceSessionFile;
  if (!sourceSessionFile) return false;

  return withFileMutationQueue(sourceSessionFile, async () => {
    const persisted = await stat(sourceSessionFile).then((file) => file.size > 0).catch(() => false);
    if (!persisted) return false;

    SessionManager.open(sourceSessionFile).appendCustomMessageEntry(CUSTOM_MESSAGE_TYPE, content, true, details);
    return true;
  });
}
