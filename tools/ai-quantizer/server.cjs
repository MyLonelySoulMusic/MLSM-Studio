/* eslint-disable @typescript-eslint/no-require-imports, no-undef, no-empty */
const http = require('http');
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { spawn, spawnSync } = require('child_process');
const { resolveTool } = require('../platform_tools.cjs');
const rhythm = require('./public/rhythm.cjs');

const ROOT = __dirname;
const PUBLIC = path.join(ROOT, 'public');
const PROJECTS = process.env.AIQ_DATA_ROOT || path.join(ROOT, 'data', 'projects');
const PYTHON = process.env.AIQ_PYTHON || path.resolve(ROOT, '..', '..', '.venv-ai-quantizer', 'bin', 'python');
const PORT = Number(process.env.PORT || 4173);
const MAX_UPLOAD = 1024 * 1024 * 1024;
const PROCESS_SAMPLE_RATE = 48000;
const UNQUANTIZABLE_ERROR = 'Il brano non è quantizzabile automaticamente';
const FFMPEG = resolveTool('ffmpeg');
const FFPROBE = resolveTool('ffprobe');
const RUBBERBAND = resolveTool('rubberband');
const activeChildren = new Set();

function spawnTracked(command, args, options = {}) {
  const child = spawn(command, args, { ...options, detached: process.platform !== 'win32' });
  activeChildren.add(child);
  const release = () => activeChildren.delete(child);
  child.once('close', release);
  child.once('error', release);
  return child;
}

function terminateChildren() {
  for (const child of activeChildren) {
    if (!child.pid || child.exitCode !== null) continue;
    try {
      if (process.platform === 'win32') spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
      else process.kill(-child.pid, 'SIGTERM');
    } catch { child.kill('SIGTERM'); }
  }
  activeChildren.clear();
}

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.cjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.wav': 'audio/wav', '.mp3': 'audio/mpeg', '.flac': 'audio/flac',
  '.m4a': 'audio/mp4', '.aac': 'audio/aac', '.ogg': 'audio/ogg',
  '.zip': 'application/zip'
};

function json(res, status, value) {
  const body = Buffer.from(JSON.stringify(value));
  res.writeHead(status, { 'Content-Type': MIME['.json'], 'Content-Length': body.length });
  res.end(body);
}

function safeId(value) {
  if (!/^[a-zA-Z0-9_-]+$/.test(value || '')) throw new Error('Identificatore non valido');
  return value;
}

function cleanName(value) {
  const base = path.basename(value || 'audio.wav');
  return base.replace(/[^\p{L}\p{N}._ -]/gu, '_').slice(0, 160) || 'audio.wav';
}

function projectDir(id) { return path.join(PROJECTS, safeId(id)); }
function manifestPath(id) { return path.join(projectDir(id), 'project.json'); }

async function readManifest(id) {
  const project = JSON.parse(await fsp.readFile(manifestPath(id), 'utf8'));
  normalizeTargetBpm(project);
  reconcilePipeline(project);
  return project;
}

async function writeManifest(project) {
  normalizeTargetBpm(project);
  project.updatedAt = new Date().toISOString();
  await fsp.writeFile(manifestPath(project.id), JSON.stringify(project, null, 2));
}

function normalizeTargetBpm(project) {
  project.settings ||= {};
  const halfTime = project.settings.tempoInterpretation === 'half';
  const value = Number(project.settings.targetBpm);
  project.settings.targetBpm = Math.round(Math.max(halfTime ? 20 : 40,
    Math.min(halfTime ? 120 : 240, Number.isFinite(value) && value > 0 ? value : 120)));
}

function clearAiStages(project, stages) {
  if (!project.aiDetection) return;
  for (const stage of stages) delete project.aiDetection[stage];
}

function invalidateAfterQuantize(project, track) {
  track.restored = null;
  track.restoredAt = null;
  track.restoredDerivedFrom = null;
  track.mastered = null;
  track.masteredAt = null;
  track.masteredDerivedFrom = null;
  delete project.restoration;
  delete project.mastering;
  project.loudness = null;
  clearAiStages(project, ['quantized', 'restored', 'mastered']);
}

function invalidateFromWarpMap(project) {
  for (const track of project.tracks || []) {
    track.output = null;
    track.processedAt = null;
    track.outputDerivedFrom = null;
    track.outputDuration = null;
    track.alignment = null;
    track.quantizedBase = null;
    track.restored = null;
    track.restoredAt = null;
    track.restoredDerivedFrom = null;
    track.mastered = null;
    track.masteredAt = null;
    track.masteredDerivedFrom = null;
  }
  delete project.restoration;
  delete project.mastering;
  project.loudness = null;
  clearAiStages(project, ['quantized', 'restored', 'mastered']);
}

function normalizedAlignment(input = {}) {
  const shift = Number(input.shiftSeconds);
  const fade = Number(input.fadeSeconds);
  const enabled = Boolean(input.enabled);
  return {
    enabled,
    mode: ['auto', 'forward', 'backward'].includes(input.mode) ? input.mode : 'auto',
    resolvedDirection: enabled && shift > .0005 ? 'forward' : enabled && shift < -.0005 ? 'backward' : 'none',
    shiftSeconds: enabled && Number.isFinite(shift) ? Math.max(-10, Math.min(10, shift)) : 0,
    fadeSeconds: Number.isFinite(fade) ? Math.max(0, Math.min(10, fade)) : 0,
    referenceSource: Number(input.referenceSource) || 0,
    referenceTarget: Number(input.referenceTarget) || 0,
    gridTarget: Number(input.gridTarget) || 0
  };
}

