import {
  shortestPath,
  samplePath,
  pathLength,
  samplePaths,
  prefixPaths,
  seededRandom,
} from './dubins.js';

/*
 * The backup planner is a reverse tree.  A node is a possible vehicle pose
 * and its edge points from that pose towards the next node, eventually
 * ending at a tangent pose on a safe orbit.  Keeping this direction explicit
 * is important: a path returned by query() can be executed from the queried
 * pose without reversing every Dubins segment.
 */

const TAU = 2 * Math.PI;
const EPS = 1e-9;

function finite(value) {
  return Number.isFinite(value);
}

function wrapAngle(angle) {
  let a = Number(angle);
  a %= TAU;
  if (a < 0) a += TAU;
  return a;
}

function poseCopy(pose) {
  if (!pose || pose.length < 3) return null;
  const copy = [Number(pose[0]), Number(pose[1]), Number(pose[2])];
  return copy.every(finite) ? copy : null;
}

function xyLowerBound(a, b) {
  const dx = a[0] - b[0];
  const dy = a[1] - b[1];
  return Math.hypot(dx, dy);
}

function lengthOf(pathOrPaths) {
  if (pathOrPaths == null) return NaN;
  if (Array.isArray(pathOrPaths)) return pathLength(pathOrPaths);
  return finite(pathOrPaths.length) ? Math.max(0, Number(pathOrPaths.length)) : NaN;
}

function sampledPath(pathOrPaths, distance) {
  const d = Math.max(0, Number(distance));
  return Array.isArray(pathOrPaths) ? samplePaths(pathOrPaths, d) : samplePath(pathOrPaths, d);
}

function prefixedPaths(pathOrPaths, distance) {
  const list = Array.isArray(pathOrPaths) ? pathOrPaths : [pathOrPaths];
  const d = Math.max(0, Number(distance));
  if (d <= EPS) return [];
  return prefixPaths(list, d);
}

function normalisePaths(paths) {
  if (paths == null) return [];
  return Array.isArray(paths) ? paths.slice() : [paths];
}

function safeCost(result, path) {
  if (result && typeof result === 'object' && finite(result.cost)) {
    return Math.max(0, Number(result.cost));
  }
  return lengthOf(path);
}

function edgeResult(check, path) {
  if (path == null || !finite(lengthOf(path))) return { safe: false, cost: Infinity };
  if (typeof check !== 'function') return { safe: true, cost: lengthOf(path) };
  const result = check(path);
  if (result === false || (result && result.safe === false)) return { safe: false, cost: Infinity };
  if (result === true) return { safe: true, cost: lengthOf(path) };
  if (!result || result.safe !== true) return { safe: false, cost: Infinity };
  return { safe: true, cost: safeCost(result, path) };
}

class ReRoot {
  constructor(options = {}) {
    this.radius = Math.max(EPS, Number(options.radius) || 1);
    this.seed = options.seed === undefined ? 1337 : options.seed;
    this.maxNodes = Math.max(1, Math.floor(Number(options.maxNodes) || 4000));
    this._edgeCheck = typeof options.edgeCheck === 'function' ? options.edgeCheck : null;
    this._random = seededRandom(this.seed);
    this._rootIds = new Map();
    this.rootNodes = [];
    this.nodes = [];
    this.revision = 0;
    this.lastGrow = { added: 0, attempts: 0 };
    this.lastRevalidate = null;
    this._edgeSnapshotRevision = -1;
    this._edgeSnapshot = new Float32Array();

    // Reserve four tangent roots per authored landmark inside the node cap.
    // Standalone callers default to sixteen; simulations provide their count.
    // Tiny test budgets retain as many root slots as they can hold.
    this.rootReserve = Math.min(this.maxNodes,Math.max(4,Math.floor(options.rootReserve||16)));
  }

  get rootCount() {
    return this.rootNodes.length;
  }

  get nodeCount() {
    return this.nodes.length;
  }

  get nodeCapacity() {
    return Math.max(0, this._regularLimit() - this.rootNodes.length);
  }

