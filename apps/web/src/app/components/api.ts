/**
 * 家长后台前端请求封装：统一 JSON、错误信息与 401 跳转登录。
 * 所有视图通过它访问 /api/v1/*，不在页面里写死任何业务数据。
 */

export class ApiClientError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}

export async function api<T = unknown>(
  url: string,
  options: { method?: string; body?: unknown } = {},
): Promise<T> {
  const res = await fetch(url, {
    method: options.method ?? "GET",
    headers: options.body !== undefined ? { "Content-Type": "application/json" } : undefined,
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
    cache: "no-store",
  });
  if (res.status === 401) {
    // 会话失效：回到登录页，登录后返回当前页；不做任何自动登录（D-010）
    window.location.href = `/login?redirect=${encodeURIComponent(window.location.pathname)}`;
    throw new ApiClientError(401, "unauthorized", "登录已过期，请重新登录");
  }
  const data = (await res.json().catch(() => ({}))) as { error?: { code?: string; message?: string } };
  if (!res.ok) {
    throw new ApiClientError(res.status, data.error?.code ?? "error", data.error?.message ?? `请求失败（HTTP ${res.status}）`);
  }
  return data as T;
}

export function errorMessage(err: unknown): string {
  if (err instanceof ApiClientError) return err.message;
  if (err instanceof Error) return `网络异常：${err.message}`;
  return "操作失败，请重试";
}