function alignmentRenderPlan(sourceFrames, alignment) {
  const shiftFrames = alignment?.enabled
    ? Math.round(Number(alignment.shiftSeconds) * PROCESS_SAMPLE_RATE)
    : 0;
  const outputFrames = Math.max(1, sourceFrames + shiftFrames);
  const filters = [];
  if (Math.abs(shiftFrames) > Math.round(PROCESS_SAMPLE_RATE * .0005)) {
    const shift = shiftFrames / PROCESS_SAMPLE_RATE;
    const fade = Math.max(0, Math.min(10, Number(alignment.fadeSeconds) || 0));
    if (shift < 0) {
      filters.push(`atrim=start_sample=${-shiftFrames}`, 'asetpts=N/SR/TB');
      if (fade > 0) filters.push(`afade=t=in:st=0:d=${fade.toFixed(6)}:curve=qsin`);
    } else {
      filters.push(`adelay=${(shift * 1000).toFixed(6)}:all=1`);
      if (fade > 0)
        filters.push(`afade=t=in:st=${shift.toFixed(6)}:d=${fade.toFixed(6)}:curve=qsin`);
    }
  }
  filters.push('apad', `atrim=end_sample=${outputFrames}`, 'asetpts=N/SR/TB');
  return { filters, outputFrames, shiftFrames };
}

function resetForNewMaster(project) {
  project.workflow = {};
  project.analysis = null;
  project.warpMap = null;
  project.alignment = null;
  invalidateFromWarpMap(project);
  project.aiDetection = null;
}

function invalidateAfterRestore(project, track) {
  track.mastered = null;
  track.masteredAt = null;
  track.masteredDerivedFrom = null;
  delete project.mastering;
  project.loudness = null;
  clearAiStages(project, ['restored', 'mastered']);
}

function isOlder(derivedAt, sourceAt) {
  const derived = Date.parse(derivedAt || ''), source = Date.parse(sourceAt || '');
  return Number.isFinite(derived) && Number.isFinite(source) && derived < source;
}

function reconcilePipeline(project) {
  const master = project.tracks?.find(track => track.role === 'master');
  if (!master) return;
  if (master.restored && isOlder(master.restoredAt, master.processedAt)) {
    invalidateAfterQuantize(project, master);
  } else {
    const masteringSourceAt = project.modules?.restoration !== false && master.restored
      ? master.restoredAt : master.processedAt;
    if (master.mastered && isOlder(master.masteredAt, masteringSourceAt)) {
      master.mastered = null;
      master.masteredAt = null;
      master.masteredDerivedFrom = null;
      delete project.mastering;
      if (project.loudness) delete project.loudness.postMaster;
      clearAiStages(project, ['mastered']);
    }
  }
  const stageTimes = {
    quantized: master.processedAt,
    restored: master.restoredAt,
    mastered: master.masteredAt
  };
  for (const [stage, sourceAt] of Object.entries(stageTimes)) {
    if (!sourceAt || isOlder(project.aiDetection?.[stage]?.analyzedAt, sourceAt)) {
      clearAiStages(project, [stage]);
    }
  }
}

async function bodyJson(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 5 * 1024 * 1024) throw new Error('Richiesta troppo grande');
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
}

function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawnTracked(command, args, options);
    let stderr = '';
    child.stderr.on('data', d => { stderr += d; });
    child.on('error', reject);
    child.on('close', code => code === 0 ? resolve() :
      reject(new Error(`${command} non riuscito: ${stderr.slice(-1200)}`)));
  });
}

function runCapture(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawnTracked(command, args);
    let stdout = '', stderr = '';
    child.stdout.on('data', d => { stdout += d; });
    child.stderr.on('data', d => { stderr += d; });
    child.on('error', reject);
    child.on('close', code => code === 0 ? resolve({ stdout, stderr }) :
      reject(new Error(`${command} non riuscito: ${stderr.slice(-1600)}`)));
  });
}

async function measureLoudness(file) {
  const { stderr } = await runCapture(FFMPEG, ['-hide_banner', '-nostats', '-i', file,
    '-af', 'loudnorm=I=-14:LRA=50:TP=-1:print_format=json', '-f', 'null', '-']);
  const matches = [...stderr.matchAll(/\{\s*"input_i"[\s\S]*?\}/g)];
  if (!matches.length) throw new Error('Misurazione loudness non disponibile');
  const value = JSON.parse(matches.at(-1)[0]);
  const integrated = Number(value.input_i), truePeak = Number(value.input_tp);
  const spotifyGain = -14 - integrated;
  const maxSafeGain = -1 - truePeak;
  return {
    integratedLufs: integrated, truePeakDbtp: truePeak,
    loudnessRange: Number(value.input_lra), threshold: Number(value.input_thresh),
    spotifyPlaybackGain: spotifyGain <= 0 ? spotifyGain : Math.min(spotifyGain, maxSafeGain),
    spotifyTargetGain: spotifyGain,
    spotifyCompliant: truePeak <= (integrated > -14 ? -2 : -1),
    recommendedTruePeak: integrated > -14 ? -2 : -1,
    measuredAt: new Date().toISOString()
  };
}

function runJson(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawnTracked(command, args, { cwd: ROOT });
    let stdout = '', stderr = '';
    child.stdout.on('data', d => { stdout += d; });
    child.stderr.on('data', d => { stderr += d; });
    child.on('error', reject);
    child.on('close', code => {
      if (code !== 0) return reject(new Error(`Analisi non riuscita: ${stderr.slice(-1600)}`));
      try { resolve(JSON.parse(stdout.trim())); }
      catch { reject(new Error('Il motore di analisi ha restituito dati non validi')); }
    });
  });
}

