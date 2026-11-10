/**
 * Gemini 代替案（Issue 8）の responseSchema。
 *
 * 出力の形は共通前提の生出力の形に固定する：
 * { proposals: [{ summary, changes: [{ placementId?, action, day?, startHour?, endHour?, kind?, serviceId?, personId? }] }] }
 *
 * - placementId は move／resize／remove の対象指定用にスキーマへ残す。
 *   add では Gemini に採番させない（含まれていても正規化で無視し、サーバーが採番する）。
 * - baseRevision はスキーマに含めない（AI が返した値は捨て、サーバーが付け直す）。
 * - 変更の項目は全て required にする（値は nullable）。action によって使わない項目は
 *   null で返させ、正規化側の stripNulls が取り除く。required にしないと、モデルが
 *   必要な項目そのものを省略して出力し、正規化で弾かれる（構造化で起きた失敗と同じ）。
 * - responseSchema は形式の拘束にすぎない。意味検査は proposalNormalize.ts が担う。
 */

import { Type, type Schema } from "@google/genai";

export const proposalResponseSchema: Schema = {
  type: Type.OBJECT,
  description: "検証でNGになった週間プランへの代替案（最大3案）",
  properties: {
    proposals: {
      type: Type.ARRAY,
      maxItems: "3",
      items: {
        type: Type.OBJECT,
        properties: {
          summary: {
            type: Type.STRING,
            description: "この案で何がどう良くなるかの短い説明",
          },
          changes: {
            type: Type.ARRAY,
            description: "配置への変更リスト",
            items: {
              type: Type.OBJECT,
              properties: {
                placementId: {
                  type: Type.STRING,
                  nullable: true,
                  description:
                    "move／resize／remove の対象の配置ID。add のときは null（IDはサーバーが採番する）",
                },
                action: {
                  type: Type.STRING,
                  enum: ["move", "resize", "add", "remove"],
                },
                day: {
                  type: Type.INTEGER,
                  nullable: true,
                  description: "曜日（月=0 〜 日=6）。move と add で使う",
                },
                startHour: {
                  type: Type.INTEGER,
                  nullable: true,
                  description: "開始時刻。move／resize／add で使う",
                },
                endHour: {
                  type: Type.INTEGER,
                  nullable: true,
                  description: "終了時刻。resize／add で使う（move では使わない）",
                },
                kind: {
                  type: Type.STRING,
                  enum: ["visit", "daycare", "dayrehab", "shortstay", "family"],
                  nullable: true,
                  description: "配置の種別。add でだけ使う",
                },
                serviceId: {
                  type: Type.STRING,
                  nullable: true,
                  description: "サービスのID。add（family 以外）で使う",
                },
                personId: {
                  type: Type.STRING,
                  nullable: true,
                  description: "付き添う家族のID。add（family）でだけ使う",
                },
              },
              required: [
                "placementId",
                "action",
                "day",
                "startHour",
                "endHour",
                "kind",
                "serviceId",
                "personId",
              ],
            },
          },
        },
        required: ["summary", "changes"],
      },
    },
  },
  required: ["proposals"],
};
