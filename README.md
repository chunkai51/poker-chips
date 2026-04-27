# Poker Chips

一个面向线下德州扑克局的筹码管理工具。适用于“有牌、有玩家，但没有实体筹码”的场景：用浏览器记录玩家筹码、盲注、行动顺序、奖池、摊牌结算和下一局轮转。

项目是纯前端静态应用，无需构建步骤；页面通过 Firebase Realtime Database 支持房间同步。

## Features

- 创建房间并通过房间 ID 同步牌局状态
- 添加玩家、设置初始筹码和大盲注
- 自动分配 Dealer、小盲、大盲位置
- 支持 Check、Call、Raise、Fold 和 All In
- 自动推进翻牌前、翻牌后、转牌、河牌轮次
- 自动记录奖池、本轮下注和本手投入
- 摊牌阶段支持选择一个或多个赢家并平分奖池
- 初步支持边池计算和结算
- 支持结算后开始下一局并轮转 Dealer
- 响应式界面，适配桌面和手机浏览器
- 深绿牌桌主题和扑克筹码图标

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
6. 按当前行动玩家依次选择 Check、Call、Raise 或 Fold。
7. 进入摊牌后，为每个奖池选择赢家并确认结算。
8. 点击“开始下一局”继续游戏。

多人使用时，请让所有设备进入同一个房间 ID。页面会通过 Firebase 同步玩家、奖池、行动轮次和日志。

## Project Structure

```text
.
├── assets/
│   ├── favicon.png
│   └── poker-chip-icon.png
├── src/
│   ├── firebase.js
│   └── main.js
├── index.html
├── poker-game.js
├── PROJECT_NOTES.md
├── styles.css
└── README.md
```

- `index.html`: 页面结构和主要 DOM 容器。
- `styles.css`: 全站视觉主题、响应式布局和游戏控件样式。
- `src/main.js`: 牌局状态、下注流程、摊牌结算、Firebase 同步和 DOM 渲染。
- `src/firebase.js`: Firebase SDK 初始化与 Realtime Database API 导出。
- `poker-game.js`: 兼容入口，转发到 `src/main.js`。
- `assets/`: favicon 和站点品牌图标。
- `PROJECT_NOTES.md`: 面向 coding agent 和维护者的架构、进度、风险说明。

## Development

本项目没有构建流程。修改后直接刷新浏览器即可。

常用检查：

```bash
node --check src/main.js
node --check src/firebase.js
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
