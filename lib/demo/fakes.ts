/**
 * デモ機能のテスト用フェイク実装（Issue 15）。
 *
 * 単体テスト専用であり、本番の Route Handler では使わない。
 * メモリ上で実物（Admin SDK）と同じ意味論を再現する：
 * - デモルーム作成：人物ID対応を保存、初回 isDemo=true、revision=0
 * - リセット：デモ限定、作成者限定、保持・復元・削除の範囲、revision+1
 * - 投入：troubledPlan の配置と revision+1
 */

import { demoFixture, type DemoFixture } from "../demo-fixture";
import { AiApiError } from "../ai/errors";
import { FakeAuthPort, FakeMembershipPort } from "../ai/fakes";
import type { AuthPort } from "../ai/ports";
import { RoomNotFoundError } from "../room-change";
import type {
  ConfirmedSnapshot,
  Person,
  RoomComment,
  RoomSnapshot,
} from "../types";
import { validateRoom } from "../validation";
import {
  createPersonMapping,
  mapConstraints,
  mapPeople,
  mapPlacements,
} from "./mapping";
import type { DemoPorts, DemoStorePort } from "./ports";
import type {
  CreateDemoRoomInput,
  DemoRoomMeta,
  PersonMapping,
} from "./types";

export class FakeDemoStorePort implements DemoStorePort {
  private readonly metas = new Map<string, DemoRoomMeta>();
  private readonly snapshots = new Map<string, RoomSnapshot>();
  private readonly summaries = new Map<string, ConfirmedSnapshot>();
  private readonly commentsByRoom = new Map<string, RoomComment[]>();
  private readonly membersByRoom = new Map<string, Map<string, string>>();

  constructor(
    private readonly fixture: DemoFixture = demoFixture,
    private readonly membership?: FakeMembershipPort,
  ) {}

  // -------------------------------------------------------------------------
  // テスト用データ設定・参照ヘルパー
  // -------------------------------------------------------------------------

  setMeta(roomId: string, meta: DemoRoomMeta): this {
    this.metas.set(roomId, { ...meta });
    return this;
  }

  setSnapshot(roomId: string, snapshot: RoomSnapshot): this {
    this.snapshots.set(roomId, { ...snapshot });
    return this;
  }

  setSummary(roomId: string, summary: ConfirmedSnapshot): this {
    this.summaries.set(roomId, { ...summary });
    return this;
  }

  getSummary(roomId: string): ConfirmedSnapshot | null {
    return this.summaries.get(roomId) ?? null;
  }

  addComment(roomId: string, comment: RoomComment): this {
    const list = this.commentsByRoom.get(roomId) ?? [];
    list.push({ ...comment });
    this.commentsByRoom.set(roomId, list);
    return this;
  }

  listComments(roomId: string): RoomComment[] {
    return [...(this.commentsByRoom.get(roomId) ?? [])];
  }

  addMember(roomId: string, uid: string, role: string): this {
    let m = this.membersByRoom.get(roomId);
    if (!m) {
      m = new Map();
      this.membersByRoom.set(roomId, m);
    }
    m.set(uid, role);
    return this;
  }

  listMembers(roomId: string): { uid: string; role: string }[] {
    const m = this.membersByRoom.get(roomId);
    if (!m) return [];
    return Array.from(m.entries()).map(([uid, role]) => ({ uid, role }));
  }

  // -------------------------------------------------------------------------
  // DemoStorePort 実装
  // -------------------------------------------------------------------------

  async getDemoMeta(roomId: string): Promise<DemoRoomMeta | null> {
    const meta = this.metas.get(roomId);
    return meta ? { ...meta } : null;
  }

  async getSnapshot(roomId: string): Promise<RoomSnapshot | null> {
    const snap = this.snapshots.get(roomId);
    return snap ? { ...snap } : null;
  }

  async createDemoRoom(
    creatorUid: string,
    input: CreateDemoRoomInput = {},
  ): Promise<{ roomId: string; personMapping: PersonMapping }> {
    const roomId = crypto.randomUUID();
    const personMapping = createPersonMapping(
      this.fixture.people,
      input.idGenerator,
    );
    const roomPeople = mapPeople(this.fixture.people, personMapping);
    const initialState = input.initialState ?? "troubled";

    const meta: DemoRoomMeta = {
      roomId,
      creatorUid,
      isDemo: true,
      revision: 0,
      fixtureVersion: this.fixture.fixtureVersion,
      personMapping: { ...personMapping },
      careWindows: [...this.fixture.careWindows],
      copayRate: this.fixture.copayRate,
    };
    this.metas.set(roomId, meta);

    const snapshot: RoomSnapshot = {
      people: roomPeople,
      placements:
        initialState === "troubled"
          ? mapPlacements(this.fixture.troubledPlan.placements, personMapping)
          : [],
      constraints:
        initialState === "troubled"
          ? mapConstraints(this.fixture.constraints, personMapping)
          : [],
      hopes: initialState === "troubled" ? [...this.fixture.hopes] : [],
      unknowns: initialState === "troubled" ? [...this.fixture.unknowns] : [],
      careWindows: [...this.fixture.careWindows],
      copayRate: this.fixture.copayRate,
      revision: 0,
    };
    this.snapshots.set(roomId, snapshot);

    this.addMember(roomId, creatorUid, "family");
    this.membership?.setRole(roomId, creatorUid, "family");

    return { roomId, personMapping };
  }

