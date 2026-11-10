import { describe, expect, it } from "vitest";
import {
  canSubmitStructure,
  careWindowDraftsFromWindows,
  clearInputScreenDraft,
  emptyReviewDraft,
  getInputScreenDraft,
  linesToList,
  listToLines,
  prependEmptyCareWindowDraft,
  resolveUniquePersonId,
  reviewDraftsFromSnapshot,
  reviewDraftsFromStructureResult,
  saveInputScreenDraft,
  separateDatelessHopes,
  sortCareWindowDrafts,
  toCareWindows,
  toStructureSaveConstraints,
  unboundDraftCount,
  validateCareWindowDrafts,
  validateCareWindows,
  validateReviewDraft,
  type ReviewDraft,
} from "./structure-review";
import type { RoomSnapshot } from "./types";
import type { StructureDraftResult } from "./ai/structureNormalize";

const snapshot: RoomSnapshot = {
  people: [
    { id: "person-care", name: "父", canProvideCare: false },
    { id: "person-eldest", name: "長女", canProvideCare: true },
    { id: "person-second", name: "長女", canProvideCare: true }, // 同名
  ],
  placements: [],
  constraints: [
    {
      personId: "person-second",
      type: "unavailable",
      detail: "平日は仕事",
      days: [0, 1, 2, 3, 4],
      startHour: 9,
      endHour: 18,
    },
    {
      personId: "person-eldest",
      type: "hope",
      detail: "週末は休みたい",
      days: [],
    },
  ],
  hopes: ["分担したい"],
  unknowns: ["退院日は未定"],
  careWindows: [{ day: 0, startHour: 7, endHour: 21 }],
  copayRate: 1,
  revision: 3,
};

const structureResult: StructureDraftResult = {
  constraints: [
    {
      memberName: "長女", // people に同名が2人いる
      type: "unavailable",
      detail: "平日は仕事",
      days: [0, 1, 2, 3, 4],
      startHour: 9,
      endHour: 18,
    },
  ],
  hopes: ["分担したい"],
  unknowns: [],
};

function boundWorkDraft(): ReviewDraft {
  return {
    memberName: "長女",
    type: "unavailable",
    detail: "平日は仕事",
    days: [0, 1],
    startHour: 9,
    endHour: 18,
    personId: "person-eldest",
  };
}

describe("reviewDraftsFromStructureResult", () => {
  it("名前が people と完全一致しても personId は自動で結びつけない", () => {
    const drafts = reviewDraftsFromStructureResult(structureResult);
    expect(drafts).toHaveLength(1);
    expect(drafts[0].personId).toBe("");
    expect(unboundDraftCount(drafts)).toBe(1);
    expect(canSubmitStructure(drafts)).toBe(false);
  });
});

describe("reviewDraftsFromSnapshot", () => {
  it("保存済みの personId をそのまま引き継ぐ（名前の推測ではない）", () => {
    const drafts = reviewDraftsFromSnapshot(snapshot);
    expect(drafts[0].personId).toBe("person-second");
    expect(drafts[0].memberName).toBe("長女");
    expect(drafts[1].startHour).toBeUndefined();
    expect(canSubmitStructure(drafts)).toBe(true);
  });
});

describe("canSubmitStructure / validateReviewDraft", () => {
  it("全件が結びつき形式も正しければ保存できる", () => {
    expect(canSubmitStructure([boundWorkDraft()])).toBe(true);
  });

  it("未結びつけが1件でもあれば保存できない", () => {
    const drafts = [boundWorkDraft(), { ...boundWorkDraft(), personId: "" }];
    expect(canSubmitStructure(drafts)).toBe(false);
    expect(unboundDraftCount(drafts)).toBe(1);
  });

  it("制約が0件なら保存できる（hopes／unknowns のみの更新）", () => {
    expect(canSubmitStructure([])).toBe(true);
  });

  it("unavailable で曜日が空なら検証エラー", () => {
    const errors = validateReviewDraft({ ...boundWorkDraft(), days: [] });
    expect(errors.length).toBeGreaterThan(0);
  });

  it("unavailable で時刻が無ければ検証エラー", () => {
    const draft = boundWorkDraft();
    delete draft.startHour;
    delete draft.endHour;
    expect(validateReviewDraft(draft).length).toBeGreaterThan(0);
  });

  it("時刻の開始≧終了は検証エラー", () => {
    expect(
      validateReviewDraft({ ...boundWorkDraft(), startHour: 18, endHour: 9 })
        .length,
    ).toBeGreaterThan(0);
    expect(
      validateReviewDraft({ ...boundWorkDraft(), endHour: 25 }).length,
    ).toBeGreaterThan(0);
  });

  it("hope は時刻が片方だけだと検証エラー、両方なしは可", () => {
    const hope: ReviewDraft = {
      ...emptyReviewDraft(),
      type: "hope",
      detail: "週末は休みたい",
      personId: "person-eldest",
      startHour: 10,
    };
    expect(validateReviewDraft(hope).length).toBeGreaterThan(0);
    delete hope.startHour;
    expect(validateReviewDraft(hope)).toEqual([]);
  });

  it("内容が空なら検証エラー", () => {
    expect(
      validateReviewDraft({ ...boundWorkDraft(), detail: "  " }).length,
    ).toBeGreaterThan(0);
  });
});

