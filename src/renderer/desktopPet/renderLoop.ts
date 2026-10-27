export interface DesktopPetFrameTarget {
  video: HTMLVideoElement | null;
  animate: boolean;
}

export class DesktopPetRenderLoop {
  private generation = 0;
  private frameId: number | undefined;
  private video: HTMLVideoElement | undefined;
  private videoFrameId: number | undefined;
  private disposed = false;

  constructor(private readonly draw: (now: number) => DesktopPetFrameTarget) {}

  refresh(): void {
    if (this.disposed) return;
    this.cancel();
    const generation = ++this.generation;
    const target = this.draw(performance.now());
    if (this.disposed || generation !== this.generation || !target.animate) return;
    if (target.video && typeof target.video.requestVideoFrameCallback === 'function') {
      const video = target.video;
      this.video = video;
      this.videoFrameId = video.requestVideoFrameCallback(() => {
        if (generation === this.generation) this.refresh();
      });
    } else {
      this.frameId = requestAnimationFrame(() => {
        if (generation === this.generation) this.refresh();
      });
    }
  }

  private cancel(): void {
    if (this.frameId !== undefined) cancelAnimationFrame(this.frameId);
    if (this.video && this.videoFrameId !== undefined)
      this.video.cancelVideoFrameCallback(this.videoFrameId);
    this.frameId = undefined;
    this.video = undefined;
    this.videoFrameId = undefined;
  }

  pause(): void {
    this.generation++;
    this.cancel();
  }

  dispose(): void {
    this.disposed = true;
    this.pause();
  }
}
