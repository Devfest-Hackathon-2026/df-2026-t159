import { describe, expect, it } from "vitest";
import { Timestamp } from "firebase/firestore";
import { applyChanges } from "../../apply-changes";
import { demoFixture } from "../../demo-fixture";
import { bindStructureDrafts } from "../../ai/structureSave";
import { evaluateProposalApplication } from "../../plan/logic";
import type { Proposal, RoomSnapshot } from "../../types";
import { validateRoom } from "../../validation";
import { createFakeDemoPorts } from "../fakes";
import {
  handleCreateDemoRoomRequest,
  handleDemoProposalsRequest,
  handleDemoSeedRequest,
  handleDemoStructureRequest,
  handleResetDemoRoomRequest,
} from "../handlers";
import { mapConstraints, mapPeople, mapPlacements } from "../mapping";
import { matchDemoSnapshot } from "../match";

describe("デモ通し・ライフサイクル・保証のテスト（Issue 15）", () => {
  const fx = demoFixture;
  const creatorUid = "creator-user-001";
  const creatorToken = "creator-auth-token";

  function setup() {
    const ports = createFakeDemoPorts({ fixture: fx });
    ports.fakeAuth.setToken(creatorToken, creatorUid);
    return ports;
  }

  /**
   * 【仕様 4 の保証のテスト】
   * デモモードの構造化固定応答をそのまま承認・保存し「揉めるプラン」を読み込んだ状態と、
   * リセット直後に初期配置を読み込んだ状態が、照合条件と完全一致すること。
   */
  it("保証のテスト：構造化固定応答の承認・保存＋揉めるプラン読み込み状態と、リセット直後の状態が照合条件と完全一致する", async () => {
    const ports = setup();

    // 1. empty 状態でデモルームを作成
    const createRes = await handleCreateDemoRoomRequest(ports, {
      idToken: creatorToken,
      initialState: "empty",
    });
    const { roomId, personMapping } = createRes.body as {
      roomId: string;
      personMapping: Record<string, string>;
    };

    // 2. 構造化固定応答を取得
    const structRes = await handleDemoStructureRequest(ports, {
      idToken: creatorToken,
      roomId,
    });
    expect(structRes.status).toBe(200);
    const structBody = structRes.body as {
      constraints: { memberName: string; type: string; detail: string; days: number[]; startHour?: number; endHour?: number }[];
      hopes: string[];
      unknowns: string[];
      demo: boolean;
    };
    expect(structBody.demo).toBe(true);

    // 3. 確認画面で家族に紐づけて保存（Issue 7 の保存経路を再現）
    const snapshotBeforeSave = (await ports.fakeStore.getSnapshot(roomId))!;
    const nameToId = new Map(snapshotBeforeSave.people.map((p) => [p.name, p.id]));
    const boundConstraints = structBody.constraints.map((c) => ({
      ...c,
      personId: nameToId.get(c.memberName)!,
    }));

    const boundResult = bindStructureDrafts(
      {
        constraints: boundConstraints,
        hopes: structBody.hopes,
        unknowns: structBody.unknowns,
      },
      snapshotBeforeSave.people,
    );

    // 保存により revision が +1 される（0 -> 1）
    ports.fakeStore.setSnapshot(roomId, {
      ...snapshotBeforeSave,
      constraints: boundResult.constraints,
      hopes: boundResult.hopes,
      unknowns: boundResult.unknowns,
      revision: 1,
    });

    // 4. 「揉めるプラン」を明示操作で読み込む（Issue 3 導線：revision 1 -> 2）
    const seedRes = await handleDemoSeedRequest(ports, {
      idToken: creatorToken,
      roomId,
    });
    expect(seedRes.status).toBe(200);
    expect((seedRes.body as { revision: number }).revision).toBe(2);

    // これが【状態A】：構造化固定応答を承認保存し、揉めるプランを読み込んだスナップショット
    const stateA = (await ports.fakeStore.getSnapshot(roomId))!;
    const metaA = (await ports.fakeStore.getDemoMeta(roomId))!;

    // 状態A が照合条件を満たすことを確認
    const matchA = matchDemoSnapshot(stateA, metaA, fx);
    expect(matchA.matched).toBe(true);

    // 5. 次に、リセットを実行して【状態B】を作る
    const resetRes = await handleResetDemoRoomRequest(ports, {
      idToken: creatorToken,
      roomId,
    });
    expect(resetRes.status).toBe(200);
    expect((resetRes.body as { revision: number }).revision).toBe(3);

    // これが【状態B】：リセット直後に初期配置を復元したスナップショット
    const stateB = (await ports.fakeStore.getSnapshot(roomId))!;
    const metaB = (await ports.fakeStore.getDemoMeta(roomId))!;

    // 状態B が照合条件を満たすことを確認
    const matchB = matchDemoSnapshot(stateB, metaB, fx);
    expect(matchB.matched).toBe(true);

    // 6. 状態A と 状態B の計算入力が完全一致することを検証（revision 以外の全フィールド）
    expect(stateB.people).toEqual(stateA.people);
    expect(stateB.careWindows).toEqual(stateA.careWindows);
    expect(stateB.copayRate).toEqual(stateA.copayRate);
    expect(stateB.hopes).toEqual(stateA.hopes);
    expect(stateB.unknowns).toEqual(stateA.unknowns);
    expect(stateB.constraints).toEqual(stateA.constraints);
    expect(stateB.placements).toEqual(stateA.placements);

    // 7. 両状態ともに、デモ固定代替案のリクエストを受け取れる
    const propRes = await handleDemoProposalsRequest(ports, {
      idToken: creatorToken,
      roomId,
      baseRevision: stateB.revision, // 3
    });
    expect(propRes.status).toBe(200);
    const propBody = propRes.body as { demo: boolean; baseRevision: number; proposals: Proposal[] };
    expect(propBody.demo).toBe(true);
    expect(propBody.baseRevision).toBe(3);
    expect(propBody.proposals).toHaveLength(1);
  });

  /**
   * 【受け入れ条件：リセット→投入を2回繰り返しても同じ状態になること】
   */
  it("リセット→投入のサイクルを2回繰り返しても、状態と人物対応が同一に保たれる", async () => {
    const ports = setup();

    const createRes = await handleCreateDemoRoomRequest(ports, {
      idToken: creatorToken,
      initialState: "troubled",
    });
    const { roomId, personMapping } = createRes.body as {
      roomId: string;
      personMapping: Record<string, string>;
    };

    const initialSnap = (await ports.fakeStore.getSnapshot(roomId))!;

    // 1回目のサイクル：適当に変更を加えてからリセット
    ports.fakeStore.setSnapshot(roomId, {
      ...initialSnap,
      revision: 5,
      placements: [],
    });
    const reset1 = await handleResetDemoRoomRequest(ports, {
      idToken: creatorToken,
      roomId,
    });
    expect((reset1.body as { revision: number }).revision).toBe(6);
    const snapAfterReset1 = (await ports.fakeStore.getSnapshot(roomId))!;

    // 2回目のサイクル：適当に変更を加えてからリセット
    ports.fakeStore.setSnapshot(roomId, {
      ...snapAfterReset1,
      revision: 10,
      placements: [],
    });
    const reset2 = await handleResetDemoRoomRequest(ports, {
      idToken: creatorToken,
      roomId,
    });
    expect((reset2.body as { revision: number }).revision).toBe(11);
    const snapAfterReset2 = (await ports.fakeStore.getSnapshot(roomId))!;

    // 1回目と2回目で、revision を除く全データ（配置・制約・careWindows・people・負担割合）が完全一致する
    expect(snapAfterReset2.people).toEqual(snapAfterReset1.people);
    expect(snapAfterReset2.placements).toEqual(snapAfterReset1.placements);
    expect(snapAfterReset2.constraints).toEqual(snapAfterReset1.constraints);
    expect(snapAfterReset2.careWindows).toEqual(snapAfterReset1.careWindows);
    expect(snapAfterReset2.copayRate).toEqual(snapAfterReset1.copayRate);
    expect(snapAfterReset2.hopes).toEqual(snapAfterReset1.hopes);
    expect(snapAfterReset2.unknowns).toEqual(snapAfterReset1.unknowns);

    // 人物対応マップも不変
    const meta = (await ports.fakeStore.getDemoMeta(roomId))!;
    expect(meta.personMapping).toEqual(personMapping);
  });

  /**
   * 【通しの流れ：揉めるプラン → 固定代替案取得 → 採用 → 確定 → リセット】
   */
  it("デモモードの通し確認：揉めるプランから固定代替案を採用して合格にし、リセットで初期状態に戻る", async () => {
    const ports = setup();

    // 1. デモルーム作成（揉めるプラン投入済み）
    const createRes = await handleCreateDemoRoomRequest(ports, {
      idToken: creatorToken,
      initialState: "troubled",
    });
    const { roomId } = createRes.body as { roomId: string };
    const snap0 = (await ports.fakeStore.getSnapshot(roomId))!;

    // 初期状態は揉めるプランなので検証NG
    const val0 = validateRoom(snap0);
    expect(val0.ok).toBe(false);
    expect(val0.overUnits).toBeGreaterThan(0); // 枠オーバー
    expect(val0.gaps.length).toBeGreaterThan(0); // 空白
    expect(val0.overloads.length).toBeGreaterThan(0); // 負担集中

    // 2. デモモードで固定代替案を取得
    const propRes = await handleDemoProposalsRequest(ports, {
      idToken: creatorToken,
      roomId,
      baseRevision: snap0.revision, // 0
    });
    expect(propRes.status).toBe(200);
    const { proposals } = propRes.body as { proposals: Proposal[] };
    expect(proposals).toHaveLength(1);
    const proposal = proposals[0];

    // 3. 代替案を採用（Issue 14 の適用ロジック evaluateProposalApplication）
    const evalResult = evaluateProposalApplication(snap0, proposal, (s) => validateRoom(s));
    expect(evalResult.kind).toBe("applicable");
    if (evalResult.kind === "applicable") {
      expect(evalResult.validation.ok).toBe(true);

      // 採用を保存（revision + 1 = 1）
      ports.fakeStore.setSnapshot(roomId, {
        ...snap0,
        placements: evalResult.nextPlacements,
        revision: 1,
      });
    }

    const snap1 = (await ports.fakeStore.getSnapshot(roomId))!;
    const val1 = validateRoom(snap1);
    expect(val1.ok).toBe(true);
    expect(val1.overUnits).toBe(0);
    expect(val1.gaps).toHaveLength(0);
    expect(val1.overloads).toHaveLength(0);

    // 4. プラン確定（summary を保存）
    ports.fakeStore.setSummary(roomId, {
      snapshot: snap1,
      validation: val1,
      confirmedRevision: 1,
      confirmedAt: Timestamp.now(),
    });
    expect(ports.fakeStore.getSummary(roomId)).not.toBeNull();

    // 5. リセットを実行
    const resetRes = await handleResetDemoRoomRequest(ports, {
      idToken: creatorToken,
      roomId,
    });
    expect(resetRes.status).toBe(200);
    expect((resetRes.body as { revision: number }).revision).toBe(2);

    // summary が消えていること
    expect(ports.fakeStore.getSummary(roomId)).toBeNull();

    // 再び揉めるプランに戻り、検証NGになっていること
    const snap2 = (await ports.fakeStore.getSnapshot(roomId))!;
    const val2 = validateRoom(snap2);
    expect(val2.ok).toBe(false);
    expect(val2.overUnits).toBeGreaterThan(0);
  });
});
