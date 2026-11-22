# Plan: Azure hosting, Entra SSO with project roles, SharePoint storage, Copilot

Status: **deferred.** The chosen direction is a local user application with the data in a OneDrive folder and local settings, no app registration and no cloud service (DESIGN.md section 5.3). This plan is kept only for a possible hosted multi-user service. Original status: proposal, nothing built. Decisions are final where marked **Decided**; the rest are recommendations to confirm. Microsoft facts come from public sources (end of file); nothing was tested against your tenant.

## 1. Decisions

| # | Topic | Decision |
| --- | --- | --- |
| D1 | Roles | **Admin** (global), **Contributor** and **Viewer** (per project). A user can be Contributor on one project and Viewer on another |
| D2 | Hosting | Azure, with Microsoft Entra ID sign-in (recommendation in section 2) |
| D3 | Project files | Stored on a **SharePoint site**, one folder per project |
| D4 | Configuration | Cloud-based (recommendation in section 3) |
| D5 | Viewers | Browser only: no export, download, copy-to-folder or AI buttons for viewers |
| D6 | Retention | File based: **keep every version** of every project file |
| D7 | Copilot licences | Whole company is on Microsoft 365 E7 |
| D8 | Local folder route | Replaced by Microsoft Graph (recommendation in section 4) |

## 2. Azure hosting (recommendation)

| Part | Recommended service | Why |
| --- | --- | --- |
| App | **Azure Container Apps** (or App Service for Containers) running the current Python helper and web page in one container | The helper already needs Python, MarkItDown and, for now, the Claude CLI; a container carries all three |
| Sign-in | **Built-in authentication** of the app service with Microsoft Entra ID (OpenID Connect), tenant-only, no anonymous access | No sign-in code to write or maintain; the server receives the verified user and group claims |
| Global role | One Entra **app role** `Admin` assigned to an Entra group `DocHub-Admins`; everyone else needs the app assignment `User` | Admin is the only global role |
| Secrets | **Azure Key Vault**, read by the app through its **managed identity** | AI keys and connection tokens leave local files; Key Vault keeps every secret version |
| AI models | Claude on Microsoft Foundry and Azure OpenAI deployments, called from the app with managed identity where supported | Same Azure subscription and network; no keys on laptops |
| Logs | **Application Insights / Log Analytics** for sign-ins, AI usage (step, model, tokens) and errors | Cheap, queryable; content history is already in SharePoint versions |
| Network | Start internet-facing behind Entra sign-in and Conditional Access; move to private networking if your policy requires it | Conditional Access, MFA and device rules come with E7 (Entra Suite) |

### Who does what in Entra (checklist for IT)

| Task | Role needed |
| --- | --- |
| Register the application, set redirect URL, create app roles | Application Administrator or Cloud Application Administrator |
| Grant admin consent to the Graph permissions | Privileged Role Administrator or Global Administrator |
| Create the Admin group, assign it the `Admin` role | Group or User Administrator |
| Create the Azure resources and Key Vault | Contributor on the Azure subscription or resource group |
| Create the SharePoint site and give the app access to it only | SharePoint Administrator |

**Q1** Which Azure subscription and region, and who in IT owns these tasks?

## 3. Where things are stored (recommendation)

| Data | Where | Reason |
| --- | --- | --- |
| Project files: sources, PRD, matrix, tests, design, reports, references, `design.json` state | **SharePoint document library**, folder per project | Matches D3; versioning and recycle bin built in |
| Document templates (PRD, architecture, payload report) | SharePoint `Config/Templates`, Admin edit, everyone read | They are documents, versioned, reviewable |
| Non-secret settings: provider list, model per step, connection addresses, project list | SharePoint `Config/settings.json`, Admin edit | One place, versioned, no extra database |
| Secrets: API keys, MCP tokens | Azure Key Vault | Never in SharePoint or in the browser |
| Sign-in and AI usage log | Log Analytics workspace | Queryable; retention set by policy |
| Project membership (who is Contributor or Viewer) | **SharePoint permissions on the project folder** (see section 4) | One source of truth, no separate list to keep in sync |

No database is needed. If search across projects or reporting is wanted later, add Azure SQL or Cosmos DB then.

**Versions (D6).** Turn on version history for the library and raise the version limit to the maximum the tenant allows (the default is 500 major versions, confirm the current limit). Add a Microsoft Purview retention policy on the site so versions and deleted files are kept. Only Admins may delete a project; Contributors get no delete right on the folder.

## 4. SharePoint through Microsoft Graph (recommendation)

| Option | Result |
| --- | --- |
| **A. Delegated access (recommended):** the app calls Graph with the signed-in user's own token (on-behalf-of flow) | SharePoint itself enforces Contributor (edit) and Viewer (read); version history shows the real user, not the app |
| B. App-only access (`Sites.Selected`) | The app would have to enforce roles itself, and every version would show "DocHub" as the author, which loses who changed what |

- Use A for all project files. Use one small app-only grant (`Sites.Selected`, this site only) just for Admin actions that set project permissions.
- **Project roles:** the Admin screen adds a user or group to a project as Contributor (SharePoint Edit) or Viewer (SharePoint Read) on that folder. A new project folder starts with no inherited access.
- **Replaces:** the `/api/folder/*` routes, the Shared folder button and the server's `designs/` folder. The server keeps no project data (stateless container).
- **Save and sync:** Save writes straight to the project folder; Sync reads from it, so edits made in SharePoint or a Markdown editor still come back as today.
- **Conflicts:** each save sends the file's ETag; if someone else saved first the save is refused and the user sees who and when. No live co-editing.
- **Payload library:** about 1,300 small files per project today would be slow through Graph. Store the imported payloads as one archive file per import and unpack in memory; confirm with a test.
- **Permissions to request (delegated):** `Sites.ReadWrite.All` or, better, a narrower per-site grant if available in your tenant, plus `User.Read`. Confirm with IT.

