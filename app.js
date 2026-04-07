import * as THREE from 'three';
import { OBJLoader } from 'three/addons/loaders/OBJLoader.js';
import { FaceLandmarker, FilesetResolver } from 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.3';

const state = {
  userPD: 63,
  irisDiameterMM: 11.8,
  currentMaterial: {
      mode: 'color',
      color: '#88aaff',
      metalness: 0.3,
      roughness: 0.5
    },
  frameWidthMM: 140,

  scaleDivisor3D: 165,

  appMode: 'tryon3d',
  calibrationMode: 'pd',

  occlusionEnabled: true,
  videoReady: false,
  isFaceTracking: false,
  smoothedIrisPx: null,

  manualRotX: 0,
  manualRotY: 0,
  manualRotZ: 0,

  pngOffsetX: 0,
  pngOffsetY: 0,

  focalLengthPx: 950,
  mirrorVideo: true,

  fitOffsetX: 0,
  fitOffsetY: 8,
  fitOffsetZ: 80,
};

const ui = {
  video: document.getElementById('video'),
  overlay2d: document.getElementById('overlay2d'),
  canvas3d: document.getElementById('threeCanvas'),
  status: document.getElementById('status'),
  instruction: document.getElementById('instruction'),
  debugPanel: document.getElementById('debugPanel'),
  controls: document.getElementById('controls'),
  mobileControlsToggle: document.getElementById('mobileControlsToggle'),
  frameSelector: document.getElementById('frameSelector'),

  mIpd: document.getElementById('mIpd'),
  mFaceWidth: document.getElementById('mFaceWidth'),
  mBridge: document.getElementById('mBridge'),
  mDistance: document.getElementById('mDistance'),
  mPxPerMm: document.getElementById('mPxPerMm'),

  pdInput: document.getElementById('pdInput'),
  irisInput: document.getElementById('irisInput'),
  frameWidthInput: document.getElementById('frameWidthInput'),
  pngOffsetXInput: document.getElementById('pngOffsetX'),
  pngOffsetYInput: document.getElementById('pngOffsetY'),
  pngUpload: document.getElementById('pngUpload'),
  objUpload: document.getElementById('objUpload'),
};

let faceLandmarker = null;
let glasses3D = null;
let framesCatalog = [];
let currentFrame = null;

const glassesPng = new Image();
glassesPng.src = './assets/images/pad_center.png';

const ctx2d = ui.overlay2d.getContext('2d');

const scene = new THREE.Scene();

const camera = new THREE.PerspectiveCamera(45, 16 / 9, 0.1, 2000);
camera.position.z = 550;

const renderer = new THREE.WebGLRenderer({
  canvas: ui.canvas3d,
  alpha: true,
  antialias: true,
  preserveDrawingBuffer: true,
});
renderer.setClearColor(0x000000, 0);
renderer.sortObjects = true;

scene.add(new THREE.AmbientLight(0xffffff, 0.7));
const light = new THREE.DirectionalLight(0xffffff, 0.8);
light.position.set(1, 1, 1);
scene.add(light);
const backLight = new THREE.DirectionalLight(0xffffff, 0.4);
backLight.position.set(-1, -1, -1);
scene.add(backLight);

function checkBrowserSupport() {
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new Error('Ваш браузер не поддерживает доступ к камере.');
  }
  if (!window.WebGLRenderingContext) {
    throw new Error('Ваш браузер не поддерживает WebGL.');
  }
}

function updateStatus(msg, isError = false) {
  if (!ui.status) return;
  ui.status.textContent = msg;
  ui.status.style.color = isError ? '#ff6b6b' : 'lime';
}

function hideInstruction() {
  if (!ui.instruction) return;
  ui.instruction.style.opacity = '0';
  setTimeout(() => {
    ui.instruction.style.display = 'none';
  }, 800);
}

function setActiveButton(group, activeId) {
  group.forEach((id) => {
    const btn = document.getElementById(id);
    if (!btn) return;
    btn.classList.toggle('active', id === activeId);
  });
}

function smoothValue(prev, next, alpha = 0.15) {
  if (next == null || Number.isNaN(next)) return prev;
  if (prev == null || Number.isNaN(prev)) return next;
  return prev * (1 - alpha) + next * alpha;
}

function dist2d(a, b, vw, vh) {
  return Math.hypot((a.x - b.x) * vw, (a.y - b.y) * vh);
}

function getCanvasPoint(lmPoint, width, height) {
  return {
    x: (state.mirrorVideo ? (1 - lmPoint.x) : lmPoint.x) * width,
    y: lmPoint.y * height,
  };
}

function clear2DOverlay() {
  ctx2d.clearRect(0, 0, ui.overlay2d.width, ui.overlay2d.height);
}

