# Nuvem pessoal no Google Drive

## Como funciona

Cada jogo tem um snapshot ativo no Drive do usuário, em formato **content-addressed** (idêntico ao modelo do motor v2 do Hydra):

```
Hydra Plus Saves/                    (única pasta visível; escopo drive.file)
├── blobs/
│   ├── 3f7a9c….blob                 (nome = SHA-256 do conteúdo)
│   └── …                            (dedup automático entre jogos e versões)
└── games/
    └── steam/
        └── 1245620/
            └── manifest.json        (RestoreManifestResponse: snapshot, variants, files)
```

- **Dedup**: um blob só é enviado se o hash não existir em `blobs/`. Sincronizar 5 jogos que usam o mesmo arquivo de configuração custa 1 upload.
- **Sync incremental**: só blobs novos sobem (o motor calcula o diff via three-way merge + sync anchor local, que é reutilizado sem alterações).
- **Restauração**: baixa os blobs referenciados, verifica SHA-256 localmente e aplica com o pipeline de restore padrão (mtime preservado, rollback automático).
- **Exclusão**: o manifest vai para a **lixeira do Drive** (recuperável). Blobs permanecem (podem ser compartilhados); um GC opcional pode varrer órfãos no futuro.
- **Custo**: R$ 0 — 15 GB gratuitos do Drive (compartilhados com Gmail/Fotos). O launcher mapeia cota estourada como `google_drive_quota_exceeded`.

## Vinculando a conta (fluxo do usuário)

1. Configurações → Nuvem → "Vincular conta Google".
2. Abre o **navegador padrão** (Google bloqueia webviews embutidos) com consentimento OAuth.
3. O app captura o retorno num listener local `http://127.0.0.1:<porta efêmera>` (PKCE, sem client secret).
4. O **refresh token é cifrado com safeStorage** (DPAPI/Keychain/libsecret) antes de ir para o disco. Se o SO não tiver keyring (Linux raro), cai em base64 com flag `plaintextFallback` para avisar na UI.
5. Desvincular = revoga o token no Google + limpa o armazenamento local.

Escopo pedido: **`drive.file` apenas** — o app só enxerga e gerencia os arquivos que ele mesmo criou. Nada mais do Drive é acessível.

## Setup do publicador (Google Cloud Console)

1. Criar projeto → **APIs & Services → Library** → habilitar **Google Drive API**.
2. **OAuth consent screen**: External, modo **Testing** (até 100 usuários de teste; para distribuição ampla é preciso verificar o app). Adicionar o scope `.../auth/drive.file`.
3. **Credentials → Create credentials → OAuth client ID → Desktop app** → copiar o *Client ID* (não há client secret no fluxo PKCE para apps instalados).
4. Build: `MAIN_VITE_GOOGLE_CLIENT_ID=<client-id>` (local: `.env`; CI: secret do repo).

## Escolha do provider

- Global em `userPreferences.cloudProvider` (`"hydra"` padrão | `"google-drive"`).
- O resolver (`provider-resolver.ts`) só usa o Drive se houver conta vinculada; caso contrário cai para a Hydra — ou falha com `google_drive_not_linked`, nunca silenciosamente.
- Quem usa o Drive **não precisa de assinatura Hydra**: o gating por assinatura será ignorado nos call-sites quando o provider ativo for o Drive (checklist Fase 2 em `docs/FORK.md`).
