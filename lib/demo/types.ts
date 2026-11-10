/**
 * デモデータ投入・リセット＋デモモード（Issue 15）の型定義。
 *
 * lib/types.ts の型・シグネチャは変更せず、デモ専用の型・定数をここに置く。
 */

import type {
  CareWindow,
  Constraint,
  CopayRate,
  Person,
  Placement,
  Proposal,
  ProposalChange,
  RoomDoc,
  RoomSnapshot,
  ValidationResult,
} from "../types";
import type { StructureDraftResult } from "../ai/structureNormalize";

/**
 * 初回に生成した sourcePersonId（fixture 内のID）→ roomPersonId（ルーム内のPerson ID）の対応。
 * デモルーム作成時に生成・保存し、以後変更不可とする。
 */
export type PersonMapping = Record<string, string>;

/**
 * デモルームのメタ情報。
 * rooms/{roomId} 本体に保存される属性の一部。
 */
export interface DemoRoomMeta {
  roomId: string;
  creatorUid: string;
  isDemo: boolean;
  revision: number;
  fixtureVersion: string;
  personMapping: PersonMapping;
  careWindows: CareWindow[];
  copayRate: CopayRate;
}

/**
 * rooms/{roomId} ドキュメントのデモルーム用形状。
 */
export interface DemoRoomDoc extends RoomDoc {
  isDemo: true;
  fixtureVersion: string;
  personMapping: PersonMapping;
}

/** デモルーム作成オプション */
export interface CreateDemoRoomInput {
  /**
   * 初期状態：
   * - "troubled": fixture の「揉めるプラン」と制約を投入済みで作成する（既定）
   * - "empty": 人物のみ作成し、配置と制約は空（入力画面から通しで流す場合用）
   */
  initialState?: "troubled" | "empty";
  /** テスト用に人物ID採番関数を差し替え可能にする（既定は crypto.randomUUID()） */
  idGenerator?: (sourceId: string) => string;
}

/** 入力スナップショットの照合結果 */
export type SnapshotMatchResult =
  | { matched: true }
  | { matched: false; reason: string; field?: string };

/** デモ用固定代替案（印付き） */
export type DemoProposalResult = Proposal & {
  demo: true;
  validation: ValidationResult;
};

/** デモ用固定構造化下書き（印付き） */
export type DemoStructureResult = StructureDraftResult & { demo: true };
