/* global document, window, fetch, clearTimeout, setTimeout, confirm, prompt, AudioContext, devicePixelRatio, requestAnimationFrame */
const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
const tr = value => window.AIQ_I18N?.translate(value) || value;
const state = { projects: [], project: null, master: null, buffer: null, peaks: [], beats: [], downbeats: [], map: [], variant: 'source' };

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
  $('#busyTitle').textContent = title; $('#busyText').textContent = text;
  $('#busy').classList.toggle('hidden', !on);
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
  $('#editor').classList.toggle('hidden', !state.master);
  renderTracks(); await loadProjects();
  renderLoudness();
  renderAiDetection();
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
  const w = rect.width, h = 270, mid = h / 2, duration = state.buffer?.duration || 1;
  ctx.fillStyle = '#0b0e14'; ctx.fillRect(0, 0, w, h);
  ctx.strokeStyle = '#252d38'; ctx.lineWidth = 1;
  for (let i = 1; i < 8; i++) { const x = w * i / 8; ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke(); }
  ctx.beginPath(); ctx.strokeStyle = '#526070'; ctx.lineWidth = 1;
  state.peaks.forEach((p, i) => { const x = i / state.peaks.length * w, amp = p * h * .42; ctx.moveTo(x, mid - amp); ctx.lineTo(x, mid + amp); });
  ctx.stroke();
  state.map.slice(1, -1).forEach((p, i) => {
    const x = p.source / duration * w, prev = state.map[i], local = Math.abs((p.target - prev.target) / Math.max(.001, p.source - prev.source) - 1);
    ctx.strokeStyle = local > .08 ? '#ff627d' : local > .04 ? '#ffd166' : '#55dfea'; ctx.lineWidth = local > .08 ? 2 : 1;
    ctx.beginPath(); ctx.moveTo(x, 15); ctx.lineTo(x, h - 15); ctx.stroke();
    const tx = p.target / Math.max(duration, state.map.at(-1)?.target || duration) * w;
    ctx.fillStyle = '#c9ff45'; ctx.fillRect(tx - 1, h - 15, 2, 9);
  });
}

function sourceToTarget(time) {
  if (!state.map.length) return time;
  for (let i = 1; i < state.map.length; i++) {
    const a = state.map[i - 1], b = state.map[i];
    if (time <= b.source) {
      const ratio = (time - a.source) / Math.max(.000001, b.source - a.source);
      return a.target + ratio * (b.target - a.target);
    }
  }
  const last = state.map.at(-1);
  return last.target + time - last.source;
}

function alignmentPlan() {
  const enabled = $('#alignEnabled').checked;
  const bpm = Math.round(Number($('#targetBpm').value) || 120);
  const barDuration = 240 / bpm;
  const referenceSource = state.downbeats[0] ?? state.beats[0] ?? 0;
  const referenceTarget = sourceToTarget(referenceSource);
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
    const warpedTime = sourceToTarget(i / state.peaks.length * state.buffer.duration) + plan.shiftSeconds;
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

async function saveAndProcess() {
  if (state.map.length < 2) return toast('Analizza prima il brano', true);
  busy(true, 'Quantizzazione di master e stem', 'Applico a tutte le tracce una sola timeline, conservando il pitch.');
  try {
    const warpPayload = confirmUnsafe => ({ points: state.map, estimatedBpm: Number($('#detectedBpm').textContent),
        confidence: state.project.analysis?.confidence, engine: state.project.analysis?.engine, settings: {
        targetBpm: Math.round(Number($('#targetBpm').value))
      }, sourceDuration: state.buffer?.duration || state.master.duration,
      alignment: alignmentPlan(), modules: moduleFlags(), confirmUnsafe });
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
    state.project.loudness = null;
    state.master.mastered = null;
    state.variant = 'output'; setVariant('output'); renderTracks();
    toast('Master e stem quantizzati sulla stessa timeline');
  } catch (e) { toast(e.message, true); } finally { busy(false); }
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
    state.master = state.project.tracks.find(t => t.role === 'master'); renderLoudness(); renderTracks(); toast('Master finale completato');
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
    setRestoreVariant('restored'); renderTracks(); renderAiDetection(); toast('Restauro completato');
  } catch (e) { toast(e.message, true); } finally { busy(false); }
}

function setRestoreVariant(variant) {
  if (variant === 'restored' && !state.master?.restored) return toast('Crea prima la versione restaurata', true);
  $$('.restore-listen').forEach(b => b.classList.toggle('active', b.dataset.restoreVariant === variant));
  $('#restorationPlayer').src = audioUrl(state.master, variant);
  $('#restorationPlayer').play().catch(() => {});
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
  else if (name === 'ai') renderAiDetection();
}

function refreshVisibleModule(name) {
  requestAnimationFrame(() => requestAnimationFrame(() => {
    const stage = $(`.module-stage[data-stage="${name}"]`);
    if (stage?.classList.contains('active')) refreshModule(name);
  }));
}

