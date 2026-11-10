/**
 * Gemini 構造化（Issue 7）の responseSchema。
 *
 * 出力の形は共通前提の「制約（保存時）」の下書き版に固定する：
 * { constraints: ConstraintDraft[], hopes: string[], unknowns: string[] }
 * 下書き段階では personId ではなく名前（memberName）で表す（保存時に personId へ結びつける）。
 *
 * responseSchema は形式の拘束にすぎない。返ってきた出力は必ず
 * structureNormalize.ts の正規化・検証を通すこと（生出力は信頼しない）。
 */

import { Type, type Schema } from "@google/genai";

export const structureResponseSchema: Schema = {
  type: Type.OBJECT,
  description: "家族の事情を整理した制約JSONの下書き",
  properties: {
    constraints: {
      type: Type.ARRAY,
      description: "家族ごとの制約（対応不可・希望・その他）",
      items: {
        type: Type.OBJECT,
        properties: {
          memberName: {
            type: Type.STRING,
            description: "家族一覧に載っている名前をそのまま書く",
          },
          type: {
            type: Type.STRING,
            enum: ["hope", "unavailable", "other"],
            description:
              "unavailable=開始・終了時刻が特定できる対応不可（仕事・通院・外出・用事など理由は問わない） / hope=希望・要望 / other=その他（時刻が特定できない仕事や用事・対応不可を含む）",
          },
          detail: {
            type: Type.STRING,
            description: "内容。入力に書かれた表現に忠実に短く書く",
          },
          days: {
            type: Type.ARRAY,
            description: "対象の曜日。月=0 〜 日=6。対象がなければ空配列",
            items: { type: Type.INTEGER },
          },
          startHour: {
            type: Type.INTEGER,
            nullable: true,
            description:
              "開始時刻（24時間制の整数）。時刻が特定できない場合は null",
          },
          endHour: {
            type: Type.INTEGER,
            nullable: true,
            description:
              "終了時刻（24時間制の整数、半開区間の終端）。時刻が特定できない場合は null",
          },
        },
        required: ["memberName", "type", "detail", "days"],
      },
    },
    hopes: {
      type: Type.ARRAY,
      description: "家族の希望（自由記述）。制約に落とせない希望はこちらにも書く",
      items: { type: Type.STRING },
    },
    unknowns: {
      type: Type.ARRAY,
      description:
        "入力に書かれておらず分からないこと。推測で埋めず、ここに具体的に書く",
      items: { type: Type.STRING },
    },
  },
  required: ["constraints", "hopes", "unknowns"],
};
