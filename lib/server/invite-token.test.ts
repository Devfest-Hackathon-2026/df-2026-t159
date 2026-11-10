/**
 * 招待トークンの生成・ハッシュ化の単体テスト（Issue 2）。
 * 仕様：128bit以上のランダム値・サーバー側にはハッシュだけを保存する。
 */

import { describe, expect, it } from "vitest";
import {
  generateInviteToken,
  hashInviteToken,
  INVITE_TOKEN_BYTES,
  isInviteTokenShape,
} from "./invite-token";

describe("generateInviteToken", () => {
  it("128bit以上の乱数から生成される", () => {
    expect(INVITE_TOKEN_BYTES * 8).toBeGreaterThanOrEqual(128);
    const token = generateInviteToken();
    const decoded = Buffer.from(token, "base64url");
    expect(decoded.byteLength).toBe(INVITE_TOKEN_BYTES);
  });

  it("生成のたびに異なる値になる", () => {
    const tokens = new Set(
      Array.from({ length: 100 }, () => generateInviteToken()),
    );
    expect(tokens.size).toBe(100);
  });

  it("URLに載せられる文字だけで構成される", () => {
    expect(generateInviteToken()).toMatch(/^[A-Za-z0-9_-]+$/);
  });
});

describe("hashInviteToken", () => {
  it("SHA-256 の16進数64文字で、同じ入力には同じ値を返す", () => {
    const token = generateInviteToken();
    const hash = hashInviteToken(token);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(hashInviteToken(token)).toBe(hash);
  });

  it("異なるトークンには異なるハッシュを返す", () => {
    expect(hashInviteToken(generateInviteToken())).not.toBe(
      hashInviteToken(generateInviteToken()),
    );
  });

  it("ハッシュからトークン本体は復元できない（一方通行）", () => {
    const token = generateInviteToken();
    expect(hashInviteToken(token)).not.toContain(token);
  });
});

describe("isInviteTokenShape", () => {
  it("生成したトークンを受け付ける", () => {
    expect(isInviteTokenShape(generateInviteToken())).toBe(true);
  });

  it("短い文字列・記号混じり・文字列以外を拒否する", () => {
    expect(isInviteTokenShape("short")).toBe(false);
    expect(isInviteTokenShape("a".repeat(40) + "!")).toBe(false);
    expect(isInviteTokenShape(12345)).toBe(false);
    expect(isInviteTokenShape(null)).toBe(false);
    expect(isInviteTokenShape(undefined)).toBe(false);
  });
});