function resetMeasurementsUI() {
  if (ui.mIpd) ui.mIpd.textContent = '—';
  if (ui.mFaceWidth) ui.mFaceWidth.textContent = '—';
  if (ui.mBridge) ui.mBridge.textContent = '—';
  if (ui.mDistance) ui.mDistance.textContent = '—';
  if (ui.mPxPerMm) ui.mPxPerMm.textContent = '—';
}

function updateMeasurementsUI(m) {
  if (ui.mIpd) ui.mIpd.textContent = m.ipdMm ? `${m.ipdMm.toFixed(1)} мм` : '—';
  if (ui.mFaceWidth) ui.mFaceWidth.textContent = m.faceWidthMm ? `${m.faceWidthMm.toFixed(1)} мм` : '—';
  if (ui.mBridge) ui.mBridge.textContent = m.bridgeWidthMm ? `${m.bridgeWidthMm.toFixed(1)} мм` : '—';
  if (ui.mDistance) ui.mDistance.textContent = m.distanceMm ? `${(m.distanceMm / 10).toFixed(1)} см` : '—';
  if (ui.mPxPerMm) ui.mPxPerMm.textContent = m.pxPerMM ? m.pxPerMM.toFixed(2) : '—';
}

function updateDebug(m) {
  if (!ui.debugPanel) return;

  const vw = ui.video?.videoWidth || 0;
  const vh = ui.video?.videoHeight || 0;
  const cw = ui.canvas3d?.width || 0;
  const ch = ui.canvas3d?.height || 0;

  ui.debugPanel.innerHTML = `
    🎯 Mode: ${state.appMode}<br>
    🧭 Calibration: ${state.calibrationMode}<br>
    🪞 Mirror: ${state.mirrorVideo ? 'on' : 'off'}<br>
    👓 fitOffsetX: ${state.fitOffsetX}<br>
    👓 fitOffsetY: ${state.fitOffsetY}<br>
    👓 fitOffsetZ: ${state.fitOffsetZ}<br>
    X pitch: ${(m.pitch * 180 / Math.PI).toFixed(1)}°<br>
    Y yaw: ${(m.yaw * 180 / Math.PI).toFixed(1)}°<br>
    Z roll: ${(m.roll * 180 / Math.PI).toFixed(1)}°<br>
    IPD: ${m.ipdMm ? m.ipdMm.toFixed(1) + ' мм' : '—'}<br>
    Face: ${m.faceWidthMm ? m.faceWidthMm.toFixed(1) + ' мм' : '—'}<br>
    Bridge: ${m.bridgeWidthMm ? m.bridgeWidthMm.toFixed(1) + ' мм' : '—'}<br>
    Distance: ${m.distanceMm ? (m.distanceMm / 10).toFixed(1) + ' см' : '—'}<br>
    video: ${vw}x${vh}<br>
    canvas: ${cw}x${ch}<br>
    frame: ${currentFrame?.name ?? 'custom'}
  `;
}

function syncRenderSurfacesToVideo() {
  if (!ui.video.videoWidth || !ui.video.videoHeight) return;

  const vw = ui.video.videoWidth;
  const vh = ui.video.videoHeight;

  ui.overlay2d.width = vw;
  ui.overlay2d.height = vh;
  ui.canvas3d.width = vw;
  ui.canvas3d.height = vh;

  renderer.setSize(vw, vh, false);

  camera.aspect = vw / vh;
  camera.updateProjectionMatrix();
}

function normalizeAndCenterObject(obj) {
  // OBJ считается уже подготовленным и центрированным на мосте.
}

function applyMaterialsToGlasses(obj) {
  obj.traverse((child) => {
    if (child.isMesh) {
      child.material = new THREE.MeshStandardMaterial({
        color: 0x88aaff,
        metalness: 0.7,
        roughness: 0.25,
        transparent: true,
        opacity: 1,
        depthWrite: true,
        depthTest: true,
      });
      child.renderOrder = 10;
    }
  });
}

function clearCurrent3DGlasses() {
  if (!glasses3D) return;
  scene.remove(glasses3D);
  glasses3D.traverse((child) => {
    if (child.isMesh) {
      child.geometry?.dispose?.();
      if (Array.isArray(child.material)) {
        child.material.forEach((m) => m.dispose?.());
      } else {
        child.material?.dispose?.();
      }
    }
  });
  glasses3D = null;
}

function setCurrent3DGlasses(obj) {
  clearCurrent3DGlasses();

  glasses3D = obj;
  normalizeAndCenterObject(glasses3D);

  glasses3D.visible = false;
  scene.add(glasses3D);
}

