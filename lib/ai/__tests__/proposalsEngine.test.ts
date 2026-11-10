/**
 * Issue 8 本接続の結合テスト：実エンジン（Issue 6 の validateRoom）と
 * fixture（Issue 10）を使い、「揉めるプラン → 固定 changes の試し適用 →
 * 再検証 → 納得プラン（ok=true）」が一本通ることを確認する。
 *
 * Gemini だけはフェイク（GEMINI_API_KEY 未発行のため実コールは未検証）。
 * 検証エンジン・正規化・試し適用はすべて実物を使う。
 * ValidationPort の差し方は lib/server/ports.ts の実物と同じ。
 */

import { describe, expect, it } from "vitest";
import { applyChanges } from "../../apply-changes";
import { demoFixture } from "../../demo-fixture";
import type {
  Placement,
  Proposal,
  ProposalChange,
  RawProposalChange,
  RoomSnapshot,
} from "../../types";
import { validateRoom } from "../../validation";
import {
  FakeGeminiPort,
  FakeRoomReadPort,
  makeFakePorts,
} from "../fakes";
import { handleProposalsRequest } from "../handlers";
import type { ServerPorts, ValidationPort } from "../ports";

/** lib/server/ports.ts の実物と同じ配線（ValidationPort に実エンジンを差す） */
const realValidation: ValidationPort = {
  validate: (snapshot) => validateRoom(snapshot),
};

const REVISION = 7;

function fixtureSnapshot(): RoomSnapshot {
  return {
    people: demoFixture.people,
    placements: demoFixture.troubledPlan.placements,
    constraints: demoFixture.constraints,
    hopes: demoFixture.hopes,
    unknowns: demoFixture.unknowns,
    careWindows: demoFixture.careWindows,
    copayRate: demoFixture.copayRate,
    revision: REVISION,
  };
}

/** 正規化済みの固定 changes を Gemini の生出力の形に戻す（note は生出力にない） */
function toRawChange(change: ProposalChange): RawProposalChange {
  switch (change.action) {
    case "remove":
      return { action: "remove", placementId: change.placementId };
    case "move":
      return {
        action: "move",
        placementId: change.placementId,
        day: change.day,
        startHour: change.startHour,
      };
    case "resize":
      return {
        action: "resize",
        placementId: change.placementId,
        startHour: change.startHour,
        endHour: change.endHour,
      };
    case "add":
      return {
        action: "add",
        day: change.day,
        startHour: change.startHour,
        endHour: change.endHour,
        kind: change.kind,
        serviceId: change.serviceId,
        personId: change.personId,
      };
  }
}

/** ID と note を除いた配置の比較キー（add の ID は正規化で再採番されるため） */
function placementKey(p: Placement): string {
  return [
    p.day,
    p.startHour,
    p.endHour,
    p.kind,
    p.serviceId ?? "",
    p.personId ?? "",
  ].join("|");
}

function portsWith(overrides: Partial<ServerPorts> = {}): ServerPorts {
  const rooms = new FakeRoomReadPort().setSnapshot("room-1", fixtureSnapshot());
  return makeFakePorts({ rooms, validation: realValidation, ...overrides });
}

describe("実エンジンでの fixture 検証（Issue 6 × Issue 10）", () => {
  it("揉めるプランは期待どおり NG になる", () => {
    const result = validateRoom(fixtureSnapshot());
    expect(result).toEqual(demoFixture.troubledPlan.expectedValidationResult);
    expect(result.ok).toBe(false);
  });

  it("固定 changes を試し適用すると納得プランの配置と一致する", () => {
    const applied = applyChanges(
      demoFixture.troubledPlan.placements,
      demoFixture.fixedProposal.changes,
    );
    const byId = (list: Placement[]) =>
      [...list].sort((a, b) => a.id.localeCompare(b.id));
    expect(byId(applied)).toEqual(byId(demoFixture.acceptedPlan.placements));
  });

  it("試し適用後の再検証は ok=true で、期待値と一致する", () => {
    const applied = applyChanges(
      demoFixture.troubledPlan.placements,
      demoFixture.fixedProposal.changes,
    );
    const result = validateRoom({ ...fixtureSnapshot(), placements: applied });
    expect(result.ok).toBe(true);
    expect(result).toEqual(demoFixture.acceptedPlan.expectedValidationResult);
  });
});

describe("handleProposalsRequest（実エンジン接続）", () => {
  const baseInput = {
    idToken: "test-token",
    roomId: "room-1",
    baseRevision: REVISION,
  };

  it("固定 changes が Gemini から返ると、検証済みの代替案として1件返る", async () => {
    const gemini = new FakeGeminiPort(async () => ({
      proposals: [
        {
          summary: demoFixture.fixedProposal.summary,
          changes: demoFixture.fixedProposal.changes.map(toRawChange),
        },
      ],
    }));
    const result = await handleProposalsRequest(portsWith({ gemini }), baseInput);
    expect(result.status).toBe(200);
    const body = result.body as { proposals: Proposal[]; baseRevision: number };
    expect(body.baseRevision).toBe(REVISION);
    expect(body.proposals).toHaveLength(1);
    expect(body.proposals[0].baseRevision).toBe(REVISION);

    // 返された案（add の ID はサーバー再採番）を試し適用すると納得プランと
    // 実質一致し、再検証でも ok=true になる
    const applied = applyChanges(
      demoFixture.troubledPlan.placements,
      body.proposals[0].changes,
    );
    expect(applied.map(placementKey).sort()).toEqual(
      demoFixture.acceptedPlan.placements.map(placementKey).sort(),
    );
    const trialValidation = validateRoom({ ...fixtureSnapshot(), placements: applied });
    expect(trialValidation.ok).toBe(true);
    // API の比較表示値は、返された変更を適用した実エンジンの結果と一致する。
    expect(body.proposals[0].validation).toEqual(trialValidation);
  });

  it("実エンジンで直らない案は検証済みにならず、返らない", async () => {
    const gemini = new FakeGeminiPort(async () => ({
      proposals: [
        {
          summary: "水曜の通所介護を少しだけ延ばす",
          changes: [
            {
              placementId: "demo-daycare-wed",
              action: "resize",
              startHour: 9,
              endHour: 15,
            },
          ],
        },
      ],
    }));
    const result = await handleProposalsRequest(portsWith({ gemini }), baseInput);
    expect(result.status).toBe(200);
    expect(result.body).toEqual({ proposals: [], baseRevision: REVISION });
  });
});
