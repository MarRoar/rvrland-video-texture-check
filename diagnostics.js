const TESTS = [
  { id: "high", label: "原始 H.264 High", url: "./idle-high.mp4", codec: 'video/mp4; codecs="avc1.640020"' },
  { id: "main", label: "兼容 H.264 Main", url: "./idle-main.mp4", codec: 'video/mp4; codecs="avc1.4d4020"' }
];

const report = { version: "2026-09-18.3", createdAt: new Date().toISOString(), environment: {}, cases: [] };
const device = document.querySelector("#device");
const casesHost = document.querySelector("#cases");
const startButton = document.querySelector("#start");
const copyButton = document.querySelector("#copy");
const summary = document.querySelector("#summary");

function createGl(canvas) {
  return canvas.getContext("webgl", { alpha: true, antialias: false, preserveDrawingBuffer: true });
}

function glInfo() {
  const canvas = document.createElement("canvas");
  const gl = createGl(canvas);
  if (!gl) return { available: false };
  const debug = gl.getExtension("WEBGL_debug_renderer_info");
  const info = {
    available: true,
    version: gl.getParameter(gl.VERSION),
    shadingLanguage: gl.getParameter(gl.SHADING_LANGUAGE_VERSION),
    vendor: debug ? gl.getParameter(debug.UNMASKED_VENDOR_WEBGL) : gl.getParameter(gl.VENDOR),
    renderer: debug ? gl.getParameter(debug.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER),
    maxTextureSize: gl.getParameter(gl.MAX_TEXTURE_SIZE)
  };
  gl.getExtension("WEBGL_lose_context")?.loseContext();
  return info;
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
    frameCallbackSupported: "requestVideoFrameCallback" in HTMLVideoElement.prototype,
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
  const preview = section.querySelector("video");
  // A newly created detached element avoids the browser's pending removal task
  // aborting play(), which would confound the intended business-style test.
  const video = test.detached ? document.createElement("video") : preview;
  video.muted = true;
  video.playsInline = true;
  video.loop = true;
  video.preload = "auto";
  video.controls = !!test.controls;
  video.crossOrigin = "anonymous";
  if (test.detached) {
    const placeholder = document.createElement("p");
    placeholder.textContent = "离屏视频：不插入页面，模拟业务创建方式。请看右侧及下方读取结果。";
    preview.replaceWith(placeholder);
  }
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
    dispose() {
      gl.deleteTexture(texture);
      gl.deleteBuffer(buffer);
      gl.deleteProgram(program);
      gl.deleteShader(vertex);
      gl.deleteShader(fragment);
      gl.getExtension("WEBGL_lose_context")?.loseContext();
    },
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

function classification(stat) {
  if (!stat) return "未取到帧";
  if (stat.transparentPercent > 95) return "全透明";
  if (stat.blackPercent > 95) return "黑屏";
  return "有图像";
}

function aggregate(samples, key) {
  const counts = {};
  for (const sample of samples) {
    const state = classification(sample[key]);
    counts[state] = (counts[state] || 0) + 1;
  }
  return samples.length ? Object.entries(counts).map(([state, count]) => state + count + "次").join(" / ") : "未取到帧";
}

function renderSummary() {
  summary.replaceChildren();
  const title = document.createElement("h2");
  title.textContent = "V3 检测结果（可分段截图）";
  summary.append(title);
  const env = document.createElement("pre");
  env.textContent = "版本: " + report.version + "\n浏览器: " + report.environment.userAgent +
    "\nGPU: " + report.environment.webgl?.renderer +
    "\n帧回调支持: " + report.environment.frameCallbackSupported +
    "\n离开前台: " + report.hiddenCount + "次";
  summary.append(env);
  for (const item of report.cases) {
    const block = document.createElement("pre");
    block.textContent = item.label + "\n" +
      (item.kind === "static" ? "对照图: 红/绿/蓝/白四色\n" :
        "时间变化: " + (item.timeAdvanced ? "有" : "无") +
        "  帧回调: " + item.frameCallbacks + "\n") +
      "Canvas: " + aggregate(item.samples, "canvas2d") + "\n" +
      "WebGL: " + aggregate(item.samples, "webgl") + "\n" +
      "抠绿: " + aggregate(item.samples, "chroma") + "\n" +
      "GL错误: " + (item.glErrors.join(",") || "无") + "\n" +
      "读取异常: " + (item.errors.join("；") || "无") +
      (item.path === "seek" ? "\n已完成跳帧: " + item.seeks + "（不代表连续播放）" : "") +
      (item.failure ? "\n未完成: " + item.failure : "") +
      (item.readWhileHidden ? "\n注意: 存在后台采样，本组需前台重测" : "");
    summary.append(block);
  }
  summary.classList.add("visible");
}

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

async function withTimeout(promise, milliseconds, message) {
  let timer;
  try {
    return await Promise.race([promise, new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(message)), milliseconds);
    })]);
  } finally {
    clearTimeout(timer);
  }
}

