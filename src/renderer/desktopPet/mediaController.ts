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
  private terminalPlayed = false;
  private failed = new Set<DesktopPetMotion>();
  private wanted: DesktopPetMotion | undefined;
  private poster: { id: DesktopPetMotion; image: HTMLImageElement } | undefined;
  private posterPending: HTMLImageElement | undefined;
  private posterRevision = 0;
  private disposed = false;
  readonly player: PetVideoPlayer;
  constructor(private readonly changed: () => void) {
    this.player = new PetVideoPlayer({
      changed,
      ended: () => this.ended(),
      failed: clip => {
        this.failed.add(clip.id);
      },
    });
  }

  get supported(): boolean {
    return Boolean(this.pack?.length);
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
    this.context = { ...this.context, ...next };
    if (characterChanged) {
      this.pack = desktopPetMediaPack(this.context.characterId || DesktopPetBuiltinId.Xiaoyuan);
      this.failed.clear();
      this.clearPoster();
    }
    if (stateChanged || characterChanged) this.terminalPlayed = false;
    this.transient = undefined;
    this.wanted = undefined;
    this.player.stop();
    this.synchronize();
  }

  private base(): DesktopPetMotion {
    const { state, dragging, walking } = this.context;
    if (state === DesktopPetState.Error) return DesktopPetMotion.Concern;
    if (state === DesktopPetState.Waiting) return DesktopPetMotion.Wait;
    if (state === DesktopPetState.Thinking) return DesktopPetMotion.Think;
    if (dragging) return DesktopPetMotion.Lift;
    if (walking) return DesktopPetMotion.Walk;
    if (!this.terminalPlayed && state === DesktopPetState.Completed) return DesktopPetMotion.Happy;
    if (!this.terminalPlayed && state === DesktopPetState.Greeting) return DesktopPetMotion.Wave;
    return DesktopPetMotion.Idle;
  }

  playAction(action: DesktopPetPlayableAction): boolean {
    if (!this.supported) return false;
    const { reduced, visible, dragging, walking, state } = this.context;
    if (reduced || !visible || dragging || walking || attention.includes(state)) return true;
    this.transient = actions[action];
    this.failed.delete(this.transient);
    this.synchronize(true);
    return true;
  }

  private ended(): void {
    if (this.disposed || !this.context.visible || this.context.reduced) return;
    if (this.wanted === DesktopPetMotion.Happy || this.wanted === DesktopPetMotion.Wave)
      this.terminalPlayed = true;
    if (this.wanted === DesktopPetMotion.Doze) this.transient = DesktopPetMotion.Wake;
    else if (this.transient) this.transient = undefined;
    else if (this.base() === DesktopPetMotion.Idle) {
      const candidates = idle.filter(clip => !this.failed.has(clip.id));
      let pick = Math.random() * candidates.reduce((sum, clip) => sum + clip.weight, 0);
      this.transient = candidates.find(clip => {
        pick -= clip.weight;
        return pick <= 0;
      })?.id;
    }
    this.synchronize(true);
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
    this.transient = DesktopPetMotion.Land;
    this.synchronize();
  }

  private clearPoster(): void {
    this.posterRevision++;
    this.posterPending?.removeAttribute('src');
    this.poster?.image.removeAttribute('src');
    this.poster = this.posterPending = undefined;
  }

  private loadPoster(clip: DesktopPetMediaClip): void {
    if (this.poster?.id === clip.id && !this.posterPending) return;
    this.posterPending?.removeAttribute('src');
    const revision = ++this.posterRevision;
    const image = new Image();
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
    if (!this.context.visible || !this.supported) {
      this.clearPoster();
      return;
    }
    if (this.context.reduced) {
      this.clearPoster();
      return;
    }
    const id = this.transient ?? this.base();
    const clip = this.pack?.find(clip => clip.id === id);
    if (!clip) return;
    this.wanted = id;
    this.loadPoster(clip);
    if (!this.context.reduced && !this.failed.has(id)) {
      // Idle is authored as a seamless cycle but ends once to choose another idle beat.
      this.player.play(
        { ...clip, loop: id === DesktopPetMotion.Idle ? false : clip.loop },
        restart,
      );
    }
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
  }
}
