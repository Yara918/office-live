# 配置生成指南

> 每次交付只改页面模板里的 `lib/office-config.ts` 一个文件，其余代码不动。

## 配置文件结构

```ts
export const OFFICE_CONFIG: OfficeBaseConfig = {
  baseToken: "<客户表格 Base token>",   // 必填
  baseTitle: "<客户表格名称>",           // 必填，页面左上角显示
  ownerName: "<管理员姓名>",             // 必填，第 2 步确认
  adminCode: "<管理口令>",               // 默认取表格名称
  tables: [
    { id: "<页面主入口表ID>", role: "tasks", fields: { name: "任务名称", owner: "负责人", ... } },
    { id: "<人员表ID>", role: "members", fields: { name: "姓名", ... } },
    { id: "<其他表ID>", role: "data", fields: {} },
    // 项目/风险/里程碑/其他 data 表可选；deliver.mjs 会自动追加未选表
  ],
};
```

## 字段映射（逻辑语义 → 客户真实字段名）

| 表 | 逻辑键 | 说明 |
|---|---|---|
| tasks | name / owner / status / due / project | 页面主入口表的事项名称、负责人、状态、日期、分组（link） |
| members | name / role / level / skills | 姓名、角色、职级、技能 |
| projects | name / status / members | 项目名称、状态、项目成员 |
| risks | title / owner / level / status | 风险标题、责任人、等级、状态 |
| milestones | name / owner / status | 里程碑名称、负责人、状态 |

## 规则

- 字段名**按客户表格真实字段名填写**（不猜）
- 找不到的字段**留空** → 页面自动隐藏该信息，不报错
- `tasks` 是页面主入口和写回入口；其他表作为 `data` 进入全量画像与详情展示
- 只改本次生成必须修改的配置文件，不改其他代码文件
- 表 ID 必须是真实返回的 ID（不以 tbl 开头的可能是错误）

## 示例

见 [templates/office-config.example.ts](../templates/office-config.example.ts)
