/*
 * Small, data-only helpers for editing authored world coordinates.
 *
 * A layout stores only the coordinates that differ from the authored world:
 *
 *   {
 *     landmarks: { "farm-goal": { x: 260, y: 165 } },
 *     zones:      { "farm-aviary": { x: 151, y: 120 } },
 *     mountains:  { "mountain-0": { x: 172, y: 111 } },
 *   }
 *
 * The helpers deliberately operate on bounded, finite data.  They are used
 * before terrain and scenery are baked so the renderer, collision queries,
 * line-of-sight checks, and feature generation all consume the same world.
 */

import { terrainHeight } from './worlds.js';
import { Knowledge } from './knowledge.js';

const LAYOUT_SECTIONS = Object.freeze(['landmarks', 'zones', 'mountains']);
const TYPES = new Set(['landmark', 'zone', 'mountain']);
const EPSILON = 1e-7;

function finite(value) {
  return Number.isFinite(Number(value));
}

function coordinate(value, name) {
  const number = Number(value);
  if (!Number.isFinite(number)) throw new Error(`Invalid layout ${name}: expected a finite number.`);
  return number;
}

function samePoint(a, b) {
  return Math.abs(Number(a?.x) - Number(b?.x)) <= EPSILON
    && Math.abs(Number(a?.y) - Number(b?.y)) <= EPSILON;
}

function rotateExtents(width, depth, angle = 0) {
  const halfWidth = Math.abs(Number(width) || 0) / 2;
  const halfDepth = Math.abs(Number(depth) || 0) / 2;
  const c = Math.abs(Math.cos(Number(angle) || 0));
  const s = Math.abs(Math.sin(Number(angle) || 0));
  return { x: halfWidth * c + halfDepth * s, y: halfWidth * s + halfDepth * c };
}

function ellipseExtents(rx, ry, angle = 0) {
  const radiusX = Math.abs(Number(rx) || 0);
  const radiusY = Math.abs(Number(ry) || 0);
  const c = Math.cos(Number(angle) || 0);
  const s = Math.sin(Number(angle) || 0);
  return {
    x: Math.sqrt((radiusX * c) ** 2 + (radiusY * s) ** 2),
    y: Math.sqrt((radiusX * s) ** 2 + (radiusY * c) ** 2),
  };
}

function extentBounds(x, y, extentX, extentY) {
  const centerX = Number(x);
  const centerY = Number(y);
  return {
    minX: centerX - Math.max(0, Number(extentX) || 0),
    maxX: centerX + Math.max(0, Number(extentX) || 0),
    minY: centerY - Math.max(0, Number(extentY) || 0),
    maxY: centerY + Math.max(0, Number(extentY) || 0),
  };
}

function boundsInsideWorld(world, bounds) {
  return bounds.minX >= 0 && bounds.maxX <= Number(world.width)
    && bounds.minY >= 0 && bounds.maxY <= Number(world.height);
}

function worldTargetMaps(world) {
  const landmarks = new Map((world?.landmarks || []).map((landmark) => [String(landmark.id), landmark]));
  const zones = new Map((world?.zones || []).map((zone) => [String(zone.id), zone]));
  const mountains = new Map((world?.mountains || []).map((mountain, index) => [String(mountain.id != null ? mountain.id : `mountain-${index}`), mountain]));
  return { landmarks, zones, mountains };
}

function objectForLandmark(world, landmark) {
  if (!landmark) return null;
  if (landmark.objectId != null) {
    const object = (world.objects || []).find((candidate) => candidate.id === landmark.objectId);
    if (object) return object;
  }
  return (world.objects || []).find((candidate) => candidate.landmarkId === landmark.id) || null;
}

function targetBounds(world, type, value) {
  if (type === 'landmark') {
    const object = objectForLandmark(world, value);
    if (!object) return extentBounds(value.x, value.y, 0, 0);
    // Stadium collision uses an ellipse, but this conservative rotated box is
    // the correct edit bound for both the visual footprint and its rim.
    const extent = rotateExtents(object.width, object.depth, object.rotation);
    return extentBounds(value.x, value.y, extent.x, extent.y);
  }
  if (type === 'zone') {
    if (value.kind === 'circle') return extentBounds(value.x, value.y, value.radius, value.radius);
    return extentBounds(value.x, value.y, ...Object.values(rotateExtents(value.width, value.height, value.angle)));
  }
  const extent = ellipseExtents(value.rx, value.ry, value.rotation);
  return extentBounds(value.x, value.y, extent.x, extent.y);
}

