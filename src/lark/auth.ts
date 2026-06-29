import type { Env } from "../types";

export async function getTenantAccessToken(env: Env): Promise<string> {
  const res = await fetch(`${env.LARK_API_BASE}/open-apis/auth/v3/tenant_access_token/internal`, {
    method: "POST",
    headers: { "Content-Type": "application/json; charset=utf-8" },
    body: JSON.stringify({ app_id: env.LARK_APP_ID, app_secret: env.LARK_APP_SECRET }),
  });
  const data: any = await res.json();
  if (data.code !== 0) throw new Error(`Failed to get tenant_access_token: ${JSON.stringify(data)}`);
  return data.tenant_access_token;
}
