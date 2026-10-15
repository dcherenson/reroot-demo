/**
 * Compatibility entry point for the offline Catalina Mountains heightfield.
 *
 * The data now lives beside the other USGS 3DEP snapshots in ground-elevation.js.
 * Keep this module so existing world code can continue importing the Tucson names.
 */
export {
  TUCSON_CATALINA_TERRAIN,
  TUCSON_CATALINA_HEIGHTS,
  TUCSON_CATALINA_GRID_SIZE,
  sampleTucsonCatalinaHeight,
  sampleTucsonTerrain,
} from './ground-elevation.js';