function getFramesForCurrentMode() {
  const visibleFrames = framesCatalog.filter(frame => frame.enabled !== false);

  if (state.appMode === 'tryon3d') {
    return visibleFrames.filter(frame => frame.type === 'obj' || frame.type === 'both');}
  if (state.appMode === 'tryon2d') {
    return visibleFrames.filter(frame => frame.type === 'png' || frame.type === 'both');}
  return visibleFrames;
}

async function syncFrameWithCurrentMode() {
  const allowedFrames = getFramesForCurrentMode();

  if (allowedFrames.length === 0) {
    currentFrame = null;

    if (glasses3D) {
      scene.remove(glasses3D);
      glasses3D = null;
    }

    clear2DOverlay();
    return;
  }

  if (!currentFrame || !allowedFrames.some(f => f.id === currentFrame.id)) {
    await selectFrame(allowedFrames[0].id);
  }
}

function loadObjFromUrl(url) {
  return new Promise((resolve, reject) => {
    const loader = new OBJLoader();
    loader.load(url, resolve, undefined, reject);
  });
}

function loadObjFromFile(file) {
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const loader = new OBJLoader();
      const obj = loader.parse(reader.result);
      setCurrent3DGlasses(obj);
      updateStatus(`✅ Загружена OBJ модель: ${file.name}`);
    } catch (error) {
      console.error(error);
      updateStatus('❌ Не удалось прочитать OBJ файл', true);
    }
  };
  reader.readAsText(file);
}

function loadPngFromUrl(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = url;
  });
}

function loadPngFromFile(file) {
  const url = URL.createObjectURL(file);
  const img = new Image();
  img.onload = () => {
    glassesPng.src = img.src;
    updateStatus(`✅ Загружена PNG оправа: ${file.name}`);
    URL.revokeObjectURL(url);
  };
  img.onerror = () => {
    updateStatus('❌ Не удалось загрузить PNG файл', true);
    URL.revokeObjectURL(url);
  };
  img.src = url;
}

async function loadFramesCatalog() {
  const res = await fetch('./data/frames.json');
  if (!res.ok) {
    throw new Error(`Не удалось загрузить frames.json: ${res.status}`);
  }

  framesCatalog = await res.json();
  framesCatalog = framesCatalog.filter(frame => frame.enabled !== false);

  if (framesCatalog.length > 0) {
    await selectFrame(framesCatalog[0].id);
  }
}

async function selectFrame(frameId) {
  const frame = framesCatalog.find(f => f.id === frameId);
  if (!frame) return;

  currentFrame = frame;

  state.frameWidthMM = frame.frameWidthMM ?? 140;
  state.fitOffsetX = frame.fitOffsetX ?? 0;
  state.fitOffsetY = frame.fitOffsetY ?? 0;
  state.fitOffsetZ = frame.fitOffsetZ ?? 0;
  state.pngOffsetX = frame.pngOffsetX ?? 0;
  state.pngOffsetY = frame.pngOffsetY ?? 0;
  state.scaleDivisor3D = frame.scaleDivisor3D ?? 200;
  state.currentMaterial = frame.material ?? {
    mode: 'color',
    color: '#88aaff',
    metalness: 0.3,
    roughness: 0.5
  };

  if (frame.type === 'png') {
    if (glasses3D) {
      scene.remove(glasses3D);
      glasses3D = null;
    }
  }

  if ((frame.type === 'png' || frame.type === 'both') && frame.pngUrl) {
    glassesPng.src = frame.pngUrl;
  }

  if ((frame.type === 'obj' || frame.type === 'both') && frame.objUrl) {
    await new Promise((resolve, reject) => {
      const loader = new OBJLoader();
      loader.load(
        frame.objUrl,
        (obj) => {
          setCurrent3DGlasses(obj);

          if (glasses3D) {
            applyFrameMaterial(glasses3D, state.currentMaterial);
          }

          updateStatus(`✅ Загружена оправа: ${frame.name}`);
          resolve();
        },
        undefined,
        (err) => {
          console.warn('OBJ load error:', err);
          reject(err);
        }
      );
    });
  } else if (frame.type === 'png') {
    updateStatus(`✅ Загружена PNG оправа: ${frame.name}`);
  }

  if (frame.type === 'png' && state.appMode === 'tryon3d') {
    state.appMode = 'tryon2d';
    setActiveButton(['mode3d', 'mode2d', 'modeMeasure'], 'mode2d');
  }
}

