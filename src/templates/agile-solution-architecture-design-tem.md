
> **Use for:** smaller projects, incremental changes, limited integrations, low\-risk enhancements, or designs expected to evolve during delivery.

# Document Information — Core

| Field | Value |
| --- | --- |
| Design ID | `[SAD-xxx]` |
| Solution | `[Name]` |
| Status | `[Draft / In Review / Approved / Superseded]` |
| Version | `[Version]` |
| Architect | `[Role or name]` |
| Selected Option | `[OPT-xxx]` |
| Source Artifacts | `[PRD, scenario matrix, payload analysis links]` |
| Last Updated | `[Date]` |

---
# Agile Solution Architecture Design Template Body
## 1\. Design Summary — Core

### Purpose

`[One paragraph describing the problem, selected solution, and expected result.]`

### Scope

**In scope**

- `[Capability or boundary]`

**Out of scope**

- `[Explicit exclusion]`

### Architecture Outcome

`[What the selected architecture enables or changes. Do not repeat detailed business requirements.]`

## 2\. Architecture Context — Core

### Drivers

| Concern ID | Driver | Source IDs | Priority | Status |
| --- | --- | --- | --- | --- |
| `ARC-001` | `[Architecture-relevant need or constraint]` | `REQ-xxx, SCN-xxx` | `[High/Medium/Low]` | `[Evidence status]` |

### Systems and Actors

| ID | System / Actor | Role | Ownership / Boundary |
| --- | --- | --- | --- |
| `SYS-001` | `[Name]` | `[Responsibility]` | `[Internal/external/partner]` |

### Context Diagram

`[Insert one Mermaid context diagram showing the solution boundary, users, systems, and labeled interactions.]`

## 3\. Selected Solution — Core

### Selected Option

| Field | Value |
| --- | --- |
| Option ID | `OPT-xxx` |
| Summary | `[Selected approach]` |
| Selected By | `[Decision authority]` |
| Rationale | `[Why it best fits the drivers and scenarios]` |
| Main Trade\-offs | `[Accepted disadvantages or compromises]` |
| Conditions | `[Dependencies or validations required for selection]` |

### Target\-State Summary

`[Describe the solution in 3–6 concise bullets.]`

## 4\. Architecture Components — Core

| Component ID | Component | Responsibility | Existing / New / Changed | Related IDs |
| --- | --- | --- | --- | --- |
| `CMP-001` | `[Component]` | `[Single clear responsibility]` | `[State]` | `REQ/ARC/ADR` |

`[Insert one high-level component diagram when components interact across boundaries.]`

## 5\. Key Flows — Core

| Flow ID | Flow | Trigger | Main Path | Expected Outcome | Related Scenarios |
| --- | --- | --- | --- | --- | --- |
| `FLW-001` | `[Flow name]` | `[Trigger]` | `[Short sequence]` | `[Outcome]` | `SCN-xxx` |

Add a Mermaid sequence or activity diagram only for flows where ordering, handoffs, waiting, or branching materially affects the design.

## 6\. Architecture Decisions — Core

| Decision ID | Decision | Rationale | Consequences | Related IDs | Status |
| --- | --- | --- | --- | --- | --- |
| `ADR-001` | `[Decision]` | `[Why]` | `[Positive and negative effects]` | `ARC/CMP/INT/FLW` | `[Proposed/Accepted/Superseded]` |

An ADR should at minimum capture its context, decision, and consequences. Accepted decisions should be superseded through a new decision rather than silently rewritten. [^4]

## 7\. Integration and Data — Conditional

### Interfaces

| Interface ID | Source | Target | Purpose | Pattern | Data / Event | Failure Handling |
| --- | --- | --- | --- | --- | --- | --- |
| `INT-001` | `[Source]` | `[Target]` | `[Purpose]` | `[API/event/file/batch]` | `[High-level data]` | `[Retry/reject/manual]` |

### Data

- **System of record:** `[System by business object]`
- **Key identifiers:** `[Business and correlation keys]`
- **Data movement:** `[Important source-to-target movement]`
- **Sensitive data:** `[Classification or None]`
- **Retention:** `[Requirement or To Validate]`

Detailed payload schemas and mappings should normally remain linked artifacts.

## 8\. Quality, Security, and Operations — Core, Proportionate

| NFR ID | Area | Requirement / Target | Design Response | Validation |
| --- | --- | --- | --- | --- |
| `NFR-001` | `[Reliability/security/performance/etc.]` | `[Measurable target]` | `[Design measure]` | `VAL-xxx` |

Include only applicable attributes. Quality scenarios should be specific and measurable rather than expressed as terms such as “fast” or “highly available.” [^5]

## 9\. Risks and Unresolved Items — Core

### Risks

| Risk ID | Risk | Impact | Mitigation | Owner | Status |
| --- | --- | --- | --- | --- | --- |
| `RSK-001` | `[Risk]` | `[Impact]` | `[Response]` | `[Owner]` | `[Status]` |

### Open Questions / Decisions Needed