async function analyzeAiStage(id, project, stage, file, strict = false) {
  if (!file || project.modules?.ai === false) return;
  try {
    project.aiDetection = project.aiDetection || {};
    project.aiDetection[stage] = {
      ...await runJson(PYTHON, [
        path.join(ROOT, 'audio_engine', 'detect_ai.py'), path.join(projectDir(id), file)
      ]),
      derivedFrom: file,
      analyzedAt: new Date().toISOString()
    };
    if (project.aiDetectionErrors) delete project.aiDetectionErrors[stage];
  } catch (error) {
    project.aiDetectionErrors = project.aiDetectionErrors || {};
    project.aiDetectionErrors[stage] = error.message;
    if (strict) throw error;
  }
}

async function probe(file) {
  const result = spawnSync(FFPROBE, [
    '-v', 'error', '-show_entries', 'format=duration:stream=sample_rate,channels',
    '-select_streams', 'a:0', '-of', 'json', file
  ], { encoding: 'utf8' });
  if (result.status !== 0) throw new Error('Il file non contiene audio leggibile');
  const data = JSON.parse(result.stdout);
  return {
    duration: Number(data.format?.duration || 0),
    sampleRate: Number(data.streams?.[0]?.sample_rate || 0),
    channels: Number(data.streams?.[0]?.channels || 0)
  };
}

async function receiveFile(req, destination) {
  await fsp.mkdir(path.dirname(destination), { recursive: true });
  const temp = `${destination}.upload`;
  const output = fs.createWriteStream(temp);
  let size = 0;
  try {
    for await (const chunk of req) {
      size += chunk.length;
      if (size > MAX_UPLOAD) throw new Error('File oltre il limite di 1 GB');
      if (!output.write(chunk)) await new Promise(r => output.once('drain', r));
    }
    await new Promise((resolve, reject) => output.end(err => err ? reject(err) : resolve()));
    await fsp.rename(temp, destination);
  } catch (error) {
    output.destroy();
    await fsp.rm(temp, { force: true });
    throw error;
  }
}

function sharedWarpTimeline(project) {
  const points = project.warpMap?.points;
  if (!Array.isArray(points) || points.length < 2) throw new Error('Beat map insufficiente');
  const configuredDuration = Number(project.warpMap.sourceDuration);
  const masterDuration = Number(project.tracks?.find(track => track.role === 'master')?.duration);
  const lastSource = Number(points.at(-1)?.source);
  const sourceDuration = configuredDuration > 0 ? configuredDuration
    : lastSource > 0 ? lastSource
      : masterDuration;
  if (!Number.isFinite(sourceDuration) || sourceDuration <= 0)
    throw new Error('Durata timeline master non valida');

  const normalized = points
    .map(point => ({ source: Number(point.source), target: Number(point.target) }))
    .filter(point => Number.isFinite(point.source) && Number.isFinite(point.target)
      && point.source >= 0 && point.source <= sourceDuration)
    .sort((a, b) => a.source - b.source);
  if (!normalized.length || normalized[0].source > .5 / PROCESS_SAMPLE_RATE)
    normalized.unshift({ source: 0, target: 0 });

  const last = normalized.at(-1);
  if (last.source < sourceDuration - .5 / PROCESS_SAMPLE_RATE) {
    normalized.push({
      source: sourceDuration,
      target: last.target + sourceDuration - last.source
    });
  } else {
    last.source = sourceDuration;
  }

  const framed = [];
  for (const point of normalized) {
    const sourceFrame = Math.round(point.source * PROCESS_SAMPLE_RATE);
    const targetFrame = Math.max(0, Math.round(point.target * PROCESS_SAMPLE_RATE));
    const previous = framed.at(-1);
    if (previous && (sourceFrame <= previous.sourceFrame || targetFrame <= previous.targetFrame))
      throw new Error(UNQUANTIZABLE_ERROR);
    framed.push({ sourceFrame, targetFrame });
  }
  return {
    sourceFrames: Math.round(sourceDuration * PROCESS_SAMPLE_RATE),
    targetFrames: framed.at(-1).targetFrame,
    points: framed
  };
}