describe("toStructureSaveConstraints", () => {
  it("保存 API の許可キーだけを返し、時刻はそろう場合だけ含める", () => {
    const names = new Map(snapshot.people.map((p) => [p.id, p.name]));
    const [timed, free] = toStructureSaveConstraints(
      [
        boundWorkDraft(),
        {
          memberName: "",
          type: "hope",
          detail: "週末は休みたい",
          days: [],
          personId: "person-second",
        },
      ],
      names,
    );
    expect(Object.keys(timed).sort()).toEqual(
      [
        "days",
        "detail",
        "endHour",
        "memberName",
        "personId",
        "startHour",
        "type",
      ].sort(),
    );
    expect(timed.personId).toBe("person-eldest");
    expect(free).not.toHaveProperty("startHour");
    // memberName が空の手動行は、表示用の控えとして結びつけた人の名前で補う
    expect(free.memberName).toBe("長女");
  });
});

describe("validateCareWindows", () => {
  it("正しい範囲は通る", () => {
    expect(
      validateCareWindows([{ day: 6, startHour: 6, endHour: 24 }]),
    ).toEqual([]);
    expect(validateCareWindows([])).toEqual([]);
  });

  it("6時より前・24時超・開始≧終了はエラー", () => {
    expect(
      validateCareWindows([{ day: 0, startHour: 5, endHour: 10 }]).length,
    ).toBe(1);
    expect(
      validateCareWindows([{ day: 0, startHour: 20, endHour: 25 }]).length,
    ).toBe(1);
    expect(
      validateCareWindows([{ day: 0, startHour: 12, endHour: 12 }]).length,
    ).toBe(1);
    expect(
      validateCareWindows([{ day: 7 as never, startHour: 7, endHour: 9 }])
        .length,
    ).toBe(1);
  });
});

describe("linesToList / listToLines", () => {
  it("空行と前後の空白を除いて往復できる", () => {
    expect(linesToList(" a \n\n b \n")).toEqual(["a", "b"]);
    expect(listToLines(["a", "b"])).toBe("a\nb");
    expect(linesToList("")).toEqual([]);
  });
});

describe("resolveUniquePersonId / 一意一致による対象の自動セット", () => {
  const uniquePeople = [
    { id: "p-father", name: "父", canProvideCare: false },
    { id: "p-mother", name: "母", canProvideCare: true },
    { id: "p-daughter", name: "長女", canProvideCare: true },
    { id: "p-son", name: "長男", canProvideCare: true },
  ];

  it("memberName が一意に一致する場合は自動で personId がセットされる", () => {
    const drafts = reviewDraftsFromStructureResult(structureResult, uniquePeople);
    expect(drafts[0].personId).toBe("p-daughter");
  });

  it("同名の家族が複数いる場合は自動セットせず未選択にする", () => {
    const drafts = reviewDraftsFromStructureResult(
      structureResult,
      snapshot.people,
    );
    expect(drafts[0].personId).toBe("");
  });

  it("detail（内容）から対象が一意に明らかな場合は自動で personId を返し、複数名や不明は未選択にする", () => {
    expect(
      resolveUniquePersonId(
        { memberName: "", detail: "長男は遠方のため平日は対応不可" },
        uniquePeople,
      ),
    ).toBe("p-son");

    // 2人の名前が含まれる場合は一意に定まらないため未選択
    expect(
      resolveUniquePersonId(
        { memberName: "", detail: "母の通院に長女が付き添う" },
        uniquePeople,
      ),
    ).toBe("");

    // 誰の名前も含まれない場合は未選択
    expect(
      resolveUniquePersonId(
        { memberName: "", detail: "平日は仕事で対応不可" },
        uniquePeople,
      ),
    ).toBe("");
  });
});

