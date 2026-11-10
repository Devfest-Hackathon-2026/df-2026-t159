import { describe, expect, it } from "vitest";
import { RevisionConflictError } from "../../room-change";
import {
  nextRateLimitState,
  rateLimitWindowKey,
  rateLimitWindowStart,
} from "../../server/rate-limit";
import type { Person, RoomSnapshot } from "../../types";
import { AiApiError } from "../errors";
import {
  FakeMembershipPort,
  FakeRoomReadPort,
  FakeRoomWritePort,
  makeFakePorts,
} from "../fakes";
import { handleStructureSaveRequest } from "../handlers";
import type { RoomWritePort, ServerPorts } from "../ports";
import { bindStructureDrafts } from "../structureSave";

const people: Person[] = [
  { id: "person-care", name: "父", canProvideCare: false },
  { id: "person-eldest", name: "長女", canProvideCare: true },
  { id: "person-second", name: "長女", canProvideCare: true }, // 同名がいても名前では結びつけない
];

const snapshot: RoomSnapshot = {
  people,
  placements: [],
  constraints: [],
  hopes: [],
  unknowns: [],
  careWindows: [{ day: 0, startHour: 7, endHour: 21 }],
  copayRate: 1,
  revision: 3,
};

const validDraft = {
  memberName: "長女",
  type: "unavailable",
  detail: "平日は仕事",
  days: [4, 0, 1, 2, 3, 3],
  startHour: 9,
  endHour: 18,
  personId: "person-eldest",
};

describe("bindStructureDrafts", () => {
  it("personId を結びつけて保存形式へ変換する（days は重複除去＋ソート）", () => {
    const bound = bindStructureDrafts(
      { constraints: [validDraft], hopes: ["分担したい", ""], unknowns: [] },
      people,
    );
    expect(bound.constraints).toEqual([
      {
        personId: "person-eldest",
        type: "unavailable",
        detail: "平日は仕事",
        days: [0, 1, 2, 3, 4],
        startHour: 9,
        endHour: 18,
      },
    ]);
    expect(bound.hopes).toEqual(["分担したい"]);
    expect(bound.unknowns).toEqual([]);
  });

  it("同名の家族がいても、名前ではなく明示された personId を採用する", () => {
    const bound = bindStructureDrafts(
      {
        constraints: [{ ...validDraft, personId: "person-second" }],
        hopes: [],
        unknowns: [],
      },
      people,
    );
    expect(bound.constraints[0].personId).toBe("person-second");
  });

  it("personId が無ければ 400（person_binding_required）", () => {
    const { personId: _omit, ...withoutBinding } = validDraft;
    expect(() =>
      bindStructureDrafts(
        { constraints: [withoutBinding], hopes: [], unknowns: [] },
        people,
      ),
    ).toThrowError(
      expect.objectContaining<Partial<AiApiError>>({
        status: 400,
        code: "person_binding_required",
      }),
    );
  });

  it("people に無い personId は 400（unknown_person_id）", () => {
    expect(() =>
      bindStructureDrafts(
        {
          constraints: [{ ...validDraft, personId: "person-ghost" }],
          hopes: [],
          unknowns: [],
        },
        people,
      ),
    ).toThrowError(
      expect.objectContaining<Partial<AiApiError>>({
        status: 400,
        code: "unknown_person_id",
      }),
    );
  });

  it("unavailable なのに時刻が無ければ 400", () => {
    const { startHour: _s, endHour: _e, ...withoutHours } = validDraft;
    expect(() =>
      bindStructureDrafts(
        { constraints: [withoutHours], hopes: [], unknowns: [] },
        people,
      ),
    ).toThrowError(
      expect.objectContaining<Partial<AiApiError>>({ status: 400 }),
    );
  });

  it("余分なキーは 400", () => {
    expect(() =>
      bindStructureDrafts(
        {
          constraints: [{ ...validDraft, note: "勝手な項目" }],
          hopes: [],
          unknowns: [],
        },
        people,
      ),
    ).toThrowError(
      expect.objectContaining<Partial<AiApiError>>({ status: 400 }),
    );
  });
});