async function processTrack(id, track, project) {
  const dir = projectDir(id);
  const input = path.join(dir, track.source);
  const base = path.parse(track.source).name;
  const converted = path.join(dir, 'work', `${track.id}-input.wav`);
  const outputRel = path.join('outputs', `${base}-quantized.wav`);
  const output = path.join(dir, outputRel);
  const warped = path.join(dir, 'work', `${track.id}-warped.wav`);
  const mapFile = path.join(dir, 'work', `${track.id}-timemap.txt`);
  await fsp.mkdir(path.dirname(converted), { recursive: true });
  await fsp.mkdir(path.dirname(output), { recursive: true });

  const timeline = sharedWarpTimeline(project);
  const sourceDuration = timeline.sourceFrames / PROCESS_SAMPLE_RATE;
  const normalizeFilter = [
    `aresample=${PROCESS_SAMPLE_RATE}`,
    'apad',
    `atrim=end_sample=${timeline.sourceFrames}`,
    'asetpts=N/SR/TB'
  ].join(',');
  await run(FFMPEG, ['-y', '-v', 'error', '-i', input, '-vn', '-af', normalizeFilter,
    '-ar', String(PROCESS_SAMPLE_RATE), '-c:a', 'pcm_f32le', converted]);
  const lines = timeline.points.map(point =>
    `${point.sourceFrame} ${point.targetFrame}`).join('\n');
  await fsp.writeFile(mapFile, `${lines}\n`);
  const targetDuration = timeline.targetFrames / PROCESS_SAMPLE_RATE;
  if (project.modules?.quantize === false) {
    await fsp.copyFile(converted, warped);
  } else {
    await run(RUBBERBAND, ['-q', '-3', '--centre-focus', '-M', mapFile,
      '-D', targetDuration.toFixed(6), converted, warped]);
  }
  const alignment = project.modules?.align !== false && project.alignment?.enabled ? project.alignment : null;
  const effectiveTargetFrames = project.modules?.quantize === false
    ? timeline.sourceFrames
    : timeline.targetFrames;
  const { filters, outputFrames } = alignmentRenderPlan(effectiveTargetFrames, alignment);
  await run(FFMPEG, ['-y', '-v', 'error', '-i', warped, '-af', filters.join(','),
    '-ar', String(PROCESS_SAMPLE_RATE), '-c:a', 'pcm_f32le', output]);
  const outputInfo = await probe(output);
  track.output = outputRel;
  track.processedAt = new Date().toISOString();
  track.outputDerivedFrom = track.source;
  track.outputDuration = outputInfo.duration;
  track.timelineSourceDuration = sourceDuration;
  track.timelineTargetDuration = outputFrames / PROCESS_SAMPLE_RATE;
  track.warpMapSavedAt = project.warpMap.savedAt;
  track.quantizedBase = path.relative(dir, warped);
  track.alignment = alignment ? {
    shiftSeconds: alignment.shiftSeconds, fadeSeconds: alignment.fadeSeconds,
    direction: alignment.resolvedDirection
  } : null;
}

async function applyAlignmentToTrack(id, track, alignment) {
  if (!track.output) throw new Error(`Quantizza prima “${track.name}”`);
  const dir = projectDir(id);
  const output = path.join(dir, track.output);
  let source = track.quantizedBase ? path.join(dir, track.quantizedBase) : null;
  if (source) {
    try { await fsp.access(source); } catch { source = null; }
  }
  let effectiveAlignment = alignment;
  if (!source && Math.abs(Number(track.alignment?.shiftSeconds) || 0) <= .0005) {
    const baseRel = path.join('work', `${track.id}-quantized-base.wav`);
    source = path.join(dir, baseRel);
    await fsp.mkdir(path.dirname(source), { recursive: true });
    await fsp.copyFile(output, source);
    track.quantizedBase = baseRel;
  } else if (!source) {
    // Legacy projects did not retain the pre-alignment WAV. Apply only the delta;
    // this still avoids running Rubber Band or quantizing the track again.
    source = output;
    effectiveAlignment = {
      ...alignment,
      enabled: true,
      shiftSeconds: alignment.shiftSeconds - (Number(track.alignment?.shiftSeconds) || 0)
    };
  }
  const sourceInfo = await probe(source);
  const sourceFrames = Math.max(1, Math.round(sourceInfo.duration * PROCESS_SAMPLE_RATE));
  const { filters, outputFrames } = alignmentRenderPlan(sourceFrames, effectiveAlignment);
  const temporary = path.join(dir, 'work', `${track.id}-alignment-${crypto.randomUUID()}.wav`);
  try {
    await run(FFMPEG, ['-y', '-v', 'error', '-i', source, '-af', filters.join(','),
      '-ar', String(PROCESS_SAMPLE_RATE), '-c:a', 'pcm_f32le', temporary]);
    // copyFile replaces the destination on both Windows and macOS; rename does
    // not reliably replace an existing WAV on Windows.
    await fsp.copyFile(temporary, output);
  } finally {
    await fsp.rm(temporary, { force: true });
  }
  const outputInfo = await probe(output);
  track.processedAt = new Date().toISOString();
  track.outputDuration = outputInfo.duration;
  track.timelineTargetDuration = outputFrames / PROCESS_SAMPLE_RATE;
  track.alignment = alignment.enabled ? {
    shiftSeconds: alignment.shiftSeconds,
    fadeSeconds: alignment.fadeSeconds,
    direction: alignment.resolvedDirection
  } : null;
}

function trackHasAlignment(track, alignment) {
  if (!alignment.enabled) return !track.alignment;
  return Boolean(track.alignment)
    && Math.abs(Number(track.alignment.shiftSeconds) - alignment.shiftSeconds) < .000001
    && Math.abs(Number(track.alignment.fadeSeconds) - alignment.fadeSeconds) < .000001
    && track.alignment.direction === alignment.resolvedDirection;
}

async function serveFile(req, res, file, extraHeaders = {}) {
  const stat = await fsp.stat(file);
  const type = MIME[path.extname(file).toLowerCase()] || 'application/octet-stream';
  const range = req.headers.range;
  if (range) {
    const match = /bytes=(\d*)-(\d*)/.exec(range);
    const start = match?.[1] ? Number(match[1]) : 0;
    const end = match?.[2] ? Math.min(Number(match[2]), stat.size - 1) : stat.size - 1;
    if (start > end || start >= stat.size) return res.writeHead(416).end();
    res.writeHead(206, {
      'Content-Type': type, 'Content-Length': end - start + 1,
      'Content-Range': `bytes ${start}-${end}/${stat.size}`, 'Accept-Ranges': 'bytes',
      ...extraHeaders
    });
    fs.createReadStream(file, { start, end }).pipe(res);
  } else {
    res.writeHead(200, {
      'Content-Type': type, 'Content-Length': stat.size, 'Accept-Ranges': 'bytes',
      ...extraHeaders
    });
    fs.createReadStream(file).pipe(res);
  }
}

