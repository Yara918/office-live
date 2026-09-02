/**
 * 管理权限门（模块级单例，React 与 Phaser 场景共用）
 *
 * 权限模型：员工只看、管理员才能操作。
 * - 未解锁：点任何成员只打开档案，所有管理入口（E / 调整负责人 / 新增任务）不可用
 * - 已解锁：管理员可点 E 进任务面板，可调整负责人 / 安排任务 / 新增任务
 *
 * 解锁方式：输入管理口令（OFFICE_CONFIG.adminCode）。
 * 未配置口令时默认开放（兼容演示环境）。
 * 解锁状态会话级，刷新页面重置。
 */
let unlocked = false;

export function isAdminUnlocked(): boolean {
  return unlocked;
}

export function setAdminUnlocked(value: boolean) {
  unlocked = value;
}

export function resetAdminUnlocked() {
  unlocked = false;
}
