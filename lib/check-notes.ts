/**
 * サービス利用時の確認事項・制度上の注記（課題3）。
 *
 * 単位数マスター（data/units.json）や検証ロジック（lib/validation.ts）には含めず、
 * 制度上の前提条件や面談時の確認ポイントを「情報提供」として表示するための純粋モジュール。
 *
 * 注意：この注記は検証結果（ok判定）や確定の可否には絶対に影響させない。
 */

import type { Placement } from "./types";

export interface CheckNoteItem {
  id: string;
  placementId: string;
  kind: Placement["kind"];
  title: string;
  text: string;
}

export const CHECK_NOTE_TEXTS = {
  dayrehab: "通所リハビリの利用には医師の指示が必要です。面談で確認してください",
  daycare2to3: "2〜3時間の区分は、利用者の状態によって使える条件があります。面談で確認してください",
} as const;

/**
 * 単一の配置に対する注記テキストの一覧を返す。
 * - 通所リハビリ（kind=dayrehab）: 医師の指示が必要
 * - 通所介護（kind=daycare）で 2〜3時間区分（所要時間が2時間）: 状態による条件あり
 */
export function getCheckNotesForPlacement(placement: Placement): string[] {
  const notes: string[] = [];

  if (placement.kind === "dayrehab") {
    notes.push(CHECK_NOTE_TEXTS.dayrehab);
  }

  // 通所介護（daycare）で 2〜3時間区分（半開区間で endHour - startHour === 2）
  if (placement.kind === "daycare") {
    const durationHours = placement.endHour - placement.startHour;
    if (durationHours === 2) {
      notes.push(CHECK_NOTE_TEXTS.daycare2to3);
    }
  }

  return notes;
}

/**
 * 複数の配置から該当する注記の一覧を抽出して返す。
 */
export function getCheckNoteItems(placements: readonly Placement[]): CheckNoteItem[] {
  const items: CheckNoteItem[] = [];
  const seenNotes = new Set<string>();

  for (const p of placements) {
    const notes = getCheckNotesForPlacement(p);
    for (const note of notes) {
      if (seenNotes.has(note)) continue;
      seenNotes.add(note);

      const isRehab = note === CHECK_NOTE_TEXTS.dayrehab;
      items.push({
        id: `${p.id}-${isRehab ? "dayrehab" : "daycare2to3"}`,
        placementId: p.id,
        kind: p.kind,
        title: isRehab ? "通所リハビリの確認事項" : "通所介護（2〜3時間）の確認事項",
        text: note,
      });
    }
  }

  return items;
}
