/**
 * commitRoomChange のサーバー側実行（Admin SDK。Issue 7 本接続）。
 *
 * lib/rooms.ts の commitRoomChange（Client SDK・ブラウザ用）と同じ意味論を
 * Admin SDK で実行する。書き込み計画は Issue 2 の共有純粋ロジック
 * planRoomChangeWrites（lib/room-change.ts）をそのまま使い、
 * トランザクション内でも rooms/{roomId} の revision === expectedRevision と
 * 固定IDドキュメント（constraints/main）の存在を検証してから一括書き込みする。
 *
 * Route Handler 内では Client SDK にサインイン済みユーザーがおらず
 * Firestore ルールに弾かれるため、サーバーからの保存は Admin SDK 経由にする。
 * 意味論（全入力変更と revision の +1 を同一 transaction で保存し、
 * 不一致なら何も保存しない）は Client 版と完全に揃える。
 */

import {
  planRoomChangeWrites,
  RevisionConflictError,
  RoomNotFoundError,
} from "../room-change";
import { firestorePaths, type RoomChange, type RoomDoc } from "../types";
import { adminDb } from "./firebase-admin";
import { readRoomSnapshotAdmin } from "./snapshot";

/**
 * 配置・制約・careWindows・負担割合の変更を、revision の +1 と同一 transaction で保存する。
 * expectedRevision が現在の revision と一致しない場合は RevisionConflictError を投げ、
 * 何も保存しない。ルームがなければ RoomNotFoundError。
 *
 * @returns 保存後に新しくなった revision
 */
export async function commitRoomChangeAdmin(
  roomId: string,
  expectedRevision: number,
  change: RoomChange,
): Promise<number> {
  const snapshot = await readRoomSnapshotAdmin(roomId);
  if (snapshot === null) {
    throw new RoomNotFoundError(roomId);
  }
  // 計画段階でも revision を検証する（不一致ならトランザクション自体を始めない）
  const plan = planRoomChangeWrites(snapshot, expectedRevision, change);

  const db = adminDb();
  const roomRef = db.doc(firestorePaths.room(roomId));
  const constraintsRef = db.doc(firestorePaths.constraints(roomId));

  return db.runTransaction(async (tx) => {
    // 読み取りはすべて書き込みより先に行う（Firestore トランザクションの規則）
    const roomSnap = await tx.get(roomRef);
    if (!roomSnap.exists) {
      throw new RoomNotFoundError(roomId);
    }
    const currentRevision = (roomSnap.data() as RoomDoc).revision;
    if (currentRevision !== expectedRevision) {
      throw new RevisionConflictError(expectedRevision, currentRevision);
    }
    // 固定IDドキュメント（constraints/main）の存在もトランザクション内で確認する
    if (plan.constraintsDoc !== null) {
      await tx.get(constraintsRef);
    }

    if (plan.deletePeopleIds && plan.deletePeopleIds.length > 0) {
      for (const personId of plan.deletePeopleIds) {
        tx.delete(db.doc(firestorePaths.person(roomId, personId)));
      }
    }
    if (plan.upsertPeople && plan.upsertPeople.length > 0) {
      for (const person of plan.upsertPeople) {
        tx.set(db.doc(firestorePaths.person(roomId, person.id)), {
          ...person,
        });
      }
    }

    for (const placementId of plan.deletePlacementIds) {
      tx.delete(db.doc(firestorePaths.placement(roomId, placementId)));
    }
    for (const placement of plan.upsertPlacements) {
      tx.set(db.doc(firestorePaths.placement(roomId, placement.id)), {
        ...placement,
      });
    }
    if (plan.constraintsDoc !== null) {
      tx.set(constraintsRef, { ...plan.constraintsDoc });
    }
    tx.update(roomRef, {
      ...plan.roomFields,
      revision: plan.nextRevision,
    });
    return plan.nextRevision;
  });
}