function showModule(name) {
  const enabled = $(`#module${name[0].toUpperCase()}${name.slice(1)}`)?.checked;
  if (enabled === false) {
    const tabs = $$('.module-tab').filter(t => t.querySelector('input').checked);
    return tabs[0] && showModule(tabs[0].dataset.module);
  }
  const current = $('.module-stage.active'), next = $(`.module-stage[data-stage="${name}"]`);
  if (!next) return;
  if (current === next) {
    refreshVisibleModule(name);
    return;
  }
  current?.classList.add('flip-out');
  setTimeout(() => {
    current?.classList.remove('active', 'flip-out');
    next.classList.add('active', 'flip-in');
    refreshVisibleModule(name);
    next.addEventListener('animationend', () => next.classList.remove('flip-in'), { once: true });
    next.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, 260);
  $$('.module-tab').forEach(t => t.classList.toggle('active', t.dataset.module === name));
}

function moduleFlags() {
  return {
    quantize: $('#moduleQuantize').checked, align: $('#moduleAlign').checked,
    restoration: $('#moduleRestoration').checked,
    mastering: $('#moduleMastering').checked, ai: $('#moduleAi').checked
  };
}

function syncModules() {
  $$('.module-tab').forEach(tab => {
    const enabled = tab.querySelector('input').checked;
    tab.classList.toggle('disabled', !enabled);
    const stage = $(`.module-stage[data-stage="${tab.dataset.module}"]`);
    if (!enabled && stage?.classList.contains('active')) {
      const fallback = $$('.module-tab').find(t => t.querySelector('input').checked);
      if (fallback) showModule(fallback.dataset.module);
    }
  });
  $('#alignEnabled').disabled = !$('#moduleAlign').checked;
  $('#renderRestoration').disabled = !$('#moduleRestoration').checked;
  $('#renderMaster').disabled = !$('#moduleMastering').checked;
  $('#detectAi').disabled = !$('#moduleAi').checked;
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
  const allReady = state.project.tracks.length > 0
    && state.project.tracks.every(track => Boolean(track.output));
  const downloadAll = $('#downloadAll');
  downloadAll.disabled = !allReady;
  downloadAll.title = allReady
    ? 'Scarica master e stem in un unico archivio ZIP'
    : 'Completa prima la quantizzazione di tutte le tracce';
}

function audioUrl(track, variant) { return `/music/ai-quantizer/api/projects/${state.project.id}/audio/${track.id}?variant=${variant}&v=${encodeURIComponent(track.processedAt || '')}`; }
function formatTime(s) { const m = Math.floor(s / 60), sec = Math.floor(s % 60); return `${m}:${String(sec).padStart(2, '0')}`; }
function setVariant(variant) {
  if (variant === 'output' && !state.master?.output) return toast('Genera prima il risultato', true);
  state.variant = variant; $$('.ab-switch button').forEach(b => b.classList.toggle('active', b.dataset.variant === variant));
  const current = $('#player').currentTime; $('#player').src = audioUrl(state.master, variant); $('#player').currentTime = current; $('#player').play().catch(() => {});
}

$('#newProject').onclick = $('#emptyNew').onclick = createProject;
$('#masterInput').onchange = e => upload([...e.target.files], 'master');
$('#stemInput').onchange = e => upload([...e.target.files], 'stem');
$('#analyze').onclick = analyze;
$('#processMaster').onclick = saveAndProcess;
$('#processAll').onclick = saveAndProcess;
$('#downloadAll').onclick = () => {
  if (!state.project?.tracks.length || state.project.tracks.some(track => !track.output))
    return toast('Completa prima la quantizzazione di tutte le tracce', true);
  window.location.assign(`/music/ai-quantizer/api/projects/${state.project.id}/download-all`);
};
$('#targetBpm').onchange = rebuildMap;
$('#measureLoudness').onclick = measureLoudness;
$('#renderMaster').onclick = renderMaster;
$('#detectAi').onclick = detectAi;
$('#renderRestoration').onclick = renderRestoration;
$('#restoreIntensity').oninput = e => $('#restoreIntensityValue').textContent = `${e.target.value}%`;
$$('.restore-listen').forEach(button => button.onclick = () => setRestoreVariant(button.dataset.restoreVariant));
$$('.module-tab').forEach(tab => tab.onclick = e => {
  if (e.target.closest('.mini-toggle')) return;
  showModule(tab.dataset.module);
});
$$('.mini-toggle input').forEach(input => input.onchange = syncModules);
$$('.next-module').forEach(button => button.onclick = () => {
  const order = ['quantize', 'align', 'restoration', 'mastering', 'ai'];
  const start = order.indexOf(button.dataset.next);
  const next = order.slice(start).find(name => $(`#module${name[0].toUpperCase()}${name.slice(1)}`).checked);
  if (next) showModule(next); else toast('Non ci sono altri moduli attivi');
});
['alignEnabled', 'alignMode', 'fadeSeconds'].forEach(id => $(`#${id}`).oninput = drawAlignment);
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
  if (!state.buffer) return;
  const time = e.offsetX / e.currentTarget.clientWidth * state.buffer.duration;
  if (e.altKey) {
    if (state.beats.length) state.beats.splice(state.beats.reduce((best, v, i) => Math.abs(v - time) < Math.abs(state.beats[best] - time) ? i : best, 0), 1);
  } else state.beats.push(time);
  state.beats.sort((a, b) => a - b); rebuildMap();
};
window.onresize = () => {
  const active = $('.module-stage.active')?.dataset.stage;
  if (active) refreshVisibleModule(active);
};

Promise.all([loadProjects(), request('/music/ai-quantizer/api/health')]).then(([, health]) => {
  $('#engineDot').classList.toggle('ok', health.ok);
  $('#engineText').textContent = health.ok ? 'Pronto · R3 quality' : 'Tool mancanti';
}).catch(e => toast(e.message, true));