**Q2** One SharePoint site for all projects, or one per business area?

## 5. Roles in the product

| | Admin | Contributor (project) | Viewer (project) |
| --- | --- | --- | --- |
| See project and all pages, diagrams, reports | all projects | yes | yes |
| Edit sources, PRD, matrix, tests, payloads, design | yes | yes | no |
| Run AI steps (tokens) | yes | yes | no |
| Export, download, copy to folder | yes | yes | **no** (D5) |
| Save to SharePoint | yes | yes | no |
| Create project, add or remove members, delete project | yes | no | no |
| AI models, keys, connections, templates, settings | yes | no | no |
| See usage and logs | yes | no | no |

Server rule: the server checks role and project on every request. The browser only hides buttons.

## 6. Copilot (updated with D7)

- All users hold Microsoft 365 Copilot through E7, so the licence is not the obstacle.
- The limits in the earlier review still decide the design: the Copilot Chat API is a beta, delegated-only, text-only API with no JSON mode and no tool calls, so it cannot be the primary model for the structured steps.
- With Entra sign-in (this plan) and delegated Graph access (section 4), each user's token is already available, so Copilot can be added as an **optional text-only provider** for drafting steps, plus a short test of the newer Work IQ API.
- **Primary stays Claude on Microsoft Foundry**; Azure OpenAI models from Foundry as the second choice. Foundry and Azure OpenAI usage is billed separately from E7.

## 7. Phases

| Phase | Scope | Done when |
| --- | --- | --- |
| 0. Prepare | Answer Q1 to Q4; IT creates the subscription, Entra app, Admin group and SharePoint site | Checklist in section 2 complete |
| 1. Host and sign in | Container build, deploy, built-in Entra authentication, user shown in the top bar, `Admin` role from the group, secrets in Key Vault, local-only guard replaced by session checks | Only signed-in tenant users reach the app; non-admins cannot open the AI models, connections or templates pages |
| 2. SharePoint storage | Graph with delegated access; save, load and sync against the project folder; ETag conflict check; remove the server `designs/` folder and `/api/folder/*` | A project saved by one user opens for another; two simultaneous saves never overwrite silently |
| 3. Project roles | Admin screen for projects and members; SharePoint permissions as the source; viewer mode (no edit, no AI, no export); contributor limits | A viewer cannot change or export data even by calling the API; a contributor cannot reach a project they were not added to |
| 4. Versions and logs | Version history on, retention policy, a Versions view that lists SharePoint versions with author and time and can restore one; usage log | Every save has an author and can be restored |
| 5. AI move | Run the Claude calls from the container (CLI first, direct Foundry API later); usage per user, step and model | Admin sees who used which tokens |
| 6. Copilot | Work IQ and Chat API test, then a text-only provider for licensed users | Go or no-go per step type, written down |

Rough size for one developer: Phase 1 two to three weeks, 2 three to four, 3 two, 4 one to two, 5 two, 6 one (test) plus two (provider). These are estimates until Q1 to Q4 are answered.

## 8. Open questions

| # | Question | Needed for |
| --- | --- | --- |
| Q1 | Azure subscription, region and the IT owner of the checklist | Phase 0 |
| Q2 | One SharePoint site for all projects, or one per business area? | Phase 2 |
| Q3 | Who are the first Admins (names or an Entra group)? | Phase 1 |
| Q4 | Internet-facing with Conditional Access, or private network only? | Phase 1 |
| Q5 | May the product use broad delegated SharePoint permission (user's own access only), or does IT require a narrower grant? | Phase 2 |
| Q6 | Is a restore of an old version by a Contributor acceptable, or Admin only? | Phase 4 |

## 9. Risks

| Risk | Response |
| --- | --- |
| Many small payload files make Graph slow or throttled | Archive per import (section 4); test with the 634-file Return / Exchange library first |
| Local-only features break when hosted (folder paths, installs, CLI) | Folder routes removed; installs done in the container build; CLI kept in the container until the direct API replaces it |
| SharePoint version limit reached | Raise the limit and watch it; Purview retention |
| Delegated token expires during a long AI run | Refresh tokens in the app; the AI call itself uses the server's identity, only the save uses the user's |
| Beta Copilot API changes | Test first; keep it optional behind the provider interface |

## 10. Sources

- [Microsoft 365 E7](https://www.microsoft.com/en-us/microsoft-365/enterprise/e7), [Compare Copilot in E3, E5 and E7](https://learn.microsoft.com/en-us/microsoft-365/copilot/microsoft-365-copilot-license-feature-overview)
- [Copilot Chat API](https://learn.microsoft.com/en-us/microsoft-365/copilot/extensibility/api/ai-services/chat/copilotroot-post-conversations)
- Items in sections 2 to 4 (Container Apps authentication, Sites.Selected, on-behalf-of flow, SharePoint version limits, Purview retention) are standard Microsoft features described from general knowledge; confirm each against Microsoft Learn before building.
