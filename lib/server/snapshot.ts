/**
 * 整合スナップショットのサーバー側読み取り（Admin SDK。Issue 7 本接続）。
 *
 * lib/rooms.ts の readRoomSnapshot（Client SDK・ブラウザ用）と同じ手順を
 * Admin SDK で実行する：
 * root の revision → 入力群（people・placements・constraints/main）→ root の revision
 * の順に読み、前後が一致したときだけ整合スナップショットとして採用する
 * （キャッシュは使わない。不一致は最大3回まで読み直し、それでも一致しなければ null）。
 *
 * Route Handler 内では Client SDK にサインイン済みユーザーがおらず、
 * Firestore ルール（request.auth 前提）に弾かれるため、サーバー経路は
 * Admin SDK で読む（共通前提：membership の照合は Admin SDK）。
 * ドキュメントの置き場所・形は Issue 2 の実装（firestorePaths・各 Doc 型）が正本。
 */

import { normalizeSavedConstraints } from "../ai/structureNormalize";
import { normalizePeople } from "../people";
import {
  firestorePaths,
  type Placement,
  type Person,
  type RoomConstraints,
  type RoomDoc,
  type RoomSnapshot,
} from "../types";
import { adminDb } from "./firebase-admin";

/**
 * ルームの入力一式を整合スナップショットとして読む（Admin SDK）。
 * ルームが存在しない場合、および3回読み直しても revision が一致しない場合は null。
 */
export async function readRoomSnapshotAdmin(
  roomId: string,
): Promise<RoomSnapshot | null> {
  const db = adminDb();
  const roomRef = db.doc(firestorePaths.room(roomId));
  for (let attempt = 0; attempt < 3; attempt++) {
    const first = await roomRef.get();
    if (!first.exists) return null;
    const firstData = first.data() as RoomDoc;

    const [peopleSnap, placementsSnap, constraintsSnap] = await Promise.all([
      db.collection(firestorePaths.people(roomId)).get(),
      db.collection(firestorePaths.placements(roomId)).get(),
      db.doc(firestorePaths.constraints(roomId)).get(),
    ]);

    const second = await roomRef.get();
    if (!second.exists) return null;
    const secondData = second.data() as RoomDoc;
    if (firstData.revision !== secondData.revision) {
      continue; // 読み取り中に入力が更新された。前後不一致なので採用しない
    }

    const constraintsDoc: RoomConstraints = constraintsSnap.exists
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
