const RISE_THRESHOLD = 132;
const SPLIT_ANIMATION_MS = 760;
const CHIP_HEIGHT = 20;
const STACK_BASE = 18;
const SPLIT_OFFSET = 74;
const APPROACH_OFFSET = 28;
const PILE_SIZE = 6;

export function initChipRiffle({ trigger }) {
  if (!trigger) return;

  const dismissLayer = createDismissLayer();
  const popover = createPopover();
  const stack = popover.querySelector(".riffle-stack");
  const closeButton = popover.querySelector(".riffle-close");
  const stateValue = popover.querySelector("[data-riffle-state]");
  const gestureValue = popover.querySelector("[data-riffle-gesture]");
  const hint = popover.querySelector(".riffle-hint");
  const chipModels = Array.from(popover.querySelectorAll(".riffle-chip")).map(createChipModel);

  let state = "single";
  let isOpen = false;
  let pointerStartY = 0;
  let pointerStartX = 0;
  let isDragging = false;
  let pointerMoved = false;
  let activePointerId = null;
  let lastPointerInteractionAt = -Infinity;
  let transition = "idle";
  let splitAnimationTimer = null;
  let riffleAnimationFrame = null;
  let riffleProgress = 0;

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
    if (transition !== "idle") return;
    if (performance.now() - lastPointerInteractionAt < 700) return;
    if (state === "single") {
      beginSplitAnimation("点击筹码：single -> split");
    }
  });

  stack.addEventListener("pointerdown", event => {
    if (transition !== "idle") {
      event.preventDefault();
      renderGesture("分堆动画进行中");
      return;
    }
    lastPointerInteractionAt = performance.now();
    activePointerId = event.pointerId;
    pointerMoved = false;
    pointerStartY = event.clientY;
    pointerStartX = event.clientX;
    stack.setPointerCapture(event.pointerId);
    isDragging = state === "split";
    if (isDragging) {
      cancelRiffleAnimation();
      renderRiffleProgress(0);
    }
    renderGesture(state === "split" ? "开始上滑，底部从左筹码开始穿插" : "按下筹码，松开进入 split");
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
    renderRiffleProgress(progress);
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
      beginSplitAnimation("点击筹码：single -> split");
      return;
    }

    if (deltaY >= RISE_THRESHOLD) {
      finishRiffleGesture(true, "叠筹码完成：split -> single");
    } else {
      finishRiffleGesture(false, `上滑不足，回到 split（${Math.max(0, Math.round(deltaY))}px）`);
    }
  });

  stack.addEventListener("pointercancel", () => {
    if (isDragging) {
      finishRiffleGesture(false, "手势取消，回到 split");
    }
    isDragging = false;
    activePointerId = null;
    pointerMoved = false;
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
    clearSplitAnimation();
    clearRifflePose();
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
    clearSplitAnimation();
    cancelRiffleAnimation();
    clearRifflePose();
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

  function beginSplitAnimation(message) {
    clearSplitAnimation();
    clearRifflePose();
    state = "split";
    transition = "splitting";
    renderState(message);
    splitAnimationTimer = window.setTimeout(() => {
      transition = "idle";
      splitAnimationTimer = null;
      renderState("分堆完成：split");
    }, SPLIT_ANIMATION_MS);
  }

  function clearSplitAnimation() {
    if (splitAnimationTimer) {
      window.clearTimeout(splitAnimationTimer);
      splitAnimationTimer = null;
    }
    transition = "idle";
  }

  function renderRiffleProgress(progress) {
    riffleProgress = clamp(progress, 0, 1);
    popover.dataset.riffle = "active";

    const approachProgress = smoothstep(0, 0.2, riffleProgress);
    const rifflePhase = clamp((riffleProgress - 0.16) / 0.72, 0, 1);
    const settleProgress = smoothstep(0.86, 1, riffleProgress);
    const contactPoint = rifflePhase * PILE_SIZE;
    const leftInsertProgress = Array(PILE_SIZE).fill(0);
    const rightInsertProgress = Array(PILE_SIZE).fill(0);

    const frames = chipModels.map(model => {
      const side = model.side;
      const pairDelay = side > 0 ? 0.14 : 0;
      const insertStart = (model.pileIndex + pairDelay) / PILE_SIZE;
      const insertEnd = (model.pileIndex + 0.84 + pairDelay) / PILE_SIZE;
      const insertProgress = smoothstep(insertStart, insertEnd, rifflePhase);
      const aboveContact = clamp((model.pileIndex + 1 - contactPoint) / PILE_SIZE, 0, 1);
      const pressure = (1 - insertProgress) * smoothstep(0.02, 0.28, rifflePhase) * (0.3 + 0.7 * aboveContact);

      if (side < 0) {
        leftInsertProgress[model.pileIndex] = insertProgress;
      } else {
        rightInsertProgress[model.pileIndex] = insertProgress;
      }

      return { model, side, insertProgress, pressure, aboveContact };
    });

    frames.forEach(({ model, side, insertProgress, pressure, aboveContact }) => {
      const supportLiftSlots = side < 0
        ? sumFirst(rightInsertProgress, model.pileIndex)
        : sumFirst(leftInsertProgress, model.pileIndex + 1);
      const approachX = lerp(side * SPLIT_OFFSET, side * APPROACH_OFFSET, approachProgress);
      const supportedSlot = model.pileIndex + supportLiftSlots;
      const finalSlot = model.finalIndex;

      let x = lerp(approachX, 0, insertProgress);
      let slot = lerp(supportedSlot, finalSlot, insertProgress);
      let lift = -18 * pressure;
      let rotate = (side > 0 ? 1 : -1) * (5 + 13 * aboveContact) * pressure;

      x = lerp(x, 0, settleProgress);
      slot = lerp(slot, finalSlot, settleProgress);
      lift = lerp(lift, 0, settleProgress);
      rotate = lerp(rotate, 0, settleProgress);

      setChipPose(model, { x, slot, lift, rotate });
    });
  }

  function setChipPose(model, pose) {
    model.element.style.bottom = `${STACK_BASE + pose.slot * CHIP_HEIGHT}px`;
    model.element.style.transform = `translateX(calc(-50% + ${pose.x.toFixed(2)}px)) translateY(${pose.lift.toFixed(2)}px) rotate(${pose.rotate.toFixed(2)}deg)`;
    model.element.style.transformOrigin = model.side < 0 ? "0% 100%" : "100% 100%";
    model.element.style.zIndex = String(100 + Math.round(pose.slot * 10));
  }

  function finishRiffleGesture(shouldComplete, message) {
    const fromProgress = riffleProgress;
    animateRiffleProgress(fromProgress, shouldComplete ? 1 : 0, () => {
      state = shouldComplete ? "single" : "split";
      riffleProgress = 0;
      clearRifflePose();
      renderState(message);
    });
  }

  function animateRiffleProgress(fromProgress, toProgress, onComplete) {
    cancelRiffleAnimation();
    const startTime = performance.now();
    const distance = Math.abs(toProgress - fromProgress);
    const duration = Math.max(120, distance * 260);

    function step(now) {
      const progress = clamp((now - startTime) / duration, 0, 1);
      renderRiffleProgress(lerp(fromProgress, toProgress, easeOutCubic(progress)));
      if (progress < 1) {
        riffleAnimationFrame = window.requestAnimationFrame(step);
        return;
      }

      riffleAnimationFrame = null;
      onComplete();
    }

    riffleAnimationFrame = window.requestAnimationFrame(step);
  }

  function cancelRiffleAnimation() {
    if (!riffleAnimationFrame) return;
    window.cancelAnimationFrame(riffleAnimationFrame);
    riffleAnimationFrame = null;
  }

  function clearRifflePose() {
    riffleProgress = 0;
    delete popover.dataset.riffle;
    chipModels.forEach(({ element }) => {
      element.style.removeProperty("bottom");
      element.style.removeProperty("transform");
      element.style.removeProperty("transform-origin");
      element.style.removeProperty("z-index");
    });
  }

  function renderState(message = "") {
    popover.dataset.state = state;
    if (transition === "idle") {
      delete popover.dataset.transition;
    } else {
      popover.dataset.transition = transition;
    }
    stateValue.textContent = state;
    if (transition !== "idle") {
      hint.textContent = "分堆动画进行中";
    } else {
      hint.textContent = state === "single"
        ? "点击筹码堆：single -> split"
        : "在筹码堆上上滑：split -> single";
    }
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
          const pileName = index < 6 ? "left" : "right";
          const finalIndex = pileIndex * 2 + (pileName === "left" ? 0 : 1);
          return `<span class="riffle-chip" data-pile="${pileName}" data-chip-index="${index}" data-pile-index="${pileIndex}" data-pile-side="${pileSide}" data-final-index="${finalIndex}" style="--chip-index: ${index}; --pile-index: ${pileIndex}; --pile-side: ${pileSide};"></span>`;
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

function createChipModel(element) {
  return {
    element,
    chipIndex: Number(element.dataset.chipIndex),
    pileIndex: Number(element.dataset.pileIndex),
    side: Number(element.dataset.pileSide),
    finalIndex: Number(element.dataset.finalIndex)
  };
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function lerp(start, end, progress) {
  return start + (end - start) * progress;
}

function smoothstep(edge0, edge1, value) {
  const progress = clamp((value - edge0) / (edge1 - edge0), 0, 1);
  return progress * progress * (3 - 2 * progress);
}

function sumFirst(values, count) {
  let total = 0;
  for (let index = 0; index < count; index += 1) {
    total += values[index] || 0;
  }
  return total;
}

function easeOutCubic(value) {
  return 1 - Math.pow(1 - value, 3);
}
