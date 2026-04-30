import { createRiffleSound } from "./riffle-sound.js";

const SOUND_MUTED_STORAGE_KEY = "pokerChipsRiffleMuted";
const CHIP_SKIN_STORAGE_KEY = "pokerChipsRiffleSkin";
const RISE_THRESHOLD = 240;
const SPLIT_ANIMATION_MS = 760;
const CHIP_HEIGHT = 20;
const STACK_BASE = 18;
const SPLIT_OFFSET = 74;
const APPROACH_OFFSET = 28;
const PILE_SIZE = 6;
const CHIP_SKINS = [
  { id: "classic", label: "经典金色" },
  { id: "obsidian", label: "黑金单色" },
  { id: "red-blue", label: "红蓝双色" },
  { id: "mint-white", label: "橙绿双色" }
];

export function initChipRiffle({ trigger }) {
  if (!trigger) return;

  const dismissLayer = createDismissLayer();
  const popover = createPopover();
  const stack = popover.querySelector(".riffle-stack");
  const closeButton = popover.querySelector(".riffle-close");
  const muteButton = popover.querySelector(".riffle-mute");
  const skinButton = popover.querySelector(".riffle-skin");
  const hint = popover.querySelector(".riffle-hint");
  const chipModels = Array.from(popover.querySelectorAll(".riffle-chip")).map(createChipModel);
  const sound = createRiffleSound();
  let stackOrder = chipModels.slice();

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
  let soundMuted = getStoredSoundMuted();
  let chipSkin = getStoredChipSkin();

  document.body.appendChild(dismissLayer);
  document.body.appendChild(popover);
  sound.setMuted(soundMuted);
  applyChipSkin();
  updateMuteButton();
  renderState();

  trigger.setAttribute("aria-haspopup", "dialog");
  trigger.setAttribute("aria-expanded", "false");

  trigger.addEventListener("click", event => {
    event.stopPropagation();
    sound.unlock();
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

  muteButton.addEventListener("click", event => {
    event.stopPropagation();
    soundMuted = !soundMuted;
    sound.setMuted(soundMuted);
    storeSoundMuted(soundMuted);
    updateMuteButton();
    if (!soundMuted) {
      sound.refresh();
    }
    renderState();
  });

  skinButton.addEventListener("click", event => {
    event.stopPropagation();
    chipSkin = getNextChipSkinId(chipSkin);
    storeChipSkin(chipSkin);
    applyChipSkin();
    renderState();
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
    sound.unlock();
    if (transition !== "idle") return;
    if (performance.now() - lastPointerInteractionAt < 700) return;
    if (state === "single") {
      beginSplitAnimation();
    }
  });

  stack.addEventListener("pointerdown", event => {
    sound.unlock();
    if (transition !== "idle") {
      event.preventDefault();
      renderHint("正在分堆");
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
    renderHint(state === "split" ? "上滑堆叠筹码" : "点击筹码分堆");
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
    renderHint(progress >= 1 ? "松开堆叠筹码" : "上滑堆叠筹码");
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
        renderHint("点击筹码分堆");
        return;
      }
      beginSplitAnimation();
      return;
    }

    if (deltaY >= RISE_THRESHOLD) {
      finishRiffleGesture(true);
    } else {
      finishRiffleGesture(false);
    }
  });

  stack.addEventListener("pointercancel", () => {
    if (isDragging) {
      finishRiffleGesture(false);
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

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") {
      sound.resetProgress();
      return;
    }
    if (!isOpen || soundMuted) return;
    sound.refresh();
  });

  window.addEventListener("pageshow", () => {
    if (!isOpen || soundMuted) return;
    sound.refresh();
  });

  window.addEventListener("focus", () => {
    if (!isOpen || soundMuted) return;
    sound.refresh();
  });

  function openPopover() {
    isOpen = true;
    state = "single";
    clearSplitAnimation();
    clearRifflePose();
    resetStackOrder();
    applySingleLayout();
    isDragging = false;
    pointerMoved = false;
    activePointerId = null;
    lastPointerInteractionAt = -Infinity;
    dismissLayer.hidden = false;
    popover.hidden = false;
    trigger.setAttribute("aria-expanded", "true");
    renderState();
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
    renderHint("点击筹码分堆");
  }

  function positionPopover() {
    // Reserved for the later animated version if the popover needs to track an anchor.
  }

  function beginSplitAnimation() {
    clearSplitAnimation();
    clearRifflePose();
    applySplitLayout();
    sound.playSplit();
    state = "split";
    transition = "splitting";
    renderState();
    splitAnimationTimer = window.setTimeout(() => {
      transition = "idle";
      splitAnimationTimer = null;
      renderState();
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
    sound.setProgress(riffleProgress);

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

  function finishRiffleGesture(shouldComplete) {
    const fromProgress = riffleProgress;
    animateRiffleProgress(fromProgress, shouldComplete ? 1 : 0, () => {
      state = shouldComplete ? "single" : "split";
      if (shouldComplete) {
        commitRiffleLayout();
        applySingleLayout();
        sound.playSettle();
      }
      riffleProgress = 0;
      clearRifflePose();
      renderState();
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
    sound.resetProgress();
    delete popover.dataset.riffle;
    chipModels.forEach(({ element }) => {
      element.style.removeProperty("bottom");
      element.style.removeProperty("transform");
      element.style.removeProperty("transform-origin");
      element.style.removeProperty("z-index");
    });
  }

  function renderState() {
    popover.dataset.state = state;
    if (transition === "idle") {
      delete popover.dataset.transition;
    } else {
      popover.dataset.transition = transition;
    }
    if (transition !== "idle") {
      renderHint("正在分堆");
    } else {
      renderHint(state === "single" ? "点击筹码分堆" : "上滑堆叠筹码");
    }
  }

  function renderHint(message) {
    hint.textContent = message;
  }

  function updateMuteButton() {
    muteButton.classList.toggle("is-muted", soundMuted);
    muteButton.setAttribute("aria-pressed", String(soundMuted));
    muteButton.setAttribute("aria-label", soundMuted ? "开启筹码音效" : "静音筹码音效");
    muteButton.title = soundMuted ? "开启音效" : "静音音效";
  }

  function applyChipSkin() {
    const skin = getChipSkin(chipSkin);
    popover.dataset.skin = skin.id;
    skinButton.setAttribute("aria-label", `切换筹码配色，当前：${skin.label}`);
    skinButton.title = `当前配色：${skin.label}`;
  }

  function resetStackOrder() {
    stackOrder = chipModels.slice().sort((a, b) => a.chipIndex - b.chipIndex);
  }

  function applySingleLayout() {
    stackOrder.forEach((model, singleIndex) => {
      model.singleIndex = singleIndex;
      model.element.style.setProperty("--single-index", String(singleIndex));
    });
  }

  function applySplitLayout() {
    const leftPile = stackOrder.slice(0, PILE_SIZE);
    const rightPile = stackOrder.slice(PILE_SIZE);

    leftPile.forEach((model, pileIndex) => {
      applyChipSplitPosition(model, { pileIndex, side: -1, finalIndex: pileIndex * 2, pileName: "left" });
    });

    rightPile.forEach((model, pileIndex) => {
      applyChipSplitPosition(model, { pileIndex, side: 1, finalIndex: pileIndex * 2 + 1, pileName: "right" });
    });
  }

  function applyChipSplitPosition(model, { pileIndex, side, finalIndex, pileName }) {
    model.pileIndex = pileIndex;
    model.side = side;
    model.finalIndex = finalIndex;
    model.element.dataset.pile = pileName;
    model.element.dataset.pileIndex = String(pileIndex);
    model.element.dataset.pileSide = String(side);
    model.element.dataset.finalIndex = String(finalIndex);
    model.element.style.setProperty("--pile-index", String(pileIndex));
    model.element.style.setProperty("--pile-side", String(side));
  }

  function commitRiffleLayout() {
    const nextStackOrder = [];
    stackOrder.forEach(model => {
      nextStackOrder[model.finalIndex] = model;
    });
    stackOrder = nextStackOrder;
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
        <h3>筹码叠洗</h3>
      </div>
      <div class="riffle-actions">
        <button class="riffle-skin" type="button" aria-label="切换筹码配色" title="切换配色">
          <span class="riffle-skin-icon" aria-hidden="true"></span>
        </button>
        <button class="riffle-mute" type="button" aria-label="静音筹码音效" aria-pressed="false" title="静音音效">
          <span class="riffle-mute-icon" aria-hidden="true"></span>
        </button>
        <button class="riffle-close" type="button" aria-label="关闭筹码动画浮窗">
          <span class="riffle-close-icon" aria-hidden="true"></span>
        </button>
      </div>
    </div>
    <button class="riffle-stack" type="button" aria-label="筹码堆调试按钮">
      <span class="riffle-stack-view" aria-hidden="true">
        ${Array.from({ length: 12 }, (_, index) => {
          const pileIndex = index % 6;
          const pileSide = index < 6 ? -1 : 1;
          const pileName = index < 6 ? "left" : "right";
          const chipSet = index < 6 ? "a" : "b";
          const finalIndex = pileIndex * 2 + (pileName === "left" ? 0 : 1);
          return `<span class="riffle-chip" data-chip-set="${chipSet}" data-pile="${pileName}" data-chip-index="${index}" data-pile-index="${pileIndex}" data-pile-side="${pileSide}" data-final-index="${finalIndex}" style="--chip-index: ${index}; --single-index: ${index}; --pile-index: ${pileIndex}; --pile-side: ${pileSide};"></span>`;
        }).join("")}
      </span>
    </button>
    <p class="riffle-hint" aria-live="polite">点击筹码分堆</p>
  `;
  return popover;
}

function getStoredSoundMuted() {
  try {
    return localStorage.getItem(SOUND_MUTED_STORAGE_KEY) === "true";
  } catch (_) {
    return false;
  }
}

function storeSoundMuted(isMuted) {
  try {
    localStorage.setItem(SOUND_MUTED_STORAGE_KEY, String(isMuted));
  } catch (_) {}
}

function getStoredChipSkin() {
  try {
    return getChipSkin(localStorage.getItem(CHIP_SKIN_STORAGE_KEY)).id;
  } catch (_) {
    return CHIP_SKINS[0].id;
  }
}

function storeChipSkin(skinId) {
  try {
    localStorage.setItem(CHIP_SKIN_STORAGE_KEY, skinId);
  } catch (_) {}
}

function getChipSkin(skinId) {
  return CHIP_SKINS.find(skin => skin.id === skinId) || CHIP_SKINS[0];
}

function getNextChipSkinId(skinId) {
  const currentIndex = CHIP_SKINS.findIndex(skin => skin.id === skinId);
  return CHIP_SKINS[(currentIndex + 1) % CHIP_SKINS.length].id;
}

function createChipModel(element) {
  return {
    element,
    chipIndex: Number(element.dataset.chipIndex),
    singleIndex: Number(element.dataset.chipIndex),
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
