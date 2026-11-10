/**
 * DemoStorePort の Admin SDK 実装（Issue 15）。
 *
 * サーバー側（Route Handler）でデモルームの作成・リセット・投入・取得を
 * Firebase Admin SDK で実行する。
 *
 * トランザクション・バッチ規則：
 * - リセットは transaction で処理し、rooms/{roomId} の creatorUid 一致と isDemo を検証
 * - 全計算入力（placements・constraints・careWindows・copayRate）と revision の +1 を同一 transaction で保存
 * - summary/main は削除し、comments・members・people・人物対応・creatorUid は保持する
 */

import { FieldValue } from "firebase-admin/firestore";
import { demoFixture, type DemoFixture } from "../demo-fixture";
import { AiApiError } from "../ai/errors";
import { adminDb } from "./firebase-admin";
import { readRoomSnapshotAdmin } from "./snapshot";
import {
  createPersonMapping,
  mapConstraints,
  mapPeople,
  mapPlacements,
} from "../demo/mapping";
import type { DemoStorePort } from "../demo/ports";
import type {
  CreateDemoRoomInput,
  DemoRoomDoc,
  DemoRoomMeta,
  PersonMapping,
} from "../demo/types";
import {
  firestorePaths,
  type MemberRole,
  type RoomSnapshot,
} from "../types";
import { RoomNotFoundError } from "../room-change";

export class AdminDemoStore implements DemoStorePort {
  constructor(private readonly fixture: DemoFixture = demoFixture) {}

  async getDemoMeta(roomId: string): Promise<DemoRoomMeta | null> {
    const db = adminDb();
    const snap = await db.doc(firestorePaths.room(roomId)).get();
    if (!snap.exists) return null;
    const data = snap.data() as DemoRoomDoc;
    return {
      roomId,
      creatorUid: data.creatorUid,
      isDemo: Boolean(data.isDemo),
      revision: data.revision,
      fixtureVersion: data.fixtureVersion ?? this.fixture.fixtureVersion,
      personMapping: data.personMapping ?? {},
      careWindows: data.careWindows ?? [],
      copayRate: data.copayRate,
    };
  }

  async getSnapshot(roomId: string): Promise<RoomSnapshot | null> {
    return readRoomSnapshotAdmin(roomId);
  }

  async createDemoRoom(
    creatorUid: string,
    input: CreateDemoRoomInput = {},
  ): Promise<{ roomId: string; personMapping: PersonMapping }> {
    const db = adminDb();
    const roomId = crypto.randomUUID();
    const personMapping = createPersonMapping(
      this.fixture.people,
      input.idGenerator,
    );
    const roomPeople = mapPeople(this.fixture.people, personMapping);
    const initialState = input.initialState ?? "troubled";

    const batch = db.batch();

    // rooms/{roomId}
    batch.set(db.doc(firestorePaths.room(roomId)), {
      creatorUid,
      isDemo: true,
      revision: 0,
      careWindows: this.fixture.careWindows,
      careLevel: 3,
      copayRate: this.fixture.copayRate,
      fixtureVersion: this.fixture.fixtureVersion,
      personMapping,
      createdAt: FieldValue.serverTimestamp(),
    });

    // members/{creatorUid}
    batch.set(db.doc(firestorePaths.member(roomId, creatorUid)), {
      role: "family" satisfies MemberRole,
      createdAt: FieldValue.serverTimestamp(),
    });

    // people/{personId}
    for (const person of roomPeople) {
      batch.set(db.doc(firestorePaths.person(roomId, person.id)), person);
    }

    // constraints/main
    if (initialState === "troubled") {
      batch.set(db.doc(firestorePaths.constraints(roomId)), {
        constraints: mapConstraints(this.fixture.constraints, personMapping),
        hopes: this.fixture.hopes,
        unknowns: this.fixture.unknowns,
      });
      // placements
      const placements = mapPlacements(
        this.fixture.troubledPlan.placements,
        personMapping,
      );
      for (const p of placements) {
        batch.set(db.doc(firestorePaths.placement(roomId, p.id)), p);
      }
    } else {
      batch.set(db.doc(firestorePaths.constraints(roomId)), {
        constraints: [],
        hopes: [],
        unknowns: [],
      });
    }

    await batch.commit();
    return { roomId, personMapping };
  }

