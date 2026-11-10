/**
 * デモ機能のサーバー側ハンドラ群（Issue 15）。
 *
 * Route Handler は HTTP リクエストの抽出のみを行い、処理はここに寄せる。
 * ports 経由で外部を呼ぶため、単体テスト可能。
 *
 * ハンドラ一覧：
 * 1. handleCreateDemoRoomRequest: デモルーム作成（初回に人物ID対応を保存、isDemo=true、revision=0）
 * 2. handleResetDemoRoomRequest: デモルームリセット（isDemo & creatorUid 一致確認、保持/復元/削除、revision+1）
 * 3. handleDemoSeedRequest: デモ初期配置（揉めるプラン）の明示的投入
 * 4. handleDemoProposalsRequest: デモモードの固定代替案（照合一致時のみ発行、不一致時は返さない、baseRevision 照合、正規化・applyChanges・再検証通過、demo: true）
 * 5. handleDemoStructureRequest: デモモードの固定構造化下書き（demo: true）
 */

import {
  AiApiError,
  forbidden,
  revisionMismatch,
  roomNotFound,
  unauthorized,
} from "../ai/errors";
import { RoomNotFoundError } from "../room-change";
import { buildDemoProposal, buildDemoStructureDraft, DemoMismatchError } from "./logic";
import type { DemoPorts } from "./ports";
import type { CreateDemoRoomInput } from "./types";

export interface DemoHandlerResult {
  status: number;
  body: unknown;
}

interface ErrorBody {
  error: string;
  message: string;
  requestId: string;
}

function errorResult(
  status: number,
  code: string,
  message: string,
  requestId: string,
): DemoHandlerResult {
  const body: ErrorBody = { error: code, message, requestId };
  return { status, body };
}

function toErrorResult(error: unknown, requestId: string): DemoHandlerResult {
  if (error instanceof AiApiError) {
    return errorResult(error.status, error.code, error.message, requestId);
  }
  if (error instanceof RoomNotFoundError) {
    const wrapped = roomNotFound();
    return errorResult(wrapped.status, wrapped.code, wrapped.message, requestId);
  }
  if (error instanceof DemoMismatchError) {
    return errorResult(
      422,
      "demo_snapshot_mismatch",
      "デモの予定や設定が変更されているため、用意した代替案を表示できません。ボードで予定を調整するか、デモを最初の状態に戻してください。",
      requestId,
    );
  }
  return errorResult(500, "internal_error", "サーバーでエラーが発生しました", requestId);
}

/** 認証（401）を行い、uid を返す */
async function requireAuthUid(
  ports: DemoPorts,
  idToken: string | null,
): Promise<string> {
  if (!idToken) throw unauthorized();
  const verified = await ports.auth.verifyIdToken(idToken);
  if (!verified) throw unauthorized();
  return verified.uid;
}

/** 認証（401）と family 照合（403）を行い、uid を返す */
async function requireFamilyUid(
  ports: DemoPorts,
  idToken: string | null,
  roomId: string,
): Promise<string> {
  const uid = await requireAuthUid(ports, idToken);
  const role = await ports.membership.getRole(roomId, uid);
  if (role !== "family") throw forbidden();
  return uid;
}

// ---------------------------------------------------------------------------
// 1. デモルーム作成
// ---------------------------------------------------------------------------

export interface CreateDemoRoomHandlerInput {
  idToken: string | null;
  initialState?: "troubled" | "empty";
}

export async function handleCreateDemoRoomRequest(
  ports: DemoPorts,
  input: CreateDemoRoomHandlerInput,
): Promise<DemoHandlerResult> {
  const requestId = crypto.randomUUID();
  try {
    const uid = await requireAuthUid(ports, input.idToken);
    const result = await ports.store.createDemoRoom(uid, {
      initialState: input.initialState,
    });
    return {
      status: 201,
      body: {
        roomId: result.roomId,
        personMapping: result.personMapping,
      },
    };
  } catch (error) {
    return toErrorResult(error, requestId);
  }
}

// ---------------------------------------------------------------------------
// 2. デモルームリセット
// ---------------------------------------------------------------------------