function uniqueArchiveName(name, used) {
  const parsed = path.parse(cleanName(name));
  let candidate = `${parsed.name}${parsed.ext}`;
  for (let copy = 2; used.has(candidate.toLocaleLowerCase()); copy++)
    candidate = `${parsed.name} (${copy})${parsed.ext}`;
  used.add(candidate.toLocaleLowerCase());
  return candidate;
}

async function createProjectArchive(id, project) {
  if (!project.tracks?.length) throw new Error('Il progetto non contiene tracce');
  const incomplete = project.tracks.filter(track => !track.output);
  if (incomplete.length)
    throw new Error(`Quantizza prima tutte le tracce (${incomplete.length} ancora da elaborare)`);

  const tempDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'ai-quantizer-export-'));
  const projectName = cleanName(project.name).replace(/\.[^.]+$/, '') || 'AI Quantizer Export';
  const rootName = `${projectName} - Export`;
  const rootDir = path.join(tempDir, rootName);
  const usedByFolder = new Map();
  try {
    const entries = [];
    for (const track of project.tracks) {
      const folder = track.role === 'master' ? 'Master' : 'Stems';
      entries.push({
        folder,
        source: track.output,
        name: `${path.parse(track.name).name}-quantized.wav`
      });
      if (track.role === 'master' && track.restored) entries.push({
        folder,
        source: track.restored,
        name: `${path.parse(track.name).name}-restored.wav`
      });
      if (track.role === 'master' && track.mastered) entries.push({
        folder,
        source: track.mastered,
        name: `${path.parse(track.name).name}-mastered.wav`
      });
    }
    for (const entry of entries) {
      const folderDir = path.join(rootDir, entry.folder);
      await fsp.mkdir(folderDir, { recursive: true });
      const used = usedByFolder.get(entry.folder) || new Set();
      usedByFolder.set(entry.folder, used);
      const archiveName = uniqueArchiveName(entry.name, used);
      const source = path.join(projectDir(id), entry.source);
      await fsp.access(source);
      await fsp.copyFile(source, path.join(folderDir, archiveName));
    }
    const archiveName = `${projectName}-download-all.zip`;
    const archive = path.join(tempDir, archiveName);
    await run(PYTHON, ['-m', 'zipfile', '-c', archiveName, rootName], { cwd: tempDir });
    return { archive, archiveName, tempDir };
  } catch (error) {
    await fsp.rm(tempDir, { recursive: true, force: true });
    throw error;
  }
}

