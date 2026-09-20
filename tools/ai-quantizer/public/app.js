/* global document, window, fetch, clearTimeout, setTimeout, confirm, prompt, AudioContext, devicePixelRatio, requestAnimationFrame, Blob */
const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
const tr = value => window.AIQ_I18N?.translate(value) || value;
const state = { projects: [], project: null, master: null, buffer: null, peaks: [], beats: [], downbeats: [], map: [], variant: 'source', mapVariant: 'source', quantizeDirty: false, alignmentDirty: false, alignmentConfirmed: false };
let exporting = false;
let busyFocus = null;

async function request(url, options = {}) {
  const res = await fetch(url, options);
  const data = res.headers.get('content-type')?.includes('json') ? await res.json() : await res.text();
  if (!res.ok) throw new Error(data.error || `Errore ${res.status}`);
  return data;
}

function toast(message, error = false) {
  const el = $('#toast'); el.textContent = message; el.className = `toast show${error ? ' error' : ''}`;
  clearTimeout(toast.timer); toast.timer = setTimeout(() => el.className = 'toast', 3000);
}

function busy(on, title = 'Elaborazione audio', text = 'Questa operazione può richiedere qualche minuto.') {
  if (on && $('#busy').classList.contains('hidden')) busyFocus = document.activeElement;
  $('#busyTitle').textContent = title; $('#busyText').textContent = text;
  $('#busy').classList.toggle('hidden', !on);
  $('main').inert = on;
  $('.sidebar').inert = on;
  if (on) $('#busy').focus();
  else { busyFocus?.focus(); busyFocus = null; }
  if (!exporting) $('#zipProgressArea')?.classList.add('hidden');
}

async function saveModuleSettings() {
  if (!state.project) return false;
  const previous = state.project.modules || {};
  busy(true, 'Salvataggio dei passaggi', 'Salvataggio delle impostazioni…');
  try {
    state.project = await request(`/music/ai-quantizer/api/projects/${state.project.id}/modules`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(moduleFlags())
    });
    state.master = state.project.tracks.find(track => track.role === 'master') || null;
    renderTracks(); renderLoudness(); renderAiDetection();
    return true;
  } catch (error) {
    for (const name of ['quantize', 'align', 'restoration', 'mastering', 'ai'])
      $(`#module${name[0].toUpperCase()}${name.slice(1)}`).checked = previous[name] ?? true;
    syncModules();
    toast(error.message, true);
    return false;
  } finally { busy(false); }
}

async function downloadArchive() {
  if (exporting) return;
  if (!state.project?.tracks.length || state.project.tracks.some(track => !track.output))
    return toast('Completa prima la quantizzazione di tutte le tracce', true);
  exporting = true;
  const button = $('#downloadAll');
  button.disabled = true;
  button.setAttribute('aria-busy', 'true');
  busy(true, 'Preparazione ZIP', 'Raccolgo master e stem e preparo l’archivio. Attendi: il download partirà automaticamente.');
  const progress = $('#zipProgress');
  progress.removeAttribute('value');
  $('#zipProgressArea').classList.remove('hidden');
  $('#zipProgressText').textContent = 'Creazione archivio…';
  try {
    const response = await fetch(`/music/ai-quantizer/api/projects/${state.project.id}/download-all`);
    if (!response.ok) {
      const data = response.headers.get('content-type')?.includes('json') ? await response.json() : null;
      throw new Error(data?.error || tr('Impossibile preparare lo ZIP. Riprova.'));
    }
    $('#busyTitle').textContent = 'Download ZIP';
    $('#busyText').textContent = 'Archivio pronto. Trasferimento del file in corso…';
    const total = Number(response.headers.get('content-length'));
    let blob;
    if (response.body?.getReader) {
      const reader = response.body.getReader(), chunks = [];
      let received = 0;
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          chunks.push(value); received += value.byteLength;
          if (total > 0) { progress.max = total; progress.value = received; }
          $('#zipProgressText').textContent = total > 0
            ? `${Math.min(100, Math.round(received / total * 100))}% · ${(received / 1048576).toFixed(1)} / ${(total / 1048576).toFixed(1)} MB`
            : `${(received / 1048576).toFixed(1)} MB`;
        }
      } finally { reader.releaseLock(); }
      if (total > 0 && received !== total) throw new Error(tr('Download incompleto. Riprova.'));
      blob = new Blob(chunks, { type: 'application/zip' });
    } else blob = await response.blob();
    if (!blob.size) throw new Error(tr('L’archivio ZIP è vuoto. Riprova.'));
    const disposition = response.headers.get('content-disposition') || '';
    let filename = `${state.project.name}-export.zip`;
    try {
      const encoded = /filename\*=UTF-8''([^;]+)/i.exec(disposition);
      const plain = /filename="([^"]+)"/i.exec(disposition);
      filename = encoded ? decodeURIComponent(encoded[1]) : plain?.[1] || filename;
    } catch { /* Keep the project name if a header is malformed. */ }
    const url = window.URL.createObjectURL(blob), link = document.createElement('a');
    link.href = url; link.download = filename.replace(/[/\\]/g, '_');
    document.body.append(link); link.click(); link.remove();
    setTimeout(() => window.URL.revokeObjectURL(url), 60_000);
    toast('ZIP pronto. Download avviato.');
  } catch (error) { toast(error.message, true); }
  finally {
    exporting = false; button.removeAttribute('aria-busy'); busy(false); renderTracks();
  }
}

async function loadProjects() {
  state.projects = await request('/music/ai-quantizer/api/projects');
  $('#projects').innerHTML = state.projects.map(p =>
    `<div class="project-row ${state.project?.id === p.id ? 'active' : ''}">
      <button class="project-item" data-id="${p.id}">${escapeHtml(p.name)}</button>
      <button class="project-trash" data-id="${p.id}" data-name="${escapeHtml(p.name)}" title="Elimina progetto">Cestino</button>
    </div>`).join('');
  $$('.project-item').forEach(button => button.onclick = () => openProject(button.dataset.id));
  $$('.project-trash').forEach(button => button.onclick = async event => {
    event.stopPropagation();
    if (!confirm(tr(`Eliminare definitivamente “${button.dataset.name}”?`))) return;
    await request(`/music/ai-quantizer/api/projects/${button.dataset.id}`, { method: 'DELETE' });
    if (state.project?.id === button.dataset.id) {
      state.project = null;
      $('#workspace').classList.add('hidden');
      $('#emptyState').classList.remove('hidden');
    }
    await loadProjects();
    toast('Progetto eliminato');
  });
}

