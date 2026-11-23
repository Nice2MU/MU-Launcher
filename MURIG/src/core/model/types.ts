export interface Vec2 {
  x: number;
  y: number;
}

export interface Bone {
  id: string;
  name: string;
  parentId: string | null;
  /** Local position relative to parent bone (or canvas origin if root) */
  x: number;
  y: number;
  /** Local rotation in degrees */
  rotation: number;
  scaleX: number;
  scaleY: number;
  /** Visual bone length in canvas pixels */
  length: number;
  /** Visual bone angle offset in degrees (0 = pointing up/right) */
  visualAngle: number;
}

export interface PartGroup {
  id: string;
  name: string;
  boneId: string;
  pivot: Vec2;
  visible: boolean;
  skinned?: boolean;
  collapsed?: boolean;
}

export interface VertexWeightMap {
  cols: number;
  rows: number;
  /** Per-vertex map of boneId -> weight (normalized to sum 1) */
  weights: Record<string, number>[];
}

export interface Part {
  id: string;
  name: string;
  boneId: string;
  /** Optional PartGroup id; when set, the group's boneId/visibility/skinning lock all member parts together */
  groupId?: string | null;
  /** Data URL or asset path for the trimmed PNG */
  imageDataUrl: string;
  /** Top-left position of the trimmed image in original PSD canvas coordinates */
  x: number;
  y: number;
  /** Trimmed width and height */
  w: number;
  h: number;
  /** Pivot in original PSD canvas coordinates */
  pivot: Vec2;
  /** Draw order (higher = in front) */
  z: number;
  visible: boolean;
  alpha: number;
  /** Parallax strength when AngleX / AngleY changes (0..1) */
  parallax: number;
  /** Natural tilt angle (degrees) along which scaleX/scaleY deform (e.g. tilted eyes blinking) */
  scaleAngle?: number;
  /** Enable smooth mesh skinning across neighboring bones */
  skinned?: boolean;
  /** Custom Unity-style painted bone weights per mesh vertex */
  meshWeights?: VertexWeightMap;
  /** Optional variant textures keyed by variant name (e.g. "open", "close") */
  variants?: Record<string, string>;
  activeVariant?: string;
}

export type BindingProp = 'x' | 'y' | 'rotation' | 'scaleX' | 'scaleY' | 'alpha';

export interface BindingKey {
  param: number;
  value: number;
}

export interface ParamBinding {
  targetType: 'bone' | 'part';
  targetId: string;
  prop: BindingProp;
  keys: BindingKey[];
}

export interface Param {
  id: string;
  name: string;
  min: number;
  max: number;
  defaultValue: number;
  value: number;
  bindings: ParamBinding[];
}

export interface ImportWarning {
  code: string;
  message: string;
  layerName?: string;
}

export type EaseType = 'linear' | 'easeInOut' | 'easeIn' | 'easeOut' | 'step';
export type AnimProp = 'x' | 'y' | 'rotation' | 'scaleX' | 'scaleY';

export interface Keyframe {
  t: number;
  v: number;
  ease: EaseType;
}

export interface AnimTrack {
  id: string;
  targetType: 'bone' | 'param';
  targetId: string;
  prop: AnimProp | 'value';
  keys: Keyframe[];
}

export interface AnimClip {
  id: string;
  name: string;
  duration: number;
  fps: number;
  loop: boolean;
  tracks: AnimTrack[];
}

export interface Character {
  id: string;
  name: string;
  canvasWidth: number;
  canvasHeight: number;
  bones: Bone[];
  parts: Part[];
  partGroups: PartGroup[];
  params: Param[];
  clips?: AnimClip[];
  warnings: ImportWarning[];
}

export interface MurigProject {
  version: 1;
  name: string;
  sourcePsdPath?: string;
  activeCharacterId: string;
  characters: Character[];
}

export type EditorMode = 'rig' | 'pose' | 'animate';
export type RigTool = 'select' | 'weight';
