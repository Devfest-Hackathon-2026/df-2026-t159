/**
 * Gemini 連携 API（Issue 7・8）が外部に依存する部分のインターフェース（接続点）。
 *
 * ハンドラ（handlers.ts）はこの型経由でだけ外部を呼ぶ。実物の差し込みは
 * lib/server/ports.ts で行う（Issue 7 本接続で Admin SDK ベースの実装に接続済み）。
 * 型を勝手に変えると接続点がずれるため、変更が必要な場合は Issue 2 と揃えること。
 *
 * 接続点の一覧と接続状況：
 * - AuthPort: Firebase Admin SDK の verifyIdToken（接続済み）
 * - MembershipPort: rooms/{roomId}/members/{uid} を Admin SDK で読む（接続済み）
 * - RoomReadPort: 整合スナップショット（revision 前後一致を確認した RoomSnapshot）を返す（接続済み）
 * - RateLimitPort: rooms/{roomId}/rateLimits のカウンターを transaction で予約する
 *   （ドキュメントIDは時間枠。構造化・代替案で共有し、処理失敗も1回に数える）（接続済み）
 * - RoomWritePort: commitRoomChange と同じ意味論の保存（Issue 7 の構造化結果の保存用）（接続済み）
 * - ValidationPort: Issue 6 の検証エンジン（lib/validation.ts の validateRoom 純粋関数）をそのまま差す（接続済み。Issue 8 本接続）
 * - GeminiPort: lib/server/gemini.ts の実装（@google/genai）を使う（接続済み）
 */

import type { Schema } from "@google/genai";
import type {
  MemberRole,
  RoomChange,
  RoomSnapshot,
  ValidationResult,
} from "../types";

/** Firebase ID トークンの検証。検証できなければ null */
export interface AuthPort {
  verifyIdToken(idToken: string): Promise<{ uid: string } | null>;
}

/** ルームの membership 照合。未参加なら null */
export interface MembershipPort {
  getRole(roomId: string, uid: string): Promise<MemberRole | null>;
}

/** 整合スナップショットの読み取り。ルームがなければ null */
export interface RoomReadPort {
  getSnapshot(roomId: string): Promise<RoomSnapshot | null>;
}

/**
 * Gemini 回数枠の事前予約（1ルーム1時間10回まで。構造化・代替案の合算）。
 * 予約できたら true、上限に達していたら false。
 * 実物は Firestore カウンターを transaction で予約する（lib/server/rate-limit.ts）。
 */
export interface RateLimitPort {
  reserve(roomId: string): Promise<boolean>;
}

/**
 * 入力の保存（commitRoomChange と同じ意味論）。
 * 全入力変更と revision の +1 を同一 transaction で保存し、
 * expectedRevision が一致しなければ RevisionConflictError、
 * ルームがなければ RoomNotFoundError を throw する（lib/room-change.ts）。
 * Issue 7 では構造化結果（personId に結びつけた制約一式）の保存に使う。
 */
export interface RoomWritePort {
  commitChange(
    roomId: string,
    expectedRevision: number,
    change: RoomChange,
  ): Promise<number>;
}

/** 検証エンジン（Issue 6 の純粋関数を差す想定） */
export interface ValidationPort {
  validate(snapshot: RoomSnapshot): ValidationResult;
}

/** Gemini へ渡す画像パート */
export interface GeminiImagePart {
  mimeType: string;
  dataBase64: string;
}

/**
 * Gemini 呼び出し。responseSchema で拘束した JSON をパースして返す。
 * JSON として読めなければ GeminiOutputParseError を throw する。
 */
export interface GeminiPort {
  generateJson(args: {
    prompt: string;
    images?: GeminiImagePart[];
    responseSchema: Schema;
    signal?: AbortSignal;
  }): Promise<unknown>;
}

/** Route Handler が使う接続点の一式 */
export interface ServerPorts {
  auth: AuthPort;
  membership: MembershipPort;
  rooms: RoomReadPort;
  rateLimit: RateLimitPort;
  roomWrite: RoomWritePort;
  validation: ValidationPort;
  gemini: GeminiPort;
}
