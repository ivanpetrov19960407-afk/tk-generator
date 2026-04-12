export type Texture = 'лощение' | 'рельефная_матовая' | 'бучардирование_лощение' | string;

export interface Dimensions {
  length: number;
  width: number;
  thickness: number;
}

export interface Material {
  type: string;
  name: string;
  density?: number;
}

export interface Product {
  tk_number?: number;
  name: string;
  short_name?: string | null;
  dimensions: Dimensions;
  material: Material;
  texture: Texture;
  quantity?: string | null;
  quantity_pieces?: number;
  edges?: string;
  geometry_type?: string;
  category?: string;
  gost_primary?: string;
  packaging?: string;
  date?: string;
  control_price?: number | null;
  control_unit?: string;
  control_coefficient?: number;
  markup_percent?: number;
  overrides_path?: string;
  operation_overrides?: {
    drop_operations?: number[];
    replace_fields?: Record<string, Record<string, unknown>>;
  };
  rkm?: {
    transport?: {
      skip?: boolean;
      distance_km?: number;
      tariff_rub_km?: number;
      trips?: number;
      loading?: number;
      unloading?: number;
      insurance_pct?: number;
    };
    norms_override?: Record<string | number, { chel_ch?: number; mash_ch?: number }>;
    material_prices?: Record<string, number>;
    overrides_overheads?: Record<string, number>;
    k_reject?: number;
  };
  [key: string]: unknown;
}

export interface BatchInput {
  products: Product[];
  [key: string]: unknown;
}

export interface GenerationResult {
  success?: boolean;
  filePath?: string | null;
  filename?: string | null;
  sizeKB?: number;
  files?: Array<{ format: 'docx' | 'pdf'; filePath: string; filename: string; sizeKB: number }>;
  warnings?: string[];
  product?: Product;
  error?: string;
  cached?: boolean;
  profile?: Record<string, unknown>;
}

export interface RKMResult {
  success: boolean;
  file?: string;
  optimized?: boolean;
  converged?: boolean | null;
  summary?: {
    materials: number;
    operations: number;
    logistics: number;
    itogo_bez_NDS: number;
    itogo_s_NDS: number;
    per_piece_s_NDS?: number;
    per_m2_s_NDS?: number;
    control_price?: number | null;
  };
  error?: string;
  product?: Product;
  cached?: boolean;
  durationMs?: number;
  profile?: Record<string, unknown>;
}

export interface Config {
  locale: string;
  company: {
    name: string;
    address: string;
    INN: string;
    KPP: string;
    rs: string;
    bank: string;
    ks: string;
    BIK: string;
    tel: string;
    email: string;
    [key: string]: string;
  };
  rkm: {
    logisticsDefaults: {
      distance_km: number;
      tariff_rub_km: number;
      trips: number;
      loading: number;
      unloading: number;
      insurance_pct: number;
      [key: string]: number;
    };
    skipTransportTkNumbers: number[];
    specialMaterialRules: Record<string, Record<string, unknown>>;
  };
  cost: {
    paths: {
      laborRatesPath?: string;
      equipmentCostsPath?: string;
      materialPricesPath?: string;
      overheadPath?: string;
      [key: string]: string | undefined;
    };
  };
  auth: {
    enabled: boolean;
    accessTokenTtlSec: number;
    refreshTokenTtlSec: number;
    jwtSecret: string;
  };
  bot: {
    allowedUsers: number[];
  };
  plugins_enabled: boolean;
  allowed_plugins: string[];
  autoUpdate: {
    enabled: boolean;
    checkInterval: string;
  };
  webhooks: Array<{
    id?: number;
    url: string;
    events: string[];
    secret?: string | null;
    enabled?: boolean;
  }>;
}

export interface Plugin {
  name: string;
  version: string;
  type: 'material' | 'operation' | 'texture' | 'export';
  dependencies: string[];
  path: string;
}
