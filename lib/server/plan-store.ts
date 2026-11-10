/**
 * PlanStorePort の実物（Admin SDK。Issue 14）。
 *
 * 方式は Issue 2 の commitRoomChange に統一する：
 * 整合スナップショット（lib/server/snapshot.ts）を取得し、純粋ロジック
 * （lib/plan/logic.ts）で判定してから、transaction 内で rooms/{roomId} の
 * revision === 期待する版を再確認して一括書き込みする。
 *
 * - 適用：配置の保存は commitRoomChange と同じ意味論の commitRoomChangeAdmin を
 *   使う（全入力変更と revision の +1 を同一 transaction で保存）
 * - 確定：summary/main へ ConfirmedSnapshot を保存する transaction。
 *   rooms/{roomId} 本体は書き換えず、revision は増やさない。
 *   confirmedAt はサーバー時刻（FieldValue.serverTimestamp）
 * - コメント：comments/{commentId} へ保存。createdAt はサーバー時刻。
 *   コメントの作成は revision を増やさない
 *
 * Route Handler 内では Client SDK にサインイン済みユーザーがおらず
 * Firestore ルールに弾かれるため、サーバー経路は Admin SDK で実行する
 * （membership の発行や構造化結果の保存と同じ方針）。
 */

import { FieldValue } from "firebase-admin/firestore";
import {
  RevisionConflictError,
  RoomNotFoundError,
} from "../room-change";
import { validateRoom } from "../validation";
import { firestorePaths, type Proposal, type RoomDoc } from "../types";
import {
  evaluateConfirmation,
  evaluateProposalApplication,
} from "../plan/logic";
import type {
  ApplyProposalOutcome,
  ConfirmPlanOutcome,
  PlanStorePort,
  ValidateFn,
} from "../plan/ports";
import { adminDb } from "./firebase-admin";
import { commitRoomChangeAdmin } from "./room-write";
import { readRoomSnapshotAdmin } from "./snapshot";

/**
 * PlanStorePort の Admin SDK 実装を作る。
 * validate は差し替え可能（既定は Issue 6 の検証エンジン validateRoom）。
 */
export function createAdminPlanStore(
  validate: ValidateFn = (snapshot) => validateRoom(snapshot),
): PlanStorePort {
  return {
    async applyProposal(
      roomId: string,
      proposal: Proposal,
    ): Promise<ApplyProposalOutcome> {
      const snapshot = await readRoomSnapshotAdmin(roomId);
      if (snapshot === null) {
        throw new RoomNotFoundError(roomId);
      }
      const evaluation = evaluateProposalApplication(snapshot, proposal, validate);
      switch (evaluation.kind) {
        case "stale":
          return { status: "stale", actualRevision: evaluation.actualRevision };
        case "rejected":
          return { status: "rejected", validation: evaluation.validation };
        case "applicable": {
          try {
            const revision = await commitRoomChangeAdmin(
              roomId,
              proposal.baseRevision,
              { placements: evaluation.nextPlacements },
            );
            return { status: "applied", revision, validation: evaluation.validation };
          } catch (error) {
            // スナップショット取得後に版が進んでいた場合は「古い案」として扱う
            if (error instanceof RevisionConflictError) {
              return { status: "stale", actualRevision: error.actual };
            }
            throw error;
          }
        }
      }
    },

    async confirmPlan(
      roomId: string,
      expectedRevision: number,
    ): Promise<ConfirmPlanOutcome> {
      const snapshot = await readRoomSnapshotAdmin(roomId);
      if (snapshot === null) {
        throw new RoomNotFoundError(roomId);
      }
      const evaluation = evaluateConfirmation(snapshot, expectedRevision, validate);
      switch (evaluation.kind) {
        case "stale":
          return { status: "stale", actualRevision: evaluation.actualRevision };
        case "blocked":
          return {
            status: "blocked",
            reasons: evaluation.reasons,
            validation: evaluation.validation,
          };
        case "confirmable": {
          const db = adminDb();
          const roomRef = db.doc(firestorePaths.room(roomId));
          const summaryRef = db.doc(firestorePaths.summary(roomId));
          try {
            await db.runTransaction(async (tx) => {
              const roomSnap = await tx.get(roomRef);
              if (!roomSnap.exists) {
                throw new RoomNotFoundError(roomId);
              }
              const currentRevision = (roomSnap.data() as RoomDoc).revision;
              if (currentRevision !== expectedRevision) {
                throw new RevisionConflictError(expectedRevision, currentRevision);
              }
              // 確定のみでは revision を増やさない（room 本体は書き換えない）
              tx.set(summaryRef, {
                snapshot,
                validation: evaluation.validation,
                confirmedRevision: expectedRevision,
                confirmedAt: FieldValue.serverTimestamp(),
              });
            });
          } catch (error) {
            if (error instanceof RevisionConflictError) {
              return { status: "stale", actualRevision: error.actual };
            }
            throw error;
          }
          return {
            status: "confirmed",
            confirmedRevision: expectedRevision,
            validation: evaluation.validation,
          };
        }
      }
    },

    async addComment(
      roomId: string,
      comment: { id: string; authorUid: string; body: string },
    ): Promise<void> {
      await adminDb()
        .doc(firestorePaths.comment(roomId, comment.id))
        .set({
          id: comment.id,
          authorUid: comment.authorUid,
          body: comment.body,
          createdAt: FieldValue.serverTimestamp(),
        });
    },
  };
}
