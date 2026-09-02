/**
 * 部署前缀。
 * 本地模式（方案 C）：空字符串即可；页面直接在本机运行。
 */
export const BASE_PATH = "";

/** 给资源/API 路径补上部署前缀 */
export function withBase(path: string): string {
  if (!BASE_PATH) return path;
  return `${BASE_PATH}${path.startsWith("/") ? path : `/${path}`}`;
}
