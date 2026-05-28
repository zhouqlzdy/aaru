# Aaru - 全量应用发布工具箱

> 尘世如河流横亘于幽冥与阿如之间，凡人不可逾越，不可试探，不可觊觎，违背者永堕幽冥。欲升入阿如，须有如兀鸟的形体，盘旋幽冥，啄食三种脏器，方可获阿赫玛尔的允诺，以隼的形体飞过河流。隼的形体飞过河流后，须以飞羽燃起三处太阳的余烬，方可获阿赫玛尔的垂怜，升入阿如。

Aaru提供了部署单元粒度的应用发布流水线，允许一个新的版本按照一定的晋级顺序依次部署到多个环境上。支持特定环境的部署人工卡点审核。

## 概念

* **竖井Silo** 应用的逻辑模型，每个应用竖井可能包括多个可部署可执行的二进制文件。
* **环境公共配置EnvCommonConfig** 保存一套环境中所有应用共享的配置，每一个环境都对应一个环境公共配置。
* **部署单元DeployUnit** 保存应用自己的配置，最终的应用配置还需要结合所部署的环境对应的环境公共配置一起生成。每个部署单元对应一个环境中的一个可执行文件。
* **DMDB** 提供所有应用在所有环境中的配置信息，Aaru通过DMDB的API获取环境和部署单元数据。
* **应用发布** 通过DMDB提供的api对环境配置的变更动作。

## 基础功能

### 1. 权限管理

Aaru的用户通过Gitlab单点登录获得用户id后，在Aaru系统内部实现用户 -> 角色 -> 部署单元 -> 操作权限。

- **认证**: Mock Gitlab SSO登录（开发模式可选任意mock用户），JWT Token
- **角色**: 预置admin、developer、operator角色
- **权限**: RBAC，支持deploy、approve、view、manage四种操作
- **部署单元级权限**: `*` 表示所有部署单元

### 2. 发布流水线管理

创建发布单，按晋级策略依次推进到各环境。

- **创建发布**: 选择部署单元和版本号，可选关联晋级蓝图
- **开始发布**: DAG源节点同时进入in_progress
- **环境晋级**: 审批通过后自动晋级下一环境，支持手动推进
- **发布回滚**: 已完成的发布可回滚
- **状态**: draft → in_progress → approved/rejected → completed/failed/rolled_back

### 3. 审批管理

- **待审批列表**: 集中展示所有待审批阶段
- **审批通过/驳回**: 驳回后整单失败
- **审批备注**: 支持添加备注

### 4. 晋级蓝图（DAG策略）

核心功能，支持以DAG图形式编辑环境晋级策略。

- **多策略**: 支持创建多个晋级蓝图，每个蓝图定义一组环境节点和晋级路径
- **DAG编辑器**: SVG画布，支持拖拽节点、Shift+点击创建边、双击边删除、自动排版
- **门槛配置**:
  - **人工审批**: 选择环境后自动创建 `approver-{env_code}` 角色并授予approve权限
  - **API Hook**: 系统自动生成webhook token，外部系统调用webhook URL触发晋级
- **DAG验证**: 保存时校验重复节点、重复边、自环、循环依赖，拒绝非法配置
- **发布集成**: 创建发布单时可关联蓝图，蓝图DAG结构决定阶段晋级顺序

### 5. 部署单元浏览

从DMDB获取环境、竖井、业务系统、部署单元信息，支持按环境/系统筛选。

## 技术架构

### 前端

- 纯HTML/CSS/JavaScript单页应用，无外部依赖
- 暗色侧边栏设计，SVG图标
- DAG编辑器：SVG画布 + 贝塞尔曲线边 + 拖拽交互

### 后端

- **框架**: Gin
- **数据库**: SQLite (GORM)
- **认证**: JWT
- **外部依赖**: DMDB API (localhost:3632)

## 快速开始

```bash
go run ./cmd/api
```

访问 `http://localhost:8080`，选择 alice 用户登录（自动分配admin角色）。

## API接口

### 认证
| 方法 | 路径 | 说明 |
|------|------|------|
| GET | /auth/login | 登录页面 |
| POST | /auth/login | 提交登录 |
| POST | /auth/callback | SSO回调 |

### 数据查询（从DMDB获取）
| 方法 | 路径 | 说明 |
|------|------|------|
| GET | /api/environments | 环境列表 |
| GET | /api/silos | 竖井列表 |
| GET | /api/systems | 业务系统列表 |
| GET | /api/deploy-units | 部署单元列表 |
| GET | /api/deploy-units/:code | 部署单元详情 |

### 发布管理
| 方法 | 路径 | 说明 |
|------|------|------|
| POST | /api/releases | 创建发布单（支持blueprint_id） |
| GET | /api/releases | 发布单列表 |
| GET | /api/releases/:id | 发布单详情 |
| POST | /api/releases/:id/start | 开始发布 |
| POST | /api/releases/:id/rollback | 回滚发布 |
| POST | /api/stages/:stageId/approve | 审批通过 |
| POST | /api/stages/:stageId/reject | 审批驳回 |
| POST | /api/stages/:stageId/promote | 推进到下一环境 |
| GET | /api/approvals/pending | 待审批列表 |

### 晋级蓝图
| 方法 | 路径 | 说明 |
|------|------|------|
| GET | /api/blueprints | 蓝图列表 |
| POST | /api/blueprints | 创建蓝图（含nodes+edges） |
| GET | /api/blueprints/:id | 蓝图详情（含节点、边、webhook URL） |
| PUT | /api/blueprints/:id | 更新蓝图（全量替换nodes+edges） |
| DELETE | /api/blueprints/:id | 删除蓝图及关联节点/边 |

### Webhook晋级
| 方法 | 路径 | 说明 |
|------|------|------|
| GET/POST | /api/hooks/promote/:stageId?token=xxx | 外部系统调用，自动推进阶段 |

### 权限管理
| 方法 | 路径 | 说明 |
|------|------|------|
| GET | /api/admin/users | 用户列表 |
| GET | /api/admin/roles | 角色列表 |
| POST | /api/admin/roles | 创建角色 |
| PUT | /api/admin/users/:userId/roles | 设置用户角色 |
| PUT | /api/admin/roles/:roleId/permissions | 设置角色权限 |

## 配置

可选配置文件 `./aaru.yaml` 或 `~/.aaru/config.yaml`：

```yaml
server_host: "127.0.0.1:8080"
db_path: "/tmp/aaru.db"
jwt_secret: "your-secret-key"
dmdb:
  server_address: "http://127.0.0.1:3632"
gitlab:
  enabled: true
  users:
    - alice
    - bob
    - charlie
promote_plan:
  - code: dev
    name: 开发环境
  - code: test
    name: 测试环境
  - code: uat
    name: UAT环境
  - code: prod
    name: 生产环境
```