function renderFramesList() {
  const container = document.getElementById('frameSelector');
  if (!container) return;

  container.innerHTML = '';

  const filteredFrames = getFramesForCurrentMode();

  filteredFrames.forEach((frame) => {
    const btn = document.createElement('button');
    btn.className = 'frame-btn';
    btn.textContent = frame.name || frame.id;

    if (currentFrame && currentFrame.id === frame.id) {
      btn.classList.add('active');
    }

    btn.onclick = async () => {
      await selectFrame(frame.id);

      container.querySelectorAll('.frame-btn').forEach(el => el.classList.remove('active'));
      btn.classList.add('active');
    };

    container.appendChild(btn);
  });

  if (filteredFrames.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'frame-empty';

    if (state.appMode === 'tryon3d') {
      empty.textContent = 'Нет 3D оправ для этого режима';
    } else if (state.appMode === 'tryon2d') {
      empty.textContent = 'Нет PNG оправ для этого режима';
    } else {
      empty.textContent = 'Нет доступных оправ';
    }

    container.appendChild(empty);
  }
}

async function initFaceLandmarker() {
  const vision = await FilesetResolver.forVisionTasks(
    'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.3/wasm'
  );

  faceLandmarker = await FaceLandmarker.createFromOptions(vision, {
    baseOptions: {
      modelAssetPath:
        'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task',
    },
    runningMode: 'VIDEO',
    numFaces: 1,
    outputFaceBlendshapes: false,
    outputFacialTransformationMatrixes: false,
  });

  updateStatus('✅ Face tracking готов');
}

async function setupCamera() {
  const stream = await navigator.mediaDevices.getUserMedia({
    video: {
      facingMode: 'user',
      width: { ideal: 1280 },
      height: { ideal: 720 },
    },
    audio: false,
  });

  ui.video.srcObject = stream;

  await new Promise((resolve) => {
    ui.video.onloadedmetadata = async () => {
      await ui.video.play();
      resolve();
    };
  });

  state.videoReady = true;
  syncRenderSurfacesToVideo();
  hideInstruction();
}

function estimateIrisDiameterPx(lm, vw, vh) {
  const leftIrisLeft = lm[476];
  const leftIrisRight = lm[474];
  const rightIrisLeft = lm[471];
  const rightIrisRight = lm[469];

  if (!leftIrisLeft || !leftIrisRight || !rightIrisLeft || !rightIrisRight) {
    return null;
  }

  const leftDiameter = dist2d(leftIrisLeft, leftIrisRight, vw, vh);
  const rightDiameter = dist2d(rightIrisLeft, rightIrisRight, vw, vh);
  return (leftDiameter + rightDiameter) / 2;
}

function measureFace(lm, vw, vh) {
  const leftEyeOuter = lm[33];
  const rightEyeOuter = lm[263];
  const leftIrisCenter = lm[468];
  const rightIrisCenter = lm[473];
  const noseBridge = lm[168];
  const noseTip = lm[1];
  const leftCheek = lm[234];
  const rightCheek = lm[454];
  const noseLeft = lm[193];
  const noseRight = lm[417];

  const faceWidthPx = dist2d(leftCheek, rightCheek, vw, vh);
  const ipdPx = dist2d(leftIrisCenter, rightIrisCenter, vw, vh);

  const rawEyeOuterDistPx = dist2d(leftEyeOuter, rightEyeOuter, vw, vh);
  state.smoothedEyeOuterDistPx = smoothValue(
    state.smoothedEyeOuterDistPx,
    rawEyeOuterDistPx,
    0.12
  );
  const eyeOuterDistPx = state.smoothedEyeOuterDistPx ?? rawEyeOuterDistPx;

  const bridgeWidthPx = dist2d(noseLeft, noseRight, vw, vh);

  const dx = (rightEyeOuter.x - leftEyeOuter.x) * vw;
  const dy = (rightEyeOuter.y - leftEyeOuter.y) * vh;
  const roll = Math.atan2(dy, dx);

  const faceCenterX = (leftCheek.x + rightCheek.x) / 2;
  const yaw = (noseBridge.x - faceCenterX) * 0.6;
  const pitch = (noseTip.y - noseBridge.y) * 0.8;

  const irisPxRaw = estimateIrisDiameterPx(lm, vw, vh);
  state.smoothedIrisPx = smoothValue(state.smoothedIrisPx, irisPxRaw, 0.15);

  let pxPerMM = null;
  if (state.calibrationMode === 'pd' && state.userPD > 0) {
    pxPerMM = ipdPx / state.userPD;
  } else if (state.smoothedIrisPx && state.irisDiameterMM > 0) {
    pxPerMM = state.smoothedIrisPx / state.irisDiameterMM;
  }

  const distanceMm = state.smoothedIrisPx
    ? (state.irisDiameterMM * state.focalLengthPx) / state.smoothedIrisPx
    : null;

  return {
    ipdPx,
    eyeOuterDistPx,
    faceWidthPx,
    bridgeWidthPx,
    irisPx: state.smoothedIrisPx,
    pxPerMM,
    ipdMm: pxPerMM ? ipdPx / pxPerMM : null,
    faceWidthMm: pxPerMM ? faceWidthPx / pxPerMM : null,
    bridgeWidthMm: pxPerMM ? bridgeWidthPx / pxPerMM : null,
    distanceMm,
    roll,
    yaw,
    pitch,
    noseBridge,
    leftIrisCenter,
    rightIrisCenter,
    leftCheek,
    rightCheek,
  };
}

