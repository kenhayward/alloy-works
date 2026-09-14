Field types - MET-002

The data types a field may take must be a closed set - text, number, date, and true or false

This should include Date, Time, Datetime as separate field types and also include user (i.e. a User in this system), consider how reference types are handled (e.g. Clinical Study Number, Drawn from another system, are these a vocabulary?)

Metadata Schemas - These should have a name

MET-006's "whether that default may be changed once set" is declared but never used. No requirement defines what the flag means operationally (schema-level default vs. artifact value editability) or what happens when a change is attempted — no validation rule, no refusal, nothing. Either give it a semantics and an enforcement point (MET-021/022 territory) or cut it.

Value fate on type/schema change is unspecified. MET-014 changes a component's type at its next version; section 6 handles newly required fields but not the inverse: when a field leaves a schema, or a type swap drops fields, do existing values carry over, drop, or persist orphaned? Same question for a schema re-version that removes a field. One sentence in section 6 would close it.

"At the same place" (MET-008) and cross-level composition are undefined. Schemas apply at document level, section level (via templates) and component level (via types). MET-007/008 compose schemas "applied to the same artifact", but never say whether a template-assigned schema and a component-type schema can ever meet on one artifact — which MET-013 implies they cannot for components, without saying so. Related: MET-008 checks only when the second schema is assigned. If both are validly assigned and then a schema's default changes in a new version (MET-020), an existing assignment can become conflicting with no rule covering it — MET-019 protects versions, not assignments.

Multi-value fields have no required/default semantics. MET-002 lets a field hold several values; MET-006's "required" and "default" are only meaningful for one value. Does required mean at least one? What is a multi-value default (empty list)? No upper bound is mentioned either.

The document/section boundary is implied, not stated. Sections 5–7 are entirely about component values, yet schemas also apply to documents and sections, and MET-019 explicitly protects "documents or sections" from invalidation. The "Not here" table says which schemas a template assigns is TPL's, but not that document/section values and their versioning/validation are TPL's. Add that row — otherwise readers will expect section 6 to cover them. Correspondingly, TPL is missing from the "Rests on" table even though MET-019 and the composition rules depend on how template assignments work.
