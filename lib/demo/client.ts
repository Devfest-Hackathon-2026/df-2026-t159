/**
 * デモ機能のクライアントヘルパー（Issue 15）。
 *
 * デモルームの作成・リセット・デモモード固定応答の取得を行う最小のヘルパー群。
 */

import type { DemoProposalResult, DemoStructureResult, PersonMapping } from "./types";

export interface CreateDemoRoomClientOptions {
  initialState?: "troubled" | "empty";
}

export interface DemoClientError {
  error: string;
  message: string;
}

async function handleResponse<T>(res: Response): Promise<T> {
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const errorObj = data as DemoClientError;
    throw new Error(errorObj.message || errorObj.error || `HTTP ${res.status}`);
  }
  return data as T;
}

/**
 * デモルームを作成する。
 * POST /api/rooms/demo
 */
export async function createDemoRoomClient(
  idToken: string,
  options?: CreateDemoRoomClientOptions,
): Promise<{ roomId: string; personMapping: PersonMapping }> {
  const res = await fetch("/api/rooms/demo", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${idToken}`,
    },
    body: JSON.stringify(options ?? {}),
  });
  return handleResponse<{ roomId: string; personMapping: PersonMapping }>(res);
}

/**
 * デモルームを固定初期値へリセットする。
 * POST /api/rooms/[roomId]/reset
 */
export async function resetDemoRoomClient(
  idToken: string,
  roomId: string,
): Promise<{ reset: boolean; revision: number }> {
  const res = await fetch(`/api/rooms/${encodeURIComponent(roomId)}/reset`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${idToken}`,
    },
  });
  return handleResponse<{ reset: boolean; revision: number }>(res);
}

/**
 * デモルームに「揉めるプラン」の初期配置を投入する。
 * POST /api/rooms/[roomId]/demo-seed
 */
export async function seedDemoTroubledPlanClient(
  idToken: string,
  roomId: string,
): Promise<{ seeded: boolean; revision: number }> {
  const res = await fetch(`/api/rooms/${encodeURIComponent(roomId)}/demo-seed`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${idToken}`,
    },
  });
  return handleResponse<{ seeded: boolean; revision: number }>(res);
}

/**
 * デモモードの固定代替案を取得する。
 * POST /api/proposals (demo: true)
 */
export async function fetchDemoProposalsClient(
  idToken: string,
  roomId: string,
  baseRevision: number,
): Promise<{
  proposals: DemoProposalResult[];
  baseRevision: number;
  demo: true;
}> {
  const res = await fetch("/api/proposals", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${idToken}`,
    },
    body: JSON.stringify({
      roomId,
      baseRevision,
      demo: true,
    }),
  });
  return handleResponse<{
    proposals: DemoProposalResult[];
    baseRevision: number;
    demo: true;
  }>(res);
}

/**
 * デモモードの固定構造化下書きを取得する。
 * POST /api/structure (demo=true)
 */
export async function fetchDemoStructureClient(
  idToken: string,
  roomId: string,
): Promise<DemoStructureResult> {
  const form = new FormData();
  form.set("roomId", roomId);
  form.set("demo", "true");

  const res = await fetch("/api/structure", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${idToken}`,
    },
    body: form,
  });
  return handleResponse<DemoStructureResult>(res);
}
