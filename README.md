# Poker Chips

一个面向线下德州扑克局的筹码管理工具。适用于“有牌、有玩家，但没有实体筹码”的场景：用浏览器记录玩家筹码、盲注、行动顺序、奖池、摊牌结算和下一局轮转。

项目主体是纯前端静态应用，无需构建步骤；页面通过 Firebase Realtime Database 支持房间同步，并已预留 Firebase Auth、Security Rules 和 Cloud Functions 的安全化落点。

## Features

- 创建房间并通过邀请链接同步牌局状态
- 添加 2-10 名玩家、设置初始筹码和大盲注
- 自动分配 Dealer、小盲、大盲位置
- 支持 Check、Call、Raise、Fold 和 All In
- Raise 使用展开式加注面板，支持最小加注、半池、2/3 池、一池、All In、步进微调和手动输入
- 按德州扑克常见规则限制最小加注；短码 All In 不会更新最小加注幅度，也不会向已行动玩家重新开放加注
- 自动推进翻牌前、翻牌后、转牌、河牌轮次
- 每个下注轮结束后显示房间同步的发牌提醒，确认后才开放下一轮操作
- 自动记录奖池、本轮下注和本手投入
- 玩家卡片显示当前需跟注额，Call 按钮直接显示本次需要投入的筹码
- 大屏端使用独立当前操作面板，避免展开 Raise 时撑高其他玩家卡片；手机端保留当前玩家卡片内操作
- Fold 前有二次确认，降低误触风险
- 摊牌阶段支持选择一个或多个赢家并平分奖池
- 结算前生成房间同步的筹码分配预览，任一设备可确认或取消
- 可打开“席位与身份管理”，处理入座请求、换设备接管、协管授权，以及结算后的座次/筹码/离桌调整
- 筹码归零的玩家会标记为待补码，下一手自动跳过
- 初步支持边池计算和结算
- 支持结算后开始下一局并轮转 Dealer
- 多人房间使用匿名设备身份、玩家昵称、入座/接管请求和房主审批，不要求普通玩家记忆管理码或玩家码
- 开局前可选择“本地模式”或“多人房间”，多人房间支持创建/加入房间、复制邀请链接和请求绑定玩家座位
- 多人房间权限分层：房主/协管管理准备页和牌桌；已绑定玩家只能由本人操作，未绑定玩家由房主/协管代管；发牌确认由 Dealer 或其代管者完成
- 结算预览和开始下一局需要所有相关玩家确认；未绑定玩家的确认由房主/协管代管，任一设备仍可取消结算预览并回到赢家选择
- 多人房间中，已绑定的玩家默认在本设备视角下位于牌桌下方中间；也可手动旋转本机牌桌视角，点击“以我为底”可恢复，旋转不会同步给其他设备
- 响应式界面，适配桌面和手机浏览器
- 玩家区使用椭圆形牌桌布局，按玩家数量均匀分布座位；桌面为横向椭圆，手机为纵向椭圆
- 深绿牌桌主题和扑克筹码图标
- 页眉筹码图标可打开 Chip Riffle 浮窗，支持换肤、真实顺序洗筹动画和真实筹码采样音效
- 初始页和游戏区提供折叠玩家手册，包含使用指南、德扑规则和牌型大小表

## Tech Stack

- HTML / CSS / JavaScript
- Native ES modules
- Firebase Realtime Database
- Firebase Anonymous Auth integration with local fallback
- Firebase Security Rules and Cloud Functions scaffolding
- No bundler, no framework required for the browser app

## Quick Start

克隆项目后，在仓库根目录启动一个静态服务器：

```bash
python3 -m http.server 8000
```

然后打开：

```text
http://localhost:8000/
```

也可以使用任意静态服务器托管本项目，例如 GitHub Pages、Nginx、Vercel 静态站点或 Cloudflare Pages。

## Usage

1. 打开页面。
2. 选择“本地模式”或“多人房间”。本地模式适合一台设备管理整桌；多人房间会通过 Firebase 同步。
3. 多人房间中输入昵称后点击“创建房间”，然后复制邀请链接给其他玩家；也可以输入房间 ID 后加入。
4. 房主设置初始筹码和大盲注，添加至少两位玩家。
5. 玩家打开邀请链接，输入昵称，点击目标座位的“请求坐下”或“请求接管”；房主/协管在“席位与身份管理”中批准。
6. 房主/协管点击“开始游戏”。
7. 按当前行动玩家依次选择 Check、Call、Raise 或 Fold；Call 按钮会显示需要投入的筹码。
8. 点击 Raise 会展开加注面板。可以用“最小 / 1/2 池 / 2/3 池 / 一池 / All In”和加减按钮调整，也可以直接输入“加到”的总额；面板会实时显示“本次投入”，规则合法后才能确认。
9. 每个下注轮结束后，按实际牌桌发出公共牌，再在页面中确认继续。
10. 进入摊牌后，为每个奖池选择赢家，生成结算预览。
11. 所有设备都会看到结算预览；房间模式下所有相关玩家确认后才结算，取消则回到赢家选择。
12. 游戏中如需换设备，用新设备打开邀请链接并请求接管自己的座位；房主/协管批准后，控制权会切换到新设备，不改变当前手牌状态。
13. 房间模式下所有下一局可参与玩家确认后开始下一局；本地模式可直接开始。

