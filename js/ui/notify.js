// منبثقة التنبيه والإعجاب (قالب not) + عدّاد إعجاباتي
import { r } from "../firebase.js";
import { S, on } from "../state.js";
import { onChildAdded, onValue, remove } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-database.js";
import { tpl, fmt, safeColor, setIco } from "../util.js";
import { setPic } from "../api/images.js";

const $ = window.jQuery;

// منبثقة "تنبيه" فيها سطر شخص + نص (مثل "هذا المستخدم لا يقبل المحادثات الخاصه")
export function noteUser(u, text) {
  show({ k: "info", u, h: u && u.h, text });
}

// نفس شكل العنود: عنوان "تنبيه" + سطر المرسل (صورة، أيقونة، اسم ملوّن، #رقم) + الرسالة
function show(n) {
  const $n = tpl("not");
  $n.find(".nottitle").text("تنبيه");
  const u = n.u || {};
  const $row = $('<div class="fl borderg corner uzr d-flex" style="width:100%;padding:2px;"></div>');
  const $p = $('<img style="width:24px;height:22px;" class="fl" alt="">').appendTo($row);
  setPic($p[0], u.pic);
  const $i = $('<img class="u-ico fl" style="max-height:18px;" alt="">').appendTo($row);
  setIco($i[0], u.ico);
  $('<div style="max-width:80%;" class="dots nosel u-topic fl flex-grow-1"></div>').text(u.topic || "").css("color", safeColor(u.ucol)).appendTo($row);
  $('<span class="fr" style="color:grey;font-size:70%!important;"></span>').text("#" + (n.h || 0)).appendTo($row);
  $n.find(".nothead").replaceWith($row);
  if (n.k === "info") $n.find(".notmsg").text(n.text || "");
  else if (n.k === "like") $n.find(".notmsg").html('حصلت على إعجاب <i class="fa fa-heart" style="color:red;"></i>');
  else $n.find(".notmsg").html(fmt(n.m || ""));
  $n.on("click", () => $n.remove());
  $("body").append($n);
}

export function initNotify() {
  on("enter", () => {
    onChildAdded(r("notif/" + S.uid), (s) => {
      const n = s.val();
      remove(s.ref).catch(() => {});
      if (!n || S.ignored.has(n.from)) return;
      if (n.k === "alert" && S.nonot) return;
      show(n);
    });
    onValue(r("ucount/" + S.uid), (s) => { S.me.likes = s.val() || 0; });
  });
}
