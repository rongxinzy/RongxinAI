# MCP connector compatibility review

This repository contains connector metadata, remote MCP URLs, and skills. It does not contain the remote MCP server implementations. No `LICENSE` file was found under the bundled connector directories, so an MIT license or a commercial redistribution grant cannot be inferred from these files. Before shipping a connector commercially, obtain the provider's written API/MCP terms or an approved commercial agreement.

| Connector | App flow | Browser OAuth evidence | Commercial / license conclusion |
| --- | --- | --- | --- |
| Notion | HTTP + OAuth | Official MCP endpoint and OAuth flow | Provider terms still need commercial review; no local MIT proof |
| GitHub | HTTP + OAuth | GitHub Copilot MCP endpoint; verify tenant/account eligibility | No local MIT proof; use subject to GitHub terms |
| Supabase | HTTP + OAuth | Official Supabase MCP endpoint; verify account authorization | No local MIT proof; use subject to Supabase terms |
| Jinshuju | HTTP + OAuth | Bundled skill documents OAuth scopes | No local MIT proof; provider terms apply |
| Baidu Netdisk | SSE + OAuth-managed access token | Skill says connector management obtains and refreshes the access token | No local MIT proof; provider terms apply |
| Patsnap | HTTP + API token | No browser OAuth; requires `PATSNAP_API_KEY` | Token/API subscription and provider terms required |
| Feishu CLI | Official CLI + Skills, not MCP transport | CLI opens official browser login | CLI/Skills terms apply; do not present as a stdio MCP server |
| PKULaw | HTTP + MCP OAuth 2.1/PKCE | Skill explicitly documents browser callback authorization | No local MIT proof; subscription/official account required |
| WPS | HTTP + bearer token | Browser is used to sign in and manually obtain a connector token; not public OAuth | Token and WPS connector terms required; current endpoint metadata is WorkBuddy-oriented |
| Qixinhuiyan | HTTP | No verifiable public OAuth flow in bundled files | Official account/contract required; do not auto-open OAuth |
| Huayu Yuandian | HTTP | No verifiable public OAuth flow in bundled files | Official account/contract required; do not auto-open OAuth |
| Gildata | HTTP + URL token | No browser OAuth; skill uses `GILDATA_TOKEN`/JY API key | Provider token/subscription and terms required |

The UI therefore exposes browser authorization only for entries classified as `oauth`, the Feishu official CLI flow for `cli`, and token fields for `token`. `external` entries show the provider-access explanation without pretending that a public OAuth flow exists.
