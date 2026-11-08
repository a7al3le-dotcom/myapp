// The reference client talks to its server through one Socket.IO event, "msg", with { cmd, data }.
// Command names are obfuscated by XOR-ing characters with 2 (same function the client uses; it is its own inverse).
export function scramble(name: string): string {
  const src = name || "";
  const a = src.split("");
  for (let i = 0; i < a.length; i++) {
    a[i] = String.fromCharCode(src.charCodeAt(i) ^ 2);
    i += i < 0x14 ? 0x1 : i < 0xc8 ? 0x4 : 0x10;
  }
  return a.join("");
}
export const unscramble = scramble;

// Same defaults the reference server sends on connect (observed).
export const SETTINGS = { calls: false, mlikes: false, mreply: false, bcreply: true, bclikes: true, roomMsgLikes: 0, guestNameMax: 50, registerNameMax: 50 };

// Ranks read from the reference site's admin menu.
export const RANKS: [string, number][] = [
  ["admin", 10000], ["خاص سو", 800], ["ادمن", 400], ["خاص نادين", 399], ["سوبر ملكي", 350], ["خاص بيبو", 321], ["سوبر مشرف", 320],
  ["سوبر مشرف 2", 319], ["خاص جوري", 319], ["تاج سوبر", 300], ["خاص مكاتيب", 299], ["تاج ذهبي كبير", 295], ["خاص منصور", 295],
  ["تاج فضي كبير", 290], ["تاج مخفي كبير", 289], ["تاج مخفي صغير", 288], ["تاج اسود للشباب", 280], ["تاج وردي للبنات", 250],
  ["خاص روم الكنز", 200], ["نجمه ذهبي", 185], ["نجمه اسود", 180], ["نجمه فضي", 175], ["نجمه مخفي", 170], ["خاص", 170],
  ["الايطالي", 165], ["نخله ذهبي", 160], ["نخله فضي", 158], ["ريشه ذهبي", 155], ["ريشه فضي", 153], ["ريشه مخفي", 150],
];
