import type { WeatherKind } from '../sim/data/weather';

/**
 * Sonido (fase 20), todo generado con Web Audio: no hay archivos de sonido, igual que no hay imágenes.
 * - Fondo continuo: murmullo de la ciudad (ruido grave que sube con el tráfico y el zoom), lluvia y viento.
 * - Momentos: pájaros de día, grillos de noche y truenos tras cada relámpago.
 * - Avisos: construir, demoler, error, logro y nuevo rango.
 * Los navegadores no dejan sonar nada hasta que el jugador toca la página: `unlock` crea el audio entonces.
 * Sin Web Audio (o con el volumen a 0) todo esto no hace nada.
 */
export type Cue = 'build' | 'demolish' | 'error' | 'achievement' | 'rank';

export interface SoundScene {
  /** Actividad de la ciudad a la vista, 0-1 (tráfico y cercanía de la cámara). */
  activity: number;
  weather: WeatherKind;
  /** 0 de día, 1 de noche. */
  night: number;
  /** Partida detenida o menú abierto: el fondo baja. */
  paused: boolean;
  /** Ha empezado un relámpago en este fotograma. */
  flash: boolean;
}

const RAIN: Record<WeatherKind, number> = { clear: 0, clouds: 0, rain: 0.16, storm: 0.28, fog: 0, snow: 0 };
const WIND: Record<WeatherKind, number> = { clear: 0.015, clouds: 0.04, rain: 0.05, storm: 0.14, fog: 0.08, snow: 0.1 };

export class Sound {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  private city: GainNode | null = null;
  private rain: GainNode | null = null;
  private wind: GainNode | null = null;
  private volume = 0.5;
  private nextCritter = 0;

  /** Crea el audio la primera vez que el jugador toca algo (llamar desde un gesto: clic o tecla). */
  unlock(): void {
    if (this.ctx || this.volume <= 0) {
      if (this.ctx?.state === 'suspended') void this.ctx.resume();
      return;
    }
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return;
    try {
      const ctx = new AC();
      this.ctx = ctx;
      this.master = ctx.createGain();
      this.master.gain.value = this.volume;
      this.master.connect(ctx.destination);
      // Dos segundos de ruido blanco, la materia prima del fondo, la lluvia, el viento y los truenos
      const buffer = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
      const data = buffer.getChannelData(0);
      for (let k = 0; k < data.length; k++) data[k] = Math.random() * 2 - 1;
      this.noise = buffer;
      this.city = this.loop(this.filter('lowpass', 420, 0.7));
      this.rain = this.loop(this.filter('bandpass', 1800, 0.6));
      this.wind = this.loop(this.filter('lowpass', 260, 1.2));
    } catch {
      this.ctx = null;
    }
  }

  setVolume(volume: number): void {
    this.volume = volume;
    if (this.master && this.ctx) this.master.gain.setTargetAtTime(volume, this.ctx.currentTime, 0.1);
  }

  /** Cada fotograma: mezcla el fondo con lo que se ve y, de vez en cuando, un pájaro o un grillo. */
  update(scene: SoundScene): void {
    const { ctx } = this;
    if (!ctx || !this.city || !this.rain || !this.wind) return;
    const now = ctx.currentTime;
    const damp = scene.paused ? 0.35 : 1;
    this.city.gain.setTargetAtTime((0.04 + scene.activity * 0.22) * damp, now, 0.6);
    this.rain.gain.setTargetAtTime(RAIN[scene.weather] * damp, now, 1.2);
    this.wind.gain.setTargetAtTime(WIND[scene.weather] * damp, now, 1.5);
    if (scene.flash) this.thunder();
    if (scene.paused || scene.weather === 'rain' || scene.weather === 'storm' || now < this.nextCritter) return;
    this.nextCritter = now + 2 + Math.random() * 5;
    if (scene.night > 0.6) this.cricket();
    else if (scene.night < 0.3) this.bird();
  }

  play(cue: Cue): void {
    if (!this.ctx) return;
    switch (cue) {
      case 'build':
        this.tone(660, 0.05, 0.12, 'sine');
        this.tone(990, 0.06, 0.08, 'sine', 0.04);
        break;
      case 'demolish':
        this.burst(0.18, 700, 0.25);
        break;
      case 'error':
        this.tone(180, 0.12, 0.1, 'square');
        break;
      case 'achievement':
        this.tone(660, 0.16, 0.12, 'sine');
        this.tone(880, 0.24, 0.12, 'sine', 0.14);
        break;
      case 'rank':
        [523, 659, 784, 1046].forEach((f, k) => this.tone(f, 0.22, 0.11, 'sine', k * 0.12));
        break;
    }
  }

  // ---- Piezas ----

  private filter(type: BiquadFilterType, frequency: number, q: number): BiquadFilterNode {
    const f = this.ctx!.createBiquadFilter();
    f.type = type;
    f.frequency.value = frequency;
    f.Q.value = q;
    return f;
  }

  /** Ruido en bucle por un filtro, con su volumen (empieza en silencio). */
  private loop(filter: BiquadFilterNode): GainNode {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    src.loop = true;
    src.loopStart = Math.random();
    const gain = ctx.createGain();
    gain.gain.value = 0;
    src.connect(filter).connect(gain).connect(this.master!);
    src.start();
    return gain;
  }

  private tone(freq: number, duration: number, volume: number, type: OscillatorType, delay = 0): void {
    const ctx = this.ctx!;
    const t = ctx.currentTime + delay;
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.value = freq;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0, t);
    gain.gain.linearRampToValueAtTime(volume, t + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + duration);
    osc.connect(gain).connect(this.master!);
    osc.start(t);
    osc.stop(t + duration + 0.05);
  }

  /** Golpe de ruido filtrado (demoler, trueno). */
  private burst(duration: number, frequency: number, volume: number, delay = 0): void {
    const ctx = this.ctx!;
    const t = ctx.currentTime + delay;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(volume, t);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + duration);
    src.connect(this.filter('lowpass', frequency, 0.8)).connect(gain).connect(this.master!);
    src.start(t, Math.random());
    src.stop(t + duration + 0.05);
  }

  /** El trueno llega un poco después del destello. */
  private thunder(): void {
    this.burst(2.6, 140, 0.5, 0.3 + Math.random() * 1.2);
  }

  private bird(): void {
    const ctx = this.ctx!;
    const notes = 2 + Math.floor(Math.random() * 3);
    for (let k = 0; k < notes; k++) {
      const t = ctx.currentTime + k * 0.11;
      const osc = ctx.createOscillator();
      osc.frequency.setValueAtTime(2400 + Math.random() * 800, t);
      osc.frequency.exponentialRampToValueAtTime(3800 + Math.random() * 600, t + 0.07);
      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0, t);
      gain.gain.linearRampToValueAtTime(0.025, t + 0.015);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.08);
      osc.connect(gain).connect(this.master!);
      osc.start(t);
      osc.stop(t + 0.1);
    }
  }

  private cricket(): void {
    for (let k = 0; k < 3; k++) this.tone(4300, 0.03, 0.012, 'square', k * 0.06);
  }
}
