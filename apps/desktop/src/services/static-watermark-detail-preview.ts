export const OPEN_STATIC_WATERMARK_DETAIL_PREVIEW = "dsas:open-static-watermark-detail-preview";

export function openStaticWatermarkDetailPreview(): void {
  window.dispatchEvent(new Event(OPEN_STATIC_WATERMARK_DETAIL_PREVIEW));
}
