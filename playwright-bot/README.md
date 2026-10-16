# 🤖 Play Console Bot (Option 3)

Automatisation headless de la création de drafts Play Console — port de `fillAndSubmitForm()` de l'extension Chrome vers Playwright.

## Installation (une fois)

```sh
cd playwright-bot
npm install
npm run setup        # télécharge Chromium
```

## Connexion (une fois, manuelle)

```sh
npm run login
```

Un navigateur visible s'ouvre sur Play Console → connectez-vous (2FA inclus) → Entrée dans le terminal. Les cookies sont sauvegardés dans `play-console-auth.json` (**jamais commité**, déjà dans `.gitignore`).

## Utilisation

```sh
cp apps.example.txt apps.txt   # éditez: une app par ligne, "Nom|com.package" (package optionnel)

DEV_ID=1234567890123456789 \
GH_TOKEN=ghp_... \
GH_REPO=ELYAMANI-DEV-GPC/68d9d0fa1299230338c92f7c \
node create-apps.js
```

Pour chaque app : crée le draft Play Console (headless), puis déclenche `flutter-build.yml` sur GitHub avec des **couleurs aléatoires** piochées dans la palette `#8BC34A / #558B2F / #1565C0` (même logique que le bouton 🎲 de l'extension).

## Variables d'environnement

| Variable | Défaut | Description |
|---|---|---|
| `DEV_ID` | — | **Requis.** ID développeur Play Console |
| `GH_TOKEN` | — | PAT GitHub (sinon: pas de build) |
| `GH_REPO` | — | `owner/repo` pour le dispatch |
| `GH_BASE_BRANCH` | `main` | Branche de base |
| `GH_WORKFLOW` | `flutter-build.yml` | Workflow à déclencher |
| `TRACK` | `internal` | Track Play (internal/alpha/beta/production) |
| `PUBLISH_TO_PLAY` | `false` | Upload AAB+listing en draft |
| `UPLOAD_LISTING` | `false` | Maj listing dans le build |
| `APP_TYPE` | `app` | `app` ou `game` |
| `PRICING` | `free` | `free` ou `paid` |
| `DELAY_SEC` | `3` | Délai entre apps |
| `HEADFUL` | — | `1` = navigateur visible (debug) |

## Planification automatique (cron)

Sur votre Mac (doit rester allumé) :

```sh
crontab -e
# Tous les jours à 6h :
0 6 * * * cd "/Users/elyamani/Downloads/play-console-chrome-ext-master 2/playwright-bot" && DEV_ID=... GH_TOKEN=... GH_REPO=... node create-apps.js >> bot.log 2>&1
```

Ou dans GitHub Actions avec un **runner self-hosted** (voir `.github/workflows/auto-create-apps.yml` si ajouté) — stockez `play-console-auth.json` en base64 dans un secret `PLAY_CONSOLE_AUTH_B64`.

## Dépannage

- **« Session Google expirée »** → relancez `npm run login` (les cookies expirent après quelques semaines).
- **Sélecteurs cassés** → Google change l'UI Play Console ; une capture `error-*.png` est sauvegardée à chaque échec, relancez avec `HEADFUL=1` pour observer.
- Les cookies sont **re-sauvegardés automatiquement** à la fin de chaque run (rotation Google).
