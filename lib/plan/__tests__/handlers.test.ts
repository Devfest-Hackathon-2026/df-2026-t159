/**
 * Issue 14 ハンドラの単体テスト。
 *
 * フェイク ports（lib/plan/fakes.ts）で実 Firestore なしに検証する。
 * 配置と期待値は Issue 10 の fixture（揉めるプラン／納得プラン／固定 changes）を
 * そのまま使う：固定 changes を揉めるプランへ適用すると納得プランになり、
 * 再検証が ok=true になることが、実物の検証エンジンで照合済みの前提。
 */

import { describe, expect, it } from "vitest";
import { demoFixture } from "../../demo-fixture";
import type { RoomSnapshot, ValidationResult } from "../../types";
import { FakePlanStorePort, makeFakePlanPorts } from "../fakes";
import {
  handleApplyProposalRequest,
  handleConfirmPlanRequest,
  handleCreateCommentRequest,
} from "../handlers";
import type { PlanPorts } from "../ports";

const REVISION = 5;

function snapshotWith(
  placements: RoomSnapshot["placements"],
  overrides: Partial<RoomSnapshot> = {},
): RoomSnapshot {
  return {
    people: demoFixture.people,
    placements,
    constraints: demoFixture.constraints,
    hopes: demoFixture.hopes,
    unknowns: demoFixture.unknowns,
    careWindows: demoFixture.careWindows,
    copayRate: demoFixture.copayRate,
    revision: REVISION,
    ...overrides,
  };
}

const troubledSnapshot = snapshotWith(demoFixture.troubledPlan.placements);
const acceptedSnapshot = snapshotWith(demoFixture.acceptedPlan.placements);

const fixedProposal = {
  summary: demoFixture.fixedProposal.summary,
  changes: demoFixture.fixedProposal.changes,
  baseRevision: REVISION,
};

function portsWith(snapshot: RoomSnapshot): { ports: PlanPorts; store: FakePlanStorePort } {
  const store = new FakePlanStorePort().setSnapshot("room-1", snapshot);
  return { ports: makeFakePlanPorts({ store }), store };
}

describe("handleApplyProposalRequest（代替案の適用）", () => {
  it("再検証OKの代替案は保存され、revision が +1 される（fixture の固定提案）", async () => {
    const { ports, store } = portsWith(troubledSnapshot);
    const result = await handleApplyProposalRequest(ports, {
      idToken: "family-token",
      roomId: "room-1",
      proposal: fixedProposal,
    });

    expect(result.status).toBe(200);
    const body = result.body as { applied: boolean; revision: number; validation: ValidationResult };
    expect(body.applied).toBe(true);
    expect(body.revision).toBe(REVISION + 1);
    expect(body.validation.ok).toBe(true);

    const saved = store.getSnapshot("room-1");
    expect(saved?.revision).toBe(REVISION + 1);
    expect(saved?.placements).toEqual(demoFixture.acceptedPlan.placements);
  });

  it("baseRevision が現在の revision と違う案は 409 で、保存されない", async () => {
    const { ports, store } = portsWith(troubledSnapshot);
    const result = await handleApplyProposalRequest(ports, {
      idToken: "family-token",
      roomId: "room-1",
      proposal: { ...fixedProposal, baseRevision: REVISION - 1 },
    });

    expect(result.status).toBe(409);
    expect((result.body as { error: string }).error).toBe("revision_mismatch");
    const saved = store.getSnapshot("room-1");
    expect(saved?.revision).toBe(REVISION);
    expect(saved?.placements).toEqual(demoFixture.troubledPlan.placements);
  });

  it("適用しても検証NGのままの案は 422 で、保存されない", async () => {
    const { ports, store } = portsWith(troubledSnapshot);
    // 変更なしの案：揉めるプランのままなので再検証は ok にならない
    const result = await handleApplyProposalRequest(ports, {
      idToken: "family-token",
      roomId: "room-1",
      proposal: { summary: "変更なし", changes: [], baseRevision: REVISION },
    });

    expect(result.status).toBe(422);
    const body = result.body as { error: string; validation: ValidationResult };
    expect(body.error).toBe("proposal_rejected");
    expect(body.validation.ok).toBe(false);
    expect(store.getSnapshot("room-1")?.revision).toBe(REVISION);
    expect(store.getSnapshot("room-1")?.placements).toEqual(
      demoFixture.troubledPlan.placements,
    );
  });

  it("family 以外（careManager）は 403", async () => {
    const { ports } = portsWith(troubledSnapshot);
    const result = await handleApplyProposalRequest(ports, {
      idToken: "manager-token",
      roomId: "room-1",
      proposal: fixedProposal,
    });
    expect(result.status).toBe(403);
  });

  it("未認証は 401", async () => {
    const { ports } = portsWith(troubledSnapshot);
    const result = await handleApplyProposalRequest(ports, {
      idToken: null,
      roomId: "room-1",
      proposal: fixedProposal,
    });
    expect(result.status).toBe(401);
  });

  it("proposal の形が不正なら 400", async () => {
    const { ports } = portsWith(troubledSnapshot);
    const result = await handleApplyProposalRequest(ports, {
      idToken: "family-token",
      roomId: "room-1",
      proposal: { summary: "x", baseRevision: REVISION, changes: "not-array" },
    });
    expect(result.status).toBe(400);
    expect((result.body as { error: string }).error).toBe("invalid_proposal");
  });
});

