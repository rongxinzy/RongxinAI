import { DesktopPetSprite, DesktopPetState } from '../../shared/desktopPet/constants';

const TRANSITION_MS = 160;
const SPRING_DAMPING = 16;
const SPRING_FREQUENCY = 22;

export class DesktopPetAnimation {
  private state: DesktopPetState = DesktopPetState.Idle;
  private from: number[] = [1, 0, 0, 0, 0, 0];
  private changedAt = -Infinity;
  private lastTime: number | undefined;
  private displacement = 0;
  private velocity = 0;
  private dragging = false;

  setState(state: DesktopPetState, now: number): void {
    if (state === this.state) return;
    this.from = this.weights(now);
    this.state = state;
    this.changedAt = now;
    if (state === DesktopPetState.Greeting) this.impact(0.65);
  }

  setDragging(active: boolean): void {
    this.dragging = active;
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
    const progress = Math.max(0, Math.min(1, (now - this.changedAt) / TRANSITION_MS));
    const eased = progress * progress * (3 - 2 * progress);
    const target = DesktopPetSprite[this.state];
    return this.from.map(
      (weight, index) => weight * (1 - eased) + Number(index === target) * eased,
    );
  }

  sample(now: number): { weights: number[]; scaleY: number; transitioning: boolean } {
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
    return {
      weights: this.weights(now),
      scaleY: Math.max(0.92, Math.min(1.07, 1 + this.displacement + Math.sin(now / 1400) * 0.012)),
      transitioning: now - this.changedAt < TRANSITION_MS,
    };
  }
}
