# Relatórios do agente de melhoria contínua

Este branch é o diário de bordo automatizado do hydra-plus. O agente roda todos os dias (workflow *Improvement Agent*) e escreve um arquivo por dia em `reports/`.

- ✅ gates de qualidade do `main` medidos na hora (typecheck, testes, lint)
- 👁 o que o Hydra original (hydralauncher/hydra) fez de novo e se vale a pena portar
- 📊 pulso do repositório (release, code smells, hotspot do dia)
- 🔨 contagem regressiva para a build mensal (a cada 30 dias, workflow *Monthly Build*)

> ⚠️ Relatórios gerados por automação determinística (sem LLM). Sugestões de port são heurísticas baseadas no prefixo do commit; a decisão final é sempre manual — o fork diverge do upstream de propósito (cloud saves no Google Drive, CachyOS como runtime padrão).

O estado do agente (baseline do upstream, contadores anteriores) fica em `state.json`.