function escapeHtml(s) { const d = document.createElement('div'); d.textContent = s; return d.innerHTML; }

async function createProject() {
  const name = prompt(tr('Nome del progetto'), tr('Nuovo brano'));
  if (!name) return;
  const project = await request('/music/ai-quantizer/api/projects', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name })
  });
  await loadProjects(); await openProject(project.id);
}

async function openProject(id) {
  state.project = await request(`/music/ai-quantizer/api/projects/${id}`);
  state.master = state.project.tracks.find(t => t.role === 'master') || null;
  state.variant = 'source';
  state.mapVariant = state.master?.output ? 'output' : 'source';
  state.quantizeDirty = false; state.alignmentDirty = false;
  state.restorationDirty = false; state.masteringDirty = false;
  state.alignmentConfirmed = state.project.modules?.align === false
    || (state.project.workflow?.alignmentReviewed ?? Boolean(state.master?.alignment || state.master?.restored || state.master?.mastered));
  state.buffer = null; state.peaks = []; state.beats = []; state.downbeats = [];
  if (state.project.analysis) {
    state.beats = state.project.analysis.beats || [];
    state.downbeats = state.project.analysis.downbeats || [];
  }
  state.map = state.project.warpMap?.points || [];
  $('#emptyState').classList.add('hidden'); $('#workspace').classList.remove('hidden');
  $('#projectName').textContent = state.project.name;
  $('#targetBpm').value = Math.round(state.project.settings.targetBpm || 120);
  $('#alignEnabled').checked = Boolean(state.project.alignment?.enabled);
  $('#alignMode').value = state.project.alignment?.mode || 'auto';
  $('#fadeSeconds').value = state.project.alignment?.fadeSeconds ?? .15;
  $('#masterGain').value = state.project.mastering?.gainDb ?? 0;
  $('#limiterEnabled').checked = state.project.mastering?.limiterEnabled ?? true;
  $('#limiterCeiling').value = state.project.mastering?.ceilingDbtp ?? -1;
  $('#limiterRelease').value = state.project.mastering?.releaseMs ?? 100;
  $('#restoreClean').checked = state.project.restoration?.clean ?? true;
  $('#restoreDeclip').checked = state.project.restoration?.declip ?? false;
  $('#restoreBandwidth').checked = state.project.restoration?.bandwidth ?? false;
  $('#restoreIntensity').value = state.project.restoration?.intensity ?? 35;
  $('#restoreIntensityValue').textContent = `${$('#restoreIntensity').value}%`;
  $('#masterHint').textContent = state.master ? `${state.master.name} · ${formatTime(state.master.duration)}` : 'Trascina il mix completo o scegli un file audio.';
  const modules = state.project.modules || {};
  $('#moduleQuantize').checked = modules.quantize ?? true;
  $('#moduleAlign').checked = modules.align ?? true;
  $('#moduleRestoration').checked = modules.restoration ?? true;
  $('#moduleMastering').checked = modules.mastering ?? true;
  $('#moduleAi').checked = modules.ai ?? true;
  syncModules();
  $('#editor').classList.remove('hidden');
  renderTracks(); await loadProjects();
  renderLoudness();
  renderAiDetection();
  showModule('import');
  if (state.master) await loadMasterAudio();
}

async function upload(files, role) {
  if (!state.project || !files.length) return;
  busy(true, 'Caricamento audio', 'Il file viene verificato e aggiunto al progetto.');
  const addedTrackIds = [];
  try {
    for (const file of files) {
      const previousIds = new Set(state.project.tracks.map(track => track.id));
      state.project = await request(`/music/ai-quantizer/api/projects/${state.project.id}/tracks?name=${encodeURIComponent(file.name)}&role=${role}`, {
        method: 'POST', headers: { 'Content-Type': file.type || 'application/octet-stream' }, body: file
      });
      addedTrackIds.push(...state.project.tracks
        .filter(track => !previousIds.has(track.id))
        .map(track => track.id));
    }
    const unprocessedTrackIds = addedTrackIds.filter(id =>
      !state.project.tracks.find(track => track.id === id)?.output);
    if (role === 'stem' && state.project.warpMap?.points?.length && unprocessedTrackIds.length) {
      busy(true, 'Quantizzazione degli stem', 'Applico agli stem la stessa identica timeline del master.');
      state.project = await request(`/music/ai-quantizer/api/projects/${state.project.id}/process`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ trackIds: unprocessedTrackIds })
      });
    }
    await openProject(state.project.id);
    toast(role === 'master' ? 'Master caricato' :
      state.project.warpMap ? 'Stem aggiunti e quantizzati' : 'Stem aggiunti');
  } catch (e) {
    await openProject(state.project.id).catch(() => {});
    toast(e.message, true);
  } finally { busy(false); }
}

async function loadMasterAudio() {
  const url = audioUrl(state.master, 'source');
  $('#player').src = audioUrl(state.master, state.variant);
  busy(true, 'Analisi della traccia', 'Decodifico la waveform e individuo la pulsazione.');
  try {
    const bytes = await (await fetch(url)).arrayBuffer();
    const context = new AudioContext();
    state.buffer = await context.decodeAudioData(bytes);
    await context.close();
    buildPeaks();
    if (state.project.analysis) {
      state.beats = state.project.analysis.beats || [];
      state.downbeats = state.project.analysis.downbeats || [];
      if (!state.project.warpMap?.points?.length) rebuildMap();
    }
    if (state.project.warpMap?.points?.length) {
      state.map = state.project.warpMap.points;
      updateMetrics(state.project.warpMap.estimatedBpm);
      draw();
    } else if (!state.project.analysis) await analyze();
  } catch (e) { toast(`Preview non disponibile: ${e.message}`, true); } finally { busy(false); }
}

