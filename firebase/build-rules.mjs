// Generates ../database.rules.json from readable helpers.
// Run: node firebase/build-rules.mjs
//
// Permission model: see "can" below. /powers/<uid> = { level, name, until? }; the flags per rank name are in /powerTable.
import { writeFileSync } from "node:fs";
import { SITE_SCHEMA } from "../lib/shim/site.ts"; // the same table the shim's shapeSite() uses

// Bootstrap admin: this one UID may write /powers and /config even before anyone holds power (so the first admin can be created from the app).
// The UID is read from /config/bootstrap (set once in the console), so it is not baked into the rules.
const isBoot = `auth != null && root.child('config/bootstrap').val() === auth.uid`;
const authed = "auth != null";
// Every ranked user has /powers/<uid>/name; the rank's flags live in /powerTable/<name> (copied from the reference site's power table,
// editable in the control panel). A permission is granted when the rank's flag is true or a positive number (e.g. kick: 99).
const FLAG = { move: "rinvite", filter: "filter", setPower: "setpower", ban: "ban", kickRoom: "kick", roomManage: "roomowner", deleteMsg: "delbc", viewReports: "cp", viewLogins: "cplogins", ad: "publicmsg", upgrade: "upgrades", alert: "alert", editPower: "editpower", setLikes: "setLikes", dmsg: "dmsg", unban: "unban", bnr: "bnr", ppmsg: "ppmsg", unick: "unick", cpMsgs: "cpmsgs", cpShrt: "cpshrt", cpWrooms: "cpwrooms", cpRooms: "cprooms", cpSite: "cpsite", cpDomains: "cpdomains", stealth: "stealth", viewNames: "history" };
const can = (perm) => {
  const r = `root.child('powerTable/' + root.child('powers/' + auth.uid + '/name').val() + '/${FLAG[perm]}')`;
  return `(auth != null && root.child('powers/' + auth.uid + '/name').exists() && ${r}.exists() && (${r}.val() === true || (${r}.val() !== false && ${r}.val() > 0)))`;
};

// ---- rank hierarchy (S3) ----
// The rank of a person is read ONLY from /powerTable/<rank name>/rank (clients may read that node, like the original sends it to everyone, written only by the owner or «إدارة الصلاحيات» below one's own rank), never from the "level"
// stored next to the person. Three states of a person: 1) no rank (no record, an expired one, or the empty rank the control panel writes when a rank
// is taken away) = an ordinary member; 2) a valid rank (a name present in the table with a numeric rank 0..10000); 3) anything else (a name the table
// does not know, a rank that is not a number or is out of range) = CORRUPT. A corrupt rank is never treated as zero: it makes the action fail,
// whether its owner is the one acting or the one acted upon.
const bootUid = `root.child('config/bootstrap').val()`;
const rec = (u) => `root.child('powers/' + ${u})`;
const rname = (u) => `${rec(u)}.child('name')`;
const rrank = (u) => `root.child('powerTable/' + ${rname(u)}.val() + '/rank')`;
function lapsed(u) { return `(${rec(u)}.child('until').isNumber() && ${rec(u)}.child('until').val() < now)`; }
const noRank = (u) => `(!${rec(u)}.exists() || ${lapsed(u)} || (${rname(u)}.val() === '' && ${rec(u)}.child('level').val() === 0))`;
const validRank = (u) => `(${rname(u)}.isString() && ${rrank(u)}.isNumber() && ${rrank(u)}.val() >= 0 && ${rrank(u)}.val() <= 10000)`;
// the one acted upon: never the owner, and either an ordinary member or someone of a STRICTLY lower rank than the actor
const targetBelow = (u) => `(${u} !== ${bootUid} && (${noRank(u)} || (${validRank(u)} && ${rrank(u)}.val() < ${rrank("auth.uid")}.val())))`;
// "actor may do <perm> to <u>": the flag, a valid unexpired rank of their own, not themselves, a target below them
const actsOn = (perm, u) => `(${can(perm)} && !${noRank("auth.uid")} && ${validRank("auth.uid")} && ${u} !== auth.uid && ${targetBelow(u)})`;
// a flag that also ignores an expired rank: used only by the paths S3 adds or rewrites (the older rules keep the check they always had)
const canLive = (perm) => `(${can(perm)} && !${lapsed("auth.uid")})`;
// the owner (config/bootstrap) is exempt from the hierarchy, but is not a target for anybody else and does not act on themselves
const ownerOver = (u) => `(${isBoot} && ${u} !== auth.uid)`;
// a field of the profile node is unchanged by this write (whole-object, partial and multi-path writes alike: newData is the result)
const same = (k) => `newData.child('${k}').val() === data.child('${k}').val()`;
// the new actionLog entry's own fields, as the rules see them
const T = "newData.child('type').val()", U2 = "newData.child('u2').val()", RID = "newData.child('rid').val()";
const notBanned = `!root.child('bans/' + auth.uid).exists()`;
const isMember = (rid) => `root.child('members/' + ${rid} + '/' + auth.uid).exists()`;
const str = (path, max) => `${path}.isString() && ${path}.val().length <= ${max}`;
// Likes required by the site settings («إداره الموقع»: pmlikes, notlikes, proflikes ...). Seen on the reference site (2026-11-05): a guest without
// enough likes is refused a private message («المحادثات الخاصه تتطلب منك الحصول على 100 إعجاب»). No requirement set (missing or 0), a rank holder
// or the owner = allowed (ranks/owner exempt: inferred, the reference server's rule for them is not visible).
// «إداره الموقع» likes requirements apply to EVERYBODY, ranks and the owner included (owner's rule 2026-11-06)
const likesOk = (key) => `(!root.child('config/site/${key}').exists() || !(root.child('config/site/${key}').val() > 0) || (root.child('rep/' + auth.uid).exists() && root.child('rep/' + auth.uid).val() >= root.child('config/site/${key}').val()))`;

