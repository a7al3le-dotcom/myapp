// رسم رسالة واحدة بقالب umsg (للغرفة والحائط والخاص والردود)
import { S, emit } from "../state.js";
import { tpl, fillUser, fmt, ago, safeColor, esc } from "../util.js";
import { setPic } from "../api/images.js";

const $ = window.jQuery;
const ytId = (s) => (/^[\w-]{11}$/.test(s || "") ? s : null);

function media($b, m) {
  if (m.img) {
    const $btn = $('<div style="width:100%;"><button class="btn fl fa fa-image" style="color:black;">عرض الصوره</button></div>');
    $btn.find("button").on("click", function () {
      const $img = $('<img class="msgimg hand" alt="">');
      setPic($img[0], m.img, "pic.png");
      $img.on("click", () => window.open($img.attr("src"), "_blank"));
      $(this).replaceWith($img);
    });
    $b.append($btn);
  }
  const yt = ytId(m.yt);
  if (yt) {
    // مثل العنود: زر يوتيوب كبير فيه صورة المقطع، والضغط يحطّ المشغّل مكانه
    const $btn = $(`<button style="font-size:40px!important;width:100%;max-width:200px;" class="btn fa fa-youtube"><img style="width:80px;" alt="[YouTube]" src="https://img.youtube.com/vi/${yt}/0.jpg"></button>`);
    $btn.find("img").on("error", () => $btn.remove());
    $btn.on("click", (e) => {
      e.stopPropagation();
      $btn.replaceWith(`<iframe width="95%" style="max-width:240px;" height="200" src="https://www.youtube.com/embed/${yt}?autoplay=1" frameborder="0" allow="autoplay; encrypted-media; picture-in-picture" allowfullscreen></iframe>`);
    });
    $b.append($btn);
  }
}

/*
  opts: { id, likes, reply, del, onLike, onReply, onDel, cls }
*/
export function renderMsg(m, opts = {}) {
  const $e = tpl("umsg");
  if (opts.id) $e.attr("data-id", opts.id);
  if (opts.cls) $e.addClass(opts.cls);
  const u = m.u || {};
  fillUser($e, u, { msg: false });
  const open = () => { if (m.uid) emit("profile", m.uid); };
  $e.find(".u-pic").first().on("click", open);
  if (!opts.picOnly) $e.find(".u-topic").first().on("click", open);
  $e.find(".tago").attr("data-ts", m.ts || 0).text(ago(m.ts));

  const $b = $e.find(".u-msg").first();
  if (m.t === "j") {
    $e.addClass("hmsg");
    const rm = S.rooms[m.room] || {};
    const $rb = $(`<div class="fl btn btn-primary dots roomh border corner minix" style="margin-left:-4px;padding:4px;max-width:180px;min-width:60px;"></div>`);
    $rb.text(rm.topic || m.rt || "").on("click", () => emit("rjoin", m.room)); // اسم الغرفة مثل "الغرفه العامه ( 1 )"
    $b.append($rb).append(document.createTextNode(" هذا المستخدم قد دخل"));
  } else if (m.t === "v") {
    // انتقل لغرفة ثانية (مثل العنود: "هذا المستخدم أنتقل ألى" + زر الغرفة)
    $e.addClass("hmsg");
    const rm = S.rooms[m.to] || {};
    const $rb = $(`<div class="fl btn btn-primary dots roomh border corner minix" style="margin-left:-4px;padding:4px;max-width:180px;min-width:60px;"></div>`);
    $rb.text(rm.topic || m.rt || "").on("click", () => emit("rjoin", m.to));
    $b.append($rb).append(document.createTextNode(" هذا المستخدم أنتقل ألى"));
  } else if (m.t === "k") {
    // "( تم طرد هذا المستخدم )" بنفس لون "دخل" (طلب المالك)
    $e.addClass("hmsg");
    $b.text(m.m || "");
  } else if (m.t === "l" || m.t === "x") {
    $e.addClass("hmsg");
    $b.text(m.t === "l" ? "(هذا المستخدم قد غادر الغرفه)" : "(هذا المستخدم قد غادر الدردشه)");
  } else {
    $b.css("color", safeColor(u.mcol));
    $b.html(fmt(m.m || ""));
    media($b, m);
  }

  if (opts.likes || opts.reply || opts.del) {
    const $btns = tpl("mbtns");
    const $like = $btns.find(".blike"), $rep = $btns.find(".breply"), $del = $btns.find(".bdel");
    if (opts.likes) { $like.on("click", (e) => { e.stopPropagation(); opts.onLike && opts.onLike(); }); } else $like.remove();
    if (opts.reply) { $rep.on("click", (e) => { e.stopPropagation(); opts.onReply && opts.onReply(); }); } else $rep.remove();
    if (opts.del) { $del.on("click", (e) => { e.stopPropagation(); opts.onDel && opts.onDel(); }); } else $del.remove();
    $b.append($btns);
  }
  setLikes($e, m.likes);
  return $e;
}

export function setLikes($e, likes) {
  const n = likes ? Object.keys(likes).length : 0;
  $e.find(".blike").first().text(n ? String(n) : "");
}

// نص رسالة محلية (ترحيب) بنفس القالب
export function localMsg(topic, text, color, pic) {
  const $e = tpl("umsg").addClass("pmsgc");
  $e.find(".u-ico").hide();
  $e.find(".u-topic").text(topic).css("color", color || "red");
  setPic($e.find(".u-pic")[0], pic || "room.png", "room.png");
  $e.find(".tago").attr("data-ts", Date.now()).text("0د");
  $e.find(".u-msg").html(fmt(text));
  return $e;
}

export const escHtml = esc;
