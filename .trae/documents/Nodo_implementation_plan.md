# 记了么（Nodo）实现计划

## Context

用户在 `d:\coding\nodo\` 内提供了完整需求文档（`记了么_Nodo需求文档.md`）与一套已准备的图标资源（`Nodo.ico`、多尺寸 ico、`Nodo_完整版_图标加字标.png`、`Nodo_纯图标版.png`）。本目录为绿地，无现存代码。需按需求文档从零搭建一款 Electron + Vue 3 + Element Plus + TypeScript 的跨平台智能笔记/待办桌面软件，业务数据存入远程 MySQL（139.224.61.86:6033），AI 智能体真实接入 LangChain + 博查 + 微信 ClawBot。

本计划分阶段落地，阶段一即覆盖需求文档全部功能（地基 + 待办 + 笔记 + 配置 + AI 真实接入）。AI/微信/博查所需密钥通过配置中心 UI 由用户运行时填入，代码本身为真实接入而非桩。

## 技术架构

```
┌─────────────────────────────────────────────────────────┐
│  Electron 渲染进程（Vue 3 + Element Plus + TS）          │
│   - 路由 / Pinia / vue-i18n / 主题 / axios 客户端         │
└───────────────────────────┬─────────────────────────────┘
                            │ HTTP（localhost:7070）
┌───────────────────────────▼─────────────────────────────┐
│  Electron 主进程内嵌后端（Express + TypeORM + MySQL2）    │
│   - JWT 鉴权、业务 REST、LangChain DeepAgent、博查、微信    │
└───────────────────────────┬─────────────────────────────┘
                            │ TCP/SSL