function addUnique(list, value) {
  if (value && !list.includes(value)) list.push(value);
}

function waitEvent(target, name, action, timeout) {
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      clearTimeout(timer);
      target.removeEventListener(name, done);
      target.removeEventListener("error", fail);
    };
    const done = () => { cleanup(); resolve(); };
    const fail = () => { cleanup(); reject(new Error(name + " 媒体事件异常")); };
    const timer = setTimeout(() => { cleanup(); reject(new Error(name + " 等待超时")); }, timeout);
    target.addEventListener(name, done);
    target.addEventListener("error", fail);
    try { action(); } catch (error) { cleanup(); reject(error); }
  });
}

function makeControlImage() {
  const canvas = document.createElement("canvas");
  canvas.width = 180;
  canvas.height = 240;
  const ctx = canvas.getContext("2d");
  ["#ff0000", "#00ff00", "#0000ff", "#ffffff"].forEach((color, index) => {
    ctx.fillStyle = color;
    ctx.fillRect(index % 2 * 90, Math.floor(index / 2) * 120, 90, 120);
  });
  // Decode an actual image before uploading, independently of the video decoder.
  const image = new Image();
  image.src = canvas.toDataURL("image/png");
  return image;
}

async function runCase(test) {
  const ui = makeCase(test);
  const result = {
    id: test.id, label: test.label, kind: test.kind || "video",
    source: test.local ? "用户选择的本机视频" : test.url,
    mode: test.detached ? "detached" : "inline", path: test.path || "direct", seeks: 0,
    samples: [], events: [], errors: [], glErrors: [],
    frameCallbacks: 0, frameMetadata: null, timeAdvanced: false, readWhileHidden: false
  };
  let plain;
  let chroma;
  let callbackId;
  let stopped = false;
  let objectUrl;
  const listeners = [];
  const canvas2d = ui.section.querySelector(".canvas2d");
  const plainCanvas = ui.section.querySelector(".webgl");
  const chromaCanvas = ui.section.querySelector(".chroma");
  const context2d = canvas2d.getContext("2d", { willReadFrequently: true });
  const addEvent = (target, name, callback) => {
    target.addEventListener(name, callback);
    listeners.push(() => target.removeEventListener(name, callback));
  };
  const collectFrame = (_, metadata) => {
    if (stopped) return;
    result.frameCallbacks++;
    result.frameMetadata = {
      mediaTime: metadata.mediaTime, presentedFrames: metadata.presentedFrames,
      width: metadata.width, height: metadata.height
    };
    callbackId = ui.video.requestVideoFrameCallback(collectFrame);
  };
  for (const name of ["loadedmetadata", "loadeddata", "playing", "waiting", "stalled", "error"]) {
    addEvent(ui.video, name, () => {
      if (result.events.length < 60) result.events.push({ name, time: ui.video.currentTime, readyState: ui.video.readyState });
    });
  }
  for (const canvas of [plainCanvas, chromaCanvas]) {
    addEvent(canvas, "webglcontextlost", () => addUnique(result.errors, "WebGL上下文丢失"));
  }
  ui.status.textContent = "检测中";
  ui.section.scrollIntoView({ block: "start" });
  try {
    // Failures in one path must not prevent measurement of the others.
    try { plain = createRenderer(plainCanvas, false); } catch (error) { addUnique(result.errors, "WebGL: " + error); }
    try { chroma = createRenderer(chromaCanvas, true); } catch (error) { addUnique(result.errors, "抠绿: " + error); }
    let source;
    if (test.kind === "static") {
      source = makeControlImage();
      await withTimeout(source.decode(), 5000, "静态对照图解码超时");
      ui.video.replaceWith(source);
      source.style.cssText = "width:100%;aspect-ratio:3/4";
    } else {
      if (ui.video.requestVideoFrameCallback) callbackId = ui.video.requestVideoFrameCallback(collectFrame);
      if (test.path === "blob" || test.path === "mse") {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 12000);
        let bytes;
        try {
          const response = await fetch(test.url, { signal: controller.signal });
          if (!response.ok) throw new Error("素材请求 HTTP " + response.status);
          bytes = await response.arrayBuffer();
        } finally { clearTimeout(timer); }
        if (test.path === "blob") {
          objectUrl = URL.createObjectURL(new Blob([bytes], { type: "video/mp4" }));
          ui.video.src = objectUrl;
        } else {
          if (!window.MediaSource || !MediaSource.isTypeSupported(TESTS[0].codec)) throw new Error("本浏览器不支持该 MSE 类型");
          const media = new MediaSource();
          objectUrl = URL.createObjectURL(media);
          await waitEvent(media, "sourceopen", () => { ui.video.src = objectUrl; }, 8000);
          const buffer = media.addSourceBuffer(TESTS[0].codec);
          await waitEvent(buffer, "updateend", () => buffer.appendBuffer(bytes), 8000);
          media.endOfStream();
        }
      } else {
        ui.video.src = test.url;
      }
      try {
        await withTimeout(ui.video.play(), 8000, "播放请求超时");
      } catch (error) {
        addUnique(result.errors, "播放: " + error);
      }
      source = ui.video;
      if (test.path === "seek") {
        ui.video.pause();
        if (ui.video.readyState < 1) await waitEvent(ui.video, "loadedmetadata", () => {}, 5000);
      }
    }
    const started = performance.now();
    const duration = test.kind === "static" ? 1000 : 6000;
    let previousTime = ui.video.currentTime;
    while (performance.now() - started < duration) {
      if (test.path === "seek") {
        try {
          const target = 0.25 + (result.seeks % 8) * 0.4;
          await waitEvent(ui.video, "seeked", () => { ui.video.currentTime = target; }, 3000);
          result.seeks++;
        } catch (error) { addUnique(result.errors, "跳帧: " + error); break; }
      }
      if (document.hidden) result.readWhileHidden = true;
      const time = ui.video.currentTime;
      if (Math.abs(time - previousTime) > 0.001) result.timeAdvanced = true;
      previousTime = time;
      if (test.kind === "static" || (ui.video.readyState >= 2 && ui.video.videoWidth > 0)) {
        const sample = { at: Math.round(performance.now() - started), mediaTime: time, callbacks: result.frameCallbacks };
        try {
          context2d.clearRect(0, 0, 180, 240);
          context2d.drawImage(source, 0, 0, 180, 240);
          sample.canvas2d = pixelStats(canvas2d);
        } catch (error) { addUnique(result.errors, "Canvas: " + error); }
        for (const [key, renderer, canvas] of [["webgl", plain, plainCanvas], ["chroma", chroma, chromaCanvas]]) {
          if (!renderer) continue;
          try {
            const uploadError = renderer.draw(source);
            if (uploadError) addUnique(result.glErrors, key + ":上传绘制=" + uploadError);
            const stats = pixelStats(canvas, renderer.gl);
            const readError = renderer.gl.getError();
            if (readError) addUnique(result.glErrors, key + ":读取=" + readError);
            if (!uploadError && !readError && !renderer.gl.isContextLost()) sample[key] = stats;
          } catch (error) { addUnique(result.errors, key + ": " + error); }
        }
        result.samples.push(sample);
      }
      await sleep(250);
    }
    result.video = {
      readyState: ui.video.readyState, networkState: ui.video.networkState,
      width: ui.video.videoWidth, height: ui.video.videoHeight,
      currentTime: ui.video.currentTime, paused: ui.video.paused,
      error: ui.video.error ? { code: ui.video.error.code, message: ui.video.error.message } : null
    };
    ui.status.textContent = "已采样";
  } catch (error) {
    result.failure = String(error);
    ui.status.textContent = "未完成";
  } finally {
    stopped = true;
    if (callbackId !== undefined) ui.video.cancelVideoFrameCallback(callbackId);
    listeners.forEach(remove => remove());
    // Keep visible snapshots, but release decoders and GPU resources between cases.
    for (const canvas of [plainCanvas, chromaCanvas]) {
      try {
        const snapshot = new Image();
        snapshot.src = canvas.toDataURL();
        snapshot.style.cssText = "width:100%;aspect-ratio:3/4;background:repeating-conic-gradient(#555 0% 25%,#333 0% 50%) 0/16px 16px";
        canvas.replaceWith(snapshot);
      } catch { /* Numeric read failures are recorded above. */ }
    }
    if (test.kind !== "static" && !test.detached) {
      const note = document.createElement("p");
      note.textContent = "本组已停止并释放视频。上方时间变化／帧回调不等同于肉眼确认原生画面，请留意测试期间的视频。";
      ui.video.replaceWith(note);
    }
    ui.video.pause();
    ui.video.removeAttribute("src");
    ui.video.load();
    if (objectUrl) URL.revokeObjectURL(objectUrl);
    plain?.dispose();
    chroma?.dispose();
    ui.log.textContent = JSON.stringify(result, null, 2);
    report.cases.push(result);
    renderSummary();
  }
}

