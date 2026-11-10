import { describe, expect, it } from "vitest";
import type { RoomSnapshot, ValidationResult } from "../../types";
import {
  FakeGeminiPort,
  FakeMembershipPort,
  FakeRateLimitPort,
  FakeRoomReadPort,
  FakeValidationPort,
  makeFakePorts,
} from "../fakes";
import { handleProposalsRequest, handleStructureRequest } from "../handlers";
import type { ServerPorts } from "../ports";

const snapshot: RoomSnapshot = {
  people: [
    { id: "person-care", name: "父", canProvideCare: false },
    { id: "person-eldest", name: "長女", canProvideCare: true },
  ],
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
  hopes: [],
  unknowns: [],
  careWindows: [{ day: 0, startHour: 7, endHour: 21 }],
  copayRate: 1,
  revision: 3,
};

const ngValidation: ValidationResult = {
  ok: false,
  weeklyUnits: 7000,
  monthlyUnits: 30000,
  limitUnits: 27048,
  overUnits: 2952,
  selfPayYen: 100000,
  selfPayBreakdown: { withinYen: 27048, overYen: 72952 },
  gaps: [],
  memberHours: [{ personId: "person-eldest", hours: 3 }],
  overloads: [],
  hardViolations: [],
  validationErrors: [],
};

const structureGeminiOutput = {
  constraints: [
    {
      memberName: "長女",
      type: "unavailable",
      detail: "平日は仕事",
      days: [0, 1, 2, 3, 4],
      startHour: 9,
      endHour: 18,
    },
  ],
  hopes: [],
  unknowns: ["夜間の状態は不明"],
};

function portsWith(overrides: Partial<ServerPorts> = {}): ServerPorts {
  const rooms = new FakeRoomReadPort().setSnapshot("room-1", snapshot);
  return makeFakePorts({ rooms, ...overrides });
}

