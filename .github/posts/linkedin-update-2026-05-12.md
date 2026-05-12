# Commentaire LinkedIn — mise à jour 24h après la publication initiale

**Tone** : update produit court, factuel, sans hype.
**À publier** comme commentaire sur la publication originale de hier.

---

Update 24h plus tard : le projet a bien bougé.

**Deux gros chantiers livrés depuis hier :**

🔐 **Gestion SSL complète** — 3 nouveaux tools (`infomaniak_get_certificate`, `infomaniak_request_certificate`, `infomaniak_delete_certificate`). Émission Let's Encrypt en une commande, support Sectigo payant via `certificate_id`, et BYO PEM custom (cert + key fingerprintés dans le confirmation_token pour la two-phase commit, jamais persistés). En clair : Claude peut désormais demander un cert, suivre le statut ACME (`updating` → `installed`), et lire toute la métadonnée du cert (issuer, fingerprint SHA-256, dates d'émission/expiration, flags `is_valid`/`is_expired`/`is_selfsigned`) sans toucher au serveur.

🗄️ **Base de données — inventaire complet** — 2 nouveaux tools read-only (`infomaniak_list_database_users`, `infomaniak_get_database_user`). Permet de cartographier d'un coup tous les utilisateurs MariaDB d'un hébergement, leurs permissions par DB, le flag `protected` pour les comptes WordPress-managed, et le lien direct phpMyAdmin. Couplé avec une procédure de rotation des mots de passe via SQL `SET PASSWORD` documentée dans le README (testée live sur 58 sites WP en une passe, zéro downtime — l'approche évite un side-effect de l'API publique d'Infomaniak qui sera mentionné dans REVERSE-ENGINEERING.md).

**Au total : 59 tools sur 11 domaines.**

Trois autres découvertes intéressantes :
- Le manager web utilise un namespace API distinct (`/v3/api/proxypass_2/1/...`) à côté du `/proxy/1/...` qu'on utilisait. Les deux routent vers le même backend, byte-identical responses. Documenté.
- Support de profiles Chrome non-Default via deux nouvelles env vars (`CHROME_PROFILE`, `CHROME_COOKIES_PATH`) — un setup avec `Profile 3` ou des cookies copiés ailleurs marche maintenant out-of-the-box.
- Le `connection_type` enum pour les FTP/SSH users est en réalité `ftp` ou `ssh` uniquement (l'API rejetait silencieusement les autres valeurs documentées initialement — corrigé).

Toujours public sous MIT, toujours 0 vulnérabilité npm, pipeline CI green.

GitHub : https://github.com/Mogacode-ma/infomaniak-mcp-agent
Release notes complètes : https://github.com/Mogacode-ma/infomaniak-mcp-agent/releases

---

**Notes de publication** :
- Pas d'image attachée nécessaire (c'est un commentaire texte)
- Pas de hashtags (sont déjà dans le post initial)
- Garder le ton "update" pas "lancement"
- Si quelqu'un demande des détails techniques : pointer vers les release notes (déjà liées)
