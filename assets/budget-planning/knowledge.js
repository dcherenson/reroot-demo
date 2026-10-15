/** Sensor-derived map. Truth is read only by perception; planning reads this map. */
import { inSensorImage, sensorCalibration } from './sensor-camera.js';
import { terrainHeight, surfaceHeight, lineOfSight, worldCollision, inZone } from './worlds.js';

export const FOV_RANGE = 75, FOV_ANGLE = Math.PI / 2, CELL = 2;
export const UNKNOWN = 0, OBSERVED = 1, FORBIDDEN = 2, SURVEYED = 3;
export const wrap = a => Math.atan2(Math.sin(a), Math.cos(a));
export function inFov(pose, point, yaw = pose[2], margin = 0, config = undefined) {
  // Preserve the original fourth `margin` slot and also accept a config as
  // the fourth argument for callers that do not need a robust margin.
  if (margin && typeof margin === 'object') { config = margin; margin = 0; }
  const sensor = sensorCalibration(config);
  const halfAngle = sensor.horizontalFovRadians / 2;
  const shift = margin / Math.sin(halfAngle);
  const radius = sensor.range - margin - shift;
  const dx = point.x - pose[0] - Math.cos(yaw) * shift;
  const dy = point.y - pose[1] - Math.sin(yaw) * shift;
  return radius > 0 && dx * dx + dy * dy <= radius * radius &&
    Math.abs(wrap(Math.atan2(dy, dx) - yaw)) <= halfAngle;
}