  async resetDemoRoom(
    roomId: string,
    callerUid: string,
  ): Promise<{ revision: number }> {
    const meta = this.metas.get(roomId);
    if (!meta) throw new RoomNotFoundError(roomId);
    if (!meta.isDemo) {
      throw new AiApiError(403, "not_a_demo_room", "デモルーム以外はリセットできません");
    }
    if (meta.creatorUid !== callerUid) {
      throw new AiApiError(403, "creator_only", "リセットできるのはルーム作成者だけです");
    }

    const currentSnapshot = this.snapshots.get(roomId);
    if (!currentSnapshot) throw new RoomNotFoundError(roomId);

    const nextRevision = currentSnapshot.revision + 1;

    // 保持するもの：members・people・人物対応・creatorUid・コメント
    // 復元するもの：配置・constraints・hopes・unknowns・careWindows・負担割合
    // 削除するもの：summary
    const restoredPlacements = mapPlacements(
      this.fixture.troubledPlan.placements,
      meta.personMapping,
    );
    const restoredConstraints = mapConstraints(
      this.fixture.constraints,
      meta.personMapping,
    );

    const nextSnapshot: RoomSnapshot = {
      people: [...currentSnapshot.people], // people は保持
      placements: restoredPlacements,
      constraints: restoredConstraints,
      hopes: [...this.fixture.hopes],
      unknowns: [...this.fixture.unknowns],
      careWindows: [...this.fixture.careWindows],
      copayRate: this.fixture.copayRate,
      revision: nextRevision,
    };
    this.snapshots.set(roomId, nextSnapshot);

    // meta の更新（revision のみ進める。personMapping, creatorUid, isDemo は保持）
    meta.revision = nextRevision;
    meta.careWindows = [...this.fixture.careWindows];
    meta.copayRate = this.fixture.copayRate;
    this.metas.set(roomId, meta);

    // summary 削除
    this.summaries.delete(roomId);

    return { revision: nextRevision };
  }

  async seedTroubledPlan(
    roomId: string,
    _callerUid: string,
  ): Promise<{ revision: number }> {
    const meta = this.metas.get(roomId);
    if (!meta) throw new RoomNotFoundError(roomId);
    if (!meta.isDemo) {
      throw new AiApiError(403, "not_a_demo_room", "デモルーム以外は操作できません");
    }

    const currentSnapshot = this.snapshots.get(roomId);
    if (!currentSnapshot) throw new RoomNotFoundError(roomId);

    const nextRevision = currentSnapshot.revision + 1;
    const mappedPlacements = mapPlacements(
      this.fixture.troubledPlan.placements,
      meta.personMapping,
    );

    const nextSnapshot: RoomSnapshot = {
      ...currentSnapshot,
      placements: mappedPlacements,
      revision: nextRevision,
    };
    this.snapshots.set(roomId, nextSnapshot);

    meta.revision = nextRevision;
    this.metas.set(roomId, meta);

    return { revision: nextRevision };
  }
}

export class FakeDemoAuthPort implements AuthPort {
  private readonly tokens = new Map<string, string>();

  setToken(idToken: string, uid: string): this {
    this.tokens.set(idToken, uid);
    return this;
  }

  async verifyIdToken(idToken: string): Promise<{ uid: string } | null> {
    const uid = this.tokens.get(idToken);
    return uid ? { uid } : null;
  }
}

export function createFakeDemoPorts(options?: {
  fixture?: DemoFixture;
  store?: FakeDemoStorePort;
  auth?: FakeDemoAuthPort;
  membership?: FakeMembershipPort;
}): DemoPorts & {
  fakeStore: FakeDemoStorePort;
  fakeAuth: FakeDemoAuthPort;
  fakeMembership: FakeMembershipPort;
} {
  const fakeMembership = options?.membership ?? new FakeMembershipPort();
  const fakeStore =
    options?.store ?? new FakeDemoStorePort(options?.fixture, fakeMembership);
  const fakeAuth = options?.auth ?? new FakeDemoAuthPort();

  return {
    auth: fakeAuth,
    membership: fakeMembership,
    store: fakeStore,
    validation: {
      validate: (snap) => validateRoom(snap),
    },
    fakeStore,
    fakeAuth,
    fakeMembership,
  };
}
