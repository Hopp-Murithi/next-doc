import type { Finding, Rule, ScanContext } from "../../../core/types.js";
import { finding } from "../../../core/plugin.js";

interface Overlap {
  label: string;
  packages: string[];
  advice: string;
}

const GROUPS: Overlap[] = [
  {
    label: "date libraries",
    packages: ["moment", "dayjs", "date-fns", "luxon", "js-joda", "@js-joda/core"],
    advice: "Pick one. moment in particular pulls in every locale unless configured.",
  },
  {
    label: "HTTP clients",
    packages: ["axios", "got", "superagent", "ky", "node-fetch", "request"],
    advice: "Native fetch covers most cases in both Node 18+ and the browser.",
  },
  {
    label: "state libraries",
    packages: ["redux", "@reduxjs/toolkit", "zustand", "jotai", "recoil", "mobx", "valtio"],
    advice: "Two client state libraries usually means one is left over from a migration.",
  },
  {
    label: "utility libraries",
    packages: ["lodash", "underscore", "ramda", "lodash-es"],
    advice: "Import individual functions, or drop the dependency, most of it is now in the language.",
  },
  {
    label: "UI kits",
    packages: ["@mui/material", "antd", "@chakra-ui/react", "react-bootstrap", "@mantine/core", "semantic-ui-react"],
    advice: "Each one ships its own styling runtime and its own icons.",
  },
  {
    label: "styling runtimes",
    packages: ["styled-components", "@emotion/react", "@emotion/styled", "styled-jsx", "stitches"],
    advice: "Runtime CSS-in-JS libraries each add their own bundle and hydration cost.",
  },
  {
    label: "icon sets",
    packages: ["react-icons", "@heroicons/react", "lucide-react", "@fortawesome/react-fontawesome", "@tabler/icons-react"],
    advice: "Icon packages are large. One set is usually enough.",
  },
  {
    label: "form libraries",
    packages: ["react-hook-form", "formik", "final-form", "react-final-form"],
    advice: "Pick one form library and migrate the rest.",
  },
];

/**
 * A bundle weight opportunity, not a correctness problem, so these are warnings.
 * Only direct dependencies are considered, transitive duplicates are a package
 * manager concern rather than something the app author chose.
 */
export const duplicateDependencies: Rule = {
  code: "PERF_DUPLICATE_DEPS",
  title: "No overlapping dependencies",
  async run(ctx: ScanContext): Promise<Finding[]> {
    const pkg = ctx.pkg;
    if (!pkg) return [];

    const installed = new Set([
      ...Object.keys(pkg.dependencies ?? {}),
      ...Object.keys(pkg.devDependencies ?? {}),
    ]);

    const findings: Finding[] = [];

    for (const group of GROUPS) {
      const present = group.packages.filter((name) => installed.has(name));
      // @emotion/react plus @emotion/styled is one library, not two.
      const distinct = new Set(present.map((name) => name.replace(/^@emotion\/.*/, "@emotion")));
      if (distinct.size < 2) continue;

      findings.push(
        finding.warn({
          code: "PERF_DUPLICATE_DEPS",
          message: `${present.length} overlapping ${group.label} installed: ${present.join(", ")}`,
          file: "package.json",
          fixable: false,
          suggestion: `${group.advice} Removing the extra one is usually the cheapest bundle win available.`,
        }),
      );
    }

    if (findings.length === 0) {
      return [finding.pass({ code: "PERF_DUPLICATE_DEPS", message: "No overlapping dependencies found" })];
    }

    return findings;
  },
};