  _newNode(pose, parentIndex, edgePath, edgeCost, rootId, root, slot) {
    const index = slot === undefined ? this.nodes.length : slot;
    const node = {
      index,
      id: index,
      pose: poseCopy(pose),
      state: poseCopy(pose),
      parent: parentIndex == null ? null : parentIndex,
      parentIndex: parentIndex == null ? -1 : parentIndex,
      path: edgePath || null,
      edgePath: edgePath || null,
      edgeCost: root ? 0 : Math.max(0, Number(edgeCost) || 0),
      incrementalCost: root ? 0 : Math.max(0, Number(edgeCost) || 0),
      totalCost: root ? 0 : Math.max(0, Number(edgeCost) || 0),
      cost: root ? 0 : Math.max(0, Number(edgeCost) || 0),
      rootId,
      root: Boolean(root),
      isRoot: Boolean(root),
      valid: true,
      invalid: false,
      children: new Set(),
      _edgeSafe: true,
      _edgeChecked: !root,
    };
    this.nodes[index] = node;
    return node;
  }

  addOrbit(orbit = {}) {
    const id = orbit.id === undefined ? `orbit-${this._rootIds.size}` : orbit.id;
    if (this._rootIds.has(id)) {
      return this._rootIds.get(id).map((index) => this.nodes[index]);
    }
    if (this.rootNodes.length + 4 > this.rootReserve || this.nodes.length + 4 > this.maxNodes) {
      return [];
    }
    const cx = Number(orbit.x) || 0;
    const cy = Number(orbit.y) || 0;
    const orbitRadius = Math.max(EPS, Number(orbit.radius) || this.radius);
    const direction = Number(orbit.direction) < 0 ? -1 : 1;
    const indexes = [];
    for (let k = 0; k < 4; k += 1) {
      const angle = k * Math.PI / 2;
      const pose = [
        cx + orbitRadius * Math.cos(angle),
        cy + orbitRadius * Math.sin(angle),
        wrapAngle(angle + direction * Math.PI / 2),
      ];
      const node = this._newNode(pose, null, null, 0, id, true);
      node.orbit = { id, x: cx, y: cy, radius: orbitRadius, direction };
      this.rootNodes.push(node.index);
      indexes.push(node.index);
    }
    this._rootIds.set(id, indexes);
    this.revision += 1;
    return indexes.map((index) => this.nodes[index]);
  }

  _activeNodes(includeRoots = true) {
    const active = [];
    for (const node of this.nodes) {
      if (!node || !node.valid) continue;
      if (!includeRoots && node.root) continue;
      active.push(node);
    }
    return active;
  }

  _nearest(pose) {
    let nearest = null;
    let nearestExact = Infinity;
    // XY is an admissible squared lower bound.  Scan the reverse index so
    // this hot path allocates neither a sorted candidate list nor a copy.
    for (let index = this.nodes.length - 1; index >= 0; index -= 1) {
      const node = this.nodes[index];
      if (!node || !node.valid) continue;
      const dx = node.pose[0] - pose[0];
      const dy = node.pose[1] - pose[1];
      const lowerSquared = dx * dx + dy * dy;
      if (lowerSquared > nearestExact * nearestExact + EPS) continue;
      const exactPath = shortestPath(pose, node.pose, this.radius);
      if (!exactPath) continue;
      const exact = lengthOf(exactPath);
      if (finite(exact) && exact < nearestExact) {
        nearest = { node, path: exactPath, length: exact };
        nearestExact = exact;
      }
    }
    return nearest;
  }

  _candidateParents(pose, maxRadius) {
    const parents = [];
    for (const node of this._activeNodes(true)) {
      const lower = xyLowerBound(node.pose, pose);
      // Keep the same local-neighborhood contract as the Julia RRT*: roots
      // participate in `near()` only when they are close to the steered
      // sample.  Allowing every root here turns a clipped extension into a
      // direct, arbitrarily long root edge (and its long straight portion is
      // then what the tree renderer displays).
      if (lower > maxRadius + EPS) continue;
      const path = shortestPath(pose, node.pose, this.radius);
      if (!path) continue;
      const length = lengthOf(path);
      if (!finite(length)) continue;
      parents.push({ node, path, length });
    }
    return parents;
  }

