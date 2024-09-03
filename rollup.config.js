// rollup.config.js
import typescript from '@rollup/plugin-typescript';
import { terser } from "rollup-plugin-terser";

import resolve from '@rollup/plugin-node-resolve';

export default [
{
  input: './src/index.ts',
  output: {
    dir: './dist'
  },
  plugins: [typescript({
    tsconfig: "./src/tsconfig.json"
  }),resolve({
    browser:true
  }),terser({ format: { comments: false } })]
}
];
