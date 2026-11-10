// @vitest-environment jsdom
import React from "react";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { mockSnapshot, mockValidation } from "./mock";
import type { RoomSnapshot, ValidationResult } from "./types";
import { useRoomValidation } from "./useRoomValidation";

afterEach(cleanup);
describe("useRoomValidation", () => {
  it("ドラッグなど表示だけの再描画では再検証せず、保存後の新しい入力で1回だけ検証する", async () => {
    const validate = vi.fn(() => mockValidation);
    const { result, rerender } = renderHook(({ snapshot }) => useRoomValidation(snapshot, validate), { initialProps: { snapshot: mockSnapshot } });
    await waitFor(() => expect(result.current.pending).toBe(false));
    for (let i = 0; i < 20; i++) rerender({ snapshot: mockSnapshot });
    expect(validate).toHaveBeenCalledTimes(1);
    rerender({ snapshot: { ...mockSnapshot, revision: 1 } });
    await waitFor(() => expect(result.current.validation?.revision).toBe(1));
    expect(validate).toHaveBeenCalledTimes(2);
  });
  it("RoomSnapshot全体を渡し、全入力変更と同じ版の再読み込みでも再検証する", async () => {
    const validate = vi.fn(() => mockValidation);
    const { result, rerender } = renderHook(({ snapshot }) => useRoomValidation(snapshot, validate), { initialProps: { snapshot: mockSnapshot } });
    await waitFor(() => expect(result.current.validation?.revision).toBe(0));
    let current: RoomSnapshot = mockSnapshot;
    for (const change of [
      { placements: [] }, { constraints: [] }, { careWindows: [] }, { copayRate: 3 as const }, {},
    ]) {
      current = { ...current, ...change };
      rerender({ snapshot: current });
      expect(result.current.validation).toBeNull();
      await waitFor(() => expect(validate).toHaveBeenLastCalledWith(current));
      await waitFor(() => expect(result.current.pending).toBe(false));
    }
    expect(validate).toHaveBeenCalledTimes(6);
  });
  it("遅れて返った別版の結果で上書きしない", async () => {
    const resolvers: ((r: ValidationResult) => void)[] = [];
    const validate = vi.fn(() => new Promise<ValidationResult>(resolve => resolvers.push(resolve)));
    const { result, rerender } = renderHook(({ snapshot }) => useRoomValidation(snapshot, validate), { initialProps: { snapshot: mockSnapshot } });
    await waitFor(() => expect(resolvers.length).toBe(1));
    rerender({ snapshot: { ...mockSnapshot, revision: 1 } });
    await waitFor(() => expect(resolvers.length).toBe(2));
    await act(async () => { resolvers[1](mockValidation); });
    expect(result.current.validation?.revision).toBe(1);
    await act(async () => { resolvers[0]({ ...mockValidation, ok: true }); });
    expect(result.current.validation?.revision).toBe(1);
    expect(result.current.validation?.result.ok).toBe(false);
  });
  it("エンジン失敗時は未判定にする", async () => {
    const validate = () => { throw new Error("test"); };
    const { result } = renderHook(() => useRoomValidation(mockSnapshot, validate));
    await waitFor(() => expect(result.current.error).toContain("未判定"));
    expect(result.current.validation).toBeNull();
  });
});
