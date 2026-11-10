import { describe, expect, it } from "vitest";
import {
  canDeletePerson,
  deriveCareRole,
  getPersonAvatarText,
  getPersonRoleLabel,
  normalizePeople,
  PERSON_ICON_OPTIONS,
  validatePeopleCareRoles,
} from "./people";
import type { Constraint, Person, Placement } from "./types";

describe("deriveCareRole & normalizePeople（既存データ互換の導出規則）", () => {
  it("既に careRole が設定されている場合はそのまま採用される", () => {
    const p: Person = {
      id: "p1",
      name: "父",
      canProvideCare: false,
      careRole: "recipient",
    };
    expect(deriveCareRole(p)).toBe("recipient");
  });

  it("canProvideCare=true の既存データは caregiver に導出される", () => {
    const p: Person = { id: "p1", name: "長女", canProvideCare: true };
    expect(deriveCareRole(p)).toBe("caregiver");
  });

  it("canProvideCare=false が1人だけなら recipient に導出される", () => {
    const p1: Person = { id: "p1", name: "父", canProvideCare: false };
    const p2: Person = { id: "p2", name: "長女", canProvideCare: true };
    const all = [p1, p2];

    expect(deriveCareRole(p1, all)).toBe("recipient");
  });

  it("canProvideCare=false が複数いる場合は先頭が recipient、残りが family に導出される", () => {
    const father: Person = { id: "p-father", name: "父", canProvideCare: false };
    const mother: Person = { id: "p-mother", name: "母", canProvideCare: false };
    const daughter: Person = { id: "p-daughter", name: "長女", canProvideCare: true };
    const all = [father, mother, daughter];

    expect(deriveCareRole(father, all)).toBe("recipient");
    expect(deriveCareRole(mother, all)).toBe("family");
    expect(deriveCareRole(daughter, all)).toBe("caregiver");

    const normalized = normalizePeople(all);
    expect(normalized).toEqual([
      { id: "p-father", name: "父", canProvideCare: false, careRole: "recipient" },
      { id: "p-mother", name: "母", canProvideCare: false, careRole: "family" },
      { id: "p-daughter", name: "長女", canProvideCare: true, careRole: "caregiver" },
    ]);
  });

  it("normalizePeople で canProvideCare は caregiver のみ true になる", () => {
    const people: Person[] = [
      { id: "p1", name: "本人", canProvideCare: true, careRole: "recipient" }, // 矛盾していても
      { id: "p2", name: "介助者", canProvideCare: false, careRole: "caregiver" },
      { id: "p3", name: "家族", canProvideCare: true, careRole: "family" },
    ];
    const normalized = normalizePeople(people);
    expect(normalized[0].canProvideCare).toBe(false);
    expect(normalized[1].canProvideCare).toBe(true);
    expect(normalized[2].canProvideCare).toBe(false);
  });
});