describe("separateDatelessHopes（曜日・時刻がない希望の分離）", () => {
  it("曜日・時刻がない hope は条件カードから除外し、hopes（自由記述）へ移す", () => {
    const drafts: ReviewDraft[] = [
      boundWorkDraft(),
      {
        memberName: "母",
        type: "hope",
        detail: "入浴はプロの手を借りたい",
        days: [],
        personId: "person-eldest",
      },
      {
        memberName: "長男",
        type: "hope",
        detail: "土日の午前中は付き添える",
        days: [5, 6],
        startHour: 8,
        endHour: 12,
        personId: "person-eldest",
      },
    ];
    const result = separateDatelessHopes(drafts, ["週末は家族で分担したい"]);
    expect(result.drafts).toHaveLength(2);
    expect(result.drafts[0].type).toBe("unavailable");
    expect(result.drafts[1].detail).toBe("土日の午前中は付き添える");
    expect(result.hopes).toEqual([
      "週末は家族で分担したい",
      "入浴はプロの手を借りたい",
    ]);
  });
});

describe("CareWindowDraft の先頭追加と曜日・時刻順ソート", () => {
  it("未入力の行は一番上に表示され、日時が揃うと曜日・開始・終了時刻順に並び替わる", () => {
    const initial = careWindowDraftsFromWindows([
      { day: 3, startHour: 9, endHour: 17 },
      { day: 1, startHour: 12, endHour: 15 },
    ]);
    // 初期時点で曜日順にソートされる
    expect(initial.map((w) => w.day)).toEqual([1, 3]);

    // 追加すると未入力行が一番上（先頭）に入る
    const added = prependEmptyCareWindowDraft(initial, "new-row");
    expect(added[0]).toEqual({
      id: "new-row",
      day: "",
      startHour: "",
      endHour: "",
    });
    expect(validateCareWindowDrafts(added).length).toBeGreaterThan(0);

    // 曜日だけ選んだ段階（未完了）ではまだ先頭にとどまる
    const partial = sortCareWindowDrafts(
      added.map((w) => (w.id === "new-row" ? { ...w, day: 5 } : w)),
    );
    expect(partial[0].id).toBe("new-row");

    // 曜日・開始・終了をすべて選ぶと曜日・時刻順に並び替わる
    const completed = sortCareWindowDrafts(
      added.map((w) =>
        w.id === "new-row"
          ? { ...w, day: 1 as const, startHour: 7, endHour: 9 }
          : w,
      ),
    );
    expect(toCareWindows(completed)).toEqual([
      { day: 1, startHour: 7, endHour: 9 },
      { day: 1, startHour: 12, endHour: 15 },
      { day: 3, startHour: 9, endHour: 17 },
    ]);
  });
});

describe("InputScreenDraft（下書き保持）", () => {
  it("ルーム別に未保存の下書きを保存・復元・クリアできる", () => {
    clearInputScreenDraft("room-draft-test");
    expect(getInputScreenDraft("room-draft-test")).toBeNull();

    saveInputScreenDraft("room-draft-test", {
      memo: "退院後の相談メモ",
      drafts: [boundWorkDraft()],
      hopesText: "自宅で過ごしたい",
      unknownsText: "服薬確認",
      careWindowDrafts: careWindowDraftsFromWindows([
        { day: 0, startHour: 7, endHour: 21 },
      ]),
      copayRate: 2,
      dirty: true,
    });

    const restored = getInputScreenDraft("room-draft-test");
    expect(restored?.memo).toBe("退院後の相談メモ");
    expect(restored?.dirty).toBe(true);
    expect(restored?.copayRate).toBe(2);
    expect(restored?.drafts).toHaveLength(1);

    clearInputScreenDraft("room-draft-test");
    expect(getInputScreenDraft("room-draft-test")).toBeNull();
  });
});