  _wouldCycle(childIndex, proposedParentIndex) {
    let index = proposedParentIndex;
    let guard = 0;
    while (index != null && index >= 0 && guard <= this.nodes.length) {
      if (index === childIndex) return true;
      const node = this.nodes[index];
      if (!node || node.parentIndex < 0) return false;
      index = node.parentIndex;
      guard += 1;
    }
    return guard > this.nodes.length;
  }

  _updateSubtreeCosts(startIndex) {
    const queue = [startIndex];
    let head = 0;
    while (head < queue.length) {
      const index = queue[head++];
      const node = this.nodes[index];
      if (!node) continue;
      if (node.root || node.parentIndex < 0) {
        node.totalCost = 0;
      } else {
        const parent = this.nodes[node.parentIndex];
        node.totalCost = parent && finite(parent.totalCost)
          ? parent.totalCost + node.edgeCost
          : Infinity;
        if (parent) node.rootId = parent.rootId;
      }
      node.cost = node.totalCost;
      for (const child of node.children) queue.push(child);
    }
  }

  _reparent(node, parent, edgePath, edgeCost) {
    if (node.parentIndex >= 0 && this.nodes[node.parentIndex]) {
      this.nodes[node.parentIndex].children.delete(node.index);
    }
    node.parent = parent.index;
    node.parentIndex = parent.index;
    node.path = edgePath;
    node.edgePath = edgePath;
    node.edgeCost = Math.max(0, Number(edgeCost) || 0);
    node.incrementalCost = node.edgeCost;
    node._edgeSafe = true;
    node._edgeChecked = true;
    node.valid = parent.valid;
    node.invalid = !node.valid;
    parent.children.add(node.index);
    this._updateSubtreeCosts(node.index);
  }

  _findReusableSlot() {
    // Invalid leaves are safe to replace without changing any other index.
    for (const node of this.nodes) {
      if (!node || node.root || node.valid || node.children.size) continue;
      if (node.parentIndex >= 0 && this.nodes[node.parentIndex]) {
        this.nodes[node.parentIndex].children.delete(node.index);
      }
      return node.index;
    }
    return -1;
  }

  _hasReusableSlot() {
    return this.nodes.some((node) => node && !node.root && !node.valid && node.children.size === 0);
  }

  _regularLimit() {
    // Unused root reservations reduce the number of ordinary nodes.  Once a
    // root slot is occupied, that slot is already counted in nodes.length.
    return this.maxNodes - Math.max(0, this.rootReserve - this.rootNodes.length);
  }

  _insertNode(pose, parent, path, edgeCost) {
    let slot = this.nodes.length;
    if (this.nodes.length >= this._regularLimit()) {
      slot = this._findReusableSlot();
      if (slot < 0) return null;
    }
    const node = this._newNode(pose, parent.index, path, edgeCost, parent.rootId, false, slot);
    node.totalCost = parent.totalCost + node.edgeCost;
    node.cost = node.totalCost;
    parent.children.add(node.index);
    return node;
  }

