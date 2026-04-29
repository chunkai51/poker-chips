const AudioContextConstructor = typeof window !== "undefined"
  ? window.AudioContext || window.webkitAudioContext
  : null;

const INPUT_GAIN = 0.72;
const OUTPUT_GAIN = 0.88;
const MIN_TICK_INTERVAL = 0.034;
const MAX_TICKS_PER_FRAME = 2;
const SCHEDULE_AHEAD = 0.008;
const TICK_POINTS = createTickPoints();

export function createRiffleSound() {
  let context = null;
  let masterGain = null;
  let outputGain = null;
  let safetyHighpass = null;
  let limiter = null;
  let lastProgress = null;
  let lastScrapeAt = 0;
  let lastTickAt = 0;
  let isPrimed = false;
  let muted = false;

  function unlock() {
    const audioContext = ensureContext();
    if (!audioContext) return;
    if (audioContext.state === "suspended") {
      audioContext.resume()
        .then(() => primeContext())
        .catch(() => {});
      return;
    }

    primeContext();
  }

  function setProgress(progress) {
    const audioContext = ensureContext();
    if (!audioContext || muted || audioContext.state === "suspended") return;

    const nextProgress = clamp(progress, 0, 1);
    const previousProgress = lastProgress;
    lastProgress = nextProgress;

    if (previousProgress === null || Math.abs(nextProgress - previousProgress) < 0.003) return;

    const direction = nextProgress > previousProgress ? 1 : -1;
    const crossedTicks = getCrossedTicks(previousProgress, nextProgress, direction);
    playCrossedTicks(crossedTicks, direction);

    const speed = Math.abs(nextProgress - previousProgress);
    const now = audioContext.currentTime;
    if (nextProgress > 0.12 && nextProgress < 0.92 && speed > 0.012 && now - lastScrapeAt > 0.045) {
      playScrape(direction, Math.min(speed * 7, 1));
      lastScrapeAt = now;
    }
  }

  function playSplit() {
    unlock();
    playKnock({
      delay: 0.006,
      duration: 0.064,
      peak: 0.18,
      bodyFrequency: 620,
      brightness: 0.68,
      toneAmount: 0.13
    });
    playKnock({
      delay: 0.086,
      duration: 0.058,
      peak: 0.15,
      bodyFrequency: 760,
      brightness: 0.72,
      toneAmount: 0.11
    });
  }

  function playSettle() {
    unlock();
    playKnock({
      delay: 0,
      duration: 0.074,
      peak: 0.24,
      bodyFrequency: 780,
      brightness: 0.8,
      toneAmount: 0.14,
      settle: true
    });
  }

  function resetProgress() {
    lastProgress = null;
    lastScrapeAt = 0;
    lastTickAt = 0;
  }

  function setMuted(nextMuted) {
    muted = Boolean(nextMuted);
    if (!context || !outputGain) return;

    const now = context.currentTime;
    outputGain.gain.cancelScheduledValues(now);
    outputGain.gain.setTargetAtTime(muted ? 0 : OUTPUT_GAIN, now, 0.018);
  }

  function ensureContext() {
    if (context || !AudioContextConstructor) return context;

    context = new AudioContextConstructor();

    masterGain = context.createGain();
    masterGain.gain.value = INPUT_GAIN;

    outputGain = context.createGain();
    outputGain.gain.value = muted ? 0 : OUTPUT_GAIN;

    safetyHighpass = context.createBiquadFilter();
    safetyHighpass.type = "highpass";
    safetyHighpass.frequency.value = 95;
    safetyHighpass.Q.value = 0.65;

    limiter = context.createDynamicsCompressor();
    limiter.threshold.value = -4;
    limiter.knee.value = 1;
    limiter.ratio.value = 10;
    limiter.attack.value = 0.003;
    limiter.release.value = 0.07;

    masterGain
      .connect(safetyHighpass)
      .connect(limiter)
      .connect(outputGain)
      .connect(context.destination);
    return context;
  }

  function primeContext() {
    if (isPrimed || !context || !masterGain || context.state !== "running") return;
    isPrimed = true;

    const buffer = createSilentPrimerBuffer(context);
    playBuffer(buffer, 0);
  }

  function playCrossedTicks(crossedTicks, direction) {
    if (!crossedTicks.length || !context) return;

    const now = context.currentTime;
    if (now - lastTickAt < MIN_TICK_INTERVAL) return;

    const tickCount = Math.min(crossedTicks.length, MAX_TICKS_PER_FRAME);
    const step = Math.max(1, Math.floor(crossedTicks.length / tickCount));

    for (let index = 0; index < tickCount; index += 1) {
      const tick = crossedTicks[index * step];
      if (typeof tick !== "number") continue;
      playTick(direction, tick, index * MIN_TICK_INTERVAL, crossedTicks.length);
    }

    lastTickAt = now + (tickCount - 1) * MIN_TICK_INTERVAL;
  }

  function playTick(direction, tickPoint, delay = 0, burstSize = 1) {
    const burstScale = burstSize > 1 ? 0.74 : 1;
    const isForward = direction > 0;
    const heightTone = isForward ? 0.42 + tickPoint * 0.28 : 0.55 + tickPoint * 0.18;

    playKnock({
      delay,
      duration: isForward ? 0.052 : 0.046,
      peak: (isForward ? 0.145 : 0.09) * burstScale,
      bodyFrequency: isForward ? 610 + tickPoint * 130 : 720 + tickPoint * 110,
      brightness: isForward ? 0.78 : 0.68,
      toneAmount: isForward ? 0.12 : 0.08,
      toneSeed: heightTone
    });
  }

  function playKnock({
    delay = 0,
    duration = 0.06,
    peak = 0.18,
    bodyFrequency = 780,
    brightness = 0.64,
    toneAmount = 0.2,
    toneSeed = 0.5,
    settle = false
  } = {}) {
    const audioContext = ensureContext();
    if (!audioContext || muted || audioContext.state === "suspended") return;

    const buffer = createChipBuffer(audioContext, {
      bodyFrequency,
      brightness,
      duration,
      peak,
      settle,
      toneAmount,
      toneSeed
    });

    playBuffer(buffer, delay);
  }

  function playScrape(direction, intensity) {
    const audioContext = ensureContext();
    if (!audioContext || muted || audioContext.state === "suspended") return;

    const buffer = createScrapeBuffer(audioContext, {
      brightness: direction > 0 ? 0.58 : 0.48,
      duration: 0.052,
      peak: (direction > 0 ? 0.02 : 0.014) * clamp(intensity, 0, 1)
    });

    playBuffer(buffer, 0);
  }

  function playBuffer(buffer, delay) {
    if (!context || !masterGain || muted) return;

    const source = context.createBufferSource();
    source.buffer = buffer;
    source.connect(masterGain);
    source.start(context.currentTime + SCHEDULE_AHEAD + Math.max(0, delay));
  }

  return {
    playSettle,
    playSplit,
    resetProgress,
    setMuted,
    setProgress,
    unlock
  };
}

