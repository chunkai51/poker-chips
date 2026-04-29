const RISE_THRESHOLD = 42;

export function initChipRiffle({ trigger }) {
  if (!trigger) return;

  const popover = createPopover();
  const stack = popover.querySelector(".riffle-stack");
  const closeButton = popover.querySelector(".riffle-close");
  const stateValue = popover.querySelector("[data-riffle-state]");
  const gestureValue = popover.querySelector("[data-riffle-gesture]");
  const hint = popover.querySelector(".riffle-hint");

  let state = "single";
  let isOpen = false;
  let pointerStartY = 0;
  let pointerStartX = 0;
  let isDragging = false;
  let hasMoved = false;

  document.body.appendChild(popover);
  renderState();

  trigger.setAttribute("aria-haspopup", "dialog");
  trigger.setAttribute("aria-expanded", "false");

  trigger.addEventListener("click", event => {
    event.stopPropagation();
    if (isOpen) {
      closePopover();
    } else {
      openPopover();
    }
  });

  closeButton.addEventListener("click", event => {
    event.stopPropagation();
    closePopover();
    trigger.focus();
  });

  popover.addEventListener("click", event => {
    event.stopPropagation();
  });

  stack.addEventListener("click", () => {
    if (hasMoved) return;
    if (state === "single") {
      state = "split";
      renderState("点击筹码：single -> split");
    }
  });

  stack.addEventListener("pointerdown", event => {
    if (state !== "split") return;
    isDragging = true;
    hasMoved = false;
    pointerStartY = event.clientY;
    pointerStartX = event.clientX;
    stack.setPointerCapture(event.pointerId);
    renderGesture("开始上滑检测");
  });

  stack.addEventListener("pointermove", event => {
    if (!isDragging) return;
    const deltaY = pointerStartY - event.clientY;
    const deltaX = event.clientX - pointerStartX;
    const progress = clamp(deltaY / RISE_THRESHOLD, 0, 1);

    if (Math.abs(deltaY) > 4 || Math.abs(deltaX) > 4) {
      hasMoved = true;
    }

    renderGesture(`上滑 ${Math.max(0, Math.round(deltaY))}px / ${RISE_THRESHOLD}px，progress ${progress.toFixed(2)}`);
  });

  stack.addEventListener("pointerup", event => {
    if (!isDragging) return;
    isDragging = false;
    const deltaY = pointerStartY - event.clientY;
    if (Math.abs(deltaY) > 4) {
      hasMoved = true;
    }

    if (deltaY >= RISE_THRESHOLD) {
      state = "single";
      renderState("上滑达标：split -> single");
    } else {
      renderGesture(`上滑不足，保持 split（${Math.max(0, Math.round(deltaY))}px）`);
    }
  });

  stack.addEventListener("pointercancel", () => {
    if (!isDragging) return;
    isDragging = false;
    renderGesture("手势取消，保持当前状态");
  });

  document.addEventListener("click", event => {
    if (!isOpen) return;
    if (popover.contains(event.target) || trigger.contains(event.target)) return;
    closePopover();
  });

  document.addEventListener("keydown", event => {
    if (!isOpen || event.key !== "Escape") return;
    closePopover();
    trigger.focus();
  });

  window.addEventListener("resize", () => {
    if (isOpen) positionPopover();
  });

  window.addEventListener("scroll", () => {
    if (isOpen) positionPopover();
  }, { passive: true });

  function openPopover() {
    isOpen = true;
    state = "single";
    popover.hidden = false;
    trigger.setAttribute("aria-expanded", "true");
    positionPopover();
    renderState("打开浮窗：初始 single");
  }

  function closePopover() {
    isOpen = false;
    popover.hidden = true;
    trigger.setAttribute("aria-expanded", "false");
    renderGesture("浮窗已关闭");
  }

  function positionPopover() {
    const rect = trigger.getBoundingClientRect();
    const headerRect = trigger.closest(".top-bar")?.getBoundingClientRect();
    const gap = 10;
    const width = Math.min(320, window.innerWidth - 24);
    const left = clamp(rect.left, 12, window.innerWidth - width - 12);
    const anchorBottom = Math.max(rect.bottom, headerRect?.bottom || 0);
    const top = Math.min(anchorBottom + gap, window.innerHeight - 220);

    popover.style.setProperty("--riffle-left", `${left}px`);
    popover.style.setProperty("--riffle-top", `${Math.max(12, top)}px`);
    popover.style.setProperty("--riffle-width", `${width}px`);
  }

  function renderState(message = "") {
    popover.dataset.state = state;
    stateValue.textContent = state;
    hint.textContent = state === "single"
      ? "点击筹码堆：single -> split"
      : "在筹码堆上上滑：split -> single";
    renderGesture(message || "等待操作");
  }

  function renderGesture(message) {
    gestureValue.textContent = message;
  }
}

function createPopover() {
  const popover = document.createElement("section");
  popover.className = "riffle-popover";
  popover.hidden = true;
  popover.setAttribute("role", "dialog");
  popover.setAttribute("aria-label", "筹码动画调试浮窗");
  popover.innerHTML = `
    <div class="riffle-header">
      <div>
        <p class="riffle-eyebrow">Chip Riffle</p>
        <h3>筹码小动作</h3>
      </div>
      <button class="riffle-close" type="button" aria-label="关闭筹码动画浮窗">×</button>
    </div>
    <button class="riffle-stack" type="button" aria-label="筹码堆调试按钮">
      <span class="riffle-stack-view" aria-hidden="true">
        ${Array.from({ length: 12 }, (_, index) => {
          const pileIndex = index % 6;
          const pileSide = index < 6 ? -1 : 1;
          return `<span class="riffle-chip" style="--chip-index: ${index}; --pile-index: ${pileIndex}; --pile-side: ${pileSide};"></span>`;
        }).join("")}
      </span>
    </button>
    <div class="riffle-debug" aria-live="polite">
      <p><span>state</span><strong data-riffle-state>single</strong></p>
      <p><span>gesture</span><strong data-riffle-gesture>等待操作</strong></p>
    </div>
    <p class="riffle-hint">点击筹码堆：single -> split</p>
  `;
  return popover;
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}
