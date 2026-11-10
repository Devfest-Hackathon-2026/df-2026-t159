"use client";

import React, { createContext, useContext } from "react";
import type { Placement, PlacementKind } from "@/lib/types";

export interface ActiveDragInfo {
  type: "palette" | "block";
  kind?: PlacementKind;
  placement?: Placement;
}

export interface BoardDndContextValue {
  hasProvider: boolean;
  activeDrag: ActiveDragInfo | null;
}

const BoardDndContext = createContext<BoardDndContextValue>({
  hasProvider: false,
  activeDrag: null,
});

export const BoardDndProvider = BoardDndContext.Provider;

export function useBoardDnd() {
  return useContext(BoardDndContext);
}
