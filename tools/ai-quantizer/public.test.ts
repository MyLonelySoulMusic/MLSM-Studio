import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const html = readFileSync(resolve('tools/ai-quantizer/public/index.html'), 'utf8');
const script = readFileSync(resolve('tools/ai-quantizer/public/app.js'), 'utf8');
const tick = () => new Promise(resolve => setTimeout(resolve, 0));

function boot() {
  document.body.innerHTML = new DOMParser().parseFromString(html, 'text/html').body.innerHTML;
  const fetcher = vi.fn(async (url: string) => new Response(JSON.stringify(url.endsWith('/health') ? { ok: true } : []), { headers: { 'content-type': 'application/json' } }));
  const app = new Function('fetch', 'requestAnimationFrame', `${script}\nreturn { state, showModule, updateWorkflow, downloadArchive, setVariant, setRestoreVariant, draw, sourceToTarget, saveAndProcess, applyAlignment, openProject, persistModuleChoice, createProject, openProjectDialog };`)(fetcher, (callback: () => void) => callback());
  const master = { id: 'track1', name: 'Song.wav', role: 'master', source: 'input.wav', duration: 3, output: 'output.wav', outputDuration: 3, processedAt: '2026-09-20T10:00:00Z' };
  app.state.project = { id: 'project1', name: 'Song', tracks: [master], settings: { targetBpm: 120 }, modules: { quantize: true, align: true, restoration: true, mastering: true, ai: false }, warpMap: { points: [{ source: 0, target: 0 }, { source: 1.1, target: 1 }, { source: 2.1, target: 2 }, { source: 3, target: 3 }] } };
  app.state.master = master;
  app.state.map = app.state.project.warpMap.points;
  app.state.buffer = { duration: 3 };
  app.state.peaks = [.1, .5, .2];
  return { app, fetcher };
}

beforeEach(() => {
  vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue();
  vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {});
  Element.prototype.scrollIntoView = vi.fn();
  window.matchMedia = vi.fn().mockReturnValue({ matches: true });
  window.URL.createObjectURL = vi.fn(() => 'blob:zip-test');
  window.URL.revokeObjectURL = vi.fn();
});
afterEach(async () => { await tick(); vi.restoreAllMocks(); document.body.innerHTML = ''; });

