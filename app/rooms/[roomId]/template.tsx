import type { ReactNode } from "react";

export default function RoomTemplate({ children }: { children: ReactNode }) {
  return <div className="room-page-enter">{children}</div>;
}
