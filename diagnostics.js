const TESTS = [
  { id: "high", label: "原始 H.264 High", url: "./idle-high.mp4", codec: 'video/mp4; codecs="avc1.640020"' },
  { id: "main", label: "兼容 H.264 Main", url: "./idle-main.mp4", codec: 'video/mp4; codecs="avc1.4d4020"' }
];

const report = { createdAt: new Date().toISOString(), environment: {}, cases: [] };
const device = document.querySelector("#device");
const casesHost = document.querySelector("#cases");
const startButton = document.querySelector("#start");
const copyButton = document.querySelector("#copy");

function createGl(canvas) {
  return canvas.getContext("webgl", { alpha: true, antialias: false, preserveDrawingBuffer: true });
}

function glInfo() {
  const canvas = document.createElement("canvas");
  const gl = createGl(canvas);
  if (!gl) return { available: false };
  const debug = gl.getExtension("WEBGL_debug_renderer_info");
  return {
    available: true,
    version: gl.getParameter(gl.VERSION),
    shadingLanguage: gl.getParameter(gl.SHADING_LANGUAGE_VERSION),
    vendor: debug ? gl.getParameter(debug.UNMASKED_VENDOR_WEBGL) : gl.getParameter(gl.VENDOR),
    renderer: debug ? gl.getParameter(debug.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER),
    maxTextureSize: gl.getParameter(gl.MAX_TEXTURE_SIZE)
  };
}

async function mediaCapabilities() {
  if (!navigator.mediaCapabilities?.decodingInfo) return { available: false };
  const results = {};
  for (const test of TESTS) {
    try {
      results[test.id] = await navigator.mediaCapabilities.decodingInfo({
        type: "file",
        video: { contentType: test.codec, width: 960, height: 1280, bitrate: 2600000, framerate: 24 }
      });
    } catch (error) {
      results[test.id] = { error: String(error) };
    }
  }
  return results;
}

async function collectEnvironment() {
  report.environment = {
    userAgent: navigator.userAgent,
    platform: navigator.platform,
    language: navigator.language,
    viewport: `${innerWidth}x${innerHeight}`,
    devicePixelRatio,
    hardwareConcurrency: navigator.hardwareConcurrency,
    webgl: glInfo(),
    canPlay: Object.fromEntries(TESTS.map(test => [test.id, document.createElement("video").canPlayType(test.codec)])),
    mediaCapabilities: await mediaCapabilities()
  };
  device.textContent = JSON.stringify(report.environment, null, 2);
}

function makeCase(test) {
  const section = document.createElement("section");
  section.className = "case";
  section.innerHTML = `
    <header><h2>${test.label}</h2><span class="status">等待</span></header>
    <div class="grid">
      <figure><figcaption>1. 原生 video</figcaption><video muted playsinline loop controls preload="auto"></video></figure>
      <figure><figcaption>2. Canvas 2D</figcaption><canvas class="canvas2d" width="180" height="240"></canvas></figure>
      <figure><figcaption>3. 普通 WebGL 纹理</figcaption><canvas class="webgl" width="180" height="240"></canvas></figure>
      <figure><figcaption>4. 当前抠绿 Shader</figcaption><canvas class="chroma" width="180" height="240"></canvas></figure>
    </div>
    <pre>尚未开始</pre>`;
  const video = section.querySelector("video");
  video.crossOrigin = "anonymous";
  video.src = test.url;
  casesHost.append(section);
  return { section, video, status: section.querySelector(".status"), log: section.querySelector("pre") };
}

function compile(gl, type, source) {
  const shader = gl.createShader(type);
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(shader) || "Shader 编译失败");
  return shader;
}

function createRenderer(canvas, chroma) {
  const gl = createGl(canvas);
  if (!gl) throw new Error("WebGL 不可用");
  const vertex = compile(gl, gl.VERTEX_SHADER, "attribute vec2 p;varying vec2 uv;void main(){uv=vec2((p.x+1.0)*0.5,1.0-(p.y+1.0)*0.5);gl_Position=vec4(p,0.0,1.0);}");
  const fragment = compile(gl, gl.FRAGMENT_SHADER, chroma
    ? "precision mediump float;uniform sampler2D map;uniform vec3 keyColor;varying vec2 uv;void main(){vec4 c=texture2D(map,uv);float d=distance(c.rgb,keyColor);float a=smoothstep(.35,.47,d);c.g=mix(min(c.g,max(c.r,c.b)),c.g,clamp((d-.35)/.2,0.0,1.0));gl_FragColor=vec4(c.rgb,c.a*a);}"
    : "precision mediump float;uniform sampler2D map;varying vec2 uv;void main(){gl_FragColor=texture2D(map,uv);}");
  const program = gl.createProgram();
  gl.attachShader(program, vertex);
  gl.attachShader(program, fragment);
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program) || "Program 链接失败");
  gl.useProgram(program);
  const buffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1,1,-1,-1,1,-1,1,1,-1,1,1]), gl.STATIC_DRAW);
  const location = gl.getAttribLocation(program, "p");
  gl.enableVertexAttribArray(location);
  gl.vertexAttribPointer(location, 2, gl.FLOAT, false, 0, 0);
  if (chroma) gl.uniform3f(gl.getUniformLocation(program, "keyColor"), .1, .8, .2);
  const texture = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  return {
    gl,
    draw(video) {
      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, video);
      gl.drawArrays(gl.TRIANGLES, 0, 6);
      return gl.getError();
    }
  };
}