describe('Music guided workflow', () => {
  it('keeps navigation separate from processing toggles and preserves every unique control', () => {
    boot();
    const ids = [...document.querySelectorAll('[id]')].map(node => node.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(document.querySelector('.module-tab input')).toBeNull();
    expect(document.querySelectorAll('.module-stage')).toHaveLength(6);
  });

  it('blocks forward shortcuts until each step is performed or explicitly skipped', () => {
    const { app } = boot();
    app.state.master.output = null;
    app.updateWorkflow();
    app.showModule('export');
    expect(document.querySelector('.module-stage.active')?.getAttribute('data-stage')).not.toBe('export');
    app.state.master.output = 'output.wav';
    app.state.alignmentConfirmed = true;
    (document.querySelector('#moduleRestoration') as HTMLInputElement).checked = false;
    (document.querySelector('#moduleMastering') as HTMLInputElement).checked = false;
    app.updateWorkflow(); app.showModule('export');
    expect(document.querySelector('.module-stage.active')?.getAttribute('data-stage')).toBe('export');
    app.showModule('quantize');
    expect(document.querySelector('.module-stage.active')?.getAttribute('data-stage')).toBe('quantize');
  });

  it('requires alignment confirmation and invalidates forward access when timing changes', () => {
    const { app } = boot();
    app.showModule('align');
    app.showModule('restoration');
    expect(document.querySelector('.module-stage.active')?.getAttribute('data-stage')).toBe('align');
    app.state.alignmentConfirmed = true;
    app.showModule('restoration');
    expect(document.querySelector('.module-stage.active')?.getAttribute('data-stage')).toBe('restoration');
    app.showModule('quantize'); app.state.quantizeDirty = true;
    app.showModule('align');
    expect(document.querySelector('.module-stage.active')?.getAttribute('data-stage')).toBe('quantize');
  });

  it('switches rendered audio without autoplay', () => {
    const { app } = boot();
    app.setVariant('output');
    app.state.master.restored = 'restored.wav';
    app.setRestoreVariant('restored');
    expect(HTMLMediaElement.prototype.play).not.toHaveBeenCalled();
    expect((document.querySelector('#player') as HTMLAudioElement).src).toContain('variant=output');
  });

  it('finishes processing with a visible result map and paused audio', async () => {
    const { app, fetcher } = boot();
    await tick();
    const result = JSON.parse(JSON.stringify(app.state.project));
    result.workflow = { alignmentReviewed: false };
    fetcher.mockResolvedValueOnce(new Response(JSON.stringify(result), { headers: { 'content-type': 'application/json' } }))
      .mockResolvedValueOnce(new Response(JSON.stringify(result), { headers: { 'content-type': 'application/json' } }));
    expect(await app.saveAndProcess()).toBe(true);
    expect(app.state.mapVariant).toBe('output');
    expect(HTMLMediaElement.prototype.play).not.toHaveBeenCalled();
    expect(document.querySelector('#busy')?.classList.contains('hidden')).toBe(true);
    expect(document.querySelector('#exportTrackList')?.textContent).toContain('Song.wav');
  });

  it('replaces the browser confirmation with an accessible high-correction modal', async () => {
    const { app, fetcher } = boot();
    await tick(); fetcher.mockClear();
    fetcher.mockResolvedValueOnce(new Response(JSON.stringify({ error: 'CONFERMA_WARP: correzione locale fino al 18%, oltre il limite consigliato' }), { status: 400, headers: { 'content-type': 'application/json' } }));
    const processing = app.saveAndProcess();
    await tick();
    const dialog = document.querySelector('#unsafeWarpModal [role="alertdialog"]');
    expect(dialog).not.toBeNull();
    expect(document.querySelector('#unsafeWarpModal')?.classList.contains('hidden')).toBe(false);
    expect(document.querySelector('#unsafeWarpValue')?.textContent).toBe('18%');
    expect(document.querySelector('#unsafeWarpDetail')?.textContent).toContain('correzione locale fino al 18%');
    expect(document.querySelector('#busy')?.classList.contains('hidden')).toBe(true);
    expect(document.activeElement).toBe(document.querySelector('#unsafeWarpCancel'));
    (document.querySelector('#unsafeWarpCancel') as HTMLButtonElement).click();
    expect(await processing).toBe(false);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(document.querySelector('#toast')?.textContent).toBe('Quantizzazione annullata');
  });

  it('creates a project through the professional modal without browser prompt', async () => {
    const { app, fetcher } = boot();
    await tick(); fetcher.mockClear();
    fetcher
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: 'new-project' }), { headers: { 'content-type': 'application/json' } }))
      .mockResolvedValueOnce(new Response(JSON.stringify([]), { headers: { 'content-type': 'application/json' } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: 'new-project', name: 'Album mix', tracks: [], settings: { targetBpm: 120 }, modules: {} }), { headers: { 'content-type': 'application/json' } }));
    const creating = app.createProject();
    expect(document.querySelector('#projectDialog')?.classList.contains('hidden')).toBe(false);
    expect(document.activeElement).toBe(document.querySelector('#projectDialogName'));
    const input = document.querySelector('#projectDialogName') as HTMLInputElement;
    input.value = 'Album mix'; input.dispatchEvent(new Event('input', { bubbles: true }));
    (document.querySelector('#projectDialogConfirm') as HTMLButtonElement).click();
    await creating;
    expect(fetcher).toHaveBeenCalledWith('/music/ai-quantizer/api/projects', expect.objectContaining({ method: 'POST', body: JSON.stringify({ name: 'Album mix' }) }));
    expect(document.querySelector('#projectDialog')?.classList.contains('is-closing')).toBe(true);
  });

  it('continues the render only after explicit confirmation in the custom modal', async () => {
    const { app, fetcher } = boot();
    await tick(); fetcher.mockClear();
    const result = JSON.parse(JSON.stringify(app.state.project));
    result.workflow = { alignmentReviewed: false };
    fetcher
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: 'CONFERMA_WARP: correzione locale fino al 21%, oltre il limite consigliato' }), { status: 400, headers: { 'content-type': 'application/json' } }))
      .mockResolvedValueOnce(new Response(JSON.stringify(result), { headers: { 'content-type': 'application/json' } }))
      .mockResolvedValueOnce(new Response(JSON.stringify(result), { headers: { 'content-type': 'application/json' } }));
    const processing = app.saveAndProcess();
    await tick();
    (document.querySelector('#unsafeWarpContinue') as HTMLButtonElement).click();
    expect(await processing).toBe(true);
    expect(fetcher).toHaveBeenCalledTimes(3);
    expect(JSON.parse(String(fetcher.mock.calls[1][1]?.body))).toMatchObject({ confirmUnsafe: true });
    expect(document.querySelector('#busy')?.classList.contains('hidden')).toBe(true);
  });

  it('applies alignment through its dedicated endpoint without saving or processing the warp map', async () => {
    const { app, fetcher } = boot();
    await tick(); fetcher.mockClear();
    const result = JSON.parse(JSON.stringify(app.state.project));
    result.workflow = { alignmentReviewed: true };
    result.alignment = { enabled: true, shiftSeconds: .25, fadeSeconds: .15 };
    result.tracks[0].alignment = { shiftSeconds: .25, fadeSeconds: .15, direction: 'forward' };
    let resolveAlignment!: (response: Response) => void;
    fetcher.mockImplementationOnce(() => new Promise<Response>(resolve => { resolveAlignment = resolve; }));
    (document.querySelector('#alignEnabled') as HTMLInputElement).checked = true;
    const applying = app.applyAlignment();
    expect(document.querySelector('#busyTitle')?.textContent).toBe('Applicazione allineamento');
    expect(document.querySelector('#busyText')?.textContent).toContain('quantizzazione non viene ripetuta');
    resolveAlignment(new Response(JSON.stringify(result), { headers: { 'content-type': 'application/json' } }));
    expect(await applying).toBe(true);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher).toHaveBeenCalledWith(expect.stringContaining('/alignment'), expect.objectContaining({ method: 'PUT' }));
    expect(fetcher.mock.calls.some(([url]) => String(url).includes('/warp-map') || String(url).includes('/process'))).toBe(false);
    expect(document.querySelector('#toast')?.textContent).toContain('senza ripetere la quantizzazione');
    expect(HTMLMediaElement.prototype.play).not.toHaveBeenCalled();
  });

  it('persists an explicit restoration skip before allowing the mastering stage', async () => {
    const { app, fetcher } = boot();
    await tick();
    app.state.alignmentConfirmed = true;
    app.showModule('restoration');
    const result = JSON.parse(JSON.stringify(app.state.project));
    result.modules.restoration = false;
    fetcher.mockResolvedValueOnce(new Response(JSON.stringify(result), { headers: { 'content-type': 'application/json' } }));
    const input = document.querySelector('#moduleRestoration') as HTMLInputElement;
    input.checked = false;
    expect(await app.persistModuleChoice(input)).toBe(true);
    expect(fetcher).toHaveBeenLastCalledWith(expect.stringContaining('/modules'), expect.objectContaining({ method: 'PUT', body: expect.stringContaining('"restoration":false') }));
    app.showModule('mastering');
    expect(document.querySelector('.module-stage.active')?.getAttribute('data-stage')).toBe('mastering');
  });

  it('rebuilds beat corrections when re-enabling quantization after skipping it', async () => {
    const { app, fetcher } = boot();
    await tick();
    app.state.beats = [0.5, 1.05, 1.6, 2.15];
    app.state.map = [{ source: 0, target: 0 }, { source: 3, target: 3 }];
    app.state.project.modules.quantize = false;
    const result = JSON.parse(JSON.stringify(app.state.project));
    result.modules.quantize = true; result.tracks[0].output = null;
    fetcher.mockResolvedValueOnce(new Response(JSON.stringify(result), { headers: { 'content-type': 'application/json' } }));
    const input = document.querySelector('#moduleQuantize') as HTMLInputElement;
    input.checked = true;
    expect(await app.persistModuleChoice(input)).toBe(true);
    expect(app.state.quantizeDirty).toBe(true);
    expect(app.state.map.length).toBeGreaterThan(2);
    expect(app.state.map[2].source).not.toBe(app.state.map[2].target);
  });

  it('shows saved corrected beat positions after rendering, even when the draft map differs', () => {
    const { app } = boot();
    const ctx = { scale: vi.fn(), fillRect: vi.fn(), beginPath: vi.fn(), moveTo: vi.fn(), lineTo: vi.fn(), stroke: vi.fn() };
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(ctx as unknown as CanvasRenderingContext2D);
    vi.spyOn(HTMLCanvasElement.prototype, 'getBoundingClientRect').mockReturnValue({ width: 300 } as DOMRect);
    app.state.mapVariant = 'output';
    app.state.map = [{ source: 0, target: 0 }, { source: 1, target: 2 }, { source: 3, target: 6 }];
    app.draw();
    expect(ctx.moveTo).toHaveBeenCalledWith(100, 15);
    expect(ctx.moveTo).toHaveBeenCalledWith(200, 15);
    expect(document.querySelector('#mappingCaption')?.textContent).toContain('Mappa applicata');
  });
});