function applyOcclusionByOpacity(yawAngle) {
  if (!glasses3D || !state.occlusionEnabled) return;

  const box = new THREE.Box3().setFromObject(glasses3D);
  const minX = box.min.x;
  const maxX = box.max.x;
  const visibleEdgeRatio = 0.2;
  const hiddenSide = yawAngle > 0 ? 'left' : 'right';

  glasses3D.traverse((child) => {
    if (!child.isMesh) return;

    child.material.transparent = true;
    child.material.opacity = 1;

    const childBox = new THREE.Box3().setFromObject(child);
    const childMinX = childBox.min.x;
    const childMaxX = childBox.max.x;
    const isLeftPart = childMaxX < minX + (maxX - minX) * visibleEdgeRatio;
    const isRightPart = childMinX > maxX - (maxX - minX) * visibleEdgeRatio;

    if ((hiddenSide === 'left' && isLeftPart) || (hiddenSide === 'right' && isRightPart)) {
      child.material.opacity = 0.18;
    }
  });
}

function screenToWorldAtZ(screenX, screenY, targetZ, camera, width, height) {
  const ndc = new THREE.Vector3(
    (screenX / width) * 2 - 1,
    -(screenY / height) * 2 + 1,
    0.5
  );
  ndc.unproject(camera);
  const dir = ndc.sub(camera.position).normalize();
  const distance = (targetZ - camera.position.z) / dir.z;

  return camera.position.clone().add(dir.multiplyScalar(distance));
}

function render3DGlasses(m) {
  clear2DOverlay();
  if (!currentFrame || (currentFrame.type !== 'obj' && currentFrame.type !== 'both')) {
    return;
  }
  if (!glasses3D) return;
  glasses3D.visible = true;

  let scale = (m.eyeOuterDistPx / (state.scaleDivisor3D || 80)) * (state.userPD / 63);
  if (scale < 0.1) scale = 0.1;

  const perspectiveFactor = 1 - Math.abs(Math.sin(m.yaw)) * 0.18;
  glasses3D.scale.set(scale * perspectiveFactor, scale, scale);

  const cw = ui.canvas3d.width;
  const ch = ui.canvas3d.height;

  const nose = getCanvasPoint(m.noseBridge, cw, ch);

  const nx = -cw / 2 + nose.x + state.fitOffsetX;
  const ny = -nose.y + ch / 2 + state.fitOffsetY;
  const nz = 120 + state.fitOffsetZ;

  const shiftX = 0;
  const shiftY = -Math.abs(Math.sin(m.yaw)) * 0.5;
  const shiftZ = -Math.abs(Math.sin(m.yaw)) * 1.2;

  const targetPos = new THREE.Vector3(
    nx + shiftX,
    ny + shiftY,
    nz + shiftZ
  );

  const targetEuler = new THREE.Euler(
    -Math.PI / 2 + m.pitch + state.manualRotX,
    -m.roll + state.manualRotZ,
    -m.yaw + state.manualRotY,
    'XYZ'
  );

  const targetQuat = new THREE.Quaternion().setFromEuler(targetEuler);

  glasses3D.position.lerp(targetPos, 0.35);
  glasses3D.quaternion.slerp(targetQuat, 0.35);

  if (state.occlusionEnabled) {
    applyOcclusionByOpacity(m.roll);
  } else {
    glasses3D.traverse((child) => {
      if (child.isMesh) child.material.opacity = 1;
    });
  }
}

function render2DGlasses(m) {
  if (!currentFrame || (currentFrame.type !== 'png' && currentFrame.type !== 'both')) {
    clear2DOverlay();
    if (glasses3D) glasses3D.visible = false;
    return;
  }

  if (glasses3D) glasses3D.visible = false;
  clear2DOverlay();

  if (!glassesPng.complete) return;

  const frameWidthPx = m.eyeOuterDistPx * (state.frameWidthMM / state.userPD) * 0.8;
  const frameHeightPx = frameWidthPx * (glassesPng.height / glassesPng.width);
  const perspectiveFactor = 1 - Math.abs(Math.sin(m.yaw)) * 0.1;
  const visibleWidth = frameWidthPx * perspectiveFactor;

  const nose = getCanvasPoint(
    m.noseBridge,
    ui.overlay2d.width,
    ui.overlay2d.height
  );

  ctx2d.save();
  ctx2d.translate(
    nose.x + state.pngOffsetX + state.fitOffsetX,
    nose.y + state.pngOffsetY + state.fitOffsetY
  );

  ctx2d.rotate(-m.roll);

  ctx2d.drawImage(
    glassesPng,
    -visibleWidth / 2,
    -frameHeightPx / 2,
    visibleWidth,
    frameHeightPx
  );

  ctx2d.restore();
}
const textureLoader = new THREE.TextureLoader();