describe("handleStructureSaveRequest", () => {
  const baseInput = {
    idToken: "test-token",
    roomId: "room-1",
    baseRevision: 3,
    constraints: [validDraft],
    hopes: [],
    unknowns: ["夜間の状態は不明"],
  };

  function portsWith(overrides: Partial<ServerPorts> = {}): {
    ports: ServerPorts;
    roomWrite: FakeRoomWritePort;
  } {
    const rooms = new FakeRoomReadPort().setSnapshot("room-1", snapshot);
    const roomWrite = new FakeRoomWritePort(rooms);
    const ports = makeFakePorts({ rooms, roomWrite, ...overrides });
    return { ports, roomWrite };
  }

  it("トークンがなければ 401", async () => {
    const { ports } = portsWith();
    const result = await handleStructureSaveRequest(ports, {
      ...baseInput,
      idToken: null,
    });
    expect(result.status).toBe(401);
  });

  it("careManager は 403（family のみ）", async () => {
    const membership = new FakeMembershipPort().setRole(
      "room-1",
      "user-1",
      "careManager",
    );
    const { ports } = portsWith({ membership });
    const result = await handleStructureSaveRequest(ports, baseInput);
    expect(result.status).toBe(403);
  });

  it("ルームがなければ 404", async () => {
    const rooms = new FakeRoomReadPort();
    const ports = makeFakePorts({ rooms });
    const result = await handleStructureSaveRequest(ports, baseInput);
    expect(result.status).toBe(404);
  });

  it("baseRevision が古いと 409 で保存しない", async () => {
    const { ports, roomWrite } = portsWith();
    const result = await handleStructureSaveRequest(ports, {
      ...baseInput,
      baseRevision: 2,
    });
    expect(result.status).toBe(409);
    expect(roomWrite.commits).toHaveLength(0);
  });

  it("personId が people に無ければ 400 で保存しない", async () => {
    const { ports, roomWrite } = portsWith();
    const result = await handleStructureSaveRequest(ports, {
      ...baseInput,
      constraints: [{ ...validDraft, personId: "person-ghost" }],
    });
    expect(result.status).toBe(400);
    expect((result.body as { error: string }).error).toBe("unknown_person_id");
    expect(roomWrite.commits).toHaveLength(0);
  });

  it("成功すると revision が進み、結びつけた制約一式が保存される", async () => {
    const { ports, roomWrite } = portsWith();
    const result = await handleStructureSaveRequest(ports, baseInput);
    expect(result.status).toBe(200);
    expect(result.body).toEqual({ revision: 4 });
    expect(roomWrite.commits).toHaveLength(1);
    expect(roomWrite.commits[0].expectedRevision).toBe(3);
    expect(roomWrite.commits[0].change.constraints).toEqual([
      {
        personId: "person-eldest",
        type: "unavailable",
        detail: "平日は仕事",
        days: [0, 1, 2, 3, 4],
        startHour: 9,
        endHour: 18,
      },
    ]);
    expect(roomWrite.commits[0].change.unknowns).toEqual(["夜間の状態は不明"]);
  });

  it("保存直前に版が進んでいたら 409（RevisionConflictError の付け替え）", async () => {
    const conflicting: RoomWritePort = {
      async commitChange() {
        throw new RevisionConflictError(3, 4);
      },
    };
    const { ports } = portsWith({ roomWrite: conflicting });
    const result = await handleStructureSaveRequest(ports, baseInput);
    expect(result.status).toBe(409);
  });

  it("careWindows と copayRate も一緒に渡された場合は同一トランザクションでまとめて保存される", async () => {
    const { ports, roomWrite } = portsWith();
    const result = await handleStructureSaveRequest(ports, {
      ...baseInput,
      careWindows: [
        { day: 2, startHour: 9, endHour: 17 },
        { day: 0, startHour: 7, endHour: 12 },
      ],
      copayRate: 2,
    });
    expect(result.status).toBe(200);
    expect(result.body).toEqual({ revision: 4 });
    expect(roomWrite.commits).toHaveLength(1);
    expect(roomWrite.commits[0].change.careWindows).toEqual([
      { day: 0, startHour: 7, endHour: 12 },
      { day: 2, startHour: 9, endHour: 17 },
    ]);
    expect(roomWrite.commits[0].change.copayRate).toBe(2);
    expect(roomWrite.commits[0].change.constraints).toHaveLength(1);
  });
});

describe("回数枠の純粋判定（lib/server/rate-limit）", () => {
  it("ドキュメントがなければ予約できて count=1 になる", () => {
    expect(nextRateLimitState(null)).toEqual({ allowed: true, nextCount: 1 });
  });

  it("上限未満なら予約できる", () => {
    expect(nextRateLimitState({ count: 9 })).toEqual({
      allowed: true,
      nextCount: 10,
    });
  });

  it("上限に達していたら予約できない", () => {
    expect(nextRateLimitState({ count: 10 })).toEqual({
      allowed: false,
      nextCount: null,
    });
  });

  it("時間枠キーは UTC の正時で、フェイクと同じ形式", () => {
    const at = new Date("2026-11-07T12:34:56.789Z");
    expect(rateLimitWindowKey(at)).toBe("2026-11-07T12");
    expect(rateLimitWindowStart(at).toISOString()).toBe(
      "2026-11-07T12:00:00.000Z",
    );
  });
});
