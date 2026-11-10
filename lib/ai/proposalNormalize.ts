/**
 * Gemini 代替案（Issue 8）の出力の正規化・意味検査（純粋関数）。
 *
 * v5 で確定した正規化契約（共通前提「代替案（Gemini の出力と正規化）」）を実装する：
 * - baseRevision は AI が返した値を捨て、リクエストに使った整合スナップショットの
 *   revision をサーバー（この関数）が付ける
 * - add の新規IDはサーバーがパース直後に crypto.randomUUID() で一度だけ採番する。
 *   responseSchema には move／resize／remove 用に placementId を残すが、
 *   add に placementId が含まれていても無視してサーバー採番値を使う
 *   （試し適用と採用で同じIDを使うため、採番はここで1回だけ）
 * - action 別の許可項目：remove=placementId のみ／move=placementId＋day・startHour
 *   （終了時刻は元の長さから算出）／resize=placementId＋startHour・endHour／
 *   add=配置に必要な全項目。kind の変更は remove＋add で表す
 * - 未知ID・同一IDへの複数操作・削除済みIDへの操作・余分なキー・
 *   kind と serviceId／personId の不整合は拒否する（NormalizeError）
 * - 案は最大3件（Issue 8 の上限）。4件以上返ってきたら先頭3件を採用し、残りは捨てる
 *
 * ここで検査しないもの（担当が別）：
 * - family の add で personId が canProvideCare=false の人を指す場合
 *   → 検証エンジン（Issue 6）が ineligibleCareProvider として判定する
 * - serviceId が単位数マスター（Issue 5）に実在するか
 *   → エンジン側の検証（unsupportedBand 等）に委ね、ここでは非空のみ検査する
 */

import type {
  DayIndex,
  Placement,
  PlacementKind,
  Proposal,
  ProposalChange,
} from "../types";
import {
  NormalizeError,
  assertAllowedKeys,
  assertBoardTimeRange,
  asInt,
  asString,
  fail,
  isRecord,
  stripNulls,
} from "./normalizeUtil";

export { NormalizeError };

/** 代替案の最大件数（Issue 8） */
export const MAX_PROPOSALS = 3;
/** 1案あたりの変更の最大件数 */
export const MAX_CHANGES_PER_PROPOSAL = 50;
/** summary の最大文字数 */
export const MAX_SUMMARY_CHARS = 200;

const PLACEMENT_KINDS: readonly PlacementKind[] = [
  "visit",
  "daycare",
  "dayrehab",
  "shortstay",
  "family",
];

const CHANGE_KEYS = [
  "placementId",
  "action",
  "day",
  "startHour",
  "endHour",
  "kind",
  "serviceId",
  "personId",
] as const;

export interface ProposalNormalizeContext {
  /** 現在の配置（未知ID検査と move の長さ算出に使う） */
  placements: Placement[];
  /** 家族（add の personId の実在検査に使う）。id だけでもよい */
  people: readonly { id: string }[];
  /** 整合スナップショットの revision。AI の値は捨て、これを付ける */
  baseRevision: number;
  /** add のID採番（既定は crypto.randomUUID）。テスト用に差し替え可能 */
  newId?: () => string;
}

function assertOnlyKeys(
  obj: Record<string, unknown>,
  allowed: readonly string[],
  where: string,
): void {
  for (const key of Object.keys(obj)) {
    if (!allowed.includes(key)) {
      fail(`${where} の action では項目「${key}」は使えません`);
    }
  }
}

function asDay(value: unknown, where: string): number {
  const day = asInt(value, where);
  if (day < 0 || day > 6) {
    fail(`${where} は 0〜6 の曜日でなければなりません`);
  }
  return day;
}

function asNonEmptyString(value: unknown, where: string): string {
  const text = asString(value, where, 200);
  if (text.trim() === "") {
    fail(`${where} が空です`);
  }
  return text;
}

interface ChangeState {
  /** この案ですでに操作した配置ID（同一IDへの複数操作・削除済みIDへの操作を拒否する） */
  operated: Set<string>;
}

