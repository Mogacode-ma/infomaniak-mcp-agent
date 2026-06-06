#!/usr/bin/env node
/**
 * Post-install greeting — affiché une seule fois après `npm install`.
 *
 * Discret par design :
 *   - Skip si CI=true (CI/CD ne doit pas voir ça)
 *   - Skip si --silent / loglevel error
 *   - Skip si SUPPRESS_INSTALL_MESSAGE=1
 *   - Skip si déjà affiché (marker dans node_modules/.cache)
 *
 * Inspiration : les ezines des années 90, avant que tout devienne
 * du tracking analytics. Juste un mot honnête au lecteur.
 */
"use strict";

const fs = require("node:fs");
const path = require("node:path");

// Détection d'environnements où on ne dit rien.
const SUPPRESS_VARS = [
  process.env.CI,
  process.env.SUPPRESS_INSTALL_MESSAGE,
  process.env.DISABLE_OPENCOLLECTIVE, // certains CI utilisent ça
  process.env.ADBLOCK,
  process.env.npm_config_loglevel === "silent" ? "1" : "",
  process.env.npm_config_loglevel === "error" ? "1" : "",
  process.env.npm_config_loglevel === "warn" ? "1" : "",
];
if (SUPPRESS_VARS.some(Boolean)) process.exit(0);

// Marker : afficher une seule fois. Le marker vit dans node_modules/.cache
// donc il disparaît avec node_modules — c'est OK, on re-affiche au prochain install.
try {
  const root = process.env.INIT_CWD || process.cwd();
  const markerDir = path.join(root, "node_modules", ".cache", "infomaniak-mcp-agent");
  const markerFile = path.join(markerDir, "greeted");
  if (fs.existsSync(markerFile)) process.exit(0);
  fs.mkdirSync(markerDir, { recursive: true });
  fs.writeFileSync(markerFile, new Date().toISOString());
} catch {
  // Si on ne peut pas écrire le marker, on affiche quand même une fois.
}

// Couleurs ANSI minimales (compat large, désactivé si pas de TTY).
const tty = process.stderr.isTTY || process.stdout.isTTY;
const c = tty
  ? { dim: "\x1b[2m", reset: "\x1b[0m", cyan: "\x1b[36m", yellow: "\x1b[33m" }
  : { dim: "", reset: "", cyan: "", yellow: "" };

const lines = [
  "",
  `  ${c.dim}─────────────────────────────────────────────────────────${c.reset}`,
  `  ${c.cyan}coucou${c.reset} — merci d'avoir installé ${c.cyan}infomaniak-mcp-agent${c.reset} ${c.dim}🙏${c.reset}`,
  "",
  `  J'espère que ça t'aidera à piloter ton compte Infomaniak`,
  `  avec Claude (ou ton client MCP préféré).`,
  "",
  `  Pour dire bonjour, signaler un bug, ou raconter ce que tu`,
  `  en fais :`,
  `      ${c.cyan}https://github.com/Mogacode-ma/infomaniak-mcp-agent${c.reset}`,
  "",
  `  Un ${c.yellow}⭐${c.reset} aide d'autres devs Infomaniak à trouver le projet.`,
  `  Mais juste passer dire salut en Discussion suffit largement.`,
  "",
  `  ${c.dim}— Patrick (Mogacode, Maroc)${c.reset}`,
  `  ${c.dim}─────────────────────────────────────────────────────────${c.reset}`,
  "",
];

// stderr pour pas polluer stdout (au cas où on est dans un pipe).
process.stderr.write(lines.join("\n"));