function buildPeaks() {
  const data = state.buffer.getChannelData(0), count = 1800, stride = Math.max(1, Math.floor(data.length / count));
  state.peaks = [];
  for (let i = 0; i < count; i++) {
    let peak = 0;
    for (let j = i * stride; j < Math.min(data.length, (i + 1) * stride); j += 4) peak = Math.max(peak, Math.abs(data[j]));
    state.peaks.push(peak);
  }
}

async function analyze() {
  if (!state.project || !state.master) return;
  busy(true, 'Analisi ritmica neurale', 'Rilevo beat, downbeat, battute e stabilità della tempo map.');
  try {
    state.project = await request(`/music/ai-quantizer/api/projects/${state.project.id}/analyze`, { method: 'POST' });
    state.master = state.project.tracks.find(t => t.role === 'master');
    state.beats = state.project.analysis.beats;
    state.downbeats = state.project.analysis.downbeats;
    $('#targetBpm').value = Math.round(state.project.analysis.detectedBpm);
    renderTracks(); renderLoudness(); renderAiDetection();
    rebuildMap(); toast(`Analisi completata · confidenza ${state.project.analysis.confidence}%`);
  } catch (e) { toast(e.message, true); } finally { busy(false); }
}

function rebuildMap() {
  const anchors = normalizedBeatAnchors(state.beats);
  if (anchors.length < 2) return;
  const targetBpm = Math.round(Math.max(40, Math.min(240, Number($('#targetBpm').value) || 120)));
  $('#targetBpm').value = targetBpm;
  const targetBeat = 60 / targetBpm;
  const first = anchors[0];
  state.map = [{ source: 0, target: 0 }, ...anchors.map((source, i) => ({
    source, target: first + i * targetBeat
  }))];
  const duration = state.buffer?.duration || state.master.duration;
  const last = state.map[state.map.length - 1];
  if (last.source < duration) state.map.push({
    source: duration, target: last.target + (duration - last.source)
  });
  updateMetrics(state.project.analysis?.detectedBpm);
  draw();
}

function normalizedBeatAnchors(input) {
  const beats = [...new Set(input.map(Number).filter(Number.isFinite))].sort((a, b) => a - b);
  if (beats.length < 3) return beats;
  const intervals = beats.slice(1).map((v, i) => v - beats[i]).filter(v => v > .2 && v < 1.5).sort((a, b) => a - b);
  const period = intervals[Math.floor(intervals.length / 2)];
  const result = [beats[0]];
  for (let i = 1; i < beats.length; i++) {
    const previous = result[result.length - 1], gap = beats[i] - previous;
    if (gap < period * .52) continue;
    const steps = Math.max(1, Math.round(gap / period));
    if (steps > 1 && gap / steps > period * .72 && gap / steps < period * 1.28) {
      for (let step = 1; step < steps; step++) result.push(previous + gap * step / steps);
    }
    result.push(beats[i]);
  }
  return result;
}

function corrections() {
  return state.map.slice(1).map((p, i) => {
    const prev = state.map[i], source = p.source - prev.source, target = p.target - prev.target;
    return Math.abs(target / Math.max(.001, source) - 1) * 100;
  });
}

function updateMetrics(bpm) {
  const corr = corrections();
  $('#detectedBpm').textContent = Number.isFinite(bpm) ? Math.round(bpm * 10) / 10 : '—';
  $('#confidence').textContent = state.project.analysis ? `${state.project.analysis.confidence}%` : '—';
  $('#maxCorrection').textContent = corr.length ? `${Math.max(...corr).toFixed(1)}%` : '—';
}

function draw() {
  const canvas = $('#waveform'), ratio = devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  if (rect.width < 2) return;
  canvas.width = Math.floor(rect.width * ratio); canvas.height = Math.floor(270 * ratio);
  const ctx = canvas.getContext('2d'); ctx.scale(ratio, ratio);
  const output = state.mapVariant === 'output' && Boolean(state.master?.output);
  const points = output ? state.project.warpMap?.points || [] : state.map;
  const quantized = !output || state.project.modules?.quantize !== false;
  const shift = output && state.project.modules?.align !== false && state.project.alignment?.enabled
    ? state.project.alignment.shiftSeconds : 0;
  const sourceDuration = state.buffer?.duration || state.master?.duration || 1;
  const duration = output ? Math.max(.001, state.master.outputDuration || (quantized ? points.at(-1)?.target || sourceDuration : sourceDuration) + shift) : sourceDuration;
  const w = rect.width, h = 270, mid = h / 2;
  $$('.mapping-switch button').forEach(button => {
    const active = button.dataset.mapVariant === (output ? 'output' : 'source');
    button.setAttribute('aria-pressed', String(active)); button.classList.toggle('active', active);
  });
  if ($('#mappingCaption')) $('#mappingCaption').textContent = output
    ? 'Mappa applicata al risultato: beat e waveform rimappati sulla timeline finale. Premi Play per ascoltare.'
    : 'Mappa originale: i colori indicano le correzioni di tempo. Click per modificare i beat.';
  ctx.fillStyle = '#0b0e14'; ctx.fillRect(0, 0, w, h);
  ctx.strokeStyle = '#252d38'; ctx.lineWidth = 1;
  for (let i = 1; i < 8; i++) { const x = w * i / 8; ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke(); }
  ctx.beginPath(); ctx.strokeStyle = '#526070'; ctx.lineWidth = 1;
  state.peaks.forEach((p, i) => {
    const time = i / state.peaks.length * sourceDuration;
    const mapped = output ? (quantized ? sourceToTarget(time, points) : time) + shift : time;
    if (mapped < 0) return;
    const x = mapped / duration * w, amp = p * h * .42;
    ctx.moveTo(x, mid - amp); ctx.lineTo(x, mid + amp);
  });
  ctx.stroke();
  points.slice(1, -1).forEach((p, i) => {
    const time = output ? (quantized ? p.target : p.source) + shift : p.source;
    if (time < 0) return;
    const x = time / duration * w, prev = points[i], local = Math.abs((p.target - prev.target) / Math.max(.001, p.source - prev.source) - 1);
    ctx.strokeStyle = output ? '#FF4F9A' : local > .08 ? '#ff627d' : local > .04 ? '#ffd166' : '#f2a8c8'; ctx.lineWidth = !output && local > .08 ? 2 : 1;
    ctx.beginPath(); ctx.moveTo(x, 15); ctx.lineTo(x, h - 15); ctx.stroke();
    const tx = output ? x : p.target / Math.max(duration, points.at(-1)?.target || duration) * w;
    ctx.fillStyle = '#ffffff'; ctx.fillRect(tx - 1, h - 15, 2, 9);
  });
}

