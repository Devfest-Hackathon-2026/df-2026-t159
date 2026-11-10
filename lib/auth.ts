/**
 * Firebase 匿名認証のクライアント側ヘルパー（Issue 2）。
 *
 * ログインは匿名認証のみ（メール招待・パスワード認証は MVP 外）。
 * Route Handler へ送る ID トークンの取得もここに集約する。
 */

import { onAuthStateChanged, signInAnonymously, type User } from "firebase/auth";
import { useEffect, useState } from "react";
import { auth } from "./firebase";

/** 未ログインなら匿名サインインし、現在のユーザーを返す */
export async function ensureAnonymousUser(): Promise<User> {
  if (auth.currentUser) return auth.currentUser;
  const credential = await signInAnonymously(auth);
  return credential.user;
}

/** Route Handler 呼び出し用の Firebase ID トークンを取得する */
export async function getIdToken(): Promise<string> {
  const user = await ensureAnonymousUser();
  return user.getIdToken();
}

/**
 * 匿名ユーザーを React の状態として返す hook。
 * 取得が終わるまでは null（画面側は「読み込み中」として扱う）。
 */
export function useAnonymousUser(): User | null {
  const [user, setUser] = useState<User | null>(auth.currentUser);
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (next) => setUser(next));
    ensureAnonymousUser().catch(() => {
      // サインインに失敗した場合は user が null のままになる（画面側で案内する）
    });
    return unsubscribe;
  }, []);
  return user;
}
