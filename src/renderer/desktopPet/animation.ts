import {
  DesktopPetPlayableAction,
  DesktopPetSprite,
  DesktopPetState,
} from '../../shared/desktopPet/constants';
import { DesktopPetIdleActions } from './idleActions';

const TRANSITION_MS = 160;
const SPRING_DAMPING = 16;
const SPRING_FREQUENCY = 22;
const smooth = (value: number) => {
  const t = Math.max(0, Math.min(1, value));
  return t * t * (3 - 2 * t);
};

export class DesktopPetAnimation {
  private state: DesktopPetState = DesktopPetState.Idle;
  private from = [1, 0, 0, 0, 0, 0];
  private changedAt = -Infinity;
  private lastTime: number | undefined;
  private displacement = 0;
  private velocity = 0;
  private dragging = false;
  private pressed = false;
  private facing = 1;
  private walking = false;
  private reduced = false;
  private paused = false;
  private continuousMedia = false;
  private tempo = 1;
  private energy = 1;
  private readonly idle = new DesktopPetIdleActions();
  private recovery:
    | { at: number; rotate: number; offsetX: number; offsetY: number; stretch: number }
    | undefined;

  configure(count: number, tempo = 1, energy = 1): void {
    this.from = Array<number>(count).fill(0);
    this.from[DesktopPetSprite[this.state]] = 1;
    this.tempo = tempo;
    this.energy = energy;
    this.settle(this.lastTime ?? 0);
  }
  private motion(now: number) {
    return this.idle.sample(
      now,
      !this.reduced &&
        !this.continuousMedia &&
        !this.paused &&
        !this.dragging &&
        !this.walking &&
        (this.state === DesktopPetState.Idle ||
          this.state === DesktopPetState.Greeting ||
          this.state === DesktopPetState.Completed),
      this.from.length,
      this.tempo,
      this.energy,
    );
  }
  private interrupt(now: number): void {
    this.recovery = { at: now, ...this.motion(now) };
    this.idle.clear();
  }
  setState(state: DesktopPetState, now: number): void {
    if (state === this.state) return;
    this.from = this.weights(now);
    this.interrupt(now);
    this.state = state;
    this.changedAt = now;
    if (state === DesktopPetState.Completed || state === DesktopPetState.Greeting)
      this.playAction(DesktopPetPlayableAction.Happy, now);
  }
  setDragging(active: boolean): void {
    if (active && !this.dragging) this.interrupt(this.lastTime ?? 0);
    this.dragging = active;
  }
  setPressed(active: boolean): void {
    this.pressed = active;
  }
  setPose(facing: number, walking: boolean): void {
    if (walking && !this.walking) this.interrupt(this.lastTime ?? 0);
    this.facing = facing >= 0 ? 1 : -1;
    this.walking = walking;
    this.idle.setFacing(this.facing);
  }
  setReducedMotion(active: boolean, now: number): void {
    this.reduced = active;
    if (active) this.settle(now);
  }
  setContinuousMedia(active: boolean, now: number): void {
    if (active === this.continuousMedia) return;
    this.continuousMedia = active;
    this.settle(now);
  }
  setPaused(active: boolean, now: number): void {
    this.paused = active;
    this.settle(now);
  }
  impact(strength: number): void {
    this.velocity -= Math.max(0, Math.min(1, strength)) * 2;
  }
  playAction(action: DesktopPetPlayableAction, now: number): void {
    if (
      this.reduced ||
      this.paused ||
      this.dragging ||
      this.walking ||
      this.state === DesktopPetState.Error ||
      this.state === DesktopPetState.Waiting ||
      this.state === DesktopPetState.Thinking
    )
      return;
    this.idle.play(action, now);
  }
  settle(now: number): void {
    this.changedAt = -Infinity;
    this.displacement = 0;
    this.velocity = 0;
    this.lastTime = now;
    this.idle.clear();
    this.recovery = undefined;
  }
  private baseWeights(now: number): number[] {
    const eased = this.reduced ? 1 : smooth((now - this.changedAt) / TRANSITION_MS);
    const target = DesktopPetSprite[this.state];
    return this.from.map(
      (weight, index) => weight * (1 - eased) + Number(index === target) * eased,
    );
  }
  weights(now: number): number[] {
    const motion = this.motion(now);
    return this.baseWeights(now).map(
      (weight, index) => weight * (1 - motion.influence) + motion.weights[index] * motion.influence,
    );
  }
  needsFrame(now: number): boolean {
    if (this.reduced || this.paused) return false;
    if (!this.continuousMedia) return true;
    return (
      now - this.changedAt < TRANSITION_MS ||
      Boolean(this.recovery) ||
      this.dragging ||
      this.pressed ||
      this.walking ||
      Math.abs(this.displacement) > 0.0001 ||
      Math.abs(this.velocity) > 0.001
    );
  }
  sample(now: number) {
    const dt = this.lastTime === undefined ? 0 : Math.max(0, (now - this.lastTime) / 1000);
    this.lastTime = now;
    const target = this.dragging ? 0.025 : this.pressed ? -0.032 : 0;
    const offset = this.displacement - target;
    const coefficient = (this.velocity + SPRING_DAMPING * offset) / SPRING_FREQUENCY;
    const angle = SPRING_FREQUENCY * dt;
    const decay = Math.exp(-SPRING_DAMPING * dt);
    const wave = offset * Math.cos(angle) + coefficient * Math.sin(angle);
    this.displacement = target + decay * wave;
    this.velocity =
      decay *
      (-SPRING_DAMPING * wave +
        SPRING_FREQUENCY * (-offset * Math.sin(angle) + coefficient * Math.cos(angle)));
    const motion = this.motion(now);
    const recovery = this.recovery;
    const residual = recovery ? 1 - smooth((now - recovery.at) / TRANSITION_MS) : 0;
    if (!residual) this.recovery = undefined;
    const stretch = motion.stretch + (recovery ? (recovery.stretch - 1) * residual : 0);
    return {
      weights: this.baseWeights(now).map(
        (weight, index) =>
          weight * (1 - motion.influence) + motion.weights[index] * motion.influence,
      ),
      scaleY: this.reduced
        ? 1
        : Math.max(
            0.86,
            Math.min(
              1.13,
              (1 + this.displacement + (this.continuousMedia ? 0 : Math.sin(now / 1400) * 0.008)) *
                stretch,
            ),
          ),
      transitioning: !this.reduced && now - this.changedAt < TRANSITION_MS,
      facing: this.facing,
      rotate: this.reduced ? 0 : motion.rotate + (recovery?.rotate ?? 0) * residual,
      offsetX: this.reduced ? 0 : motion.offsetX + (recovery?.offsetX ?? 0) * residual,
      offsetY: this.reduced
        ? 0
        : motion.offsetY +
          (recovery?.offsetY ?? 0) * residual +
          (this.walking && !this.continuousMedia ? Math.sin(now / 110) * 3 : 0),
      sequence: motion.kind,
      progress: motion.progress,
    };
  }
}
