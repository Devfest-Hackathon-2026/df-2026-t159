import { describe, expect, it } from "vitest";
import type { RoomSnapshot, ValidationResult } from "../../types";
import { buildProposalPrompt, describeValidationProblems } from "../proposalPrompt";
import { proposalResponseSchema } from "../proposalSchema";
import { buildStructurePrompt } from "../structurePrompt";
import { structureResponseSchema } from "../structureSchema";

describe("responseSchema の形", () => {
  it("構造化スキーマは constraints／hopes／unknowns を必須にする", () => {
    expect(structureResponseSchema.required).toEqual([
      "constraints",
      "hopes",
      "unknowns",
    ]);
    expect(structureResponseSchema.properties?.constraints).toBeDefined();
  });

  it("代替案スキーマには move／resize／remove 用の placementId が残っている", () => {
    const changeSchema =
      proposalResponseSchema.properties?.proposals?.items?.properties?.changes
        ?.items;
    expect(changeSchema?.properties?.placementId).toBeDefined();
    expect(changeSchema?.properties?.action?.enum).toEqual([
      "move",
      "resize",
      "add",
      "remove",
    ]);
  });

  it("代替案スキーマに baseRevision は含まれない（サーバーが付ける）", () => {
    const proposalProps =
      proposalResponseSchema.properties?.proposals?.items?.properties;
    expect(proposalProps).not.toHaveProperty("baseRevision");
  });
});

describe("buildStructurePrompt", () => {
  it("家族一覧・推測禁止・unknowns の指示とメモを含む", () => {
    const prompt = buildStructurePrompt({
      peopleNames: ["父", "母", "長女"],
      memo: "長女は平日仕事です",
      hasImages: true,
    });
    expect(prompt).toContain("長女");
    expect(prompt).toContain("unknowns");
    expect(prompt).toContain("推測");
    expect(prompt).toContain("長女は平日仕事です");
    expect(prompt).toContain("退院書類の画像");
    expect(prompt).toContain("除外の言い回し");
    expect(prompt).toContain("対象者が家族一覧にいない場合は条件（constraints）を作らず");
  });

  it("retryReason が渡されたときは前回の失敗理由をプロンプトに添える", () => {
    const prompt = buildStructurePrompt({
      peopleNames: ["父"],
      memo: "父は要介護3",
      hasImages: false,
      retryReason: "constraints[0] の type が不正です",
    });
    expect(prompt).toContain("前回の出力が形式不正となった理由");
    expect(prompt).toContain("constraints[0] の type が不正です");
  });
});

describe("buildProposalPrompt / describeValidationProblems", () => {
  const snapshot: RoomSnapshot = {
    people: [{ id: "person-eldest", name: "長女", canProvideCare: true }],
    placements: [
      {
        id: "p-visit",
        day: 0,
        startHour: 9,
        endHour: 11,
        kind: "visit",
        serviceId: "visit-body-60",
      },
    ],
    constraints: [],
    hopes: ["週末は休みたい"],
    unknowns: [],
    careWindows: [{ day: 0, startHour: 7, endHour: 21 }],
    copayRate: 1,
    revision: 3,
  };

  const validation: ValidationResult = {
    ok: false,
    weeklyUnits: 7000,
    monthlyUnits: 30000,
    limitUnits: 27048,
    overUnits: 2952,
    selfPayYen: 100000,
    selfPayBreakdown: { withinYen: 27048, overYen: 72952 },
    gaps: [{ day: 2, startHour: 12, endHour: 15 }],
    memberHours: [],
    overloads: [],
    hardViolations: [],
    validationErrors: [],
  };

  it("NG 理由に限度額超過と空白が入る", () => {
    const problems = describeValidationProblems(validation);
    expect(problems.some((p) => p.includes("2952"))).toBe(true);
    expect(problems.some((p) => p.includes("空白"))).toBe(true);
  });

  it("プロンプトには配置ID・変更の書き方・計算しない旨が入る", () => {
    const prompt = buildProposalPrompt(snapshot, validation);
    expect(prompt).toContain("p-visit");
    expect(prompt).toContain("placementId は書かない");
    expect(prompt).toContain("単位数の計算や金額の判定はしないこと");
    expect(prompt).toContain("最大3案");
  });
});
