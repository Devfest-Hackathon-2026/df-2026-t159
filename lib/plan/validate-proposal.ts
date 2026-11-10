/**
 * 代替案の適用リクエストで送られた Proposal の形の検査（Issue 14）。
 *
 * クライアントから送られた値は信頼せず、共通形式（lib/types.ts の Proposal）
 * に合うものだけを通す。通った値は、既知の項目だけを拾った新しいオブジェクト
 * として返す（余分なキーは捨てる）。
 * 形が不正な場合は AiApiError（400）を throw する。
 *
 * 検査の範囲は「形」まで（対象配置が実在するか・再検証でOKになるかは
 * logic.ts の判定と検証エンジンが担う）。
 */

import { AiApiError } from "../ai/errors";
import {
  BOARD_END_HOUR,
  BOARD_START_HOUR,
  type DayIndex,
  type PlacementKind,
  type Proposal,
  type ProposalChange,
} from "../types";

const PLACEMENT_KINDS: readonly PlacementKind[] = [
  "visit",
  "daycare",
  "dayrehab",
  "shortstay",
  "family",
];

/** 1回の適用で受け付ける変更件数の上限（異常な入力を弾くための妥当性チェック） */
const MAX_CHANGES = 100;

function invalid(message: string): AiApiError {
  return new AiApiError(400, "invalid_proposal", message);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requireId(value: unknown, what: string): string {
  if (typeof value !== "string" || value === "") {
    throw invalid(`${what} が必須です`);
  }
  return value;
}

function requireDay(value: unknown): DayIndex {
  if (
    typeof value !== "number" ||
    !Number.isInteger(value) ||
    value < 0 ||
    value > 6
  ) {
    throw invalid("day は 0〜6 の整数で指定してください");
  }
  return value as DayIndex;
}

function requireHour(value: unknown, what: string): number {
  if (typeof value !== "number" || !Number.isInteger(value)) {
    throw invalid(`${what} は整数時間で指定してください`);
  }
  return value;
}

function parseChange(value: unknown): ProposalChange {
  if (!isRecord(value)) {
    throw invalid("changes の各要素はオブジェクトで送ってください");
  }
  switch (value.action) {
    case "remove":
      return {
        action: "remove",
        placementId: requireId(value.placementId, "placementId"),
      };
    case "move":
      return {
        action: "move",
        placementId: requireId(value.placementId, "placementId"),
        day: requireDay(value.day),
        startHour: requireHour(value.startHour, "startHour"),
      };
    case "resize": {
      const startHour = requireHour(value.startHour, "startHour");
      const endHour = requireHour(value.endHour, "endHour");
      if (startHour < 0 || endHour > BOARD_END_HOUR || startHour >= endHour) {
        throw invalid("resize の時刻範囲が不正です");
      }
      return {
        action: "resize",
        placementId: requireId(value.placementId, "placementId"),
        startHour,
        endHour,
      };
    }
    case "add": {
      const startHour = requireHour(value.startHour, "startHour");
      const endHour = requireHour(value.endHour, "endHour");
      if (
        startHour < BOARD_START_HOUR ||
        endHour > BOARD_END_HOUR ||
        startHour >= endHour
      ) {
        throw invalid("add の時刻範囲が不正です（6:00〜24:00）");
      }
      const kind = value.kind;
      if (
        typeof kind !== "string" ||
        !PLACEMENT_KINDS.includes(kind as PlacementKind)
      ) {
        throw invalid("add の kind が不正です");
      }
      const change: ProposalChange = {
        action: "add",
        placementId: requireId(value.placementId, "placementId"),
        day: requireDay(value.day),
        startHour,
        endHour,
        kind: kind as PlacementKind,
      };
      // kind が family のときは personId、それ以外は serviceId が必須（共通形式）
      if (change.kind === "family") {
        change.personId = requireId(value.personId, "personId");
      } else {
        change.serviceId = requireId(value.serviceId, "serviceId");
      }
      if (typeof value.note === "string") {
        change.note = value.note;
      }
      return change;
    }
    default:
      throw invalid("action は move／resize／add／remove のいずれかです");
  }
}

/**
 * 未検証の入力を Proposal として検査し、正規化した新しいオブジェクトを返す。
 * 形が不正な場合は AiApiError（400）を throw する。
 */
export function parseProposal(value: unknown): Proposal {
  if (!isRecord(value)) {
    throw invalid("proposal はオブジェクトで送ってください");
  }
  if (typeof value.summary !== "string" || value.summary === "") {
    throw invalid("summary が必須です");
  }
  if (
    typeof value.baseRevision !== "number" ||
    !Number.isInteger(value.baseRevision) ||
    value.baseRevision < 0
  ) {
    throw invalid("baseRevision は0以上の整数で指定してください");
  }
  if (!Array.isArray(value.changes)) {
    throw invalid("changes は配列で送ってください");
  }
  if (value.changes.length > MAX_CHANGES) {
    throw invalid("changes の件数が上限を超えています");
  }
  return {
    summary: value.summary,
    baseRevision: value.baseRevision,
    changes: value.changes.map(parseChange),
  };
}