function targetRecord(world, type, id, value) {
  const object = type === 'landmark' ? objectForLandmark(world, value) : null;
  const bounds = targetBounds(world, type, value);
  return {
    type,
    id,
    label: value.label || object?.label || id,
    x: Number(value.x),
    y: Number(value.y),
    bounds,
    ...(object ? { objectId: object.id } : {}),
    ...(type === 'landmark' && value.zoneId ? { zoneId: value.zoneId } : {}),
    ...(type === 'zone' && value.known !== undefined ? { known: value.known } : {}),
  };
}

/**
 * Return every coordinate that the editor may place.
 *
 * The returned records are newly allocated, so callers can safely annotate
 * them for a UI without changing the world or its authored geometry.
 */
export function getLayoutTargets(world) {
  if (!world || !Number.isFinite(Number(world.width)) || !Number.isFinite(Number(world.height))) return [];
  const targets = [];
  for (const landmark of world.landmarks || []) {
    if (landmark?.id == null || !finite(landmark.x) || !finite(landmark.y)) continue;
    targets.push(targetRecord(world, 'landmark', String(landmark.id), landmark));
  }
  for (const zone of world.zones || []) {
    if (zone?.id == null || !finite(zone.x) || !finite(zone.y)) continue;
    targets.push(targetRecord(world, 'zone', String(zone.id), zone));
  }
  for (const [id, mountain] of worldTargetMaps(world).mountains) {
    if (!finite(mountain.x) || !finite(mountain.y)) continue;
    targets.push(targetRecord(world, 'mountain', id, mountain));
  }
  return targets;
}

function emptyLayout() {
  return { landmarks: {}, zones: {}, mountains: {} };
}

function cloneLayout(raw = {}) {
  if (raw == null) return emptyLayout();
  if (typeof raw !== 'object' || Array.isArray(raw)) throw new Error('Invalid world layout: expected an object.');
  for (const key of Object.keys(raw)) {
    if (!LAYOUT_SECTIONS.includes(key)) throw new Error(`Invalid world layout section: ${key}.`);
  }
  const result = emptyLayout();
  for (const section of LAYOUT_SECTIONS) {
    const source = raw[section];
    if (source == null) continue;
    if (typeof source !== 'object' || Array.isArray(source)) throw new Error(`Invalid world layout ${section}: expected an object.`);
    for (const [id, point] of Object.entries(source)) {
      if (!point || typeof point !== 'object' || Array.isArray(point)) throw new Error(`Invalid layout ${section}.${id}: expected coordinates.`);
      result[section][String(id)] = { x: coordinate(point.x, `${section}.${id}.x`), y: coordinate(point.y, `${section}.${id}.y`) };
    }
  }
  return result;
}

function targetFor(world, type, id) {
  const maps = worldTargetMaps(world);
  return maps[type === 'landmark' ? 'landmarks' : type === 'zone' ? 'zones' : 'mountains'].get(String(id)) || null;
}

function validatePlacement(world, type, id, point) {
  if (!TYPES.has(type)) throw new Error(`Invalid layout target type: ${type}.`);
  const target = targetFor(world, type, id);
  if (!target) throw new Error(`Unknown ${type} layout target: ${id}.`);
  const x = coordinate(point?.x, `${type}.${id}.x`);
  const y = coordinate(point?.y, `${type}.${id}.y`);
  const candidate = { ...target, x, y };
  const bounds = targetBounds(world, type, candidate);
  if (!boundsInsideWorld(world, bounds)) {
    throw new Error(`Invalid ${type} layout target ${id}: footprint must remain inside the world.`);
  }
  return { x, y, bounds };
}

function validateLayout(world, layout) {
  const normalized = cloneLayout(layout);
  for (const [section, type] of [['landmarks', 'landmark'], ['zones', 'zone'], ['mountains', 'mountain']]) {
    for (const [id, point] of Object.entries(normalized[section])) validatePlacement(world, type, id, point);
  }
  return normalized;
}

function zoneLandmarkLinks(world) {
  const links = new Map();
  const zones = world.zones || [];
  for (const landmark of world.landmarks || []) {
    let zone = landmark.zoneId == null ? null : zones.find((candidate) => candidate.id === landmark.zoneId);
    // Stadium metadata predates the explicit zoneId convention in a few saved
    // worlds. Match only its crowd zone at the same authored center.
    if (!zone && (landmark.kind === 'stadium' || objectForLandmark(world, landmark)?.kind === 'stadium')) {
      zone = zones.find((candidate) => candidate.crowd && samePoint(candidate, landmark));
    }
    if (zone) links.set(String(landmark.id), zone);
  }
  return links;
}

function linkedObjectCandidates(world, landmark) {
  const object = objectForLandmark(world, landmark);
  if (!object) return [];
  return (world.objects || []).filter((candidate) => candidate === object
    || (object.id != null && candidate.id === object.id)
    || candidate.landmarkId === landmark.id);
}

