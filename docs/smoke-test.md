# Hydra Plus — Smoke Test Roteiro

> O **quality chain** automatizado (`yarn test:chain`) cobre o que roda headless:
> tipos, lint, SCSS, 686 testes (unit + cenários encadeados), paridade de
> idiomas, drift renderer↔preload, **build de produção + smoke do artefato**
> e formatação. Este roteiro cobre o resto: **uso real**
> do app compilado, numa máquina de verdade com GPU, disco e rede.
>
> Tempo estimado: ~45 min. Marque cada item ✅ ou anote o bug com print.

## 0. Build e instalação

| #   | Passo                                                    | Esperado                                                   |
| --- | -------------------------------------------------------- | ---------------------------------------------------------- |
| 0.1 | `yarn build:win` (Windows) ou `yarn build:linux` (Linux) | build completa sem erros                                   |
| 0.2 | Instalar e abrir o app                                   | janela abre em ~5s, sem console errors                     |
| 0.3 | Idioma pt-BR e en                                        | todos os textos traduzidos, nenhum `key.with.dots` visível |

## 1. Biblioteca + jogos externos (F5)

| #   | Passo                                                                               | Esperado                                                                                                         |
| --- | ----------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| 1.1 | Botão **"+"** → **"Procurar jogos no sistema"**                                     | spinner curto, sem travar a UI                                                                                   |
| 1.2 | **Com Hytale instalado**: aparece candidato **Hytale** (badge + "saves detectadas") | título correto; no Windows exe = `HytaleClient.exe` ou launcher; no Linux flatpak exe = exports bin              |
| 1.3 | Clicar no candidato                                                                 | form preenchido (título, exe, plataforma, matriz: `UserData/Saves` + `Settings.json`)                            |
| 1.4 | Confirmar com auto-sync marcado                                                     | toast de sucesso; jogo na biblioteca com ícone                                                                   |
| 1.5 | Abrir o widget de nuvem do jogo                                                     | locais rastreados = a matriz; **"Sincronizar agora"** sobe para `Hydra Plus Saves/games/custom/<uuid>/` no Drive |
| 1.6 | Editar pasta de save no widget (adicionar/remover)                                  | persiste ao fechar/abrir                                                                                         |
| 1.7 | **Launchar o jogo importado**                                                       | sync pré-launch roda (banner), jogo abre; ao fechar, sync pós-saída sobe o save                                  |
| 1.8 | Repetir 1.1–1.5 com um app Linux qualquer (desktop entry) e um `.exe` via Proton    | import funciona; exe roda via umu/Proton com prefix criado                                                       |

## 2. Downloads 100% grátis (F3/F4)

| #   | Passo                                                            | Esperado                                                             |
| --- | ---------------------------------------------------------------- | -------------------------------------------------------------------- |
| 2.1 | Baixar um jogo via **torrent** (magnet)                          | progresso, ETA, `tabular figures` nos números (sem "dançar")         |
| 2.2 | **Pausar → fechar o app → reabrir → resumir**                    | retoma de onde parou (range state); sem baixar de novo o que já veio |
| 2.3 | Cancelar e remover com arquivos                                  | modal de confirmação + toast com **Desfazer**                        |
| 2.4 | Baixar de um hoster grátis (Gofile/PixelDrain/Mediafire sem www) | downloader certo escolhido; ranges paralelos visíveis na velocidade  |
| 2.5 | Torrent com **arquivo aninhado** (zip dentro do repack)          | extração 2 passes; sem "ghost files" na pasta                        |
| 2.6 | Pesquisar `debrid` em todos os menus                             | **nada** de serviço pago em lugar nenhum                             |
| 2.7 | Jogar os downloads com o foco no teclado (Tab)                   | anel de foco visível em todos os botões                              |
| 2.8 | Ativar `prefers-reduced-motion` no SO                            | nenhuma animação/spinner roda                                        |

## 3. Proton+ (F2)

| #   | Passo                                               | Esperado                                                                     |
| --- | --------------------------------------------------- | ---------------------------------------------------------------------------- |
| 3.1 | Configurações → Proton Manager → atualizar catálogo | releases GE-Proton/CachyOS listados                                          |
| 3.2 | Instalar um build                                   | barra de progresso, sha256 verificado, aparece em "instalados"               |
| 3.3 | Remover o build em uso por um jogo                  | bloqueado com explicação clara                                               |
| 3.4 | Opções do jogo → flags de launch (Linux)            | flags com tooltip de disponibilidade; mangohud/gamescope aplicam ao launchar |
| 3.5 | Fechar o app **durante** um download de build       | reabrir: instalação não fica "meio-promotada" (rollback)                     |

## 4. Nuvem Drive (estabilidade F1)

| #   | Passo                                                                           | Esperado                                                                                                                     |
| --- | ------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| 4.1 | Conectar Google Drive                                                           | OAuth próprio do fork conclui; painel de higiene visível                                                                     |
| 4.2 | **Desligar a rede** e pedir sync                                                | erro claro + retry; **não trava** o app (timeouts F1)                                                                        |
| 4.3 | Sync de jogo grande (~1 GB de saves)                                            | dedup de blobs entre jogos visível no uso do Drive                                                                           |
| 4.4 | Segunda máquina: restaurar snapshot                                             | save baixa, hash verificado, restaurado no lugar certo; conflito oferece resolução                                           |
| 4.5 | Rodar o jogo com o Drive deslogado                                              | jogo abre normal; lifecycle não trava (erro de auth tratado)                                                                 |
| 4.6 | **Fechar o app com jogo em sessão**; de novo: `kill -9` no app durante a sessão | playtime da última sessão persiste no relançar; um worker de processos travado recicla em ≤10s (nunca fica "Running" eterno) |

## 5. Relatório

- Qualquer ❌: `git bisect` entre tags + `yarn test:chain` deve estar verde em
  todos os commits candidatos (o chain é a rede de segurança — o bug é de
  integração com o mundo real, não dos módulos).
- Reportar com: passos, SO, print, log (`%APPDATA%/hydra-plus/logs` ou
  `~/.config/hydra-plus/logs`).
