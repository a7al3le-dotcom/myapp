import { readFileSync } from "node:fs";
import { join } from "node:path";
import LegacyBoot from "@/components/LegacyBoot";
import CpFit from "@/components/CpFit";

// The reference site serves the same page at /cp; its client switches to control-panel mode by the path.
const BODY = readFileSync(join(process.cwd(), "lib", "legacy-cp-body.html"), "utf8");

export default function ControlPanel() {
  return (
    <>
      <link rel="stylesheet" href="/css/cp-mobile.css?v=4" />
      <div dangerouslySetInnerHTML={{ __html: BODY }} style={{ display: "contents" }} />
      <LegacyBoot />
      <CpFit />
    </>
  );
}