  grow(center, samplingRadius, attempts = 10) {
    const c = Array.isArray(center) ? center : [center && center[0], center && center[1]];
    const cx = Number(c[0]) || 0;
    const cy = Number(c[1]) || 0;
    const radius = Math.max(0, Number(samplingRadius) || 0);
    const count = Math.max(0, Math.min(100000, Math.floor(Number(attempts) || 0)));
    let added = 0;
    if (!this.rootNodes.length || !count) {
      this.lastGrow = { added, attempts: count };
      return added;
    }

    for (let attempt = 0; attempt < count; attempt += 1) {
      if (this.nodes.length >= this._regularLimit() && !this._hasReusableSlot()) break;
      const u = this._random();
      const v = this._random();
      const theta = TAU * this._random();
      const sampledRadius = radius * Math.sqrt(Math.max(0, Math.min(1, u)));
      const randomPose = [
        cx + sampledRadius * Math.cos(theta),
        cy + sampledRadius * Math.sin(theta),
        TAU * Math.max(0, Math.min(1, v)),
      ];
      const nearest = this._nearest(randomPose);
      if (!nearest) continue;

      let childPose = randomPose;
      let reversePath = nearest.path;
      const reverseLength = lengthOf(reversePath);
      if (!finite(reverseLength)) continue;
      if (reverseLength > 1.1 * this.radius + EPS) {
        const sampleDistance = Math.max(0, reverseLength - 1.1 * this.radius);
        childPose = sampledPath(reversePath, sampleDistance);
        if (!childPose) continue;
        reversePath = shortestPath(childPose, nearest.node.pose, this.radius);
        if (!reversePath) continue;
      }

      const candidates = this._candidateParents(childPose, 2 * this.radius);
      let best = null;
      for (const candidate of candidates) {
        if (best && candidate.node.totalCost >= best.cost) continue;
        const result = edgeResult(this._edgeCheck, candidate.path);
        if (!result.safe || !finite(result.cost)) continue;
        const cost = candidate.node.totalCost + result.cost;
        if (!finite(cost)) continue;
        if (!best || cost < best.cost - EPS) {
          best = { ...candidate, cost, edgeCost: result.cost };
          }
      }
      if (!best || !best.node.valid) continue;
      const node = this._insertNode(childPose, best.node, best.path, best.edgeCost);
      if (!node) break;
      added += 1;

      // True reverse RRT* rewiring: an existing child may choose the new
      // node as its parent.  The edge remains child -> parent, so the final
      // query path is executable in forward order.
      const neighbors = this._activeNodes(false);
      for (const neighbor of neighbors) {
        if (neighbor.index === node.index || neighbor.root || neighbor.parentIndex < 0) continue;
        if (xyLowerBound(neighbor.pose, node.pose) > 2 * this.radius + EPS) continue;
        if (this._wouldCycle(neighbor.index, node.index)) continue;
        if (node.totalCost >= neighbor.totalCost) continue;
        const candidatePath = shortestPath(neighbor.pose, node.pose, this.radius);
        if (!candidatePath) continue;
        const result = edgeResult(this._edgeCheck, candidatePath);
        if (!result.safe || !finite(result.cost)) continue;
        if (node.totalCost + result.cost + EPS < neighbor.totalCost) {
          this._reparent(neighbor, node, candidatePath, result.cost);
          this.revision += 1;
        }
      }
      this.revision += 1;
    }
    this.lastGrow = { added, attempts: count };
    return added;
  }

  _nodePathToRoot(index) {
    const output = [];
    let node = this.nodes[index];
    let guard = 0;
    while (node && !node.root && node.parentIndex >= 0 && guard <= this.nodes.length) {
      if (!node.valid) return null;
      if (!node.edgePath) return null;
      output.push(node.edgePath);
      node = this.nodes[node.parentIndex];
      guard += 1;
    }
    if (!node || !node.root || guard > this.nodes.length || !node.valid) return null;
    return { paths: output, rootId: node.rootId };
  }

  query(pose) {
    const start = poseCopy(pose);
    if (!start) return null;
    let best = null;
    for (const node of this.nodes) {
      if (!node || !node.valid) continue;
      if (!node.root && xyLowerBound(start, node.pose) > 2 * this.radius + EPS) continue;
      if (best && node.totalCost > best.cost + EPS) continue;
      const tail = this._nodePathToRoot(node.index);
      if (!tail) continue;
      const tailLength = lengthOf(tail.paths);
      if (best && Math.abs(node.totalCost - best.cost) <= EPS &&
        xyLowerBound(start, node.pose) + tailLength >= best.length - EPS) continue;
      const connector = shortestPath(start, node.pose, this.radius);
      const checked = edgeResult(this._edgeCheck, connector);
      if (!checked.safe || !finite(checked.cost)) continue;
      const total = checked.cost + node.totalCost;
      const length = connector.length + tailLength;
      // Many landmark-visible edges have zero budget cost. Prefer the shorter
      // executable backup when those costs tie, regardless of root insertion order.
      if (!best || total < best.cost - EPS || (Math.abs(total - best.cost) <= EPS && length < best.length - EPS)) {
        best = {
          paths: [connector, ...tail.paths],
          cost: total,
          length,
          rootId: tail.rootId,
          nodeId: node.index,
        };
      }
    }
    return best;
  }

