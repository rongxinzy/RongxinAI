import { DesktopPetBuiltinId, desktopPetBuiltin } from '../../shared/desktopPet/catalog';
import xiaoyuan from '../assets/desktop-pet/xiaoyuan-atlas.png';
import youli from '../assets/desktop-pet/youli-atlas.png';
import tuantuan from '../assets/desktop-pet/tuantuan-atlas.png';
import mianmian from '../assets/desktop-pet/mianmian-atlas.png';
import zhuli from '../assets/desktop-pet/zhuli-atlas.png';
import yunmo from '../assets/desktop-pet/yunmo-atlas.png';
import maixiao from '../assets/desktop-pet/maixiao-atlas.png';
import frames from '../assets/desktop-pet/frames.json';

const urls: Record<DesktopPetBuiltinId, string> = {
  xiaoyuan,
  youli,
  tuantuan,
  mianmian,
  zhuli,
  yunmo,
  maixiao,
};

export class DesktopPetAtlas {
  private revision = 0;
  private requested: string | undefined;
  image: HTMLImageElement | undefined;
  character = desktopPetBuiltin(DesktopPetBuiltinId.Xiaoyuan)!;

  frame(index: number) {
    const id = this.character.id;
    if (id !== DesktopPetBuiltinId.Xiaoyuan) {
      const data = frames[id];
      const [x, y, width, height] = data.frames[index];
      return { x, y, width, height, unit: data.unit };
    }
    const width = (this.image?.naturalWidth ?? 0) / this.character.columns;
    const height = (this.image?.naturalHeight ?? 0) / this.character.rows;
    return {
      x: (index % this.character.columns) * width,
      y: Math.floor(index / this.character.columns) * height,
      width,
      height,
      unit: height,
    };
  }

  constructor(
    private readonly load = async (url: string) => {
      const image = new Image();
      image.src = url;
      await image.decode();
      return image;
    },
  ) {}

  async select(id: string): Promise<boolean> {
    const character = desktopPetBuiltin(id) ?? desktopPetBuiltin(DesktopPetBuiltinId.Xiaoyuan)!;
    if (this.requested === character.id) return false;
    this.requested = character.id;
    const revision = ++this.revision;
    try {
      const image = await this.load(urls[character.id]);
      if (revision !== this.revision) return false;
      this.image = image;
      this.character = character;
      return true;
    } catch (error) {
      if (revision !== this.revision) return false;
      this.requested = undefined;
      // Keep the previous decoded character visible on a failed switch.
      if (this.image) return false;
      throw error;
    }
  }
}
