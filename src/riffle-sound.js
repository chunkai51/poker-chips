const AudioContextConstructor = typeof window !== "undefined"
  ? window.AudioContext || window.webkitAudioContext
  : null;

const MIN_GAIN = 0.0001;
const ATTACK_SECONDS = 0.01;
const TICK_POINTS = createTickPoints();
const OUTPUT_GAIN = 0.9;

export function createRiffleSound() {
  let context = null;
  let masterGain = null;
  let compressor = null;
  let limiter = null;
  let outputGain = null;
  let noiseBuffer = null;
  let lastProgress = null;
  let lastScrapeAt = 0;
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
    crossedTicks.forEach((tick, index) => {
      playTick(direction, tick, index * 0.018);
    });

    const speed = Math.abs(nextProgress - previousProgress);
    const now = audioContext.currentTime;
    if (nextProgress > 0.12 && nextProgress < 0.92 && speed > 0.012 && now - lastScrapeAt > 0.045) {
      playScrape(direction, Math.min(speed * 7, 1));
      lastScrapeAt = now;
    }
  }

  function playSplit() {
    unlock();
    playKnock({ delay: 0, volume: 0.036, duration: 0.06, frequency: 680 });
    playKnock({ delay: 0.075, volume: 0.026, duration: 0.05, frequency: 920 });
  }

  function playSettle() {
    unlock();
    playKnock({
      delay: 0,
      volume: 0.072,
      duration: 0.06,
      frequency: 1680,
      noiseFrequency: 3200,
      noiseQ: 5.5,
      resonanceFrequency: 1460,
      resonanceVolume: 0.018
    });
  }

  function resetProgress() {
    lastProgress = null;
    lastScrapeAt = 0;
  }

  function setMuted(nextMuted) {
    muted = Boolean(nextMuted);
    if (!context || !outputGain) return;

    const now = context.currentTime;
    outputGain.gain.cancelScheduledValues(now);
    outputGain.gain.setTargetAtTime(muted ? MIN_GAIN : OUTPUT_GAIN, now, 0.018);
  }

  function ensureContext() {
    if (context || !AudioContextConstructor) return context;

    context = new AudioContextConstructor();
    noiseBuffer = createNoiseBuffer(context);

    masterGain = context.createGain();
    masterGain.gain.value = 0.7;

    compressor = context.createDynamicsCompressor();
    compressor.threshold.value = -20;
    compressor.knee.value = 12;
    compressor.ratio.value = 7;
    compressor.attack.value = 0.006;
    compressor.release.value = 0.14;

    limiter = context.createWaveShaper();
    limiter.curve = createSoftClipCurve();
    limiter.oversample = "2x";

    outputGain = context.createGain();
    outputGain.gain.value = muted ? MIN_GAIN : OUTPUT_GAIN;

    masterGain.connect(compressor).connect(limiter).connect(outputGain).connect(context.destination);
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
    gain.gain.setValueAtTime(MIN_GAIN, startTime);
    gain.gain.exponentialRampToValueAtTime(MIN_GAIN, startTime + 0.024);

    oscillator.connect(gain).connect(masterGain);
    oscillator.start(startTime);
    oscillator.stop(startTime + 0.026);
  }

  function playTick(direction, tickPoint, delay = 0) {
    const baseFrequency = direction > 0
      ? 980 + tickPoint * 760
      : 1220 + tickPoint * 620;
    const volume = direction > 0 ? 0.044 : 0.026;
    const duration = direction > 0 ? 0.044 : 0.03;

    playKnock({
      delay,
      volume,
      duration,
      frequency: baseFrequency * randomBetween(0.94, 1.07),
      noiseFrequency: direction > 0 ? 2200 : 2800,
      noiseQ: direction > 0 ? 7 : 9
    });
  }

  function playKnock({
    delay = 0,
    volume = 0.04,
    duration = 0.05,
    frequency = 840,
    noiseFrequency = 2400,
    noiseQ = 7,
    resonanceFrequency = null,
    resonanceVolume = 0
  } = {}) {
    const audioContext = ensureContext();
    if (!audioContext || muted || audioContext.state === "suspended") return;

    const startTime = audioContext.currentTime + delay;
    const stopTime = startTime + duration + 0.02;

    const noise = audioContext.createBufferSource();
    noise.buffer = noiseBuffer;

    const noiseFilter = audioContext.createBiquadFilter();
    noiseFilter.type = "bandpass";
    noiseFilter.frequency.setValueAtTime(noiseFrequency * randomBetween(0.84, 1.18), startTime);
    noiseFilter.Q.setValueAtTime(noiseQ, startTime);

    const noiseGain = audioContext.createGain();
    shapePercussiveEnvelope(noiseGain.gain, startTime, duration, volume);

    const oscillator = audioContext.createOscillator();
    oscillator.type = "triangle";
    oscillator.frequency.setValueAtTime(frequency, startTime);
    oscillator.frequency.exponentialRampToValueAtTime(Math.max(120, frequency * 0.58), startTime + duration);

    const toneGain = audioContext.createGain();
    shapePercussiveEnvelope(toneGain.gain, startTime, duration * 0.86, volume * 0.42);

    noise.connect(noiseFilter).connect(noiseGain).connect(masterGain);
    oscillator.connect(toneGain).connect(masterGain);

    noise.start(startTime);
    noise.stop(stopTime);
    oscillator.start(startTime);
    oscillator.stop(stopTime);

    if (resonanceFrequency && resonanceVolume > 0) {
      const resonance = audioContext.createOscillator();
      resonance.type = "sine";
      resonance.frequency.setValueAtTime(resonanceFrequency, startTime);
      resonance.frequency.exponentialRampToValueAtTime(resonanceFrequency * 0.82, startTime + duration);

      const resonanceGain = audioContext.createGain();
      shapePercussiveEnvelope(resonanceGain.gain, startTime, duration * 1.15, resonanceVolume);

      resonance.connect(resonanceGain).connect(masterGain);
      resonance.start(startTime);
      resonance.stop(stopTime);
    }
  }

  function playScrape(direction, intensity) {
    const audioContext = ensureContext();
    if (!audioContext || muted || audioContext.state === "suspended") return;

    const startTime = audioContext.currentTime;
    const duration = 0.052;
    const volume = (direction > 0 ? 0.012 : 0.008) * clamp(intensity, 0, 1);

    const noise = audioContext.createBufferSource();
    noise.buffer = noiseBuffer;

    const filter = audioContext.createBiquadFilter();
    filter.type = "highpass";
    filter.frequency.setValueAtTime(direction > 0 ? 1800 : 2200, startTime);
    filter.Q.setValueAtTime(0.8, startTime);

    const gain = audioContext.createGain();
    gain.gain.setValueAtTime(MIN_GAIN, startTime);
    gain.gain.exponentialRampToValueAtTime(Math.max(MIN_GAIN, volume), startTime + 0.012);
    gain.gain.exponentialRampToValueAtTime(MIN_GAIN, startTime + duration);

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
  audioParam.cancelScheduledValues(startTime);
  audioParam.setValueAtTime(MIN_GAIN, startTime);
  audioParam.exponentialRampToValueAtTime(Math.max(MIN_GAIN, peak), startTime + ATTACK_SECONDS);
  audioParam.exponentialRampToValueAtTime(MIN_GAIN, startTime + duration);
}

function createSoftClipCurve() {
  const sampleCount = 65536;
  const curve = new Float32Array(sampleCount);
  const drive = 1.8;
  const normalizer = Math.tanh(drive);

  for (let index = 0; index < sampleCount; index += 1) {
    const x = (index / (sampleCount - 1)) * 2 - 1;
    curve[index] = Math.tanh(x * drive) / normalizer;
  }

  return curve;
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function randomBetween(min, max) {
  return min + Math.random() * (max - min);
}
