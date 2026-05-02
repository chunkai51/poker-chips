# Poker Chips

一个面向线下德州扑克局的筹码管理工具。适用于“有牌、有玩家，但没有实体筹码”的场景：用浏览器记录玩家筹码、盲注、行动顺序、奖池、摊牌结算和下一局轮转。

项目是纯前端静态应用，无需构建步骤；页面通过 Firebase Realtime Database 支持房间同步。

## Features

- 创建房间并通过房间 ID 同步牌局状态
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
- 结算后可打开牌桌管理，调整座次、筹码、坐出、离桌和回桌
- 筹码归零的玩家会标记为待补码，下一手自动跳过
- 初步支持边池计算和结算
- 支持结算后开始下一局并轮转 Dealer
- 响应式界面，适配桌面和手机浏览器
- 玩家区使用椭圆形牌桌布局，按玩家数量均匀分布座位；桌面为横向椭圆，手机为纵向椭圆
- 深绿牌桌主题和扑克筹码图标
- 页眉筹码图标可打开 Chip Riffle 浮窗，支持换肤、真实顺序洗筹动画和真实筹码采样音效
- 初始页和游戏区提供折叠玩家手册，包含使用指南、德扑规则和牌型大小表

## Tech Stack

- HTML / CSS / JavaScript
- Native ES modules
- Firebase Realtime Database
- No bundler, no framework, no package manager required

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
2. 输入房间 ID 并点击“手动同步”，或直接开始游戏让系统生成房间 ID。
3. 设置初始筹码和大盲注。
4. 添加至少两位玩家。
5. 点击“开始游戏”。
6. 按当前行动玩家依次选择 Check、Call、Raise 或 Fold；Call 按钮会显示需要投入的筹码。
7. 点击 Raise 会展开加注面板。可以用“最小 / 1/2 池 / 2/3 池 / 一池 / All In”和加减按钮调整，也可以直接输入“加到”的总额；面板会实时显示“本次投入”，规则合法后才能确认。
8. 每个下注轮结束后，按实际牌桌发出公共牌，再在页面中确认继续。
9. 进入摊牌后，为每个奖池选择赢家，生成结算预览。
10. 所有设备都会看到结算预览；确认后结算，取消则回到赢家选择。
11. 结算后如需补码、回桌或调整座次，点击“牌桌管理”。
12. 点击“开始下一局”继续游戏。

多人使用时，请让所有设备进入同一个房间 ID。页面会通过 Firebase 同步玩家、奖池、行动轮次和日志。

牌桌管理只在本手结算完成后生效。进行中的手牌不会被座次、离桌、回桌或补码操作影响；这符合现金局常见的 table stakes 思路。

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
│   ├── firebase.js
│   ├── guide.js
│   ├── main.js
│   ├── riffle.js
│   └── riffle-sound.js
├── index.html
├── poker-game.js
├── PROJECT_NOTES.md
├── styles.css
└── README.md
```

- `index.html`: 页面结构和主要 DOM 容器。
- `styles.css`: 全站视觉主题、响应式布局、游戏控件样式和 Chip Riffle 外观皮肤。
- `src/main.js`: 牌局状态、下注流程、摊牌结算、Firebase 同步和 DOM 渲染。
- `src/firebase.js`: Firebase SDK 初始化与 Realtime Database API 导出。
- `src/guide.js`: 初始页和游戏页折叠玩家手册的内容与渲染。
- `src/riffle.js`: 页眉 Chip Riffle 浮窗、换肤按钮、真实顺序洗筹动画和交互状态。
- `src/riffle-sound.js`: Chip Riffle 浮窗的采样音效播放器。
- `poker-game.js`: 兼容入口，转发到 `src/main.js`。
- `assets/`: favicon、站点品牌图标和 Chip Riffle 音频采样。音频授权见 `assets/audio/riffle/LICENSES.md`。
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
node --check src/main.js
node --check src/firebase.js
node --check src/riffle.js
node --check src/riffle-sound.js
git diff --check
```

本地预览：

```bash
python3 -m http.server 8000
```

## Firebase Notes

`src/firebase.js` 中包含客户端 Firebase 配置。Firebase Web 配置本身通常不是密钥，但生产环境必须依赖 Realtime Database Security Rules 控制读写权限。

如果你 fork 或部署自己的实例，建议：

- 创建自己的 Firebase 项目
- 替换 `src/firebase.js` 中的配置
- 为 `rooms/{roomId}` 设计合适的数据库规则
- 避免把正式环境数据库暴露为无限制读写

## Known Limitations

- All In、边池和复杂多人结算逻辑已有实现，但仍需要更多真实牌局场景验证。
- 当前没有自动化测试套件。
- 状态主要集中在 `src/main.js` 的模块级变量中，后续复杂化时可以考虑拆分为状态层、规则层和 UI 层。
- 房间同步依赖 Firebase CDN 和 Realtime Database；离线或网络受限时可能无法正常同步。
- 本工具只负责筹码和下注流程，不判断牌型大小。

## Contributing

欢迎提交 Issue 或 Pull Request。比较适合优先改进的方向：

- 为下注和边池逻辑补充单元测试
- 拆分核心游戏规则，降低 `src/main.js` 复杂度
- 改进 Firebase 安全规则和房间生命周期
- 增加导出牌局日志或恢复历史牌局能力
- 优化小屏幕上的密集操作体验

## License

当前仓库尚未声明开源许可证。正式开放协作前，建议补充 `LICENSE` 文件。
