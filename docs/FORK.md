# Hydra Plus — guia do fork

> Fork minimalista do [Hydra Launcher](https://github.com/hydralauncher/hydra) (v4.1.4, commit base `c4eec13`).
> Objetivo: **um launcher para baixar e iniciar jogos em qualquer sistema, com backup de saves no Google Drive do usuário** — sem servidores próprios, sem paywall para a nuvem pessoal, e sem quebrar o login e os serviços oficiais da Hydra para quem quiser continuar usando-os.

Licença: MIT (herdada do upstream). Este fork **não é afiliado** à Hydra / Los Broxas.

---

## Status das fases

| Fase  | Escopo                                                                                                                                                                    | Status                 |
| ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------- |
| **0** | CI/CD completo (workflows reutilizáveis, ARM64-ready, smoke test, provenance)                                                                                             | ✅ concluída           |
| **1** | Interface `CloudSaveRemoteStore` + provedor Hydra + provedor Google Drive (OAuth PKCE, tokens em safeStorage, dedup por hash) + IPC/preload + preferência `cloudProvider` | ✅ esqueleto concluído |
| **2** | Migração dos call-sites do motor de sync para a interface (ver checklist abaixo)                                                                                          | ⬜ próxima             |
| **3** | UI: aba "Nuvem" nas configurações (Hydra ⬜ / Google ⬜), bypass do paywall no renderer                                                                                   | ⬜                     |
| **4** | Remoções seguras (Big Picture, social, themes, emuladores, conquistas) — ver matriz no relatório de análise                                                               | ⬜                     |
| **5** | Extras: compressão zstd, criptografia E2E opcional, GC de blobs, histórico de versões                                                                                     | ⬜                     |

---

## O que já existe no código (Fase 1)

```
src/main/services/cloud-save/remote-store/
├── types.ts                  # interface CloudSaveRemoteStore + DTOs
├── provider-resolver.ts      # escolhe Hydra ou Google Drive (com fallback seguro)
├── hydra-api-store.ts        # adapter da nuvem oficial (comportamento idêntico ao stock)
├── index.ts
└── google-drive/
    ├── config.ts             # MAIN_VITE_GOOGLE_CLIENT_ID
    ├── google-oauth.ts       # OAuth 2.0 PKCE + loopback 127.0.0.1 (browser do sistema)
    ├── drive-token-store.ts  # refresh token cifrado com safeStorage no LevelDB
    ├── drive-client.ts       # cliente REST Drive v3 (resumable upload, media, trash)
    └── google-drive-store.ts # implementa CloudSaveRemoteStore no Drive do usuário
```

Eventos IPC já registrados (preload expõe `startGoogleAuth` / `disconnectGoogleDrive`):
`src/main/events/user/start-google-auth.ts`, `src/main/events/user/disconnect-google-drive.ts`.

Preferência nova: `userPreferences.cloudProvider?: "hydra" | "google-drive"` (`src/types/level.types.ts`).

---

## Checklist da Fase 2 — migrar os call-sites (sem quebrar o sync)

Todo o motor de sync é provider-agnostic; os pontos abaixo ainda chamam a Hydra API diretamente. A migração é mecânica e cada item é um PR pequeno:

1. **Orquestrador** `src/main/services/cloud-save/sync-game-cloud-save.ts`
   - Onde hoje chama `listRemoteGameSnapshots`, `createRemoteSnapshotFromLocalState`, `restoreRemoteSnapshot` e `delete-game-cloud-save-data`, obter o store uma vez por operação:
     ```ts
     const store = await getCloudSaveRemoteStore();
     ```
   - `createSnapshot` espera `context` (o orquestrador já o constrói via `buildLocalGameSnapshotContext`).
   - **Tratamento de conflito**: o store do Drive lança `Error("cloud_save_snapshot_version_conflict")`. Adicionar ao retry: quando `error.message` for esse código, tratar como conflito (mesma rota de `shouldRetryCloudSaveConflict` para 409).
2. **Restore** `restore-remote-snapshot.ts` / `resolve-remote-snapshot-targets.ts`: substituir `downloadRemoteSnapshotToTemp(...)` por `store.downloadRestoreBlobs({ manifest, requestedFiles, onProgress })` — o retorno (`DownloadedRestoreFile[]`) já é o mesmo tipo consumido pelo `replaceRestoreTargets`. A verificação SHA-256 em `verify-downloaded-restore-file.ts` permanece (o Drive store baixa os blobs brutos, sem confiar no transporte).
3. **Paywall main-process** — onde `assertCloudSaveSubscription()` é chamado (sync/overview/delete) e em `automatic-sync.ts` (`canAccessCloudSaves`), adicionar antes:
   ```ts
   if (await isGoogleDriveCloudActive()) {
     // nuvem pessoal do usuário: nada a fazer com a assinatura Hydra
   } else {
     assertCloudSaveSubscription();
   }
   ```
4. **Paywall renderer (Fase 3)**: `getCloudSaveAccessAction` (`src/shared/cloud-save-access.ts`) decide entre "sign-in"/"paywall"/"open". Enviar o provider ativo por IPC (ex.: ampliar `getCloudSaveOverview`) e retornar `"open"` quando o provider for google-drive (exigindo conta vinculada).

## Configuração do Google (uma vez por publicador)

Ver **docs/google-drive-cloud.md**. Resumo: projeto no Google Cloud → habilitar Drive API → OAuth consent **publicado em Produção** (Testing bloqueia não-testadores com 403 e expira o refresh token em 7 dias) → criar credencial "Desktop app" (copiar Client ID **e Client Secret** — o Google exige o secret na troca de código, mesmo com PKCE) → `MAIN_VITE_GOOGLE_CLIENT_ID` + `MAIN_VITE_GOOGLE_CLIENT_SECRET` no build (secrets `MAIN_VITE_GOOGLE_CLIENT_ID` e `MAIN_VITE_GOOGLE_CLIENT_SECRET` no GitHub Actions).

---

## Build e release

- CI: `.github/workflows/ci.yml` (PR/push) → quality gate (typecheck+test+lint) → build matriz Windows/Linux (cache Rust+vcpkg preservado do upstream) → smoke test no Linux.
- Release: tag `v*` → build → **attest-build-provenance** → draft release com `latest.yml` (auto-update do electron-updater aponta para o repo do fork via `MAIN_VITE_UPDATE_OWNER`/`MAIN_VITE_UPDATE_REPO`).
- Nightly: cron 05:00 UTC, artifacts com retenção curta.
- Configurar nos _Repository variables/secrets_: `MAIN_VITE_API_URL`, `MAIN_VITE_AUTH_URL`, `MAIN_VITE_UPDATE_OWNER`, `MAIN_VITE_UPDATE_REPO`, secrets `MAIN_VITE_GOOGLE_CLIENT_ID` e `MAIN_VITE_GOOGLE_CLIENT_SECRET`.

### Acompanhar o upstream (importante!)

O upstream evolui rápido; os forks saudáveis (GameOneDev, entitybtw) integram cada release. Com o remote já configurado:

```bash
git fetch upstream --unshallow   # uma única vez, para ter histórico
git checkout fork/main
git merge upstream/main          # mensal, resolve conflitos pequenos
```

As mudanças deste fork até a Fase 3 são cirúrgicas (arquivos novos + ~10 edições pequenas), o que mantém os merges baratos.

---

## Ressalvas conhecidas

- **Deep link**: o protocolo `hydralauncher://` é compartilhado com o cliente oficial (obrigatório para o login deles). Evite ter os dois instalados e registrados ao mesmo tempo; o último a registrar vence o handler do SO.
- **userData separado**: `productName` é "Hydra Plus" → diretório de dados próprio. Quem já usava o Hydra oficial faz login novamente no fork (mais seguro do que compartilhar o LevelDB).
- **Concorrência Drive**: o commit usa verificação otimista (lê `version` antes de gravar). Duas máquinas sincronizando o mesmo jogo no mesmo segundo podem intercalar escritas; o conflito é detectado e o sync re-executa. Hardening futuro: `appProperties` + Drive Changes API.
- **Erros do Drive mapeados**: `google_drive_quota_exceeded` (15 GB cheios), `google_drive_not_linked`, `google_oauth_client_id_missing`, `google_drive_forbidden`.
