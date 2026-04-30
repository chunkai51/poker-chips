const AudioContextConstructor = typeof window !== "undefined"
  ? window.AudioContext || window.webkitAudioContext
  : null;

const OUTPUT_GAIN = 0.86;
const SAMPLE_BUS_GAIN = 0.82;
const MIN_TICK_INTERVAL = 0.038;
const MIN_SCRAPE_INTERVAL = 0.075;
const MAX_TICKS_PER_FRAME = 2;
const SCHEDULE_AHEAD = 0.008;
const TICK_POINTS = createTickPoints();

const SAMPLE_GROUPS = {
  split: [
    { id: "kenney-chip-lay-1", gain: 0.72, maxDuration: 0.17 },
    { id: "kenney-chip-lay-2", gain: 0.68, maxDuration: 0.2 },
    { id: "kenney-chip-lay-3", gain: 0.62, maxDuration: 0.22 },
    { id: "bigsoundbank-poker-chips-small-bet", gain: 0.34, maxDuration: 0.34 }
  ],
  tickForward: [
    { id: "kenney-chips-collide-1", gain: 0.5, maxDuration: 0.16 },
    { id: "kenney-chips-collide-2", gain: 0.48, maxDuration: 0.15 },
    { id: "kenney-chips-collide-3", gain: 0.5, maxDuration: 0.16 },
    { id: "kenney-chips-collide-4", gain: 0.46, maxDuration: 0.14 },
    { id: "kenney-chips-stack-4", gain: 0.42, maxDuration: 0.15 }
  ],
  tickBack: [
    { id: "kenney-chips-stack-2", gain: 0.34, maxDuration: 0.12 },
    { id: "kenney-chips-stack-5", gain: 0.34, maxDuration: 0.12 },
    { id: "kenney-chips-stack-6", gain: 0.32, maxDuration: 0.13 },
    { id: "kenney-chips-collide-4", gain: 0.28, maxDuration: 0.13 }
  ],
  scrape: [
    { id: "kenney-chips-handle-3", gain: 0.14, maxDuration: 0.18 },
    { id: "kenney-chips-handle-4", gain: 0.12, maxDuration: 0.2 },
    { id: "kenney-chips-handle-6", gain: 0.12, maxDuration: 0.22 }
  ],
  settle: [
    { id: "bigsoundbank-poker-chips-large-bet", gain: 0.58, maxDuration: 0.42 },
    { id: "bigsoundbank-poker-chips-medium-bet", gain: 0.56, maxDuration: 0.4 },
    { id: "kenney-chips-stack-1", gain: 0.62, maxDuration: 0.22 },
    { id: "kenney-chips-stack-3", gain: 0.58, maxDuration: 0.26 },
    { id: "kenney-chips-stack-6", gain: 0.54, maxDuration: 0.18 }
  ]
};

const SAMPLE_DEFINITIONS = [...new Set(
  Object.values(SAMPLE_GROUPS).flat().map(sample => sample.id)
)].map(id => ({
  id,
  url: new URL(`../assets/audio/riffle/${id}.mp3`, import.meta.url).href
}));

