/**
 * Route Handler 用の HTTP 補助。
 */

/** Authorization: Bearer ＜IDトークン＞ からトークンを取り出す。なければ null */
export function extractBearerToken(request: Request): string | null {
  const header = request.headers.get("authorization");
  if (!header) return null;
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  const token = match?.[1]?.trim();
  return token ? token : null;
}
