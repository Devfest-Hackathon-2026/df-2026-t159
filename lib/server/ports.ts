/**
 * Route Handler が使う ServerPorts の組み立て（サーバー専用。Issue 7 本接続）。
 *
 * Issue 2 の実装へ接続済み：
 * - auth: Firebase Admin SDK の verifyIdToken で ID トークンを検証する
 * - membership: rooms/{roomId}/members/{uid} を Admin SDK で読む
 *   （role の正本は保存値のみ。Issue 2 の lib/server/rooms.ts と同じ読み方）
 * - rooms: 整合スナップショット（root の revision → 入力群 → root の revision の順に
 *   読み、前後一致したときだけ採用）を Admin SDK で返す（lib/server/snapshot.ts）
 * - rateLimit: rooms/{roomId}/rateLimits のカウンター（ドキュメントID＝時間枠）を
 *   transaction で呼び出し前に予約する。構造化・代替案で共有し、処理失敗も1回に数える
 *   （lib/server/rate-limit.ts）。Client からの更新は Firestore ルールで禁止
 * - roomWrite: commitRoomChange と同じ意味論の保存を Admin SDK で実行する
 *   （lib/server/room-write.ts。書き込み計画は Issue 2 の planRoomChangeWrites を共有）
 * - validation: Issue 6 の検証エンジン（lib/validation.ts の validateRoom 純粋関数）を
 *   そのまま差す（Issue 8 本接続）。単位数マスター（data/units.json）の読み込みと
 *   マスター検証（lib/units.ts の validateUnitsMaster）は validateRoom の内部で
 *   毎回行われるため、この接続点はエンジンを呼ぶだけでよい
 * - gemini: lib/server/gemini.ts の実装（@google/genai）
 *
 * なお lib/rooms.ts の readRoomSnapshot／readOwnMembership／commitRoomChange は
 * Client SDK（ブラウザ用）の実装であり、Route Handler 内ではサインイン済み
 * ユーザーがおらず Firestore ルールに弾かれるため、サーバー経路では使わない。
 * 置き場所・形・手順は Issue 2 の実装に揃え、Admin SDK で実行する。
 */

import type {
  AuthPort,
  MembershipPort,
  RoomReadPort,
  RoomWritePort,
  ServerPorts,
  ValidationPort,
} from "../ai/ports";
import { firestorePaths, type MemberDoc } from "../types";
import { validateRoom } from "../validation";
import { adminAuth, adminDb } from "./firebase-admin";
import { createGeminiPort } from "./gemini";
import { createFirestoreRateLimitPort } from "./rate-limit";
import { commitRoomChangeAdmin } from "./room-write";
import { readRoomSnapshotAdmin } from "./snapshot";

const authPort: AuthPort = {
  async verifyIdToken(idToken: string) {
    try {
      const decoded = await adminAuth().verifyIdToken(idToken);
      return { uid: decoded.uid };
    } catch {
      return null;
    }
  },
};

const membershipPort: MembershipPort = {
  async getRole(roomId: string, uid: string) {
    const snap = await adminDb()
      .doc(firestorePaths.member(roomId, uid))
      .get();
    if (!snap.exists) return null;
    return (snap.data() as MemberDoc).role;
  },
};

const roomReadPort: RoomReadPort = {
  getSnapshot: (roomId: string) => readRoomSnapshotAdmin(roomId),
};

const roomWritePort: RoomWritePort = {
  commitChange: (roomId, expectedRevision, change) =>
    commitRoomChangeAdmin(roomId, expectedRevision, change),
};

/**
 * Issue 6 の検証エンジン（純粋関数）をそのまま差す（Issue 8 本接続）。
 * スナップショットを受けて validateRoom を呼び、ValidationResult を返す。
 * 代替案ハンドラの「試し適用→再検証」もこの接続点を経由する。
 */
const validationPort: ValidationPort = {
  validate: (snapshot) => validateRoom(snapshot),
};

export function createServerPorts(): ServerPorts {
  return {
    auth: authPort,
    membership: membershipPort,
    rooms: roomReadPort,
    rateLimit: createFirestoreRateLimitPort(),
    roomWrite: roomWritePort,
    validation: validationPort,
    gemini: createGeminiPort(),
  };
}