describe("validatePeopleCareRoles（制約の検証）", () => {
  it("被介護者1人、付き添い家族1人以上なら合格", () => {
    const people: Person[] = [
      { id: "p1", name: "父", canProvideCare: false, careRole: "recipient" },
      { id: "p2", name: "長女", canProvideCare: true, careRole: "caregiver" },
    ];
    const result = validatePeopleCareRoles(people);
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it("被介護者が0人なら不合格（エラーメッセージを返す）", () => {
    const people: Person[] = [
      { id: "p1", name: "長女", canProvideCare: true, careRole: "caregiver" },
      { id: "p2", name: "長男", canProvideCare: true, careRole: "caregiver" },
    ];
    const result = validatePeopleCareRoles(people);
    expect(result.valid).toBe(false);
    expect(result.errors).toContain("介護を受ける人を1人指定してください。");
  });

  it("被介護者が2人以上なら不合格（エラーメッセージを返す）", () => {
    const people: Person[] = [
      { id: "p1", name: "父", canProvideCare: false, careRole: "recipient" },
      { id: "p2", name: "母", canProvideCare: false, careRole: "recipient" },
      { id: "p3", name: "長女", canProvideCare: true, careRole: "caregiver" },
    ];
    const result = validatePeopleCareRoles(people);
    expect(result.valid).toBe(false);
    expect(result.errors).toContain("介護を受ける人は1人だけにしてください。");
  });

  it("付き添いができる家族が0人なら不合格（エラーメッセージを返す）", () => {
    const people: Person[] = [
      { id: "p1", name: "父", canProvideCare: false, careRole: "recipient" },
      { id: "p2", name: "長女", canProvideCare: false, careRole: "family" },
    ];
    const result = validatePeopleCareRoles(people);
    expect(result.valid).toBe(false);
    expect(result.errors).toContain("付き添いができる家族を1人以上指定してください。");
  });

  it("名前が空の家族がいる場合は不合格", () => {
    const people: Person[] = [
      { id: "p1", name: "   ", canProvideCare: false, careRole: "recipient" },
      { id: "p2", name: "長女", canProvideCare: true, careRole: "caregiver" },
    ];
    const result = validatePeopleCareRoles(people);
    expect(result.valid).toBe(false);
    expect(result.errors).toContain("名前が入力されていない家族がいます。");
  });
});

describe("canDeletePerson（削除ガード）", () => {
  const placements: Placement[] = [
    {
      id: "place-1",
      day: 0,
      startHour: 9,
      endHour: 10,
      kind: "family",
      personId: "person-daughter",
    },
  ];

  const constraints: Constraint[] = [
    {
      personId: "person-mother",
      detail: "腰痛のため介助困難",
      type: "hope",
      days: [],
    },
  ];

  it("配置も条件もない人は削除できる", () => {
    const result = canDeletePerson("person-son", placements, constraints);
    expect(result.canDelete).toBe(true);
    expect(result.reason).toBeUndefined();
  });

  it("配置がある人は削除できず、理由が表示される", () => {
    const result = canDeletePerson("person-daughter", placements, constraints);
    expect(result.canDelete).toBe(false);
    expect(result.reason).toContain("配置");
  });

  it("条件がある人は削除できず、理由が表示される", () => {
    const result = canDeletePerson("person-mother", placements, constraints);
    expect(result.canDelete).toBe(false);
    expect(result.reason).toContain("条件");
  });

  it("配置と条件の両方がある人は削除できず、両方の理由が表示される", () => {
    const bothPlacements: Placement[] = [
      {
        id: "p1",
        day: 1,
        startHour: 10,
        endHour: 12,
        kind: "family",
        personId: "p-target",
      },
    ];
    const bothConstraints: Constraint[] = [
      {
        personId: "p-target",
        detail: "仕事のため不可",
        type: "unavailable",
        days: [1],
        startHour: 9,
        endHour: 18,
      },
    ];
    const result = canDeletePerson("p-target", bothPlacements, bothConstraints);
    expect(result.canDelete).toBe(false);
    expect(result.reason).toContain("配置");
    expect(result.reason).toContain("条件");
  });
});

describe("getPersonRoleLabel", () => {
  it("3区分の表記が正しく返る", () => {
    expect(getPersonRoleLabel({ id: "1", name: "父", canProvideCare: false, careRole: "recipient" })).toBe("介護を受ける人");
    expect(getPersonRoleLabel({ id: "2", name: "長女", canProvideCare: true, careRole: "caregiver" })).toBe("付き添いができる家族");
    expect(getPersonRoleLabel({ id: "3", name: "次女", canProvideCare: false, careRole: "family" })).toBe("付き添いはできない家族");
  });
});

describe("家族アイコン（PERSON_ICON_OPTIONS / getPersonAvatarText / normalizePeople）", () => {
  it("PERSON_ICON_OPTIONS に12個程度の絵文字候補（肌色・特徴のバリエーション）が含まれる", () => {
    expect(PERSON_ICON_OPTIONS.length).toBeGreaterThanOrEqual(10);
    expect(PERSON_ICON_OPTIONS.length).toBeLessThanOrEqual(14);
    // 肌色のバリエーションや見分けのつくアイコンが含まれること
    expect(PERSON_ICON_OPTIONS).toContain("👴🏻");
    expect(PERSON_ICON_OPTIONS).toContain("👵🏼");
    expect(PERSON_ICON_OPTIONS).toContain("👨🏽");
    expect(PERSON_ICON_OPTIONS).toContain("👩🏻");
  });

  it("getPersonAvatarText は icon があれば icon、未設定なら名前の先頭1文字を返す", () => {
    expect(getPersonAvatarText({ name: "長女", icon: "👩" })).toBe("👩");
    expect(getPersonAvatarText({ name: "長女" })).toBe("長");
    expect(getPersonAvatarText({ name: "長女", icon: "" })).toBe("長");
  });

  it("normalizePeople は設定された icon を保持し、空または未設定の場合は icon プロパティを省略する", () => {
    const normalized = normalizePeople([
      { id: "p1", name: "父", canProvideCare: false, careRole: "recipient", icon: "👴" },
      { id: "p2", name: "長女", canProvideCare: true, careRole: "caregiver", icon: "" },
    ]);
    expect(normalized[0]).toEqual({
      id: "p1",
      name: "父",
      canProvideCare: false,
      careRole: "recipient",
      icon: "👴",
    });
    expect(normalized[1]).toEqual({
      id: "p2",
      name: "長女",
      canProvideCare: true,
      careRole: "caregiver",
    });
    expect("icon" in normalized[1]).toBe(false);
  });
});
