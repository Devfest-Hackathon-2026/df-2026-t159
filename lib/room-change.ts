/**
 * commitRoomChange の書き込み計画を作る純粋ロジック（Issue 2）。
 *
 * Firestore へは触れず、「整合スナップショット＋変更分」から
 * 「どのドキュメントをどう書くか」だけを計算する。
 * トランザクション本体（lib/rooms.ts）と単体テストの両方から使う。
 *
 * 方式（仕様v5の確定事項）：Web Client SDK の runTransaction はクエリを読めないため、
 * 事前取得した整合スナップショットに対して書き込み計画を立て、
 * トランザクション内では rooms/{roomId} の revision === expectedRevision を
 * 検証してから一括書き込みする。
 */

import type {
  CareWindow,
  CopayRate,
  Person,
  Placement,
  RoomChange,
  RoomConstraints,
  RoomSnapshot,
} from "./types";

/** expectedRevision と現在の revision が一致しないときに投げるエラー（保存しない） */
export class RevisionConflictError extends Error {
  readonly expected: number;
  readonly actual: number;

  constructor(expected: number, actual: number) {
    super(
      `revision が一致しません（expected=${expected}, actual=${actual}）。古い画面・古いAI応答からの保存は拒否します`,
    );
    this.name = "RevisionConflictError";
    this.expected = expected;
    this.actual = actual;
  }
}

/** ルームが存在しない（または整合スナップショットが取得できない）ときに投げるエラー */
export class RoomNotFoundError extends Error {
  readonly roomId: string;

  constructor(roomId: string) {
    super(`ルームが見つかりません: ${roomId}`);
    this.name = "RoomNotFoundError";
    this.roomId = roomId;
  }
}

/** planRoomChangeWrites の計算結果（トランザクションで実行する書き込み一式） */
export interface RoomChangePlan {
  /** 変更後の家族一覧（全体。指定された場合のみ） */
  nextPeople?: Person[];
  /** 新規追加または内容が変わった家族（set する対象） */
  upsertPeople?: Person[];
  /** 削除する家族のドキュメントID */
  deletePeopleIds?: string[];
  /** 変更後の配置一覧（全体） */
  nextPlacements: Placement[];
  /** 新規追加または内容が変わった配置（set する対象） */
  upsertPlacements: Placement[];
  /** 削除する配置のドキュメントID */
  deletePlacementIds: string[];
  /** constraints/main へ set する内容。変更がなければ null（書かない） */
  constraintsDoc: RoomConstraints | null;
  /** rooms/{roomId} 本体へ一緒に書く設定項目（指定されたものだけ） */
  roomFields: {
    careWindows?: CareWindow[];
    copayRate?: CopayRate;
  };
  /** 保存後の revision（expectedRevision + 1） */
  nextRevision: number;
}

/**
 * 整合スナップショットと変更分から書き込み計画を立てる。
 * current.revision が expectedRevision と違う場合は RevisionConflictError を投げる
 * （この時点で保存は行われない）。
 */
export function planRoomChangeWrites(
  current: RoomSnapshot,
  expectedRevision: number,
  change: RoomChange,
): RoomChangePlan {
  if (current.revision !== expectedRevision) {
    throw new RevisionConflictError(expectedRevision, current.revision);
  }

  let nextPeople: Person[] | undefined;
  let upsertPeople: Person[] | undefined;
  let deletePeopleIds: string[] | undefined;

  if (change.people !== undefined) {
    nextPeople = change.people;
    const currentPeopleById = new Map(current.people.map((p) => [p.id, p]));
    const nextPeopleIds = new Set(nextPeople.map((p) => p.id));

    deletePeopleIds = current.people
      .filter((p) => !nextPeopleIds.has(p.id))
      .map((p) => p.id);

    upsertPeople = nextPeople.filter((p) => {
      const prev = currentPeopleById.get(p.id);
      return prev === undefined || JSON.stringify(prev) !== JSON.stringify(p);
    });
  }

  const nextPlacements = change.placements ?? current.placements;
  const currentById = new Map(current.placements.map((p) => [p.id, p]));
  const nextIds = new Set(nextPlacements.map((p) => p.id));

  const deletePlacementIds = current.placements
    .filter((p) => !nextIds.has(p.id))
    .map((p) => p.id);

  const upsertPlacements = nextPlacements.filter((p) => {
    const prev = currentById.get(p.id);
    return prev === undefined || JSON.stringify(prev) !== JSON.stringify(p);
  });

  let constraintsDoc: RoomConstraints | null = null;
  if (
    change.constraints !== undefined ||
    change.hopes !== undefined ||
    change.unknowns !== undefined
  ) {
    constraintsDoc = {
      constraints: change.constraints ?? current.constraints,
      hopes: change.hopes ?? current.hopes,
      unknowns: change.unknowns ?? current.unknowns,
    };
  }

  const roomFields: RoomChangePlan["roomFields"] = {};
  if (change.careWindows !== undefined) {
    roomFields.careWindows = change.careWindows;
  }
  if (change.copayRate !== undefined) {
    roomFields.copayRate = change.copayRate;
  }

  return {
    nextPeople,
    upsertPeople,
    deletePeopleIds,
    nextPlacements,
    upsertPlacements,
    deletePlacementIds,
    constraintsDoc,
    roomFields,
    nextRevision: expectedRevision + 1,
  };
}