  revalidate() {
    let changed = false;
    // Re-check every stored edge.  The map callback may have changed since a
    // previous growth tick; no recursive walk is used here or in cost repair.
    for (const node of this.nodes) {
      if (!node || node.root || !node.edgePath) continue;
      const checked = edgeResult(this._edgeCheck, node.edgePath);
      if (node._edgeSafe !== checked.safe || Math.abs(node.edgeCost - checked.cost) > EPS) changed = true;
      node._edgeSafe = checked.safe;
      node._edgeChecked = true;
      if (checked.safe && finite(checked.cost)) {
        node.edgeCost = checked.cost;
        node.incrementalCost = checked.cost;
      }
    }

    // Propagate validity and cached costs iteratively from each root.
    const queue = this.rootNodes.slice();
    const seen = new Set();
    for (const rootIndex of this.rootNodes) {
      const root = this.nodes[rootIndex];
      if (root) {
        root.valid = true;
        root.invalid = false;
        root.totalCost = 0;
        root.cost = 0;
      }
    }
    let head = 0;
    while (head < queue.length) {
      const parentIndex = queue[head++];
      if (seen.has(parentIndex)) continue;
      seen.add(parentIndex);
      const parent = this.nodes[parentIndex];
      if (!parent) continue;
      for (const childIndex of parent.children) {
        const child = this.nodes[childIndex];
        if (!child) continue;
        const valid = parent.valid && child._edgeSafe && finite(child.edgeCost);
        if (child.valid !== valid) changed = true;
        child.valid = valid;
        child.invalid = !valid;
        child.totalCost = valid ? parent.totalCost + child.edgeCost : Infinity;
        child.cost = child.totalCost;
        queue.push(childIndex);
      }
    }
    // Nodes detached by an interrupted/recycled branch remain invalid and do
    // not accidentally become query candidates.
    for (const node of this.nodes) {
      if (!node || node.root || seen.has(node.index)) continue;
      if (node.valid) changed = true;
      node.valid = false;
      node.invalid = true;
      node.totalCost = Infinity;
      node.cost = Infinity;
    }
    if (changed) this.revision += 1;
    this.lastRevalidate = {
      changed,
      valid: this._activeNodes(true).length,
      invalid: this.nodes.filter((node) => node && !node.valid).length,
      revision: this.revision,
    };
    return this.lastRevalidate;
  }

  getEdges() {
    if (this._edgeSnapshotRevision === this.revision) return this._edgeSnapshot;
    const edges = [], colors = [];
    const palette = [[.88,.67,.38],[.36,.66,.81],[.79,.52,.72],[.47,.70,.48]];
    const rootKeys = [...this._rootIds.keys()];
    const maxSegments = 128000;
    let segmentCount = 0;
    for (const node of this.nodes) {
      if (!node || node.root || !node.valid || node.parentIndex < 0) continue;
      const parent = this.nodes[node.parentIndex];
      if (!parent || !parent.valid) continue;
      const length = lengthOf(node.edgePath);
      if (!finite(length)) throw new Error(`Invalid Dubins edge at node ${node.index}`);
      let segments = Math.min(32, Math.max(1, Math.ceil(length / 3)));
      if (segmentCount + segments > maxSegments) segments = maxSegments - segmentCount;
      if (segments <= 0) break;
      const color = palette[rootKeys.indexOf(node.rootId) % palette.length] || palette[0];
      for (let segment = 0; segment < segments; segment += 1) {
        const from = samplePath(node.edgePath, length * segment / segments);
        const to = samplePath(node.edgePath, length * (segment + 1) / segments);
        if (!from || !to) throw new Error(`Unable to sample Dubins edge at node ${node.index}`);
        edges.push(from[0], from[1], to[0], to[1]);
        colors.push(...color, ...color);
      }
      segmentCount += segments;
    }
    this._edgeSnapshot = Float32Array.from(edges);
    this._edgeColorSnapshot = Float32Array.from(colors);
    this._edgeSnapshotRevision = this.revision;
    return this._edgeSnapshot;
  }
  getEdgeColors() { this.getEdges(); return this._edgeColorSnapshot; }
}

function validationAccepts(result, budgetLimit) {
  if (!result || result.safe !== true) return false;
  if (finite(result.peakBudget) && result.peakBudget >= budgetLimit - EPS) return false;
  if (finite(result.endBudget) && result.endBudget >= budgetLimit - EPS) return false;
  return true;
}