function applyFrameMaterial(obj, materialConfig = {}) {
  const mode = materialConfig.mode || 'color';

  if (mode === 'texture' && materialConfig.textureUrl) {
    textureLoader.load(materialConfig.textureUrl, (texture) => {
      texture.wrapS = THREE.RepeatWrapping;
      texture.wrapT = THREE.RepeatWrapping;

      texture.minFilter = THREE.LinearMipmapLinearFilter;
      texture.magFilter = THREE.LinearFilter;
      texture.generateMipmaps = true;
      texture.anisotropy = renderer.capabilities.getMaxAnisotropy();

      obj.traverse((child) => {
        if (!child.isMesh) return;

        child.material = new THREE.MeshStandardMaterial({
          map: texture,
          metalness: materialConfig.metalness ?? 0.2,
          roughness: materialConfig.roughness ?? 0.7,
          transparent: true,
          opacity: 1,
          depthWrite: true,
          depthTest: true,
        });

        child.material.needsUpdate = true;
      });
    });
    return;
  }

  const color = materialConfig.color ?? '#88aaff';

  obj.traverse((child) => {
    if (!child.isMesh) return;

    child.material = new THREE.MeshStandardMaterial({
      color,
      metalness: materialConfig.metalness ?? 0.3,
      roughness: materialConfig.roughness ?? 0.5,
      transparent: true,
      opacity: 1,
      depthWrite: true,
      depthTest: true,
    });

    child.material.needsUpdate = true;
  });
}

function drawLine(p1, p2, color, label, textOffsetX = 10, textOffsetY = -8) {
  ctx2d.strokeStyle = color;
  ctx2d.fillStyle = color;
  ctx2d.lineWidth = 2;
  ctx2d.beginPath();
  ctx2d.moveTo(p1.x, p1.y);
  ctx2d.lineTo(p2.x, p2.y);
  ctx2d.stroke();

  if (label) {
    ctx2d.font = '16px Arial';
    ctx2d.fillText(label, p2.x + textOffsetX, p2.y + textOffsetY);
  }
}

function drawPoint(p, color = '#00ff88', radius = 4) {
  ctx2d.fillStyle = color;
  ctx2d.beginPath();
  ctx2d.arc(p.x, p.y, radius, 0, Math.PI * 2);
  ctx2d.fill();
}

function renderMeasurements(m) {
  if (glasses3D) glasses3D.visible = false;
  clear2DOverlay();

  const leftCheek = getCanvasPoint(m.leftCheek, ui.overlay2d.width, ui.overlay2d.height);
  const rightCheek = getCanvasPoint(m.rightCheek, ui.overlay2d.width, ui.overlay2d.height);
  const leftIris = getCanvasPoint(m.leftIrisCenter, ui.overlay2d.width, ui.overlay2d.height);
  const rightIris = getCanvasPoint(m.rightIrisCenter, ui.overlay2d.width, ui.overlay2d.height);

  drawLine(leftCheek, rightCheek, '#00ff88', `Face: ${m.faceWidthMm?.toFixed(1) ?? '—'} mm`);
  drawLine(leftIris, rightIris, '#4dc3ff', `IPD: ${m.ipdMm?.toFixed(1) ?? '—'} mm`, 10, 18);

  drawPoint(leftCheek);
  drawPoint(rightCheek);
  drawPoint(leftIris, '#4dc3ff');
  drawPoint(rightIris, '#4dc3ff');

  ctx2d.fillStyle = '#ffffff';
  ctx2d.font = '18px Arial';
  ctx2d.fillText(`Bridge: ${m.bridgeWidthMm?.toFixed(1) ?? '—'} mm`, 18, 32);
  ctx2d.fillText(`Distance: ${m.distanceMm ? (m.distanceMm / 10).toFixed(1) : '—'} cm`, 18, 58);
  ctx2d.fillText(`Calibration: ${state.calibrationMode === 'pd' ? 'PD' : 'Iris'}`, 18, 84);
}

