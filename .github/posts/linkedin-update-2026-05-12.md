# Commentaire LinkedIn — mise à jour 24h après la publication initiale

**Limite LinkedIn : 1250 caractères pour un commentaire.**
**Version finale ci-dessous (~1100 chars, sous la limite).**

---

Update 24h plus tard — deux gros chantiers livrés :

🔐 **Gestion SSL complète** — 3 nouveaux tools. Émission Let's Encrypt en une commande, support Sectigo payant, ou BYO PEM custom (cert + key fingerprintés dans le confirmation_token, jamais persistés). Claude peut suivre le statut ACME en live et lire toute la métadonnée du cert : issuer, fingerprint SHA-256, dates, flags `is_valid`/`is_expired`/`is_selfsigned`.

🗄️ **DB users — inventaire** — 2 tools read-only pour cartographier tous les utilisateurs MariaDB d'un hébergement, leurs permissions par DB, et leur lien phpMyAdmin. Couplé avec une procédure de rotation des passwords via SQL `SET PASSWORD` documentée — testée live sur 58 sites WP en une passe, zéro downtime.

Total : **59 tools sur 11 domaines.**

Bonus : env vars `CHROME_PROFILE` / `CHROME_COOKIES_PATH` pour les setups Chrome non-Default, namespace manager `/v3/api/proxypass_2/1/...` documenté, et le bug du `connection_type` enum FTP/SSH (en fait `ftp`|`ssh` uniquement) corrigé.

Toujours MIT, 0 vuln npm, CI green.

Release notes : https://github.com/Mogacode-ma/infomaniak-mcp-agent/releases

---

**Notes** :
- Pas d'image
- Pas de hashtags (déjà dans le post initial)
- Si besoin de raccourcir encore : retirer le paragraphe "Bonus" → ~830 chars (gagne ~290)
- Version mini possible : ne garder que les 2 chantiers + total + URL → ~600 chars