function padAnchoredTo(world, pad, landmark, object, oldX, oldY) {
  if (pad?.landmarkId != null && String(pad.landmarkId) === String(landmark.id)) return true;
  if (pad?.objectId != null && object?.id != null && String(pad.objectId) === String(object.id)) return true;
  if (object && samePoint(pad, { x: oldX, y: oldY })) {
    // The authored pads use the same center as their physical object. Keep the
    // match conservative so an unrelated nearby pad is never dragged along.
    const width = Math.abs(Number(object.width) || 0);
    const depth = Math.abs(Number(object.depth) || 0);
    return Math.abs(Number(pad.width) || 0) >= width - EPSILON
      && Math.abs(Number(pad.depth) || 0) >= depth - EPSILON;
  }
  return false;
}

function moveLandmarkGeometry(world, landmark, target, movedPads) {
  const oldX = Number(landmark.x);
  const oldY = Number(landmark.y);
  const dx = target.x - oldX;
  const dy = target.y - oldY;
  landmark.x = target.x;
  landmark.y = target.y;
  const objects = linkedObjectCandidates(world, landmark);
  // Several authored sites have a low plaza beneath the named tower. It is a
  // visual part of that site even though it predates the landmarkId metadata.
  // Move only co-located plazas, keeping unrelated roads and scenery stable.
  for (const object of world.objects || []) {
    if (object.kind === 'plaza' && samePoint(object, { x: oldX, y: oldY }) && !objects.includes(object)) objects.push(object);
  }
  for (const object of objects) {
    // The landmark is the source of truth for its physical site. Setting an
    // absolute position also makes repeated application idempotent.
    object.x = target.x;
    object.y = target.y;
    for (const pad of world.terrainPads || []) {
      if (movedPads.has(pad)) continue;
      if (!padAnchoredTo(world, pad, landmark, object, oldX, oldY)) continue;
      pad.x = Number(pad.x) + dx;
      pad.y = Number(pad.y) + dy;
      movedPads.add(pad);
      // The authored pad elevation is sampled again by applyWorldLayout while
      // the source terrain is available, before the terrain mesh is rebuilt.
      pad.elevation = NaN;
    }
  }
  return { dx, dy, oldX, oldY };
}

function resetMovedPadElevations(world, movedPads, recalculateAll = false) {
  // `createWorld` calls this before baking its terrain mesh. Keeping this
  // small fallback here also makes a direct applyWorldLayout call useful on a
  // pre-bake world.
  const pads = recalculateAll ? new Set(world.terrainPads || []) : movedPads;
  if (recalculateAll) for (const pad of pads) pad.elevation = NaN;
  for (const pad of pads) pad.elevation = terrainHeight(world, pad.x, pad.y);
}

/**
 * Apply a validated layout to authored geometry. The world is mutated and
 * returned for convenient construction chaining; validation completes before
 * any coordinate is changed.
 */
export function applyWorldLayout(world, layout = {}) {
  if (!world || !Array.isArray(world.landmarks) || !Array.isArray(world.zones) || !Array.isArray(world.mountains)) {
    throw new Error('Invalid world: authored geometry is required before applying a layout.');
  }
  const normalized = validateLayout(world, layout);
  const links = zoneLandmarkLinks(world);
  const landmarkTargets = new Map(Object.entries(normalized.landmarks));
  const zoneTargets = new Map(Object.entries(normalized.zones));

  // Resolve linked landmark/zone edits into one translation. If a caller sends
  // both records, they must describe the same delta; this prevents a stadium
  // from being translated once as a landmark and a second time as an NFZ.
  for (const [landmarkId, zone] of links) {
    const landmark = targetFor(world, 'landmark', landmarkId);
    const landmarkEdit = landmarkTargets.get(landmarkId);
    const zoneEdit = zoneTargets.get(String(zone.id));
    if (!landmarkEdit && !zoneEdit) continue;
    const landmarkDelta = landmarkEdit ? { x: landmarkEdit.x - landmark.x, y: landmarkEdit.y - landmark.y } : null;
    const zoneDelta = zoneEdit ? { x: zoneEdit.x - zone.x, y: zoneEdit.y - zone.y } : null;
    if (landmarkDelta && zoneDelta && (Math.abs(landmarkDelta.x - zoneDelta.x) > EPSILON || Math.abs(landmarkDelta.y - zoneDelta.y) > EPSILON)) {
      throw new Error(`Linked landmark and zone ${landmarkId}/${zone.id} must move together.`);
    }
    const delta = landmarkDelta || zoneDelta;
    if (!landmarkEdit) landmarkTargets.set(landmarkId, { x: landmark.x + delta.x, y: landmark.y + delta.y });
    if (!zoneEdit) zoneTargets.set(String(zone.id), { x: zone.x + delta.x, y: zone.y + delta.y });
  }

  // The linked records above are derived from one authored edit. Validate
  // their complete footprints before changing either side of the pair.
  for (const [id, point] of landmarkTargets) validatePlacement(world, 'landmark', id, point);
  for (const [id, point] of zoneTargets) validatePlacement(world, 'zone', id, point);

  const movedPads = new Set();
  for (const [id, point] of landmarkTargets) {
    const landmark = targetFor(world, 'landmark', id);
    if (landmark) moveLandmarkGeometry(world, landmark, point, movedPads);
  }
  for (const [id, point] of zoneTargets) {
    const zone = targetFor(world, 'zone', id);
    if (zone) { zone.x = point.x; zone.y = point.y; }
  }
  for (const [id, point] of Object.entries(normalized.mountains)) {
    const mountain = targetFor(world, 'mountain', id);
    if (mountain) { mountain.x = point.x; mountain.y = point.y; }
  }
  resetMovedPadElevations(world, movedPads, Object.keys(normalized.mountains).length > 0);
  return world;
}

