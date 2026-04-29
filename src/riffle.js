const RISE_THRESHOLD = 42;

export function initChipRiffle({ trigger }) {
  if (!trigger) return;

  const dismissLayer = createDismissLayer();
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
  let pointerMoved = false;
  let activePointerId = null;
  let lastPointerInteractionAt = -Infinity;

  document.body.appendChild(dismissLayer);
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

  dismissLayer.addEventListener("pointerdown", event => {
    event.preventDefault();
    event.stopPropagation();
  });

  dismissLayer.addEventListener("click", event => {
    event.preventDefault();
    event.stopPropagation();
    closePopover();
  });

  popover.addEventListener("click", event => {
    event.stopPropagation();
  });

  stack.addEventListener("click", () => {
    if (performance.now() - lastPointerInteractionAt < 700) return;
    if (state === "single") {
      state = "split";
      renderState("点击筹码：single -> split");
    }
  });

  stack.addEventListener("pointerdown", event => {
    lastPointerInteractionAt = performance.now();
    activePointerId = event.pointerId;
    pointerMoved = false;
    pointerStartY = event.clientY;
    pointerStartX = event.clientX;
    stack.setPointerCapture(event.pointerId);
    isDragging = state === "split";
    renderGesture(state === "split" ? "开始上滑检测" : "按下筹码，松开进入 split");
  });

  stack.addEventListener("pointermove", event => {
    if (activePointerId !== event.pointerId) return;
    const deltaY = pointerStartY - event.clientY;
    const deltaX = event.clientX - pointerStartX;
    const progress = clamp(deltaY / RISE_THRESHOLD, 0, 1);

    if (Math.abs(deltaY) > 4 || Math.abs(deltaX) > 4) {
      pointerMoved = true;
    }

    if (!isDragging) return;
    renderGesture(`上滑 ${Math.max(0, Math.round(deltaY))}px / ${RISE_THRESHOLD}px，progress ${progress.toFixed(2)}`);
  });

  stack.addEventListener("pointerup", event => {
    if (activePointerId !== event.pointerId) return;
    lastPointerInteractionAt = performance.now();
    isDragging = false;
    const deltaY = pointerStartY - event.clientY;
    activePointerId = null;
    if (stack.hasPointerCapture(event.pointerId)) {
      stack.releasePointerCapture(event.pointerId);
    }

    if (Math.abs(deltaY) > 4 || Math.abs(event.clientX - pointerStartX) > 4) {
      pointerMoved = true;
    }

    if (state === "single") {
      if (pointerMoved) {
        renderGesture("检测到移动，保持 single");
        return;
      }
      state = "split";
      renderState("点击筹码：single -> split");
      return;
    }

    if (deltaY >= RISE_THRESHOLD) {
      state = "single";
      renderState("上滑达标：split -> single");
    } else {
      renderGesture(`上滑不足，保持 split（${Math.max(0, Math.round(deltaY))}px）`);
    }
  });

  stack.addEventListener("pointercancel", () => {
    isDragging = false;
    activePointerId = null;
    pointerMoved = false;
    renderGesture("手势取消，保持当前状态");
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
    isDragging = false;
    pointerMoved = false;
    activePointerId = null;
    lastPointerInteractionAt = -Infinity;
    dismissLayer.hidden = false;
    popover.hidden = false;
    trigger.setAttribute("aria-expanded", "true");
    renderState("打开浮窗：初始 single");
  }

  function closePopover() {
    isOpen = false;
    isDragging = false;
    pointerMoved = false;
    activePointerId = null;
    dismissLayer.hidden = true;
    popover.hidden = true;
    trigger.setAttribute("aria-expanded", "false");
    renderGesture("浮窗已关闭");
  }

  function positionPopover() {
    // Reserved for the later animated version if the popover needs to track an anchor.
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

function createDismissLayer() {
  const layer = document.createElement("div");
  layer.className = "riffle-dismiss-layer";
  layer.hidden = true;
  return layer;
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
