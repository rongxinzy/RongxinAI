// @ts-nocheck — third-party ai-elements component; @base-ui/react v1.6 type mismatch with ai-elements v1.9 (openDelay/closeDelay on PreviewCard, BaseUIEvent vs Event)

// ============================================================================
// Helpers
// ============================================================================

export const convertBlobUrlToDataUrl = async (url: string): Promise<string | null> => {
  try {
    const response = await fetch(url);
    const blob = await response.blob();
    // FileReader uses callback-based API, wrapping in Promise is necessary
    return new Promise(resolve => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result as string);
      reader.onerror = () => resolve(null);
      reader.readAsDataURL(blob);
    });
  } catch {
    return null;
  }
};