多人使用时，请让所有设备进入同一个房间 ID。页面会通过 Firebase 同步玩家、奖池、行动轮次和日志。

当前浏览器端已接入 Firebase Anonymous Auth，并保留本机 ID 降级路径。仓库提供了 `database.rules.json` 和 `functions/` 命令处理骨架；在 Cloud Functions 完成牌局命令校验前，牌局写入仍属于过渡实现，不应视为完整恶意客户端防护。

身份绑定只改变控制权，不改变当前手牌状态。筹码、座次、删除玩家、离桌/回桌等牌桌改动只在开局前或本手结算完成后开放，进行中的手牌不会被这些操作影响。

页眉左侧的筹码图标会打开 Chip Riffle 浮窗。点击筹码分堆，上滑堆叠筹码；浮窗内可切换单色/双色筹码皮肤，皮肤选择会保存在本机，当前筹码位置不会保存。

## Project Structure

```text
.
├── assets/
│   ├── audio/
│   │   └── riffle/
│   ├── favicon.png
│   └── poker-chip-icon.png
├── src/
│   ├── access-codes.js
│   ├── approvals.js
│   ├── deal-prompts.js
│   ├── dialogs.js
│   ├── firebase.js
│   ├── game-rules.js
│   ├── guide.js
│   ├── identity.js
│   ├── main.js
│   ├── player-model.js
│   ├── player-seat-ui.js
│   ├── raise-ui.js
│   ├── room-claims-controller.js
│   ├── room-entry.js
│   ├── room-lobby-controller.js
│   ├── room-state.js
│   ├── room-sync.js
│   ├── room-permissions.js
│   ├── settlement-engine.js
│   ├── riffle.js
│   ├── riffle-sound.js
│   ├── table-center-ui.js
│   ├── table-manager-controller.js
│   ├── table-manager-ui.js
│   ├── table-layout.js
│   ├── table-view-preferences.js
│   └── ui-dom.js
├── functions/
│   ├── index.js
│   └── package.json
├── database.rules.json
├── firebase.json
├── index.html
├── poker-game.js
├── PROJECT_NOTES.md
├── styles.css
└── README.md
```

- `index.html`: 页面结构和主要 DOM 容器。
- `styles.css`: 全站视觉主题、响应式布局、游戏控件样式和 Chip Riffle 外观皮肤。
- `src/main.js`: 牌局状态编排、下注流程、摊牌结算、Firebase 同步和 DOM 渲染。
- `src/access-codes.js`: 旧版管理员/玩家恢复码的本地缓存、salt 和校验工具。
- `src/player-model.js`: 玩家 ID、开局玩家字段归一化和重复昵称显示标签等数据层工具。
- `src/approvals.js`: 结算确认、下一局确认等多人审批进度的纯逻辑。
- `src/deal-prompts.js`: 开局手牌、翻牌、转牌、河牌发牌提示的纯逻辑。
- `src/dialogs.js`: 通用确认弹窗和牌桌操作浮层的 DOM 组装。
- `src/firebase.js`: Firebase SDK 初始化、Anonymous Auth 和 Realtime Database API 导出。
- `src/game-rules.js`: 座位资格、Button/盲注/行动顺序、跟注和加注规则等纯逻辑。
- `src/identity.js`: 本机客户端 ID fallback、房间模式、成员列表和玩家归属字段的兼容身份层。
- `src/guide.js`: 初始页和游戏页折叠玩家手册的内容与渲染。
- `src/player-seat-ui.js`: 牌桌玩家标签、位置徽章和座位详情浮窗的 DOM 渲染。
- `src/raise-ui.js`: Raise 加注面板的预设、微调、输入和实时预览 DOM 渲染。
- `src/room-claims-controller.js`: 玩家入座/接管、释放绑定、请求批准/拒绝和协管授权的纯数据变换。
- `src/room-entry.js`: 房间 ID、邀请链接、昵称本地记忆和入座请求归一化工具。
- `src/room-lobby-controller.js`: 本地/房间模式切换、创建/加入房间数据草稿和准备页同步 payload。
- `src/room-state.js`: 房间/牌局 payload 的玩家、奖池、赢家选择和结算预览归一化。
- `src/room-sync.js`: Firebase Realtime Database 房间读写、监听、事务和局部更新外壳。
- `src/room-permissions.js`: 房主、协管、玩家控制权和房间管理权的纯判断逻辑。
- `src/settlement-engine.js`: 边池构建、赢家结算计划、派奖和结算报告的纯计算逻辑。
- `src/riffle.js`: 页眉 Chip Riffle 浮窗、换肤按钮、真实顺序洗筹动画和交互状态。
- `src/riffle-sound.js`: Chip Riffle 浮窗的采样音效播放器。
- `src/table-center-ui.js`: 牌桌中央状态区、等待提示、赢家选择和结算预览的 DOM 渲染。
- `src/table-manager-controller.js`: 席位管理 draft 的座次、筹码、状态、摘要和归一化逻辑。
- `src/table-manager-ui.js`: 席位与身份管理窗口的 DOM 渲染。
- `src/table-layout.js`: 牌桌玩家标签的可调座位坐标和本地旋转计算。
- `src/table-view-preferences.js`: 本机牌桌视角旋转等不会同步到房间的偏好存储。
- `src/ui-dom.js`: 小型 DOM 工厂，如按钮和段落元素。
- `poker-game.js`: 兼容入口，转发到 `src/main.js`。
- `assets/`: favicon、站点品牌图标和 Chip Riffle 音频采样。音频授权见 `assets/audio/riffle/LICENSES.md`。
- `database.rules.json`: 过渡期 Realtime Database 规则草案，要求认证并约束成员/请求/命令写入。
- `functions/`: Cloud Functions 命令处理骨架，后续用于把关键牌局状态写入迁出前端。
- `PROJECT_NOTES.md`: 面向 coding agent 和维护者的架构、进度、风险说明。