it('translates the guided workflow and download feedback into English', () => {
  boot();
  const localization = readFileSync(resolve('tools/ai-quantizer/public/i18n.js'), 'utf8');
  const translator = new Function('MutationObserver', `${localization}\nreturn window.AIQ_I18N;`)(class { observe() {} });
  translator.setLanguage('en');
  try {
    expect(document.querySelector('[data-stage="import"] h3')?.textContent).toBe('Import your tracks');
    expect(document.querySelector('[data-skip="restoration"]')?.textContent).toBe('Skip restoration');
    expect(translator.translate('Preparazione ZIP')).toBe('Preparing ZIP');
    expect(translator.translate('Download incompleto. Riprova.')).not.toBe('Download incompleto. Riprova.');
    expect(translator.translate('Correzione oltre il limite consigliato')).toBe('Correction above the recommended limit');
    expect(translator.translate('correzione locale fino al 18%, oltre il limite consigliato')).toBe('Local correction up to 18%, above the recommended limit');
    expect(document.querySelector('#unsafeWarpCancel')?.textContent).toBe('Return to the map');
  } finally { translator.setLanguage('it'); }
});

describe('Music ZIP feedback', () => {
  it('shows preparation immediately, prevents duplicate exports, then hands the ZIP to the browser', async () => {
    const { app, fetcher } = boot();
    await tick(); fetcher.mockClear();
    let resolveDownload!: (response: Response) => void;
    fetcher.mockImplementationOnce(() => new Promise<Response>(resolve => { resolveDownload = resolve; }));
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    const download = app.downloadArchive();
    expect(document.querySelector('#busy')?.classList.contains('hidden')).toBe(false);
    expect(document.querySelector('#busyTitle')?.textContent).toBe('Preparazione ZIP');
    expect(document.querySelector('#downloadAll')?.getAttribute('aria-busy')).toBe('true');
    expect(document.querySelector('#zipProgress')?.hasAttribute('value')).toBe(false);
    await app.downloadArchive();
    expect(fetcher).toHaveBeenCalledTimes(1);
    resolveDownload(new Response(new Uint8Array([80, 75, 3, 4]), { headers: { 'content-type': 'application/zip', 'content-length': '4', 'content-disposition': "attachment; filename*=UTF-8''Brano%20finale.zip" } }));
    await download;
    expect(click).toHaveBeenCalledTimes(1);
    expect(window.URL.createObjectURL).toHaveBeenCalled();
    expect(document.querySelector('#busy')?.classList.contains('hidden')).toBe(true);
    expect((document.querySelector('#downloadAll') as HTMLButtonElement).disabled).toBe(false);
    expect(document.querySelector('#toast')?.textContent).toBe('ZIP pronto. Download avviato.');
  });

  it('restores controls after server errors and supports retry', async () => {
    const { app, fetcher } = boot();
    await tick();
    fetcher.mockResolvedValueOnce(new Response(JSON.stringify({ error: 'Archivio non disponibile' }), { status: 500, headers: { 'content-type': 'application/json' } }));
    await app.downloadArchive();
    expect(document.querySelector('#toast')?.textContent).toBe('Archivio non disponibile');
    expect(document.querySelector('#busy')?.classList.contains('hidden')).toBe(true);
    expect((document.querySelector('#downloadAll') as HTMLButtonElement).disabled).toBe(false);
    expect(window.URL.createObjectURL).not.toHaveBeenCalled();
  });

  it('does not download a truncated archive', async () => {
    const { app, fetcher } = boot();
    await tick();
    fetcher.mockResolvedValueOnce(new Response(new Uint8Array([80, 75]), { headers: { 'content-length': '10' } }));
    await app.downloadArchive();
    expect(document.querySelector('#toast')?.textContent).toBe('Download incompleto. Riprova.');
    expect(window.URL.createObjectURL).not.toHaveBeenCalled();
  });
});
