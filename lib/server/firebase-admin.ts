/**
 * Firebase Admin SDK の初期化（サーバー側のみ。Issue 2）。
 *
 * - Route Handler からのみ import する。クライアントのコードからは絶対に import しない
 * - 認証情報はコードに書かない。Cloud Run ではデフォルトのサービスアカウント
 *   （Application Default Credentials）を使い、ローカルでは
 *   GOOGLE_APPLICATION_CREDENTIALS 環境変数が指す鍵を使う前提
 * - ビルド時に初期化が走らないよう、遅延初期化にしている
 */

import { applicationDefault, getApps, initializeApp, type App } from "firebase-admin/app";
import { getAuth, type Auth } from "firebase-admin/auth";
import { getFirestore, type Firestore } from "firebase-admin/firestore";

let cachedApp: App | undefined;

export function adminApp(): App {
  if (cachedApp) return cachedApp;
  const existing = getApps();
  cachedApp =
    existing.length > 0
      ? existing[0]
      : initializeApp({
          credential: applicationDefault(),
          projectId:
            process.env.FIREBASE_ADMIN_PROJECT_ID ??
            process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID ??
            process.env.GOOGLE_CLOUD_PROJECT,
        });
  return cachedApp;
}

export function adminDb(): Firestore {
  return getFirestore(adminApp());
}

export function adminAuth(): Auth {
  return getAuth(adminApp());
}
