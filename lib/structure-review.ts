/**
 * 入力確認画面のフォームロジック（Issue 7）。
 *
 * 構造化 API（POST /api/structure）が返した下書き（ConstraintDraft）を、
 * 家族が確認・修正し、保存 API（POST /api/structure/save）へ送れる形にする
 * ための純粋関数群。画面（InputClient）から分離してテスト可能にしている。
 *
 * 信頼境界（共通前提・Issue 7）：
 * - personId への結びつけは利用者が明示的に選んだ値だけを採用する。
 *   memberName（名前）が people の名前と完全一致しても、自動では結びつけない
 *   （同名・表記ゆれでの誤判定を防ぐため。このモジュールにも名前照合の
 *   コードは存在しない）
 * - 保存ペイロードのキー集合は保存 API の許可項目（DRAFT_KEYS）に一致させる
 *   （余分なキーはサーバーが 400 で拒否する）
 * - 時刻規則：制約は整数時間で 0≦startHour＜endHour≦24。unavailable は
 *   days 非空・時刻が必須。careWindows は 6≦startHour＜endHour≦24（ボードの範囲）
 */

import {
  BOARD_END_HOUR,
  BOARD_START_HOUR,
  type CareWindow,
  type ConstraintDraft,
  type ConstraintType,
  type CopayRate,
  type DayIndex,
  type Person,
  type RoomSnapshot,
} from "./types";
import {
  normalizeSavedConstraintType,
  type StructureDraftResult,
} from "./ai/structureNormalize";

/**
 * 確認画面で編集中の下書き1件。
 * personId は結びつけ用に下書きへ加えた項目で、未選択は ""（空文字）。
 * memberName は AI の読み取り名（保存時の控え用。画面には直接表示しない）。
 * manualPersonId / manualType は利用者が手動で選択したことを示すUI用フラグ。
 */
export interface ReviewDraft extends ConstraintDraft {
  personId: string;
  manualPersonId?: boolean;
  manualType?: boolean;
}

/** 手動追加用の空の下書き */
export function emptyReviewDraft(): ReviewDraft {
  return {
    memberName: "",
    type: "other",
    detail: "",
    days: [],
    personId: "",
  };
}

/**
 * 名前が一意に一致する場合だけ personId を返す。
 * - people 内に同名の人が複数いる場合は一意でないため "" を返す
 * - memberName が一意な家族名と完全一致すればその personId を返す
 * - memberName で決まらない場合、memberName または detail に含まれる家族名が
 *   ルーム内でただ1人（かつ同名重複なし）のときだけその personId を返す
 * - 不明・複数該当・自信がない場合は ""（未選択）を返す
 */
export function resolveUniquePersonId(
  draft: { memberName?: string; detail?: string },
  people?: readonly Person[],
): string {
  if (!people || people.length === 0) return "";

  const nameCounts = new Map<string, number>();
  for (const person of people) {
    const name = person.name.trim();
    if (name !== "") {
      nameCounts.set(name, (nameCounts.get(name) ?? 0) + 1);
    }
  }

  const rawMemberName = (draft.memberName ?? "").trim();
  if (rawMemberName !== "") {
    const exactMatches = people.filter((p) => p.name.trim() === rawMemberName);
    if (exactMatches.length === 1) {
      return exactMatches[0].id;
    }
    if (exactMatches.length > 1) {
      return "";
    }

    const containedInMemberName = people.filter((p) => {
      const name = p.name.trim();
      return name !== "" && rawMemberName.includes(name);
    });
    if (
      containedInMemberName.length === 1 &&
      nameCounts.get(containedInMemberName[0].name.trim()) === 1
    ) {
      return containedInMemberName[0].id;
    }
    if (containedInMemberName.length > 1) {
      return "";
    }
  }

  const detailText = (draft.detail ?? "").trim();
  if (detailText !== "") {
    const containedInDetail = people.filter((p) => {
      const name = p.name.trim();
      return name !== "" && detailText.includes(name);
    });
    if (
      containedInDetail.length === 1 &&
      nameCounts.get(containedInDetail[0].name.trim()) === 1
    ) {
      return containedInDetail[0].id;
    }
  }

  return "";
}

/**
 * 内容（detail）から分類（ConstraintType）が明らかな場合に推定する。
 * 既に unavailable / hope が指定されている場合はそれを維持する。
 */
export function inferConstraintTypeFromDetail(
  detail: string,
  currentType: ConstraintType = "other",
): ConstraintType {
  if (currentType !== "other") return currentType;
  const text = detail.trim();
  if (text === "") return "other";

  if (
    /(仕事|勤務|出勤|就業|フルタイム|夜勤|残業|対応不可|付き添い不可|無理|来られない|通院|外出|不在|難しい|困難)/.test(
      text,
    )
  ) {
    return "unavailable";
  }
  if (/(希望|要望|したい|たい|見守りたい|過ごしたい)/.test(text)) {
    return "hope";
  }
  return "other";
}