const configWriter = `${can("setPower")} || (${isBoot})`;
// one validation rule per allowed site-setting key, generated from lib/shim/site.ts
function siteFields() {
  const out = {};
  for (const [key, k] of Object.entries(SITE_SCHEMA)) {
    const num = (max) => `newData.isNumber() && newData.val() >= 0 && newData.val() <= ${max}`;
    const txt = (max) => `newData.isString() && newData.val().length <= ${max}`;
    const v = k.t === "s" ? txt(k.max) : k.t === "n" ? num(k.max) : k.t === "b" ? "newData.isBoolean()" : `(${txt(k.max)}) || (${num(k.nmax)})`;
    out[key] = { ".validate": v };
  }
  return out;
}

// actionLog: which permission each logged operation needs (type -> permission)
const logT = (types, perm) => `((${types.map((t) => `newData.child('type').val() === '${t}'`).join(" || ")}) && ${canLive(perm)})`;
const LOG_TYPE_OK = [logT(["kick", "roomkick"], "kickRoom"), logT(["ban"], "ban"), logT(["setpower"], "setPower"), logT(["setlikes"], "setLikes"), logT(["nick"], "unick"), logT(["delpic"], "kickRoom"), logT(["delbc"], "deleteMsg"), logT(["bnr"], "bnr"), logT(["editroom"], "roomManage"), logT(["dmsg"], "dmsg"), logT(["unban"], "unban"), logT(["wroom"], "cpWrooms")].join(" || ");
// the other logged operations (lines of «الحالات» on the original panel, measured 2026-11-06): the flag of that operation, or the owner
const LOG_OTHER = ["setpower", "setlikes", "nick", "delbc", "bnr", "editroom", "dmsg", "unban", "wroom", "cpx", "move"];
// room-level lines (measured «مراقب» / «إزاله مراقب» / «انشاء غرفه»; «حذف غرفه» ours): the owner / an op of THAT room (rid), or «إدارة الغرف»
const LOG_ROOM = ["op", "deop", "mkroom", "rdel"];
// only these types: kick / ban / delpic / roomkick keep their stricter hierarchy rules below (LOG_TYPE_OK alone would bypass them)
const LOG_PERM = { setpower: "setPower", setlikes: "setLikes", nick: "unick", delbc: "deleteMsg", bnr: "bnr", editroom: "roomManage", dmsg: "dmsg", unban: "unban", wroom: "cpWrooms", cpx: "viewReports", move: "move" }; // cpx: any panel change (the panel flag; the command itself was checked by its own flag)
// «حذف الحائط»: the original also logs a member deleting his OWN post (29 of 32 rows): allowed when the second member is the writer himself
const roomRight = `(root.child('rooms/' + ${RID} + '/owner').val() === auth.uid || root.child('rooms/' + ${RID} + '/ops/' + auth.uid).exists() || ${canLive("roomManage")} || ${isBoot})`;
const logRoom = `((${LOG_ROOM.map((t) => `${T} === '${t}'`).join(" || ")}) && newData.child('rid').isString() && ${roomRight})`;
const logOther = `${logRoom} || (${LOG_OTHER.map((t) => `(${T} === '${t}' && (${canLive(LOG_PERM[t])} || ${isBoot}${t === "delbc" ? ` || ${U2} === auth.uid` : ""}))`).join(" || ")})`;

