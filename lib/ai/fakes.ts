/**
 * ports（ports.ts）のテスト用フェイク実装。
 *
 * 単体テスト専用であり、本番の Route Handler では使わない
 * （本番は lib/server/ports.ts の createServerPorts を使う）。
 *
 * FakeRateLimitPort は「1ルーム×1時間枠のカウンター」をメモリで再現したもの。
 * 実物は Firestore の rooms/{roomId}/rateLimits を transaction で予約する
 * （lib/server/rate-limit.ts。このフェイクの意味論は実物の契約に合わせる：
 * 構造化・代替案で共有し、上限を超えた予約は false を返す）。
 */

import {
  RevisionConflictError,
  RoomNotFoundError,
} from "../room-change";
import type {
  MemberRole,
  RoomChange,
  RoomSnapshot,
  ValidationResult,
} from "../types";
import { GEMINI_CALL_LIMIT_PER_HOUR } from "./inputValidation";
import type {
  AuthPort,
  GeminiPort,
  MembershipPort,
  RateLimitPort,
  RoomReadPort,
  RoomWritePort,
  ServerPorts,
  ValidationPort,
} from "./ports";

export class FakeAuthPort implements AuthPort {
  /** idToken → uid の対応表。載っていないトークンは検証失敗（null） */
  constructor(private readonly tokens: ReadonlyMap<string, string>) {}

  async verifyIdToken(idToken: string): Promise<{ uid: string } | null> {
    const uid = this.tokens.get(idToken);
    return uid ? { uid } : null;
  }
}

export class FakeMembershipPort implements MembershipPort {
  private readonly roles = new Map<string, MemberRole>();

  setRole(roomId: string, uid: string, role: MemberRole): this {
    this.roles.set(`${roomId}:${uid}`, role);
    return this;
  }

  async getRole(roomId: string, uid: string): Promise<MemberRole | null> {
    return this.roles.get(`${roomId}:${uid}`) ?? null;
  }
}

export class FakeRoomReadPort implements RoomReadPort {
  private readonly snapshots = new Map<string, RoomSnapshot>();

  setSnapshot(roomId: string, snapshot: RoomSnapshot): this {
    this.snapshots.set(roomId, snapshot);
    return this;
  }

  async getSnapshot(roomId: string): Promise<RoomSnapshot | null> {
    return this.snapshots.get(roomId) ?? null;
  }
}

/** 時間枠（1時間）キー。実物の rateLimits ドキュメントIDの決め方に合わせる */
export function rateLimitWindowKey(now: Date = new Date()): string {
  return now.toISOString().slice(0, 13); // 例: 2026-11-07T12
}

export class FakeRateLimitPort implements RateLimitPort {
  private readonly counts = new Map<string, number>();

  constructor(
    private readonly limit: number = GEMINI_CALL_LIMIT_PER_HOUR,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async reserve(roomId: string): Promise<boolean> {
    const key = `${roomId}:${rateLimitWindowKey(this.now())}`;
    const current = this.counts.get(key) ?? 0;
    if (current >= this.limit) return false;
    this.counts.set(key, current + 1);
    return true;
  }

  /** テスト確認用：現在の時間枠で予約済みの回数 */
  count(roomId: string): number {
    return this.counts.get(`${roomId}:${rateLimitWindowKey(this.now())}`) ?? 0;
  }
}

/**
 * 保存のフェイク。FakeRoomReadPort と対で使い、スナップショットの revision と
 * 照合して commitRoomChange と同じ意味論（不一致は RevisionConflictError、
 * ルームがなければ RoomNotFoundError、成功したら revision +1）を再現する。
 * 実際にスナップショットへ反映はしない（保存内容は commits に記録する）。
 */
export class FakeRoomWritePort implements RoomWritePort {
  readonly commits: {
    roomId: string;
    expectedRevision: number;
    change: RoomChange;
  }[] = [];

  constructor(private readonly rooms: FakeRoomReadPort) {}

  async commitChange(
    roomId: string,
    expectedRevision: number,
    change: RoomChange,
  ): Promise<number> {
    const snapshot = await this.rooms.getSnapshot(roomId);
    if (!snapshot) throw new RoomNotFoundError(roomId);
    if (snapshot.revision !== expectedRevision) {
      throw new RevisionConflictError(expectedRevision, snapshot.revision);
    }
    this.commits.push({ roomId, expectedRevision, change });
    return expectedRevision + 1;
  }
}

export class FakeValidationPort implements ValidationPort {
  /**
   * 固定の ValidationResult を返すか、入力スナップショットから結果を決める関数を渡す。
   * 試し適用（Issue 8）のように「適用前は NG・適用後は OK」というエンジンの
   * 振る舞いを再現する場合は関数形を使う。固定形は従来どおり。
   */
  constructor(
    private readonly result:
      | ValidationResult
      | ((snapshot: RoomSnapshot) => ValidationResult),
  ) {}

  validate(snapshot: RoomSnapshot): ValidationResult {
    return typeof this.result === "function"
      ? this.result(snapshot)
      : this.result;
  }
}

export type FakeGeminiHandler = (
  args: Parameters<GeminiPort["generateJson"]>[0],
) => Promise<unknown>;

export class FakeGeminiPort implements GeminiPort {
  readonly calls: Parameters<GeminiPort["generateJson"]>[0][] = [];

  constructor(private readonly handler: FakeGeminiHandler) {}

  async generateJson(
    args: Parameters<GeminiPort["generateJson"]>[0],
  ): Promise<unknown> {
    this.calls.push(args);
    return this.handler(args);
  }
}

/** テスト用に一式を組み立てる */
export function makeFakePorts(overrides: Partial<ServerPorts> = {}): ServerPorts {
  const rooms = overrides.rooms ?? new FakeRoomReadPort();
  return {
    auth: new FakeAuthPort(new Map([["test-token", "user-1"]])),
    membership: new FakeMembershipPort().setRole("room-1", "user-1", "family"),
    rooms,
    rateLimit: new FakeRateLimitPort(),
    roomWrite: new FakeRoomWritePort(
      rooms instanceof FakeRoomReadPort ? rooms : new FakeRoomReadPort(),
    ),
    validation: new FakeValidationPort({
      ok: true,
      weeklyUnits: 0,
      monthlyUnits: 0,
      limitUnits: 27048,
      overUnits: 0,
      selfPayYen: 0,
      selfPayBreakdown: { withinYen: 0, overYen: 0 },
      gaps: [],
      memberHours: [],
      overloads: [],
      hardViolations: [],
      validationErrors: [],
    }),
    gemini: new FakeGeminiPort(async () => ({})),
    ...overrides,
  };
}
