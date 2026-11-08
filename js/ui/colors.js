// منتقي الألوان للعناصر .cpick — نفس العنود: نافذة .ppop فيها 168 لون، مربعات 40×40،
// مساحة 260×200 تنزل بالسكرول، تطلع يسار الزر وبنفس مستواه، والاختيار يقفلها.
const $ = window.jQuery;

function palette() {
  const out = [], base = [0x3e, 0x8e, 0xde];
  // كل لون أساسي له 6 درجات: ينقص 15 كل مرة، والأخيرة = الأساس − 70
  const shades = (b) => [0, 1, 2, 3, 4].map((k) => b - 15 * k).concat(Math.max(b - 70, 0));
  const hex = (n) => n.toString(16).padStart(2, "0");
  for (const r of base) for (const g of base) for (const b of base) {
    const R = shades(r), G = shades(g), B = shades(b);
    for (let i = 0; i < 6; i++) out.push("#" + hex(R[i]) + hex(G[i]) + hex(B[i]));
  }
  return out.concat(["#ffffff", "#ffffff", "#ffffff", "#f0f0f0", "#e1e1e1", "#d7d7d7"]);
}

let $box = null, cur = null;

export const getColor = (el) => $(el).attr("data-color") || "#000000";
export function setColor(el, c) { $(el).attr("data-color", c).css("background-color", c); }

export function initColors() {
  $box = $('<div class="ppop light border break" style="display:none;"></div>');
  const $in = $('<div style="width:260px;height:200px;line-height:0!important;" class="break"></div>');
  palette().forEach((c) => $in.append(`<div data-c="${c}" class="hand" style="width:40px;height:40px;background-color:${c};display:inline-block;"></div>`));
  $in.append('<div style="width:40px;height:40px;display:inline-block;"></div>'); // مربع فاضي في آخر قائمة العنود
  $box.append($in).appendTo("body");
  $box.on("click", "[data-c]", function () {
    if (cur) { setColor(cur, this.dataset.c.toLowerCase()); $(cur).trigger("colorchange"); }
    $box.hide();
  });
  $(document).on("click", ".cpick", function (e) {
    e.stopPropagation();
    if ($box.is(":visible") && cur === this) return $box.hide();
    cur = this;
    $box.css({ left: 0, top: 0 }).show();
    const r = this.getBoundingClientRect(), w = $box.outerWidth(), h = $box.outerHeight();
    const left = Math.max(0, Math.min(r.left - 260, window.innerWidth - w));
    const top = Math.max(0, Math.min(r.top, window.innerHeight - h));
    $box.css({ left: left + "px", top: top + "px" });
  });
  $(document).on("mousedown touchstart", (e) => { if (!$(e.target).closest(".ppop, .cpick").length) $box.hide(); });
}
