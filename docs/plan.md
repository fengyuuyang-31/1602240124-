# 信义口腔连锁管理系统 · 实施计划（plan.md）

> Spec-kit 第 2 阶段产出物。由 `spec.md` 推导技术方案，受 `constitution.md` 约束。

**版本**：1.0
**日期**：2026-11-24
**状态**：已落地

---

## 1. 技术路线选择

课堂板书给出了三条后端路线，选型结论如下：

| 板书路线 | 特点 | 本项目结论 |
|---|---|---|
| 云开发 CloudBase | 需注册小程序 AppID 与密钥，绑定腾讯云空间 | 未采用。患者端为浏览器可演示的手机端页面，不依赖 AppID |
| 19.9/月 PostgreSQL 版 | 托管数据库，运维轻，需按量付费 | 未采用。演示环境无需长期付费实例 |
| **Linux + Docker 服务器部署** | 自有服务器、可控、可复现 | **采用**。已有华为云 Flexus + Docker + Portainer |

前端与后端按板书要求分开建设，不合并为单页面应用。

## 2. 技术栈

| 层 | 选型 | 理由 |
|---|---|---|
| 后端运行时 | Node.js + TypeScript | 类型约束保证领域规则改动可控 |
| Web 框架 | Express 4 | 路由轻量，便于按端拆模块 |
| 正式数据库 | PostgreSQL 16 | 事务、约束、advisory lock 支持完整 |
| 本地演示库 | pg-mem | 无需安装数据库即可答辩演示 |
| 前端 | 原生 HTML / CSS / JavaScript 多页面 | 各端独立入口，无构建依赖，便于直接查看源码 |
| 定时任务 | 独立 worker 进程 | 复诊提醒与主服务解耦 |
| 部署 | Docker + docker-compose + Portainer Stack | 三容器编排，一键启动 |

## 3. 系统架构

```
浏览器（患者手机端 / 工作人员 / 管理网站 / 数据库页）
        │  HTTP + JSON
        ▼
Express API 服务（app 容器）
  ├─ /api/auth      登录 注册 审批 角色切换 改密
  ├─ /api/patient   患者端
  ├─ /api/dentist   牙医端
  ├─ /api/admin     院务共用
  ├─ /api/finance   费用与利润
  ├─ /api/performance 绩效
  ├─ /api/transfer  医生借调
  ├─ /api/refund    退款
  └─ /api/db        数据库查看
        │
   guards.ts（令牌解析 + RBAC）
        │
   domain.ts（业务规则集中层）
        │
   PostgreSQL（postgres 容器，pgdata 卷持久化）

worker 容器 ── 定时扫描 followup_reminder ──> 同一数据库
```

**关键设计**：路由层不写业务规则；前端传来的身份字段一律不信任，身份只从令牌取。

## 4. 前端页面与后端模块对应

| 页面 | 静态资源 | API 模块 |
|---|---|---|
| `index.html` 系统入口 | `css/common.css`、`js/core.js` | 无 |
| `staff.html` 登录 / 注册 | `css/auth.css`、`js/staff.js` | `/api/auth/staff/*` |
| `patient.html` 患者手机端 | `css/patient.css`、`js/patient.js` | `/api/auth/patient/*`、`/api/patient/*` |
| `dentist.html` 牙医工作站 | `css/admin.css`、`js/dentist.js` | `/api/dentist/*` |
| `admin.html` 管理网站 | `css/admin.css`、`js/admin.js` | `/api/admin/*`、`/api/finance/*`、`/api/performance/*`、`/api/transfer/*`、`/api/refund/*` |
| `db.html` 数据库 | `js/dbview.js` | `/api/db/*` |

## 5. 鉴权矩阵

| 接口组 | 允许角色 |
|---|---|
| 患者个人数据 | 患者令牌（`requirePatient`） |
| 牙医工作站 | 牙医角色（`requireDentist`） |
| 排班 / 患者档案 / 套餐 | 院长、负责人、前台 |
| 签到 / 结算 / 随访 | 院长、负责人、前台 |
| 库存 / 采购查看 | 院长、负责人、前台、库管 |
| 库存操作 / 入库审批 | 院长、负责人、库管 |
| 项目成本 / 利润 | 院长、负责人、前台 |
| 绩效 | 院长、负责人 |
| 注册审批 / 借调 / 退款审批 | 院长、负责人 |
| 数据库查看 | 登录工作人员 |

令牌：员工 `x-session-token`，患者 `x-patient-token`；两者互不兼容。

## 6. 关键流程实现要点

1. **预约并发**：先查排班锁定数，再写入并与原锁定数比对，`+1` 不成则报并发冲突回滚。
2. **取消预约**：校验预约归属 → 状态改取消 → `locked` 减 1。
3. **借调审批**：事务内先释放原店空闲排班（有预约的保留），再逐椅位在目标店找空位生成排班并写 `transfer_id`。
4. **退款**：唯一键幂等 → 累计额度校验 → 任一审批人通过 → 二次校验 → 冲减 `bill.payable`。
5. **成本版本**：`item_cost` 按 `effective_date` 取每项目最新一条，避免多版本重复计入。
6. **跨店绩效**：按 `visit_record.store_id` 归集，而非医生的所属门店。
7. **数据库初始化**：PostgreSQL 模式用 `pg_advisory_xact_lock(20261123)` 串行化 app / worker 的首次初始化。

## 7. 部署方案

- `Dockerfile`：多阶段构建，`npm ci` → `npm run build` → 拷贝 `src/schema.sql` 到 `dist/schema.sql`。
- `docker-compose.yml`：`postgres` / `app` / `worker`，健康检查后再启动应用，`pgdata` 卷持久化。
- Portainer：Stack → Web editor 粘贴 compose → 填环境变量 → Deploy。
- 命令行：`cp .env.example .env && docker compose up -d --build`。
- 华为云安全组放行 `3000` 端口；访问 `http://服务器公网IP:3000`。

## 8. 风险与对策

| 风险 | 对策 |
|---|---|
| 预览环境缓存旧脚本 | 静态资源禁用缓存，必要时换查询参数刷新 |
| sessionStorage 在沙箱页面抛异常 | 安全读取封装，令牌同时放 URL hash |
| 登录后页面闪退回登录页 | 登录页不自动跳转；鉴权失败抛错而非重定向，打断死循环 |
| 成本多版本导致利润失真 | 按生效日期取最新版本 |
| 借调结束误删有患者的排班 | 只删本单生成且 `locked = 0` 的排班 |
| 日期跨时区偏移 | 统一使用本地时区日期函数 |

## 9. 实施状态

`tasks.md` 中所有任务均已完成并通过构建与端到端验证。
