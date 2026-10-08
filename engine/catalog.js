// What the world is made of: terrain types and props (objects standing on a tile).
// The renderer, the editor and the world generator all read these tables.
// To add a new prop: add an entry here and a mesh builder in props.js.

export const TERRAINS = {
  water:   { name: 'Water',        color: '#3d8fb8', walkable: false, liquid: true },
  deep:    { name: 'Deep water',   color: '#245f8f', walkable: false, liquid: true },
  sand:    { name: 'Sand',         color: '#e8d39a' },
  grass:   { name: 'Grass',        color: '#7cc35a' },
  meadow:  { name: 'Meadow',       color: '#9fd067' },
  forest:  { name: 'Forest floor', color: '#4f9a45' },
  dry:     { name: 'Dry grass',    color: '#c2c26a' },
  dirt:    { name: 'Dirt',         color: '#a87b52' },
  path:    { name: 'Path',         color: '#d9b98a' },
  stone:   { name: 'Paving',       color: '#b9b4ab' },
  bridge:  { name: 'Bridge',       color: '#9c6b3f' },
  rock:    { name: 'Rock',         color: '#8d8a85' },
  snow:    { name: 'Snow',         color: '#f2f6fa' },
};

/** Side (cliff) colour per terrain — the dirt/rock you see under a raised tile. */
export const SIDE_COLORS = {
  sand: '#c9ad6e', snow: '#b8c3cc', rock: '#6f6b66', stone: '#8f8a82', bridge: '#6e4a2b',
  default: '#8a6446',
};

/**
 * Props. `block`: the tile cannot be walked on. `footprint`: radius in tiles of the
 * blocked square around the anchor (buildings). `encounter`: wild creatures hide here.
 * `talk`: interacting shows the tile's text (signs).
 */
export const PROPS = {
  tree_oak:   { name: 'Oak tree',     block: true },
  tree_pine:  { name: 'Pine tree',    block: true },
  tree_snow:  { name: 'Snowy pine',   block: true },
  tree_palm:  { name: 'Palm tree',    block: true },
  tree_cherry:{ name: 'Cherry tree',  block: true },
  bush:       { name: 'Bush',         block: true },
  rock:       { name: 'Rock',         block: true },
  boulder:    { name: 'Boulder',      block: true },
  flowers:    { name: 'Flowers' },
  tallgrass:  { name: 'Tall grass',   encounter: true },
  mushroom:   { name: 'Mushrooms' },
  house:      { name: 'House',        block: true, footprint: 1 },
  tower:      { name: 'Tower',        block: true, footprint: 1 },
  fence:      { name: 'Fence',        block: true },
  lamp:       { name: 'Lamp post',    block: true, light: true },
  sign:       { name: 'Sign',         block: true, talk: true },
  crate:      { name: 'Crate',        block: true },
  well:       { name: 'Well',         block: true },
  campfire:   { name: 'Campfire',     block: true, light: true },
  chest:      { name: 'Chest',        block: true, talk: true },
};

/** Creature elements and what beats what (attacker → defender → multiplier). */
export const ELEMENTS = {
  leaf:  { name: 'Leaf',  color: '#5fbf4a' },
  fire:  { name: 'Fire',  color: '#f0703a' },
  water: { name: 'Water', color: '#3f9be0' },
  stone: { name: 'Stone', color: '#a08a6a' },
  spark: { name: 'Spark', color: '#f2cf3a' },
  air:   { name: 'Air',   color: '#9ad7e8' },
};

export const EFFECTIVENESS = {
  leaf:  { water: 2, stone: 2, fire: 0.5, air: 0.5 },
  fire:  { leaf: 2, air: 1, water: 0.5, stone: 0.5 },
  water: { fire: 2, stone: 2, leaf: 0.5, spark: 0.5 },
  stone: { fire: 2, spark: 2, air: 2, leaf: 0.5, water: 0.5 },
  spark: { water: 2, air: 2, stone: 0.5, leaf: 0.5 },
  air:   { leaf: 2, fire: 1, stone: 0.5, spark: 0.5 },
};

export const ITEMS = {
  potion:  { name: 'Potion',      desc: 'Restores 25 HP to one creature.' },
  orb:     { name: 'Capture orb', desc: 'Throw it at a weakened wild creature to befriend it.' },
  berry:   { name: 'Berry',       desc: 'Restores 10 HP.' },
  key:     { name: 'Old key',     desc: 'Opens something, somewhere.' },
};
