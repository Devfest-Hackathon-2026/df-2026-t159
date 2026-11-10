import { describe, expect, it } from "vitest";
import type { Constraint } from "../../types";
import { NormalizeError } from "../normalizeUtil";
import {
  normalizeLegacyConstraintTypeInput,
  normalizeSavedConstraints,
  normalizeSavedConstraintType,
  normalizeStructureOutput,
} from "../structureNormalize";

const validOutput = {
  constraints: [
    {
      memberName: "長女",
      type: "unavailable",
      detail: "平日は仕事で日中対応できない",
      days: [4, 0, 1, 2, 3, 0],
      startHour: 9,
      endHour: 18,
    },
    {
      memberName: "母",
      type: "hope",
      detail: "午前中は自宅で見守りたい",
      days: [],
      startHour: null,
      endHour: null,
    },
  ],
  hopes: ["週末は家族で分担したい", ""],
  unknowns: ["父の夜間の状態は書かれていない"],
};

describe("normalizeStructureOutput", () => {
  it("妥当な出力を正規化する（days の重複除去・ソート、空文字の除去）", () => {
    const result = normalizeStructureOutput(validOutput);
    expect(result.constraints).toHaveLength(2);
    expect(result.constraints[0]).toEqual({
      memberName: "長女",
      type: "unavailable",
      detail: "平日は仕事で日中対応できない",
      days: [0, 1, 2, 3, 4],
      startHour: 9,
      endHour: 18,
    });
    // hope で時刻が null の場合はキー自体を持たない下書きになる
    expect(result.constraints[1]).toEqual({
      memberName: "母",
      type: "hope",
      detail: "午前中は自宅で見守りたい",
      days: [],
    });
    expect(result.hopes).toEqual(["週末は家族で分担したい"]);
    expect(result.unknowns).toEqual(["父の夜間の状態は書かれていない"]);
  });

  it("未知の余分なキーは捨てて正常に正規化する", () => {
    const outputWithExtra = {
      ...validOutput,
      extraKey: "discard-me",
      metadata: { source: "gemini" },
      constraints: [
        {
          ...validOutput.constraints[0],
          memo: "ignored memo",
          dayNames: ["月", "火"],
        },
      ],
    };
    const result = normalizeStructureOutput(outputWithExtra);
    expect(result.constraints).toHaveLength(1);
    expect(result.constraints[0]).toEqual({
      memberName: "長女",
      type: "unavailable",
      detail: "平日は仕事で日中対応できない",
      days: [0, 1, 2, 3, 4],
      startHour: 9,
      endHour: 18,
    });
    expect((result.constraints[0] as unknown as Record<string, unknown>).memo).toBeUndefined();
  });

  it("数値文字列を数値に直して正規化する（曜日・時刻）", () => {
    const outputWithStringNumbers = {
      constraints: [
        {
          memberName: "私",
          type: "unavailable",
          detail: "平日勤務",
          days: ["0", "1", "2"],
          startHour: "9",
          endHour: "18",
        },
      ],
      hopes: [],
      unknowns: [],
    };
    const result = normalizeStructureOutput(outputWithStringNumbers);
    expect(result.constraints[0].days).toEqual([0, 1, 2]);
    expect(result.constraints[0].startHour).toBe(9);
    expect(result.constraints[0].endHour).toBe(18);
  });

  it("終了時刻「24:00」を許容し 24 に変換する", () => {
    const outputWithMidnight = {
      constraints: [
        {
          memberName: "長女",
          type: "unavailable",
          detail: "夜勤",
          days: [0, 3],
          startHour: "18:00",
          endHour: "24:00",
        },
      ],
      hopes: [],
      unknowns: [],
    };
    const result = normalizeStructureOutput(outputWithMidnight);
    expect(result.constraints[0].startHour).toBe(18);
    expect(result.constraints[0].endHour).toBe(24);
  });

  it("任意項目の欠落を既定値で補う", () => {
    const minimalOutput = {
      constraints: [
        {
          memberName: "母",
          type: "hope",
          detail: "散歩を手伝いたい",
          // days, startHour, endHour 省略
        },
      ],
      // hopes, unknowns 省略
    };
    const result = normalizeStructureOutput(minimalOutput);
    expect(result.constraints[0].days).toEqual([]);
    expect(result.constraints[0].startHour).toBeUndefined();
    expect(result.constraints[0].endHour).toBeUndefined();
    expect(result.hopes).toEqual([]);
    expect(result.unknowns).toEqual([]);
  });

  describe("再現文 fixture の正規化", () => {
    it("再現文1:「父要介護３／母基本いつでもOK／私平日水曜以外は無理」の出力を正規化できる", () => {
      const fixture = {
        constraints: [
          {
            memberName: "私",
            type: "unavailable",
            detail: "平日水曜以外は仕事で無理",
            days: ["0", "1", "3", "4"],
            startHour: "9",
            endHour: "18",
            unnecessaryKey: "父は要介護3",
          },
        ],
        hopes: ["母は基本いつでもOK"],
        unknowns: ["父の介護状況についての詳細"],
      };
      const result = normalizeStructureOutput(fixture);
      expect(result.constraints).toHaveLength(1);
      expect(result.constraints[0]).toEqual({
        memberName: "私",
        type: "unavailable",
        detail: "平日水曜以外は仕事で無理",
        days: [0, 1, 3, 4],
        startHour: 9,
        endHour: 18,
      });
      expect(result.hopes).toEqual(["母は基本いつでもOK"]);
    });

    it("再現文2:「父は要介護3です。母はいつでも手伝えます。私は水曜日以外、平日は仕事で無理です。」の出力を正規化できる", () => {
      const fixture = {
        constraints: [
          {
            memberName: "私",
            type: "unavailable",
            detail: "水曜日以外、平日は仕事で無理",
            days: [0, 1, 3, 4],
            startHour: 9,
            endHour: "24:00",
          },
        ],
        hopes: ["母はいつでも手伝えます"],
        unknowns: [],
      };
      const result = normalizeStructureOutput(fixture);
      expect(result.constraints[0].endHour).toBe(24);
      expect(result.constraints[0].days).toEqual([0, 1, 3, 4]);
    });

    it("再現文3:「長女は月曜と木曜は夜勤で無理。それ以外は大丈夫。」の出力を正規化できる", () => {
      const fixture = {
        constraints: [
          {
            memberName: "長女",
            type: "unavailable",
            detail: "月曜と木曜は夜勤で無理",
            days: ["0", "3"],
            startHour: 18,
            endHour: "24:00",
            notes: "それ以外は大丈夫",
          },
        ],
        hopes: [],
        unknowns: [],
      };
      const result = normalizeStructureOutput(fixture);
      expect(result.constraints).toHaveLength(1);
      expect(result.constraints[0].days).toEqual([0, 3]);
      expect(result.constraints[0].endHour).toBe(24);
    });

    it("再現文4:「私は大学生で、授業がある平日昼間は無理。夜は大丈夫。」対象者が家族にいない場合は条件0件・unknownsに残す", () => {
      const fixture = {
        constraints: [],
        hopes: [],
        unknowns: [
          "発言者「私」が家族一覧に登録されていないため、制約は作成せず保留としました（平日昼間は授業で無理）",
        ],
      };
      const result = normalizeStructureOutput(fixture);
      expect(result.constraints).toHaveLength(0);
      expect(result.hopes).toHaveLength(0);
      expect(result.unknowns).toHaveLength(1);
    });

    it("実測障害文:「長女は平日仕事／水曜午後は母が通院／長男は土日に限り付き添い可」の表記ゆれ生出力を正規化できる", () => {
      // gemini-3.5-flash-lite がやりがちな生出力（日本語type、単数・日本語曜日、日本語時刻表記の混在）
      const fixture = {
        constraints: [
          {
            memberName: "長女",
            type: "仕事",
            detail: "平日の昼間は付き添えない",
            days: "平日",
            startHour: "9時",
            endHour: "18時",
          },
          {
            memberName: "母",
            type: "通院",
            detail: "水曜の午後は母が通院に付き添う必要がある",
            days: 2,
            startHour: "13:00",
            endHour: "17:00",
          },
          {
            memberName: "長男",
            type: "付き添い可能",
            detail: "長男は土日に限り付き添いができる",
            days: ["土", "日"],
            startHour: null,
            endHour: null,
          },
        ],
        hopes: "土日に限り付き添いができる",
        unknowns: ["母の水曜午後の具体的な通院時間帯"],
      };

      const result = normalizeStructureOutput(fixture);
      expect(result.constraints).toHaveLength(3);

      expect(result.constraints[0]).toEqual({
        memberName: "長女",
        type: "unavailable",
        detail: "平日の昼間は付き添えない",
        days: [0, 1, 2, 3, 4],
        startHour: 9,
        endHour: 18,
      });

      expect(result.constraints[1]).toEqual({
        memberName: "母",
        type: "unavailable",
        detail: "水曜の午後は母が通院に付き添う必要がある",
        days: [2],
        startHour: 13,
        endHour: 17,
      });

      expect(result.constraints[2]).toEqual({
        memberName: "長男",
        type: "hope",
        detail: "長男は土日に限り付き添いができる",
        days: [5, 6],
      });

      expect(result.hopes).toEqual(["土日に限り付き添いができる"]);
      expect(result.unknowns).toEqual(["母の水曜午後の具体的な通院時間帯"]);
    });

    it("Markdownコードフェンスや前置き文が混入した文字列JSONを正常に正規化する", () => {
      const fencedString = "```json\n" + JSON.stringify(validOutput) + "\n```";
      const result = normalizeStructureOutput(fencedString);
      expect(result.constraints).toHaveLength(2);
      expect(result.constraints[0].memberName).toBe("長女");

      const preambleString = "以下は抽出した制約です：\n" + JSON.stringify(validOutput) + "\n以上です。";
      const result2 = normalizeStructureOutput(preambleString);
      expect(result2.constraints).toHaveLength(2);
    });

    it("列挙値（type）の表記ゆれと同義語を安全に正規化する", () => {
      const testCases: [unknown, string][] = [
        ["WORK", "unavailable"],
        ["Work", "unavailable"],
        ["work", "unavailable"],
        ["仕事", "unavailable"],
        ["勤務", "unavailable"],
        ["就労", "unavailable"],
        ["UNAVAILABLE", "unavailable"],
        ["not_available", "unavailable"],
        ["not-available", "unavailable"],
        ["外出", "unavailable"],
        ["用事", "unavailable"],
        ["対応不可", "unavailable"],
        ["通院", "unavailable"],
        ["HOPE", "hope"],
        ["希望", "hope"],
        ["要望", "hope"],
        ["付き添い可能", "hope"],
        ["OTHER", "other"],
        ["その他", "other"],
      ];

      for (const [rawType, expectedType] of testCases) {
        const output = {
          constraints: [
            {
              memberName: "家族",
              type: rawType,
              detail: "詳細",
              days: [0],
              startHour: 9,
              endHour: 17,
            },
          ],
        };
        const result = normalizeStructureOutput(output);
        expect(result.constraints[0].type).toBe(expectedType);
      }
    });

    it("曜日の形式ゆれ（単数、日本語表記、全角数字、マクロ表現）を安全に正規化する", () => {
      // 単数数値
      expect(
        normalizeStructureOutput({
          constraints: [
            { memberName: "母", type: "other", detail: "用事", days: 2 },
          ],
        }).constraints[0].days,
      ).toEqual([2]);

      // 日本語曜日配列
      expect(
        normalizeStructureOutput({
          constraints: [
            {
              memberName: "母",
              type: "other",
              detail: "用事",
              days: ["月", "水曜", "金曜日"],
            },
          ],
        }).constraints[0].days,
      ).toEqual([0, 2, 4]);

      // 「平日」「土日」「毎日」
      expect(
        normalizeStructureOutput({
          constraints: [
            { memberName: "母", type: "other", detail: "用事", days: "平日" },
          ],
        }).constraints[0].days,
      ).toEqual([0, 1, 2, 3, 4]);

      expect(
        normalizeStructureOutput({
          constraints: [
            { memberName: "母", type: "other", detail: "用事", days: ["土日"] },
          ],
        }).constraints[0].days,
      ).toEqual([5, 6]);

      expect(
        normalizeStructureOutput({
          constraints: [
            { memberName: "母", type: "other", detail: "用事", days: ["毎日"] },
          ],
        }).constraints[0].days,
      ).toEqual([0, 1, 2, 3, 4, 5, 6]);

      // 全角数字
      expect(
        normalizeStructureOutput({
          constraints: [
            { memberName: "母", type: "other", detail: "用事", days: ["０", "３"] },
          ],
        }).constraints[0].days,
      ).toEqual([0, 3]);

      // 空文字・null
      expect(
        normalizeStructureOutput({
          constraints: [
            { memberName: "母", type: "other", detail: "用事", days: "" },
          ],
        }).constraints[0].days,
      ).toEqual([]);
    });

    it("時刻表記のゆれ（日本語「9時」、全角文字、分「9時00分」）を安全に正規化する", () => {
      const result = normalizeStructureOutput({
        constraints: [
          {
            memberName: "長女",
            type: "unavailable",
            detail: "仕事",
            days: [0],
            startHour: "9時",
            endHour: "18時",
          },
          {
            memberName: "長男",
            type: "unavailable",
            detail: "仕事",
            days: [1],
            startHour: "９",
            endHour: "２４時",
          },
          {
            memberName: "母",
            type: "unavailable",
            detail: "通院",
            days: [2],
            startHour: "10時00分",
            endHour: "12時00分",
          },
        ],
      });

      expect(result.constraints[0].startHour).toBe(9);
      expect(result.constraints[0].endHour).toBe(18);
      expect(result.constraints[1].startHour).toBe(9);
      expect(result.constraints[1].endHour).toBe(24);
      expect(result.constraints[2].startHour).toBe(10);
      expect(result.constraints[2].endHour).toBe(12);
    });

    it("hopes／unknowns が単一文字列や null/空配列でも安全に正規化する", () => {
      const result = normalizeStructureOutput({
        constraints: [
          { memberName: "長女", type: "other", detail: "内容", days: [] },
        ],
        hopes: "単一の希望文字列",
        unknowns: null,
      });
      expect(result.hopes).toEqual(["単一の希望文字列"]);
      expect(result.unknowns).toEqual([]);
    });

    it("allowPartial: true のときは不正な制約を unknowns に落として正常な制約を救う", () => {
      const partialFixture = {
        constraints: [
          {
            memberName: "長女",
            type: "unavailable",
            detail: "平日は仕事",
            days: [0, 1, 2, 3, 4],
            startHour: 9,
            endHour: 18,
          },
          {
            memberName: "長男",
            type: "unavailable",
            detail: "仕事（時刻欠落）",
            days: [0],
            startHour: null,
            endHour: null,
          },
        ],
        hopes: ["週末は分担"],
        unknowns: ["夜間状況不明"],
      };

      // allowPartial なし（既定）は従来通り NormalizeError
      expect(() => normalizeStructureOutput(partialFixture)).toThrow(NormalizeError);

      // allowPartial: true なら正常な制約（長女）を救い、長男を unknowns に落とす
      const rescued = normalizeStructureOutput(partialFixture, { allowPartial: true });
      expect(rescued.constraints).toHaveLength(1);
      expect(rescued.constraints[0].memberName).toBe("長女");
      expect(rescued.hopes).toEqual(["週末は分担"]);
      expect(rescued.unknowns).toHaveLength(2);
      expect(rescued.unknowns[1]).toContain("仕事（時刻欠落）");
      expect(rescued.unknowns[1]).toContain("除外しました");
    });
  });

  describe("従来どおり拒否するケース", () => {
    it("type が enum 外だと拒否する", () => {
      expect(() =>
        normalizeStructureOutput({
          ...validOutput,
          constraints: [{ ...validOutput.constraints[0], type: "medical" }],
        }),
      ).toThrow(NormalizeError);
    });

    it("unavailable で時刻が欠けると拒否する", () => {
      expect(() =>
        normalizeStructureOutput({
          ...validOutput,
          constraints: [
            {
              memberName: "長男",
              type: "unavailable",
              detail: "仕事",
              days: [0],
              startHour: null,
              endHour: null,
            },
          ],
        }),
      ).toThrow(NormalizeError);
    });

    it("unavailable で days が空だと拒否する", () => {
      expect(() =>
        normalizeStructureOutput({
          ...validOutput,
          constraints: [
            {
              memberName: "長男",
              type: "unavailable",
              detail: "外出",
              days: [],
              startHour: 10,
              endHour: 12,
            },
          ],
        }),
      ).toThrow(NormalizeError);
    });

    it("時刻の片方だけあると拒否する", () => {
      expect(() =>
        normalizeStructureOutput({
          ...validOutput,
          constraints: [
            {
              memberName: "母",
              type: "hope",
              detail: "希望",
              days: [],
              startHour: 9,
              endHour: null,
            },
          ],
        }),
      ).toThrow(NormalizeError);
    });

    it("時刻範囲が逆転していると拒否する", () => {
      expect(() =>
        normalizeStructureOutput({
          ...validOutput,
          constraints: [
            {
              memberName: "長女",
              type: "unavailable",
              detail: "仕事",
              days: [0],
              startHour: 18,
              endHour: 9,
            },
          ],
        }),
      ).toThrow(NormalizeError);
    });

    it("解釈できない時刻は拒否する", () => {
      expect(() =>
        normalizeStructureOutput({
          constraints: [
            {
              memberName: "長女",
              type: "unavailable",
              detail: "仕事",
              days: [0],
              startHour: "午前9時",
              endHour: 18,
            },
          ],
        }),
      ).toThrow(NormalizeError);

      expect(() =>
        normalizeStructureOutput({
          constraints: [
            {
              memberName: "長女",
              type: "unavailable",
              detail: "仕事",
              days: [0],
              startHour: "09:30",
              endHour: 18,
            },
          ],
        }),
      ).toThrow(NormalizeError);
    });

    it("核になる constraints が配列でない場合は拒否する", () => {
      expect(() =>
        normalizeStructureOutput({
          constraints: "not-an-array",
        }),
      ).toThrow(NormalizeError);
    });

    it("オブジェクトでない出力は拒否する", () => {
      expect(() => normalizeStructureOutput("text")).toThrow(NormalizeError);
      expect(() => normalizeStructureOutput(null)).toThrow(NormalizeError);
    });
  });

  describe("保存済みデータ（旧 type: work）の互換正規化", () => {
    it("normalizeSavedConstraintType は旧値 work を unavailable に変換する", () => {
      expect(normalizeSavedConstraintType("work")).toBe("unavailable");
      expect(normalizeSavedConstraintType("unavailable")).toBe("unavailable");
      expect(normalizeSavedConstraintType("hope")).toBe("hope");
      expect(normalizeSavedConstraintType("other")).toBe("other");
    });

    it("normalizeSavedConstraints は保存済み配列内の work を unavailable に変換する", () => {
      const legacy = [
        {
          personId: "p-1",
          type: "work",
          detail: "平日は仕事",
          days: [0, 1, 2, 3, 4],
          startHour: 9,
          endHour: 18,
        },
        {
          personId: "p-2",
          type: "hope",
          detail: "週末希望",
          days: [],
        },
      ] as unknown as Constraint[];
      const normalized = normalizeSavedConstraints(legacy);
      expect(normalized[0].type).toBe("unavailable");
      expect(normalized[1].type).toBe("hope");
    });

    it("normalizeLegacyConstraintTypeInput は work のみ unavailable に写像し、不正値はそのまま返す", () => {
      expect(normalizeLegacyConstraintTypeInput("work")).toBe("unavailable");
      expect(normalizeLegacyConstraintTypeInput("unavailable")).toBe("unavailable");
      expect(normalizeLegacyConstraintTypeInput("invalid")).toBe("invalid");
    });
  });
});