describe("handleStructureRequest", () => {
  const baseInput = {
    idToken: "test-token",
    roomId: "room-1",
    memo: "長女は平日仕事です",
    images: [],
  };

  it("トークンがなければ 401", async () => {
    const result = await handleStructureRequest(portsWith(), {
      ...baseInput,
      idToken: null,
    });
    expect(result.status).toBe(401);
  });

  it("トークンが検証できなければ 401", async () => {
    const result = await handleStructureRequest(portsWith(), {
      ...baseInput,
      idToken: "wrong-token",
    });
    expect(result.status).toBe(401);
  });

  it("careManager は 403（family のみ）", async () => {
    const membership = new FakeMembershipPort().setRole(
      "room-1",
      "user-1",
      "careManager",
    );
    const result = await handleStructureRequest(
      portsWith({ membership }),
      baseInput,
    );
    expect(result.status).toBe(403);
  });

  it("未参加者は 403", async () => {
    const membership = new FakeMembershipPort();
    const result = await handleStructureRequest(
      portsWith({ membership }),
      baseInput,
    );
    expect(result.status).toBe(403);
  });

  it("画像が大きすぎると 413 で、回数枠は消費しない", async () => {
    const rateLimit = new FakeRateLimitPort();
    const result = await handleStructureRequest(portsWith({ rateLimit }), {
      ...baseInput,
      images: [
        {
          mimeType: "image/jpeg",
          byteLength: 5 * 1024 * 1024 + 1,
          dataBase64: "AAAA",
        },
      ],
    });
    expect(result.status).toBe(413);
    expect(rateLimit.count("room-1")).toBe(0);
  });

  it("回数枠が尽きていると 429", async () => {
    const rateLimit = new FakeRateLimitPort(0);
    const result = await handleStructureRequest(
      portsWith({ rateLimit }),
      baseInput,
    );
    expect(result.status).toBe(429);
  });

  it("成功すると下書きを返し、回数枠を1回消費する", async () => {
    const rateLimit = new FakeRateLimitPort();
    const gemini = new FakeGeminiPort(async () => structureGeminiOutput);
    const result = await handleStructureRequest(
      portsWith({ rateLimit, gemini }),
      baseInput,
    );
    expect(result.status).toBe(200);
    const body = result.body as typeof structureGeminiOutput;
    expect(body.constraints).toHaveLength(1);
    expect(body.constraints[0].memberName).toBe("長女");
    expect(gemini.calls).toHaveLength(1);
    // プロンプトには家族の名前とメモが含まれる
    expect(gemini.calls[0].prompt).toContain("長女");
    expect(gemini.calls[0].prompt).toContain("平日仕事");
    expect(rateLimit.count("room-1")).toBe(1);
  });

  it("Gemini の出力が形式不正だと 502", async () => {
    const gemini = new FakeGeminiPort(async () => ({ broken: true }));
    const result = await handleStructureRequest(
      portsWith({ gemini }),
      baseInput,
    );
    expect(result.status).toBe(502);
  });

  it("1回目形式不正（NormalizeError）→2回目正常で成功し、2回目のプロンプトに失敗理由が含まれる", async () => {
    let callCount = 0;
    const gemini = new FakeGeminiPort(async () => {
      callCount++;
      if (callCount === 1) {
        // 1回目は type が enum 外で NormalizeError
        return {
          constraints: [
            {
              memberName: "長女",
              type: "invalid_type",
              detail: "仕事",
              days: [0],
              startHour: 9,
              endHour: 18,
            },
          ],
          hopes: [],
          unknowns: [],
        };
      }
      return structureGeminiOutput;
    });

    const result = await handleStructureRequest(
      portsWith({ gemini }),
      baseInput,
    );

    expect(result.status).toBe(200);
    expect(gemini.calls).toHaveLength(2);
    // 2回目のプロンプトに失敗理由が含まれていること
    expect(gemini.calls[1].prompt).toContain("前回の出力が形式不正となった理由");
    expect(gemini.calls[1].prompt).toContain("constraints[0] の type が不正です");
  });

  it("2回目のリトライで一部の制約に不備が残っても、正常な制約を救出して200で返し不備制約はunknownsに記録する", async () => {
    let callCount = 0;
    const gemini = new FakeGeminiPort(async () => {
      callCount++;
      if (callCount === 1) {
        // 1回目は全件不正
        return {
          constraints: [
            {
              memberName: "長女",
              type: "invalid_type",
              detail: "仕事",
              days: [0],
              startHour: 9,
              endHour: 18,
            },
          ],
          hopes: [],
          unknowns: [],
        };
      }
      // 2回目は1件正常、1件不備（unavailableの時刻欠落）
      return {
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
            detail: "仕事（時刻なし）",
            days: [0],
            startHour: null,
            endHour: null,
          },
        ],
        hopes: ["週末は分担"],
        unknowns: [],
      };
    });

    const result = await handleStructureRequest(
      portsWith({ gemini }),
      baseInput,
    );

    expect(result.status).toBe(200);
    const body = result.body as {
      constraints: unknown[];
      hopes: string[];
      unknowns: string[];
    };
    expect(body.constraints).toHaveLength(1);
    expect(body.hopes).toEqual(["週末は分担"]);
    expect(body.unknowns).toHaveLength(1);
    expect(body.unknowns[0]).toContain("仕事（時刻なし）");
  });

  it("条件・希望・支援時間帯がすべて0件なら空成功とせずエラー（502）", async () => {
    const gemini = new FakeGeminiPort(async () => ({
      constraints: [],
      hopes: [],
      unknowns: ["家族に対象者がいません"],
    }));
    const result = await handleStructureRequest(
      portsWith({ gemini }),
      baseInput,
    );
    expect(result.status).toBe(502);
    const body = result.body as { error: string; message: string };
    expect(body.error).toBe("invalid_ai_output");
    expect(body.message).toContain("取り出せませんでした");
  });

  it("Gemini が応答しないと 504（タイムアウト）", async () => {
    const gemini = new FakeGeminiPort(
      () => new Promise<unknown>(() => undefined),
    );
    const result = await handleStructureRequest(
      portsWith({ gemini }),
      baseInput,
      { timeoutMs: 20 },
    );
    expect(result.status).toBe(504);
  });

  it("ルームがなければ 404", async () => {
    const rooms = new FakeRoomReadPort();
    const membership = new FakeMembershipPort().setRole(
      "room-1",
      "user-1",
      "family",
    );
    const result = await handleStructureRequest(
      portsWith({ rooms, membership }),
      baseInput,
    );
    expect(result.status).toBe(404);
  });
});