function sourceToTarget(time, points = state.map) {
  if (!points.length) return time;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1], b = points[i];
    if (time <= b.source) {
      const ratio = (time - a.source) / Math.max(.000001, b.source - a.source);
      return a.target + ratio * (b.target - a.target);
    }
  }
  const last = points.at(-1);
  return last.target + time - last.source;
}

function alignmentPlan() {
  const enabled = $('#alignEnabled').checked;
  const bpm = Math.round(Number($('#targetBpm').value) || 120);
  const barDuration = 240 / bpm;
  const referenceSource = state.downbeats[0] ?? state.beats[0] ?? 0;
  const referenceTarget = $('#moduleQuantize').checked ? sourceToTarget(referenceSource) : referenceSource;
  const lower = Math.floor(referenceTarget / barDuration) * barDuration;
  const upper = Math.ceil(referenceTarget / barDuration) * barDuration;
  const mode = $('#alignMode').value;
  let gridTarget;
  if (mode === 'backward') gridTarget = lower;
  else if (mode === 'forward') gridTarget = upper;
  else gridTarget = Math.abs(referenceTarget - lower) <= Math.abs(upper - referenceTarget) ? lower : upper;
  const shiftSeconds = enabled ? gridTarget - referenceTarget : 0;
  return {
    enabled, mode, shiftSeconds, referenceSource, referenceTarget, gridTarget, barDuration,
    fadeSeconds: Math.max(0, Math.min(10, Number($('#fadeSeconds').value) || 0))
  };
}

function drawAlignment() {
  const canvas = $('#alignmentWaveform');
  if (!canvas || !state.buffer) return;
  const ratio = devicePixelRatio || 1, rect = canvas.getBoundingClientRect(), w = rect.width, h = 220;
  if (w < 2) return;
  canvas.width = Math.floor(w * ratio); canvas.height = Math.floor(h * ratio);
  const ctx = canvas.getContext('2d'); ctx.scale(ratio, ratio);
  const plan = alignmentPlan(), duration = Math.max(state.map.at(-1)?.target || state.buffer.duration, state.buffer.duration);
  ctx.fillStyle = '#0b0e14'; ctx.fillRect(0, 0, w, h);
  const visibleDuration = duration + Math.max(0, plan.shiftSeconds);
  for (let t = 0, bar = 1; t <= visibleDuration; t += plan.barDuration, bar++) {
    const x = t / visibleDuration * w;
    ctx.strokeStyle = bar % 4 === 1 ? '#c9ff4588' : '#c9ff4535';
    ctx.lineWidth = bar % 4 === 1 ? 2 : 1;
    ctx.beginPath(); ctx.moveTo(x, 22); ctx.lineTo(x, h); ctx.stroke();
    ctx.fillStyle = '#9ca56f'; ctx.font = '10px sans-serif'; ctx.fillText(String(bar), x + 5, 14);
  }
  const mid = 120;
  ctx.beginPath(); ctx.strokeStyle = '#596576'; ctx.lineWidth = 1;
  state.peaks.forEach((peak, i) => {
    const time = i / state.peaks.length * state.buffer.duration;
    const warpedTime = ($('#moduleQuantize').checked ? sourceToTarget(time) : time) + plan.shiftSeconds;
    if (warpedTime < 0) return;
    const x = warpedTime / visibleDuration * w, amp = peak * 70;
    ctx.moveTo(x, mid - amp); ctx.lineTo(x, mid + amp);
  });
  ctx.stroke();
  const originalX = plan.referenceTarget / visibleDuration * w;
  const alignedX = plan.gridTarget / visibleDuration * w;
  ctx.strokeStyle = '#55dfea'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(originalX, 28); ctx.lineTo(originalX, h); ctx.stroke();
  if (plan.enabled) {
    ctx.strokeStyle = '#ff627d'; ctx.setLineDash([5, 5]); ctx.beginPath(); ctx.moveTo(alignedX, 28); ctx.lineTo(alignedX, h); ctx.stroke(); ctx.setLineDash([]);
    const fadeStart = Math.max(0, plan.shiftSeconds), fadeEnd = Math.min(visibleDuration, fadeStart + plan.fadeSeconds);
    ctx.fillStyle = '#c9ff4518'; ctx.fillRect(fadeStart / visibleDuration * w, 28, (fadeEnd - fadeStart) / visibleDuration * w, h - 28);
  }
  $('#alignReference').textContent = `${plan.referenceTarget.toFixed(3)} s`;
  $('#alignShift').textContent = plan.enabled ? `${plan.shiftSeconds >= 0 ? '+' : ''}${plan.shiftSeconds.toFixed(3)} s` : 'Disattivato';
  $('#alignBar').textContent = `Bar ${Math.round(plan.gridTarget / plan.barDuration) + 1}`;
  const direction = plan.shiftSeconds > .0005 ? 'avanti, aggiungendo spazio' : plan.shiftSeconds < -.0005 ? 'indietro, tagliando l’anticipo' : 'già allineato';
  $('#alignExplanation').textContent = plan.enabled
    ? `Auto-allineamento ${direction}. Fade-in di ${plan.fadeSeconds.toFixed(2)} s applicato dopo la traslazione.`
    : 'Abilita l’opzione per ordinare il risultato quantizzato sulla griglia DAW.';
}

