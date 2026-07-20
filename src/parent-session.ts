import { randomUUID } from "node:crypto";
import { appendFile, readFile } from "node:fs/promises";
import { CUSTOM_MESSAGE_TYPE, type ForkSnapshot } from "./types.js";

function latestEntryId(sessionFileContent: string): string | null {
  let latest: string | null = null;
  for (const line of sessionFileContent.split("\n")) {
    if (!line.trim()) continue;
    try {
      const entry = JSON.parse(line) as { type?: string; id?: unknown };
      if (entry.type !== "session" && typeof entry.id === "string") latest = entry.id;
    } catch {
      // Ignore malformed partial lines; SessionManager does the same when loading.
    }
  }
  return latest;
}

export async function appendVisibleMessageToSourceSession(
  snapshot: ForkSnapshot,
  content: string,
  details?: unknown,
): Promise<boolean> {
  if (!snapshot.sourceSessionFile) return false;

  const currentContent = await readFile(snapshot.sourceSessionFile, "utf8").catch(() => "");
  if (!currentContent) return false;

  const parentId = latestEntryId(currentContent) ?? snapshot.sourceLeafId ?? null;
  const entry = {
    type: "custom_message",
    id: randomUUID(),
    parentId,
    timestamp: new Date().toISOString(),
    customType: CUSTOM_MESSAGE_TYPE,
    content,
    display: true,
    ...(details === undefined ? {} : { details }),
  };

  await appendFile(snapshot.sourceSessionFile, `${JSON.stringify(entry)}\n`, { encoding: "utf8" });
  return true;
}
