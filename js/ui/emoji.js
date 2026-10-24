// لوحة الإيموجي (مثل العنود: .ppop ثابتة فوق زر الإيموجي، عرض 300، أقصى ارتفاع 310)
import { EMO } from "../data/emo.js";
import { on } from "../state.js";
import { syncUrl } from "../api/images.js";
const $ = window.jQuery;

let $pop = null, target = null;

function build() {
  $pop = $('<div class="ppop light border break" style="max-height:310px;"></div>');
  const $in = $('<div class="break" style="width:300px;background-color:#fafafa;"></div>');
  EMO.forEach((f, i) => {
    const src = f.startsWith("db:") ? syncUrl(f) || "" : "emo/" + f;
    $in.append(`<img style="margin:2px;" class="emoi hand" loading="lazy" width="20" height="20" src="${src}" title="${i + 1}" alt="">`);
  });
  $pop.append($in).hide().appendTo("body");
  $pop.on("click", "img", function () {
    if (target) {
      const t = target, code = ` ف${this.title} `;
      const a = t.selectionStart ?? t.value.length, b = t.selectionEnd ?? t.value.length;
      t.value = t.value.slice(0, a) + code + t.value.slice(b);
      t.focus();
      t.selectionStart = t.selectionEnd = a + code.length;
    }
    closeEmo();
  });
}

export function closeEmo() { if ($pop) $pop.hide(); target = null; }

function openFor(box) {
  if (!$pop) build();
  const ta = $(box).closest(".tablebox").find("textarea")[0];
  if ($pop.is(":visible") && target === ta) return closeEmo();
  target = ta;
  $pop.css({ left: 0, top: 0 }).show();
  const b = box.getBoundingClientRect(), w = $pop.outerWidth(), h = $pop.outerHeight();
  // يمين اللوحة عند يسار الزر +2، وتحتها عند أعلى الزر +2
  const left = Math.max(0, Math.min(b.left + 2 - w, window.innerWidth - w));
  const top = Math.max(0, b.top + 2 - h);
  $pop.css({ left: left + "px", top: top + "px" });
}

export function initEmoji() {
  // تغيّرت الإبتسامات من إداره الموقع: اللوحة تنبني من جديد
  on("site", () => { if ($pop && !$pop.is(":visible")) { $pop.remove(); $pop = null; } });
  $(document).on("click", ".emobox", function (e) { e.stopPropagation(); openFor(this); });
  $(document).on("mousedown touchstart", (e) => {
    if ($pop && $pop.is(":visible") && !$(e.target).closest(".ppop, .emobox").length) closeEmo();
  });
}
