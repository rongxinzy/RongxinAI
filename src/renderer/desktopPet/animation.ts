import { DesktopPetSprite, DesktopPetState } from '../../shared/desktopPet/constants';
import { DesktopPetIdleActions } from './idleActions';

const TRANSITION_MS = 160;
const SPRING_DAMPING = 16;
const SPRING_FREQUENCY = 22;
const GREETING_INDEX = DesktopPetSprite[DesktopPetState.Greeting];

export class DesktopPetAnimation {
  private state: DesktopPetState = DesktopPetState.Idle;
  private from: number[] = [1, 0, 0, 0, 0, 0];
  private changedAt = -Infinity;
  private lastTime: number | undefined;
  private displacement = 0;
  private velocity = 0;
  private dragging = false;
  private facing = 1;
  private walking = false;
  private readonly idle = new DesktopPetIdleActions();

  setState(state: DesktopPetState, now: number): void {
    if (state === this.state) return;
    this.from = this.applyIdleBoost(this.blendWeights(now), this.idleMotion(now));
    this.state = state;
    this.changedAt = now;
    if (state === DesktopPetState.Greeting) this.impact(0.65);
  }

  setDragging(active: boolean): void {
    this.dragging = active;
  }

  setPose(facing: number, walking: boolean): void {
    this.facing = facing >= 0 ? 1 : -1;
    this.walking = walking;
    this.idle.setFacing(this.facing);
  }

  impact(strength: number): void {
    this.velocity -= Math.max(0, Math.min(1, strength)) * 2;
  }

  settle(now: number): void {
    this.changedAt = -Infinity;
    this.displacement = 0;
    this.velocity = 0;
    this.lastTime = now;
  }

  weights(now: number): number[] {
    return this.applyIdleBoost(this.blendWeights(now), this.idleMotion(now));
  }

  private blendWeights(now: number): number[] {
    const progress = Math.max(0, Math.min(1, (now - this.changedAt) / TRANSITION_MS));
    const eased = progress * progress * (3 - 2 * progress);
    const target = DesktopPetSprite[this.state];
    return this.from.map(
      (weight, index) => weight * (1 - eased) + Number(index === target) * eased,
    );
  }

  private idleMotion(now: number): ReturnType<DesktopPetIdleActions['sample']> {
    const idleActive = this.state === DesktopPetState.Idle && !this.dragging && !this.walking;
    return this.idle.sample(now, idleActive);
  }

  private applyIdleBoost(
    base: number[],
    idle: ReturnType<DesktopPetIdleActions['sample']>,
  ): number[] {
    if (idle.greetingBoost <= 0) return base;
    const keep = 1 - idle.greetingBoost;
    return base.map((weight, index) =>
      index === GREETING_INDEX ? weight * keep + idle.greetingBoost : weight * keep,
    );
  }

  sample(now: number): {
    weights: number[];
    scaleY: number;
    transitioning: boolean;
    facing: number;
    rotate: number;
    offsetX: number;
    offsetY: number;
  } {
    const dt = this.lastTime === undefined ? 0 : Math.max(0, (now - this.lastTime) / 1000);
    this.lastTime = now;
    const target = this.dragging ? 0.025 : 0;
    // Closed-form damped spring preserves velocity across interruptions and refresh rates.
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
    const idle = this.idleMotion(now);
    const walkBob = this.walking ? Math.sin(now / 110) * 4 : 0;
    return {
      weights: this.applyIdleBoost(this.blendWeights(now), idle),
      scaleY: Math.max(0.92, Math.min(1.07, 1 + this.displacement + Math.sin(now / 1400) * 0.012)),
      transitioning: now - this.changedAt < TRANSITION_MS,
      facing: this.facing,
      rotate: idle.rotate,
      offsetX: idle.offsetX,
      offsetY: idle.offsetY + walkBob,
    };
  }
}
