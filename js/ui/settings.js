// لوحة الإعدادات (الضبط)
import { S, on, getv, setv } from "../state.js";
import { r } from "../firebase.js";
import { get } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-database.js";
import { SITE } from "../config.js";
import { upload, setPic } from "../api/images.js";
import { validName, toast, safeColor, nameKey } from "../util.js";
import { getColor, setColor } from "./colors.js";
import { saveMe, logout } from "../session.js";
import { openRoomEdit, canEditRoom } from "./rooms.js";
import { needLikes, badName } from "./extras.js";

const $ = window.jQuery;

function fill() {
  const me = S.me;
  $("#settings .stopic").val(me.topic);
  $("#settings .smsg").val(me.msg || "");
  setColor($("#settings .scolor"), safeColor(me.ucol));
  setColor($("#settings .mcolor"), safeColor(me.mcol));
  setColor($("#settings .sbg"), safeColor(me.bg, "#ffffff"));
  setPic($("#settings .spic")[0], me.pic);
  $("#nopm span").toggleClass("fa-check", !!me.busy);
  $("#nonot span").toggleClass("fa-check", !!S.nonot);
  refreshRoomBtn();
}

function refreshRoomBtn() {
  $("#redit").toggle(canEditRoom(S.room));
  // لوحه التحكم لصاحب أي صلاحية من تبويباتها
  const p = S.perms;
  $("#cplink").toggle(!!(S.owner || p.cp || p.ban || p.editpower || p.cpsubs || p.setpower || p.filter || p.cprooms || p.cpshrt || p.cpmsgs || p.cpwrooms || p.cpsite || p.cpdomains));
}

const taken = (name) => Object.entries(S.users).some(([uid, u]) => uid !== S.uid && nameKey(u.topic) === nameKey(name));

export function initSettings() {
  const z = getv("zoom", "1");
  $("#zoom").val(z);
  if (z !== "1") document.body.style.zoom = z;
  $("#zoom").on("change", function () { const v = this.value; requestAnimationFrame(() => { document.body.style.zoom = v; }); setv("zoom", v); });
  $("#turn_server").val(getv("turn_server", "1")).on("change", function () { setv("turn_server", this.value); });
  $("#turn_bitrate").val(getv("bitrate", "24")).on("change", function () { setv("bitrate", this.value); });
  S.nonot = getv("nonot") === "1";

  $("#setprofile").on("click", async () => {
    const topic = $("#settings .stopic").val().trim(), msg = $("#settings .smsg").val().trim().slice(0, 150);
    if (!validName(topic, 40) || taken(topic) || badName(topic)) return toast("يرجى إختيار أسم آخر");
    // تغيير الزخرفه أو الحاله يحتاج إعجابات (إداره الموقع)
    if ((topic !== S.me.topic || msg !== (S.me.msg || "")) && needLikes(SITE.proflikes, "تغير الزخرفه والحاله يتطلب N إعجاب")) return;
    const owner = (await get(r("names/" + nameKey(topic))).catch(() => null))?.val();
    if (owner && owner !== S.uid) return toast("هذا الإسم مسجل من قبل");
    try {
      await saveMe({
        topic, msg,
        ucol: getColor($("#settings .scolor")), mcol: getColor($("#settings .mcolor")), bg: getColor($("#settings .sbg"))
      });
      // يحفظ مباشرة بدون رسالة (مثل العنود)
    } catch (e) { console.error(e); toast("فشل الحفظ"); }
  });

  $("#changepic").on("click", () => {
    if (needLikes(SITE.piclikes, "تغير الصوره يتطلب N إعجاب")) return;
    $("#filepick").off("change").val("").one("change", async function () {
      const f = this.files[0];
      if (!f) return;
      if (f.size > 15 * 1024 * 1024) return toast("حجم الملف كبير. ");
      try { const pic = await upload(f, "avatar"); await saveMe({ pic }); setPic($("#settings .spic")[0], pic); }
      catch (e) { toast(e.message === "type" ? "نوع الملف غير مناسب: \n" + f.type : "فشل إرسال الصوره تأكد ان حجم الصوره مناسب"); }
    }).trigger("click");
  });
  $("#delpic").on("click", async () => { await saveMe({ pic: "pic.png" }).catch(() => {}); setPic($("#settings .spic")[0], "pic.png"); });

  $("#nopm").on("click", async function () {
    const busy = !S.me.busy;
    $(this).find("span").toggleClass("fa-check", busy);
    await saveMe({ busy }).catch(() => {});
  });
  $("#nonot").on("click", function () {
    S.nonot = !S.nonot;
    setv("nonot", S.nonot ? "1" : null);
    $(this).find("span").toggleClass("fa-check", S.nonot);
  });
  $("#redit").on("click", openRoomEdit);
  $("#logout").on("click", logout); // العنود يطلع مباشرة بدون سؤال

  on("enter", fill);
  on("panel", (tab) => { if (tab === "settings") fill(); });
  on("room", refreshRoomBtn);
  on("rooms", refreshRoomBtn);
  on("perms", refreshRoomBtn);
  // لوحة التحكم تنفتح في نافذة ثانية وتستخدم اتصال الشات (مثل العنود: تحتاج window.opener)
  $("#cplink").on("click", (e) => { e.preventDefault(); window.open("cp.html", "_blank"); });
}
