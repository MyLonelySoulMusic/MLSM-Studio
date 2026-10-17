import { useEffect, useState } from 'react';
export function useMediaUrl(file?: File) {
  const [media, setMedia] = useState<{ file: File; url: string }>();
  useEffect(() => {
    if (!file) { setMedia(undefined); return; }
    const url = URL.createObjectURL(file);
    setMedia({ file, url });
    return () => URL.revokeObjectURL(url);
  }, [file]);
  // Never expose the previous file while the new URL is being prepared.
  return media?.file === file ? media?.url ?? '' : '';
}
