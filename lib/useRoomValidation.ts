"use client";

import { useEffect, useState } from "react";
import type { RevisionedValidation, RoomSnapshot } from "./types";
import { validateRoomForBoard, type RoomValidator } from "./board-validation";

export function useRoomValidation(snapshot: RoomSnapshot | null, validate: RoomValidator = validateRoomForBoard) {
  const [settled, setSettled] = useState<{
    input: RoomSnapshot;
    validation: RevisionedValidation | null;
    error: string | null;
  } | null>(null);

  useEffect(() => {
    if (!snapshot) return;
    let cancelled = false;
    Promise.resolve().then(() => validate(snapshot)).then(result => {
      if (!cancelled) setSettled({ input: snapshot, validation: { revision: snapshot.revision, result }, error: null });
    }).catch(() => {
      if (!cancelled) setSettled({ input: snapshot, validation: null, error: "検証に失敗しました。判定は未判定です。再読み込みしてください。" });
    });
    return () => { cancelled = true; };
  }, [snapshot, validate]);

  // revision が同じでも再読み込み・入力変更後に古い結果を使わない。
  const current = settled?.input === snapshot ? settled : null;
  return { validation: current?.validation ?? null, error: current?.error ?? null, pending: !!snapshot && !current };
}