function normalizeChange(
  value: unknown,
  index: number,
  proposalIndex: number,
  ctx: ProposalNormalizeContext,
  placementById: ReadonlyMap<string, Placement>,
  peopleIds: ReadonlySet<string>,
  state: ChangeState,
): ProposalChange {
  const where = `proposals[${proposalIndex}].changes[${index}]`;
  if (!isRecord(value)) {
    fail(`${where} はオブジェクトでなければなりません`);
  }
  const obj = stripNulls(value);
  assertAllowedKeys(obj, CHANGE_KEYS, where);

  const action = obj.action;
  if (
    action !== "move" &&
    action !== "resize" &&
    action !== "add" &&
    action !== "remove"
  ) {
    fail(`${where} の action が不正です`);
  }

  if (action === "add") {
    // add の placementId は無視する（サーバーが採番する。v5確定事項）
    assertOnlyKeys(
      obj,
      ["placementId", "action", "day", "startHour", "endHour", "kind", "serviceId", "personId"],
      where,
    );
    const day = asDay(obj.day, `${where} の day`);
    const startHour = asInt(obj.startHour, `${where} の startHour`);
    const endHour = asInt(obj.endHour, `${where} の endHour`);
    assertBoardTimeRange(startHour, endHour, where);
    const kind = obj.kind;
    if (
      typeof kind !== "string" ||
      !(PLACEMENT_KINDS as readonly string[]).includes(kind)
    ) {
      fail(`${where} の kind が不正です`);
    }
    if (kind === "family") {
      if ("serviceId" in obj) {
        fail(`${where}（family）では serviceId は使えません`);
      }
      const personId = asNonEmptyString(obj.personId, `${where} の personId`);
      if (!peopleIds.has(personId)) {
        fail(`${where} の personId が家族に存在しません`);
      }
      return {
        action: "add",
        placementId: (ctx.newId ?? (() => crypto.randomUUID()))(),
        day: day as DayIndex,
        startHour,
        endHour,
        kind: "family",
        personId,
      };
    }
    if ("personId" in obj) {
      fail(`${where}（${kind}）では personId は使えません`);
    }
    const serviceId = asNonEmptyString(obj.serviceId, `${where} の serviceId`);
    return {
      action: "add",
      placementId: (ctx.newId ?? (() => crypto.randomUUID()))(),
      day: day as DayIndex,
      startHour,
      endHour,
      kind: kind as PlacementKind,
      serviceId,
    };
  }

  // remove／move／resize は対象の配置が必須
  const placementId = asNonEmptyString(obj.placementId, `${where} の placementId`);
  const target = placementById.get(placementId);
  if (!target) {
    fail(`${where} の placementId が現在の配置に存在しません`);
  }
  if (state.operated.has(placementId)) {
    fail(`${where} の placementId はこの案ですでに操作されています`);
  }
  state.operated.add(placementId);

  if (action === "remove") {
    assertOnlyKeys(obj, ["placementId", "action"], where);
    return { action: "remove", placementId };
  }

  if (action === "move") {
    assertOnlyKeys(obj, ["placementId", "action", "day", "startHour"], where);
    const day = asDay(obj.day, `${where} の day`);
    const startHour = asInt(obj.startHour, `${where} の startHour`);
    // 終了時刻は元の長さから算出する（元の長さを保ったまま移動できるか検査する）
    const duration = target.endHour - target.startHour;
    assertBoardTimeRange(startHour, startHour + duration, where);
    return {
      action: "move",
      placementId,
      day: day as DayIndex,
      startHour,
    };
  }

  // resize
  assertOnlyKeys(obj, ["placementId", "action", "startHour", "endHour"], where);
  const startHour = asInt(obj.startHour, `${where} の startHour`);
  const endHour = asInt(obj.endHour, `${where} の endHour`);
  assertBoardTimeRange(startHour, endHour, where);
  return { action: "resize", placementId, startHour, endHour };
}

function normalizeProposal(
  value: unknown,
  index: number,
  ctx: ProposalNormalizeContext,
  placementById: ReadonlyMap<string, Placement>,
  peopleIds: ReadonlySet<string>,
): Proposal {
  const where = `proposals[${index}]`;
  if (!isRecord(value)) {
    fail(`${where} はオブジェクトでなければなりません`);
  }
  const obj = stripNulls(value);
  // baseRevision は AI の値を捨てるため、キー自体は受け入れて読み捨てる
  assertAllowedKeys(obj, ["summary", "changes", "baseRevision"], where);

  const summary = asString(obj.summary, `${where} の summary`, MAX_SUMMARY_CHARS);
  if (summary.trim() === "") {
    fail(`${where} の summary が空です`);
  }
  if (!Array.isArray(obj.changes)) {
    fail(`${where} の changes は配列でなければなりません`);
  }
  const rawChanges = obj.changes as unknown[];
  if (rawChanges.length === 0) {
    fail(`${where} の changes が空です`);
  }
  if (rawChanges.length > MAX_CHANGES_PER_PROPOSAL) {
    fail(`${where} の changes は ${MAX_CHANGES_PER_PROPOSAL} 件までです`);
  }

  const state: ChangeState = { operated: new Set() };
  const changes = rawChanges.map((item, i) =>
    normalizeChange(item, i, index, ctx, placementById, peopleIds, state),
  );

  return { summary, changes, baseRevision: ctx.baseRevision };
}

/** Gemini の生出力を正規化済みの代替案へ変換する。不正なら NormalizeError */
export function normalizeProposals(
  raw: unknown,
  ctx: ProposalNormalizeContext,
): Proposal[] {
  if (!isRecord(raw)) {
    fail("出力がオブジェクトではありません");
  }
  // baseRevision は AI の値を捨てるため、キー自体は受け入れて読み捨てる
  assertAllowedKeys(raw, ["proposals", "baseRevision"], "出力");

  if (!Array.isArray(raw.proposals)) {
    fail("proposals は配列でなければなりません");
  }
  const placementById = new Map(ctx.placements.map((p) => [p.id, p]));
  const peopleIds = new Set(ctx.people.map((p) => p.id));

  // 上限（最大3案）を超えた分は捨てて、先頭3案を採用する
  const limited = (raw.proposals as unknown[]).slice(0, MAX_PROPOSALS);
  return limited.map((item, i) =>
    normalizeProposal(item, i, ctx, placementById, peopleIds),
  );
}