export interface ResetDemoRoomHandlerInput {
  idToken: string | null;
  roomId: string;
}

export async function handleResetDemoRoomRequest(
  ports: DemoPorts,
  input: ResetDemoRoomHandlerInput,
): Promise<DemoHandlerResult> {
  const requestId = crypto.randomUUID();
  try {
    const uid = await requireFamilyUid(ports, input.idToken, input.roomId);
    const result = await ports.store.resetDemoRoom(input.roomId, uid);
    return {
      status: 200,
      body: {
        reset: true,
        revision: result.revision,
      },
    };
  } catch (error) {
    return toErrorResult(error, requestId);
  }
}

// ---------------------------------------------------------------------------
// 3. デモ初期配置投入
// ---------------------------------------------------------------------------

export interface DemoSeedHandlerInput {
  idToken: string | null;
  roomId: string;
}

export async function handleDemoSeedRequest(
  ports: DemoPorts,
  input: DemoSeedHandlerInput,
): Promise<DemoHandlerResult> {
  const requestId = crypto.randomUUID();
  try {
    const uid = await requireFamilyUid(ports, input.idToken, input.roomId);
    const result = await ports.store.seedTroubledPlan(input.roomId, uid);
    return {
      status: 200,
      body: {
        seeded: true,
        revision: result.revision,
      },
    };
  } catch (error) {
    return toErrorResult(error, requestId);
  }
}

// ---------------------------------------------------------------------------
// 4. デモモード固定代替案
// ---------------------------------------------------------------------------

export interface DemoProposalsHandlerInput {
  idToken: string | null;
  roomId: string;
  baseRevision: number;
}

export async function handleDemoProposalsRequest(
  ports: DemoPorts,
  input: DemoProposalsHandlerInput,
): Promise<DemoHandlerResult> {
  const requestId = crypto.randomUUID();
  try {
    await requireFamilyUid(ports, input.idToken, input.roomId);

    if (!Number.isInteger(input.baseRevision) || input.baseRevision < 0) {
      return errorResult(
        400,
        "invalid_base_revision",
        "baseRevision が不正です",
        requestId,
      );
    }

    const snapshot = await ports.store.getSnapshot(input.roomId);
    if (!snapshot) throw roomNotFound();

    // baseRevision 不一致の検査（古い版への代替案は発行せず破棄する。v5確定事項）
    if (snapshot.revision !== input.baseRevision) {
      throw revisionMismatch();
    }

    const meta = await ports.store.getDemoMeta(input.roomId);
    if (!meta) throw roomNotFound();
    if (!meta.isDemo) {
      throw new AiApiError(
        403,
        "not_a_demo_room",
        "デモモード固定応答はデモルーム限定です",
      );
    }

    // 入力照合・正規化・applyChanges・再検証を通した固定代替案の生成
    const proposal = buildDemoProposal(
      snapshot,
      meta,
      undefined,
      (snap) => ports.validation.validate(snap),
    );

    return {
      status: 200,
      body: {
        proposals: [proposal],
        baseRevision: snapshot.revision,
        demo: true,
      },
    };
  } catch (error) {
    return toErrorResult(error, requestId);
  }
}

// ---------------------------------------------------------------------------
// 5. デモモード固定構造化下書き
// ---------------------------------------------------------------------------

export interface DemoStructureHandlerInput {
  idToken: string | null;
  roomId: string;
}

export async function handleDemoStructureRequest(
  ports: DemoPorts,
  input: DemoStructureHandlerInput,
): Promise<DemoHandlerResult> {
  const requestId = crypto.randomUUID();
  try {
    await requireFamilyUid(ports, input.idToken, input.roomId);

    const meta = await ports.store.getDemoMeta(input.roomId);
    if (!meta) throw roomNotFound();
    if (!meta.isDemo) {
      throw new AiApiError(
        403,
        "not_a_demo_room",
        "デモモード固定応答はデモルーム限定です",
      );
    }

    const draft = buildDemoStructureDraft();
    return {
      status: 200,
      body: draft,
    };
  } catch (error) {
    return toErrorResult(error, requestId);
  }
}
