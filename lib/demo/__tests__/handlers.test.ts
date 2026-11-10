import { describe, expect, it } from "vitest";
import { Timestamp } from "firebase/firestore";
import { demoFixture } from "../../demo-fixture";
import type { RoomComment } from "../../types";
import { createFakeDemoPorts } from "../fakes";
import {
  handleCreateDemoRoomRequest,
  handleDemoProposalsRequest,
  handleDemoSeedRequest,
  handleDemoStructureRequest,
  handleResetDemoRoomRequest,
} from "../handlers";
import {
  createPersonMapping,
  mapConstraints,
  mapPeople,
  mapPlacements,
} from "../mapping";
import type { DemoRoomMeta } from "../types";

describe("デモ機能ハンドラ群（handlers.ts）", () => {
  const fx = demoFixture;
  const creatorUid = "creator-uid-123";
  const creatorToken = "creator-token";
  const otherUid = "other-uid-456";
  const otherToken = "other-token";

  function setup() {
    const ports = createFakeDemoPorts({ fixture: fx });
    ports.fakeAuth.setToken(creatorToken, creatorUid);
    ports.fakeAuth.setToken(otherToken, otherUid);
    return ports;
  }

  describe("handleCreateDemoRoomRequest", () => {
    it("未認証の場合は 401 を返す", async () => {
      const ports = setup();
      const res = await handleCreateDemoRoomRequest(ports, {
        idToken: null,
      });
      expect(res.status).toBe(401);
    });

    it("デモルームを作成し、201 と roomId・personMapping を返す", async () => {
      const ports = setup();
      const res = await handleCreateDemoRoomRequest(ports, {
        idToken: creatorToken,
      });
      expect(res.status).toBe(201);
      const body = res.body as { roomId: string; personMapping: Record<string, string> };
      expect(body.roomId).toBeDefined();
      expect(Object.keys(body.personMapping)).toHaveLength(4);

      // 保存されたメタ情報を確認
      const meta = await ports.fakeStore.getDemoMeta(body.roomId);
      expect(meta?.isDemo).toBe(true);
      expect(meta?.creatorUid).toBe(creatorUid);
      expect(meta?.revision).toBe(0);
      expect(meta?.personMapping).toEqual(body.personMapping);

      // 初期のスナップショットを確認（既定では troubledPlan 投入済み）
      const snap = await ports.fakeStore.getSnapshot(body.roomId);
      expect(snap?.revision).toBe(0);
      expect(snap?.people).toHaveLength(4);
      expect(snap?.placements.length).toBeGreaterThan(0);
    });

    it("initialState=empty を指定すると、配置・制約が空で作成される", async () => {
      const ports = setup();
      const res = await handleCreateDemoRoomRequest(ports, {
        idToken: creatorToken,
        initialState: "empty",
      });
      expect(res.status).toBe(201);
      const body = res.body as { roomId: string };

      const snap = await ports.fakeStore.getSnapshot(body.roomId);
      expect(snap?.placements).toEqual([]);
      expect(snap?.constraints).toEqual([]);
      expect(snap?.people).toHaveLength(4);
    });
  });

  describe("handleResetDemoRoomRequest", () => {
    it("未認証の場合は 401 を返す", async () => {
      const ports = setup();
      const res = await handleResetDemoRoomRequest(ports, {
        idToken: null,
        roomId: "room-1",
      });
      expect(res.status).toBe(401);
    });

    it("非 family メンバーの場合は 403 を返す", async () => {
      const ports = setup();
      const createRes = await handleCreateDemoRoomRequest(ports, {
        idToken: creatorToken,
      });
      const { roomId } = createRes.body as { roomId: string };

      ports.fakeMembership.setRole(roomId, otherUid, "careManager");
      const res = await handleResetDemoRoomRequest(ports, {
        idToken: otherToken,
        roomId,
      });
      expect(res.status).toBe(403);
    });

    it("作成者以外の family メンバーが実行した場合は 403 を返す", async () => {
      const ports = setup();
      const createRes = await handleCreateDemoRoomRequest(ports, {
        idToken: creatorToken,
      });
      const { roomId } = createRes.body as { roomId: string };

      // otherUid を family として追加
      ports.fakeMembership.setRole(roomId, otherUid, "family");
      ports.fakeStore.addMember(roomId, otherUid, "family");

      const res = await handleResetDemoRoomRequest(ports, {
        idToken: otherToken,
        roomId,
      });
      expect(res.status).toBe(403);
      expect((res.body as { error: string }).error).toBe("creator_only");
    });

    it("リセットにより固定初期値へ復元され、revision が +1 され、保持対象は残る", async () => {
      const ports = setup();
      const createRes = await handleCreateDemoRoomRequest(ports, {
        idToken: creatorToken,
      });
      const { roomId, personMapping } = createRes.body as {
        roomId: string;
        personMapping: Record<string, string>;
      };

      // 編集を加える（revision を進め、コメントを追加、summary を設定）
      const currentSnap = await ports.fakeStore.getSnapshot(roomId);
      ports.fakeStore.setSnapshot(roomId, {
        ...currentSnap!,
        revision: 4,
        placements: [], // 配置を全削除
        copayRate: 2 as const, // 負担割合を変更
      });
      ports.fakeStore.setMeta(roomId, {
        ...(await ports.fakeStore.getDemoMeta(roomId))!,
        revision: 4,
        copayRate: 2 as const,
      });

      const testComment: RoomComment = {
        id: "comment-1",
        authorUid: "care-manager-uid",
        body: "ケアマネからのコメント",
        createdAt: Timestamp.now(),
      };
      ports.fakeStore.addComment(roomId, testComment);
      ports.fakeStore.addMember(roomId, "care-manager-uid", "careManager");

      // summary を作成
      ports.fakeStore.setSummary(roomId, {
        snapshot: currentSnap!,
        validation: { ok: true } as any,
        confirmedRevision: 4,
        confirmedAt: Timestamp.now(),
      });

      // リセット実行
      const resetRes = await handleResetDemoRoomRequest(ports, {
        idToken: creatorToken,
        roomId,
      });
      expect(resetRes.status).toBe(200);
      const resetBody = resetRes.body as { reset: boolean; revision: number };
      expect(resetBody.reset).toBe(true);
      expect(resetBody.revision).toBe(5); // 4 + 1

      // 保持されているものの確認
      expect(ports.fakeStore.listComments(roomId)).toHaveLength(1);
      expect(ports.fakeStore.listComments(roomId)[0].body).toBe("ケアマネからのコメント");
      expect(ports.fakeStore.listMembers(roomId)).toHaveLength(2); // creator + careManager
      const afterMeta = await ports.fakeStore.getDemoMeta(roomId);
      expect(afterMeta?.creatorUid).toBe(creatorUid);
      expect(afterMeta?.personMapping).toEqual(personMapping); // 人物対応は不変

      // 復元されているものの確認
      const afterSnap = await ports.fakeStore.getSnapshot(roomId);
      expect(afterSnap?.revision).toBe(5);
      expect(afterSnap?.copayRate).toBe(fx.copayRate); // 1割に復元
      expect(afterSnap?.careWindows).toEqual(fx.careWindows);
      expect(afterSnap?.hopes).toEqual(fx.hopes);
      expect(afterSnap?.unknowns).toEqual(fx.unknowns);
      expect(afterSnap?.placements).toEqual(
        mapPlacements(fx.troubledPlan.placements, personMapping),
      );
      expect(afterSnap?.constraints).toEqual(
        mapConstraints(fx.constraints, personMapping),
      );

      // summary が削除されていること
      expect(ports.fakeStore.getSummary(roomId)).toBeNull();
    });
  });

  describe("handleDemoSeedRequest", () => {
    it("初期配置（揉めるプラン）を投入し、revision を +1 する", async () => {
      const ports = setup();
      const createRes = await handleCreateDemoRoomRequest(ports, {
        idToken: creatorToken,
        initialState: "empty",
      });
      const { roomId } = createRes.body as { roomId: string };

      const seedRes = await handleDemoSeedRequest(ports, {
        idToken: creatorToken,
        roomId,
      });
      expect(seedRes.status).toBe(200);
      expect((seedRes.body as { seeded: boolean; revision: number }).seeded).toBe(true);
      expect((seedRes.body as { seeded: boolean; revision: number }).revision).toBe(1);

      const snap = await ports.fakeStore.getSnapshot(roomId);
      expect(snap?.revision).toBe(1);
      expect(snap?.placements.length).toBeGreaterThan(0);
    });
  });

  describe("handleDemoProposalsRequest", () => {
    it("baseRevision が現在の revision と一致しない場合は 409 で破棄する", async () => {
      const ports = setup();
      const createRes = await handleCreateDemoRoomRequest(ports, {
        idToken: creatorToken,
      });
      const { roomId } = createRes.body as { roomId: string };

      const res = await handleDemoProposalsRequest(ports, {
        idToken: creatorToken,
        roomId,
        baseRevision: 999, // 不一致
      });
      expect(res.status).toBe(409);
      expect((res.body as { error: string }).error).toBe("revision_mismatch");
    });

    it("入力スナップショットが fixture と一致しない場合は 422 で固定案を返さない", async () => {
      const ports = setup();
      const createRes = await handleCreateDemoRoomRequest(ports, {
        idToken: creatorToken,
      });
      const { roomId } = createRes.body as { roomId: string };

      // 配置を一部変更
      const snap = await ports.fakeStore.getSnapshot(roomId);
      ports.fakeStore.setSnapshot(roomId, {
        ...snap!,
        placements: snap!.placements.slice(1),
      });

      const res = await handleDemoProposalsRequest(ports, {
        idToken: creatorToken,
        roomId,
        baseRevision: 0,
      });
      expect(res.status).toBe(422);
      expect((res.body as { error: string }).error).toBe("demo_snapshot_mismatch");
    });

    it("照合が完全一致する場合、demo: true の固定代替案を返す", async () => {
      const ports = setup();
      const createRes = await handleCreateDemoRoomRequest(ports, {
        idToken: creatorToken,
      });
      const { roomId } = createRes.body as { roomId: string };

      const res = await handleDemoProposalsRequest(ports, {
        idToken: creatorToken,
        roomId,
        baseRevision: 0,
      });
      expect(res.status).toBe(200);
      const body = res.body as {
        proposals: unknown[];
        baseRevision: number;
        demo: boolean;
      };
      expect(body.demo).toBe(true);
      expect(body.baseRevision).toBe(0);
      expect(body.proposals).toHaveLength(1);
    });
  });

  describe("handleDemoStructureRequest", () => {
    it("固定の構造化下書き（demo: true）を返す", async () => {
      const ports = setup();
      const createRes = await handleCreateDemoRoomRequest(ports, {
        idToken: creatorToken,
      });
      const { roomId } = createRes.body as { roomId: string };

      const res = await handleDemoStructureRequest(ports, {
        idToken: creatorToken,
        roomId,
      });
      expect(res.status).toBe(200);
      const body = res.body as { demo: boolean; constraints: unknown[]; hopes: string[] };
      expect(body.demo).toBe(true);
      expect(body.constraints).toHaveLength(fx.constraints.length);
      expect(body.hopes).toEqual(fx.hopes);
    });
  });
});
