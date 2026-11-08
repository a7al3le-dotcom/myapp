// «إداره الموقع» colours -> the original page's colour rules. Shared by the server (first paint) and the shim (live change).
/** a colour from the panel's colour picker: hex only (with or without #); anything else is ignored (it goes into CSS) */
export const hexColour = (v?: string) => (v && /^#?([0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/.test(v.trim()) ? (v.trim().startsWith("#") ? v.trim() : "#" + v.trim()) : "");

/** the CSS the original page carries for the three colours (its own rules, values from the settings) */
export function colourCss(t: { bg?: string; background?: string; buttons?: string }): string {
  const bg = hexColour(t.bg), content = hexColour(t.background), btn = hexColour(t.buttons);
  return [
    bg ? `.bg{background-color:${bg}}` : "",
    content ? `.light{background-color:${content}}` : "",
    btn ? `.label-primary,.btn-primary,.bg-primary,.label-primary:hover,.btn-primary:hover,.btn-primary:focus{background-color:${btn};background-image:none}.label-primary,.btn-primary{background-color:${btn}!important}#mic .mic,#muteall{background-color:${btn}}` : "",
  ].join("");
}

