/**
 * 人物ID対応（sourcePersonId → roomPersonId）の変換純粋関数群（Issue 15）。
 *
 * デモルームでは fixture の sourcePersonId（"person-father", "person-mother" など）を
 * 初回作成時にルーム内の roomPersonId（UUID 等）に対応づけ、
 * 配置・制約・固定 changes・期待 memberHours をすべて同じ対応で扱う。
 */

import type {
  Constraint,
  Person,
  Placement,
  ProposalChange,
} from "../types";
import type { PersonMapping } from "./types";

/**
 * fixture の people から人物対応マップを生成する。
 * 既定の採番は crypto.randomUUID()。
 */
export function createPersonMapping(
  fixturePeople: Person[],
  idGenerator: (sourceId: string) => string = () => crypto.randomUUID(),
): PersonMapping {
  const mapping: PersonMapping = {};
  for (const person of fixturePeople) {
    mapping[person.id] = idGenerator(person.id);
  }
  return mapping;
}

/**
 * fixture の people の ID を roomPersonId に変換する。
 * name, canProvideCare, icon は保持する。
 */
export function mapPeople(
  fixturePeople: Person[],
  mapping: PersonMapping,
): Person[] {
  return fixturePeople.map((p) => ({
    id: mapping[p.id] ?? p.id,
    name: p.name,
    canProvideCare: p.canProvideCare,
    ...(p.icon ? { icon: p.icon } : {}),
  }));
}

/**
 * fixture の constraints の personId を roomPersonId に変換する。
 */
export function mapConstraints(
  fixtureConstraints: Constraint[],
  mapping: PersonMapping,
): Constraint[] {
  return fixtureConstraints.map((c) => ({
    ...c,
    personId: mapping[c.personId] ?? c.personId,
    days: [...c.days],
  }));
}

/**
 * fixture の placements の personId を roomPersonId に変換する。
 * family 配置のとき personId が置換される。
 */
export function mapPlacements(
  fixturePlacements: Placement[],
  mapping: PersonMapping,
): Placement[] {
  return fixturePlacements.map((p) => {
    const mapped: Placement = { ...p };
    if (p.personId) {
      mapped.personId = mapping[p.personId] ?? p.personId;
    }
    return mapped;
  });
}

/**
 * fixture の fixedProposal.changes の personId を roomPersonId に変換する。
 * add アクションの家族配置に含まれる personId を置換する。
 */
export function mapChanges(
  changes: ProposalChange[],
  mapping: PersonMapping,
): ProposalChange[] {
  return changes.map((ch) => {
    if (ch.action === "add" && ch.personId) {
      return {
        ...ch,
        personId: mapping[ch.personId] ?? ch.personId,
      };
    }
    return { ...ch };
  });
}

/**
 * fixture の memberHours の personId を roomPersonId に変換する。
 */
export function mapMemberHours(
  memberHours: { personId: string; hours: number }[],
  mapping: PersonMapping,
): { personId: string; hours: number }[] {
  return memberHours.map((mh) => ({
    personId: mapping[mh.personId] ?? mh.personId,
    hours: mh.hours,
  }));
}
