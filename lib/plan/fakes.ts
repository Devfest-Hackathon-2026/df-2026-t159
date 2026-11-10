/**
 * ports（ports.ts）のテスト用フェイク実装（Issue 14）。
 *
 * 単体テスト専用であり、本番の Route Handler では使わない
 * （本番は lib/server/plan-ports.ts の createPlanPorts を使う）。
 *
 * FakePlanStorePort はスナップショット・確定スナップショット・コメントを
 * メモリに持ち、実物（Admin SDK）と同じ意味論を再現する：
 * - 適用：baseRevision 照合 → applyChanges → 再検証 → OK なら保存し revision +1
 * - 確定：確定条件を満たす場合だけ summary を保存し、revision は増やさない
 * - コメント：createdAt は保存時に付ける（フェイクでは現在時刻）
 * 判定の純粋ロジック（logic.ts）は実物と共有する。検証関数は差し替え可能
 * （既定は実物の validateRoom）。
 */

import { Timestamp } from "firebase/firestore";
import { RoomNotFoundError } from "../room-change";
import { validateRoom } from "../validation";
import type {
  ConfirmedSnapshot,
  Proposal,
  RoomComment,
  RoomSnapshot,
} from "../types";
import { FakeAuthPort, FakeMembershipPort } from "../ai/fakes";
import {
  evaluateConfirmation,
  evaluateProposalApplication,
} from "./logic";
import type {
  ApplyProposalOutcome,
  ConfirmPlanOutcome,
  PlanPorts,
  PlanStorePort,
  ValidateFn,
} from "./ports";

export class FakePlanStorePort implements PlanStorePort {
  private readonly snapshots = new Map<string, RoomSnapshot>();
  private readonly summaries = new Map<string, ConfirmedSnapshot>();
  private readonly commentsByRoom = new Map<string, RoomComment[]>();

  constructor(
    private readonly validate: ValidateFn = (snapshot) =>
      validateRoom(snapshot),
  ) {}

  setSnapshot(roomId: string, snapshot: RoomSnapshot): this {
    // 参照を共有すると呼び出し側の変更が漏れるため、浅いコピーで保持する
    this.snapshots.set(roomId, { ...snapshot });
    return this;
  }

  getSnapshot(roomId: string): RoomSnapshot | null {
    return this.snapshots.get(roomId) ?? null;
  }

  getSummary(roomId: string): ConfirmedSnapshot | null {
    return this.summaries.get(roomId) ?? null;
  }

  listComments(roomId: string): RoomComment[] {
    return [...(this.commentsByRoom.get(roomId) ?? [])];
  }

  async applyProposal(
    roomId: string,
    proposal: Proposal,
  ): Promise<ApplyProposalOutcome> {
    const snapshot = this.snapshots.get(roomId);
    if (!snapshot) throw new RoomNotFoundError(roomId);

    const evaluation = evaluateProposalApplication(
      snapshot,
      proposal,
      this.validate,
    );
    switch (evaluation.kind) {
      case "stale":
        return { status: "stale", actualRevision: evaluation.actualRevision };
      case "rejected":
        return { status: "rejected", validation: evaluation.validation };
      case "applicable": {
        const next: RoomSnapshot = {
          ...snapshot,
          placements: evaluation.nextPlacements,
          revision: snapshot.revision + 1,
        };
        this.snapshots.set(roomId, next);
        return {
          status: "applied",
          revision: next.revision,
          validation: evaluation.validation,
        };
      }
    }
  }

  async confirmPlan(
    roomId: string,
    expectedRevision: number,
  ): Promise<ConfirmPlanOutcome> {
    const snapshot = this.snapshots.get(roomId);
    if (!snapshot) throw new RoomNotFoundError(roomId);

    const evaluation = evaluateConfirmation(
      snapshot,
      expectedRevision,
      this.validate,
    );
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
        this.summaries.set(roomId, {
          snapshot,
          validation: evaluation.validation,
          confirmedRevision: expectedRevision,
          confirmedAt: Timestamp.now(),
        });
        return {
          status: "confirmed",
          confirmedRevision: expectedRevision,
          validation: evaluation.validation,
        };
      }
    }
  }

  async addComment(
    roomId: string,
    comment: { id: string; authorUid: string; body: string },
  ): Promise<void> {
    const list = this.commentsByRoom.get(roomId) ?? [];
    list.push({ ...comment, createdAt: Timestamp.now() });
    this.commentsByRoom.set(roomId, list);
  }
}

/** テスト用に一式を組み立てる（認証・membership のフェイクは Issue 7 のものを共有） */
export function makeFakePlanPorts(
  overrides: Partial<PlanPorts> = {},
): PlanPorts {
  return {
    auth: new FakeAuthPort(
      new Map([
        ["family-token", "family-1"],
        ["manager-token", "manager-1"],
      ]),
    ),
    membership: new FakeMembershipPort()
      .setRole("room-1", "family-1", "family")
      .setRole("room-1", "manager-1", "careManager"),
    store: new FakePlanStorePort(),
    ...overrides,
  };
}
