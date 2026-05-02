# Post LinkedIn — FR

**À publier sur le compte de Patrick Rary, en taggant @Infomaniak.**

**Image jointe** : `.github/og-image.png` (1200×630)

---

J'ai mis 30+ sites en production sur Infomaniak ces dernières années.
Et à chaque fois, le même réflexe : ouvrir 3 onglets, cliquer 12 fois, cocher 4 cases — pour créer un site, ajouter un MX, ouvrir un FTP.

Alors j'ai fait quelque chose.

🇨🇭 **infomaniak-mcp-agent** : un serveur MCP open-source qui permet à Claude de piloter mon compte Infomaniak entier en langage naturel.

→ **54 outils** : web hosting, mail, kDrive, domains, DNS, DNSSEC, FTP/SSH, AI Tools…
→ **Two-phase commit** sur chaque opération destructive (plan + token de confirmation, jamais de surprise)
→ **Reverse-engineering documenté** des endpoints non publics du manager (parce que oui, créer un site via l'API publique d'Infomaniak ne marche pas — il faut passer par /proxy/...)
→ **TypeScript strict, 0 vulnérabilité npm, MIT licence**

Concrètement, ce que je dis à Claude :

> *"Audit le compte de mon client X, dis-moi quels domaines expirent dans les 60 jours et lesquels ont un SSL en panne."*

Et il le fait. Sans clic, sans script à écrire, sans console à ouvrir.

Pourquoi Infomaniak ? Parce que c'est l'un des **derniers vrais cloud souverains européens** : datacenters en Suisse, énergies renouvelables, pas de maison-mère US ou chinoise. C'est aussi le cloud que j'utilise depuis 10 ans pour 40+ projets clients, et dont je connais l'API du bout des doigts.

Le projet est public, sous MIT, et entièrement vibe-codé en quelques jours avec Claude. C'est un projet **non-officiel et non-affilié** à Infomaniak — mais le code est propre, testé, et documenté avec une transparence totale (chaque endpoint reverse-engineered est listé dans REVERSE-ENGINEERING.md).

GitHub : https://github.com/Mogacode-ma/infomaniak-mcp-agent

Si vous êtes hébergeur, freelance dev ou agence, et que vous gérez plusieurs comptes Infomaniak — testez. Si vous êtes chez Infomaniak et que vous voyez ce post, on peut en discuter ☕

#Infomaniak #MCP #Claude #Anthropic #SwissCloud #OpenSource #Automation #DevTools #Switzerland

---

**Tags suggérés** : @Infomaniak (page LinkedIn officielle), @Anthropic
**Hashtags** : #Infomaniak #MCP #ModelContextProtocol #Claude #Anthropic #SwissCloud #OpenSource #Automation #DevTools #Switzerland #AICloud

**Notes de publication** :
- Heure idéale : mardi/mercredi/jeudi entre 8h-10h ou 17h-19h CET (audience tech française/suisse en ligne)
- L'OG image (`og-image.png`) doit être uploadée comme image principale du post
- Réponse type aux DM : "Merci pour ton intérêt — n'hésite pas à ouvrir une issue GitHub si tu testes, je suis très réactif sur les retours."
