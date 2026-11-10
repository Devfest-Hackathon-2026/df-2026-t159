/**
 * ルーム作成・招待発行・参加確定のサーバー側ロジック（Issue 2）。
 *
 * membership の発行はここに集約する（Route Handler ＋ Firebase Admin SDK）。
 * members ドキュメントを作れるのはサーバーだけ（クライアントからはルールで禁止）。
 *
 * 招待の信頼境界（共通前提）：
 * - 招待の発行は対象ルームの既存 family に限る
 * - トークンは128bit以上のランダム値・有効24時間・1回のみ使用
 * - サーバー側にはトークンのハッシュ・roomId・role・expiresAt・usedAt を保存する
 * - 参加時は保存値だけを検証・採用し、リクエストで送られた role は採用しない
 * - 参加確定と membership 作成は transaction で処理する
 */

import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { normalizePeople, validatePeopleCareRoles } from "../people";
import {
  firestorePaths,
  type CareRole,
  type CareWindow,
  type CopayRate,
  type DayIndex,
  type InviteDoc,
  type MemberRole,
  type Person,
} from "../types";
import { ApiError } from "./errors";
import { adminDb } from "./firebase-admin";
import {
  generateInviteToken,
  hashInviteToken,
  INVITE_TTL_MS,
  isInviteTokenShape,
} from "./invite-token";

// ---------------------------------------------------------------------------
// 入力の検証（サーバー側でも必ず検証する）
// ---------------------------------------------------------------------------

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isIntInRange(value: unknown, min: number, max: number): value is number {
  return (
    typeof value === "number" &&
    Number.isInteger(value) &&
    value >= min &&
    value <= max
  );
}

/** people の検証と整形。IDの重複・空の名前・型違い・区分制約違反は 400 */
export function validatePeople(raw: unknown): Person[] {
  if (!Array.isArray(raw) || raw.length < 1 || raw.length > 30) {
    throw new ApiError(400, "invalid_people");
  }
  const ids = new Set<string>();
  const parsed = raw.map((item) => {
    if (!isRecord(item)) throw new ApiError(400, "invalid_people");
    const { id, name, canProvideCare, careRole, icon } = item;
    if (typeof id !== "string" || id.length < 1 || id.length > 128) {
      throw new ApiError(400, "invalid_people");
    }
    if (ids.has(id)) throw new ApiError(400, "invalid_people");
    ids.add(id);
    if (typeof name !== "string" || name.trim().length < 1 || name.trim().length > 50) {
      throw new ApiError(400, "invalid_people");
    }
    if (icon !== undefined && (typeof icon !== "string" || icon.trim().length > 16)) {
      throw new ApiError(400, "invalid_people");
    }
    let role: CareRole | undefined;
    if (careRole !== undefined) {
      if (careRole !== "recipient" && careRole !== "caregiver" && careRole !== "family") {
        throw new ApiError(400, "invalid_people");
      }
      role = careRole as CareRole;
    }
    if (canProvideCare !== undefined && typeof canProvideCare !== "boolean") {
      throw new ApiError(400, "invalid_people");
    }
    const effectiveCanProvideCare = role !== undefined ? role === "caregiver" : Boolean(canProvideCare);
    const p: Person = {
      id,
      name: name.trim(),
      canProvideCare: effectiveCanProvideCare,
    };
    if (role !== undefined) {
      p.careRole = role;
    }
    if (typeof icon === "string" && icon.trim().length > 0) {
      p.icon = icon.trim();
    }
    return p;
  });

  const normalized = normalizePeople(parsed);
  const validation = validatePeopleCareRoles(normalized);
  if (!validation.valid) {
    throw new ApiError(400, "invalid_people");
  }
  return normalized;
}

/** careWindows の検証と整形（配置と同じ時刻規則：6≦startHour＜endHour≦24） */
export function validateCareWindows(raw: unknown): CareWindow[] {
  if (!Array.isArray(raw) || raw.length > 126) {
    throw new ApiError(400, "invalid_care_windows");
  }
  return raw.map((item) => {
    if (!isRecord(item)) throw new ApiError(400, "invalid_care_windows");
    const { day, startHour, endHour } = item;
    if (
      !isIntInRange(day, 0, 6) ||
      !isIntInRange(startHour, 6, 24) ||
      !isIntInRange(endHour, 6, 24) ||
      startHour >= endHour
    ) {
      throw new ApiError(400, "invalid_care_windows");
    }
    return { day: day as DayIndex, startHour, endHour };
  });
}

/** 自己負担割合の検証（1割／2割／3割） */
export function validateCopayRate(raw: unknown): CopayRate {
  if (raw === 1 || raw === 2 || raw === 3) return raw;
  throw new ApiError(400, "invalid_copay_rate");
}

// ---------------------------------------------------------------------------
// ルーム作成
// ---------------------------------------------------------------------------

