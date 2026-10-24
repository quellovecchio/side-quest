import {
  Color3, Color4, DefaultRenderingPipeline, DirectionalLight, Engine, HemisphericLight,
  ImageProcessingConfiguration, Mesh, MeshBuilder, ReflectionProbe, RenderTargetTexture, Scene, SSAO2RenderingPipeline,
  ShadowGenerator, StandardMaterial, Texture, ParticleSystem, DynamicTexture, Vector3, VolumetricLightScatteringPostProcess,
} from "@babylonjs/core";
import { CloudField } from "./sky/Clouds";
import { Sky } from "./sky/Sky";
import { dayLight } from "./sky/TimeOfDay";
import { createTerrain, SPAWN, WORLD } from "./world/terrain";
import { terrainMaterial } from "./world/materials";
import { dirtTex, forestFloorTex, grassGroundTex, mossTex, rockTex } from "./world/textures";
import { createRocks, STONES } from "./world/rocks";
import { createVegetation } from "./world/vegetation";
import { Player } from "./player/Player";
import { createHud } from "./hud";
import { createGraphicsSettings } from "./settings";

// Mattina presto: sole basso (ombre lunghe, raggi fra i tronchi), luce calda.
const HOUR = 8.2;

async function main(): Promise<void> {
  const canvas = document.getElementById("game") as HTMLCanvasElement;
  const engine = new Engine(canvas, true, { stencil: true, antialias: false, powerPreference: "high-performance" }, false);
  const scene = new Scene(engine);
  scene.clearColor = new Color4(0, 0, 0, 1);
  // lascia disegnare l'overlay di caricamento prima del lavoro pesante
  await new Promise((r) => setTimeout(r, 50));

  // ── luce e cielo (il cielo è quello di footie-stars, vedi src/sky) ──
  const day = dayLight(HOUR);
  const sun = new DirectionalLight("sun", day.sunDir.clone(), scene);
  sun.diffuse = new Color3(1.0, 0.88, 0.72);
  sun.intensity = 2.6;
  sun.position = day.sunDir.scale(-400);
  const hemi = new HemisphericLight("sky", new Vector3(0, 1, 0), scene);
  // il cielo è la luce che riempie le ombre del bosco: forte e azzurra, come fuori
  hemi.diffuse = Color3.Lerp(day.zenith, day.horizon, 0.5).scale(0.9).add(new Color3(0.08, 0.08, 0.06));
  hemi.groundColor = new Color3(0.22, 0.2, 0.12);
  hemi.intensity = 1.25;
  hemi.specular = Color3.Black();

  // foschia del bosco: il colore dell'orizzonte del cielo, appena verdastra
  const fog = Color3.Lerp(day.horizon, new Color3(0.55, 0.62, 0.58), 0.3);
  scene.fogMode = Scene.FOGMODE_EXP2;
  scene.fogDensity = 0.0055;
  scene.fogColor = fog;
  new CloudField(scene, day.sunDir, { coverage: 0.55 });
  const sky = new Sky(scene, day, fog);

  // ambiente per i riflessi del metallo: il cielo stesso, catturato una volta
  const probe = new ReflectionProbe("envProbe", 128, scene, true);
  probe.renderList!.push(sky.mesh);
  probe.refreshRate = RenderTargetTexture.REFRESHRATE_RENDER_ONCE;

  // ── mondo ──
  const t0 = performance.now();
  const lap = (what: string): void => console.log(`[load] ${what}: ${Math.round(performance.now() - t0)} ms`);
  const terrain = createTerrain(scene);
  lap("terreno");
  terrain.mesh.material = terrainMaterial(scene, {
    grass: grassGroundTex(scene), floor: forestFloorTex(scene), dirt: dirtTex(scene), rock: rockTex(scene), moss: mossTex(scene),
    splat: terrain.splat, worldSize: WORLD,
  });
  lap("texture terreno");
  const rocks = createRocks(scene);
  lap("rocce");
  const veg = createVegetation(scene, rocks.colliders);
  lap("vegetazione");

  // ── ombre ──
  // ⚠️ Il sole non si muove e il mondo è statico: UNA shadow map da 4096 su tutta la conca
  // (~8 cm per texel), disegnata una volta sola. Le cascate rifatte ogni frame costavano due terzi
  // del frame su una GPU integrata. Quando arriveranno cose che si muovono, servirà una cascata
  // vicina in più solo per loro.
  const shadows = new ShadowGenerator(4096, sun);
  shadows.usePercentageCloserFiltering = true;
  shadows.filteringQuality = ShadowGenerator.QUALITY_HIGH;
  shadows.bias = 0.0006;
  shadows.normalBias = 0.02;
  sun.autoCalcShadowZBounds = true;
  const shadowMap = shadows.getShadowMap()!;
  for (const m of [...rocks.casters, ...veg.casters]) { shadows.addShadowCaster(m, false); m.receiveShadows = true; }
  for (const m of veg.receivers) m.receiveShadows = true;
  terrain.mesh.receiveShadows = true;
  shadowMap.refreshRate = RenderTargetTexture.REFRESHRATE_RENDER_ONCE;

  // ── giocatore ──
  const hud = createHud({ x: STONES.x, z: STONES.z, label: "Le pietre erette" });
  const player = new Player(scene, terrain.height, [...rocks.colliders, ...veg.colliders], probe.cubeTexture, hud, SPAWN, STONES);
  const cam = player.camera;
  scene.activeCamera = cam;
  scene.setRenderingAutoClearDepthStencil(1, true, true, false);

  // erba lontana spenta: sotto la nebbia non si vede, e costa
  let grassDist = 70;
  const near = (m: Mesh, d: number): boolean => {
    const b = m.getBoundingInfo().boundingSphere;
    return Math.hypot(b.centerWorld.x - cam.position.x, b.centerWorld.z - cam.position.z) - b.radiusWorld < d;
  };
  scene.onBeforeRenderObservable.add(() => {
    for (const g of veg.grass) g.setEnabled(near(g, grassDist));
  });

  // ── post-processing: HDR, ACES, bloom, AO, raggi di luce ──
  const pipe = new DefaultRenderingPipeline("post", true, scene, [cam]);
  pipe.samples = 4;
  pipe.fxaaEnabled = false;
  pipe.bloomEnabled = true;
  pipe.bloomThreshold = 0.9;
  pipe.bloomWeight = 0.22;
  pipe.bloomKernel = 64;
  pipe.bloomScale = 0.5;
  pipe.imageProcessingEnabled = true;
  const ip = pipe.imageProcessing;
  ip.toneMappingEnabled = true;
  ip.toneMappingType = ImageProcessingConfiguration.TONEMAPPING_ACES;
  ip.exposure = 1.05;
  ip.contrast = 1.12;
  ip.vignetteEnabled = true;
  ip.vignetteWeight = 2.2;
  ip.vignetteColor = new Color4(0.05, 0.04, 0.02, 0);
  ip.vignetteStretch = 0.4;
  pipe.grainEnabled = true;
  pipe.grain.intensity = 5;
  pipe.grain.animated = true;
  pipe.sharpenEnabled = true;
  pipe.sharpen.edgeAmount = 0.25;

  const ssao = new SSAO2RenderingPipeline("ssao", scene, { ssaoRatio: 0.5, blurRatio: 1 }, [cam]);
  ssao.radius = 1.6;
  ssao.totalStrength = 1.1;
  ssao.base = 0.15;
  ssao.samples = 16;
  ssao.maxZ = 120;
  ssao.expensiveBlur = true;

  // il sole come disco lontano: sorgente dei raggi che filtrano fra le chiome
  const sunDisc = MeshBuilder.CreateDisc("sunDisc", { radius: 17, tessellation: 32 }, scene);
  sunDisc.billboardMode = Mesh.BILLBOARDMODE_ALL;
  const sm = new StandardMaterial("sunDiscMat", scene);
  sm.emissiveColor = new Color3(2.2, 1.9, 1.4); sm.disableLighting = true; sm.fogEnabled = false;
  sunDisc.material = sm;
  sunDisc.applyFog = false;
  sunDisc.isPickable = false;
  const vls = new VolumetricLightScatteringPostProcess("godrays", 0.5, cam, sunDisc, 90, Texture.BILINEAR_SAMPLINGMODE, engine, false);
  vls.exposure = 0.18;
  vls.decay = 0.965;
  vls.weight = 0.6;
  vls.density = 0.92;
  vls.excludedMeshes.push(sky.mesh, ...veg.grass, ...player.viewmodelMeshes);
  scene.onBeforeRenderObservable.add(() => sunDisc.position.copyFrom(cam.position).addInPlace(day.sunDir.scale(-600)));

  // pulviscolo e pollini che galleggiano attorno a chi guarda: si accendono nei raggi di sole
  const motes = new ParticleSystem("motes", 400, scene);
  const mt = new DynamicTexture("moteTex", 32, scene, false);
  const mctx = mt.getContext() as CanvasRenderingContext2D;
  const grad = mctx.createRadialGradient(16, 16, 0, 16, 16, 16);
  grad.addColorStop(0, "rgba(255,255,255,1)"); grad.addColorStop(1, "rgba(255,255,255,0)");
  mctx.fillStyle = grad; mctx.fillRect(0, 0, 32, 32); mt.hasAlpha = true; mt.update();
  motes.particleTexture = mt as unknown as Texture;
  motes.emitter = cam.position;
  motes.createBoxEmitter(new Vector3(-0.2, -0.05, -0.2), new Vector3(0.2, 0.05, 0.2), new Vector3(-14, -2, -14), new Vector3(14, 6, 14));
  motes.minSize = 0.015; motes.maxSize = 0.04;
  motes.minLifeTime = 6; motes.maxLifeTime = 12;
  motes.emitRate = 45;
  motes.minEmitPower = 0.02; motes.maxEmitPower = 0.1;
  motes.color1 = new Color4(1, 0.92, 0.7, 0.55); motes.color2 = new Color4(0.9, 0.95, 0.75, 0.35); motes.colorDead = new Color4(1, 1, 1, 0);
  motes.blendMode = ParticleSystem.BLENDMODE_ADD;
  motes.gravity = new Vector3(0.05, -0.01, 0.03);
  motes.renderingGroupId = 0;
  motes.preWarmCycles = 200;
  motes.start();

  createGraphicsSettings({ scene, engine, camera: cam, pipeline: pipe, ssao, godrays: vls, shadowMap }, (d) => { grassDist = d; });

  document.getElementById("overlay")!.addEventListener("click", () => canvas.requestPointerLock());

  await scene.whenReadyAsync();
  lap("shader pronti");
  shadowMap.resetRefreshCounter();   // la shadow map si disegna ora che tutti i materiali sono compilati
  probe.cubeTexture.resetRefreshCounter();   // e il cielo per i riflessi, ora che il suo shader è pronto
  hud.ready();
  engine.runRenderLoop(() => {
    player.update(engine.getDeltaTime() / 1000);
    scene.render();
  });
  addEventListener("resize", () => engine.resize());
  if (import.meta.env.DEV) Object.assign(window, { scene, player });   // debug da console
}

main();
