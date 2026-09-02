/**
 * Office Live · 飞书表配置示例
 *
 * 每次交付只改这一个文件（代码不动）：
 * 换客户表格 = 换 baseToken / baseTitle / ownerName / adminCode / 表 ID / 字段映射。
 *
 * 所有占位符 <xxx> 在交付时替换为客户真实值。
 */
import type { OfficeBaseConfig } from "./office-config";

export const OFFICE_CONFIG: OfficeBaseConfig = {
  // 客户表格的 Base token（从表格链接或开放平台获取）
  baseToken: "<base_token>",
  // 客户表格名称（页面左上角显示，也是默认管理口令）
  baseTitle: "<客户表格名称>",
  // 表格管理员姓名（第 2 步与客户确认）
  ownerName: "<管理员姓名>",
  // 管理口令：改动表格前需输入。默认取表格名，可自定义
  adminCode: "<客户表格名称>",
  tables: [
    {
      id: "<任务表ID>",
      role: "tasks",
      fields: {
        name: "任务名称",
        owner: "负责人",
        status: "任务状态",
        overdue: "是否超期",
        remain: "剩余天数",
        project: "项目",
        priority: "优先级",
        type: "任务类型",
        description: "任务描述",
        start: "开始日期",
        due: "截止日期",
        doneDate: "完成日期",
        stage: "任务阶段",
        importance: "重要程度",
        milestone: "所属里程碑",
        remark: "备注",
        risk: "关联风险",
        requirement: "需求来源",
        defect: "缺陷等级",
      },
    },
    {
      id: "<人员表ID>",
      role: "members",
      fields: {
        name: "姓名",
        employeeNo: "工号",
        role: "角色",
        level: "职级",
        skills: "技能标签",
        total: "总任务数",
        todo: "待办任务数",
        active: "进行中任务数",
        done: "已完成任务数",
        overdue: "超期任务数",
        completion: "完成度",
      },
    },
    {
      id: "<项目表ID>",
      role: "projects",
      fields: {
        name: "项目名称",
        status: "项目状态",
        priority: "优先级",
        progress: "完成进度",
        members: "项目成员",
        totalTasks: "任务总数",
        riskCount: "关联风险数",
        dueDate: "计划完成日期",
      },
    },
  ],
};
