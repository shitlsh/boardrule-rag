import coreWebVitals from "eslint-config-next/core-web-vitals";
import nextTypescript from "eslint-config-next/typescript";

/** @type {import("eslint").Linter.Config[]} */
const config = [
  ...coreWebVitals,
  ...nextTypescript,
  { ignores: ["generated/**"] },
  {
    rules: {
      // Remote / user-supplied cover URLs; next/image needs domains config per host.
      "@next/next/no-img-element": "off",
    },
  },
];

export default config;
