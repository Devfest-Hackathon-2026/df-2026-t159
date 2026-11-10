/**
 * Gemini 呼び出し回数枠の実物（Firestore カウンター。Issue 7 本接続）。
 *
 * 共通前提の契約：
 * - 構造化・代替案あわせて1ルームあたり1時間に10回まで
 * - 回数枠は Firestore の roomId×時間枠カウンターを transaction で
 *   「呼び出し前に予約」する（複数インスタンスでも上限を守る）
 * - 処理失敗も1回に数える（予約時点で消費する。再試行で枠は戻さない）
 * - カウンターは rooms/{roomId}/rateLimits/{時間枠} に置き、Client からの
 *   read/write は Firestore ルールで全面禁止（サーバー専用）
 *
 * 時間枠は UTC の正時区切り（ドキュメントIDは "2026-11-07T12" の形）。
 * テスト用フェイク（lib/ai/fakes.ts の FakeRateLimitPort）と同じ決め方に揃える。
 */

import { Timestamp } from "firebase-admin/firestore";
import { GEMINI_CALL_LIMIT_PER_HOUR } from "../ai/inputValidation";
import type { RateLimitPort } from "../ai/ports";
import { firestorePaths, type RateLimitDoc } from "../types";
import { adminDb } from "./firebase-admin";

/** 時間枠（UTC・1時間）のドキュメントID。フェイクと同じ形式に揃える */
export function rateLimitWindowKey(now: Date = new Date()): string {
  return now.toISOString().slice(0, 13); // 例: 2026-11-07T12
}

/** 時間枠の開始時刻（UTC の正時） */
export function rateLimitWindowStart(now: Date = new Date()): Date {
  const start = new Date(now);
  start.setUTCMinutes(0, 0, 0);
  return start;
}

/**
 * 予約可否の判定（純粋関数）。
 * 現在のカウント（ドキュメントがなければ null）から、予約できるかと
 * 予約後のドキュメント内容を決める。上限に達していたら allowed=false で、
 * ドキュメントは変更しない（next は null）。
 */
export function nextRateLimitState(
  current: Pick<RateLimitDoc, "count"> | null,
  limit: number = GEMINI_CALL_LIMIT_PER_HOUR,
): { allowed: boolean; nextCount: number | null } {
  const count = current?.count ?? 0;
  if (count >= limit) {
    return { allowed: false, nextCount: null };
  }
  return { allowed: true, nextCount: count + 1 };
}

/**
 * Firestore カウンターを transaction で事前予約する RateLimitPort 実装。
 * ドキュメントの読み取りと更新を同一 transaction で行うため、
 * 複数インスタンスからの同時呼び出しでも上限を超えて予約は通らない。
 */
export function createFirestoreRateLimitPort(
  limit: number = GEMINI_CALL_LIMIT_PER_HOUR,
  now: () => Date = () => new Date(),
): RateLimitPort {
  return {
    async reserve(roomId: string): Promise<boolean> {
      const db = adminDb();
      const at = now();
      const ref = db.doc(
        `${firestorePaths.rateLimits(roomId)}/${rateLimitWindowKey(at)}`,
      );
      return db.runTransaction(async (tx) => {
        const snap = await tx.get(ref);
        const current = snap.exists
          ? (snap.data() as unknown as RateLimitDoc)
          : null;
        const { allowed, nextCount } = nextRateLimitState(current, limit);
        if (!allowed || nextCount === null) {
          return false;
        }
        // RateLimitDoc の Timestamp は Client SDK 側の型のため、
        // Admin SDK の Timestamp で組み立てて保存する（保存値は同じ形）
        const doc: { count: number; windowStart: Timestamp } = {
          count: nextCount,
          windowStart: Timestamp.fromDate(rateLimitWindowStart(at)),
        };
        tx.set(ref, doc);
        return true;
      });
    },
  };
}