export class Knowledge {
  constructor(world, config = {}, {pixelFeatures=false}={}) {
    this.world = world; this.config = config; this.sensor = sensorCalibration(config); this.pixelFeatures=pixelFeatures;this.features=pixelFeatures?[]:world.features;
    this.width = Math.ceil(world.width / CELL); this.height = Math.ceil(world.height / CELL);
    this.cells = new Uint8Array(this.width * this.height);
    // Visual observation is independent of flight clearance: known forbidden
    // ground is not automatically visible, and seeing a roof is not free space.
    this.observed = new Uint8Array(this.width * this.height);
    this.mapped = new Uint8Array(pixelFeatures?1000:world.features.length);
    this.discovered = new Set([world.landmarks[0].id]);
    this.knownZones = new Set(world.zones.filter(z => z.known).map(z => z.id));
    this.version = 0; this.mapCount = 0;
    this.featureBins = new Map(); this.binSize = 20;
    this.visibilityCache=new Map();this.visibilityCacheEpoch='';
    for (const f of this.features) {
      const key = `${Math.floor(f.x / 20)},${Math.floor(f.y / 20)}`;
      if (!this.featureBins.has(key)) this.featureBins.set(key, []);
      this.featureBins.get(key).push(f);
    }
    this.refreshForbidden();
  }
  inImage(pose,point,yaw,margin=0) {return !this.pixelFeatures||inSensorImage(pose,point,yaw,this.world.altitude,margin,this.sensor);}
  ingestFeatures(anchors) {
    for(const f of anchors||[]) {
      if(f.id!==this.features.length||f.id>=1000)throw new Error('Invalid image feature map sequence.');
      this.features.push(f);
      const key=`${Math.floor(f.x/20)},${Math.floor(f.y/20)}`;
      if(!this.featureBins.has(key))this.featureBins.set(key,[]);
      this.featureBins.get(key).push(f);
    }
  }
  orbitRadius(l) {
    const zone = l.zoneId && this.world.zones.find(z => z.id === l.zoneId && this.knownZones.has(z.id));
    const object=l.objectId?this.world.objects.find(o=>o.id===l.objectId):null;
    // Fly around a physical landmark's footprint. A tight point-landmark orbit
    // would sweep over its roof, whose hidden ground cannot be surveyed free.
    // Recognition of the object does not certify the space beneath it.
    const objectClearance=object?Math.hypot(object.width,object.depth)/2+this.config.budget+7:0;
    return Math.max(this.config.radius, l.renewalRadius || 0, objectClearance, zone ? (zone.radius || Math.hypot(zone.width, zone.height) / 2) + this.config.budget + 7 : 0);
  }
  zoneAt(x, y, margin = 0) {
    return this.world.zones.some(z => this.knownZones.has(z.id) && inZone(z, x, y, margin));
  }
  refreshForbidden() {
    for (let y = 0; y < this.height; y++) for (let x = 0; x < this.width; x++) {
      const px = (x + .5) * CELL, py = (y + .5) * CELL;
      if (worldCollision(this.world, px, py, 1.5) || this.zoneAt(px, py, CELL * .71)) this.cells[y * this.width + x] = FORBIDDEN;
    }
    this.version++;
  }
  surveyHome() {
    const home = this.world.landmarks[0];
    // A surveyed home orbit and small maneuver area are the sole prior-free region.
    const radius = this.orbitRadius(home) + this.config.budget + 14;
    for (let y = 0; y < this.height; y++) for (let x = 0; x < this.width; x++) {
      const px = (x + .5) * CELL, py = (y + .5) * CELL, i = y * this.width + x;
      if (Math.hypot(px - home.x, py - home.y) > radius) continue;
      if (this.world.zones.some(z => inZone(z, px, py, 1))) throw new Error('Surveyed home area overlaps a restriction.');
      if (this.cells[i] !== FORBIDDEN) this.cells[i] = SURVEYED;
      this.observed[i] = 1;
    }
    this.version++;
  }
  visibleLandmarks(pose, yaw, margin = 0, discoveredOnly = true) {
    const p = [pose[0], pose[1], this.world.altitude];
    return this.world.landmarks.filter(l => (!discoveredOnly || this.discovered.has(l.id)) &&
      l.z < this.world.altitude && inFov(pose, l, yaw, margin, this.sensor) && this.inImage(pose,l,yaw,margin) && lineOfSight(this.world, p, [l.x, l.y, l.z + .3]));
  }
  visibleFeatures(pose, yaw, margin = 0, mappedOnly = true) {
    // Descending gatekeeper prefixes revisit the same sensor poses. Cache
    // exact queries within one knowledge revision, with a fixed memory cap.
    const epoch=this.version+':'+this.mapCount;
    if(this.visibilityCacheEpoch!==epoch){this.visibilityCache.clear();this.visibilityCacheEpoch=epoch;}
    const cacheKey=mappedOnly?[pose[0],pose[1],yaw,margin].join(','):null;
    if(cacheKey&&this.visibilityCache.has(cacheKey))return this.visibilityCache.get(cacheKey);
    const result = [], range = this.sensor.range;
    const x0 = Math.floor((pose[0] - range) / 20), x1 = Math.floor((pose[0] + range) / 20);
    const y0 = Math.floor((pose[1] - range) / 20), y1 = Math.floor((pose[1] + range) / 20);
    const p = [pose[0], pose[1], this.world.altitude];
    for (let by = y0; by <= y1; by++) for (let bx = x0; bx <= x1; bx++) {
      const bin = this.featureBins.get(`${bx},${by}`); if (!bin) continue;
      for (const f of bin) if (f.z < this.world.altitude && (!mappedOnly || this.mapped[f.id]) && inFov(pose, f, yaw, margin, this.sensor) && this.inImage(pose,f,yaw,margin) &&
        lineOfSight(this.world, p, [f.x, f.y, f.z + .15])) result.push(f.id);
    }
    if(cacheKey){
      if(this.visibilityCache.size>=4096)this.visibilityCache.delete(this.visibilityCache.keys().next().value);
      this.visibilityCache.set(cacheKey,result);
    }
    return result;
  }
  sense(pose, yaw, observation=null) {
    if(this.pixelFeatures&&!observation)throw new Error("Camera image required before sensing.");
    const discoveredZones = [];
    // Semantic sensor reveals the full authored crowd boundary when any visible
    // part is observed. Restriction updates precede all free-space certification.
    for (const zone of this.world.zones) {
      if (this.knownZones.has(zone.id)) continue;
      let detected = false;
      for (let k = 0; k < 17 && !detected; k++) {
        const a = k / 16 * Math.PI * 2, radius = k === 16 ? 0 : (zone.radius || Math.min(zone.width, zone.height) / 2);
        const point = { x: zone.x + Math.cos(a) * radius, y: zone.y + Math.sin(a) * radius };
        point.z=terrainHeight(this.world,point.x,point.y)+.5;
        detected = inFov(pose, point, yaw, 0, this.sensor) && this.inImage(pose,point,yaw) && lineOfSight(this.world, [pose[0], pose[1], this.world.altitude], [point.x, point.y, terrainHeight(this.world, point.x, point.y) + .5]);
      }
      if (detected) { this.knownZones.add(zone.id); discoveredZones.push(zone.id); }
    }
    if (discoveredZones.length) this.refreshForbidden();
    if(this.pixelFeatures)this.ingestFeatures(observation.newAnchors);
    const visible = this.pixelFeatures?observation.visible:this.visibleFeatures(pose, yaw, 0, false);
    for (const id of visible) if (!this.mapped[id]) { this.mapped[id] = 1; this.mapCount++; }
    const newLandmarks = [];
    for (const l of this.visibleLandmarks(pose, yaw, 0, false)) if (!this.discovered.has(l.id)) { this.discovered.add(l.id); newLandmarks.push(l.id); }
    const range = this.sensor.range;
    const x0 = Math.max(0, Math.floor((pose[0] - range) / CELL)), x1 = Math.min(this.width - 1, Math.ceil((pose[0] + range) / CELL));
    const y0 = Math.max(0, Math.floor((pose[1] - range) / CELL)), y1 = Math.min(this.height - 1, Math.ceil((pose[1] + range) / CELL));
    let changed = false;
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      const i = y * this.width + x;
      const p = { x: (x + .5) * CELL, y: (y + .5) * CELL };
      if (!this.observed[i] && inFov(pose, p, yaw, 0, this.sensor)) {
        const surface = surfaceHeight(this.world, p.x, p.y) + .2;
        if (surface < this.world.altitude && this.inImage(pose,{...p,z:surface},yaw) && lineOfSight(this.world, [pose[0], pose[1], this.world.altitude], [p.x, p.y, surface])) this.observed[i] = 1;
      }
      if (this.cells[i] !== UNKNOWN) continue;
      if (!inFov(pose, p, yaw, CELL, this.sensor)||!this.inImage(pose,{...p,z:terrainHeight(this.world,p.x,p.y)},yaw,CELL)) continue;
      if (!lineOfSight(this.world, [pose[0], pose[1], this.world.altitude], [p.x, p.y, terrainHeight(this.world, p.x, p.y) + .2])) continue;
      // A cell overlapping an undetected authored semantic boundary cannot be
      // labelled free: the ideal sensor must expose that boundary first.
      const hidden = this.world.zones.find(z => !this.knownZones.has(z.id) && inZone(z, p.x, p.y, CELL * .71));
      if (hidden) continue;
      this.cells[i] = OBSERVED; changed = true;
    }
    if (changed || newLandmarks.length) this.version++;
    return { visible, newLandmarks, discoveredZones };
  }
  safe(x, y, margin = this.config.budget + 2) {
    if (worldCollision(this.world, x, y, margin) || this.zoneAt(x, y, margin)) return false;
    const gx = Math.floor(x / CELL), gy = Math.floor(y / CELL), n = Math.ceil(margin / CELL);
    for (let j = gy - n; j <= gy + n; j++) for (let i = gx - n; i <= gx + n; i++) {
      if (i < 0 || j < 0 || i >= this.width || j >= this.height) return false;
      const dx = (i + .5) * CELL - x, dy = (j + .5) * CELL - y;
      if (dx * dx + dy * dy > (margin + CELL * .71) ** 2) continue;
      const c = this.cells[j * this.width + i]; if (c === UNKNOWN || c === FORBIDDEN) return false;
    }
    return true;
  }
  certifyOrbit(l) {
    if (!this.discovered.has(l.id)) return false;
    if (l.zoneId && !this.knownZones.has(l.zoneId)) return false;
    const r = this.orbitRadius(l);
    if (r + this.config.budget >= this.sensor.range) return false;
    const samples = Math.max(72, Math.ceil(2 * Math.PI * r));
    for (let i = 0; i < samples; i++) {
      const a = i / samples * Math.PI * 2, p = [l.x + r * Math.cos(a), l.y + r * Math.sin(a), a + Math.PI / 2];
      if (!this.safe(p[0], p[1]) || !this.inImage(p,l,a+Math.PI,this.config.budget+2) || !lineOfSight(this.world, [p[0], p[1], this.world.altitude], [l.x, l.y, l.z + .3])) return false;
    }
    return true;
  }
}