function hideAllModes() {
  clear2DOverlay();
  resetMeasurementsUI();
  if (glasses3D) glasses3D.visible = false;
}

function processFace(result) {
  if (!result.faceLandmarks?.length) {
    if (state.isFaceTracking) {
      state.isFaceTracking = false;
      hideAllModes();
      updateStatus('⚠️ Лицо потеряно');
      if (ui.debugPanel) ui.debugPanel.innerHTML = 'Ориентация: лицо не найдено';
    }
    return;
  }

  if (!state.isFaceTracking) {
    state.isFaceTracking = true;
    updateStatus('✅ Лицо найдено');
  }

  const lm = result.faceLandmarks[0];
  const m = measureFace(lm, ui.video.videoWidth, ui.video.videoHeight);

  updateMeasurementsUI(m);
  updateDebug(m);

  if (state.appMode === 'tryon3d') {
    render3DGlasses(m);
  } else if (state.appMode === 'tryon2d') {
    render2DGlasses(m);
  } else {
    renderMeasurements(m);
  }
}

function animate() {
  requestAnimationFrame(animate);

  if (faceLandmarker && state.videoReady) {
    const result = faceLandmarker.detectForVideo(ui.video, performance.now());
    processFace(result);
  }

  renderer.render(scene, camera);
}

function captureComposite() {
  const tempCanvas = document.createElement('canvas');
  tempCanvas.width = ui.video.videoWidth;
  tempCanvas.height = ui.video.videoHeight;
  const tempCtx = tempCanvas.getContext('2d');

  if (state.mirrorVideo) {
    tempCtx.save();
    tempCtx.scale(-1, 1);
    tempCtx.drawImage(ui.video, -tempCanvas.width, 0, tempCanvas.width, tempCanvas.height);
    tempCtx.restore();
  } else {
    tempCtx.drawImage(ui.video, 0, 0, tempCanvas.width, tempCanvas.height);
  }

  if (ui.overlay2d.width && ui.overlay2d.height) {
    tempCtx.drawImage(ui.overlay2d, 0, 0, tempCanvas.width, tempCanvas.height);
  }

  renderer.render(scene, camera);

  if (ui.canvas3d.width && ui.canvas3d.height) {
    tempCtx.drawImage(ui.canvas3d, 0, 0, tempCanvas.width, tempCanvas.height);
  }

  const link = document.createElement('a');
  link.download = `tryon_${Date.now()}.png`;
  link.href = tempCanvas.toDataURL('image/png');
  link.click();
}

