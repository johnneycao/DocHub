# Simplified AI\-First Agile PRD

## Recommended Structure

| \# | Section | Purpose |
| --- | --- | --- |
| 1 | **Overview** | Why are we doing this? |
| 2 | **Scope** | What is included and excluded? |
| 3 | **Users & Systems** | Who and what are involved? |
| 4 | **Requirements** | What should the solution do? |
| 5 | **Business Rules** | What rules control the behavior? |
| 6 | **Data & Integration** | What data/systems are involved? Only when applicable. |
| 7 | **Non\-Functional Requirements** | Performance, security, availability, etc. Only when applicable. |
| 8 | **Dependencies & Constraints** | What could affect the solution? |
| 9 | **Open Questions** | What still needs clarification? |

---

# 1\. Overview

Keep this very short.

### **Problem / Opportunity**
- 

### **Business Objective**
- 

### **Expected Outcome**
- 

### **Success Measure**
- 

Example:

> Customers cannot currently exchange online orders in stores.The objective is to support cross\-channel exchanges while maintaining accurate inventory, payment, tax, and financial records.

---

# 2\. Scope


| In Scope     | Out of Scope |
| ------------ | ------------ |
| Capability A | Capability X |
| Capability B | Capability Y |
| Capability C | Capability Z |

This is important for AI because it prevents generation of scenarios outside the intended scope.

---

# 3\. Users & Systems

One simple table.

| Type | Name | Role |
| --- | --- | --- |
| User | Customer | Initiates transaction |
| User | Store Associate | Processes transaction |
| System | Shopify | Commerce platform |
| System | Middleware | Integration |
| System | D365 | ERP |

No separate stakeholder matrix is necessary unless the project specifically needs one.

---

# 4\. Requirements

This should be the **heart of the PRD**.

Instead of many separate sections, keep the information together.

## Requirement Template

| Field | Description |
| --- | --- |
| **ID** | REQ\-001 |
| **Requirement** | What needs to happen |
| **Actor** | User/system performing the action |
| **Trigger** | What starts it |
| **Preconditions** | What must already be true |
| **Expected Behavior** | Required behavior |
| **Expected Result** | Successful outcome |
| **Exceptions** | Important alternate/error conditions |
| **Business Rules** | Related BR IDs |
| **Acceptance Criteria** | Conditions for acceptance |
| **Dependencies** | Related systems/requirements |

### Example

**REQ\-001 — Submit Order**

| Field | Value |
| --- | --- |
| Actor | Customer |
| Trigger | Customer submits checkout |
| Preconditions | Valid cart and customer information |
| Expected Behavior | System validates and submits the order |
| Expected Result | Order is created and confirmation returned |
| Exceptions | Invalid address, payment failure, unavailable inventory |
| Business Rules | BR\-001, BR\-002 |
| Acceptance Criteria | Order created only when required validations pass |
| Dependencies | Payment, inventory, ERP |

This single structure gives AI enough information to derive:

- Happy path
- Alternate paths
- Negative scenarios
- Error scenarios
- Data variations
- Integration scenarios
- Test cases
- Architecture considerations

---

# 5\. Business Rules

Keep reusable rules separate so they are not duplicated across requirements.

| ID | Business Rule |
| --- | --- |
| BR\-001 | Order cannot be submitted without successful payment authorization |
| BR\-002 | Inventory must be available before order confirmation |
| BR\-003 | Refund cannot exceed the original captured amount |

Requirements simply reference the applicable rule IDs.

---

# 6\. Data & Integration — When Applicable

Do **not** make this mandatory.

Use it when the project involves APIs, ERP, middleware, external systems, migration, etc.

| From | To | Data / Event | Trigger | Expected Outcome |
| --- | --- | --- | --- | --- |
| Shopify | Middleware | Order | Order submitted | Order forwarded |
| Middleware | D365 | Order | Valid order received | Sales order created |
| D365 | Shopify | Status | Status changed | Shopify updated |

Add detailed payloads or mappings as linked artifacts rather than putting everything into the PRD.

---

# 7\. Non\-Functional Requirements — When Applicable

Only document requirements that actually matter to the project.

| Area | Requirement |
| --- | --- |
| Performance | Order submission must complete within agreed response time |
| Security | Only authorized users can perform refunds |
| Availability | Integration must support required business operating hours |
| Volume | Solution must support expected peak transaction volume |
| Monitoring | Failed transactions must be identifiable and actionable |
| Compliance | Applicable regulatory requirements must be met |

Avoid adding NFR sections just because a template says they must exist.

---

# 8\. Dependencies & Constraints

Keep this simple.

| Type | Description |
| --- | --- |
| Dependency | Payment provider |
| Dependency | D365 API |
| Constraint | Existing Shopify checkout |
| Constraint | Enterprise security standard |
| Assumption | Product master data is synchronized |

---

# 9\. Open Questions

This is especially important in Agile because the PRD **does not need to be complete before work starts**.

| ID | Question | Related Requirement | Status |
| --- | --- | --- | --- |
| Q\-001 | What happens if ERP is unavailable? | REQ\-001 | Open |
| Q\-002 | Is partial fulfillment supported? | REQ\-003 | Open |

Questions can be resolved progressively during refinement.

---

# What AI Should Generate From the PRD

The PRD should contain the **source requirements**, not all downstream artifacts.

```Mermaid
flowchart LR
    PRD["Agile PRD"] --> AI["AI Analysis"]
    AI --> SM["Scenario Matrix"]
    AI --> TC["Test Cases"]
    AI --> AR["Architecture Inputs"]
    SM --> RF["Requirement Refinement"]
    RF --> PRD
```

This is the key difference from the previous structure.

The PRD should **not contain the full scenario matrix, test cases, or architecture design**.

AI generates those from the PRD and can identify gaps that feed back into requirement refinement.

---

# Recommended Final Template

```PlainText
1. Overview
   - Problem / Opportunity
   - Business Objective
   - Expected Outcome
   - Success Measure

2. Scope
   - In Scope
   - Out of Scope

3. Users & Systems

4. Requirements
   - ID
   - Requirement
   - Actor
   - Trigger
   - Preconditions
   - Expected Behavior
   - Expected Result
   - Exceptions
   - Business Rules
   - Acceptance Criteria
   - Dependencies

5. Business Rules

6. Data & Integration
   - When applicable

7. Non-Functional Requirements
   - When applicable

8. Dependencies & Constraints

9. Open Questions
```

## The Principle

**PRD = business intent \+ structured requirements.**

**AI = analysis and expansion.**

So the PRD stays lightweight and Agile, while AI derives:

**PRD → Scenario Matrix → Test Cases → Architecture Inputs**

rather than forcing the team to document all of those things upfront.

