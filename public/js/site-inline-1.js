// Based on the first inline <script> of https://www.al3nood.net/ (runs right before x3.js there).
// Owner's decisions (2026-11-04): year 2026 (the reference page says 2021), and the copyright line shows the chat name set in the control panel (site settings -> name), not the original
// host's link, because the same code serves several sites. The shim fills .site-name once the settings are read (lib/shim/server.ts).
$(".cop").append('Copyright © 2026 <span class="site-name mini"></span>All Rights Reserved');
