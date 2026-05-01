const GUIDE_TABS = [
  {
    id: "usage",
    label: "使用指南",
    cards: [
      ["01", "进入房间", "同桌设备输入同一个房间 ID 后同步。没有联网或不填房间时，可作为本地筹码器使用。"],
      ["02", "配置牌桌", "设置初始筹码和大盲注，再添加玩家。小盲默认为大盲的一半。"],
      ["03", "开始牌局", "开始后系统分配 Dealer、小盲和大盲，并自动扣除盲注、指定首个行动玩家。"],
      ["04", "执行行动", "按当前玩家选择 Check、Call、Raise 或 Fold。Call 会显示需跟数额；Raise 会展开加注面板。"],
      ["05", "摊牌结算", "进入摊牌后，为每个奖池选择赢家。多人并列时可多选，筹码会尽量平均分配。"],
      ["06", "开始下一局", "结算后点击下一局，Dealer 轮转，玩家筹码保留，日志继续记录本房间进程。"]
    ]
  },
  {
    id: "rules",
    label: "德扑规则",
    flow: ["发两张底牌", "翻牌前下注", "翻牌三张", "转牌一张", "河牌一张", "摊牌比牌"],
    cards: [
      ["目标", "每位玩家用自己的 2 张底牌和桌面 5 张公共牌，组合出最强的 5 张牌。"],
      ["公共牌", "翻牌一次亮出 3 张公共牌，转牌和河牌各亮出 1 张，所有未弃牌玩家共享这些公共牌。"],
      ["行动选择", "轮到你时通常可以跟注、加注、过牌或弃牌。有人下注后，想继续争夺奖池就需要跟上当前下注。"],
      ["加注规则", "加注必须至少达到上一笔完整下注或加注的幅度；短码 All In 可以低于最小加注，但不会向已行动玩家重新开放加注。"],
      ["下注轮", "每一轮下注会持续到所有还在牌局中的玩家投入相同，或只剩无法继续行动的 All In 玩家。"],
      ["All In", "All In 是把剩余筹码全部投入。若其他玩家筹码更多，后续可能产生只有部分玩家能争夺的边池。"],
      ["摊牌", "河牌下注结束后，仍未弃牌的玩家亮牌。牌型最大者赢得对应奖池，完全相同则平分。"]
    ]
  },
  {
    id: "hands",
    label: "牌型大小",
    hands: [
      ["皇家同花顺", [["A", "spade"], ["K", "spade"], ["Q", "spade"], ["J", "spade"], ["10", "spade"]], "同花色 A 到 10 的最大顺子"],
      ["同花顺", [["9", "heart"], ["8", "heart"], ["7", "heart"], ["6", "heart"], ["5", "heart"]], "同花色连续五张"],
      ["四条", [["Q", "spade"], ["Q", "heart"], ["Q", "diamond"], ["Q", "club"], ["4", "spade"]], "四张相同点数"],
      ["葫芦", [["10", "spade"], ["10", "heart"], ["10", "diamond"], ["6", "club"], ["6", "spade"]], "三条加一对"],
      ["同花", [["A", "diamond"], ["J", "diamond"], ["8", "diamond"], ["5", "diamond"], ["2", "diamond"]], "五张同花色，不连续"],
      ["顺子", [["8", "spade"], ["7", "heart"], ["6", "diamond"], ["5", "club"], ["4", "spade"]], "五张连续点数，不限花色"],
      ["三条", [["7", "spade"], ["7", "heart"], ["7", "diamond"], ["K", "club"], ["3", "spade"]], "三张相同点数"],
      ["两对", [["J", "spade"], ["J", "heart"], ["4", "diamond"], ["4", "club"], ["A", "spade"]], "两组对子"],
      ["一对", [["A", "spade"], ["A", "heart"], ["9", "diamond"], ["6", "club"], ["2", "spade"]], "一组对子"],
      ["高牌", [["A", "spade"], ["J", "heart"], ["8", "diamond"], ["5", "club"], ["3", "spade"]], "没有以上组合时比较最大牌"]
    ]
  }
];

const SUIT_SYMBOLS = {
  club: "♣",
  diamond: "♦",
  heart: "♥",
  spade: "♠"
};