function bindUI() {
  const mode3d = document.getElementById('mode3d');
  const mode2d = document.getElementById('mode2d');
  const modeMeasure = document.getElementById('modeMeasure');

  const calibPD = document.getElementById('calibPD');
  const calibIris = document.getElementById('calibIris');

  const pdInputBtn = document.getElementById('pdInputBtn');
  const irisInputBtn = document.getElementById('irisInputBtn');
  const frameWidthBtn = document.getElementById('frameWidthBtn');

  const rotXPlus = document.getElementById('rotXPlus');
  const rotXMinus = document.getElementById('rotXMinus');
  const rotYPlus = document.getElementById('rotYPlus');
  const rotYMinus = document.getElementById('rotYMinus');
  const rotZPlus = document.getElementById('rotZPlus');
  const rotZMinus = document.getElementById('rotZMinus');
  const resetRot = document.getElementById('resetRot');

  const toggleOcclusion = document.getElementById('toggleOcclusion');
  const captureBtn = document.getElementById('captureBtn');

  if (mode3d) {
    mode3d.onclick = async () => {
      state.appMode = 'tryon3d';
      setActiveButton(['mode3d', 'mode2d', 'modeMeasure'], 'mode3d');
      updateStatus('👓 Режим: 3D примерка');

      await syncFrameWithCurrentMode();
      renderFramesList();
    };
  }

  if (mode2d) {
    mode2d.onclick = async () => {
      state.appMode = 'tryon2d';
      setActiveButton(['mode3d', 'mode2d', 'modeMeasure'], 'mode2d');
      updateStatus('🖼️ Режим: PNG примерка');

      await syncFrameWithCurrentMode();
      renderFramesList();
    };
  }

  if (modeMeasure) {
    modeMeasure.onclick = () => {
      state.appMode = 'measure';
      setActiveButton(['mode3d', 'mode2d', 'modeMeasure'], 'modeMeasure');
      updateStatus('📏 Режим: измерение лица');

      renderFramesList();
    };
  }

  if (calibPD) {
    calibPD.onclick = () => {
      state.calibrationMode = 'pd';
      setActiveButton(['calibPD', 'calibIris'], 'calibPD');
      updateStatus('📐 Калибровка: по PD');
    };
  }

  if (calibIris) {
    calibIris.onclick = () => {
      state.calibrationMode = 'iris';
      setActiveButton(['calibPD', 'calibIris'], 'calibIris');
      updateStatus('👁️ Калибровка: по радужке');
    };
  }

  if (pdInputBtn && ui.pdInput) {
    pdInputBtn.onclick = () => {
      const val = parseFloat(ui.pdInput.value);
      if (val >= 50 && val <= 80) {
        state.userPD = val;
        updateStatus(`✅ PD установлен: ${val} мм`);
      } else {
        updateStatus('⚠️ PD должен быть в диапазоне 50–80 мм', true);
      }
    };
  }

  if (irisInputBtn && ui.irisInput) {
    irisInputBtn.onclick = () => {
      const val = parseFloat(ui.irisInput.value);
      if (val >= 10.5 && val <= 13) {
        state.irisDiameterMM = val;
        updateStatus(`✅ Диаметр радужки установлен: ${val} мм`);
      } else {
        updateStatus('⚠️ Диаметр радужки должен быть 10.5–13 мм', true);
      }
    };
  }

  if (frameWidthBtn && ui.frameWidthInput) {
    frameWidthBtn.onclick = () => {
      const val = parseFloat(ui.frameWidthInput.value);
      if (val >= 110 && val <= 170) {
        state.frameWidthMM = val;
        updateStatus(`✅ Ширина оправы: ${val} мм`);
      } else {
        updateStatus('⚠️ Ширина оправы должна быть 110–170 мм', true);
      }
    };
  }

  if (ui.pngOffsetXInput) {
    ui.pngOffsetXInput.addEventListener('input', () => {
      state.pngOffsetX = parseFloat(ui.pngOffsetXInput.value) || 0;
    });
  }

  if (ui.pngOffsetYInput) {
    ui.pngOffsetYInput.addEventListener('input', () => {
      state.pngOffsetY = parseFloat(ui.pngOffsetYInput.value) || 0;
    });
  }

  if (rotXPlus) rotXPlus.onclick = () => { state.manualRotX += 0.05; };
  if (rotXMinus) rotXMinus.onclick = () => { state.manualRotX -= 0.05; };
  if (rotYPlus) rotYPlus.onclick = () => { state.manualRotY += 0.05; };
  if (rotYMinus) rotYMinus.onclick = () => { state.manualRotY -= 0.05; };
  if (rotZPlus) rotZPlus.onclick = () => { state.manualRotZ += 0.05; };
  if (rotZMinus) rotZMinus.onclick = () => { state.manualRotZ -= 0.05; };

  if (resetRot) {
    resetRot.onclick = () => {
      state.manualRotX = 0;
      state.manualRotY = 0;
      state.manualRotZ = 0;
      updateStatus('↺ Ручные углы сброшены');
    };
  }

  if (toggleOcclusion) {
    toggleOcclusion.onclick = (e) => {
      state.occlusionEnabled = !state.occlusionEnabled;
      e.currentTarget.textContent = state.occlusionEnabled ? 'Обрезка: Вкл' : 'Обрезка: Выкл';
      updateStatus(`🪄 Обрезка ${state.occlusionEnabled ? 'включена' : 'выключена'}`);
    };
  }

  if (captureBtn) {
    captureBtn.onclick = captureComposite;
  }

  if (ui.pngUpload) {
    ui.pngUpload.addEventListener('change', (e) => {
      const file = e.target.files?.[0];
      if (file) loadPngFromFile(file);
    });
  }

  if (ui.objUpload) {
    ui.objUpload.addEventListener('change', (e) => {
      const file = e.target.files?.[0];
      if (file) loadObjFromFile(file);
    });
  }
}

window.addEventListener('resize', () => {
  if (ui.video.videoWidth && ui.video.videoHeight) {
    syncRenderSurfacesToVideo();
  } else {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  }
});

async function init() {
  try {
    updateStatus('🟡 Шаг 1/5: привязка UI...');
    bindUI();

    updateStatus('🟡 Шаг 2/5: запрос камеры...');
    await setupCamera();

    updateStatus('🟡 Шаг 3/5: инициализация face tracking...');
    await initFaceLandmarker();

    updateStatus('🟡 Шаг 4/5: загрузка каталога оправ...');
    await loadFramesCatalog();

    updateStatus('🟡 Шаг 5/5: рендер каталога...');
    renderFramesList();

    updateStatus('✅ Сервис готов');
    animate();
  } catch (error) {
    console.error('INIT ERROR:', error);
    updateStatus(`❌ Ошибка запуска: ${error.message}`, true);
    if (ui.debugPanel) ui.debugPanel.textContent = String(error);
  }
}

init();