describe("handleConfirmPlanRequest（プランの確定）", () => {
  it("条件を満たすプランは確定でき、summary が保存され、revision は増えない", async () => {
    const { ports, store } = portsWith(acceptedSnapshot);
    const result = await handleConfirmPlanRequest(ports, {
      idToken: "family-token",
      roomId: "room-1",
      expectedRevision: REVISION,
    });

    expect(result.status).toBe(200);
    expect(result.body).toEqual({ confirmed: true, confirmedRevision: REVISION });

    const summary = store.getSummary("room-1");
    expect(summary?.confirmedRevision).toBe(REVISION);
    expect(summary?.validation.ok).toBe(true);
    expect(summary?.snapshot.placements).toEqual(
      demoFixture.acceptedPlan.placements,
    );
    // 確定のみでは revision を増やさない
    expect(store.getSnapshot("room-1")?.revision).toBe(REVISION);
  });

  it("再検証が ok でないプランは確定できない（validation_not_ok）", async () => {
    const { ports, store } = portsWith(troubledSnapshot);
    const result = await handleConfirmPlanRequest(ports, {
      idToken: "family-token",
      roomId: "room-1",
      expectedRevision: REVISION,
    });

    expect(result.status).toBe(422);
    const body = result.body as { error: string; reasons: string[] };
    expect(body.error).toBe("not_confirmable");
    expect(body.reasons).toContain("validation_not_ok");
    expect(store.getSummary("room-1")).toBeNull();
  });

  it("validationErrors が残っているプランは確定できない（validation_errors）", async () => {
    // ok=true でも validationErrors があれば確定させないことを、検証関数を
    // 差し替えて独立に確認する（仕様は確定条件を3点独立に挙げている）
    const validateWithErrors = (): ValidationResult => ({
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
      validationErrors: [{ code: "invalidMaster", reason: "テスト用の不整合" }],
    });
    const store = new FakePlanStorePort(validateWithErrors).setSnapshot(
      "room-1",
      acceptedSnapshot,
    );
    const ports = makeFakePlanPorts({ store });

    const result = await handleConfirmPlanRequest(ports, {
      idToken: "family-token",
      roomId: "room-1",
      expectedRevision: REVISION,
    });

    expect(result.status).toBe(422);
    const body = result.body as { error: string; reasons: string[] };
    expect(body.error).toBe("not_confirmable");
    expect(body.reasons).toEqual(["validation_errors"]);
    expect(store.getSummary("room-1")).toBeNull();
  });

  it("unknowns が残っているプランは確定できない（unknowns_remain）", async () => {
    const { ports, store } = portsWith(
      snapshotWith(demoFixture.acceptedPlan.placements, {
        unknowns: ["本人の希望で未確認の点"],
      }),
    );
    const result = await handleConfirmPlanRequest(ports, {
      idToken: "family-token",
      roomId: "room-1",
      expectedRevision: REVISION,
    });

    expect(result.status).toBe(422);
    const body = result.body as { error: string; reasons: string[] };
    expect(body.error).toBe("not_confirmable");
    expect(body.reasons).toEqual(["unknowns_remain"]);
    expect(store.getSummary("room-1")).toBeNull();
  });

  it("expectedRevision が現在の revision と違う場合は 409 で、保存されない", async () => {
    const { ports, store } = portsWith(acceptedSnapshot);
    const result = await handleConfirmPlanRequest(ports, {
      idToken: "family-token",
      roomId: "room-1",
      expectedRevision: REVISION + 1,
    });

    expect(result.status).toBe(409);
    expect((result.body as { error: string }).error).toBe("revision_mismatch");
    expect(store.getSummary("room-1")).toBeNull();
  });

  it("family 以外（careManager）は 403", async () => {
    const { ports } = portsWith(acceptedSnapshot);
    const result = await handleConfirmPlanRequest(ports, {
      idToken: "manager-token",
      roomId: "room-1",
      expectedRevision: REVISION,
    });
    expect(result.status).toBe(403);
  });
});

