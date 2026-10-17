// Text extraction fallback for PPTX
export interface SlideContent {
  index: number;
  texts: string[];
}

export async function parsePptxSlides(data: ArrayBuffer): Promise<SlideContent[]> {
  const JSZip = (await import('jszip')).default;
  const zip = await JSZip.loadAsync(data);
  const slideFiles = Object.keys(zip.files)
    .filter(f => /^ppt\/slides\/slide\d+\.xml$/.test(f))
    .sort((a, b) => {
      const na = parseInt(a.match(/slide(\d+)/)?.[1] || '0');
      const nb = parseInt(b.match(/slide(\d+)/)?.[1] || '0');
      return na - nb;
    });

  const slides: SlideContent[] = [];
  const textRe = /<a:t>([^<]*)<\/a:t>/g;

  for (let i = 0; i < slideFiles.length; i++) {
    const xml = await zip.file(slideFiles[i])!.async('string');
    const texts: string[] = [];
    let match: RegExpExecArray | null;
    while ((match = textRe.exec(xml)) !== null) {
      if (match[1].trim()) texts.push(match[1]);
    }
    textRe.lastIndex = 0;
    slides.push({ index: i + 1, texts });
  }
  return slides;
}
