import { maxWaterImpacts, waterField, type WaterImpact } from "./water-ripples";

export interface WaterRenderer {
  resize(width: number, height: number): void;
  draw(time: number, impacts: readonly WaterImpact[]): void;
  clear(): void;
  dispose(): void;
}

// The GPU and software paths use the same signed wave equation. Lighting is
// computed on the combined normal, not by alpha-blending separate ring sprites.
const vertexSource = `attribute vec2 position;
void main() { gl_Position = vec4(position, 0., 1.); }`;
const fragmentSource = `
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif
uniform vec2 resolution;
uniform vec2 pixels;
uniform float time;
uniform float night;
uniform int count;
uniform vec4 impacts[8];
void main() {
  vec2 point = vec2(gl_FragCoord.x, pixels.y - gl_FragCoord.y) / pixels * resolution;
  float height = 0.; vec2 gradient = vec2(0.);
  for (int i = 0; i < 8; i++) {
    if (i >= count) break;
    vec4 impact = impacts[i]; float age = time - impact.z;
    if (age <= 0. || age >= 5.) continue;
    vec2 delta = point - impact.xy; float distance = length(delta);
    float spread = 32. + age * 7.; float offset = distance - age * 175.;
    if (abs(offset) > spread * 3.) continue;
    float k = 6.28318530718 / 32.; float phase = offset * k;
    float envelope = impact.w * min(1., age / .12) * exp(-age * .52 - pow(offset / spread, 2.)) / sqrt(1. + distance * .025);
    height += envelope * cos(phase);
    float slope = envelope * (-sin(phase) * k - cos(phase) * (2. * offset / (spread * spread) + .0125 / (1. + distance * .025)));
    gradient += slope * delta / max(.001, distance);
  }
  vec3 normal = normalize(vec3(-gradient * 3., 1.));
  vec3 light = normalize(vec3(-.4, -.6, 1.));
  float reflection = pow(max(0., dot(normal, light)), 24.);
  float crest = clamp(.5 + height * 1.6 + dot(gradient, vec2(-2., -3.)), 0., 1.);
  vec3 deep = mix(vec3(.66, .16, .38), vec3(.62, .17, .37), night);
  vec3 rose = mix(vec3(.96, .40, .65), vec3(1., .51, .74), night);
  vec3 color = mix(deep, rose, crest);
  color = mix(color, vec3(1., .83, .93), reflection * .65);
  float alpha = min(mix(.38, .56, night), abs(height) * .55 + length(gradient) * 1.9);
  gl_FragColor = vec4(color, alpha);
}`;

export function createGpuWaterRenderer(canvas: HTMLCanvasElement, night: boolean): WaterRenderer | null {
  let gl: WebGLRenderingContext | null;
  try { gl = canvas.getContext("webgl", { alpha: true, antialias: false, premultipliedAlpha: false, depth: false, stencil: false, powerPreference: "low-power" }); }
  catch { return null; }
  if (!gl) return null;
  const shaders: WebGLShader[] = [];
  const program = gl.createProgram(), buffer = gl.createBuffer();
  const release = () => { shaders.forEach(shader => gl!.deleteShader(shader)); if (buffer) gl!.deleteBuffer(buffer); if (program) gl!.deleteProgram(program); };
  const compile = (type: number, source: string) => {
    const shader = gl!.createShader(type); if (!shader) return null;
    shaders.push(shader); gl!.shaderSource(shader, source); gl!.compileShader(shader);
    return gl!.getShaderParameter(shader, gl!.COMPILE_STATUS) ? shader : null;
  };
  const vertex = compile(gl.VERTEX_SHADER, vertexSource), fragment = compile(gl.FRAGMENT_SHADER, fragmentSource);
  if (!program || !buffer || !vertex || !fragment) { release(); return null; }
  gl.attachShader(program, vertex); gl.attachShader(program, fragment); gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) { release(); return null; }
  gl.useProgram(program); gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]), gl.STATIC_DRAW);
  const position = gl.getAttribLocation(program, "position"); gl.enableVertexAttribArray(position); gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);
  const locations = Object.fromEntries(["resolution", "pixels", "time", "night", "count", "impacts[0]"].map(name => [name, gl!.getUniformLocation(program, name)]));
  const data = new Float32Array(maxWaterImpacts * 4);
  gl.uniform1f(locations.night!, night ? 1 : 0);
  return {
    resize(width, height) {
      // Bound fill rate and VRAM even with tall custom widget layouts.
      const scale = Math.min(1.25, window.devicePixelRatio || 1, Math.sqrt(1_000_000 / (width * height)));
      canvas.width = Math.max(1, Math.round(width * scale)); canvas.height = Math.max(1, Math.round(height * scale));
      gl!.viewport(0, 0, canvas.width, canvas.height);
      gl!.uniform2f(locations.resolution!, width, height); gl!.uniform2f(locations.pixels!, canvas.width, canvas.height);
    },
    draw(time, impacts) {
      const count = Math.min(maxWaterImpacts, impacts.length); data.fill(0);
      for (let i = 0; i < count; i++) { const impact = impacts[i]!; data.set([impact.x, impact.y, impact.born, impact.strength], i * 4); }
      gl!.uniform1f(locations.time!, time); gl!.uniform1i(locations.count!, count); gl!.uniform4fv(locations["impacts[0]"]!, data);
      gl!.drawArrays(gl!.TRIANGLES, 0, 6);
    },
    clear() { gl!.clearColor(0, 0, 0, 0); gl!.clear(gl!.COLOR_BUFFER_BIT); },
    dispose() { release(); canvas.width = canvas.height = 1; }
  };
}

/** Bounded software fallback for disabled/unavailable graphics acceleration. */
export function createSoftwareWaterRenderer(canvas: HTMLCanvasElement, night: boolean): WaterRenderer | null {
  const context = canvas.getContext("2d"); if (!context) return null;
  let width = 1, height = 1, image: ImageData;
  return {
    resize(w, h) {
      width = w; height = h; const scale = Math.min(.22, Math.sqrt(24_000 / (w * h)));
      canvas.width = Math.max(1, Math.round(w * scale)); canvas.height = Math.max(1, Math.round(h * scale));
      image = context.createImageData(canvas.width, canvas.height);
    },
    draw(time, impacts) {
      for (let y = 0; y < canvas.height; y++) for (let x = 0; x < canvas.width; x++) {
        const field = waterField((x + .5) / canvas.width * width, (y + .5) / canvas.height * height, time, impacts);
        const crest = Math.max(0, Math.min(1, .5 + field.height * 1.6 - field.dx * 2 - field.dy * 3));
        const offset = (y * canvas.width + x) * 4;
        image.data[offset] = 160 + crest * 95; image.data[offset + 1] = 42 + crest * 88; image.data[offset + 2] = 96 + crest * 93;
        image.data[offset + 3] = Math.min(night ? .56 : .38, Math.abs(field.height) * .55 + Math.hypot(field.dx, field.dy) * 1.9) * 255;
      }
      context.putImageData(image, 0, 0);
    },
    clear() { context.clearRect(0, 0, canvas.width, canvas.height); },
    dispose() { canvas.width = canvas.height = 1; }
  };
}
