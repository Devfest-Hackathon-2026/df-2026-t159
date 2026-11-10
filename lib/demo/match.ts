/**
 * デモ固定応答の発行条件：スナップショット照合ロジック（Issue 15）。
 *
 * デモモードの代替案は、入力スナップショットが fixture と一致する場合だけ発行する：
 * - fixtureVersion: ルームの版と fixture の版の一致
 * - 人物ID対応: ルームの people と人物対応マップの一致
 * - 配置: 人物ID対応済みの「揉めるプラン」（troubledPlan）との完全一致
 * - 制約: 人物ID対応済みの fixture.constraints、hopes、unknowns との完全一致
 * - careWindows: fixture.careWindows との一致
 * - 負担割合: fixture.copayRate との一致
 *
 * 不一致なら固定案を返さず、理由を返す（エラーで案内する形）。
 */

import { demoFixture, type DemoFixture } from "../demo-fixture";
import type { RoomSnapshot } from "../types";
import { mapConstraints, mapPeople, mapPlacements } from "./mapping";
import type { DemoRoomMeta, SnapshotMatchResult } from "./types";

/**
 * 入力スナップショットが fixture のデモ初期状態と一致しているかを照合する純粋関数。
 */
export function matchDemoSnapshot(
  snapshot: RoomSnapshot,
  meta: Pick<DemoRoomMeta, "isDemo" | "fixtureVersion" | "personMapping">,
  fixture: DemoFixture = demoFixture,
): SnapshotMatchResult {
  // 1. デモルーム限定
  if (!meta.isDemo) {
    return {
      matched: false,
      reason: "対象ルームはデモルームではありません",
    };
  }

  // 2. fixtureVersion 照合
  if (meta.fixtureVersion !== fixture.fixtureVersion) {
    return {
      matched: false,
      reason: `fixtureVersion が一致しません（room: ${meta.fixtureVersion}, fixture: ${fixture.fixtureVersion}）`,
      field: "fixtureVersion",
    };
  }

  // 3. 人物ID対応と people 照合
  const expectedPeople = mapPeople(fixture.people, meta.personMapping);
  if (snapshot.people.length !== expectedPeople.length) {
    return {
      matched: false,
      reason: `家族（people）の件数が一致しません（実際: ${snapshot.people.length}, 期待: ${expectedPeople.length}）`,
      field: "people",
    };
  }
  const expectedPeopleMap = new Map(expectedPeople.map((p) => [p.id, p]));
  for (const actual of snapshot.people) {
    const exp = expectedPeopleMap.get(actual.id);
    if (!exp) {
      return {
        matched: false,
        reason: `人物ID対応に存在しない人物が含まれています: ${actual.name} (${actual.id})`,
        field: "people",
      };
    }
    if (exp.name !== actual.name || exp.canProvideCare !== actual.canProvideCare) {
      return {
        matched: false,
        reason: `人物の情報が一致しません: ${actual.name}`,
        field: "people",
      };
    }
  }

  // 4. careWindows 照合
  if (snapshot.careWindows.length !== fixture.careWindows.length) {
    return {
      matched: false,
      reason: `支援必要時間（careWindows）の件数が一致しません（実際: ${snapshot.careWindows.length}, 期待: ${fixture.careWindows.length}）`,
      field: "careWindows",
    };
  }
  const sortWindows = (cw: typeof snapshot.careWindows) =>
    [...cw].sort(
      (a, b) =>
        a.day - b.day || a.startHour - b.startHour || a.endHour - b.endHour,
    );
  const actualCw = sortWindows(snapshot.careWindows);
  const expCw = sortWindows(fixture.careWindows);
  for (let i = 0; i < actualCw.length; i++) {
    if (
      actualCw[i].day !== expCw[i].day ||
      actualCw[i].startHour !== expCw[i].startHour ||
      actualCw[i].endHour !== expCw[i].endHour
    ) {
      return {
        matched: false,
        reason: "支援必要時間（careWindows）の内容が一致しません",
        field: "careWindows",
      };
    }
  }

  // 5. 負担割合（copayRate）照合
  if (snapshot.copayRate !== fixture.copayRate) {
    return {
      matched: false,
      reason: `自己負担割合が一致しません（実際: ${snapshot.copayRate}割, 期待: ${fixture.copayRate}割）`,
      field: "copayRate",
    };
  }

  // 6. 制約（constraints, hopes, unknowns）照合
  const expectedConstraints = mapConstraints(fixture.constraints, meta.personMapping);
  if (snapshot.constraints.length !== expectedConstraints.length) {
    return {
      matched: false,
      reason: `制約の件数が一致しません（実際: ${snapshot.constraints.length}, 期待: ${expectedConstraints.length}）`,
      field: "constraints",
    };
  }
  const sortConstraints = (list: typeof snapshot.constraints) =>
    [...list].sort(
      (a, b) =>
        a.personId.localeCompare(b.personId) ||
        a.type.localeCompare(b.type) ||
        (a.days[0] ?? 0) - (b.days[0] ?? 0) ||
        (a.startHour ?? 0) - (b.startHour ?? 0) ||
        (a.endHour ?? 0) - (b.endHour ?? 0) ||
        a.detail.localeCompare(b.detail),
    );
  const actualC = sortConstraints(snapshot.constraints);
  const expC = sortConstraints(expectedConstraints);
  for (let i = 0; i < actualC.length; i++) {
    const ac = actualC[i];
    const ec = expC[i];
    const daysMatch =
      ac.days.length === ec.days.length &&
      [...ac.days].sort().every((d, idx) => d === [...ec.days].sort()[idx]);
    if (
      ac.personId !== ec.personId ||
      ac.type !== ec.type ||
      ac.detail !== ec.detail ||
      !daysMatch ||
      ac.startHour !== ec.startHour ||
      ac.endHour !== ec.endHour
    ) {
      return {
        matched: false,
        reason: "制約の内容が一致しません",
        field: "constraints",
      };
    }
  }

  // hopes 照合
  const sortStrings = (arr: string[]) => [...arr].sort();
  const actualHopes = sortStrings(snapshot.hopes);
  const expHopes = sortStrings(fixture.hopes);
  if (
    actualHopes.length !== expHopes.length ||
    !actualHopes.every((h, i) => h === expHopes[i])
  ) {
    return {
      matched: false,
      reason: "希望（hopes）が一致しません",
      field: "hopes",
    };
  }

  // unknowns 照合
  const actualUnknowns = sortStrings(snapshot.unknowns);
  const expUnknowns = sortStrings(fixture.unknowns);
  if (
    actualUnknowns.length !== expUnknowns.length ||
    !actualUnknowns.every((u, i) => u === expUnknowns[i])
  ) {
    return {
      matched: false,
      reason: "未確認事項（unknowns）が一致しません",
      field: "unknowns",
    };
  }

  // 7. 配置（placements）照合（揉めるプラン）
  const expectedPlacements = mapPlacements(
    fixture.troubledPlan.placements,
    meta.personMapping,
  );
  if (snapshot.placements.length !== expectedPlacements.length) {
    return {
      matched: false,
      reason: `配置の件数が一致しません（実際: ${snapshot.placements.length}, 期待: ${expectedPlacements.length}）`,
      field: "placements",
    };
  }
  const sortPlacements = (arr: typeof snapshot.placements) =>
    [...arr].sort(
      (a, b) =>
        a.day - b.day ||
        a.startHour - b.startHour ||
        a.endHour - b.endHour ||
        a.kind.localeCompare(b.kind) ||
        (a.serviceId ?? "").localeCompare(b.serviceId ?? "") ||
        (a.personId ?? "").localeCompare(b.personId ?? ""),
    );
  const actualP = sortPlacements(snapshot.placements);
  const expP = sortPlacements(expectedPlacements);
  for (let i = 0; i < actualP.length; i++) {
    const ap = actualP[i];
    const ep = expP[i];
    if (
      ap.day !== ep.day ||
      ap.startHour !== ep.startHour ||
      ap.endHour !== ep.endHour ||
      ap.kind !== ep.kind ||
      (ap.serviceId ?? null) !== (ep.serviceId ?? null) ||
      (ap.personId ?? null) !== (ep.personId ?? null)
    ) {
      return {
        matched: false,
        reason: "配置の内容が一致しません",
        field: "placements",
      };
    }
  }

  return { matched: true };
}