describe("handleProposalsRequest", () => {
  const baseInput = { idToken: "test-token", roomId: "room-1", baseRevision: 3 };

  const proposalGeminiOutput = {
    proposals: [
      {
        summary: "訪問介護を午後にずらす",
        changes: [
          { placementId: "p-visit", action: "move", day: 0, startHour: 13 },
        ],
      },
    ],
  };

  const okValidation: ValidationResult = {
    ok: true,
    weeklyUnits: 6311,
    monthlyUnits: 27047,
    limitUnits: 27048,
    overUnits: 0,
    selfPayYen: 27047,
    selfPayBreakdown: { withinYen: 27047, overYen: 0 },
    gaps: [],
    memberHours: [{ personId: "person-eldest", hours: 3 }],
    overloads: [],
    hardViolations: [],
    validationErrors: [],
  };

  /**
   * エンジンの振る舞いの再現：現在の配置（p-visit が 9時開始）は NG、
   * 「午後にずらす」試し適用後（13時開始）は OK を返す入力対応フェイク。
   * 試し適用＋再検証（Issue 8 本接続）の検証に使う。
   */
  const engineLikeValidation = (snap: RoomSnapshot): ValidationResult => {
    const visit = snap.placements.find((p) => p.id === "p-visit");
    return visit && visit.startHour === 13 ? okValidation : ngValidation;
  };

  it("revision がずれていたら 409 で Gemini は呼ばない", async () => {
    const gemini = new FakeGeminiPort(async () => proposalGeminiOutput);
    const result = await handleProposalsRequest(
      portsWith({ gemini, validation: new FakeValidationPort(ngValidation) }),
      { ...baseInput, baseRevision: 2 },
    );
    expect(result.status).toBe(409);
    expect(gemini.calls).toHaveLength(0);
  });

  it("検証が OK なら代替案は空で、Gemini は呼ばず回数枠も消費しない", async () => {
    const gemini = new FakeGeminiPort(async () => proposalGeminiOutput);
    const rateLimit = new FakeRateLimitPort();
    const result = await handleProposalsRequest(
      portsWith({ gemini, rateLimit }),
      baseInput,
    );
    expect(result.status).toBe(200);
    expect(result.body).toEqual({ proposals: [], baseRevision: 3 });
    expect(gemini.calls).toHaveLength(0);
    expect(rateLimit.count("room-1")).toBe(0);
  });

  it("NG のときは試し適用で検証済みの代替案を返し、baseRevision はスナップショットの値を付ける", async () => {
    const gemini = new FakeGeminiPort(async () => ({
      ...proposalGeminiOutput,
      baseRevision: 999,
    }));
    const result = await handleProposalsRequest(
      portsWith({
        gemini,
        validation: new FakeValidationPort(engineLikeValidation),
      }),
      baseInput,
    );
    expect(result.status).toBe(200);
    const body = result.body as {
      proposals: { baseRevision: number }[];
      baseRevision: number;
    };
    expect(body.baseRevision).toBe(3);
    expect(body.proposals).toHaveLength(1);
    expect(body.proposals[0].baseRevision).toBe(3);
    // プロンプトには NG 理由（限度額超過）が含まれる
    expect(gemini.calls[0].prompt).toContain("2952");
  });

  it("試し適用で OK にならない案は返さない（検証済みの案だけを提示する）", async () => {
    const gemini = new FakeGeminiPort(async () => ({
      proposals: [
        {
          summary: "少しだけずらす",
          changes: [
            { placementId: "p-visit", action: "move", day: 0, startHour: 10 },
          ],
        },
      ],
    }));
    const result = await handleProposalsRequest(
      portsWith({
        gemini,
        validation: new FakeValidationPort(engineLikeValidation),
      }),
      baseInput,
    );
    expect(result.status).toBe(200);
    expect(result.body).toEqual({ proposals: [], baseRevision: 3 });
  });

  it("複数案のうち、再検証で OK になった案だけを返す", async () => {
    const gemini = new FakeGeminiPort(async () => ({
      proposals: [
        {
          summary: "少しだけずらす",
          changes: [
            { placementId: "p-visit", action: "move", day: 0, startHour: 10 },
          ],
        },
        {
          summary: "訪問介護を午後にずらす",
          changes: [
            { placementId: "p-visit", action: "move", day: 0, startHour: 13 },
          ],
        },
      ],
    }));
    const result = await handleProposalsRequest(
      portsWith({
        gemini,
        validation: new FakeValidationPort(engineLikeValidation),
      }),
      baseInput,
    );
    expect(result.status).toBe(200);
    const body = result.body as { proposals: { summary: string }[] };
    expect(body.proposals).toHaveLength(1);
    expect(body.proposals[0].summary).toBe("訪問介護を午後にずらす");
  });

  it("回数枠が尽きていると 429", async () => {
    const result = await handleProposalsRequest(
      portsWith({
        rateLimit: new FakeRateLimitPort(0),
        validation: new FakeValidationPort(ngValidation),
      }),
      baseInput,
    );
    expect(result.status).toBe(429);
  });
});
