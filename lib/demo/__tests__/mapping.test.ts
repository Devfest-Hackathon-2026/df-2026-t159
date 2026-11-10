import { describe, expect, it } from "vitest";
import { demoFixture } from "../../demo-fixture";
import {
  createPersonMapping,
  mapChanges,
  mapConstraints,
  mapMemberHours,
  mapPeople,
  mapPlacements,
} from "../mapping";

describe("人物ID対応（mapping.ts）", () => {
  const fx = demoFixture;

  it("fixture の全 people に対して対応マップが生成される", () => {
    const mapping = createPersonMapping(fx.people, (id) => `room-${id}`);
    expect(Object.keys(mapping)).toHaveLength(4);
    expect(mapping["person-father"]).toBe("room-person-father");
    expect(mapping["person-mother"]).toBe("room-person-mother");
    expect(mapping["person-daughter"]).toBe("room-person-daughter");
    expect(mapping["person-son"]).toBe("room-person-son");
  });

  it("people の各属性を保持したまま ID だけが roomPersonId に置換される", () => {
    const mapping = createPersonMapping(fx.people, (id) => `uuid-${id}`);
    const mapped = mapPeople(fx.people, mapping);

    expect(mapped).toHaveLength(4);
    expect(mapped[0]).toEqual({
      id: "uuid-person-father",
      name: "父",
      canProvideCare: false,
      icon: "👴",
    });
    expect(mapped[1]).toEqual({
      id: "uuid-person-mother",
      name: "母",
      canProvideCare: true,
      icon: "👵",
    });
  });

  it("constraints の personId が対応マップに従って置換される", () => {
    const mapping = createPersonMapping(fx.people, (id) => `uuid-${id}`);
    const mapped = mapConstraints(fx.constraints, mapping);

    expect(mapped).toHaveLength(fx.constraints.length);
    for (let i = 0; i < mapped.length; i++) {
      expect(mapped[i].personId).toBe(`uuid-${fx.constraints[i].personId}`);
      expect(mapped[i].type).toBe(fx.constraints[i].type);
      expect(mapped[i].detail).toBe(fx.constraints[i].detail);
      expect(mapped[i].days).toEqual(fx.constraints[i].days);
      expect(mapped[i].startHour).toBe(fx.constraints[i].startHour);
      expect(mapped[i].endHour).toBe(fx.constraints[i].endHour);
    }
  });

  it("placements の family 配置の personId が置換され、サービス配置はそのまま保持される", () => {
    const mapping = createPersonMapping(fx.people, (id) => `uuid-${id}`);
    const mapped = mapPlacements(fx.troubledPlan.placements, mapping);

    expect(mapped).toHaveLength(fx.troubledPlan.placements.length);
    for (let i = 0; i < mapped.length; i++) {
      const orig = fx.troubledPlan.placements[i];
      if (orig.kind === "family") {
        expect(mapped[i].personId).toBe(`uuid-${orig.personId}`);
      } else {
        expect(mapped[i].personId).toBeUndefined();
        expect(mapped[i].serviceId).toBe(orig.serviceId);
      }
      expect(mapped[i].id).toBe(orig.id);
      expect(mapped[i].day).toBe(orig.day);
      expect(mapped[i].startHour).toBe(orig.startHour);
      expect(mapped[i].endHour).toBe(orig.endHour);
    }
  });

  it("fixedProposal.changes の add アクションの personId が置換される", () => {
    const mapping = createPersonMapping(fx.people, (id) => `uuid-${id}`);
    const mapped = mapChanges(fx.fixedProposal.changes, mapping);

    expect(mapped).toHaveLength(fx.fixedProposal.changes.length);
    for (let i = 0; i < mapped.length; i++) {
      const orig = fx.fixedProposal.changes[i];
      const m = mapped[i];
      if (orig.action === "add" && m.action === "add" && orig.personId) {
        expect(m.personId).toBe(`uuid-${orig.personId}`);
      }
    }
  });

  it("memberHours の personId が置換される", () => {
    const mapping = createPersonMapping(fx.people, (id) => `uuid-${id}`);
    const origMemberHours = fx.acceptedPlan.expectedValidationResult.memberHours;
    const mapped = mapMemberHours(origMemberHours, mapping);

    expect(mapped).toHaveLength(origMemberHours.length);
    for (let i = 0; i < mapped.length; i++) {
      expect(mapped[i].personId).toBe(`uuid-${origMemberHours[i].personId}`);
      expect(mapped[i].hours).toBe(origMemberHours[i].hours);
    }
  });
});
