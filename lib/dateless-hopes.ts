import type { ConstraintDraft } from "./types";

/**
 * 曜日も時刻もない「希望（hope）」かどうかを判定する。
 */
export function isDatelessHopeDraft(
  draft: Pick<ConstraintDraft, "type" | "days" | "startHour" | "endHour">,
): boolean {
  return (
    draft.type === "hope" &&
    draft.days.length === 0 &&
    draft.startHour === undefined &&
    draft.endHour === undefined
  );
}

/**
 * 曜日・時刻がない希望（hope）は条件カードに入れず、
 * 下の「家族の希望（自由記述）」の一覧へ移す。
 */
export function separateDatelessHopes<T extends Pick<ConstraintDraft, "type" | "days" | "startHour" | "endHour" | "detail">>(
  drafts: readonly T[],
  existingHopes: readonly string[],
): { drafts: T[]; hopes: string[] } {
  const keptDrafts: T[] = [];
  const hopes = [...existingHopes];

  for (const draft of drafts) {
    if (isDatelessHopeDraft(draft)) {
      const detail = draft.detail.trim();
      if (detail !== "" && !hopes.includes(detail)) {
        hopes.push(detail);
      }
    } else {
      keptDrafts.push(draft);
    }
  }

  return { drafts: keptDrafts, hopes };
}
