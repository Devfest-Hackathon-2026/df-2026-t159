/**
 * 端末（localStorage）に記録する最近のルーム情報（Issue #73）。
 */

export interface RecentRoom {
  roomId: string;
  roomName: string;
  lastAccessedAt: string; // ISO 8601 文字列
}

const STORAGE_KEY = "carepact:recent_rooms";

export function getRecentRooms(): RecentRoom[] {
  if (typeof window === "undefined" || !window.localStorage) {
    return [];
  }
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(
        (item): item is RecentRoom =>
          typeof item === "object" &&
          item !== null &&
          typeof item.roomId === "string" &&
          typeof item.roomName === "string" &&
          typeof item.lastAccessedAt === "string",
      )
      .sort(
        (a, b) =>
          new Date(b.lastAccessedAt).getTime() -
          new Date(a.lastAccessedAt).getTime(),
      );
  } catch {
    return [];
  }
}

export function saveRecentRoom(entry: {
  roomId: string;
  roomName?: string;
}): void {
  if (typeof window === "undefined" || !window.localStorage) {
    return;
  }
  try {
    const existingList = getRecentRooms();
    const existing = existingList.find((r) => r.roomId === entry.roomId);
    const roomName =
      (entry.roomName && entry.roomName.trim().length > 0
        ? entry.roomName.trim()
        : existing?.roomName) || "ルーム";

    const filtered = existingList.filter((r) => r.roomId !== entry.roomId);
    const updated: RecentRoom[] = [
      {
        roomId: entry.roomId,
        roomName,
        lastAccessedAt: new Date().toISOString(),
      },
      ...filtered,
    ];
    // 最大30件保存
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(updated.slice(0, 30)));
  } catch {
    // localStorage 利用不可（プライベートブラウズ等）は無視
  }
}

export function removeRecentRoom(roomId: string): void {
  if (typeof window === "undefined" || !window.localStorage) {
    return;
  }
  try {
    const existingList = getRecentRooms();
    const filtered = existingList.filter((r) => r.roomId !== roomId);
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(filtered));
  } catch {
    // ignore
  }
}