function pixelStats(canvas, gl) {
  const width = canvas.width;
  const height = canvas.height;
  let pixels;
  if (gl) {
    pixels = new Uint8Array(width * height * 4);
    gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
  } else {
    pixels = canvas.getContext("2d", { willReadFrequently: true }).getImageData(0, 0, width, height).data;
  }
  let black = 0;
  let transparent = 0;
  for (let index = 0; index < pixels.length; index += 4) {
    if (pixels[index] < 6 && pixels[index + 1] < 6 && pixels[index + 2] < 6) black++;
    if (pixels[index + 3] < 6) transparent++;
  }
  const count = width * height;
  return { blackPercent: +(black / count * 100).toFixed(1), transparentPercent: +(transparent / count * 100).toFixed(1) };
}

async function runCase(test) {
  const ui = makeCase(test);
  const events = [];
  for (const name of ["loadstart", "loadedmetadata", "loadeddata", "canplay", "playing", "waiting", "stalled", "error"]) {
    ui.video.addEventListener(name, () => events.push({ name, at: performance.now().toFixed(0), readyState: ui.video.readyState }));
  }
  const canvas2d = ui.section.querySelector(".canvas2d");
  const plainCanvas = ui.section.querySelector(".webgl");
  const chromaCanvas = ui.section.querySelector(".chroma");
  let plain;
  let chroma;
  const result = { id: test.id, label: test.label, source: test.url, events };
  ui.status.textContent = "检测中";
  try {
    await ui.video.play();
    plain = createRenderer(plainCanvas, false);
    chroma = createRenderer(chromaCanvas, true);
    const context2d = canvas2d.getContext("2d", { willReadFrequently: true });
    const startedAt = performance.now();
    let lastPlainError = 0;
    let lastChromaError = 0;
    while (performance.now() - startedAt < 6500) {
      if (ui.video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA && ui.video.videoWidth > 0) {
        context2d.drawImage(ui.video, 0, 0, canvas2d.width, canvas2d.height);
        lastPlainError = plain.draw(ui.video);
        lastChromaError = chroma.draw(ui.video);
      }
      await new Promise(resolve => requestAnimationFrame(resolve));
    }
    result.video = {
      readyState: ui.video.readyState,
      networkState: ui.video.networkState,
      dimensions: `${ui.video.videoWidth}x${ui.video.videoHeight}`,
      currentTime: +ui.video.currentTime.toFixed(3),
      paused: ui.video.paused,
      ended: ui.video.ended,
      error: ui.video.error ? { code: ui.video.error.code, message: ui.video.error.message } : null
    };
    result.canvas2d = pixelStats(canvas2d);
    result.webgl = { ...pixelStats(plainCanvas, plain.gl), glError: lastPlainError };
    result.chroma = { ...pixelStats(chromaCanvas, chroma.gl), glError: lastChromaError };
    const failed = result.video.currentTime === 0 || result.canvas2d.blackPercent > 95 || result.webgl.blackPercent > 95;
    ui.status.textContent = failed ? "发现异常" : "完成";
    ui.status.className = `status ${failed ? "bad" : "ok"}`;
  } catch (error) {
    result.failure = String(error?.stack || error);
    result.video = { readyState: ui.video.readyState, networkState: ui.video.networkState, error: ui.video.error?.message || null };
    ui.status.textContent = "失败";
    ui.status.className = "status bad";
  }
  ui.log.textContent = JSON.stringify(result, null, 2);
  report.cases.push(result);
}

startButton.addEventListener("click", async () => {
  startButton.disabled = true;
  casesHost.replaceChildren();
  report.cases = [];
  for (const test of TESTS) await runCase(test);
  copyButton.disabled = false;
  startButton.textContent = "重新检测";
  startButton.disabled = false;
});

copyButton.addEventListener("click", async () => {
  report.finishedAt = new Date().toISOString();
  await navigator.clipboard.writeText(JSON.stringify(report, null, 2));
  copyButton.textContent = "已复制";
  setTimeout(() => { copyButton.textContent = "复制诊断结果"; }, 1500);
});

collectEnvironment();
