# Aaru 用户手册

Aaru 是一个全量应用发布工具箱，用于管理跨环境的部署发布流水线。

## 快速开始

### 系统初始化

全新环境部署后，调用初始化接口创建管理员账号：

```bash
curl -X POST http://localhost:8080/api/init \
  -H "Content-Type: application/json" \
  -d '{"username": "admin"}'
```

返回管理员 token，后续请求通过 Cookie 或 `Authorization: Bearer <token>` 传递。

### 登录

- **GitLab SSO**：配置 `aaru.yaml` 中的 `gitlab.app_id` 后，登录页显示"使用 GitLab 登录"按钮
- **Mock 登录**：开发环境下直接选择用户登录

## 角色与权限

系统内置 4 个角色：

| 角色 | 能力 | 说明 |
|------|------|------|
| **admin** | 全部操作 | 跳过竖井/环境限制，可管理用户和角色 |
| **developer** | 创建发布、开始发布、重试推送 | 受 `allowed_silos` 限制 |
| **operator** | 审批通过/驳回 | 受 `allowed_silos` + `allowed_envs` 双重限制 |
| **viewer** | 仅查看 | 无操作权限 |

### 权限控制

- **可用竖井 (allowed_silos)**：`*` = 全部，`""` = 无权限，`"silo1,silo2"` = 指定竖井
- **可用环境 (allowed_envs)**：仅 operator 角色生效，格式同上
- admin 用户自动拥有全部权限，无需配置

## admin — 管理员

### 用户管理

进入"权限管理"页面：

- **查看用户列表**：展示用户名、邮箱、角色、可用竖井、可用环境
- **编辑角色**：点击角色列的"编辑"，勾选需要的角色
- **编辑权限**：点击可用竖井/环境列的"编辑"，从列表中勾选（数据从 DMDB/DevOps 自动获取）
- **批量导入**：点击"📥 批量导入"，粘贴或上传 JSON 文件

批量导入 JSON 格式：
```json
[
  {"username": "zhangsan", "role": "developer", "allowed_silos": "payment-silo"},
  {"username": "lisi", "role": "operator", "allowed_silos": "*", "allowed_envs": "staging,prod"},
  {"username": "wangwu", "role": "viewer"}
]
```

已存在的用户名自动跳过。

### 角色管理

- 查看角色列表及其权限
- 创建自定义角色

## developer — 开发者

### 创建发布

1. 点击"+ 新建发布"
2. **选择 DU 与蓝图**：左侧选择部署单元（按竖井/系统筛选），右侧选择晋级蓝图
3. **查看现状**：展示蓝图环境中 DU 的当前配置，差异字段高亮
4. **定义变更**：填写 `ArtifactVersion`（必填）及其他需要修改的字段
   - 支持统一值模式和按环境指定模式
   - 修改 `ArtifactVersion` 时，`initDb`/`initDbAuth`/`initDbFinal`/`ImportData` 中的 URL tag 自动同步
5. **预览**：确认各环境的变更内容，提交创建

### 批量发布

1. 点击"⚡ 批量发布"
2. 选择多个 DU + 一个蓝图
3. 设置新 `ArtifactVersion`
4. 预览并确认：每个 DU 创建一个独立发布单

### 开始发布

发布单创建后为"草稿"状态，点击"开始发布"激活。源节点（无前置环境）自动进入"进行中"。

### 重试推送

如果某个阶段推送 DMDB 失败（状态停留在"推送中"），点击"重试推送"重新执行。

## operator — 运维人员

### 审批发布

1. 进入"审批中心"，查看待审批列表（仅显示有权限的竖井+环境）
2. 审核变更内容，点击"通过"或"驳回"
3. 通过后自动推送配置到 DMDB
4. 驳回将导致整个发布失败

### 查看待审批

审批列表按用户的 `allowed_silos` 和 `allowed_envs` 过滤，只显示有权审批的阶段。

## viewer — 观察者

仅可查看发布列表、发布详情、部署单元对比等，无任何操作权限。

## 晋级蓝图

蓝图定义了环境晋级的 DAG（有向无环图）：

- **节点**：环境，支持三种闸门类型：
  - `manual` — 需人工审批
  - `auto` — 自动流转
  - `api_hook` — 外部系统通过 webhook 触发
- **边**：定义环境间的依赖关系

编辑器支持拖拽节点、自动布局、Bezier 曲线连线。

## 部署单元浏览

进入"部署单元"页面：

- 左侧列表按竖井/系统筛选
- 右侧展示 DU 详情及各环境版本对比
- 支持"详细比对"查看跨环境完整配置差异

## 配置文件

`aaru.yaml` 示例：

```yaml
server_host: "127.0.0.1:8080"
db_driver: "mysql"
dsn: "root:pass@tcp(127.0.0.1:3306)/aaru?charset=utf8mb4&parseTime=True&loc=Local"
jwt_secret: "your-secret-key"

dmdb:
  server_address: "http://127.0.0.1:3632"
  token: "your-dmdb-token"

devops:
  server_address: "http://localhost:8733"

gitlab:
  enabled: true
  url: "http://localhost"
  app_id: "your-app-id"
  app_secret: "your-app-secret"
  callback_url: "http://localhost:8080/auth/gitlab/callback"
  users:
    - alice
    - bob
```

## 启动

```bash
# 开发模式（SQLite）
go run ./cmd/api

# 生产模式（MySQL）
DB_DRIVER=mysql DSN="user:pass@tcp(host:3306)/aaru" go run ./cmd/api
```
