import { describe, expect, it } from "vitest";
import type { Placement } from "../../types";
import { NormalizeError } from "../normalizeUtil";
import { normalizeProposals, type ProposalNormalizeContext } from "../proposalNormalize";

const placements: Placement[] = [
  { id: "p-visit", day: 0, startHour: 9, endHour: 11, kind: "visit", serviceId: "visit-body-60" },
  { id: "p-family", day: 1, startHour: 18, endHour: 21, kind: "family", personId: "person-eldest" },
  { id: "p-daycare", day: 2, startHour: 9, endHour: 16, kind: "daycare", serviceId: "daycare-7h" },
];

const people = [
  { id: "person-care" },
  { id: "person-mother" },
  { id: "person-eldest" },
];

let idCounter = 0;
function ctx(overrides: Partial<ProposalNormalizeContext> = {}): ProposalNormalizeContext {
  return {
    placements,
    people,
    baseRevision: 7,
    newId: () => `server-id-${++idCounter}`,
    ...overrides,
  };
}

describe("normalizeProposals", () => {
  it("move／resize／remove を正規化し、baseRevision はサーバー値を付ける", () => {
    const result = normalizeProposals(
      {
        baseRevision: 999, // AI の値は捨てられる
        proposals: [
          {
            summary: "訪問介護を午後にずらす",
            baseRevision: 123,
            changes: [
              { placementId: "p-visit", action: "move", day: 0, startHour: 13 },
            ],
          },
          {
            summary: "通所を短くし、付き添いを消す",
            changes: [
              { placementId: "p-daycare", action: "resize", startHour: 9, endHour: 15 },
              { placementId: "p-family", action: "remove" },
            ],
          },
        ],
      },
      ctx(),
    );
    expect(result).toHaveLength(2);
    expect(result[0].baseRevision).toBe(7);
    expect(result[0].changes).toEqual([
      { action: "move", placementId: "p-visit", day: 0, startHour: 13 },
    ]);
    expect(result[1].changes).toEqual([
      { action: "resize", placementId: "p-daycare", startHour: 9, endHour: 15 },
      { action: "remove", placementId: "p-family" },
    ]);
  });

  it("add はサーバーが採番し、AI が付けた placementId は無視する", () => {
    idCounter = 0;
    const result = normalizeProposals(
      {
        proposals: [
          {
            summary: "付き添いを追加する",
            changes: [
              {
                placementId: "ai-made-id",
                action: "add",
                day: 3,
                startHour: 18,
                endHour: 20,
                kind: "family",
                personId: "person-mother",
              },
              {
                action: "add",
                day: 4,
                startHour: 10,
                endHour: 12,
                kind: "visit",
                serviceId: "visit-body-60",
              },
            ],
          },
        ],
      },
      ctx(),
    );
    const changes = result[0].changes;
    expect(changes[0]).toMatchObject({ action: "add", placementId: "server-id-1" });
    expect(changes[1]).toMatchObject({ action: "add", placementId: "server-id-2" });
    // 2件の add で ID が重複しない
    expect(changes[0].placementId).not.toBe(changes[1].placementId);
  });

  it("既定の採番は UUID 形式", () => {
    const result = normalizeProposals(
      {
        proposals: [
          {
            summary: "追加",
            changes: [
              { action: "add", day: 0, startHour: 9, endHour: 10, kind: "visit", serviceId: "s1" },
            ],
          },
        ],
      },
      ctx({ newId: undefined }),
    );
    expect(result[0].changes[0].placementId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
  });

  it("未知の placementId は拒否する", () => {
    expect(() =>
      normalizeProposals(
        {
          proposals: [
            { summary: "x", changes: [{ placementId: "nope", action: "remove" }] },
          ],
        },
        ctx(),
      ),
    ).toThrow(NormalizeError);
  });

  it("同一IDへの複数操作は拒否する", () => {
    expect(() =>
      normalizeProposals(
        {
          proposals: [
            {
              summary: "x",
              changes: [
                { placementId: "p-visit", action: "move", day: 1, startHour: 10 },
                { placementId: "p-visit", action: "resize", startHour: 10, endHour: 12 },
              ],
            },
          ],
        },
        ctx(),
      ),
    ).toThrow(NormalizeError);
  });

  it("削除済みIDへの操作は拒否する", () => {
    expect(() =>
      normalizeProposals(
        {
          proposals: [
            {
              summary: "x",
              changes: [
                { placementId: "p-visit", action: "remove" },
                { placementId: "p-visit", action: "move", day: 1, startHour: 10 },
              ],
            },
          ],
        },
        ctx(),
      ),
    ).toThrow(NormalizeError);
  });

  it("remove に余分な項目があると拒否する", () => {
    expect(() =>
      normalizeProposals(
        {
          proposals: [
            {
              summary: "x",
              changes: [{ placementId: "p-visit", action: "remove", day: 1 }],
            },
          ],
        },
        ctx(),
      ),
    ).toThrow(NormalizeError);
  });

  it("move に endHour があると拒否する", () => {
    expect(() =>
      normalizeProposals(
        {
          proposals: [
            {
              summary: "x",
              changes: [
                { placementId: "p-visit", action: "move", day: 1, startHour: 10, endHour: 12 },
              ],
            },
          ],
        },
        ctx(),
      ),
    ).toThrow(NormalizeError);
  });

  it("move で元の長さのまま24時を超えると拒否する", () => {
    // p-visit は2時間。23時開始だと25時終了になる
    expect(() =>
      normalizeProposals(
        {
          proposals: [
            {
              summary: "x",
              changes: [{ placementId: "p-visit", action: "move", day: 0, startHour: 23 }],
            },
          ],
        },
        ctx(),
      ),
    ).toThrow(NormalizeError);
  });

  it("family の add に serviceId があると拒否する（kind との不整合）", () => {
    expect(() =>
      normalizeProposals(
        {
          proposals: [
            {
              summary: "x",
              changes: [
                {
                  action: "add",
                  day: 0,
                  startHour: 9,
                  endHour: 10,
                  kind: "family",
                  personId: "person-mother",
                  serviceId: "s1",
                },
              ],
            },
          ],
        },
        ctx(),
      ),
    ).toThrow(NormalizeError);
  });

  it("family 以外の add に serviceId がないと拒否する", () => {
    expect(() =>
      normalizeProposals(
        {
          proposals: [
            {
              summary: "x",
              changes: [
                { action: "add", day: 0, startHour: 9, endHour: 10, kind: "visit" },
              ],
            },
          ],
        },
        ctx(),
      ),
    ).toThrow(NormalizeError);
  });

  it("add の personId が家族に存在しないと拒否する", () => {
    expect(() =>
      normalizeProposals(
        {
          proposals: [
            {
              summary: "x",
              changes: [
                {
                  action: "add",
                  day: 0,
                  startHour: 9,
                  endHour: 10,
                  kind: "family",
                  personId: "person-unknown",
                },
              ],
            },
          ],
        },
        ctx(),
      ),
    ).toThrow(NormalizeError);
  });

  it("4案以上は先頭3案に丸める", () => {
    const proposal = {
      summary: "x",
      changes: [{ placementId: "p-visit", action: "remove" }],
    };
    const result = normalizeProposals(
      { proposals: [proposal, proposal, proposal, proposal] },
      ctx(),
    );
    expect(result).toHaveLength(3);
  });

  it("余分なトップレベルキーは拒否する", () => {
    expect(() =>
      normalizeProposals({ proposals: [], note: "extra" }, ctx()),
    ).toThrow(NormalizeError);
  });
});