async function saveAndProcess(alignmentReviewed = false) {
  // DOM click events are not a confirmation of the alignment step.
  alignmentReviewed = alignmentReviewed === true;
  if (!$('#moduleQuantize').checked && state.master) {
    const duration = state.buffer?.duration || state.master.duration;
    state.map = [{ source: 0, target: 0 }, { source: duration, target: duration }];
  }
  if (state.map.length < 2) return toast('Analizza prima il brano', true);
  busy(true, 'Quantizzazione di master e stem', 'Applico a tutte le tracce una sola timeline, conservando il pitch.');
  try {
    const warpPayload = confirmUnsafe => ({ points: state.map, estimatedBpm: Number($('#detectedBpm').textContent),
        confidence: state.project.analysis?.confidence, engine: state.project.analysis?.engine, settings: {
        targetBpm: Math.round(Number($('#targetBpm').value))
      }, sourceDuration: state.buffer?.duration || state.master.duration,
      alignment: alignmentPlan(), modules: moduleFlags(), alignmentReviewed: alignmentReviewed || state.alignmentConfirmed, confirmUnsafe });
    const saveWarpMap = confirmUnsafe => request(`/music/ai-quantizer/api/projects/${state.project.id}/warp-map`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(warpPayload(confirmUnsafe))
    });
    try {
      state.project = await saveWarpMap(false);
    } catch (error) {
      if (!error.message.startsWith('CONFERMA_WARP:')) throw error;
      const warning = error.message.replace('CONFERMA_WARP:', '').trim();
      if (!confirm(tr(`${warning}. La correzione può produrre artefatti udibili. Procedere comunque?`))) {
        toast('Quantizzazione annullata');
        return;
      }
      state.project = await saveWarpMap(true);
    }
    state.master = state.project.tracks.find(t => t.role === 'master');
    renderTracks(); renderLoudness(); renderAiDetection();
    state.project = await request(`/music/ai-quantizer/api/projects/${state.project.id}/process`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ all: true })
    });
    state.master = state.project.tracks.find(t => t.role === 'master');
    state.quantizeDirty = false; state.alignmentDirty = false;
    state.restorationDirty = false; state.masteringDirty = false;
    state.alignmentConfirmed = Boolean(state.project.workflow?.alignmentReviewed || !$('#moduleAlign').checked);
    state.project.loudness = null;
    state.master.mastered = null;
    state.mapVariant = 'output';
    setVariant('output'); renderTracks(); renderLoudness(); renderAiDetection(); draw();
    toast('Master e stem quantizzati sulla stessa timeline');
    return true;
  } catch (e) { toast(e.message, true); } finally { busy(false); }
}

async function applyAlignment() {
  if (!allTracksProcessed()) return toast('Quantizza prima tutte le tracce', true);
  busy(true, 'Applicazione allineamento', 'Sposto i WAV già quantizzati sulla griglia DAW. La quantizzazione non viene ripetuta.');
  try {
    state.project = await request(`/music/ai-quantizer/api/projects/${state.project.id}/alignment`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ alignment: alignmentPlan(), modules: moduleFlags() })
    });
    state.master = state.project.tracks.find(track => track.role === 'master');
    state.alignmentDirty = false; state.alignmentConfirmed = true;
    state.restorationDirty = false; state.masteringDirty = false;
    state.mapVariant = 'output';
    setVariant('output'); renderTracks(); renderLoudness(); renderAiDetection(); draw(); drawAlignment();
    toast($('#moduleAlign').checked ? 'Allineamento applicato senza ripetere la quantizzazione' : 'Allineamento rimosso');
    return true;
  } catch (error) { toast(error.message, true); return false; }
  finally { busy(false); }
}

function spotifyStatus(metrics) {
  if (!metrics) return 'Non misurato';
  const playback = metrics.spotifyPlaybackGain;
  const action = Math.abs(playback) < .05 ? 'nessuna normalizzazione' : `${playback > 0 ? '+' : ''}${playback.toFixed(1)} dB in riproduzione`;
  return `${metrics.spotifyCompliant ? '✓ Conforme' : '⚠ True Peak oltre consiglio'} · Spotify: ${action}`;
}

function renderLoudness() {
  const pre = state.project?.loudness?.preMaster, post = state.project?.loudness?.postMaster;
  $('#preLufs').textContent = pre ? `${pre.integratedLufs.toFixed(1)} LUFS` : '— LUFS';
  $('#prePeak').textContent = pre ? `${pre.truePeakDbtp.toFixed(2)} dBTP` : '— dBTP';
  $('#preSpotify').textContent = spotifyStatus(pre);
  $('#postLufs').textContent = post ? `${post.integratedLufs.toFixed(1)} LUFS` : '— LUFS';
  $('#postPeak').textContent = post ? `${post.truePeakDbtp.toFixed(2)} dBTP` : '— dBTP';
  $('#postSpotify').textContent = spotifyStatus(post);
  if (pre && !state.project?.mastering) $('#limiterCeiling').value = pre.recommendedTruePeak;
  $('#masterPlayer').src = state.master?.mastered ? audioUrl(state.master, 'mastered') : '';
}

async function measureLoudness() {
  if (!state.master?.output) return toast('Quantizza prima il master', true);
  busy(true, 'Misurazione loudness', 'Analizzo LUFS integrati e True Peak secondo ITU-R BS.1770.');
  try {
    state.project = await request(`/music/ai-quantizer/api/projects/${state.project.id}/loudness`, { method: 'POST' });
    state.master = state.project.tracks.find(t => t.role === 'master'); renderLoudness(); toast('Misurazione completata');
  } catch (e) { toast(e.message, true); } finally { busy(false); }
}