/**
 * Try finite, descending nominal prefixes and attach a reverse-forest route.
 * The validator receives the complete candidate on every attempt, so feature
 * visibility, collisions, and budget resets are checked together.
 */
function gatekeeper(options = {}) {
  const previous = options.previous === undefined ? null : options.previous;
  const fail = (reason, validation) => {
    const result = { accepted: false, trajectory: previous, reason };
    if (validation) result.lastValidation = validation;
    return result;
  };
  if (!options.forest || typeof options.forest.query !== 'function') return fail('no-forest');
  if (typeof options.validate !== 'function') return fail('no-validator');

  const mapIsCurrent = () => typeof options.getMapVersion !== 'function' || options.getMapVersion() === options.mapVersion;
  if (!mapIsCurrent()) return fail('stale-map');
  const nominal = normalisePaths(options.nominalPaths);
  const fullLength = lengthOf(nominal);
  if (!finite(fullLength) || fullLength < 0) return fail('non-finite-nominal');
  const speed = Math.abs(Number(options.speed) || 0);
  const dt = finite(Number(options.dt)) && Number(options.dt) > 0 ? Number(options.dt) : 0.2;
  const increment = speed * dt;
  const budgetUsed = finite(Number(options.budgetUsed)) ? Number(options.budgetUsed) : 0;
  const budgetLimit = finite(Number(options.budgetLimit)) ? Number(options.budgetLimit) : Infinity;
  const maxSteps = 10000;
  const step = increment > EPS ? increment : (fullLength > EPS ? fullLength : 1);
  const requiredSteps = fullLength > EPS ? Math.ceil(fullLength / step) : 0;
  const steps = Math.min(maxSteps, requiredSteps);
  const capped = requiredSteps > maxSteps;
  let lastValidation = null;
  let lastReason = 'no-safe-prefix';

  for (let i = 0; i <= steps; i += 1) {
    let switchDistance = fullLength > EPS ? Math.max(0, fullLength - i * step) : 0;
    const endpoint = switchDistance <= EPS
      ? poseCopy(options.pose)
      : sampledPath(nominal, switchDistance);
    if (!endpoint) {
      lastReason = 'nominal-sample-failed';
      continue;
    }
    const backup = options.forest.query(endpoint);
    if (!backup || !Array.isArray(backup.paths)) {
      lastReason = 'no-backup';
      continue;
    }
    const nominalPrefix = prefixedPaths(nominal, switchDistance);
    const candidate = nominalPrefix.concat(backup.paths);
    const validation = options.validate(candidate, budgetUsed, { rootId: backup.rootId });
    lastValidation = validation;
    if (!mapIsCurrent()) return fail('stale-map', validation);
    if (!validationAccepts(validation, budgetLimit)) {
      lastReason = validation && validation.safe === false ? 'validation-rejected' : 'budget-rejected';
      continue;
    }
    const backupLength = lengthOf(backup.paths);
    return {
      accepted: true,
      trajectory: {
        nominalPaths: nominalPrefix,
        backupPaths: backup.paths,
        switchDistance,
        totalLength: switchDistance + backupLength,
        rootId: backup.rootId,
        mapVersion: options.mapVersion,
      },
      validation,
    };
  }
  // A very long nominal path with a tiny speed*dt increment is still
  // bounded above.  Evaluate the endpoint once after the capped descending
  // sweep so that a valid zero-prefix fallback remains possible.
  if (capped && steps > 0) {
    const endpoint = poseCopy(options.pose);
    const backup = options.forest.query(endpoint);
    if (backup && Array.isArray(backup.paths)) {
      const candidate = backup.paths.slice();
      const validation = options.validate(candidate, budgetUsed, { rootId: backup.rootId });
      lastValidation = validation;
      if (!mapIsCurrent()) return fail('stale-map', validation);
      if (validationAccepts(validation, budgetLimit)) {
        return {
          accepted: true,
          trajectory: {
            nominalPaths: [],
            backupPaths: backup.paths,
            switchDistance: 0,
            totalLength: lengthOf(backup.paths),
            rootId: backup.rootId,
            mapVersion: options.mapVersion,
          },
          validation,
        };
      }
    }
  }
  return fail(lastReason, lastValidation);
}

export { ReRoot, gatekeeper };
