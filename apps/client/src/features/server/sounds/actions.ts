import { SoundType } from '../types';

let audioCtx: AudioContext;
let hasAudioContext = false;
let pendingAudioContext: Promise<AudioContext | null> | null = null;

const SOUNDS_VOLUME = 2;

const ALL_SOUND_TYPES = Object.values(SoundType);

const createAudioContext = (): AudioContext | null => {
  const AudioContextCtor =
    window.AudioContext ||
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (window as any).webkitAudioContext;

  if (!AudioContextCtor) {
    return null;
  }

  return new AudioContextCtor();
};

const getAudioContext = (): AudioContext | null => {
  if (hasAudioContext && audioCtx.state === 'closed') {
    hasAudioContext = false;
  }

  if (!hasAudioContext) {
    const ctx = createAudioContext();

    if (!ctx) {
      return null;
    }

    audioCtx = ctx;
    hasAudioContext = true;
  }

  return audioCtx;
};

const ensureAudioContextRunning = async (): Promise<AudioContext | null> => {
  if (pendingAudioContext) {
    return pendingAudioContext;
  }

  pendingAudioContext = (async () => {
    const ctx = getAudioContext();

    if (!ctx) {
      return null;
    }

    if (ctx.state === 'suspended') {
      await ctx.resume();
    }

    if (ctx.state !== 'running') {
      return null;
    }

    return ctx;
  })();

  try {
    return await pendingAudioContext;
  } finally {
    pendingAudioContext = null;
  }
};

const getReadyAudioContext = (): AudioContext => {
  if (!hasAudioContext) {
    throw new Error('Audio context is not initialized');
  }

  return audioCtx;
};

const now = () => getReadyAudioContext().currentTime;

const createOsc = (type: OscillatorType, freq: number) => {
  const osc = getReadyAudioContext().createOscillator();

  osc.type = type;
  osc.frequency.setValueAtTime(freq, now());

  return osc;
};

const createGain = (value = 1) => {
  const gain = getReadyAudioContext().createGain();

  gain.gain.setValueAtTime(value * SOUNDS_VOLUME, now());

  return gain;
};

// MESSAGE_RECEIVED — ultra-minimal single tone
const sfxMessageReceived = () => {
  const osc = createOsc('sine', 600);
  const gain = createGain(0.05);

  gain.gain.exponentialRampToValueAtTime(0.0001, now() + 0.05);

  osc.connect(gain).connect(audioCtx.destination);
  osc.start();
  osc.stop(now() + 0.05);
};

// MESSAGE_SENT — ultra-minimal single tone (slightly higher)
const sfxMessageSent = () => {
  const osc = createOsc('sine', 750);
  const gain = createGain(0.04);

  gain.gain.exponentialRampToValueAtTime(0.0001, now() + 0.04);

  osc.connect(gain).connect(audioCtx.destination);
  osc.start();
  osc.stop(now() + 0.04);
};

// SERVER_DISCONNECTED — noticeable four-note descent, aligned with the rest of the palette
const sfxServerDisconnected = () => {
  const notes = [
    { freq: 988, gain: 0.115, delay: 0 },
    { freq: 784, gain: 0.108, delay: 0.09 },
    { freq: 659, gain: 0.106, delay: 0.18 },
    { freq: 523, gain: 0.12, delay: 0.27 }
  ];

  notes.forEach(({ freq, gain: g, delay }, index) => {
    const startAt = now() + delay;
    const endAt = startAt + (index === notes.length - 1 ? 0.24 : 0.18);
    const osc = createOsc('sine', freq);
    const gain = createGain(g);

    gain.gain.setValueAtTime(g * SOUNDS_VOLUME, startAt);
    gain.gain.exponentialRampToValueAtTime(0.0001, endAt);

    if (index === notes.length - 1) {
      osc.frequency.exponentialRampToValueAtTime(440, endAt);

      const harmonicOsc = createOsc('triangle', 784);
      const harmonicGain = createGain(0.05);

      harmonicGain.gain.exponentialRampToValueAtTime(0.0001, endAt);

      harmonicOsc.connect(harmonicGain).connect(audioCtx.destination);
      harmonicOsc.start(startAt + 0.02);
      harmonicOsc.stop(endAt);
    }

    osc.connect(gain).connect(audioCtx.destination);
    osc.start(startAt);
    osc.stop(endAt);
  });
};

const getSoundTypes = () => ALL_SOUND_TYPES;

const playSound = async (type: SoundType) => {
  try {
    const ctx = await ensureAudioContextRunning();

    if (!ctx) {
      return;
    }

    switch (type) {
      case SoundType.MESSAGE_RECEIVED:
        return sfxMessageReceived();
      case SoundType.MESSAGE_SENT:
        return sfxMessageSent();
      case SoundType.SERVER_DISCONNECTED:
        return sfxServerDisconnected();

      default:
        console.warn(`No sound effect defined for type: ${type}`);
        return;
    }
  } catch (error) {
    console.error(`Failed to play sound: ${type}`, error);
  }
};

export { getSoundTypes, playSound };