| ID | Question or Decision | Impact | Needed From | Needed By | Status |
| --- | --- | --- | --- | --- | --- |
| `OQ-001` | `[Unresolved point]` | `[Design impact]` | `[Role/team]` | `[Milestone]` | `Decision Needed` |

## 10\. Validation and Traceability — Core

| Source IDs | Concern | Decision | Design Element | Validation |
| --- | --- | --- | --- | --- |
| `REQ-001, SCN-003` | `ARC-001` | `ADR-002` | `CMP-002, FLW-001` | `VAL-004` |

## 11\. Conditional Additions

Include only when needed:

- API or event contract details
- Data model / ER diagram
- Security threat analysis
- Deployment diagram
- Migration and cutover
- Coexistence and rollback
- Support model and runbook
- Cost model
- Compliance controls
- Detailed state transitions

---

# Simple Traceability Model

## Trace Chain

`REQ -> SCN -> ARC -> OPT -> ADR -> CMP / FLW / INT / DATA -> VAL -> TC`

| ID | Meaning |
| --- | --- |
| `REQ-xxx` | Requirement |
| `SCN-xxx` | Scenario |
| `ARC-xxx` | Architecture concern |
| `OPT-xxx` | Solution option |
| `ADR-xxx` | Architecture decision |
| `CMP-xxx` | Component |
| `FLW-xxx` | Flow |
| `INT-xxx` | Interface |
| `DATA-xxx` | Data concern/object |
| `NFR-xxx` | Quality requirement |
| `VAL-xxx` | Architecture validation |
| `TC-xxx` | Downstream test case |

## Recommended Trace Record

| Requirement | Scenarios | Concern | Option / Decision | Design Elements | Validation |
| --- | --- | --- | --- | --- | --- |

DocHub should generate this from IDs already stored on each record rather than maintaining duplicate narrative.

---

# Solution Option Analysis Structure

| Field | Content |
| --- | --- |
| Option ID | `OPT-xxx` |
| Summary | Short description |
| Approach | Main design pattern |
| Requirement / Scenario Fit | Supported, partially supported, unsupported |
| Benefits | Business and technical advantages |
| Drawbacks | Limitations and trade\-offs |
| Risks | Material risks |
| Complexity / Effort | Relative estimate with rationale |
| NFR Impact | Reliability, security, performance, operations, cost |
| Dependencies / Constraints | Preconditions and restrictions |
| Open Validations | Evidence still needed |
| Recommendation | Recommend / Viable / Not Recommended |
| Rationale | Why |

The final design retains the selected option, rationale, accepted trade\-offs, and references to rejected options—not the entire exploratory narrative.

---

# Evidence and Status Convention

The attached design explicitly distinguishes payload evidence from behavior that remains “to confirm,” which is an important control against turning inference into fact. [^1]

| Status | Meaning |
| --- | --- |
| **Confirmed** | Supported by an approved source, observed evidence, or accepted decision |
| **Assumption** | Used to progress design but not yet verified |
| **To Validate** | Proposed design or behavior requiring technical or operational validation |
| **Decision Needed** | Multiple valid directions remain; an owner must decide |
| **Out of Scope** | Explicitly excluded from the current design |

Apply status at the **record level**—driver, interface, decision, mapping, NFR, or open question—not merely as a document\-wide disclaimer.

---

#  Diagram Guidance

Official C4 guidance states that teams do not need every diagram level; context and container views are sufficient for most teams, with dynamic and deployment views added when useful. [^6]

| Diagram | Agile | Standard | Use When |
| --- | --- | --- | --- |
| Context | **Required** | **Required** | Shows boundaries and external dependencies |
| Component / Container | Usually required | **Required** | Shows responsibilities and interactions |
| Sequence / Activity | 1–2 critical flows | As needed | Ordering and handoffs matter |
| Integration | Conditional | Conditional | Many interfaces or patterns exist |
| Data / ER | Conditional | Conditional | Data ownership or relationships drive design |
| State | Conditional | Conditional | Lifecycle and transition rules are complex |
| Deployment | Rare | Conditional | Infrastructure or environment topology matters |
| Migration / Cutover | Rare | Conditional | Coexistence or transition is risky |

Use Mermaid with:

- Light colors
- Short labels
- Labeled arrows
- One purpose per diagram
- A legend only when notation is not obvious
- IDs consistent with the design tables

---

# Template Selection

| Factor | Agile / Lightweight | Standard / Comprehensive |
| --- | --- | --- |
| Default | **Yes** | Escalate when needed |
| Systems | Few, familiar | Multiple internal/external systems |
| Integration | Simple or established | Event\-driven, multi\-party, financial, or complex |
| Data | Low sensitivity / simple movement | Sensitive, regulated, migrated, or reconciled |
| Business impact | Limited and reversible | Financial, customer, legal, or enterprise\-wide |
| Operations | Standard support | High availability or complex recovery |
| Migration | None or simple | Coexistence, cutover, backfill, decommissioning |
| Architecture risk | Low and understood | High or unresolved |
| Governance | Team\-level | Cross\-team, audit, security, or architecture\-board review |
