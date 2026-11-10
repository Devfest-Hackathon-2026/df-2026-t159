/**
 * Firebase（Client SDK）の最小の初期化コード（Issue 0）。
 *
 * 接続情報は NEXT_PUBLIC_FIREBASE_* 環境変数から読む（.env.example 参照）。
 * ここでは初期化だけを行い、データの読み書き・認証の実装は Issue 2 以降が担当する。
 * 権限は Firestore ルールで守る前提で、APIキーを含む接続情報はブラウザへ配布される。
 * （Gemini の APIキーはここには絶対に置かない。サーバー側の環境変数だけに置く）
 */

import { getApp, getApps, initializeApp, type FirebaseApp } from "firebase/app";
import { getAuth, type Auth } from "firebase/auth";
import { getFirestore, type Firestore } from "firebase/firestore";

const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
};

export const firebaseApp: FirebaseApp =
  getApps().length > 0 ? getApp() : initializeApp(firebaseConfig);

/** Firebase 匿名認証（ログイン用） */
export const auth: Auth = getAuth(firebaseApp);

/** Firestore（データの読み書きは Client SDK 直） */
export const db: Firestore = getFirestore(firebaseApp);