export function initGuidePanels() {
  document.querySelectorAll("[data-guide-mount]").forEach((mount, index) => {
    mount.replaceChildren(createGuidePanel(mount.dataset.guideMount || `guide-${index}`));
  });
}

function createGuidePanel(scope) {
  const details = document.createElement("details");
  details.className = "guide-panel";

  const summary = document.createElement("summary");
  summary.className = "guide-summary";
  summary.innerHTML = `
    <span>
      <span class="eyebrow">Player Manual</span>
      <strong>玩家手册</strong>
    </span>
    <em>使用指南、德扑规则和牌型大小</em>
  `;

  const body = document.createElement("div");
  body.className = "guide-body";
  body.append(createTabRadios(scope), createTabControls(scope), createTabPanels());

  details.append(summary, body);
  return details;
}

function createTabRadios(scope) {
  const fragment = document.createDocumentFragment();
  GUIDE_TABS.forEach((tab, index) => {
    const input = document.createElement("input");
    input.className = "guide-tab-radio";
    input.type = "radio";
    input.name = `guide-tab-${scope}`;
    input.id = `guide-tab-${scope}-${tab.id}`;
    input.value = tab.id;
    input.setAttribute("value", tab.id);
    input.checked = index === 0;
    fragment.append(input);
  });
  return fragment;
}

function createTabControls(scope) {
  const controls = document.createElement("div");
  controls.className = "guide-tab-controls";
  controls.setAttribute("aria-label", "玩家手册分类");

  GUIDE_TABS.forEach(tab => {
    const label = document.createElement("label");
    label.htmlFor = `guide-tab-${scope}-${tab.id}`;
    label.dataset.guideTab = tab.id;
    label.textContent = tab.label;
    controls.append(label);
  });

  return controls;
}

function createTabPanels() {
  const panels = document.createElement("div");
  panels.className = "guide-tab-panels";

  GUIDE_TABS.forEach(tab => {
    const panel = document.createElement("article");
    panel.className = "guide-tab-panel";
    panel.dataset.guidePanel = tab.id;

    if (tab.id === "usage") {
      panel.append(createCardGrid(tab.cards, "guide-card-grid-steps", true));
    } else if (tab.id === "rules") {
      panel.append(createRuleFlow(tab.flow), createCardGrid(tab.cards, "guide-rule-grid"));
    } else {
      panel.append(createHandRankList(tab.hands));
    }

    panels.append(panel);
  });

  return panels;
}

function createCardGrid(cards, modifierClass, hasStepNumber = false) {
  const grid = document.createElement("div");
  grid.className = `guide-card-grid ${modifierClass}`;

  cards.forEach(card => {
    const section = document.createElement("section");
    section.className = "guide-card";

    if (hasStepNumber) {
      const step = document.createElement("span");
      step.textContent = card[0];
      section.append(step);
    }

    const title = document.createElement("h4");
    title.textContent = hasStepNumber ? card[1] : card[0];
    const text = document.createElement("p");
    text.textContent = hasStepNumber ? card[2] : card[1];
    section.append(title, text);
    grid.append(section);
  });

  return grid;
}

function createRuleFlow(items) {
  const flow = document.createElement("ol");
  flow.className = "guide-flow";
  flow.setAttribute("aria-label", "德州扑克流程");

  items.forEach(item => {
    const li = document.createElement("li");
    const span = document.createElement("span");
    span.textContent = item;
    li.append(span);
    flow.append(li);
  });

  return flow;
}

function createHandRankList(hands) {
  const list = document.createElement("ol");
  list.className = "hand-rank-list";
  list.setAttribute("aria-label", "牌型从强到弱");

  hands.forEach(([name, cards, description]) => {
    const item = document.createElement("li");
    const title = document.createElement("strong");
    const sample = document.createElement("span");
    const text = document.createElement("em");

    title.textContent = name;
    sample.className = "card-sample";
    cards.forEach(([rank, suit]) => {
      const card = document.createElement("b");
      card.className = `suit-${suit}`;
      card.textContent = `${rank}${SUIT_SYMBOLS[suit]}`;
      sample.append(card);
    });
    text.textContent = description;

    item.append(title, sample, text);
    list.append(item);
  });

  return list;
}
