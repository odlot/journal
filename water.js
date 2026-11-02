// The moving background: milky turquoise glacial water, drawn as layered noise
// stretched along the current. It stays low-resolution and low-framerate, because
// soft water doesn't need detail and phones shouldn't get warm.
(() => {
  'use strict';

  const canvas = document.getElementById('water');
  const gl = canvas.getContext('webgl', { antialias: false, alpha: false, depth: false });
  if (!gl) { canvas.remove(); return; } // The CSS gradient on <body> takes over.

  const SCALE = 0.5;
  const FRAME_MS = 1000 / 30;

  const vertexSource = `
    attribute vec2 position;
    void main() { gl_Position = vec4(position, 0.0, 1.0); }`;

  const fragmentSource = `
    precision mediump float;
    uniform vec2 resolution;
    uniform float time;

    float hash(vec2 p) {
      p = fract(p * vec2(123.34, 456.21));
      p += dot(p, p + 45.32);
      return fract(p.x * p.y);
    }

    float noise(vec2 p) {
      vec2 i = floor(p);
      vec2 f = fract(p);
      vec2 u = f * f * (3.0 - 2.0 * f);
      return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x),
                 mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
    }

    float fbm(vec2 p) {
      float value = 0.0;
      float amplitude = 0.5;
      for (int i = 0; i < 4; i++) {
        value += amplitude * noise(p);
        p = p * 2.03 + vec2(17.0, 9.0);
        amplitude *= 0.5;
      }
      return value;
    }

    void main() {
      vec2 uv = gl_FragCoord.xy / resolution;
      vec2 p = vec2(uv.x * resolution.x / resolution.y, uv.y);

      // Long streaks that slide with the current. The warp makes them eddy.
      vec2 flow = vec2(p.x * 1.2 - time * 0.06, p.y * 8.0);
      float warp = fbm(flow * 0.6 + vec2(time * 0.014, 3.0));
      float streaks = fbm(flow + vec2(warp * 1.7, warp * 0.7));

      vec3 deep = vec3(0.039, 0.290, 0.325);
      vec3 glacier = vec3(0.067, 0.435, 0.463);
      vec3 milk = vec3(0.420, 0.790, 0.760);

      vec3 color = mix(deep, glacier, smoothstep(0.26, 0.62, streaks));
      color = mix(color, milk, smoothstep(0.56, 0.84, streaks) * 0.24);

      // Shaded banks at the top and bottom, like water under spruce.
      float bank = smoothstep(0.0, 0.3, uv.y) * smoothstep(1.0, 0.72, uv.y);
      color *= mix(0.72, 1.0, bank);

      // A little grain stops the dark gradients from banding.
      color += (hash(gl_FragCoord.xy + fract(time)) - 0.5) / 128.0;

      gl_FragColor = vec4(color, 1.0);
    }`;

  function compile(type, source) {
    const shader = gl.createShader(type);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    return shader;
  }

  const program = gl.createProgram();
  gl.attachShader(program, compile(gl.VERTEX_SHADER, vertexSource));
  gl.attachShader(program, compile(gl.FRAGMENT_SHADER, fragmentSource));
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) { canvas.remove(); return; }
  gl.useProgram(program);

  gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  const position = gl.getAttribLocation(program, 'position');
  gl.enableVertexAttribArray(position);
  gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);

  const resolution = gl.getUniformLocation(program, 'resolution');
  const time = gl.getUniformLocation(program, 'time');
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');

  function draw(ms) {
    gl.uniform1f(time, ms / 1000);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  function resize() {
    canvas.width = Math.max(1, Math.round(innerWidth * SCALE));
    canvas.height = Math.max(1, Math.round(innerHeight * SCALE));
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.uniform2f(resolution, canvas.width, canvas.height);
    if (reducedMotion.matches) draw(40000); // A still, unhurried frame.
  }

  let last = 0;
  function frame(now) {
    requestAnimationFrame(frame);
    if (reducedMotion.matches || document.hidden || now - last < FRAME_MS) return;
    last = now;
    draw(now + 40000); // Start part-way along, so the first frame already flows.
  }

  addEventListener('resize', resize);
  resize();
  requestAnimationFrame(frame);
})();
