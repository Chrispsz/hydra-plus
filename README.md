<div align="center">

# Hydra Plus

[![CI](https://github.com/Chrispsz/hydra-plus/actions/workflows/ci.yml/badge.svg)](https://github.com/Chrispsz/hydra-plus/actions/workflows/ci.yml)
[![Release](https://github.com/Chrispsz/hydra-plus/actions/workflows/release.yml/badge.svg)](https://github.com/Chrispsz/hydra-plus/actions/workflows/release.yml)

**Fork minimalista do [Hydra Launcher](https://github.com/hydralauncher/hydra) com nuvem pessoal no Google Drive.**

Baixe e inicie jogos em Windows e Linux, com os saves sincronizados **no seu próprio Drive** — grátis, organizado e sob seu controle. Ou continue usando a nuvem oficial da Hydra, se preferir.

</div>

---

## Destaques

- ☁️ **Cloud saves dual-provider**: escolha entre a nuvem oficial da Hydra (assinatura) e o **Google Drive pessoal** (grátis, 15 GB, pasta `Hydra Plus Saves/` organizada por jogo, dedup por SHA-256).
- 🔐 **Privacidade**: sem Sentry, sem SDKs de telemetria, sem scripts remotos — login Hydra apenas quando você escolher usar os serviços deles.
- 🔑 **Login Hydra intacto**: biblioteca, amigos de download-sources e a nuvem oficial funcionam normalmente para quem já é assinante.
- 🛠️ **CI completo**: GitHub Actions com workflow reutilizável (Windows/Linux), smoke test pós-build, provenance de build e canal de auto-update próprio.
- 📄 Licença MIT, herdada do upstream. Projeto **não afiliado** à Hydra / Los Broxas.

## Status

**☁️ Cloud saves no Google Drive estão funcionais!** Em `Configurações → Nuvem`:

1. Selecione **Google Drive** como provedor.
2. Conecte sua conta Google (OAuth no navegador, permissão `drive.file` — o app só vê os arquivos que ele mesmo criou).
3. Se o build não vier com um cliente OAuth embutido, cole o seu próprio ID do cliente (instruções dentro da tela, ~3 minutos no Google Cloud Console).
4. Pronto: sincronização automática e manual passam a usar o seu Drive — **sem assinatura Hydra Cloud**. A nuvem oficial continua disponível para assinantes.

Tecnicamente: mesmo motor de sync v2 do upstream (merge de três vias, sync anchors, dedup por hash), com o transporte remoto trocável — Hydra API ou a pasta `Hydra Plus Saves/` do seu Drive (`games/`, `blobs/`). Detalhes em [`docs/google-drive-cloud.md`](docs/google-drive-cloud.md).

Veja o roadmap detalhado em [`docs/FORK.md`](docs/FORK.md).

## Build

```bash
yarn install          # requer yarn 1.19+ e Rust stable (addon nativo)
cp .env.example .env  # MAIN_VITE_API_URL + MAIN_VITE_AUTH_URL (login Hydra)
                      # MAIN_VITE_GOOGLE_CLIENT_ID (nuvem Google, opcional)
yarn dev
yarn build:win | yarn build:linux
```

## Créditos

Baseado no [Hydra Launcher](https://github.com/hydralauncher/hydra) por Los Broxas e contribuidores (MIT).
