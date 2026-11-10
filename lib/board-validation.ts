import type { RoomSnapshot, ValidationResult } from "./types";
import { validateRoom } from "./validation";

export type RoomValidator = (snapshot: RoomSnapshot) => ValidationResult | Promise<ValidationResult>;

/** 表示側では計算せず、Issue #9 の共通エンジンに入力全体を渡す。 */
export const validateRoomForBoard: RoomValidator = snapshot => validateRoom(snapshot);