┌───────────────────────────▼─────────────────────────────┐
│  远程 MySQL（139.224.61.86:6033）                         │
└─────────────────────────────────────────────────────────┘
```

**关键选型：**
- 构建：`electron-vite`（整合 Vite 渲染器与 Electron 主进程/预加载）
- 状态：`pinia`；路由：`vue-router`；i18n：`vue-i18n`
- 拖拽排序：`vuedraggable@next`
- 后端：`express` + `typeorm` + `mysql2` + `bcryptjs` + `jsonwebtoken` + `cors`
- AI：`langchain` + `@langchain/openai`（按 provider 切换） + `@langchain/community`
- 联网检索：博查 REST（axios 直调）
- 微信：ClawBot HTTP 接口（用户配置 base_url + token）
- 加密：`electron-store`（密钥用 machineId 派生 AES 加密落盘）

## 目录结构

```
d:\coding\nodo\
├── package.json                    # 根工作区（scripts 聚合）
├── electron.vite.config.ts         # electron-vite 配置
├── tsconfig.json / tsconfig.web.json / tsconfig.node.json
├── resources/                      # 由用户图标拷贝而来
│   ├── icon.ico                    # 主程序图标（用 Nodo.ico / Nodo_256x256.ico）
│   └── icons/{16,24,32,48,64,128,256}.ico
├── build/                          # 打包资源（icon.png 256x256 用于安装包）
│   └── icon.png（由 Nodo_纯图标版.png 转换/裁剪）
├── src/                            # 渲染进程
│   ├── main.ts
│   ├── App.vue
│   ├── env.d.ts
│   ├── assets/
│   │   └── logo.png                # 顶栏 Logo（用 Nodo_纯图标版.png 或裁剪字标版）
│   ├── router/index.ts
│   ├── stores/                     # pinia：auth、todo、notes、config、assistant、theme、i18n
│   ├── api/                        # axios 实例 + 模块化接口
│   │   ├── http.ts
│   │   ├── auth.ts todo.ts notes.ts config.ts assistant.ts
│   ├── i18n/
│   │   ├── index.ts
│   │   └── locales/{zh.ts, en.ts}
│   ├── theme/                      # element-plus 暗色 CSS 变量 + 时间跟随
│   ├── components/                 # 通用：TopBar、UserMenu、LangSwitch、ThemeSwitch、Logo
│   ├── layouts/DefaultLayout.vue
│   ├── views/
│   │   ├── auth/Login.vue Register.vue
│   │   ├── todo/Index.vue GroupList.vue TodoList.vue TodoEditor.vue
│   │   ├── notes/Index.vue FileTree.vue DirToolbar.vue
│   │   ├── assistant/Index.vue ChatPanel.vue
│   │   └── config/Index.vue sections/{Profile,Model,Bocha,WeChat,Theme,Lang}.vue
│   └── utils/{crypto,fs-guard,time-rule}.ts
├── electron/                       # 主进程
│   ├── main.ts                     # 创建窗口、托管 Express、加载 logo、窗口尺寸记忆
│   ├── preload.ts                  # contextBridge：选择工作目录、打开文件、读目录
│   ├── server/                     # 内嵌后端
│   │   ├── index.ts                # Express 启动（监听 127.0.0.1:7070）
│   │   ├── env.ts                  # 读取配置（DB / 端口 / 密钥）
│   │   ├── data-source.ts          # TypeORM DataSource
│   │   ├── entities/               # User, TodoGroup, Todo, UserConfig, TodoCollaborator
│   │   ├── modules/
│   │   │   ├── auth/               # register, login, jwt middleware, strong-password
│   │   │   ├── todo/               # groups & todos CRUD + reorder + pin + quick-filter
│   │   │   ├── notes/              # 工作目录元数据（路径存到 user_config）
│   │   │   ├── config/             # 头像/用户信息/模型/博查/微信/主题/语言
│   │   │   └── assistant/          # /chat /chat/stream /todos/* (HITL)
│   │   ├── services/
│   │   │   ├── LLMService.ts        # 按 provider 动态构造 ChatOpenAI 等
│   │   │   ├── BochaService.ts      # 联网检索
│   │   │   ├── DeepAgentService.ts  # LangChain DeepAgent 编排
│   │   │   ├── WeChatClawBotService.ts
│   │   │   ├── NotesSafeFs.ts       # 工作目录边界校验
│   │   │   └── SecretStore.ts       # 密钥 AES 落盘 + 解密注入
│   │   └── middleware/{error,auth}.ts
│   └── windows/mainWindow.ts       # 窗口尺寸记忆（electron-store）
└── .env                            # DB_HOST/PORT/USER/PASS（不进仓库）
```

## 数据库实体（TypeORM 自动 sync）

| 表 | 关键字段 |
|---|---|
| `user` | id, email(unique), password_hash, name, avatar_path, phone, created_at |
| `todo_group` | id, user_id, name, sort, pinned, created_at |
| `todo` | id, group_id, user_id, content, remark, shelved(bool), owner, collaborators(JSON), plan_start, plan_end, done(bool), sort, pinned, remind_enabled, remind_rule(JSON), created_at |
| `user_config` | id, user_id(unique), model_config(JSON), bocha_config(JSON), wechat_config(JSON), theme_default, theme_follow_time, lang_default, work_dir, updated_at |

密码用 `bcryptjs` 加盐 10 轮；密钥类（api_key）经 `SecretStore` 用 machineId 派生 AES-256 加密后存入 `user_config`，前端永不解密，仅后端服务进程按需取出。

## 阶段一执行步骤（按顺序，每步独立可验证）

### 步骤 1 — 工程骨架与图标
- 初始化 `package.json`、`electron.vite.config.ts`、`tsconfig.*`、`.gitignore`、`.env`
- 安装依赖：electron、electron-vite、vue、vue-router、pinia、element-plus、@element-plus/icons-vue、vue-i18n、axios、vuedraggable@next、typeorm、mysql2、express、cors、bcryptjs、jsonwebtoken、langchain、@langchain/openai、@langchain/community、electron-store、@vitejs/plugin-vue、sass
- 拷贝图标：`Nodo.ico`→`resources/icon.ico`；`Nodo_256x256.ico`→`build/icon.ico`/转 `build/icon.png`；`Nodo_纯图标版.png`→`src/assets/logo.png`；尺寸 ico→`resources/icons/{尺寸}.ico`
- `electron/main.ts` 创建窗口：默认尺寸 = 屏幕的 3/4；用 `electron-store` 记忆 `bounds`
- `electron/preload.ts` 暴露：`selectWorkDir()`、`readDirEntries(path)`、`openFileWithDefaultApp(path)`、`getWindowControlsInfo()`
- 渲染器 `App.vue` + `DefaultLayout.vue` 骨架：顶部（Logo + 主菜单 + 主题/语言/消息/头像）+ 路由出口
- 验证：`npm run dev` 启动后能看到带 Logo 的空窗口，尺寸正确，关闭重开保留尺寸

### 步骤 2 — 主题（黑白夜 + 时间跟随）与 i18n（中英文）
- `src/theme/`：基于 Element Plus 官方 dark CSS + `html.dark` 类切换；`useThemeStore` 持久化到 `electron-store`
- 时间跟随：8-17 点白天，其余黑夜；定时每分钟检查；可在配置中心关闭跟随
- `src/i18n/`：`vue-i18n` + zh/en 两份 locale，覆盖所有界面文案与 Element Plus locale
- 顶栏按钮 `ThemeSwitch`、`LangSwitch` 接通 store
- 验证：切换按钮即时生效；修改系统时间到 18:00 重启应为暗色（若开启跟随）

### 步骤 3 — 后端基线与 TypeORM 接入
- `electron/server/index.ts`：Express + cors + json + 路由挂载，监听 `127.0.0.1:7070`；主进程启动时 spawn
- `data-source.ts`：TypeORM DataSource，`synchronize: true`（开发期自动建表），读 `.env` 与运行时配置
- 所有 entities 定义（见上表）
- `auth` 中间件：解 JWT → 注入 `req.user`
- `error` 中间件：统一错误体 `{code, message}`
- 验证：启动后 `127.0.0.1:7070/health` 200；MySQL 表自动建立

### 步骤 4 — 注册 / 登录（强密码）
- `POST /auth/register`：邮箱唯一校验、强密码（≥8、大小写、数字、特殊字符）、bcrypt 哈希
- `POST /auth/login`：校验、签 JWT（7d）、返回 token + 用户基本信息
- `GET /auth/me`：刷新当前用户
- 前端 `Login.vue` / `Register.vue`：Element Plus 表单 + 校验 + token 存 pinia + `electron-store`
- 路由守卫：未登录跳 `/login`
- `UserMenu.vue`：头像下拉 → 配置中心、退出登录
- 验证：注册→登录→token 持久化→退出→重新登录

### 步骤 5 — 待办模块（完整）
- 后端：
  - `todo_group`：增删改、reorder（更新 sort）、pin
  - `todo`：CRUD + 搁置/取消 + 完成/未完成 + reorder + pin + 快速查询（未完成 / 本日 / 延期）
  - 提醒规则入参校验：`{before_minutes, repeat_enabled, repeat_interval_minutes, repeat_max_times}`
- 前端：
  - `todo/Index.vue`：左右两栏（分组树 + 待办列表）
  - `GroupList.vue`：vuedraggable 排序、置顶、新增/编辑/删除弹窗
  - `TodoList.vue`：vuedraggable 跨分组拖动、快速查询 tabs、置顶、搁置、完成、提醒开关
  - `TodoEditor.vue`：抽屉表单（含协作人多选、计划开始/结束、提醒规则可视化）
- 验证：新建分组→拖动排序→新建待办→置顶→搁置→标记完成→延时到本日查询→删除

### 步骤 6 — 笔记模块（完整）
- 后端 `notes` 模块：保存 `work_dir` 到 `user_config`；列出/创建/移动/删除/重命名目录
- `NotesSafeFs`：所有路径用 `path.resolve(workDir, target)` 后 `startsWith(workDir)` 校验，越界抛 403
- 前端 `FileTree.vue`：调 preload IPC 读目录；目录在上、文件在下，各自按名正序
- `DirToolbar.vue`：新建目录、重命名、移动（树选择）、删除
- 双击文件：调 `openFileWithDefaultApp`（Electron `shell.openPath`）
- 工作目录选择弹窗：调 `selectWorkDir`（`dialog.showOpenDialog`）
- 验证：选目录→树展开→新建子目录→重命名→移动→删除；尝试 `../` 越界请求被 403

### 步骤 7 — 配置中心（完整）
- 后端 `config` 模块：GET/PUT `/config`（拆分 model/bocha/wechat/profile/theme/lang 子资源）
- 头像：上传走 multipart，限制 ≤2MB + 256×256；存到 `userData/avatars/<userId>.png`
- 密钥字段：前端只显示掩码（`****最后4位`），更新时整体覆盖；后端用 `SecretStore` 加密落库
- 前端各 section 组件：表单 + 校验 + 保存提示
- 主题默认项 + 跟随时间开关接通 `themeStore`
- 语言默认项接通 `i18nStore`
- 验证：保存模型 api_key→后端能取到明文；重新登录后配置仍在；头像显示

### 步骤 8 — 小助理（真实接入）
- `LLMService`：按 `provider`（openai / deepseek / qwen / zhipu 等）构造 `ChatOpenAI`，注入 `name/api_key/base_url/temperature`
- `BochaService`：`POST https://api.bochaai.com/v1/web-search`，按 `api_key`
- `DeepAgentService`：基于 LangChain `AgentExecutor` + 工具：
  - `create_note`（仅写/改，禁删禁移动）
  - `add_todo` / `update_todo` / `query_todos`
  - `delete_todo`（HITL：返回待确认任务，前端弹窗确认 → `/assistant/confirm` 通过）
  - `web_search`（博查）