export function createRiffleSound() {
  let context = null;
  let sampleBus = null;
  let outputGain = null;
  let rawSamplePromise = null;
  let decodedSamplePromise = null;
  let lastProgress = null;
  let lastScrapeAt = 0;
  let lastTickAt = 0;
  let isPrimed = false;
  let muted = false;
  const rawSamples = new Map();
  const decodedSamples = new Map();

  preloadRawSamples();

  function unlock() {
    const audioContext = ensureContext();
    if (!audioContext) return;
    if (audioContext.state === "suspended") {
      audioContext.resume()
        .then(() => {
          primeContext();
          decodeSamples();
        })
        .catch(() => {});
      return;
    }

    primeContext();
    decodeSamples();
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
    if (nextProgress > 0.12 && nextProgress < 0.92 && speed > 0.012 && now - lastScrapeAt > MIN_SCRAPE_INTERVAL) {
      playScrape(direction, Math.min(speed * 6, 1));
      lastScrapeAt = now;
    }
  }

  function playSplit() {
    unlock();
    playGroup("split", {
      gain: 0.86,
      rate: randomBetween(0.96, 1.04)
    });
    playGroup("split", {
      delay: 0.09,
      gain: 0.72,
      rate: randomBetween(0.94, 1.03)
    });
  }

  function playSettle() {
    unlock();
    playGroup("settle", {
      gain: 0.84,
      rate: randomBetween(0.98, 1.04)
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

    const safetyHighpass = context.createBiquadFilter();
    safetyHighpass.type = "highpass";
    safetyHighpass.frequency.value = 42;
    safetyHighpass.Q.value = 0.55;

    const limiter = context.createDynamicsCompressor();
    limiter.threshold.value = -2.5;
    limiter.knee.value = 0.8;
    limiter.ratio.value = 7;
    limiter.attack.value = 0.002;
    limiter.release.value = 0.08;

    sampleBus = context.createGain();
    sampleBus.gain.value = SAMPLE_BUS_GAIN;

    outputGain = context.createGain();
    outputGain.gain.value = muted ? 0 : OUTPUT_GAIN;

    sampleBus
      .connect(safetyHighpass)
      .connect(limiter)
      .connect(outputGain)
      .connect(context.destination);
    return context;
  }

  function primeContext() {
    if (isPrimed || !context || !sampleBus || context.state !== "running") return;
    isPrimed = true;

    const buffer = context.createBuffer(1, Math.ceil(context.sampleRate * 0.02), context.sampleRate);
    playBuffer(buffer, { gain: 0.00001 });
  }

  function preloadRawSamples() {
    if (rawSamplePromise) return rawSamplePromise;
    if (typeof fetch !== "function") {
      rawSamplePromise = Promise.resolve(false);
      return rawSamplePromise;
    }

    rawSamplePromise = Promise.all(SAMPLE_DEFINITIONS.map(definition => (
      fetch(definition.url)
        .then(response => {
          if (!response.ok) {
            throw new Error(`Unable to load ${definition.url}`);
          }
          return response.arrayBuffer();
        })
        .then(arrayBuffer => {
          rawSamples.set(definition.id, arrayBuffer);
        })
    )))
      .then(() => true)
      .catch(error => {
        console.warn("Chip riffle samples failed to preload.", error);
        return false;
      });

    return rawSamplePromise;
  }

  function decodeSamples() {
    if (!context) return Promise.resolve(false);
    if (decodedSamplePromise) return decodedSamplePromise;

    decodedSamplePromise = preloadRawSamples()
      .then(ok => {
        if (!ok) return false;
        return Promise.all(SAMPLE_DEFINITIONS.map(definition => {
          const rawSample = rawSamples.get(definition.id);
          if (!rawSample) return Promise.resolve();
          return context.decodeAudioData(rawSample.slice(0))
            .then(buffer => {
              decodedSamples.set(definition.id, buffer);
            });
        }));
      })
      .then(() => decodedSamples.size > 0)
      .catch(error => {
        console.warn("Chip riffle samples failed to decode.", error);
        return false;
      });

    return decodedSamplePromise;
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
    const isForward = direction > 0;
    const burstScale = burstSize > 1 ? 0.78 : 1;
    const rate = isForward
      ? randomBetween(0.96 + tickPoint * 0.02, 1.08 + tickPoint * 0.03)
      : randomBetween(0.88, 0.98);

    playGroup(isForward ? "tickForward" : "tickBack", {
      delay,
      gain: (isForward ? 0.78 : 0.48) * burstScale,
      rate
    });
  }

  function playScrape(direction, intensity) {
    playGroup("scrape", {
      gain: (direction > 0 ? 0.52 : 0.34) * clamp(intensity, 0, 1),
      rate: direction > 0 ? randomBetween(0.96, 1.05) : randomBetween(0.88, 0.96)
    });
  }

  function playGroup(groupName, options = {}) {
    if (!context || !sampleBus || muted) return;
    if (context.state === "suspended") {
      unlock();
      return;
    }

    const group = SAMPLE_GROUPS[groupName] || [];
    const readySamples = group.filter(sample => decodedSamples.has(sample.id));
    if (!readySamples.length) {
      const shouldReplayWhenReady = groupName === "split" || groupName === "settle";
      decodeSamples().then(isReady => {
        if (isReady && shouldReplayWhenReady && !muted) {
          playGroup(groupName, options);
        }
      });
      return;
    }

    const sample = choose(readySamples);
    const buffer = decodedSamples.get(sample.id);
    if (!buffer) return;

    playBuffer(buffer, {
      delay: options.delay || 0,
      gain: (options.gain || 1) * sample.gain,
      maxDuration: sample.maxDuration,
      rate: options.rate || 1
    });
  }

  function playBuffer(buffer, {
    delay = 0,
    gain = 1,
    maxDuration = null,
    rate = 1
  } = {}) {
    if (!context || !sampleBus || muted) return;

    const startTime = context.currentTime + SCHEDULE_AHEAD + Math.max(0, delay);
    const playbackRate = clamp(rate, 0.72, 1.24);
    const naturalDuration = buffer.duration / playbackRate;
    const duration = Math.max(0.03, Math.min(naturalDuration, maxDuration || naturalDuration));
    const fade = Math.min(0.008, duration * 0.32);
    const source = context.createBufferSource();
    const gainNode = context.createGain();

    source.buffer = buffer;
    source.playbackRate.setValueAtTime(playbackRate, startTime);

    gainNode.gain.setValueAtTime(0, startTime);
    gainNode.gain.linearRampToValueAtTime(gain, startTime + fade);
    if (duration > fade * 2) {
      gainNode.gain.setValueAtTime(gain, startTime + duration - fade);
    }
    gainNode.gain.linearRampToValueAtTime(0, startTime + duration);

    source.connect(gainNode).connect(sampleBus);
    source.start(startTime);
    source.stop(startTime + duration + 0.01);
  }

  function refresh() {
    if (!context) return;
    if (context.state !== "running") {
      unlock();
      return;
    }
    primeContext();
  }

  return {
    playSettle,
    playSplit,
    resetProgress,
    refresh,
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

function choose(items) {
  return items[Math.floor(Math.random() * items.length)];
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function randomBetween(min, max) {
  return min + Math.random() * (max - min);
}
