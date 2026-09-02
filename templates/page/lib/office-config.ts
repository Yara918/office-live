/**
 * Office Live · 飞书表配置（自动生成）
 * 每次交付只改本文件；换客户表格 = 换配置，代码不动。
 */

export type OfficeFieldMap = Record<string, string>;

export interface OfficeTableConfig {
  /** 表 ID */
  id: string;
  /** 表角色：tasks / members / projects / risks / milestones / data */
  role: "tasks" | "members" | "projects" | "risks" | "milestones" | "data";
  /** 客户表格里的真实表名（展示用，如"活动清单"），缺省用角色默认词 */
  title?: string;
  /** 逻辑语义 -> 真实字段名 */
  fields: OfficeFieldMap;
}

export interface OfficeBaseConfig {
  baseToken: string;
  baseTitle: string;
  /** 表格维护人（负责人） */
  ownerName: string;
  /** 管理口令：改动表格前需输入（默认取表格名） */
  adminCode?: string;
  tables: OfficeTableConfig[];
}

export const OFFICE_CONFIG: OfficeBaseConfig = {
  baseToken: "<BASE_TOKEN>",
  baseTitle: "<表格名称>",
  ownerName: "<管理员姓名>",
  adminCode: "<管理口令>",
  tables: [
    {
      id: "<TABLE_ID>",
      role: "tasks",
      title: "<页面主入口表名>",
      fields: {
        name: "<事项名称列>",
        owner: "<负责人列>",
        status: "<状态列>",
        due: "<截止日期列>",
      },
    },
  ],
};

/** 按角色取表配置 */
export function tableConfig(role: OfficeTableConfig["role"]): OfficeTableConfig | undefined {
  return OFFICE_CONFIG.tables.find((t) => t.role === role);
}

/** 取某表的字段映射（逻辑语义 -> 真实字段名） */
export function fieldsOf(role: OfficeTableConfig["role"]): OfficeFieldMap {
  return tableConfig(role)?.fields ?? {};
}

/** 取某表的真实表名（展示用）：客户表叫什么就显示什么 */
export function tableTitle(role: OfficeTableConfig["role"], fallback: string): string {
  return tableConfig(role)?.title || fallback;
}
