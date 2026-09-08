# ADR-0078: Additional scheduled jobs require normal requests

Status: accepted by owner, 2026-09-06. Supersedes the new-assignment portion of ADR-0020.

An eligible technician who already has committed work on any day of the new job must explicitly accept the additional job. Use existing `order_assignments`, acceptance, notifications, admin funnel and technician available-order UI. Do not create new assignment work opportunities. Historical opportunities remain readable/decidable for compatibility.

Automatic matching sends a batch (default four, configurable) through normal request rounds. Explicit provider selection remains exclusive, including after the recipient viewed the request. The same availability guard continues to reject overlapping hours and exhausted daily capacity; a request is not permission to double-book.

An order which has entered request rounds cannot later auto-confirm during recovery just because its recipient's workload changed. First valid acceptance wins through the existing transactional path. Expanding a round never cancels the customer order or revokes earlier valid offers.

Free technicians on distant scheduled jobs retain the existing automatic-confirmation behavior. Near-term/emergency and warranty pin rules remain governed by the shared dispatch-route policy. The admin explanation must describe the actual selected route.