function createTickPoints() {
  const ticks = [];
  for (let pileIndex = 0; pileIndex < 6; pileIndex += 1) {
    const leftPhase = (pileIndex + 0.42) / 6;
    const rightPhase = (pileIndex + 0.56) / 6;
    ticks.push(0.16 + leftPhase * 0.72);
    ticks.push(0.16 + rightPhase * 0.72);
  }
  return ticks.sort((first, second) => first - second);
}

function getCrossedTicks(previousProgress, nextProgress, direction) {
  if (direction > 0) {
    return TICK_POINTS.filter(tick => tick > previousProgress && tick <= nextProgress);
  }

  return TICK_POINTS
    .filter(tick => tick < previousProgress && tick >= nextProgress)
    .reverse();
}

function createChipBuffer(audioContext, {
  bodyFrequency,
  brightness,
  duration,
  peak,
  settle,
  toneAmount,
  toneSeed
}) {
  const sampleRate = audioContext.sampleRate;
  const sampleCount = Math.ceil((duration + 0.018) * sampleRate);
  const buffer = audioContext.createBuffer(1, sampleCount, sampleRate);
  const data = buffer.getChannelData(0);
  const bodyPhase = randomPhase();
  const snapPhase = randomPhase();
  const ceramicPhase = randomPhase();
  const bodyTone = bodyFrequency * randomBetween(0.88, 1.08);
  const snapTone = bodyTone * randomBetween(1.86, 2.18);
  const ceramicTone = (settle ? 1700 : 1450) + toneSeed * randomBetween(260, 440);
  const brightMix = clamp(brightness, 0, 1);
  const impactOffsets = settle ? [0.002, 0.008, 0.017] : [0.002, 0.01];

  let previousWhite = 0;
  let crispNoise = 0;
  let bodyNoise = 0;

  for (let index = 0; index < sampleCount; index += 1) {
    const time = index / sampleRate;
    const white = Math.random() * 2 - 1;
    const wideNoise = white - previousWhite;
    previousWhite = white;
    crispNoise = crispNoise * 0.32 + wideNoise * 0.68;
    bodyNoise = bodyNoise * 0.92 + white * 0.08;

    const impactEnvelope = impactOffsets.reduce((total, offset, offsetIndex) => (
      total + impactEnvelopeAt(time, offset, offsetIndex === 0 ? 0.006 : 0.004, offsetIndex === 0 ? 0.012 : 0.009) * (offsetIndex === 0 ? 1 : 0.46)
    ), 0);
    const bodyEnvelope = impactEnvelopeAt(time, 0.003, 0.008, settle ? 0.028 : 0.022);
    const ceramicEnvelope = impactEnvelopeAt(time, settle ? 0.005 : 0.004, 0.006, settle ? 0.018 : 0.014);
    const fade = edgeFade(index, sampleCount, sampleRate);

    const edgeGrit = crispNoise * (0.3 + brightMix * 0.5) * impactEnvelope;
    const contactDust = wideNoise * 0.08 * brightMix * Math.exp(-time / 0.018);
    const body = bodyNoise * (settle ? 0.28 : 0.2) * bodyEnvelope;
    const bodyKnock = Math.sin(Math.PI * 2 * bodyTone * time + bodyPhase) * (settle ? 0.18 : 0.12) * bodyEnvelope;
    const hardSnap = Math.sin(Math.PI * 2 * snapTone * time + snapPhase) * (settle ? 0.06 : 0.045) * bodyEnvelope;
    const ceramicClick = Math.sin(Math.PI * 2 * ceramicTone * time + ceramicPhase) * toneAmount * 0.34 * ceramicEnvelope;
    const sample = (edgeGrit + contactDust + body + bodyKnock + hardSnap + ceramicClick) * fade;

    data[index] = sample;
  }

  normalizeBuffer(data, peak, sampleRate);
  return buffer;
}

