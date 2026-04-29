const AudioContextConstructor = typeof window !== "undefined"
  ? window.AudioContext || window.webkitAudioContext
  : null;

const ATTACK_SECONDS = 0.006;
const INPUT_GAIN = 0.5;
const OUTPUT_GAIN = 0.82;
const MIN_TICK_INTERVAL = 0.034;
const MAX_TICKS_PER_FRAME = 2;
const TICK_POINTS = createTickPoints();

export function createRiffleSound() {
  let context = null;
  let masterGain = null;
  let outputGain = null;
  let noiseBuffer = null;
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
    playKnock({ delay: 0.006, volume: 0.032, duration: 0.07, frequency: 760, noiseFrequency: 2300, noiseQ: 1.6, bodyFrequency: 720 });
    playKnock({ delay: 0.086, volume: 0.024, duration: 0.06, frequency: 920, noiseFrequency: 2550, noiseQ: 1.8, bodyFrequency: 840 });
  }

  function playSettle() {
    unlock();
    playKnock({
      delay: 0,
      volume: 0.072,
      duration: 0.082,
      frequency: 1180,
      noiseFrequency: 2750,
      noiseQ: 1.8,
      bodyFrequency: 880,
      resonanceFrequency: 1420,
      resonanceVolume: 0.006
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
    noiseBuffer = createNoiseBuffer(context);

    masterGain = context.createGain();
    masterGain.gain.value = INPUT_GAIN;

    outputGain = context.createGain();
    outputGain.gain.value = muted ? 0 : OUTPUT_GAIN;

    masterGain.connect(outputGain).connect(context.destination);
    return context;
  }

  function primeContext() {
    if (isPrimed || !context || !masterGain || context.state !== "running") return;
    isPrimed = true;

    const startTime = context.currentTime;
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.type = "sine";
    oscillator.frequency.setValueAtTime(220, startTime);
    gain.gain.setValueAtTime(0, startTime);
    gain.gain.linearRampToValueAtTime(0.00001, startTime + 0.006);
    gain.gain.linearRampToValueAtTime(0, startTime + 0.024);

    oscillator.connect(gain).connect(masterGain);
    oscillator.start(startTime);
    oscillator.stop(startTime + 0.026);
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
    const baseFrequency = direction > 0
      ? 980 + tickPoint * 760
      : 1220 + tickPoint * 620;
    const burstScale = burstSize > 1 ? 0.76 : 1;
    const volume = (direction > 0 ? 0.034 : 0.02) * burstScale;
    const duration = direction > 0 ? 0.068 : 0.052;

    playKnock({
      delay,
      volume,
      duration,
      frequency: baseFrequency * randomBetween(0.78, 0.92),
      noiseFrequency: direction > 0 ? 2400 : 2700,
      noiseQ: direction > 0 ? 1.7 : 1.9,
      bodyFrequency: direction > 0 ? 780 : 900,
      toneAmount: direction > 0 ? 0.58 : 0.45
    });
  }

  function playKnock({
    delay = 0,
    volume = 0.04,
    duration = 0.05,
    frequency = 840,
    noiseFrequency = 2400,
    noiseQ = 1.8,
    noiseAmount = 0.86,
    bodyFrequency = 760,
    toneAmount = 0.55,
    resonanceFrequency = null,
    resonanceVolume = 0
  } = {}) {
    const audioContext = ensureContext();
    if (!audioContext || muted || audioContext.state === "suspended") return;

    const startTime = audioContext.currentTime + delay;
    const stopTime = startTime + duration + 0.035;

    const noise = audioContext.createBufferSource();
    noise.buffer = noiseBuffer;

    const noiseFilter = audioContext.createBiquadFilter();
    noiseFilter.type = "bandpass";
    noiseFilter.frequency.setValueAtTime(noiseFrequency * randomBetween(0.84, 1.18), startTime);
    noiseFilter.Q.setValueAtTime(noiseQ, startTime);

    const bodyFilter = audioContext.createBiquadFilter();
    bodyFilter.type = "bandpass";
    bodyFilter.frequency.setValueAtTime(bodyFrequency * randomBetween(0.9, 1.12), startTime);
    bodyFilter.Q.setValueAtTime(0.9, startTime);

    const noiseGain = audioContext.createGain();
    shapePercussiveEnvelope(noiseGain.gain, startTime, duration * 0.58, volume * noiseAmount);

    const bodyGain = audioContext.createGain();
    shapePercussiveEnvelope(bodyGain.gain, startTime, duration * 0.74, volume * 0.28);

    const partials = [
      { frequency: frequency * randomBetween(0.82, 0.94), volume: volume * 0.16 * toneAmount, duration: duration * 0.62 },
      { frequency: frequency * randomBetween(1.28, 1.46), volume: volume * 0.11 * toneAmount, duration: duration * 0.46 },
      { frequency: frequency * randomBetween(1.9, 2.28), volume: volume * 0.055 * toneAmount, duration: duration * 0.32 }
    ];

    noise.connect(noiseFilter).connect(noiseGain).connect(masterGain);
    noise.connect(bodyFilter).connect(bodyGain).connect(masterGain);

    noise.start(startTime);
    noise.stop(stopTime);
    partials.forEach(partial => {
      playPartial(startTime, partial.frequency, partial.volume, partial.duration);
    });

    if (resonanceFrequency && resonanceVolume > 0) {
      playPartial(startTime, resonanceFrequency, resonanceVolume, duration * 1.18, 0.96);
    }
  }

  function playPartial(startTime, frequency, volume, duration, pitchEndRatio = 0.94) {
    const audioContext = ensureContext();
    if (!audioContext || muted || audioContext.state === "suspended") return;

    const oscillator = audioContext.createOscillator();
    oscillator.type = "sine";
    oscillator.frequency.setValueAtTime(frequency, startTime);
    oscillator.frequency.exponentialRampToValueAtTime(
      Math.max(80, frequency * pitchEndRatio),
      startTime + duration
    );

    const gain = audioContext.createGain();
    shapePercussiveEnvelope(gain.gain, startTime, duration, volume);

    oscillator.connect(gain).connect(masterGain);
    oscillator.start(startTime);
    oscillator.stop(startTime + duration + 0.03);
  }

  function playScrape(direction, intensity) {
    const audioContext = ensureContext();
    if (!audioContext || muted || audioContext.state === "suspended") return;

    const startTime = audioContext.currentTime;
    const duration = 0.052;
    const volume = (direction > 0 ? 0.006 : 0.004) * clamp(intensity, 0, 1);

    const noise = audioContext.createBufferSource();
    noise.buffer = noiseBuffer;

    const filter = audioContext.createBiquadFilter();
    filter.type = "highpass";
    filter.frequency.setValueAtTime(direction > 0 ? 1450 : 1700, startTime);
    filter.Q.setValueAtTime(0.8, startTime);

    const gain = audioContext.createGain();
    gain.gain.setValueAtTime(0, startTime);
    gain.gain.linearRampToValueAtTime(volume, startTime + 0.018);
    gain.gain.linearRampToValueAtTime(0, startTime + duration);

    noise.connect(filter).connect(gain).connect(masterGain);
    noise.start(startTime);
    noise.stop(startTime + duration + 0.01);
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

function createNoiseBuffer(audioContext) {
  const length = Math.floor(audioContext.sampleRate * 0.18);
  const buffer = audioContext.createBuffer(1, length, audioContext.sampleRate);
  const output = buffer.getChannelData(0);

  for (let index = 0; index < length; index += 1) {
    output[index] = (Math.random() * 2 - 1) * (1 - index / length);
  }

  return buffer;
}

function shapePercussiveEnvelope(audioParam, startTime, duration, peak) {
  const attackEnd = startTime + Math.min(ATTACK_SECONDS, duration * 0.45);
  const bodyEnd = startTime + duration * 0.34;
  const endTime = startTime + duration;

  audioParam.cancelScheduledValues(startTime);
  audioParam.setValueAtTime(0, startTime);
  audioParam.linearRampToValueAtTime(peak, attackEnd);
  audioParam.linearRampToValueAtTime(peak * 0.42, bodyEnd);
  audioParam.linearRampToValueAtTime(0, endTime);
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function randomBetween(min, max) {
  return min + Math.random() * (max - min);
}
