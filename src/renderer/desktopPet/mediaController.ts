import { DesktopPetBuiltinId } from '../../shared/desktopPet/catalog';
import { DesktopPetPlayableAction, DesktopPetState } from '../../shared/desktopPet/constants';
import { DesktopPetMotion } from '../../shared/desktopPet/motionCatalog';
import { desktopPetMediaPack, type DesktopPetMediaClip } from './mediaPack';
import { PetVideoPlayer } from './videoPlayer';

interface MediaContext {
  characterId: string;
  state: DesktopPetState;
  visible: boolean;
  reduced: boolean;
  walking: boolean;
  dragging: boolean;
}
const actions = {
  [DesktopPetPlayableAction.Peek]: DesktopPetMotion.Peek,
  [DesktopPetPlayableAction.Nod]: DesktopPetMotion.Nod,
  [DesktopPetPlayableAction.Flutter]: DesktopPetMotion.Flutter,
  [DesktopPetPlayableAction.Happy]: DesktopPetMotion.Happy,
};
const idle = [
  { id: DesktopPetMotion.Idle, weight: 24 },
  { id: DesktopPetMotion.Blink, weight: 4 },
  { id: DesktopPetMotion.LookLeft, weight: 1 },
  { id: DesktopPetMotion.LookRight, weight: 1 },
  { id: DesktopPetMotion.Tilt, weight: 1 },
  { id: DesktopPetMotion.Listen, weight: 1 },
  { id: DesktopPetMotion.Preen, weight: 0.5 },
  { id: DesktopPetMotion.Stretch, weight: 0.5 },
  { id: DesktopPetMotion.Doze, weight: 0.5 },
  { id: DesktopPetMotion.Bow, weight: 0.25 },
  { id: DesktopPetMotion.Hop, weight: 0.1 },
  { id: DesktopPetMotion.Dance, weight: 0.05 },
];
const attention = [
  DesktopPetState.Error,
  DesktopPetState.Waiting,
  DesktopPetState.Thinking,
] as readonly DesktopPetState[];

/** Chooses authored media only; task state remains owned by the main process. */
export class DesktopPetMediaController {
  private context: MediaContext = {
    characterId: '',
    state: DesktopPetState.Idle,
    visible: true,
    reduced: false,
    walking: false,
    dragging: false,
  };
  private pack: DesktopPetMediaClip[] | null = null;
  private transient: DesktopPetMotion | undefined;
  private successor: DesktopPetMotion | undefined;
  private terminalPlayed = false;
  private failed = new Set<DesktopPetMotion>();
  private wanted: DesktopPetMotion | undefined;
  private fallbackAction = false;
  private poster: { id: DesktopPetMotion; image: HTMLImageElement } | undefined;
  private posterPending: HTMLImageElement | undefined;
  private readonly posterImages: HTMLImageElement[] = [];
  private posterRevision = 0;
  private disposed = false;
  readonly player: PetVideoPlayer;
  constructor(
    private readonly changed: () => void,
    private readonly loadPack = desktopPetMediaPack,
  ) {
    this.player = new PetVideoPlayer({
      changed,
      ended: () => this.ended(),
      started: clip => {
        if (clip.loop) return;
        this.successor = this.following();
        const next = this.clip(this.successor);
        if (next && !this.failed.has(next.id)) this.player.prepare(next);
      },
      failed: clip => {
        this.failed.add(clip.id);
      },
    });
  }

  get supported(): boolean {
    return !this.fallbackAction && Boolean(this.pack?.some(clip => clip.id === this.base()));
  }

  update(next: Partial<MediaContext>): void {
    if (
      !Object.entries(next).some(
        ([key, value]) => this.context[key as keyof MediaContext] !== value,
      )
    )
      return;
    const characterChanged =
      next.characterId !== undefined && next.characterId !== this.context.characterId;
    const stateChanged = next.state !== undefined && next.state !== this.context.state;
    const previous = this.context;
    const previousBase = this.base();
    this.context = { ...this.context, ...next };
    if (characterChanged) {
      this.pack = this.loadPack(this.context.characterId || DesktopPetBuiltinId.Xiaoyuan);
      this.failed.clear();
      this.clearPoster();
    }
    if (stateChanged || characterChanged) this.terminalPlayed = false;
    // A pose update can leave the chosen task expression unchanged. Keep its
    // playback phase instead of reloading the same clip on every drag or step.
    if (
      !characterChanged &&
      !stateChanged &&
      previousBase === this.base() &&
      previous.visible === this.context.visible &&
      previous.reduced === this.context.reduced
    )
      return;
    this.transient = undefined;
    this.successor = undefined;
    this.fallbackAction = false;
    this.wanted = undefined;
    // Attention must replace old celebrations immediately. Ordinary motion
    // changes retain the outgoing frame for the player's decoded-frame handoff.
    if (characterChanged || (stateChanged && attention.includes(this.context.state)))
      this.player.stop();
    this.synchronize();
  }

