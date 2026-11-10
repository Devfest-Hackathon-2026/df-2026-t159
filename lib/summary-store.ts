/**
 * まとめシート用の Firestore クライアント読み取り（Issue 11）。
 *
 * 参加者（family／careManager）は Firestore ルールで rooms/{roomId}/summary/main
 * を閲覧できる。
 */

import { doc, getDocFromServer } from "firebase/firestore";
import { db } from "./firebase";
import { firestorePaths, type SummaryDoc } from "./types";

/**
 * ルームの確定スナップショット（summary/main）を読む。
 * 存在しない場合は null。通信・権限エラーは未確定と混同せず呼び出し元へ返す。
 */
export async function readRoomSummary(
  roomId: string,
): Promise<SummaryDoc | null> {
  const snap = await getDocFromServer(doc(db, firestorePaths.summary(roomId)));
  return snap.exists() ? (snap.data() as SummaryDoc) : null;
}

export interface SummaryReadState { summary: SummaryDoc | null; currentRevision: number }

/** 現在の入力群は読まない。rootの版→確定内容→rootの版を照合する。 */
export async function readSummaryState(roomId: string): Promise<SummaryReadState> {
  const root = doc(db, firestorePaths.room(roomId));
  for (let attempt = 0; attempt < 3; attempt++) {
    const before = await getDocFromServer(root);
    if (!before.exists()) throw new Error("room-not-found");
    const summary = await readRoomSummary(roomId);
    const after = await getDocFromServer(root);
    if (!after.exists()) throw new Error("room-not-found");
    const revision = after.data().revision;
    if (before.data().revision === revision) return { summary, currentRevision: revision };
  }
  throw new Error("summary-revision-conflict");
}
