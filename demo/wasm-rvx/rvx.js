/* @ts-self-types="./rvx.d.ts" */
import * as wasm from "./rvx_bg.wasm";
import { __wbg_set_wasm } from "./rvx_bg.js";

__wbg_set_wasm(wasm);
wasm.__wbindgen_start();
export {
    rv_capabilities, rv_cdf, rv_log_prob, rv_sample, rv_sample_dim
} from "./rvx_bg.js";
