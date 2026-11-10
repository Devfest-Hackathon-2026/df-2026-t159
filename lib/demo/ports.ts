/**
 * デモ機能のポート定義（Issue 15）。
 *
 * lib/ai/ports.ts や lib/plan/ports.ts と同じ方針で、
 * 外部（Firestore・Auth・Membership・検証エンジン）をポートで抽象化し、
 * テストでフェイク実装を差せるようにする。
 */

import type { AuthPort, MembershipPort, ValidationPort } from "../ai/ports";
import type { RoomSnapshot } from "../types";
import type { CreateDemoRoomInput, DemoRoomMeta, PersonMapping } from "./types";

/**
 * デモルームのデータ永続化ポート。
 * Firestore Admin SDK 実装とメモリ上の Fake 実装を用意する。
 */
export interface DemoStorePort {
  /** デモルームのメタ情報（isDemo・creatorUid・人物ID対応など）を取得する */
  getDemoMeta(roomId: string): Promise<DemoRoomMeta | null>;

  /** 整合スナップショットを取得する */
  getSnapshot(roomId: string): Promise<RoomSnapshot | null>;

  /**
   * fixture から専用の作成操作でデモルームを作成する。
   * 初回に生成した sourcePersonId→roomPersonId の対応を保存し、以後変更不可とする。
   */
  createDemoRoom(
    creatorUid: string,
    input?: CreateDemoRoomInput,
  ): Promise<{ roomId: string; personMapping: PersonMapping }>;

  /**
   * デモルームを初期値へリセットする。
   * - デモ用ルーム限定（isDemo）
   * - ルーム作成者のみ実行可（creatorUid 一致を保存処理でも確認）
   * - 保持：members・people・人物対応・creatorUid・コメント
   * - 復元：配置・constraints・hopes・unknowns・careWindows・負担割合
   * - 削除：summary
   * - 全計算入力と revision の +1 を一括保存し、revision を 0 に戻さない
   */
  resetDemoRoom(
    roomId: string,
    callerUid: string,
  ): Promise<{ revision: number }>;

  /**
   * デモルームに「揉めるプラン」を明示操作で読み込む（投入）。
   * 全計算入力と revision の +1 を保存する。
   */
  seedTroubledPlan(
    roomId: string,
    callerUid: string,
  ): Promise<{ revision: number }>;
}

/**
 * デモ機能ハンドラが受け取る Ports 一式。
 */
export interface DemoPorts {
  auth: AuthPort;
  membership: MembershipPort;
  store: DemoStorePort;
  validation: ValidationPort;
}