export interface CreateRoomInput {
  people: Person[];
  careWindows: CareWindow[];
  copayRate: CopayRate;
}

/**
 * ルームを作成する。rooms/{roomId}（creatorUid・isDemo=false・revision=0）と
 * people・作成者の family membership・constraints/main を同時に作る。
 */
export async function createRoom(
  creatorUid: string,
  input: CreateRoomInput,
): Promise<{ roomId: string }> {
  const db = adminDb();
  const roomId = crypto.randomUUID();
  const batch = db.batch();

  batch.set(db.doc(firestorePaths.room(roomId)), {
    creatorUid,
    isDemo: false,
    revision: 0,
    careWindows: input.careWindows,
    careLevel: 3,
    copayRate: input.copayRate,
    createdAt: FieldValue.serverTimestamp(),
  });
  for (const person of input.people) {
    batch.set(db.doc(firestorePaths.person(roomId, person.id)), person);
  }
  batch.set(db.doc(firestorePaths.member(roomId, creatorUid)), {
    role: "family" satisfies MemberRole,
    createdAt: FieldValue.serverTimestamp(),
  });
  batch.set(db.doc(firestorePaths.constraints(roomId)), {
    constraints: [],
    hopes: [],
    unknowns: [],
  });

  await batch.commit();
  return { roomId };
}

// ---------------------------------------------------------------------------
// 招待の発行
// ---------------------------------------------------------------------------

export interface CreateInviteResult {
  token: string;
  role: MemberRole;
  expiresAt: string;
}

/**
 * 招待リンクを発行する。発行できるのは対象ルームの既存 family のみ。
 * 保存するのはトークンのハッシュ（ドキュメントID）と role・期限・使用状態だけ。
 */
export async function createInvite(
  callerUid: string,
  roomId: string,
  roleRaw: unknown,
): Promise<CreateInviteResult> {
  if (roleRaw !== "family" && roleRaw !== "careManager") {
    throw new ApiError(400, "invalid_role");
  }
  const role: MemberRole = roleRaw;

  const db = adminDb();
  const memberSnap = await db
    .doc(firestorePaths.member(roomId, callerUid))
    .get();
  if (!memberSnap.exists) {
    throw new ApiError(403, "not_a_member");
  }
  if ((memberSnap.data() as { role: MemberRole }).role !== "family") {
    throw new ApiError(403, "family_only");
  }

  const token = generateInviteToken();
  const hash = hashInviteToken(token);
  const now = Date.now();
  const expiresAt = Timestamp.fromMillis(now + INVITE_TTL_MS);
  await db.doc(`${firestorePaths.invites(roomId)}/${hash}`).set({
    role,
    expiresAt,
    usedAt: null,
    createdAt: Timestamp.fromMillis(now),
  } satisfies Omit<InviteDoc, "expiresAt" | "usedAt" | "createdAt"> & {
    expiresAt: Timestamp;
    usedAt: null;
    createdAt: Timestamp;
  });

  return { token, role, expiresAt: expiresAt.toDate().toISOString() };
}

// ---------------------------------------------------------------------------
// 招待による参加確定
// ---------------------------------------------------------------------------

export interface JoinRoomResult {
  role: MemberRole;
  alreadyMember: boolean;
}

/**
 * 招待トークンで参加を確定する。role は保存値だけから決める
 * （リクエストで送られた role は受け付けない）。
 * 参加確定と membership 作成は transaction で処理する。
 * すでに参加済みの場合は、トークンを消費せず既存の role を返す。
 */
export async function joinRoom(
  uid: string,
  roomId: string,
  tokenRaw: unknown,
): Promise<JoinRoomResult> {
  if (!isInviteTokenShape(tokenRaw)) {
    throw new ApiError(400, "invalid_token");
  }
  const db = adminDb();
  const inviteRef = db.doc(
    `${firestorePaths.invites(roomId)}/${hashInviteToken(tokenRaw)}`,
  );
  const memberRef = db.doc(firestorePaths.member(roomId, uid));

  return db.runTransaction(async (tx) => {
    const inviteSnap = await tx.get(inviteRef);
    if (!inviteSnap.exists) {
      throw new ApiError(400, "invite_not_found");
    }
    const invite = inviteSnap.data() as unknown as InviteDoc;
    if (invite.usedAt !== null) {
      throw new ApiError(409, "invite_already_used");
    }
    if (invite.expiresAt.toMillis() <= Date.now()) {
      throw new ApiError(410, "invite_expired");
    }
    const memberSnap = await tx.get(memberRef);
    if (memberSnap.exists) {
      return {
        role: (memberSnap.data() as { role: MemberRole }).role,
        alreadyMember: true,
      };
    }
    tx.set(memberRef, {
      role: invite.role,
      createdAt: FieldValue.serverTimestamp(),
    });
    tx.update(inviteRef, { usedAt: FieldValue.serverTimestamp() });
    return { role: invite.role, alreadyMember: false };
  });
}
