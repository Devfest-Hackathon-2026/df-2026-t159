/**
 * ルームの読み書き（Client SDK 直。Issue 2）。
 *
 * - readRoomSnapshot：root の revision → 入力群 → root の revision の順に読み、
 *   前後が一致したときだけ整合スナップショットとして採用する（キャッシュは使わない）
 * - commitRoomChange：lib/types.ts で宣言された共通関数の実装。
 *   全入力変更と revision の +1 を同一 transaction で保存する。
 *   Web Client SDK の runTransaction はクエリを読めないため、事前取得した
 *   整合スナップショットから書き込み計画（lib/room-change.ts）を立て、
 *   トランザクション内では rooms/{roomId} の revision === expectedRevision と
 *   固定IDドキュメント（constraints/main）を検証して一括書き込みする方式に統一する
 *   （Issue 14・15 のトランザクションも同様の方式を前提とする）。
 *
 * membership の発行（ルーム作成・招待・参加確定）はここでは行わない。
 * サーバー側（Route Handler ＋ Admin SDK、lib/server/rooms.ts）に集約する。
 */

import {
  collection,
  doc,
  getDocFromServer,
  getDocsFromServer,
  runTransaction,
} from "firebase/firestore";
import { db } from "./firebase";
import { normalizeSavedConstraints } from "./ai/structureNormalize";
import { normalizePeople } from "./people";
import {
  planRoomChangeWrites,
  RevisionConflictError,
  RoomNotFoundError,
} from "./room-change";
import {
  firestorePaths,
  type MemberDoc,
  type Placement,
  type Person,
  type RoomChange,
  type RoomConstraints,
  type RoomDoc,
  type RoomSnapshot,
} from "./types";

export { RevisionConflictError, RoomNotFoundError } from "./room-change";

/**
 * ルームの入力一式を整合スナップショットとして読む。
 * ルームが存在しない場合は null。読み取り中に revision が変わった場合は
 * 最大3回まで読み直し、それでも一致しなければ null を返す。
 * 未参加者は Firestore ルールで読めないため、その場合は例外（permission-denied）になる。
 */
export async function readRoomSnapshot(
  roomId: string,
): Promise<RoomSnapshot | null> {
  const roomRef = doc(db, firestorePaths.room(roomId));
  for (let attempt = 0; attempt < 3; attempt++) {
    const first = await getDocFromServer(roomRef);
    if (!first.exists()) return null;
    const firstData = first.data() as RoomDoc;

    const [peopleSnap, placementsSnap, constraintsSnap] = await Promise.all([
      getDocsFromServer(collection(db, firestorePaths.people(roomId))),
      getDocsFromServer(collection(db, firestorePaths.placements(roomId))),
      getDocFromServer(doc(db, firestorePaths.constraints(roomId))),
    ]);

    const second = await getDocFromServer(roomRef);
    if (!second.exists()) return null;
    const secondData = second.data() as RoomDoc;
    if (firstData.revision !== secondData.revision) {
      continue; // 読み取り中に入力が更新された。前後不一致なので採用しない
    }

    const constraintsDoc: RoomConstraints = constraintsSnap.exists()
      ? (constraintsSnap.data() as RoomConstraints)
      : { constraints: [], hopes: [], unknowns: [] };

    return {
      people: normalizePeople(peopleSnap.docs.map((d) => d.data() as Person)),
      placements: placementsSnap.docs.map((d) => d.data() as Placement),
      constraints: normalizeSavedConstraints(constraintsDoc.constraints),
      hopes: constraintsDoc.hopes,
      unknowns: constraintsDoc.unknowns,
      careWindows: secondData.careWindows ?? [],
      copayRate: secondData.copayRate,
      revision: secondData.revision,
    };
  }
  return null;
}

/**
 * 配置・制約・careWindows・負担割合の変更を、revision の +1 と同一 transaction で保存する。
 * expectedRevision が現在の revision と一致しない場合は RevisionConflictError を投げ、
 * 何も保存しない（古い画面・古いAI応答からの保存を失敗させる）。
 * コメントと summary は計算入力ではないため、この関数の対象にしない（revision を増やさない）。
 *
 * @returns 保存後に新しくなった revision
 */
export async function commitRoomChange(
  roomId: string,
  expectedRevision: number,
  change: RoomChange,
): Promise<number> {
  const snapshot = await readRoomSnapshot(roomId);
  if (snapshot === null) {
    throw new RoomNotFoundError(roomId);
  }
  // 計画段階でも revision を検証する（不一致ならトランザクション自体を始めない）
  const plan = planRoomChangeWrites(snapshot, expectedRevision, change);

  const roomRef = doc(db, firestorePaths.room(roomId));
  const constraintsRef = doc(db, firestorePaths.constraints(roomId));

  return runTransaction(db, async (tx) => {
    // 読み取りはすべて書き込みより先に行う（Firestore トランザクションの規則）
    const roomSnap = await tx.get(roomRef);
    if (!roomSnap.exists()) {
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
        tx.delete(doc(db, firestorePaths.person(roomId, personId)));
      }
    }
    if (plan.upsertPeople && plan.upsertPeople.length > 0) {
      for (const person of plan.upsertPeople) {
        tx.set(doc(db, firestorePaths.person(roomId, person.id)), person);
      }
    }

    for (const placementId of plan.deletePlacementIds) {
      tx.delete(doc(db, firestorePaths.placement(roomId, placementId)));
    }
    for (const placement of plan.upsertPlacements) {
      tx.set(doc(db, firestorePaths.placement(roomId, placement.id)), placement);
    }
    if (plan.constraintsDoc !== null) {
      tx.set(constraintsRef, plan.constraintsDoc);
    }
    tx.update(roomRef, {
      ...plan.roomFields,
      revision: plan.nextRevision,
    });
    return plan.nextRevision;
  });
}

/**
 * 自分の membership（role）を読む。未参加者の場合は null。
 * ルール上、自分の members ドキュメントは自分だけが参加前に読める想定だが、
 * 読めない環境でも画面が止まらないよう、失敗時は null として扱う。
 */
export async function readOwnMembership(
  roomId: string,
  uid: string,
): Promise<MemberDoc | null> {
  try {
    const snap = await getDocFromServer(
      doc(db, firestorePaths.member(roomId, uid)),
    );
    return snap.exists() ? (snap.data() as MemberDoc) : null;
  } catch {
    return null;
  }
}