  private base(terminalPlayed = this.terminalPlayed): DesktopPetMotion {
    const { state, dragging, walking } = this.context;
    if (state === DesktopPetState.Error) return DesktopPetMotion.Concern;
    if (state === DesktopPetState.Waiting) return DesktopPetMotion.Wait;
    if (state === DesktopPetState.Thinking) return DesktopPetMotion.Think;
    if (dragging) return DesktopPetMotion.Lift;
    if (walking) return DesktopPetMotion.Walk;
    if (!terminalPlayed && state === DesktopPetState.Completed) return DesktopPetMotion.Happy;
    if (!terminalPlayed && state === DesktopPetState.Greeting) return DesktopPetMotion.Wave;
    return DesktopPetMotion.Idle;
  }

  playAction(action: DesktopPetPlayableAction): boolean {
    const { reduced, visible, dragging, walking, state } = this.context;
    if (reduced || !visible || dragging || walking || attention.includes(state)) return true;
    if (!this.pack?.some(clip => clip.id === actions[action])) {
      this.fallbackAction = true;
      this.clearPoster();
      this.player.stop();
      return false;
    }
    this.fallbackAction = false;
    this.transient = actions[action];
    this.failed.delete(this.transient);
    this.synchronize(true);
    return true;
  }

  /** The original pose sequence owns unsupported actions until its real sampled end. */
  finishFallback(sequenceActive: boolean): void {
    if (!this.fallbackAction || sequenceActive) return;
    this.fallbackAction = false;
    this.synchronize();
  }

  private ended(): void {
    if (this.disposed || !this.context.visible || this.context.reduced) return;
    if (this.wanted === DesktopPetMotion.Happy || this.wanted === DesktopPetMotion.Wave)
      this.terminalPlayed = true;
    const next = this.successor ?? this.following();
    this.successor = undefined;
    if (this.wanted === DesktopPetMotion.Doze) this.transient = DesktopPetMotion.Wake;
    else if (this.transient) this.transient = undefined;
    else if (this.base() === DesktopPetMotion.Idle) this.transient = next;
    this.synchronize(true);
  }

  private following(): DesktopPetMotion {
    if (this.wanted === DesktopPetMotion.Doze) return DesktopPetMotion.Wake;
    if (this.transient) return this.base(true);
    if (this.base(true) === DesktopPetMotion.Idle) {
      const candidates = idle.filter(
        clip => !this.failed.has(clip.id) && this.pack?.some(available => available.id === clip.id),
      );
      let pick = Math.random() * candidates.reduce((sum, clip) => sum + clip.weight, 0);
      return (
        candidates.find(clip => {
          pick -= clip.weight;
          return pick <= 0;
        })?.id ?? DesktopPetMotion.Idle
      );
    }
    return this.base(true);
  }

  impact(strength: number): void {
    const { state, visible, reduced, walking, dragging } = this.context;
    if (
      !this.supported ||
      strength < 0.2 ||
      !visible ||
      reduced ||
      walking ||
      dragging ||
      attention.includes(state) ||
      this.transient === DesktopPetMotion.Land
    )
      return;
    if (!this.pack?.some(clip => clip.id === DesktopPetMotion.Land)) return;
    this.transient = DesktopPetMotion.Land;
    this.synchronize();
  }

  private clearPoster(): void {
    this.posterRevision++;
    for (const image of this.posterImages) image.removeAttribute('src');
    this.poster = this.posterPending = undefined;
  }

  private loadPoster(clip: DesktopPetMediaClip): void {
    if (this.poster?.id === clip.id && !this.posterPending) return;
    this.posterPending?.removeAttribute('src');
    const revision = ++this.posterRevision;
    // Keep the decoded poster until its successor is ready, reusing the other
    // slot even when an earlier decode was interrupted. Revisions own completion.
    let image = this.posterImages.find(candidate => candidate !== this.poster?.image);
    if (!image) {
      image = new Image();
      this.posterImages.push(image);
    }
    this.posterPending = image;
    image.src = clip.posterUrl;
    void image
      .decode()
      .then(() => {
        if (this.disposed || revision !== this.posterRevision) return;
        this.poster?.image.removeAttribute('src');
        this.poster = { id: clip.id, image };
        this.posterPending = undefined;
        this.changed();
      })
      .catch(() => {
        if (revision === this.posterRevision) this.posterPending = undefined;
      });
  }

  private synchronize(restart = false): void {
    const id = this.transient ?? this.base();
    const clip = this.clip(id);
    if (!this.context.visible || this.context.reduced || this.fallbackAction || !clip) {
      this.wanted = undefined;
      this.player.stop();
      this.clearPoster();
      return;
    }
    this.wanted = id;
    this.loadPoster(clip);
    if (!this.context.reduced && !this.failed.has(id)) {
      this.player.play(clip, restart);
    }
  }

  private clip(id: DesktopPetMotion): DesktopPetMediaClip | undefined {
    const clip = this.pack?.find(clip => clip.id === id);
    // Idle ends once to choose another beat; its successor is decoded in the spare slot.
    return clip && { ...clip, loop: id === DesktopPetMotion.Idle ? false : clip.loop };
  }

  sample(now: number) {
    const playing = this.player.sample(now);
    return {
      playing,
      poster: this.poster && this.poster.id === this.wanted ? this.poster.image : undefined,
      state: this.player.state,
    };
  }

  dispose(): void {
    this.disposed = true;
    this.player.dispose();
    this.clearPoster();
    this.posterImages.length = 0;
  }
}