  async resetDemoRoom(
    roomId: string,
    callerUid: string,
  ): Promise<{ revision: number }> {
    const db = adminDb();
    const roomRef = db.doc(firestorePaths.room(roomId));
    const constraintsRef = db.doc(firestorePaths.constraints(roomId));
    const summaryRef = db.doc(firestorePaths.summary(roomId));
    const placementsCol = db.collection(firestorePaths.placements(roomId));

    return db.runTransaction(async (tx) => {
      // 1. 読み取り（Firestore トランザクションの規則：全読み取りを先行）
      const [roomSnap, placementsSnap, summarySnap] = await Promise.all([
        tx.get(roomRef),
        tx.get(placementsCol),
        tx.get(summaryRef),
      ]);

      if (!roomSnap.exists) {
        throw new RoomNotFoundError(roomId);
      }
      const roomData = roomSnap.data() as DemoRoomDoc;

      if (!roomData.isDemo) {
        throw new AiApiError(403, "not_a_demo_room", "デモルーム以外はリセットできません");
      }
      if (roomData.creatorUid !== callerUid) {
        throw new AiApiError(403, "creator_only", "リセットできるのはルーム作成者だけです");
      }

      const personMapping = roomData.personMapping;
      if (!personMapping) {
        throw new AiApiError(500, "missing_person_mapping", "人物ID対応が保存されていません");
      }

      // 2. 削除操作
      // 既存の placements を全削除
      for (const doc of placementsSnap.docs) {
        tx.delete(doc.ref);
      }
      // summary/main があれば削除
      if (summarySnap.exists) {
        tx.delete(summaryRef);
      }

      // 3. 復元操作（固定初期値）
      const restoredPlacements = mapPlacements(
        this.fixture.troubledPlan.placements,
        personMapping,
      );
      for (const p of restoredPlacements) {
        tx.set(db.doc(firestorePaths.placement(roomId, p.id)), p);
      }

      const restoredConstraints = mapConstraints(
        this.fixture.constraints,
        personMapping,
      );
      tx.set(constraintsRef, {
        constraints: restoredConstraints,
        hopes: this.fixture.hopes,
        unknowns: this.fixture.unknowns,
      });

      const nextRevision = roomData.revision + 1;
      tx.update(roomRef, {
        revision: nextRevision,
        careWindows: this.fixture.careWindows,
        copayRate: this.fixture.copayRate,
      });

      // members・people・comments・creatorUid・personMapping は保持
      return nextRevision;
    }).then((revision) => ({ revision }));
  }

  async seedTroubledPlan(
    roomId: string,
    _callerUid: string,
  ): Promise<{ revision: number }> {
    const db = adminDb();
    const roomRef = db.doc(firestorePaths.room(roomId));
    const placementsCol = db.collection(firestorePaths.placements(roomId));

    return db.runTransaction(async (tx) => {
      const [roomSnap, placementsSnap] = await Promise.all([
        tx.get(roomRef),
        tx.get(placementsCol),
      ]);

      if (!roomSnap.exists) {
        throw new RoomNotFoundError(roomId);
      }
      const roomData = roomSnap.data() as DemoRoomDoc;

      if (!roomData.isDemo) {
        throw new AiApiError(403, "not_a_demo_room", "デモルーム以外は操作できません");
      }

      const personMapping = roomData.personMapping;
      if (!personMapping) {
        throw new AiApiError(500, "missing_person_mapping", "人物ID対応が保存されていません");
      }

      for (const doc of placementsSnap.docs) {
        tx.delete(doc.ref);
      }

      const restoredPlacements = mapPlacements(
        this.fixture.troubledPlan.placements,
        personMapping,
      );
      for (const p of restoredPlacements) {
        tx.set(db.doc(firestorePaths.placement(roomId, p.id)), p);
      }

      const nextRevision = roomData.revision + 1;
      tx.update(roomRef, {
        revision: nextRevision,
      });

      return nextRevision;
    }).then((revision) => ({ revision }));
  }
}

export function createAdminDemoStore(): DemoStorePort {
  return new AdminDemoStore();
}
