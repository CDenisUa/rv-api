/* tslint:disable */
/* eslint-disable */

/**
 * Recomputed capabilities as a JSON string `{ "can_sample", "can_log_prob", "can_cdf" }`.
 */
export function rv_capabilities(doc: string): string;

/**
 * Cumulative probability P(X ≤ x) at a scalar point.
 */
export function rv_cdf(doc: string, x: number): number;

/**
 * log-density/mass at a scalar point.
 */
export function rv_log_prob(doc: string, x: number): number;

/**
 * Draw `n` samples (univariate RVs only) as a `Float64Array`.
 */
export function rv_sample(doc: string, seed: number, n: number): Float64Array;

/**
 * Draw `n` samples of dimension `dim` as a `Float64Array`. Univariate RVs use `dim = 0`; for a
 * Joint the full vector is drawn and the requested dimension is returned.
 */
export function rv_sample_dim(doc: string, seed: number, n: number, dim: number): Float64Array;