function createScrapeBuffer(audioContext, { brightness, duration, peak }) {
  const sampleRate = audioContext.sampleRate;
  const sampleCount = Math.ceil(duration * sampleRate);
  const buffer = audioContext.createBuffer(1, sampleCount, sampleRate);
  const data = buffer.getChannelData(0);
  const brightMix = clamp(brightness, 0, 1);
  let previousWhite = 0;
  let low = 0;

  for (let index = 0; index < sampleCount; index += 1) {
    const time = index / sampleRate;
    const progress = clamp(time / duration, 0, 1);
    const envelope = Math.sin(Math.PI * progress) * edgeFade(index, sampleCount, sampleRate);
    const white = Math.random() * 2 - 1;
    const high = white - previousWhite * 0.64;
    previousWhite = white;
    low = low * 0.9 + white * 0.1;

    const sample = (high * (0.2 + brightMix * 0.28) + low * 0.12) * envelope;
    data[index] = sample;
  }

  normalizeBuffer(data, peak, sampleRate);
  return buffer;
}

function createSilentPrimerBuffer(audioContext) {
  const sampleCount = Math.ceil(audioContext.sampleRate * 0.024);
  const buffer = audioContext.createBuffer(1, sampleCount, audioContext.sampleRate);
  const data = buffer.getChannelData(0);

  for (let index = 0; index < sampleCount; index += 1) {
    data[index] = Math.sin((index / sampleCount) * Math.PI * 2) * 0.00001 * edgeFade(index, sampleCount, audioContext.sampleRate);
  }

  return buffer;
}

function normalizeBuffer(data, targetPeak, sampleRate) {
  if (targetPeak <= 0) {
    data.fill(0);
    return;
  }

  const mean = average(data);
  for (let index = 0; index < data.length; index += 1) {
    data[index] -= mean;
  }

  applyEdgeFade(data, sampleRate);

  const peakAbs = maxAbs(data);
  if (peakAbs <= 0) return;

  const scale = Math.min(targetPeak / peakAbs, 3);
  for (let index = 0; index < data.length; index += 1) {
    data[index] *= scale;
  }
}

function impactEnvelopeAt(time, offset, attackSeconds, decaySeconds) {
  const localTime = time - offset;
  if (localTime <= 0) return 0;
  return quickAttack(localTime, attackSeconds) * Math.exp(-localTime / decaySeconds);
}

function edgeFade(index, sampleCount, sampleRate) {
  const fadeSamples = Math.max(4, Math.floor(sampleRate * 0.004));
  const fadeIn = clamp(index / fadeSamples, 0, 1);
  const fadeOut = clamp((sampleCount - 1 - index) / fadeSamples, 0, 1);
  const fade = Math.min(fadeIn, fadeOut);
  return fade * fade * (3 - 2 * fade);
}

function applyEdgeFade(data, sampleRate) {
  for (let index = 0; index < data.length; index += 1) {
    data[index] *= edgeFade(index, data.length, sampleRate);
  }
}

function quickAttack(time, seconds) {
  return clamp(time / seconds, 0, 1);
}

function average(data) {
  let total = 0;
  for (let index = 0; index < data.length; index += 1) {
    total += data[index];
  }
  return total / data.length;
}

function maxAbs(data) {
  let peak = 0;
  for (let index = 0; index < data.length; index += 1) {
    peak = Math.max(peak, Math.abs(data[index]));
  }
  return peak;
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function randomPhase() {
  return Math.random() * Math.PI * 2;
}

function randomBetween(min, max) {
  return min + Math.random() * (max - min);
}