async function api(req, res, url) {
  const parts = url.pathname.split('/').filter(Boolean);
  if (url.pathname === '/api/health') {
    const tools = {
      ffmpeg: [FFMPEG, ['-version']],
      ffprobe: [FFPROBE, ['-version']],
      rubberband: [RUBBERBAND, ['--version']]
    };
    const checks = Object.fromEntries(Object.entries(tools).map(([name, [command, args]]) =>
      [name, spawnSync(command, args, { stdio: 'ignore' }).status === 0]));
    checks.beatTracker = spawnSync(PYTHON, ['-c', 'import beat_this, soundfile'], { stdio: 'ignore' }).status === 0;
    return json(res, 200, { runtime: 'mlsm-internal-ai-quantizer', apiVersion: 1, ok: Object.values(checks).every(Boolean), checks });
  }
  if (url.pathname === '/api/projects' && req.method === 'GET') {
    await fsp.mkdir(PROJECTS, { recursive: true });
    const entries = await fsp.readdir(PROJECTS, { withFileTypes: true });
    const projects = [];
    for (const entry of entries.filter(e => e.isDirectory())) {
      try { projects.push(await readManifest(entry.name)); } catch {}
    }
    projects.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    return json(res, 200, projects);
  }
  if (url.pathname === '/api/projects' && req.method === 'POST') {
    const input = await bodyJson(req);
    const id = crypto.randomUUID();
    const project = {
      id, name: String(input.name || 'Nuovo progetto').slice(0, 100),
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
      settings: { targetBpm: 120 }, warpMap: null, tracks: [],
      modules: { quantize: true, align: true, restoration: true, mastering: true, ai: false }
    };
    await fsp.mkdir(projectDir(id), { recursive: true });
    await writeManifest(project);
    return json(res, 201, project);
  }
  if (parts[1] !== 'projects' || !parts[2]) return false;
  const id = safeId(parts[2]);
  if (parts.length === 3 && req.method === 'GET') return json(res, 200, await readManifest(id));
  if (parts.length === 3 && req.method === 'DELETE') {
    await fsp.rm(projectDir(id), { recursive: true, force: true });
    return json(res, 200, { ok: true });
  }
  if (parts[3] === 'modules' && req.method === 'PUT') {
    const input = await bodyJson(req);
    const project = await readManifest(id);
    const names = ['quantize', 'align', 'restoration', 'mastering', 'ai'];
    if (!input || typeof input !== 'object' || Array.isArray(input)
      || Object.entries(input).some(([key, value]) => !names.includes(key) || typeof value !== 'boolean'))
      throw new Error('Impostazioni dei passaggi non valide');
    const previous = project.modules || {};
    project.modules = Object.fromEntries(names.map(name => [name, input[name] ?? previous[name] ?? true]));
    const timingChanged = (previous.quantize !== false) !== project.modules.quantize;
    if (timingChanged) {
      invalidateFromWarpMap(project);
    } else if ((previous.restoration !== false) !== project.modules.restoration) {
      const master = project.tracks.find(track => track.role === 'master');
      if (master?.restored) {
        master.mastered = null;
        master.masteredAt = null;
        master.masteredDerivedFrom = null;
        delete project.mastering;
        project.loudness = null;
        clearAiStages(project, ['mastered']);
      }
    }
    await writeManifest(project);
    return json(res, 200, project);
  }
  if (parts[3] === 'tracks' && parts.length === 4 && req.method === 'POST') {
    const project = await readManifest(id);
    const name = cleanName(url.searchParams.get('name'));
    const role = url.searchParams.get('role') === 'master' ? 'master' : 'stem';
    const trackId = crypto.randomUUID();
    const rel = path.join('uploads', `${trackId}-${name}`);
    const destination = path.join(projectDir(id), rel);
    await receiveFile(req, destination);
    const info = await probe(destination);
    const track = { id: trackId, name, role, source: rel, ...info, output: null };
    if (role === 'master') {
      project.tracks.forEach(t => { if (t.role === 'master') t.role = 'stem'; });
      resetForNewMaster(project);
    }
    project.tracks.push(track);
    if (role === 'stem' && project.warpMap?.points?.length) {
      try {
        await processTrack(id, track, project);
      } catch (error) {
        project.tracks = project.tracks.filter(candidate => candidate.id !== track.id);
        await fsp.rm(destination, { force: true });
        throw new Error(`Stem non aggiunto: ${error.message}`);
      }
    }
    await writeManifest(project);
    return json(res, 201, project);
  }
  if (parts[3] === 'warp-map' && req.method === 'PUT') {
    const input = await bodyJson(req);
    const project = await readManifest(id);
    const halfTime = input.settings?.tempoInterpretation === 'half';
    const requestedBpm = Number(input.settings?.targetBpm);
    const targetBpm = Number.isFinite(requestedBpm) && requestedBpm > 0
      ? Math.round(Math.max(halfTime ? 20 : 40, Math.min(halfTime ? 120 : 240, requestedBpm)))
      : project.settings.targetBpm;
    let verifiedRhythm = null;
    if (project.analysis && input.modules?.quantize !== false) {
      const master = project.tracks.find(track => track.role === 'master');
      const analysis = { ...project.analysis,
        beats: Array.isArray(input.rhythmBeats) ? input.rhythmBeats : project.analysis.beats };
      const sourceBpm = rhythm.estimateTempo(analysis).bpm;
      verifiedRhythm = rhythm.buildMap(analysis, master.duration, sourceBpm, targetBpm * (halfTime ? 2 : 1));
      if (!verifiedRhythm.quantizable) throw new Error(UNQUANTIZABLE_ERROR);
    }
    const points = (verifiedRhythm?.points || input.points || []).map(p => ({
      source: Number(p.source), target: Number(p.target)
    })).filter(p => Number.isFinite(p.source) && Number.isFinite(p.target))
      .sort((a, b) => a.source - b.source);
    if (points.length < 2) throw new Error('Servono almeno due beat');
    let maxUnsafeCorrection = 0;
    for (let i = 1; i < points.length; i++) {
      if (points[i].source <= points[i - 1].source || points[i].target <= points[i - 1].target)
        throw new Error(UNQUANTIZABLE_ERROR);
      const sourceSpan = points[i].source - points[i - 1].source;
      const targetSpan = points[i].target - points[i - 1].target;
      const stretch = targetSpan / sourceSpan;
      if (sourceSpan > .25) maxUnsafeCorrection = Math.max(maxUnsafeCorrection, Math.abs(stretch - 1) * 100);
    }
    if (maxUnsafeCorrection > 12 && input.confirmUnsafe !== true)
      throw new Error(`CONFERMA_WARP: correzione locale fino al ${Math.round(maxUnsafeCorrection)}%, oltre il limite consigliato`);
    project.settings = {
      ...project.settings, ...input.settings,
      targetBpm
    };
    project.warpMap = {
      points, estimatedBpm: Number(input.estimatedBpm), confidence: Number(input.confidence),
      engine: input.engine || 'unknown', maximumLocalCorrection: maxUnsafeCorrection,
      rhythmVersion: verifiedRhythm ? rhythm.VERSION : null,
      rhythmCoverage: verifiedRhythm?.coverage ?? null,
      unsafeConfirmed: maxUnsafeCorrection > 12,
      sourceDuration: Number(input.sourceDuration) > 0
        ? Number(input.sourceDuration)
        : points.at(-1).source,
      savedAt: new Date().toISOString()
    };
    project.alignment = normalizedAlignment(input.alignment);
    const modules = input.modules || {};
    project.modules = {
      quantize: modules.quantize !== false,
      align: modules.align !== false,
      restoration: modules.restoration !== false,
      mastering: modules.mastering !== false,
      ai: modules.ai !== false
    };
    project.workflow = { ...project.workflow, alignmentReviewed: input.alignmentReviewed === true };
    invalidateFromWarpMap(project);
    await writeManifest(project);
    return json(res, 200, project);
  }
  if (parts[3] === 'alignment' && req.method === 'PUT') {
    const input = await bodyJson(req);
    const project = await readManifest(id);
    if (!project.tracks?.length || project.tracks.some(track => !track.output))
      throw new Error('Completa prima la quantizzazione di tutte le tracce');
    const enabled = input.modules?.align !== false;
    const alignment = normalizedAlignment({
      ...input.alignment,
      enabled: enabled && input.alignment?.enabled
    });
    const changedTracks = project.tracks.filter(track => !trackHasAlignment(track, alignment));
    for (const track of changedTracks) await applyAlignmentToTrack(id, track, alignment);
    project.alignment = alignment;
    project.modules = { ...project.modules, align: enabled };
    project.workflow = { ...project.workflow, alignmentReviewed: true };
    const master = project.tracks.find(track => track.role === 'master');
    if (master && changedTracks.length) invalidateAfterQuantize(project, master);
    await writeManifest(project);
    return json(res, 200, project);
  }
  if (parts[3] === 'analyze' && req.method === 'POST') {
    const project = await readManifest(id);
    const master = project.tracks.find(t => t.role === 'master');
    if (!master) throw new Error('Carica prima una traccia master');
    const analysis = await runJson(PYTHON, [
      path.join(ROOT, 'audio_engine', 'analyze.py'), path.join(projectDir(id), master.source)
    ]);
    const tempo = rhythm.estimateTempo(analysis);
    const checked = rhythm.buildMap(analysis, master.duration, tempo.bpm, tempo.bpm);
    project.analysis = { ...analysis, detectedBpm: tempo.bpm, meanBpm: rhythm.meanTempo(analysis, master.duration), meter: tempo.meter,
      rhythmVersion: rhythm.VERSION, quantizable: checked.quantizable,
      rhythmCoverage: checked.coverage, analyzedAt: new Date().toISOString() };
    project.warpMap = null;
    project.settings.targetBpm = rhythm.suggestedTargetBpm(analysis, master.duration, project.settings.tempoInterpretation === 'half');
    project.settings.targetBpmAutomatic = true;
    invalidateFromWarpMap(project);
    await writeManifest(project);
    return json(res, 200, project);
  }
  if (parts[3] === 'process' && req.method === 'POST') {
    const input = await bodyJson(req);
    const project = await readManifest(id);
    if (!project.warpMap) throw new Error('Analizza e salva prima la beat map');
    if (project.modules?.quantize !== false && project.analysis && project.warpMap.rhythmVersion !== rhythm.VERSION)
      throw new Error('Mappa precedente: esegui Analisi Smart per aggiornarla prima di quantizzare.');
    const requestedIds = Array.isArray(input.trackIds)
      ? new Set(input.trackIds.map(safeId))
      : new Set(input.trackId ? [safeId(input.trackId)] : []);
    const master = project.tracks.find(track => track.role === 'master');
    const masterWasRequested = master && requestedIds.has(master.id);
    const selected = input.all || masterWasRequested
      ? project.tracks
      : project.tracks.filter(track => requestedIds.has(track.id));
    if (!selected.length) throw new Error('Nessuna traccia selezionata');
    for (const track of selected) await processTrack(id, track, project);
    if (selected.some(track => track.role === 'master')) {
      const master = project.tracks.find(track => track.role === 'master');
      if (master) {
        invalidateAfterQuantize(project, master);
        await analyzeAiStage(id, project, 'original', master.source);
        await analyzeAiStage(id, project, 'quantized', master.output);
      }
    }
    await writeManifest(project);
    return json(res, 200, project);
  }
  if (parts[3] === 'loudness' && req.method === 'POST') {
    const project = await readManifest(id);
    const master = project.tracks.find(t => t.role === 'master');
    if (!master?.output) throw new Error('Quantizza e allinea prima il master');
    project.loudness = project.loudness || {};
    const measurementSource = project.modules?.restoration !== false && master.restored ? master.restored : master.output;
    project.loudness.preMaster = await measureLoudness(path.join(projectDir(id), measurementSource));
    if (master.mastered) project.loudness.postMaster = await measureLoudness(path.join(projectDir(id), master.mastered));
    await writeManifest(project);
    return json(res, 200, project);
  }
  if (parts[3] === 'master' && req.method === 'POST') {
    const input = await bodyJson(req);
    const project = await readManifest(id);
    const master = project.tracks.find(t => t.role === 'master');
    if (project.modules?.mastering === false) throw new Error('Il modulo Mastering è disattivato');
    if (!master?.output) throw new Error('Quantizza e allinea prima il master');
    if (project.modules?.restoration !== false && !master.restored)
      throw new Error('Il modulo Restoration è attivo: crea prima la versione restaurata');
    const gainDb = Math.max(-24, Math.min(24, Number(input.gainDb) || 0));
    const limiterEnabled = input.limiterEnabled !== false;
    const ceilingDbtp = Math.max(-9, Math.min(-0.1, Number(input.ceilingDbtp) || -1));
    const releaseMs = Math.max(10, Math.min(1000, Number(input.releaseMs) || 100));
    const sourceRel = project.modules?.restoration !== false && master.restored ? master.restored : master.output;
    const source = path.join(projectDir(id), sourceRel);
    const base = path.parse(master.output).name.replace(/-quantized$/, '');
    const masteredRel = path.join('outputs', `${base}-mastered.wav`);
    const mastered = path.join(projectDir(id), masteredRel);
    const filters = [`aresample=192000:resampler=soxr`, `volume=${gainDb.toFixed(3)}dB`];
    if (limiterEnabled) {
      const linear = Math.pow(10, ceilingDbtp / 20);
      filters.push(`alimiter=limit=${linear.toFixed(9)}:attack=5:release=${releaseMs.toFixed(1)}:level=false:latency=true`);
    }
    filters.push('aresample=48000:resampler=soxr');
    await run(FFMPEG, ['-y', '-v', 'error', '-i', source, '-af', filters.join(','),
      '-ar', '48000', '-c:a', 'pcm_f32le', mastered]);
    const metrics = await measureLoudness(mastered);
    master.mastered = masteredRel;
    master.masteredAt = new Date().toISOString();
    master.masteredDerivedFrom = sourceRel;
    project.mastering = { gainDb, limiterEnabled, ceilingDbtp, releaseMs, oversampling: 4 };
    project.loudness = project.loudness || {};
    project.loudness.preMaster = await measureLoudness(source);
    project.loudness.postMaster = metrics;
    clearAiStages(project, ['mastered']);
    await analyzeAiStage(id, project, 'mastered', master.mastered);
    await writeManifest(project);
    return json(res, 200, project);
  }
  if (parts[3] === 'restore' && req.method === 'POST') {
    const input = await bodyJson(req);
    const project = await readManifest(id);
    if (project.modules?.restoration === false) throw new Error('Il modulo Audio Restoration è disattivato');
    const master = project.tracks.find(t => t.role === 'master');
    if (!master?.output) throw new Error('Quantizza prima il master');
    const clean = input.clean !== false, declip = Boolean(input.declip), bandwidth = Boolean(input.bandwidth);
    const intensity = Math.max(0, Math.min(100, Number(input.intensity) || 35));
    const source = path.join(projectDir(id), master.output);
    const base = path.parse(master.output).name.replace(/-quantized$/, '');
    const restoredRel = path.join('outputs', `${base}-restored.wav`);
    const restored = path.join(projectDir(id), restoredRel);
    const filters = ['aresample=96000:resampler=soxr'];
    if (declip) filters.push('adeclip=w=55:o=75:a=2:t=3');
    if (clean) filters.push(`afftdn=nr=${(3 + intensity * .07).toFixed(2)}:nf=-55:tn=1:gs=4`);
    if (bandwidth) filters.push(`aexciter=amount=${(.2 + intensity * .012).toFixed(3)}:drive=2.5:blend=${(.05 + intensity * .004).toFixed(3)}:freq=7500:ceil=18000`);
    filters.push('aresample=48000:resampler=soxr');
    await run(FFMPEG, ['-y', '-v', 'error', '-i', source, '-af', filters.join(','),
      '-ar', '48000', '-c:a', 'pcm_f32le', restored]);
    master.restored = restoredRel;
    master.restoredAt = new Date().toISOString();
    master.restoredDerivedFrom = master.output;
    invalidateAfterRestore(project, master);
    project.restoration = { clean, declip, bandwidth, intensity, processingRate: 96000 };
    project.loudness = null;
    await analyzeAiStage(id, project, 'restored', master.restored);
    await writeManifest(project);
    return json(res, 200, project);
  }
  if (parts[3] === 'ai-detection' && req.method === 'POST') {
    const project = await readManifest(id);
    if (project.modules?.ai === false) throw new Error('Il modulo AI Forensics è disattivato');
    const master = project.tracks.find(t => t.role === 'master');
    if (!master) throw new Error('Traccia master non disponibile');
    const stages = [
      ['original', master.source],
      ['quantized', master.output],
      ['restored', master.restored],
      ['mastered', master.mastered]
    ].filter(([, file]) => file);
    project.aiDetection = project.aiDetection || {};
    for (const [stage, file] of stages) {
      await analyzeAiStage(id, project, stage, file, true);
    }
    await writeManifest(project);
    return json(res, 200, project);
  }
  if (parts[3] === 'download-all' && req.method === 'GET') {
    const project = await readManifest(id);
    const bundle = await createProjectArchive(id, project);
    const fallbackName = bundle.archiveName.replace(/[^\x20-\x7e]|["\\]/g, '_');
    res.once('close', () => {
      fsp.rm(bundle.tempDir, { recursive: true, force: true }).catch(() => {});
    });
    await serveFile(req, res, bundle.archive, {
      'Content-Disposition': `attachment; filename="${fallbackName}"; filename*=UTF-8''${encodeURIComponent(bundle.archiveName)}`
    });
    return true;
  }
  if (parts[3] === 'audio' && parts[4] && req.method === 'GET') {
    const project = await readManifest(id);
    const track = project.tracks.find(t => t.id === safeId(parts[4]));
    if (!track) throw new Error('Traccia non trovata');
    const requested = url.searchParams.get('variant');
    const variant = requested === 'mastered' ? 'mastered' : requested === 'restored' ? 'restored' : requested === 'output' ? 'output' : 'source';
    if (!track[variant]) throw new Error('Audio non disponibile');
    await serveFile(req, res, path.join(projectDir(id), track[variant]));
    return true;
  }
  return false;
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    if (url.pathname.startsWith('/api/')) {
      if (!await api(req, res, url)) json(res, 404, { error: 'Endpoint non trovato' });
      return;
    }
    const relative = url.pathname === '/' ? 'index.html' : decodeURIComponent(url.pathname.slice(1));
    const file = path.resolve(PUBLIC, relative);
    if (!file.startsWith(`${PUBLIC}${path.sep}`) && file !== path.join(PUBLIC, 'index.html'))
      return json(res, 403, { error: 'Accesso negato' });
    await serveFile(req, res, file);
  } catch (error) {
    const status = error.code === 'ENOENT' ? 404 : 400;
    if (!res.headersSent) json(res, status, { error: error.message || 'Errore interno' });
    else res.destroy();
  }
});

fsp.mkdir(PROJECTS, { recursive: true }).then(() => {
  server.listen(PORT, () => console.log(`AI Quantizer disponibile su http://localhost:${PORT}`));
});

function shutdown() {
  terminateChildren();
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 1500).unref();
}
process.once('SIGTERM', shutdown);
process.once('SIGINT', shutdown);