document.addEventListener("visibilitychange", () => {
  if (startButton.disabled && document.hidden) report.hiddenCount++;
});

startButton.addEventListener("click", async () => {
  startButton.disabled = true;
  copyButton.disabled = true;
  const sourceInput = document.querySelector("#source");
  sourceInput.disabled = true;
  casesHost.replaceChildren();
  report.cases = [];
  report.createdAt = new Date().toISOString();
  report.hiddenCount = 0;
  summary.classList.remove("visible");
  let localUrl;
  try {
    await withTimeout(collectEnvironment(), 5000, "设备信息读取超时").catch(error => { device.textContent = String(error); });
    const tests = [{ id: "static", label: "A · 静态图片对照", kind: "static", url: "" }];
    tests.push({ ...TESTS[0], id: "direct", label: "B · 原始 MP4 地址（基线）" });
    tests.push({ ...TESTS[0], id: "blob", label: "C · 下载后 Blob 播放", path: "blob" });
    tests.push({ ...TESTS[0], url: "./idle-fragmented.mp4", id: "fragment-direct", label: "D · 分片 MP4 直接播放" });
    tests.push({ ...TESTS[0], url: "./idle-fragmented.mp4", id: "mse", label: "E · MSE 分片媒体播放", path: "mse" });
    tests.push({ ...TESTS[0], id: "seek", label: "F · 暂停后逐次跳帧读取", path: "seek" });
    if (sourceInput.files[0]) {
      localUrl = URL.createObjectURL(sourceInput.files[0]);
      tests.push({ id: "local-inline", label: "本机 NPC · 页面内", url: localUrl, local: true });
      tests.push({ id: "local-detached", label: "本机 NPC · 离屏", url: localUrl, local: true, detached: true });
    }
    for (let index = 0; index < tests.length; index++) {
      startButton.textContent = "检测 " + (index + 1) + "/" + tests.length;
      await runCase(tests[index]);
    }
  } catch (error) {
    device.textContent += "\n检测中断: " + error;
  } finally {
    if (localUrl) URL.revokeObjectURL(localUrl);
    report.finishedAt = new Date().toISOString();
    renderSummary();
    summary.scrollIntoView({ behavior: "smooth", block: "start" });
    copyButton.disabled = false;
    startButton.textContent = "重新检测";
    startButton.disabled = false;
    sourceInput.disabled = false;
  }
});

copyButton.addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText(JSON.stringify(report, null, 2));
    copyButton.textContent = "已复制";
  } catch {
    copyButton.textContent = "无法复制，请截图";
  }
  setTimeout(() => { copyButton.textContent = "复制诊断结果"; }, 2000);
});

collectEnvironment().catch(error => { device.textContent = String(error); });