async function renderMaster() {
  if (!state.master?.output) return toast('Quantizza prima il master', true);
  busy(true, 'Mastering ISP', 'Applico gain, oversampling 4×, limiter e rimisuro il risultato.');
  try {
    state.project = await request(`/music/ai-quantizer/api/projects/${state.project.id}/master`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({
        gainDb: Number($('#masterGain').value), limiterEnabled: $('#limiterEnabled').checked,
        ceilingDbtp: Number($('#limiterCeiling').value), releaseMs: Number($('#limiterRelease').value)
      })
    });
    state.master = state.project.tracks.find(t => t.role === 'master'); state.masteringDirty = false; renderLoudness(); renderTracks(); toast('Master finale completato');
  } catch (e) { toast(e.message, true); } finally { busy(false); }
}

function renderAiDetection() {
  const labels = { original: 'Originale', quantized: 'Quantizzato + DAW', restored: 'Restaurato', mastered: 'Master finale' };
  const data = state.project?.aiDetection || {};
  $('#aiStageCards').innerHTML = Object.entries(labels).map(([key, label]) => {
    const item = data[key], value = item?.aiProbability;
    const available = key === 'original' ? Boolean(state.master?.source)
      : key === 'quantized' ? Boolean(state.master?.output)
      : key === 'restored' ? Boolean(state.master?.restored)
      : Boolean(state.master?.mastered);
    const status = available ? 'Non analizzato' : 'Passaggio non creato';
    const hint = available ? 'Esegui analisi' : key === 'restored' ? 'Crea prima il restauro' : 'Completa prima il passaggio';
    return `<div class="ai-score-card"><span>${label}</span><div class="ai-ring" style="--score:${value || 0}"><strong>${value == null ? '—' : value.toFixed(1)}<small>%</small></strong></div>
      <b>${item?.classification || status}</b><small>${Number.isFinite(item?.confidence) ? `Confidenza ${item.confidence.toFixed(1)}%` : hint}</small></div>`;
  }).join('');
}

async function detectAi() {
  busy(true, 'AI music forensics', 'Analizzo separatamente ogni file disponibile nella pipeline.');
  try {
    state.project = await request(`/music/ai-quantizer/api/projects/${state.project.id}/ai-detection`, { method: 'POST' });
    state.master = state.project.tracks.find(t => t.role === 'master'); renderAiDetection(); toast('Analisi AI completata');
  } catch (e) { toast(e.message, true); } finally { busy(false); }
}

async function renderRestoration() {
  if (!state.master?.output) return toast('Quantizza prima il master', true);
  busy(true, 'Audio Restoration', 'Pulisco gli artefatti ed elaboro la versione ad alta definizione.');
  try {
    state.project = await request(`/music/ai-quantizer/api/projects/${state.project.id}/restore`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({
        clean: $('#restoreClean').checked, declip: $('#restoreDeclip').checked,
        bandwidth: $('#restoreBandwidth').checked, intensity: Number($('#restoreIntensity').value)
      })
    });
    state.master = state.project.tracks.find(t => t.role === 'master');
    state.restorationDirty = false; state.masteringDirty = false;
    setRestoreVariant('restored'); renderTracks(); renderLoudness(); renderAiDetection(); toast('Restauro completato');
  } catch (e) { toast(e.message, true); } finally { busy(false); }
}

function setRestoreVariant(variant) {
  if (variant === 'restored' && !state.master?.restored) return toast('Crea prima la versione restaurata', true);
  $$('.restore-listen').forEach(b => b.classList.toggle('active', b.dataset.restoreVariant === variant));
  $('#restorationPlayer').src = audioUrl(state.master, variant);
}

function refreshRestoration() {
  if (!state.master) return;
  const selected = $('.restore-listen.active')?.dataset.restoreVariant || 'output';
  const variant = selected === 'restored' && state.master.restored
    ? 'restored'
    : state.master.output ? 'output' : 'source';
  $$('.restore-listen').forEach(b => b.classList.toggle('active', b.dataset.restoreVariant === variant));
  const player = $('#restorationPlayer');
  const nextUrl = audioUrl(state.master, variant);
  if (player.getAttribute('src') !== nextUrl) player.src = nextUrl;
}

function refreshModule(name) {
  if (!state.project) return;
  if (name === 'quantize') draw();
  else if (name === 'align') drawAlignment();
  else if (name === 'restoration') refreshRestoration();
  else if (name === 'mastering') renderLoudness();
  else if (name === 'export') { renderLoudness(); renderAiDetection(); }
}

function refreshVisibleModule(name) {
  requestAnimationFrame(() => requestAnimationFrame(() => {
    const stage = $(`.module-stage[data-stage="${name}"]`);
    if (stage?.classList.contains('active')) refreshModule(name);
  }));
}

const WORKFLOW_ORDER = ['import', 'quantize', 'align', 'restoration', 'mastering', 'export'];

function allTracksProcessed() {
  return Boolean(state.project?.tracks?.length)
    && state.project.tracks.every(track => Boolean(track.output));
}

function workflowReady(name) {
  if (name === 'import') return Boolean(state.master);
  if (name === 'quantize') return allTracksProcessed() && !state.quantizeDirty;
  if (name === 'align') {
    if (!$('#moduleAlign').checked) return allTracksProcessed();
    const reviewed = state.alignmentConfirmed === true;
    return allTracksProcessed() && reviewed && !state.alignmentDirty;
  }
  if (name === 'restoration') return !$('#moduleRestoration').checked || Boolean(state.master?.restored && !state.restorationDirty);
  if (name === 'mastering') return !$('#moduleMastering').checked || Boolean(state.master?.mastered && !state.masteringDirty);
  return true;
}

function workflowGateMessage(name) {
  return {
    import: 'Importa e analizza una traccia master prima di continuare.',
    quantize: 'Quantizza tutte le tracce con le impostazioni correnti prima di continuare.',
    align: 'Applica l’allineamento oppure scegli esplicitamente di saltarlo.',
    restoration: 'Crea la versione restaurata oppure scegli “Salta restauro”.',
    mastering: 'Crea il master finale oppure scegli “Salta mastering”.'
  }[name] || 'Completa il passaggio corrente prima di continuare.';
}