## Audio Assets

Chip Riffle 音效使用真实筹码采样，不再使用程序化合成作为主声音来源。

- Kenney Casino Audio: CC0，原始 OGG 已转码为 MP3，以提高 iOS/Safari 兼容性。
- BigSoundBank Poker Chips: CC0 / public-domain equivalent，用于分堆和落稳等更完整的筹码声。

详细来源、作者和授权见 `assets/audio/riffle/LICENSES.md`。

## Development

本项目没有构建流程。修改后直接刷新浏览器即可。

常用检查：

```bash
for f in src/*.js; do node --check "$f" || exit 1; done
for f in src/*.js functions/*.js; do node --check "$f" || exit 1; done
git diff --check
```

本地预览：

```bash
python3 -m http.server 8000
```

## Firebase Notes

`src/firebase.js` 中包含客户端 Firebase 配置。Firebase Web 配置本身通常不是密钥；生产环境必须依赖 Firebase Auth、Realtime Database Security Rules、App Check 和后端命令校验控制读写权限。

如果你 fork 或部署自己的实例，建议：

- 创建自己的 Firebase 项目
- 替换 `src/firebase.js` 中的配置
- 启用 Anonymous Authentication
- 部署或调整 `database.rules.json`
- 部署 `functions/` 后，把关键牌局操作逐步迁移到 command 写入模型
- 配置 App Check、API key referrer 限制和预算告警
- 避免把正式环境数据库暴露为无限制读写

## Known Limitations

- All In、边池和复杂多人结算逻辑已有实现，但仍需要更多真实牌局场景验证。
- 当前没有自动化测试套件。
- 核心规则、身份工具、恢复码工具、玩家模型、房间入口工具、房间大厅数据工具、身份绑定/请求工具、权限判断、边池结算计算、玩家座位 UI、加注面板 UI、牌桌坐标、牌桌视角偏好、牌桌中央 UI、牌桌管理逻辑/UI、通用弹窗工具、房间状态归一化和 Firebase 房间访问外壳已从 `src/main.js` 中拆出；具体业务事务编排和大部分状态仍集中在 `src/main.js`。
- 权限层正在从前端体验级限制迁移到 Auth/Rules/Functions 模型；当前仍有部分牌局写入由前端直接完成。
- 房间同步依赖 Firebase CDN 和 Realtime Database；离线或网络受限时可能无法正常同步。
- 本工具只负责筹码和下注流程，不判断牌型大小。

## Contributing

欢迎提交 Issue 或 Pull Request。比较适合优先改进的方向：

- 为下注和边池逻辑补充单元测试
- 为 `src/game-rules.js` 和 `src/identity.js` 补充单元测试
- 继续拆分 Firebase 写入编排和 DOM 渲染，降低 `src/main.js` 复杂度
- 改进 Firebase 安全规则和房间生命周期
- 完成 Cloud Functions 命令处理，把下注、发牌确认、结算和下一局写入迁出前端
- 增加导出牌局日志或恢复历史牌局能力
- 优化小屏幕上的密集操作体验

## License

当前仓库尚未声明开源许可证。正式开放协作前，建议补充 `LICENSE` 文件。