/**
 * Return a new layout after an editor drag. The input layout and world remain
 * untouched, and the candidate is rejected when its complete footprint would
 * leave the finite world rectangle.
 */
export function updatedLayout(world, currentLayout = {}, edit) {
  if (!edit || typeof edit !== 'object') throw new Error('Invalid layout edit: expected a target and coordinates.');
  const type = String(edit.type || '');
  const id = String(edit.id ?? '');
  const normalized = validateLayout(world, currentLayout);
  const placement = validatePlacement(world, type, id, edit);
  const section = type === 'landmark' ? 'landmarks' : type === 'zone' ? 'zones' : 'mountains';
  normalized[section][id] = { x: placement.x, y: placement.y };

  // Canonicalize a linked stadium edit to the record the user just dragged.
  // This lets an editor alternate between the landmark and its crowd zone
  // without retaining a stale counterpart that would describe a second,
  // contradictory translation.
  const links = zoneLandmarkLinks(world);
  if (type === 'landmark') {
    const zone = links.get(id);
    if (zone) delete normalized.zones[String(zone.id)];
  } else if (type === 'zone') {
    for (const [landmarkId, zone] of links) {
      if (String(zone.id) === id) delete normalized.landmarks[landmarkId];
    }
  }
  return normalized;
}

function validationConfig(config = {}) {
  const source = config && typeof config === 'object' ? config : {};
  return {
    budget: finite(source.budget) ? Number(source.budget) : 5,
    radius: finite(source.radius) ? Number(source.radius) : 10,
    horizontalFov: finite(source.horizontalFov) ? Number(source.horizontalFov) : 90,
    sensingRange: finite(source.sensingRange) ? Number(source.sensingRange) : 75,
    downwardPitch: finite(source.downwardPitch) ? Number(source.downwardPitch) : 55,
  };
}

/**
 * Validate the already-authored world and its starting orbit. Only the home
 * site is certified: an undiscovered landmark or hidden crowd zone must not
 * become known merely because an edit was submitted.
 */
export function validateWorldLayout(world, config = {}) {
  if (!world || !Number.isFinite(Number(world.width)) || !Number.isFinite(Number(world.height))) {
    throw new Error('Invalid world layout: finite world dimensions are required.');
  }
  if (config && typeof config === 'object' && config.layout != null) validateLayout(world, config.layout);
  // Check every authored target as well as the applied layout. This catches a
  // malformed editor payload even when a caller bypasses updatedLayout.
  for (const target of getLayoutTargets(world)) {
    if (![target.x, target.y, target.bounds.minX, target.bounds.maxX, target.bounds.minY, target.bounds.maxY].every(Number.isFinite)) {
      throw new Error(`Invalid ${target.type} layout target ${target.id}: coordinates must be finite.`);
    }
    if (!boundsInsideWorld(world, target.bounds)) throw new Error(`Invalid ${target.type} layout target ${target.id}: footprint is outside the world.`);
  }
  // Validate against the same optical footprint used by the browser worker.
  // Pixel mode does not reveal authored features here; it only enables the
  // camera-image frustum checks in certifyOrbit.
  const knowledge = new Knowledge(world, validationConfig(config), { pixelFeatures: true });
  knowledge.surveyHome();
  const home = world.landmarks.find((landmark) => landmark.home) || world.landmarks[0];
  if (!home || !knowledge.certifyOrbit(home)) throw new Error('Home orbit is not safe at these settings.');
  return true;
}

export default applyWorldLayout;