function canOpenWorkflowStage(name) {
  const currentName = $('.module-stage.active')?.dataset.stage || 'import';
  const currentIndex = WORKFLOW_ORDER.indexOf(currentName);
  const targetIndex = WORKFLOW_ORDER.indexOf(name);
  if (targetIndex <= currentIndex) return true;
  for (let index = 0; index < targetIndex; index += 1) {
    const step = WORKFLOW_ORDER[index];
    if (!workflowReady(step)) {
      toast(workflowGateMessage(step), true);
      return false;
    }
  }
  return true;
}

function showModule(name) {
  const next = $(`.module-stage[data-stage="${name}"]`);
  if (!next || !canOpenWorkflowStage(name)) return false;
  const current = $('.module-stage.active');
  $$('audio').forEach(player => player.pause());
  current?.classList.remove('active', 'flip-out', 'flip-in');
  next.classList.add('active');
  $$('.module-tab').forEach(tab => {
    const active = tab.dataset.module === name;
    tab.classList.toggle('active', active);
    if (active) tab.setAttribute('aria-current', 'step');
    else tab.removeAttribute('aria-current');
  });
  updateWorkflow();
  refreshVisibleModule(name);
  requestAnimationFrame(() => {
    const heading = next.querySelector('.stage-heading') || next;
    heading.setAttribute('tabindex', '-1'); heading.focus({ preventScroll: true });
    heading.scrollIntoView({ behavior: window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' });
  });
  return true;
}

function moduleFlags() {
  return {
    quantize: $('#moduleQuantize').checked, align: $('#moduleAlign').checked,
    restoration: $('#moduleRestoration').checked,
    mastering: $('#moduleMastering').checked, ai: $('#moduleAi').checked
  };
}

function syncModules() {
  $('#alignEnabled').disabled = !state.master;
  $('#renderRestoration').disabled = !$('#moduleRestoration').checked;
  $('#renderMaster').disabled = !$('#moduleMastering').checked;
  $('#detectAi').disabled = !$('#moduleAi').checked;
  updateWorkflow();
}

function updateWorkflow() {
  const optional = {
    quantize: $('#moduleQuantize').checked,
    align: $('#moduleAlign').checked,
    restoration: $('#moduleRestoration').checked,
    mastering: $('#moduleMastering').checked
  };
  $$('.module-tab').forEach(tab => {
    const name = tab.dataset.module;
    const skipped = name in optional && !optional[name];
    tab.classList.toggle('complete', name !== 'export' && workflowReady(name));
    tab.classList.toggle('skipped', skipped);
    tab.disabled = name !== 'import' && !state.master;
  });
  $$('.module-stage').forEach(stage => {
    const enabled = optional[stage.dataset.stage];
    stage.classList.toggle('step-skipped', enabled === false);
  });
  $('#applyAlignment').disabled = !state.master || !$('#alignEnabled').checked;
  $$('.workflow-next').forEach(button => {
    const name = button.closest('.module-stage').dataset.stage;
    const ready = workflowReady(name);
    button.setAttribute('aria-disabled', String(!ready));
    button.title = ready ? '' : workflowGateMessage(name);
    button.classList.toggle('primary', ready); button.classList.toggle('secondary', !ready);
    const execute = button.closest('.workflow-actions').querySelector('.step-primary-action');
    if (execute) { execute.classList.toggle('primary', !ready); execute.classList.toggle('secondary', ready); }
  });
}

async function persistModuleChoice(input) {
  const moduleName = input.id.replace('module', '').toLowerCase();
  const previousAlignment = $('#alignEnabled').checked;
  if (moduleName === 'align' && !input.checked) $('#alignEnabled').checked = false;
  syncModules();
  const saved = await saveModuleSettings();
  if (!saved) { $('#alignEnabled').checked = previousAlignment; updateWorkflow(); return false; }
  if (moduleName === 'quantize' && input.checked) {
    state.quantizeDirty = true; state.alignmentConfirmed = false; rebuildMap();
  }
  if (!input.checked && (moduleName === 'quantize' || moduleName === 'align')) {
    if (moduleName === 'align') state.alignmentConfirmed = true;
    if (moduleName === 'align' && state.master?.alignment) {
      if (!await applyAlignment()) return false;
    } else if (!allTracksProcessed()) {
      const processed = await saveAndProcess();
      if (processed !== true) return false;
    }
  }
  updateWorkflow();
  return true;
}

function renderTracks() {
  if (!state.project) return;
  $('#trackList').innerHTML = state.project.tracks.map(t => `<div class="track">
    <span class="track-icon">${t.role === 'master' ? '◆' : '≋'}</span>
    <div class="track-name"><strong>${escapeHtml(t.name)}</strong><span>${t.role.toUpperCase()} · ${formatTime(t.duration)} · ${t.channels || '?'} CH</span></div>
    ${t.output ? '<span class="badge">QUANTIZZATA</span>' : '<span class="badge" style="opacity:.4">ORIGINALE</span>'}
    ${t.mastered ? `<a class="download" href="${audioUrl(t, 'mastered')}" download="${escapeHtml(t.name.replace(/\.[^.]+$/, ''))}-mastered.wav">Master WAV</a>` :
      t.output ? `<a class="download" href="${audioUrl(t, 'output')}" download="${escapeHtml(t.name.replace(/\.[^.]+$/, ''))}-quantized.wav">Scarica WAV</a>` : '<span></span>'}
  </div>`).join('');
  if ($('#exportTrackList')) $('#exportTrackList').innerHTML = $('#trackList').innerHTML;
  const allReady = state.project.tracks.length > 0
    && state.project.tracks.every(track => Boolean(track.output));
  const downloadAll = $('#downloadAll');
  downloadAll.disabled = exporting || !allReady;
  downloadAll.title = allReady
    ? 'Scarica master e stem in un unico archivio ZIP'
    : 'Completa prima la quantizzazione di tutte le tracce';
  updateWorkflow();
}

function audioUrl(track, variant) { return `/music/ai-quantizer/api/projects/${state.project.id}/audio/${track.id}?variant=${variant}&v=${encodeURIComponent(track.processedAt || '')}`; }
function formatTime(s) { const m = Math.floor(s / 60), sec = Math.floor(s % 60); return `${m}:${String(sec).padStart(2, '0')}`; }
function setVariant(variant) {
  if (variant === 'output' && !state.master?.output) return toast('Genera prima il risultato', true);
  state.variant = variant; $$('.ab-switch button').forEach(b => b.classList.toggle('active', b.dataset.variant === variant));
  const current = $('#player').currentTime; $('#player').pause(); $('#player').src = audioUrl(state.master, variant); $('#player').currentTime = current;
}

$('#newProject').onclick = $('#emptyNew').onclick = createProject;
$('#masterInput').onchange = e => upload([...e.target.files], 'master');
$('#stemInput').onchange = e => upload([...e.target.files], 'stem');
$('#analyze').onclick = analyze;
$('#processMaster').onclick = saveAndProcess;
$('#processAll').onclick = () => showModule('quantize');
$('#downloadAll').onclick = downloadArchive;
$('#applyAlignment').onclick = applyAlignment;
$$('[data-map-variant]').forEach(button => button.onclick = () => {
  if (button.dataset.mapVariant === 'output' && !state.master?.output) return toast('Genera prima il risultato', true);
  state.mapVariant = button.dataset.mapVariant;
  draw();
});
$('#targetBpm').onchange = () => {
  state.quantizeDirty = true; state.alignmentConfirmed = false;
  if (state.project.workflow) state.project.workflow.alignmentReviewed = false;
  rebuildMap(); updateWorkflow();
};
$('#measureLoudness').onclick = measureLoudness;
$('#renderMaster').onclick = renderMaster;
$('#detectAi').onclick = detectAi;
$('#renderRestoration').onclick = renderRestoration;
$('#restoreIntensity').oninput = e => $('#restoreIntensityValue').textContent = `${e.target.value}%`;
['restoreClean', 'restoreDeclip', 'restoreBandwidth', 'restoreIntensity'].forEach(id => $(`#${id}`).addEventListener('input', () => {
  state.restorationDirty = true; updateWorkflow();
}));
['masterGain', 'limiterEnabled', 'limiterCeiling', 'limiterRelease'].forEach(id => $(`#${id}`).addEventListener('input', () => {
  state.masteringDirty = true; updateWorkflow();
}));
$$('.restore-listen').forEach(button => button.onclick = () => setRestoreVariant(button.dataset.restoreVariant));
$$('.module-tab').forEach(tab => tab.onclick = () => showModule(tab.dataset.module));
$$('.step-switch input').forEach(input => input.onchange = () => persistModuleChoice(input));
$$('.workflow-next').forEach(button => button.onclick = () => {
  const start = WORKFLOW_ORDER.indexOf(button.dataset.next);
  const next = WORKFLOW_ORDER.slice(start).find(name => {
    const input = $(`#module${name[0].toUpperCase()}${name.slice(1)}`);
    return !input || input.checked;
  }) || 'export';
  showModule(next);
});
$$('.workflow-back').forEach(button => button.onclick = () => showModule(button.dataset.back));
$$('.workflow-skip').forEach(button => button.onclick = async () => {
  const input = $(`#module${button.dataset.skip[0].toUpperCase()}${button.dataset.skip.slice(1)}`);
  input.checked = false;
  if (!await persistModuleChoice(input)) return;
  const start = WORKFLOW_ORDER.indexOf(button.dataset.skip) + 1;
  const next = WORKFLOW_ORDER.slice(start).find(name => {
    const candidate = $(`#module${name[0].toUpperCase()}${name.slice(1)}`);
    return !candidate || candidate.checked;
  }) || 'export';
  showModule(next);
});
['alignEnabled', 'alignMode', 'fadeSeconds'].forEach(id => $(`#${id}`).oninput = () => {
  if (id === 'alignEnabled' && $('#alignEnabled').checked) $('#moduleAlign').checked = true;
  state.alignmentDirty = true; state.alignmentConfirmed = false; drawAlignment(); updateWorkflow();
});
$$('.ab-switch button').forEach(b => b.onclick = () => setVariant(b.dataset.variant));
$('#deleteProject').onclick = async () => {
  if (!confirm(tr(`Eliminare definitivamente “${state.project.name}”?`))) return;
  await request(`/music/ai-quantizer/api/projects/${state.project.id}`, { method: 'DELETE' }); state.project = null;
  $('#workspace').classList.add('hidden'); $('#emptyState').classList.remove('hidden'); await loadProjects();
};
const drop = $('#masterDrop');
['dragenter', 'dragover'].forEach(type => drop.addEventListener(type, e => { e.preventDefault(); drop.classList.add('drag'); }));
['dragleave', 'drop'].forEach(type => drop.addEventListener(type, e => { e.preventDefault(); drop.classList.remove('drag'); }));
drop.addEventListener('drop', e => upload([...e.dataTransfer.files], 'master'));
$('#waveform').onclick = e => {
  if (state.mapVariant === 'output' && state.master?.output) return;
  if (!state.buffer) return;
  const time = e.offsetX / e.currentTarget.clientWidth * state.buffer.duration;
  if (e.altKey) {
    if (state.beats.length) state.beats.splice(state.beats.reduce((best, v, i) => Math.abs(v - time) < Math.abs(state.beats[best] - time) ? i : best, 0), 1);
  } else state.beats.push(time);
  state.quantizeDirty = true;
  state.alignmentConfirmed = false;
  if (state.project.workflow) state.project.workflow.alignmentReviewed = false;
  state.beats.sort((a, b) => a - b); rebuildMap(); updateWorkflow();
};
window.onresize = () => {
  const active = $('.module-stage.active')?.dataset.stage;
  if (active) refreshVisibleModule(active);
};

Promise.all([loadProjects(), request('/music/ai-quantizer/api/health')]).then(([, health]) => {
  $('#engineDot').classList.toggle('ok', health.ok);
  $('#engineText').textContent = health.ok ? 'Pronto · R3 quality' : 'Tool mancanti';
}).catch(e => toast(e.message, true));