/**
 * 構造化 API の結果を編集中の下書きへ変換する。
 * people が渡された場合は、名前が一意に一致する対象だけ自動で personId をセットし、
 * 不明・同名重複・複数該当のものは未選択（""）にする。
 */
export function reviewDraftsFromStructureResult(
  result: StructureDraftResult,
  people?: readonly Person[],
): ReviewDraft[] {
  return result.constraints.map((draft) => {
    const personId = resolveUniquePersonId(draft, people);
    const hasHoursAndDays =
      draft.days.length > 0 &&
      draft.startHour !== undefined &&
      draft.endHour !== undefined;
    const normalizedType = normalizeSavedConstraintType(draft.type);
    const type =
      normalizedType === "other" && hasHoursAndDays
        ? inferConstraintTypeFromDetail(draft.detail, normalizedType)
        : normalizedType;
    return {
      ...draft,
      type,
      personId,
    };
  });
}

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
export function separateDatelessHopes(
  drafts: readonly ReviewDraft[],
  existingHopes: readonly string[],
): { drafts: ReviewDraft[]; hopes: string[] } {
  const keptDrafts: ReviewDraft[] = [];
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

/**
 * 保存済みの入力一式から編集中の下書きを作る（画面の初期表示用）。
 * 保存済みの制約は personId を既に持つため、その値をそのまま引き継ぐ
 * （名前からの推測ではなく、保存値の復元）。
 * memberName は表示用に、その人の現在の名前を入れる。
 */
export function reviewDraftsFromSnapshot(
  snapshot: RoomSnapshot,
): ReviewDraft[] {
  const nameById = new Map(snapshot.people.map((p) => [p.id, p.name]));
  return snapshot.constraints.map((constraint) => ({
    memberName: nameById.get(constraint.personId) ?? "",
    type: normalizeSavedConstraintType(constraint.type),
    detail: constraint.detail,
    days: [...constraint.days],
    ...(constraint.startHour !== undefined
      ? { startHour: constraint.startHour, endHour: constraint.endHour }
      : {}),
    personId: constraint.personId,
  }));
}

/** 時刻必須の種別（対応不可）かどうか */
function isTimedType(type: ReviewDraft["type"]): boolean {
  return type === "unavailable";
}

function isValidDay(day: number): boolean {
  return Number.isInteger(day) && day >= 0 && day <= 6;
}

function hourPairError(
  draft: ReviewDraft,
  required: boolean,
): string | null {
  const hasStart = draft.startHour !== undefined;
  const hasEnd = draft.endHour !== undefined;
  if (hasStart !== hasEnd) {
    return "時刻は開始と終了をそろえて指定してください";
  }
  if (!hasStart) {
    return required ? "この種別には時刻が必須です" : null;
  }
  const { startHour, endHour } = draft;
  if (
    !Number.isInteger(startHour) ||
    !Number.isInteger(endHour) ||
    !(startHour! >= 0 && startHour! < endHour! && endHour! <= 24)
  ) {
    return "時刻は 0時〜24時 の範囲で、開始＜終了にしてください";
  }
  return null;
}

/** 下書き1件の検証。問題がなければ空配列を返す */
export function validateReviewDraft(draft: ReviewDraft): string[] {
  const errors: string[] = [];
  if (draft.detail.trim() === "") {
    errors.push("内容が空です");
  }
  if (draft.days.some((day) => !isValidDay(day))) {
    errors.push("曜日が不正です");
  }
  const timed = isTimedType(draft.type);
  if (timed && draft.days.length === 0) {
    errors.push("この種別には曜日が必須です");
  }
  const hourError = hourPairError(draft, timed);
  if (hourError) {
    errors.push(hourError);
  }
  return errors;
}

/** personId が未結びつけの下書きの件数 */
export function unboundDraftCount(drafts: readonly ReviewDraft[]): number {
  return drafts.filter((draft) => draft.personId === "").length;
}

/**
 * 構造化結果を保存できる状態かどうか。
 * 全件が personId に結びつき、形式検証を通っている場合だけ true。
 * 制約が0件の場合は（hopes／unknowns のみの更新として）保存できる。
 */
export function canSubmitStructure(drafts: readonly ReviewDraft[]): boolean {
  return drafts.every(
    (draft) =>
      draft.personId !== "" && validateReviewDraft(draft).length === 0,
  );
}

/**
 * 保存 API へ送る constraints の形に変換する。
 * キーは保存 API の許可項目だけにし、時刻はそろっている場合だけ含める。
 * memberName が空の手動行は、表示用の控えとして結びつけた人の名前で補う
 * （personId の決定には一切使わない）。
 */
export function toStructureSaveConstraints(
  drafts: readonly ReviewDraft[],
  peopleNames: ReadonlyMap<string, string>,
): Array<ConstraintDraft & { personId: string }> {
  return drafts.map((draft) => ({
    memberName:
      draft.memberName !== ""
        ? draft.memberName
        : (peopleNames.get(draft.personId) ?? ""),
    type: draft.type,
    detail: draft.detail,
    days: [...draft.days],
    ...(draft.startHour !== undefined && draft.endHour !== undefined
      ? { startHour: draft.startHour, endHour: draft.endHour }
      : {}),
    personId: draft.personId,
  }));
}

/** careWindows 1件の検証。問題がなければ null */
export function validateCareWindow(window: CareWindow): string | null {
  if (!isValidDay(window.day)) {
    return "曜日が不正です";
  }
  const { startHour, endHour } = window;
  if (!Number.isInteger(startHour) || !Number.isInteger(endHour)) {
    return "時刻は整数で指定してください";
  }
  if (
    !(
      startHour >= BOARD_START_HOUR &&
      startHour < endHour &&
      endHour <= BOARD_END_HOUR
    )
  ) {
    return `時刻は ${BOARD_START_HOUR}時〜${BOARD_END_HOUR}時 の範囲で、開始＜終了にしてください`;
  }
  return null;
}

/** careWindows 一式の検証。問題のある行のメッセージを返す */
export function validateCareWindows(
  windows: readonly CareWindow[],
): string[] {
  const errors: string[] = [];
  windows.forEach((window, i) => {
    const error = validateCareWindow(window);
    if (error) {
      errors.push(`${i + 1}件目：${error}`);
    }
  });
  return errors;
}

/**
 * 入力画面で編集中の「介護が必要な時間帯」1行。
 * 追加直後の未入力状態では day / startHour / endHour が ""（空文字）になる。
 */
export interface CareWindowDraft {
  id: string;
  day: DayIndex | "";
  startHour: number | "";
  endHour: number | "";
}

/** 時間帯の行が曜日・開始時刻・終了時刻すべて選択済みかどうか */
export function isCareWindowDraftComplete(
  draft: CareWindowDraft,
): draft is CareWindowDraft & {
  day: DayIndex;
  startHour: number;
  endHour: number;
} {
  return (
    draft.day !== "" && draft.startHour !== "" && draft.endHour !== ""
  );
}

/**
 * 未入力の行を一番上に表示し、日時を選んだ行は曜日・開始時刻・終了時刻の昇順に並び替える。
 */
export function sortCareWindowDrafts(
  drafts: readonly CareWindowDraft[],
): CareWindowDraft[] {
  const incomplete: CareWindowDraft[] = [];
  const complete: Array<
    CareWindowDraft & { day: DayIndex; startHour: number; endHour: number }
  > = [];

  for (const d of drafts) {
    if (isCareWindowDraftComplete(d)) {
      complete.push(d);
    } else {
      incomplete.push(d);
    }
  }

  complete.sort(
    (a, b) =>
      a.day - b.day || a.startHour - b.startHour || a.endHour - b.endHour,
  );

  return [...incomplete, ...complete];
}

/** 新規追加用の未入力の時間帯行を作る */
export function createEmptyCareWindowDraft(
  id: string = crypto.randomUUID(),
): CareWindowDraft {
  return {
    id,
    day: "",
    startHour: "",
    endHour: "",
  };
}

/** 時間帯を追加する（未入力の行を一番上に追加する） */
export function prependEmptyCareWindowDraft(
  drafts: readonly CareWindowDraft[],
  id: string = crypto.randomUUID(),
): CareWindowDraft[] {
  return [createEmptyCareWindowDraft(id), ...drafts];
}

/** 保存済みの CareWindow[] からソート済みの CareWindowDraft[] を作る */
export function careWindowDraftsFromWindows(
  windows: readonly CareWindow[],
): CareWindowDraft[] {
  const drafts: CareWindowDraft[] = windows.map((w, i) => ({
    id: `cw-${i}-${w.day}-${w.startHour}-${w.endHour}`,
    day: w.day,
    startHour: w.startHour,
    endHour: w.endHour,
  }));
  return sortCareWindowDrafts(drafts);
}

/**
 * CareWindowDraft[] 一式の検証。
 * 未入力の行がある場合や、時刻範囲が不正な行がある場合はエラーメッセージを返す。
 */
export function validateCareWindowDrafts(
  drafts: readonly CareWindowDraft[],
): string[] {
  const errors: string[] = [];
  drafts.forEach((draft, i) => {
    if (!isCareWindowDraftComplete(draft)) {
      errors.push(
        `${i + 1}件目：曜日・開始時刻・終了時刻をすべて選択してください`,
      );
      return;
    }
    const err = validateCareWindow({
      day: draft.day,
      startHour: draft.startHour,
      endHour: draft.endHour,
    });
    if (err) {
      errors.push(`${i + 1}件目：${err}`);
    }
  });
  return errors;
}

/** 検証済みの CareWindowDraft[] を保存用の CareWindow[]（曜日・時刻順）に変換する */
export function toCareWindows(
  drafts: readonly CareWindowDraft[],
): CareWindow[] {
  return sortCareWindowDrafts(drafts)
    .filter(isCareWindowDraftComplete)
    .map((d) => ({
      day: d.day,
      startHour: d.startHour,
      endHour: d.endHour,
    }));
}

/**
 * 画面遷移しても未保存の入力（事情メモ・Geminiの整理・時間帯・負担割合）が
 * 失われないように保持するルーム別下書きデータ。
 */
export interface InputScreenDraft {
  memo: string;
  drafts: ReviewDraft[];
  hopesText: string;
  unknownsText: string;
  careWindowDrafts: CareWindowDraft[];
  copayRate: CopayRate;
  /** 入力項目に未保存の変更があるか */
  dirty: boolean;
}

const INPUT_DRAFT_KEY_PREFIX = "carepact:input_draft:";
const memoryDraftStore = new Map<string, InputScreenDraft>();

export function getInputScreenDraft(roomId: string): InputScreenDraft | null {
  const inMemory = memoryDraftStore.get(roomId);
  if (inMemory) {
    return inMemory;
  }
  if (typeof window === "undefined" || !window.localStorage) {
    return null;
  }
  try {
    const raw = window.localStorage.getItem(`${INPUT_DRAFT_KEY_PREFIX}${roomId}`);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<InputScreenDraft>;
    if (!parsed || typeof parsed !== "object") return null;
    const restored: InputScreenDraft = {
      memo: typeof parsed.memo === "string" ? parsed.memo : "",
      drafts: Array.isArray(parsed.drafts)
        ? parsed.drafts.map((d) => ({
            ...d,
            type: normalizeSavedConstraintType((d as { type?: unknown })?.type),
          }))
        : [],
      hopesText: typeof parsed.hopesText === "string" ? parsed.hopesText : "",
      unknownsText:
        typeof parsed.unknownsText === "string" ? parsed.unknownsText : "",
      careWindowDrafts: Array.isArray(parsed.careWindowDrafts)
        ? parsed.careWindowDrafts
        : [],
      copayRate:
        parsed.copayRate === 1 || parsed.copayRate === 2 || parsed.copayRate === 3
          ? parsed.copayRate
          : 1,
      dirty: Boolean(parsed.dirty),
    };
    memoryDraftStore.set(roomId, restored);
    return restored;
  } catch {
    return null;
  }
}

export function saveInputScreenDraft(
  roomId: string,
  draft: InputScreenDraft,
): void {
  const normalizedDraft: InputScreenDraft = {
    ...draft,
    drafts: draft.drafts.map((d) => ({
      ...d,
      type: normalizeSavedConstraintType(d.type),
    })),
  };
  memoryDraftStore.set(roomId, normalizedDraft);
  if (typeof window === "undefined" || !window.localStorage) {
    return;
  }
  try {
    window.localStorage.setItem(
      `${INPUT_DRAFT_KEY_PREFIX}${roomId}`,
      JSON.stringify(normalizedDraft),
    );
  } catch {
    // localStorage が使えない環境ではメモリ保持のみ
  }
}

export function clearInputScreenDraft(roomId?: string): void {
  if (roomId !== undefined) {
    memoryDraftStore.delete(roomId);
    if (typeof window !== "undefined" && window.localStorage) {
      try {
        window.localStorage.removeItem(`${INPUT_DRAFT_KEY_PREFIX}${roomId}`);
      } catch {
        // ignore
      }
    }
    return;
  }
  memoryDraftStore.clear();
  if (typeof window !== "undefined" && window.localStorage) {
    try {
      const keysToRemove: string[] = [];
      for (let i = 0; i < window.localStorage.length; i++) {
        const key = window.localStorage.key(i);
        if (key && key.startsWith(INPUT_DRAFT_KEY_PREFIX)) {
          keysToRemove.push(key);
        }
      }
      for (const k of keysToRemove) {
        window.localStorage.removeItem(k);
      }
    } catch {
      // ignore
    }
  }
}

/** hopes／unknowns の表示用（1行＝1件） */
export function listToLines(items: readonly string[]): string {
  return items.join("\n");
}

/** hopes／unknowns の入力欄から保存用リストへ（空行は除く。サーバー側の正規化と同じ） */
export function linesToList(text: string): string[] {
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "");
}

/** 曜日の表示名（月=0〜日=6） */
export const DAY_LABELS = ["月", "火", "水", "木", "金", "土", "日"] as const;

export type { DayIndex };