const rules = {
  rules: {
    ".read": false,
    ".write": false,

    // ---- configuration (read by all signed-in users, written by whoever may manage power) ----
    // A write permission on a parent is INHERITED by every child and cannot be taken back, so /config has no ".write" of its own:
    // each child states its own. Anything not listed below cannot be written by a client at all.
    config: {
      ".read": authed,
      // who the first administrator is: never written by a client (the operator sets it from the console / admin script, which bypass the rules)
      bootstrap: { ".write": false },
      // site settings: the owner or «إداره الموقع» (cpsite, x3 L4882 — every field, like the original), known keys only, each with its type and size limit
      site: {
        ".read": true, // public like the original's HTML (title, description, colours, «السكربت», «كود head»)
        ".write": `${isBoot} || (auth != null && ${notBanned} && ${canLive("cpSite")})`,
        ...siteFields(),
        $other: { ".validate": false },
      },
      // the other settings keep exactly the permission they had (setPower or the owner)
      perms: { ".write": configWriter },
      // each tab's own flag (x3 fn90 L4866), as the panel commands require
      entryRoom: { ".write": `${isBoot} || ${canLive("cpRooms")}` },
      msgs: { ".write": `${isBoot} || ${canLive("cpMsgs")}` },
      shrt: { ".write": `${isBoot} || ${canLive("cpShrt")}` },
      fltr: { ".write": `${isBoot} || ${canLive("filter")}` },
      wroomsOwr: { ".write": `${isBoot} || ${canLive("cpWrooms")}` },
      // «غرفه الانتظار» list: device / country / IP texts (and «سماح» entries), like the bans
      wroomsList: { ".write": `${isBoot} || ${canLive("cpWrooms")}` },
      // «إداره الموقع» > الايقونات: favicon / prv1 / pic / room = a picture uploaded through this site
      files: { ".write": `${isBoot} || ${canLive("cpSite")}`, $k: { ".validate": "($k === 'favicon' || $k === 'prv1' || $k === 'pic' || $k === 'room') && newData.isString() && newData.val().matches(/^uploads\\/db-[A-Za-z0-9_-]{1,40}\\.(png|gif|webp|jpg|ico)$/)" } },
      // «النطاقات»: config/domains/<site,com> = { domain, name, title, description, keywords, script, customHead, html, bg, background, buttons, bannerEnabled, bannerImage }
      domains: { ".read": true, ".write": `${isBoot} || ${canLive("cpDomains")}`, $k: { ".validate": "newData.child('domain').isString() && newData.child('domain').val().length <= 100", $f: { ".validate": "newData.isString() ? newData.val().length <= 20000 : newData.isBoolean()" } } },
      // «النطاقات» > بنر الموقع: _main = the main site {enabled, image (a picture uploaded through this site)}
      banner: { ".write": `${isBoot} || ${canLive("cpDomains")}`, $d: { ".validate": "newData.hasChildren() || !newData.exists()", enabled: { ".validate": "newData.isBoolean()" }, image: { ".validate": "newData.isString() && newData.val().length <= 80 && newData.val().beginsWith('uploads/db-')" }, $o: { ".validate": false } } },
      // «Bots»: fake members (profiles + online) and the tab's settings: the owner, or «إداره الموقع» with a rank above 8998 (x3 L4885)
      bots: { ".write": `${isBoot} || (${canLive("cpSite")} && ${rrank("auth.uid")}.val() > 8998)` },
      botsCfg: { ".write": `${isBoot} || (${canLive("cpSite")} && ${rrank("auth.uid")}.val() > 8998)` },
      // the icon lists of «إداره الموقع» (super icons, gifts, smileys in their order): file names only
      ico: { ".write": `${isBoot} || ${canLive("cpSite")}`, $tar: { ".validate": "$tar === 'sico' || $tar === 'dro3' || $tar === 'emo'", $i: { ".validate": "newData.isString() && newData.val().length <= 140 && newData.val().matches(/^[A-Za-z0-9_. -]+$/)" } } },
    },

    // ---- power levels: only people with "setPower" may write; everyone signed in may read ----
    powers: {
      ".read": authed,
      $uid: {
        // the owner, or a setPower holder acting on someone STRICTLY below them and giving a rank STRICTLY below their own (or no rank). A deletion
        // is judged by the current rank of the target. The checks read the state BEFORE the request, so a multi-path update cannot change them.
        ".write":
          `${isBoot} || (${can("setPower")} && !${noRank("auth.uid")} && ${validRank("auth.uid")} && $uid !== auth.uid && ${targetBelow("$uid")} && (!newData.exists() || ` +
          `(newData.child('name').isString() && (newData.child('name').val() === '' || (root.child('powerTable/' + newData.child('name').val() + '/rank').isNumber() && ` +
          `root.child('powerTable/' + newData.child('name').val() + '/rank').val() < ${rrank("auth.uid")}.val())))))`,
        ".validate": "newData.hasChildren(['level','name'])",
        // "level" must be the real rank of the named rank (or 0 for no rank), so a misleading value cannot be stored next to a name
        level: { ".validate": "newData.isNumber() && newData.val() >= 0 && newData.val() <= 10000 && ((newData.parent().child('name').val() === '' && newData.val() === 0) || newData.val() === root.child('powerTable/' + newData.parent().child('name').val() + '/rank').val())" },
        name: { ".validate": str("newData", 60) + " && (newData.val() === '' || (!newData.val().contains('/') && root.child('powerTable/' + newData.val()).exists()))" },
        until: { ".validate": "newData.isNumber()" },
        $other: { ".validate": false },
      },
    },

    // ---- public profile ----
    // G9: a parent's .write cannot be taken back by a child, so the parent itself says WHICH fields each writer may change:
    //  - the owner of the profile: the plain fields; never b / gift (they need the upgrade flag), never registered / createdAt after creation, never deletes the profile
    //  - a setPower holder over somebody strictly below: only topic, and pic reset to ''
    //  - the site owner (config/bootstrap): anything valid, on somebody else's profile
    //  - b / gift: their own .write (upgrade flag, expiry honoured), on any profile
    profiles: {
      ".read": authed,
      $uid: {
        ".write": `auth != null && ${notBanned} && ((auth.uid === $uid && newData.exists() && ${same("b")} && ${same("gift")} && (data.exists() ? (${same("registered")} && ${same("createdAt")}) : (newData.child('registered').val() !== true || auth.token.firebase.sign_in_provider !== 'anonymous'))) || ${ownerOver("$uid")} || (${actsOn("unick", "$uid")} && newData.exists() && ${["msg", "ucol", "mcol", "bg", "co", "registered", "gift", "b", "busy", "createdAt", "pic"].map(same).join(" && ")}) || (${actsOn("kickRoom", "$uid")} && newData.exists() && ${["topic", "msg", "ucol", "mcol", "bg", "co", "registered", "gift", "b", "busy", "createdAt"].map(same).join(" && ")} && newData.child('pic').val() === ''))`, // «تغير النكات»: topic; the kick flag: picture reset (x3 L4129, L4223)
        ".validate": "newData.hasChildren(['topic'])",
        topic: { ".validate": str("newData", 120) },
        // the login name («العضو» in the panel), apart from the decorated topic («الزخرفه»): written once, never changed
        name: { ".validate": `${str("newData", 50)} && (!data.exists() || newData.val() === data.val())` },
        msg: { ".validate": str("newData", 200) },
        // what the app really stores: '' (default picture) or a picture uploaded through this site (lib/shim/upload.ts -> uploads/db-<id>.<ext>)
        pic: { ".validate": "newData.isString() && newData.val().length <= 300 && (newData.val() === '' || newData.val().matches(/^uploads\\/db-[A-Za-z0-9_-]+\\.[A-Za-z0-9]{2,4}$/))" },
        ucol: { ".validate": "newData.isString() && newData.val().matches(/^#[0-9a-fA-F]{6}$/)" },
        mcol: { ".validate": "newData.isString() && newData.val().matches(/^#[0-9a-fA-F]{6}$/)" },
        bg: { ".validate": "newData.isString() && (newData.val() === '' || newData.val().matches(/^#[0-9a-fA-F]{6}$/))" },
        co: { ".validate": str("newData", 4) },
        registered: { ".validate": "newData.isBoolean()" },
        gift: { ".write": `auth != null && ${notBanned} && ${canLive("upgrade")}`, ".validate": str("newData", 120) },
        b: { ".write": `auth != null && ${notBanned} && ${canLive("bnr")}`, ".validate": str("newData", 80) }, // «البنر» (x3 L4221)
        busy: { ".validate": "newData.isBoolean()" },
        createdAt: { ".validate": "newData.isNumber() && newData.val() <= now + 60000" },
        $other: { ".validate": false },
      },
    },

    // ---- likes: each user writes only their own like on someone ----
    likes: {
      ".read": authed,
      $target: {
        $from: {
          ".write": `auth != null && auth.uid === $from && $target !== auth.uid`,
          ".validate": "newData.isBoolean()",
        },
      },
    },

    // ---- profile likes ("rep"): +1 per like, at most one like per minute per sender (as on the reference site) ----
    rep: {
      ".read": authed,
      $target: {
        ".write":
          // a like on oneself counts too (seen on the reference site 2026-11-05: +1 and the «حصلت على إعجاب» notice to oneself)
          // «لايكات» (setLikes) holders set any value, on themselves too (then they meet the «إداره الموقع» likes like everybody)
          `auth != null && ${notBanned} && ( ${canLive("setLikes")} || ( newData.isNumber() && newData.val() === (data.exists() ? data.val() : 0) + 1 && ` +
          `newData.parent().parent().child('lastLike').child(auth.uid).val() === now ) )`,
        ".validate": "newData.isNumber() && newData.val() >= 0",
      },
    },
    lastLike: {
      $uid: {
        ".read": `auth != null && auth.uid === $uid`,
        ".write": `auth != null && auth.uid === $uid && ${notBanned} && (!data.exists() || now - data.val() >= 60000)`,
        ".validate": "newData.isNumber() && newData.val() <= now",
      },
    },

    // ---- rank table: the original sends it to every member ("powers": rank icons, order, flags), so members read it; only setpower writes ----
    // writes: the owner, or «إدارة الصلاحيات» (editpower, x3 L4873) on rows STRICTLY below his own rank, never raising one to his level
    powerTable: {
      ".read": authed,
      $name: {
        ".write": `auth != null && ${notBanned} && (${isBoot} || (${canLive("editPower")} && ${validRank("auth.uid")} && ` +
          `(!data.exists() || (data.child('rank').isNumber() && data.child('rank').val() < ${rrank("auth.uid")}.val())) && ` +
          `(!newData.exists() || (newData.child('rank').isNumber() && newData.child('rank').val() >= 0 && newData.child('rank').val() < ${rrank("auth.uid")}.val()))))`,
      },
    },

    // ---- «يكتب الآن» in a private chat: typing/<to>/<from> = 1 | 0, written by the typist, read only by the one it is shown to ----
    typing: {
      $to: {
        ".read": "auth != null && auth.uid === $to",
        $from: { ".write": `auth != null && auth.uid === $from && ${notBanned}`, ".validate": "newData.isNumber() && (newData.val() === 0 || newData.val() === 1)" },
      },
    },

    // ---- «غرفه الانتظار»: waitRoom/<uid> = true, written by the server at login (/api/conn), read by the member himself ----
    waitRoom: { $uid: { ".read": "auth != null && auth.uid === $uid", ".write": false } },

    // ---- presence ----
    presence: {
      ".read": authed,
      $uid: {
        ".write": `auth != null && auth.uid === $uid`,
        ".validate": "newData.hasChildren(['online'])",
        online: { ".validate": "newData.isBoolean()" },
        lastSeen: { ".validate": "newData.isNumber()" },
        act: { ".validate": "newData.isNumber()" }, // time of the member's last command (yellow dot after 5 minutes idle)
        drop: { ".validate": "newData.isBoolean()" },
        in: { ".validate": "newData.isNumber() && newData.val() <= now + 60000" }, // login time: the login screen lists the newest first // connection dropped (not the logout button): faded s3 for «تثبيت النكات» minutes
        room: { ".validate": "newData.isString() && newData.val().length <= 64" }, // the room he dropped from (he stays listed in it)
        stealth: { ".validate": `newData.isBoolean() && (newData.val() === false || ${canLive("stealth")} || ${isBoot})` },
        $other: { ".validate": false },
      },
    },

    // ---- rooms ----
    rooms: {
      ".read": authed,
      $rid: {
        ".write":
          `auth != null && ${notBanned} && ( (!data.exists() && newData.child('owner').val() === auth.uid) || ` +
          `(data.exists() && (data.child('owner').val() === auth.uid || ${can("roomManage")})) || ` +
          // auto-created public rooms ("الغرفه العامه ( n )") are removed by anyone once nobody is inside
          `(data.exists() && !newData.exists() && (data.child('pub').val() === true || data.child('del').val() === true) && !root.child('members/' + $rid).exists()) )`,
        ".validate": "newData.hasChildren(['topic','owner','max'])",
        topic: { ".validate": str("newData", 80) },
        about: { ".validate": str("newData", 200) },
        welcome: { ".validate": str("newData", 300) },
        pic: { ".validate": str("newData", 300) },
        owner: { ".validate": "newData.isString()" },
        max: { ".validate": "newData.isNumber() && newData.val() >= 2 && newData.val() <= 40" },
        likesReq: { ".validate": "newData.isNumber() && newData.val() >= 0" },
        voiceLikesReq: { ".validate": "newData.isNumber() && newData.val() >= 0" },
        voice: { ".validate": "newData.isBoolean()" },
        pinned: { ".validate": "newData.isBoolean()" },
        pub: { ".validate": "newData.isBoolean()" },
        wroom: { ".validate": "newData.isBoolean() && newData.val() === true && $rid === 'wroom'" }, // «غرفه الانتظار» (one room, id "wroom")
        ops: { $u: { ".validate": "newData.isBoolean()" } },
        c: { ".validate": "newData.isString() && newData.val().matches(/^#[0-9a-fA-F]{6}$/)" },
        del: { ".validate": "newData.isBoolean()" },
        hasPass: { ".validate": "newData.isBoolean()" },
        createdAt: { ".validate": "newData.isNumber()" },
        $other: { ".validate": false },
      },
    },

    // room password hash: readable/writable only by the owner or a room manager. Rules themselves read it for joins.
    roomSecrets: {
      $rid: {
        ".read": `auth != null && (root.child('rooms/' + $rid + '/owner').val() === auth.uid || ${can("roomManage")})`,
        ".write": `auth != null && (root.child('rooms/' + $rid + '/owner').val() === auth.uid || ${can("roomManage")})`,
        ".validate": "newData.isString() && newData.val().length <= 128",
      },
    },

    // ---- room membership: joining requires not being banned and (if the room has a password) the matching hash ----
    members: {
      ".read": authed, // the whole map is read to show per-room counts and who is in which room
      $rid: {
        $uid: {
          // joining/leaving is one's own business (with the password where there is one). Putting somebody ELSE in a room is never possible; taking
          // somebody out is: the room's owner, its moderators (never the owner), a kickRoom holder acting on someone strictly below them, or the site owner.
          ".write":
            `auth != null && ${notBanned} && ( ( auth.uid === $uid && root.child('rooms/' + $rid).exists() && ` +
            `( !root.child('roomSecrets/' + $rid).exists() || newData.child('ph').val() === root.child('roomSecrets/' + $rid).val() || !newData.exists() ) ) || ` +
            `( auth.uid === $uid && (${can("kickRoom")} || ${isBoot}) ) || ` +
            `( root.child('rooms/' + $rid + '/owner').val() === auth.uid && ($uid === auth.uid || !newData.exists()) ) || ` +
            `( root.child('rooms/' + $rid + '/ops/' + auth.uid).exists() && ($uid === auth.uid || (!newData.exists() && $uid !== root.child('rooms/' + $rid + '/owner').val())) ) || ` +
            `( !newData.exists() && ( ${ownerOver("$uid")} || ${actsOn("kickRoom", "$uid")} ) ) )`,
          ".validate": "newData.hasChildren(['joinedAt'])",
          joinedAt: { ".validate": "newData.isNumber()" },
          ph: { ".validate": str("newData", 128) },
          $other: { ".validate": false },
        },
      },
    },

    // ---- room messages: members read & write; authors or moderators delete ----
    messages: {
      $rid: {
        ".indexOn": "t", // the room is read from the time of joining (a «left» notice is keyed at join, timed at leave)
        ".read": `auth != null && ${isMember("$rid")}`,
        $mid: {
          ".write":
            `auth != null && ${notBanned} && ( ( !data.exists() && ${isMember("$rid")} && newData.child('uid').val() === auth.uid ) || ` +
            `( data.exists() && !newData.exists() && ( data.child('uid').val() === auth.uid || ${can("dmsg")} ) ) )`, // «مسح الرسائل» (x3 L3858)
          ".validate": "newData.hasChildren(['uid','msg','t'])",
          uid: { ".validate": "newData.isString()" },
          topic: { ".validate": str("newData", 120) },
          pic: { ".validate": str("newData", 300) },
          msg: { ".validate": str("newData", 2000) },
          cls: { ".validate": "newData.isString() && (newData.val() === 'join' || newData.val() === 'leave')" },
          ucol: { ".validate": "newData.isString() && newData.val().length <= 7" },
          mcol: { ".validate": "newData.isString() && newData.val().length <= 7" },
          t: { ".validate": "newData.isNumber() && newData.val() <= now + 60000" },
          $other: { ".validate": false },
        },
      },
    },

    // ---- private messages: key is "<uidA>_<uidB>" (sorted); only the two participants may use it ----
    pm: {
      $pair: {
        ".read": `auth != null && $pair.contains(auth.uid)`,
        $mid: {
          ".write": `auth != null && ${notBanned} && $pair.contains(auth.uid) && !data.exists() && newData.child('uid').val() === auth.uid && ${likesOk("pmlikes")}`,
          ".validate": "newData.hasChildren(['uid','msg','t'])",
          uid: { ".validate": "newData.isString()" },
          msg: { ".validate": str("newData", 2000) },
          t: { ".validate": "newData.isNumber() && newData.val() <= now + 60000" },
          $other: { ".validate": false },
        },
      },
    },

    // ---- wall (global feed) ----
    wall: {
      ".read": authed,
      $id: {
        ".write":
          `auth != null && ${notBanned} && ( (!data.exists() && newData.child('uid').val() === auth.uid && ${likesOk("wall_likes")}) || ` +
          `(data.exists() && !newData.exists() && (data.child('uid').val() === auth.uid || ${can("deleteMsg")})) )`,
        ".validate": "newData.hasChildren(['uid','t'])",
        uid: { ".validate": "newData.isString()" },
        topic: { ".validate": str("newData", 120) },
        pic: { ".validate": str("newData", 300) },
        msg: { ".validate": str("newData", 2000) },
        link: { ".validate": str("newData", 300) },
        t: { ".validate": "newData.isNumber() && newData.val() <= now + 60000" },
        likes: { $u: { ".write": `auth != null && ${notBanned} && auth.uid === $u`, ".validate": "newData.isBoolean()" } },
        replies: {
          $rid: {
            ".write":
              `auth != null && ${notBanned} && ( (!data.exists() && newData.child('uid').val() === auth.uid) || ` +
              `(data.exists() && !newData.exists() && (data.child('uid').val() === auth.uid || ${can("deleteMsg")})) )`,
            ".validate": "newData.hasChildren(['uid','msg','t'])",
            uid: { ".validate": "newData.isString()" },
            msg: { ".validate": str("newData", 2000) },
            t: { ".validate": "newData.isNumber() && newData.val() <= now + 60000" },
            topic: { ".validate": str("newData", 120) },
            pic: { ".validate": str("newData", 300) },
            $other: { ".validate": false },
          },
        },
        $other: { ".validate": false },
      },
    },

    // ---- private-chat index: who I talk to (either participant may create/update the entry) ----
    pmIndex: {
      $uid: {
        ".read": `auth != null && auth.uid === $uid`,
        $peer: {
          ".write": `auth != null && ${notBanned} && (auth.uid === $uid || auth.uid === $peer)`,
          ".validate": "newData.hasChildren(['t'])",
          t: { ".validate": "newData.isNumber()" },
          last: { ".validate": str("newData", 200) },
          unread: { ".validate": "newData.isNumber() && newData.val() >= 0" },
          $other: { ".validate": false },
        },
      },
    },

    // ---- alerts ("تنبيه"): anyone may send to a user; only the recipient reads/clears ----
    alerts: {
      $uid: {
        ".read": `auth != null && auth.uid === $uid`,
        $id: {
          // the sender is always the writer. Free text (no "kind") needs the alert flag; the three system kinds carry no text and each needs what
          // produces it: a like = a like sent in the last minute, a gift = the upgrade flag, a moderator notice = ownership of that room.
          ".write":
            `auth != null && ${notBanned} && ( (!data.exists() && newData.child('from').val() === auth.uid && ( ` +
            `( !newData.child('kind').exists() && ${likesOk("notlikes")} ) || ` +
            `( newData.child('kind').val() === 'like' && newData.child('msg').val() === '' && root.child('lastLike/' + auth.uid).val() > now - 60000 ) || ` +
            `( newData.child('kind').val() === 'gift' && newData.child('msg').val() === '' && (${canLive("upgrade")} || ${isBoot}) ) || ` +
            // «لا يقبل المحادثات الخاصه»: only to somebody who has a pm thread with the writer; «لا يقبل التنبيهات»: fixed text, no content of the writer's
            `( newData.child('kind').val() === 'nopm' && newData.child('msg').val() === '' && root.child('pmIndex/' + auth.uid + '/' + $uid).exists() ) || ` +
            `( newData.child('kind').val() === 'nonot' && newData.child('msg').val() === '' ) || ` +
            `( newData.child('kind').val() === 'op' && (root.child('rooms/' + newData.child('msg').val() + '/owner').val() === auth.uid || ${canLive("roomManage")}) ) ) ) || auth.uid === $uid )`,
          ".validate": "newData.hasChildren(['from','msg','t'])",
          from: { ".validate": "newData.isString()" },
          msg: { ".validate": str("newData", 500) },
          kind: { ".validate": "newData.isString() && (newData.val() === 'like' || newData.val() === 'gift' || newData.val() === 'op' || newData.val() === 'nopm' || newData.val() === 'nonot')" },
          gift: { ".validate": str("newData", 120) },
          t: { ".validate": "newData.isNumber() && newData.val() <= now + 60000" },
          $other: { ".validate": false },
        },
      },
    },

    // ---- kicks: a moderator writes a signal; the kicked client reads it, signs out and clears it ----
    // card > «نقل»: a move order read by the moved member only (his session joins the room and deletes the order)
    moves: {
      $uid: {
        ".read": `auth != null && auth.uid === $uid`,
        ".write": `auth != null && ((auth.uid === $uid && !newData.exists()) || ${ownerOver("$uid")} || ${actsOn("move", "$uid")})`,
        ".validate": "!newData.exists() || newData.hasChildren(['by','rid','t'])",
        by: { ".validate": "newData.val() === auth.uid" },
        rid: { ".validate": "newData.isString() && newData.val().length <= 64" },
        pwd: { ".validate": "newData.isString() && newData.val().length <= 100" },
        t: { ".validate": "newData.isNumber()" },
        $other: { ".validate": false },
      },
    },
    kicks: {
      $uid: {
        ".read": `auth != null && auth.uid === $uid`,
        ".write": `auth != null && (auth.uid === $uid || ${ownerOver("$uid")} || ${actsOn("kickRoom", "$uid")})`,
        ".validate": "!newData.exists() || newData.hasChildren(['by','t'])",
        by: { ".validate": "newData.isString()" },
        t: { ".validate": "newData.isNumber()" },
        $other: { ".validate": false },
      },
    },

    // ---- uploaded pictures (stored as base64 JPEG/PNG/WebP, resized by the client). Public read: they are served through /uploads/<id>. ----
    images: {
      $id: {
        ".read": true,
        ".write":
          `auth != null && ${notBanned} && ( (!data.exists() && newData.child('uid').val() === auth.uid) || ` +
          `(data.exists() && !newData.exists() && (data.child('uid').val() === auth.uid || ${can("deleteMsg")})) )`,
        ".validate": "newData.hasChildren(['uid','d','ct','t'])",
        uid: { ".validate": "newData.isString()" },
        ct: { ".validate": "newData.isString() && newData.val().matches(/^image\\/(jpeg|png|webp|gif)$/)" }, // gif: icons / gifts uploaded from the panel
        d: { ".validate": "newData.isString() && newData.val().length <= 900000" },
        t: { ".validate": "newData.isNumber() && newData.val() <= now + 60000" },
        $other: { ".validate": false },
      },
    },

    // ---- logs shown in the control panel (written by the acting user, read by moderators) ----
    loginLog: {
      ".read": can("viewReports"),
      ".indexOn": ["uid"], // «كشف النكات» reads one member's logins (orderByChild uid)
      $id: {
        ".write": `auth != null && !data.exists() && newData.child('uid').val() === auth.uid`,
        ".validate": "newData.hasChildren(['uid','created'])",
        uid: { ".validate": "newData.isString()" },
        // G3: the name written for a login is the member's real name at that moment (the profile's topic), so a log row cannot carry an invented name.
        // Old rows are not touched (rules apply to new writes only).
        topic: { ".validate": `${str("newData", 120)} && newData.val() === root.child('profiles/' + newData.parent().child('uid').val() + '/topic').val()` },
        co: { ".validate": str("newData", 4) },
        isreg: { ".validate": "newData.isBoolean()" },
        created: { ".validate": "newData.isNumber()" },
        $other: { ".validate": false },
      },
    },
    // where a member connected from (ip seen by the server, device string): written only by the server (admin bypass), read only by the ranks that hold the cplogins flag
    memberConn: {
      ".read": canLive("viewLogins"),
      ".write": false,
    },
    // the same for ONE login event: loginConn/<loginLog key> = { uid, ip, fp, at } (tab «السجل»); same read gate, no client write
    loginConn: {
      ".read": canLive("viewLogins"),
      ".write": false,
    },
    // G3 «كشف النكات»: nameLog/<uid>/<id> = { old, new, by, at, src } — one row per real name change, readable by ranks holding `history`.
    // A row is accepted ONLY in the same write that really changes profiles/<uid>/topic from `old` to `new` (multi-path update): `old` must be the
    // stored name before the write and `new` the stored name after it, so no row can be invented, back-dated (at === server time) or written for a
    // change that did not happen. `by` is the writer; the writer must be allowed to change that profile's name (the member himself, the owner, or
    // setPower over a lower rank — the same rights as the profiles rule). `src`: self = the member in settings, login = a guest entering with a new
    // name, mod = somebody else changed it. Nobody edits or deletes a row from a client.
    nameLog: {
      ".read": canLive("viewNames"),
      $uid: {
        $id: {
          ".write": `auth != null && ${notBanned} && !data.exists() && newData.exists() && newData.child('by').val() === auth.uid && ` +
            `(auth.uid === $uid || ${ownerOver("$uid")} || ${actsOn("unick", "$uid")}) && ` +
            `newData.child('old').val() === root.child('profiles/' + $uid + '/topic').val() && ` +
            `newData.child('new').val() === newData.parent().parent().parent().child('profiles').child($uid).child('topic').val() && ` +
            `newData.child('old').val() !== newData.child('new').val()`,
          ".validate": "newData.hasChildren(['old','new','by','at','src'])",
          old: { ".validate": `${str("newData", 120)} && newData.val().length > 0` },
          new: { ".validate": `${str("newData", 120)} && newData.val().length > 0` },
          by: { ".validate": str("newData", 60) },
          at: { ".validate": "newData.isNumber() && newData.val() === now" },
          src: { ".validate": "newData.isString() && ((newData.val() === 'mod' && newData.parent().child('by').val() !== $uid) || ((newData.val() === 'self' || newData.val() === 'login') && newData.parent().child('by').val() === $uid))" },
          $other: { ".validate": false },
        },
      },
    },
    // S4: append-only moderation log. An entry is accepted only for an action its writer may really do (the same rights as the rules of kicks / bans /
    // profiles pic / members), by the writer himself, with a clock within 5 minutes of Firebase's own. Nobody edits or deletes an entry from a client.
    actionLog: {
      ".read": can("viewReports"),
      $id: {
        ".write": `auth != null && ${notBanned} && !data.exists() && newData.child('u1').val() === auth.uid && (` +
          `( ${T} === 'kick' && (${U2} === auth.uid || ${ownerOver(U2)} || ${actsOn("kickRoom", U2)}) ) || ` +
          `( ${T} === 'ban' && (${ownerOver(U2)} || ${actsOn("ban", U2)}) ) || ` +
          `( ${T} === 'delpic' && (${U2} === auth.uid || ${ownerOver(U2)} || ${actsOn("kickRoom", U2)}) ) || ` +
          // roomkick: the owner or an op of THAT room, removing somebody who is a member of it (not the owner, not oneself; a rank is not a room right)
          `${logOther} || ` +
          `( ${T} === 'roomkick' && newData.child('rid').isString() && root.child('rooms/' + ${RID}).exists() && root.child('members/' + ${RID} + '/' + ${U2}).exists() && ${U2} !== auth.uid && ` +
          `( root.child('rooms/' + ${RID} + '/owner').val() === auth.uid || ( root.child('rooms/' + ${RID} + '/ops/' + auth.uid).exists() && ${U2} !== root.child('rooms/' + ${RID} + '/owner').val() ) ) ) )`,
        ".validate": "newData.hasChildren(['type','u1','u2','created'])",
        type: { ".validate": `newData.isString() && (${["kick", "ban", "delpic", "roomkick", ...LOG_OTHER, ...LOG_ROOM, "delu"].map((t) => `newData.val() === '${t}'`).join(" || ")})` },
        u1: { ".validate": str("newData", 60) },
        u2: { ".validate": str("newData", 320) }, // a member id, or the text of a ban / waiting-room entry («فك الحظر», «غرفه الإنتظار»)
        rid: { ".validate": str("newData", 60) },
        room: { ".validate": str("newData", 320) },
        d: { ".validate": str("newData", 120) }, // detail shown next to the second member: «لايكات» "<old> -> <new>", «تعديل صلاحيه» the new rank
        created: { ".validate": "newData.isNumber() && newData.val() >= now - 300000 && newData.val() <= now + 300000" },
        $other: { ".validate": false },
      },
    },

    // ---- bans & reports ----
    bans: {
      ".read": `auth != null && ${can("ban")}`,
      $uid: {
        ".read": `auth != null && (auth.uid === $uid || ${can("ban")})`,
        // «حظر»: the ban flag over somebody below; «سماح» (an allow entry) and removing a ban: the unban flag, as the panel commands require
        ".write": `${ownerOver("$uid")} || ${actsOn("ban", "$uid")} || (auth != null && ${notBanned} && ${canLive("unban")} && (!newData.exists() || newData.child('allow').val() === true))`,
        ".validate": "newData.hasChildren(['by','t'])",
        by: { ".validate": "newData.val() === auth.uid" },
        reason: { ".validate": str("newData", 300) },
        t: { ".validate": "newData.isNumber()" },
        until: { ".validate": "newData.isNumber()" },
        // the banned text (device / part of one / IP / country) and «سماح» entries, like the original «الحظر» tab (lib/shim/bans.ts)
        key: { ".validate": str("newData", 300) },
        allow: { ".validate": "newData.isBoolean()" },
        $other: { ".validate": false },
      },
    },
    // «فلتر» > the last 100 messages that contained a watched word (wmsgs): written ONLY by the server (/api/fltr, admin bypass);
    // read and deleted one by one (fltrdelx) by holders of the "filter" permission, like the original panel
    fltrLog: {
      ".read": can("filter"),
      $id: { ".write": `!newData.exists() && ${can("filter")}` },
    },
    reports: {
      ".read": can("viewReports"),
      $id: {
        ".write": `auth != null && ((!data.exists() && newData.child('by').val() === auth.uid) || ${can("viewReports")})`,
        ".validate": "newData.hasChildren(['by','target','t'])",
        by: { ".validate": "newData.isString()" },
        target: { ".validate": "newData.isString()" },
        reason: { ".validate": str("newData", 500) },
        t: { ".validate": "newData.isNumber()" },
        status: { ".validate": "newData.isString()" },
        $other: { ".validate": false },
      },
    },

    // ---- announcements / ads ----
    ads: {
      ".read": authed,
      $id: {
        ".write": `(newData.child('special').val() === true && ${can("ppmsg")}) || (newData.child('special').val() !== true && ${can("ad")})`, // super ads: «اعلانات السوابر»
        ".validate": "newData.hasChildren(['msg','by','t'])",
        msg: { ".validate": str("newData", 500) },
        by: { ".validate": "newData.val() === auth.uid" },
        special: { ".validate": "newData.isBoolean()" },
        t: { ".validate": "newData.isNumber()" },
        $other: { ".validate": false },
      },
    },
  },
};

writeFileSync(new URL("../database.rules.json", import.meta.url), JSON.stringify(rules, null, 2) + "\n");
console.log("wrote database.rules.json");
