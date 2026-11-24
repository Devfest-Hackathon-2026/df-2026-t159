import { expect, it, vi } from "vitest";
import { generateInviteToken, hashInviteToken } from "./invite-token";
import { joinRoom } from "./rooms";
import { firestorePaths } from "../types";

const docs = new Map<string, Record<string, unknown>>();
vi.mock("./firebase-admin", () => ({
  adminDb: () => ({
    doc: (path: string) => path,
    runTransaction: (run: Function) => run({
      get: async (path: string) => ({ exists: docs.has(path), data: () => docs.get(path) }),
      set: (path: string, data: Record<string, unknown>) => docs.set(path, data),
    }),
  }),
}));

it("同じ招待は期限内に複数人が使え、参加済みの役割を保持し、期限到達後は拒否する", async () => {
  const token = generateInviteToken();
  const room = "room";
  const invite = firestorePaths.invites(room) + "/" + hashInviteToken(token);
  let expiry = Date.now() + 60_000;
  docs.set(invite, { role: "careManager", expiresAt: { toMillis: () => expiry } });
  for (const uid of ["first", "second"]) {
    expect(await joinRoom(uid, room, token)).toEqual({ role: "careManager", alreadyMember: false });
    expect(docs.get(firestorePaths.member(room, uid))?.role).toBe("careManager");
  }
  docs.set(firestorePaths.member(room, "owner"), { role: "family" });
  expect(await joinRoom("owner", room, token)).toEqual({ role: "family", alreadyMember: true });
  expiry = Date.now();
  await expect(joinRoom("third", room, token)).rejects.toMatchObject({ code: "invite_expired" });
  expect(docs.has(firestorePaths.member(room, "third"))).toBe(false);
});
