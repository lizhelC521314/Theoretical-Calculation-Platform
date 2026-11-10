/**
 * 版本开关：同一代码库通过 Vite 构建模式区分两个交付形态。
 * - 科研版：`npm run build`（默认 production 模式）
 * - 标准版：`npm run build:standard`（`vite build --mode standard`）
 */
export const IS_STANDARD = import.meta.env.MODE === 'standard';

export const EDITION_LABEL = IS_STANDARD ? '标准版' : '科研版';