describe("handleCreateCommentRequest（ケアマネのコメント）", () => {
  it("careManager はコメントを作成でき、authorUid は認証 UID になる", async () => {
    const { ports, store } = portsWith(acceptedSnapshot);
    const result = await handleCreateCommentRequest(ports, {
      idToken: "manager-token",
      roomId: "room-1",
      body: "この内容でケアマネへ相談できます。",
    });

    expect(result.status).toBe(201);
    const comments = store.listComments("room-1");
    expect(comments).toHaveLength(1);
    expect(comments[0].authorUid).toBe("manager-1");
    expect(comments[0].body).toBe("この内容でケアマネへ相談できます。");
    expect(comments[0].id).toBe((result.body as { commentId: string }).commentId);
    // コメントの作成は revision を増やさない
    expect(store.getSnapshot("room-1")?.revision).toBe(REVISION);
  });

  it("family はコメントを作成できない（403）", async () => {
    const { ports, store } = portsWith(acceptedSnapshot);
    const result = await handleCreateCommentRequest(ports, {
      idToken: "family-token",
      roomId: "room-1",
      body: "家族からのコメント",
    });
    expect(result.status).toBe(403);
    expect(store.listComments("room-1")).toHaveLength(0);
  });

  it("未認証は 401", async () => {
    const { ports } = portsWith(acceptedSnapshot);
    const result = await handleCreateCommentRequest(ports, {
      idToken: null,
      roomId: "room-1",
      body: "コメント",
    });
    expect(result.status).toBe(401);
  });

  it("本文が0字なら 400", async () => {
    const { ports, store } = portsWith(acceptedSnapshot);
    const result = await handleCreateCommentRequest(ports, {
      idToken: "manager-token",
      roomId: "room-1",
      body: "",
    });
    expect(result.status).toBe(400);
    expect((result.body as { error: string }).error).toBe("invalid_comment_body");
    expect(store.listComments("room-1")).toHaveLength(0);
  });

  it("本文が1字なら作成できる", async () => {
    const { ports } = portsWith(acceptedSnapshot);
    const result = await handleCreateCommentRequest(ports, {
      idToken: "manager-token",
      roomId: "room-1",
      body: "あ",
    });
    expect(result.status).toBe(201);
  });

  it("本文が1,000字なら作成できる", async () => {
    const { ports } = portsWith(acceptedSnapshot);
    const result = await handleCreateCommentRequest(ports, {
      idToken: "manager-token",
      roomId: "room-1",
      body: "あ".repeat(1000),
    });
    expect(result.status).toBe(201);
  });

  it("本文が1,001字なら 400", async () => {
    const { ports, store } = portsWith(acceptedSnapshot);
    const result = await handleCreateCommentRequest(ports, {
      idToken: "manager-token",
      roomId: "room-1",
      body: "あ".repeat(1001),
    });
    expect(result.status).toBe(400);
    expect((result.body as { error: string }).error).toBe("invalid_comment_body");
    expect(store.listComments("room-1")).toHaveLength(0);
  });
});
