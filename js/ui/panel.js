// اللوحة الجانبية #dpnl وأزرار #d0
import { emit } from "../state.js";
const $ = window.jQuery;

export function fixSize() {
  const w = Math.min(340, Math.max(0, window.innerWidth - 104));
  $("#dpnl").css("width", w + "px");
}

export function openPanel(tab, title) {
  const $b = $(`#d0 [data-target="#${tab}"]`);
  $("#dpnl .pnhead").text(title || $b.attr("title") || "");
  $("#dpnl > .tab-pane").removeClass("active");
  $("#" + tab).addClass("active");
  fixSize();
  $("#dpnl").show();
  emit("panel", tab);
}

export const closePanel = () => { $("#dpnl").hide(); emit("panel", null); };
export const panelTab = () => ($("#dpnl").is(":visible") ? $("#dpnl > .tab-pane.active").attr("id") : null);

export function initPanel() {
  $("#d0 .ae").on("click", function () {
    const tab = $(this).data("target").slice(1);
    openPanel(tab, $(this).attr("title"));
    if (tab === "users") { $("#usearch").val("").trigger("input"); setTimeout(() => $("#users").scrollTop(0), 100); }
    if (tab === "wall") setTimeout(() => $("#d2bc").scrollTop(0));
  });
  $("#dpnlclose").on("click", closePanel);
  // الضغط على الرسائل أو شريط الكتابة يقفل اللوحة
  $("#d2, #room > .footer").on("mousedown touchstart", () => { if ($("#dpnl").is(":visible")) closePanel(); });
  $(window).on("resize", fixSize);
  fixSize();
}