- `POST /assistant/chat` 流式（SSE）返回 token；前端 `ChatPanel.vue` 用 `EventSource` 渲染
- 微信 ClawBot：`POST /wechat/bind/start`（返回二维码 URL）→ 用户扫码 → ClawBot 回调 `POST /wechat/callback` → 后端保存 session；收到消息后丢给 DeepAgent 处理并回复
- 前端 `assistant/Index.vue`：消息流、工具调用气泡、HITL 确认弹窗、模型未配置时引导跳转配置中心
- 验证：在配置中心填好真实 api_key 后，对话框能聊天、能联网搜索、能创建笔记、能新建/查询待办；删除待办会弹确认框

## 安全要点

- 强密码校验在后端 `auth/register` 与前端同步
- JWT 存于 `electron-store`（userData），不写 localStorage
- `api_key` 仅后端解密使用；前端只显示掩码
- 笔记与小助理所有文件操作经 `NotesSafeFs` 边界校验
- `human-in-the-loop`：删除待办必须前端确认 → 后端二次校验
- `.env` 与 `electron-store` 数据不进 git

## 关键文件引用清单

> 实现阶段按上述步骤逐个创建，不在此枚举全部路径；以下是关键参照点：

- 需求文档：[记了么_Nodo需求文档.md](file:///d:/coding/nodo/记了么_Nodo需求文档.md)
- 主图标：`d:\coding\nodo\Nodo.ico`、`d:\coding\nodo\Nodo_256x256.ico`
- 纯图标版（用作顶栏 Logo）：`d:\coding\nodo\Nodo_纯图标版.png`
- 字标版（可用作启动画面/关于）：`d:\coding\nodo\Nodo_完整版_图标加字标.png`
- 多尺寸 ico：`d:\coding\nodo\Nodo_{16,24,32,48,64,128}x{...}.ico`

## 验证总览（端到端）

1. `npm install` 成功；`npm run dev` 启动 Electron 窗口（带 Logo、3/4 屏、尺寸记忆）
2. 切换中英文 / 黑白夜即时生效；修改系统时间到 18:00 重启应为暗色（若开启跟随）
3. 注册新邮箱（弱密码被拒）→ 登录 → 头像下拉见"配置中心/退出登录"
4. 待办：建分组→拖拽排序→建待办→置顶→搁置→完成→快速查询→提醒规则配置
5. 笔记：选工作目录→树展开→新建/重命名/移动/删除目录；双击文件用系统默认软件打开；`../` 越界被拒
6. 配置中心：保存模型 api_key（前端只显示掩码）、博查 api_key、上传头像（限制尺寸）、主题/语言默认项
7. 小助理：配置好真实密钥后可聊天、可联网检索（看到博查结果）、可创建笔记/待办、删除待办弹出确认
8. 微信：扫码绑定后从微信发消息能在小助理响应（依赖 ClawBot 服务可用）

## 风险与备注

- AI 全量真实接入依赖用户在配置中心填入有效 `api_key`/`base_url`；未配置时小助理只提示去配置
- 微信 ClawBot 依赖外部服务可用性与扫码绑定，如服务不可用则该子功能阻塞，其余模块不受影响
- TypeORM `synchronize:true` 仅开发期使用，后续生产应改为迁移
- 远程 MySQL 网络抖动可能影响首启体验，后端加连接池与重试
