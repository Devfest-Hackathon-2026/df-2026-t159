// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  getRecentRooms,
  removeRecentRoom,
  saveRecentRoom,
} from "./recent-rooms";

describe("recent-rooms（Issue #73）", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  afterEach(() => {
    window.localStorage.clear();
  });

  it("初期状態では空配列を返す", () => {
    expect(getRecentRooms()).toEqual([]);
  });

  it("ルームを記録し、最新順で取得できる", () => {
    saveRecentRoom({ roomId: "room-1", roomName: "佐藤家のルーム" });
    saveRecentRoom({ roomId: "room-2", roomName: "鈴木家のルーム" });

    const rooms = getRecentRooms();
    expect(rooms).toHaveLength(2);
    expect(rooms[0].roomId).toBe("room-2");
    expect(rooms[0].roomName).toBe("鈴木家のルーム");
    expect(rooms[1].roomId).toBe("room-1");
  });

  it("同一ルームの再保存時は先頭に移動し、日時が更新される", () => {
    saveRecentRoom({ roomId: "room-1", roomName: "佐藤家のルーム" });
    saveRecentRoom({ roomId: "room-2", roomName: "鈴木家のルーム" });
    saveRecentRoom({ roomId: "room-1", roomName: "佐藤家のルーム（更新）" });

    const rooms = getRecentRooms();
    expect(rooms).toHaveLength(2);
    expect(rooms[0].roomId).toBe("room-1");
    expect(rooms[0].roomName).toBe("佐藤家のルーム（更新）");
  });

  it("ルームを個別に削除できる", () => {
    saveRecentRoom({ roomId: "room-1", roomName: "佐藤家のルーム" });
    saveRecentRoom({ roomId: "room-2", roomName: "鈴木家のルーム" });

    removeRecentRoom("room-1");

    const rooms = getRecentRooms();
    expect(rooms).toHaveLength(1);
    expect(rooms[0].roomId).toBe("room-2");
  });
});
